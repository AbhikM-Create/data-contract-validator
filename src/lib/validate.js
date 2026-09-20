// The four-layer validator. Pure: no DOM, no React, no file handling.
//
// Layers run in order and each one is reported separately, because WHICH layer
// catches a break is the finding. A file whose columns and types are perfect,
// whose categories are all familiar, and whose timestamps are current can still
// be carrying numbers that are 83x what they should be — the layers above stay
// green and only distribution goes red. A single overall PASS/FAIL would hide
// exactly that, which is the failure mode this tool exists for.

import { TYPES, formatDate, describeCadence, isBlank, profileColumn, columnNames } from './contract.js'
import { normalizeContract } from './authoredContract.js'
import { checkRules } from './rules.js'

export const LAYERS = [
  { id: 'schema', label: 'Schema', question: 'Are the columns and their types the same?' },
  { id: 'semantics', label: 'Semantics', question: 'Do the values still mean the same thing?' },
  { id: 'freshness', label: 'Freshness', question: 'Is the data as current as the baseline implies?' },
  { id: 'distribution', label: 'Distribution', question: 'Are the numbers in the shape the baseline had?' },
]

export const DEFAULT_THRESHOLDS = {
  centralShiftFactor: 3,
  outOfRangeShare: 0.02,
  rangeMarginFactor: 0.5,
  rowCountChangeShare: 0.3,
  nullRateJumpPoints: 0.1,
  freshnessCadenceMultiple: 3,
  newCategoryShare: 0.005,
  droppedCategoryShare: 0.05,
  unitShiftTolerance: 0.05,
}

// Shown and edited in the UI. `scale` is only about presentation: a share of
// 0.3 is typed and read as 30.
export const THRESHOLD_FIELDS = [
  {
    key: 'centralShiftFactor', layer: 'distribution', label: 'Mean/median shift', unit: '×', scale: 1, step: 0.5, min: 1.1,
    help: 'Flag a numeric column when its typical value moves by more than this multiple.',
  },
  {
    key: 'outOfRangeShare', layer: 'distribution', label: 'Values outside baseline range', unit: '%', scale: 100, step: 0.5, min: 0, max: 100,
    help: 'Flag when more than this share of the new file’s values fall outside the baseline range (widened by the margin below).',
  },
  {
    key: 'rangeMarginFactor', layer: 'distribution', label: 'Range margin', unit: '×span', scale: 1, step: 0.1, min: 0,
    help: 'How far past the baseline min/max a value may sit before it counts as outside, as a multiple of the baseline span.',
  },
  {
    key: 'rowCountChangeShare', layer: 'distribution', label: 'Row-count change', unit: '%', scale: 100, step: 5, min: 0,
    help: 'Flag when the new file’s row count differs from the baseline by more than this.',
  },
  {
    key: 'nullRateJumpPoints', layer: 'distribution', label: 'Null-rate jump', unit: 'pp', scale: 100, step: 1, min: 0, max: 100,
    help: 'Flag when a column’s share of blank values rises by more than this many percentage points.',
  },
  {
    key: 'freshnessCadenceMultiple', layer: 'freshness', label: 'Staleness allowance', unit: '× cadence', scale: 1, step: 0.5, min: 1,
    help: 'How many update intervals the newest row may lag behind now before the data counts as stale.',
  },
  {
    key: 'newCategoryShare', layer: 'semantics', label: 'Unseen categories', unit: '%', scale: 100, step: 0.1, min: 0, max: 100,
    help: 'Flag when values never seen in the baseline make up more than this share of a categorical column.',
  },
  {
    key: 'droppedCategoryShare', layer: 'semantics', label: 'Dropped categories', unit: '%', scale: 100, step: 1, min: 0, max: 100,
    help: 'Flag when a baseline category at least this common disappears from the new file entirely.',
  },
  {
    key: 'unitShiftTolerance', layer: 'semantics', label: 'Unit-shift tolerance', unit: '%', scale: 100, step: 1, min: 0, max: 50,
    help: 'How close a column’s scale change must be to a known unit conversion (×100, ×1000, ×60…) to be called one.',
  },
]

// Distribution statistics over a handful of rows describe the handful, not the
// feed. Below this the layer reports SKIPPED instead of a confident verdict.
const MIN_CANDIDATE_ROWS_FOR_STATS = 4

// Scale changes that land on one of these are a unit change, not an anomaly —
// a column converted from dollars to cents is a SEMANTIC break (the number means
// something different now), while an arbitrary 83x jump is a DISTRIBUTION break
// (the number means the same thing and is wrong). Keeping them in separate
// layers is what lets the report say which kind of problem this is.
const UNIT_FACTORS = [
  { factor: 1000, note: 'seconds → milliseconds, or units → thousands' },
  { factor: 100, note: 'dollars → cents, or a 0–1 fraction rewritten as a percentage' },
  { factor: 60, note: 'hours → minutes, or minutes → seconds' },
  { factor: 24, note: 'days → hours' },
  { factor: 12, note: 'years → months' },
  { factor: 10, note: 'a decimal-place shift' },
  { factor: 3.6, note: 'metres/second → km/hour' },
  { factor: 2.54, note: 'inches → centimetres' },
  { factor: 1.609, note: 'miles → kilometres' },
  { factor: 2.205, note: 'kilograms → pounds' },
]

const pct = (share) => `${(share * 100).toFixed(share < 0.01 && share > 0 ? 2 : 1)}%`
const num = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-3)) return value.toExponential(2)
  const decimals = Number.isInteger(value) ? 0 : abs >= 100 ? 1 : 2
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
const factorText = (factor) => (factor >= 100 ? `${Math.round(factor)}×` : `${factor.toFixed(1)}×`)
const quote = (values) => values.map((v) => `"${v}"`).join(', ')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function violation(layer, code, column, message, evidence) {
  // source marks which half of the report this belongs to: a difference from
  // the baseline, as opposed to a rule someone authored. See rules.js.
  return { layer, source: 'baseline', code, column, message, evidence }
}

// --- layer 1: schema --------------------------------------------------------
function checkSchema(contract, candidate) {
  const violations = []

  for (const expected of contract.columns) {
    const actual = candidate.byName.get(expected.name)
    if (!actual) {
      violations.push(violation(
        'schema', 'missing-column', expected.name,
        `The column "${expected.name}" is in the baseline file but missing from the new file. Anything downstream that reads it will break.`,
        `expected ${expected.type}, column absent`,
      ))
      continue
    }
    if (actual.type === TYPES.EMPTY && expected.type !== TYPES.EMPTY) {
      violations.push(violation(
        'schema', 'empty-column', expected.name,
        `The column "${expected.name}" is present but every value in it is blank, so it no longer carries ${expected.type} data.`,
        `${expected.type} → all blank (${actual.rowCount} rows)`,
      ))
      continue
    }
    if (actual.type !== expected.type) {
      violations.push(violation(
        'schema', 'type-change', expected.name,
        `The column "${expected.name}" held ${expected.type} values in the baseline but holds ${actual.type} values now.`,
        `${expected.type} → ${actual.type}`,
      ))
    }
  }

  for (const actual of candidate.columns) {
    if (!contract.byName.has(actual.name)) {
      violations.push(violation(
        'schema', 'extra-column', actual.name,
        `The new file has an extra column "${actual.name}" that the baseline never had. It may be a rename of a missing column — check before trusting it.`,
        `unexpected ${actual.type} column`,
      ))
    }
  }

  return violations
}

// --- layer 2: semantics -----------------------------------------------------
function checkSemantics(contract, candidate, comparable, thresholds) {
  const violations = []

  for (const { expected, actual } of comparable) {
    if (expected.type === TYPES.CATEGORICAL || expected.type === TYPES.BOOLEAN) {
      const baselineDomain = new Set(expected.domain)
      const unseen = [...actual.counts.entries()].filter(([value]) => !baselineDomain.has(value))
      const unseenRows = unseen.reduce((acc, [, count]) => acc + count, 0)
      const unseenShare = actual.presentCount ? unseenRows / actual.presentCount : 0
      if (unseen.length > 0 && unseenShare > thresholds.newCategoryShare) {
        const names = unseen.sort((a, b) => b[1] - a[1]).map(([value]) => value)
        const shown = names.slice(0, 4)
        violations.push(violation(
          'semantics', 'new-category', expected.name,
          `The column "${expected.name}" now contains ${plural(unseen.length, 'value')} the baseline never had — ${quote(shown)}${names.length > shown.length ? ', and others' : ''} — covering ${pct(unseenShare)} of its rows. Either the vocabulary changed upstream or something is writing into the wrong field.`,
          `baseline domain: ${quote(expected.domain.slice(0, 6))}${expected.domain.length > 6 ? '…' : ''}`,
        ))
      }

      const dropped = expected.domain.filter((value) => {
        const baselineShare = expected.presentCount ? (expected.counts.get(value) ?? 0) / expected.presentCount : 0
        return baselineShare >= thresholds.droppedCategoryShare && !actual.counts.has(value)
      })
      if (dropped.length > 0) {
        violations.push(violation(
          'semantics', 'dropped-category', expected.name,
          `${plural(dropped.length, 'value')} that were common in the baseline are entirely absent from "${expected.name}" — ${quote(dropped.slice(0, 4))}. A whole slice of the data may be missing rather than the values simply being rarer.`,
          `each was ≥ ${pct(thresholds.droppedCategoryShare)} of baseline rows`,
        ))
      }
    }

    if (expected.type === TYPES.NUMERIC) {
      const shift = unitShift(expected, actual, thresholds.unitShiftTolerance)
      if (shift) {
        violations.push(violation(
          'semantics', 'unit-shift', expected.name,
          `The values in "${expected.name}" are almost exactly ${factorText(shift.factor)} ${shift.direction} than the baseline's, which is the signature of a unit change (${shift.note}) rather than a change in the underlying reality.`,
          `median ${num(expected.median)} → ${num(actual.median)}`,
        ))
      }
    }
  }

  return violations
}

// A scale change counts as a unit shift only when it lands within tolerance of a
// known conversion factor. An arbitrary multiple is deliberately NOT matched
// here — it belongs to the distribution layer.
function unitShift(expected, actual, tolerance) {
  const base = expected.median !== 0 ? expected.median : expected.mean
  const cand = expected.median !== 0 ? actual.median : actual.mean
  if (!base || !cand || !Number.isFinite(base) || !Number.isFinite(cand)) return null
  if (Math.sign(base) !== Math.sign(cand)) return null

  const ratio = Math.abs(cand / base)
  for (const { factor, note } of UNIT_FACTORS) {
    if (Math.abs(ratio / factor - 1) <= tolerance) return { factor, note, direction: 'larger' }
    if (Math.abs(ratio * factor - 1) <= tolerance) return { factor, note, direction: 'smaller' }
  }
  return null
}

// --- layer 3: freshness -----------------------------------------------------
function checkFreshness(contract, candidate, thresholds, now) {
  if (!contract.dateColumn) {
    return { skipped: 'The baseline has no date or timestamp column, so there is no cadence to measure freshness against.', violations: [] }
  }
  const expected = contract.byName.get(contract.dateColumn)
  const actual = candidate.byName.get(contract.dateColumn)
  if (!actual || actual.type !== TYPES.DATE || actual.newest === null) {
    return { skipped: `The new file has no usable "${contract.dateColumn}" values, so freshness can't be measured — see the schema layer.`, violations: [] }
  }
  if (!contract.cadenceMs) {
    return { skipped: `The baseline's "${contract.dateColumn}" has only one distinct timestamp, so it implies no update cadence.`, violations: [] }
  }

  const violations = []
  const allowedMs = contract.cadenceMs * thresholds.freshnessCadenceMultiple
  const ageMs = now - actual.newest
  const cadence = describeCadence(contract.cadenceMs)

  if (ageMs > allowedMs) {
    violations.push(violation(
      'freshness', 'stale', contract.dateColumn,
      `The newest row in the new file is dated ${formatDate(actual.newest)}, which is ${humanDuration(ageMs)} old. The baseline updates ${cadence}, so anything older than ${humanDuration(allowedMs)} means the feed has stopped arriving.`,
      `newest ${formatDate(actual.newest)} · allowance ${thresholds.freshnessCadenceMultiple}× ${cadence}`,
    ))
  }

  if (expected.newest !== null && actual.newest < expected.newest) {
    violations.push(violation(
      'freshness', 'went-backwards', contract.dateColumn,
      `The new file's newest row (${formatDate(actual.newest)}) is older than the baseline file's newest row (${formatDate(expected.newest)}). The new file is not a later snapshot — it may be a re-run of an old extract.`,
      `${formatDate(actual.newest)} < ${formatDate(expected.newest)}`,
    ))
  }

  return { skipped: null, violations }
}

function humanDuration(ms) {
  const units = [
    { ms: 86_400_000, one: 'day', many: 'days' },
    { ms: 3_600_000, one: 'hour', many: 'hours' },
    { ms: 60_000, one: 'minute', many: 'minutes' },
  ]
  for (const unit of units) {
    if (ms >= unit.ms) {
      const n = Math.round(ms / unit.ms)
      return `${n} ${n === 1 ? unit.one : unit.many}`
    }
  }
  return 'less than a minute'
}

// --- layer 4: distribution --------------------------------------------------
function checkDistribution(contract, candidate, comparable, thresholds) {
  if (candidate.rowCount < MIN_CANDIDATE_ROWS_FOR_STATS) {
    return {
      skipped: `The new file has only ${plural(candidate.rowCount, 'row')} — too few for a mean, a range or a null rate to describe anything. Distribution is not being judged.`,
      violations: [],
    }
  }

  const violations = []

  const change = contract.rowCount === 0 ? 0 : (candidate.rowCount - contract.rowCount) / contract.rowCount
  if (Math.abs(change) > thresholds.rowCountChangeShare) {
    violations.push(violation(
      'distribution', 'row-count', null,
      `The new file has ${candidate.rowCount.toLocaleString('en-US')} rows against the baseline's ${contract.rowCount.toLocaleString('en-US')} — ${pct(Math.abs(change))} ${change > 0 ? 'more' : 'fewer'}. A jump that size usually means a partial load or a duplicated one, not a real change in volume.`,
      `${contract.rowCount} → ${candidate.rowCount} rows`,
    ))
  }

  for (const { expected, actual } of comparable) {
    if (expected.type === TYPES.NUMERIC) {
      const shift = centralShift(expected, actual)
      if (shift && shift.factor > thresholds.centralShiftFactor) {
        violations.push(violation(
          'distribution', 'central-shift', expected.name,
          `The typical value in "${expected.name}" is ${factorText(shift.factor)} ${shift.direction} than the baseline's: the median moved from ${num(expected.median)} to ${num(actual.median)} and the mean from ${num(expected.mean)} to ${num(actual.mean)}. The column still parses as a number and still passes every check above it — but it is not measuring what it was.`,
          `median ${num(expected.median)} → ${num(actual.median)} (${factorText(shift.factor)})`,
        ))
      }

      const escape = rangeEscape(expected, actual, thresholds.rangeMarginFactor)
      if (escape && escape.share > thresholds.outOfRangeShare) {
        violations.push(violation(
          'distribution', 'out-of-range', expected.name,
          `${pct(escape.share)} of the values in "${expected.name}" sit outside anything the baseline ever contained (baseline ran ${num(expected.min)} to ${num(expected.max)}; the new file reaches ${num(actual.min)} to ${num(actual.max)}).`,
          `${escape.count} of ${actual.values.length} values beyond [${num(escape.low)}, ${num(escape.high)}]`,
        ))
      }
    }

    const nullJump = actual.nullRate - expected.nullRate
    if (nullJump > thresholds.nullRateJumpPoints) {
      violations.push(violation(
        'distribution', 'null-rate', expected.name,
        `"${expected.name}" is blank in ${pct(actual.nullRate)} of rows in the new file, up from ${pct(expected.nullRate)} in the baseline. Something upstream has stopped populating it for part of the data.`,
        `null rate ${pct(expected.nullRate)} → ${pct(actual.nullRate)}`,
      ))
    }
  }

  return { skipped: null, violations }
}

function centralShift(expected, actual) {
  const useMedian = expected.median !== 0 && actual.median !== 0
  const base = useMedian ? expected.median : expected.mean
  const cand = useMedian ? actual.median : actual.mean
  if (!base || !cand || !Number.isFinite(base) || !Number.isFinite(cand)) return null
  const ratio = Math.abs(cand) / Math.abs(base)
  if (!Number.isFinite(ratio) || ratio === 0) return null
  return ratio >= 1
    ? { factor: ratio, direction: 'larger' }
    : { factor: 1 / ratio, direction: 'smaller' }
}

function rangeEscape(expected, actual, marginFactor) {
  if (expected.min === null || expected.max === null || !actual.values?.length) return null
  const span = expected.max - expected.min
  // A baseline column with no spread (every row the same value) has no span to
  // widen, so the margin falls back to the value's own magnitude — otherwise the
  // allowed band would be a single point and every candidate row would "escape".
  const margin = (span > 0 ? span : Math.abs(expected.max) || 1) * marginFactor
  const low = expected.min - margin
  const high = expected.max + margin
  const count = actual.values.filter((value) => value < low || value > high).length
  return { share: count / actual.values.length, count, low, high }
}

// --- assembly ---------------------------------------------------------------
function insufficient(reason, thresholds, now) {
  return {
    status: 'INSUFFICIENT',
    headline: {
      layer: null,
      layerLabel: null,
      text: 'Not enough data to validate',
      detail: reason,
      passedAbove: [],
    },
    layers: LAYERS.map((layer) => ({ ...layer, status: 'SKIPPED', note: reason, violations: [] })),
    violations: [],
    thresholds,
    summary: null,
    candidate: null,
    checkedAt: now,
  }
}

// Two different checks can fail, and they are not the same claim: a broken rule
// is a stated requirement violated, a layer failure is drift from the baseline.
// Saying "Semantics caught it" when the finding came from an authored rule reads
// as a contradiction next to a Semantics card that passed on drift.
function buildHeadline(layers, hasBaseline) {
  const all = layers.flatMap((layer) => layer.violations)
  const ruleFailures = all.filter((violation) => violation.source === 'rule')
  const driftFailures = all.filter((violation) => violation.source !== 'rule')

  if (ruleFailures.length > 0) {
    const count = `${ruleFailures.length} rule${ruleFailures.length === 1 ? '' : 's'} you set ${ruleFailures.length === 1 ? 'was' : 'were'} broken`
    // Only claim the file matches the baseline when there was one to match.
    const tail = !hasBaseline
      ? ''
      : driftFailures.length > 0
        ? ', and the file drifted from the baseline as well'
        : ' — the file matches the baseline, but not your requirements'
    return {
      layer: null,
      layerLabel: null,
      source: 'rule',
      text: `${count}${tail}`,
      detail: ruleFailures[0].message,
      passedAbove: [],
    }
  }

  const firstFailure = layers.find((layer) => layer.status === 'FAIL')
  if (!firstFailure) {
    const skippedLabels = layers.filter((l) => l.status === 'SKIPPED').map((l) => l.label)
    return {
      layer: null,
      layerLabel: null,
      text: skippedLabels.length
        ? `Every layer that could run passed — ${skippedLabels.join(' and ')} could not be judged`
        : 'All four layers pass',
      detail: skippedLabels.length
        ? 'Nothing in the new file contradicts the contract the baseline implies, but the skipped layers below were not able to check their part.'
        : 'The new file matches everything the baseline file implies: same columns and types, same value meanings, current enough, and the numbers are in the shape they were.',
      passedAbove: layers.filter((l) => l.status === 'PASS').map((l) => l.label),
    }
  }

  const above = layers.slice(0, layers.indexOf(firstFailure))
  const passedAbove = above.filter((layer) => layer.status === 'PASS').map((layer) => layer.label)
  const lead = firstFailure.violations[0]

  const text = passedAbove.length === 0
    ? `${firstFailure.label} caught it — the first gate the file had to pass`
    : `${firstFailure.label} caught what ${joinLabels(passedAbove)} let through`

  return {
    layer: firstFailure.id,
    layerLabel: firstFailure.label,
    source: 'baseline',
    text,
    detail: lead ? lead.message : '',
    passedAbove,
  }
}

function joinLabels(labels) {
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

// validate(contract, candidateRows) -> a per-layer report.
//
// Options: { thresholds, now } — `now` is injectable so freshness is testable
// and so a caller can ask "was this fresh as of X?".
export function validate(rawContract, candidateRows, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) }
  const now = options.now ?? Date.now()

  // Normalising here is the whole of the engine's authoring support: whatever
  // produced the contract — inference, a person, a saved record — it arrives as
  // the same object with two halves, a baseline profile and authored rules.
  const contract = normalizeContract(rawContract)

  if (!contract) return insufficient('No baseline has been loaded yet, so there is no contract to validate against.', thresholds, now)
  if (!contract.sufficient) {
    return insufficient(
      `A contract can't be inferred: ${contract.insufficientReason}. Load a larger baseline.`,
      thresholds, now,
    )
  }

  const rows = Array.isArray(candidateRows) ? candidateRows : []
  if (rows.length === 0) {
    return insufficient('The new file has no data rows, so there is nothing to check against the contract.', thresholds, now)
  }

  const names = columnNames(rows)
  const profiles = names.map((name) => profileColumn(name, rows.map((row) => row[name])))
  const candidate = {
    rowCount: rows.length,
    columns: profiles,
    columnNames: names,
    byName: new Map(profiles.map((profile) => [profile.name, profile])),
  }

  // Only columns present on both sides WITH the same type can be compared below
  // the schema layer: comparing a number against a string would produce
  // nonsense statistics, and the schema layer has already reported the reason.
  const comparable = contract.columns
    .map((expected) => ({ expected, actual: candidate.byName.get(expected.name) }))
    .filter(({ expected, actual }) => actual && actual.type === expected.type && expected.type !== TYPES.EMPTY)

  // The baseline halves of the four checks only run when the contract carries a
  // baseline profile. A rules-only contract has nothing to compare against, and
  // running them anyway would report every column in the file as "extra".
  const drift = contract.hasBaseline
    ? {
        schema: { violations: checkSchema(contract, candidate), skipped: null },
        semantics: { violations: checkSemantics(contract, candidate, comparable, thresholds), skipped: null },
        freshness: checkFreshness(contract, candidate, thresholds, now),
        distribution: checkDistribution(contract, candidate, comparable, thresholds),
      }
    : {
        schema: { violations: [], skipped: null },
        semantics: { violations: [], skipped: null },
        freshness: { violations: [], skipped: 'This contract sets out rules rather than a baseline to compare against, so there is no cadence to measure freshness by.' },
        distribution: { violations: [], skipped: null },
      }

  const ruleOutcomes = checkRules(contract.rules, rows)
  const ruleViolations = ruleOutcomes.map((outcome) => outcome.violation).filter(Boolean)

  const layers = LAYERS.map((layer) => {
    const result = drift[layer.id]
    const fromRules = ruleViolations.filter((violation) => violation.layer === layer.id)
    const violations = [...fromRules, ...result.violations]
    // A rule is a stated requirement, so a broken one is a failure even on a
    // layer that was otherwise skipped for want of a baseline.
    const skipped = result.skipped && violations.length === 0 ? result.skipped : null
    const status = skipped ? 'SKIPPED' : violations.length > 0 ? 'FAIL' : 'PASS'
    return { ...layer, status, note: skipped, violations }
  })

  const violations = layers.flatMap((layer) => layer.violations)

  return {
    status: violations.length > 0 ? 'FAIL' : 'PASS',
    headline: buildHeadline(layers, contract.hasBaseline),
    layers,
    violations,
    // The same findings split by what kind of claim they make, so a caller can
    // report "rules you set" and "differences from the baseline" separately
    // without re-deriving the split from violation codes.
    rules: ruleOutcomes,
    ruleViolations,
    baselineViolations: violations.filter((v) => v.source !== 'rule'),
    thresholds,
    summary: {
      baselineRows: contract.rowCount,
      candidateRows: candidate.rowCount,
      comparedColumns: comparable.length,
      rulesChecked: contract.rules.length,
      hasBaseline: contract.hasBaseline,
      dateColumn: contract.dateColumn,
      cadence: contract.cadenceMs ? describeCadence(contract.cadenceMs) : null,
    },
    candidate,
    checkedAt: now,
  }
}

export { isBlank }
