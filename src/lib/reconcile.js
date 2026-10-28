// Migration reconciliation. Pure: no DOM, no React, no file handling.
//
// validate() asks "has this feed drifted from the file I trust?" by comparing
// PROFILES. A migration asks a different question — did every record that
// should have moved arrive, and does it still say the same thing after mapping?
// — and that can only be answered by matching RECORDS, by business key, across
// two systems that name the same thing differently. See docs/v2-spec.md.
//
// The checks run as a descent, like the four layers, because each one is
// meaningless if the one above it broke:
//
//   keys → completeness → mapping → accuracy → totals
//
// A step that isn't configured is SKIPPED, never PASS.

import { isBlank, parseDate, parseNumber } from './contract.js'
import { conditionHolds } from './rules.js'

export const RECON_STEPS = [
  { id: 'keys', label: 'Keys', question: 'Is every record identifiable, exactly once, on both sides?' },
  { id: 'completeness', label: 'Completeness', question: 'Did every in-scope source record arrive — and nothing else?' },
  { id: 'mapping', label: 'Mapping', question: 'Does every legacy value have a target value defined?' },
  { id: 'accuracy', label: 'Accuracy', question: 'For records that arrived, do the mapped fields agree?' },
  { id: 'totals', label: 'Totals', question: 'Do the control totals still tie out?' },
]

export const DEFAULT_RECON_THRESHOLDS = {
  // Shares of in-scope records allowed to be missing / unexpected / mismatched
  // before a step fails. Migrations default to zero: an explained exclusion
  // belongs in `scope`, where it is counted and visible, not in a tolerance.
  missingShare: 0,
  extraShare: 0,
  mismatchShare: 0,
  // Absolute difference a control total may carry — half a cent absorbs
  // rounding between systems that store money at different precisions.
  totalsTolerance: 0.005,
}

// How many example records each finding carries by default. Enough to start
// an investigation from a CLI summary. The workspace asks for more
// (`exampleLimit`) so a data owner can drill into the records themselves.
const EXAMPLES = 5
const KEY_SEP = '\u0001'

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`
// A real miss must never print as 0%: one record in a million is still one
// record someone has to account for at sign-off.
const pct = (share) => {
  if (share > 0 && share < 0.0001) return '<0.01%'
  return `${(share * 100).toFixed(share > 0 && share < 0.001 ? 2 : 1)}%`
}
const money = (value) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const quote = (value) => (isBlank(value) ? '(blank)' : `"${String(value).trim()}"`)

// --- spec normalisation -----------------------------------------------------
// A spec arrives from JSON a person wrote, so every shorthand a person would
// reasonably write is accepted: key "id", key ["a","b"], key {source,target}.

function asList(value) {
  if (value === null || value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean)
}

function pairOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = asList(value.source)
    const target = asList(value.target ?? value.source)
    return { source, target }
  }
  const both = asList(value)
  return { source: both, target: both }
}

export function normalizeSpec(raw) {
  const spec = raw ?? {}
  const mapping = (Array.isArray(spec.mapping) ? spec.mapping : []).map((field) => {
    const source = String(field?.source ?? '').trim()
    const target = String(field?.target ?? field?.source ?? '').trim()
    const map = field?.map && typeof field.map === 'object' ? trimMap(field.map) : null
    return {
      source,
      target,
      map,
      tolerance: Number.isFinite(Number(field?.tolerance)) ? Math.abs(Number(field.tolerance)) : 0,
      ignoreCase: field?.ignoreCase === true,
    }
  })
  const totals = (Array.isArray(spec.totals) ? spec.totals : []).map((total) => ({
    source: String(total?.source ?? '').trim(),
    target: String(total?.target ?? total?.source ?? '').trim(),
    groupBy: total?.groupBy
      ? {
          source: String(total.groupBy.source ?? '').trim(),
          target: String(total.groupBy.target ?? total.groupBy.source ?? '').trim(),
          map: total.groupBy.map && typeof total.groupBy.map === 'object' ? trimMap(total.groupBy.map) : null,
        }
      : null,
  }))
  return {
    name: String(spec.name ?? '').trim() || null,
    key: pairOf(spec.key),
    scope: { source: spec.scope?.source ?? null, target: spec.scope?.target ?? null },
    mapping,
    totals,
  }
}

// Accepts a plain object (a spec as written) or a Map (a spec already
// normalised), so normalising twice changes nothing. It did once: a Map read
// as a plain object has no entries, and every crosswalk silently emptied —
// every legacy value reported as unmapped.
function trimMap(map) {
  const out = new Map()
  const entries = map instanceof Map ? map.entries() : Object.entries(map)
  for (const [from, to] of entries) out.set(String(from).trim(), to)
  return out
}

// specIssues(spec, sourceColumns, targetColumns) -> [sentence]
//
// Every reason the spec cannot be run as written, in plain language. A spec
// that names a column the file doesn't have is reported, never half-run: a
// reconciliation that quietly checks less than it claims is the exact failure
// this tool exists to catch.
export function specIssues(rawSpec, sourceColumns, targetColumns) {
  const spec = rawSpec?.key && Array.isArray(rawSpec.key.source) ? rawSpec : normalizeSpec(rawSpec)
  const issues = []
  const src = new Set(sourceColumns)
  const tgt = new Set(targetColumns)
  const needSource = (column, role) => {
    if (!src.has(column)) issues.push(`The source file has no column "${column}" (named as ${role}).`)
  }
  const needTarget = (column, role) => {
    if (!tgt.has(column)) issues.push(`The target file has no column "${column}" (named as ${role}).`)
  }

  if (spec.key.source.length === 0 || spec.key.target.length === 0) {
    issues.push('No key is set. Name the column (or columns) that identify a record on each side.')
  } else if (spec.key.source.length !== spec.key.target.length) {
    issues.push(
      `The key has ${spec.key.source.length} source column(s) but ${spec.key.target.length} target column(s); they must pair up one to one.`,
    )
  }
  spec.key.source.forEach((column) => needSource(column, 'a key'))
  spec.key.target.forEach((column) => needTarget(column, 'a key'))

  if (spec.scope.source?.column) needSource(spec.scope.source.column, 'the scope condition')
  if (spec.scope.target?.column) needTarget(spec.scope.target.column, 'the scope condition')

  spec.mapping.forEach((field, i) => {
    if (!field.source || !field.target) {
      issues.push(`Mapping ${i + 1} needs both a source and a target column.`)
      return
    }
    needSource(field.source, `mapping ${i + 1}`)
    needTarget(field.target, `mapping ${i + 1}`)
  })

  spec.totals.forEach((total, i) => {
    if (!total.source || !total.target) {
      issues.push(`Control total ${i + 1} needs both a source and a target column.`)
      return
    }
    needSource(total.source, `control total ${i + 1}`)
    needTarget(total.target, `control total ${i + 1}`)
    if (total.groupBy) {
      needSource(total.groupBy.source, `the grouping of control total ${i + 1}`)
      needTarget(total.groupBy.target, `the grouping of control total ${i + 1}`)
    }
  })

  return issues
}

// --- keys -------------------------------------------------------------------

function keyOf(row, columns) {
  const parts = []
  for (const column of columns) {
    const value = row[column]
    if (isBlank(value)) return null
    parts.push(String(value).trim())
  }
  return parts.join(KEY_SEP)
}

const showKey = (key) => key.split(KEY_SEP).join(' / ')

// Keeps the `limit` entries with the smallest row number. Partitions of a large
// file are joined in no particular order, so "the first five examples" has to
// mean first in the FILE — which is also what makes a partitioned run report
// exactly what an in-memory run reports.
function keepFirst(list, entry, limit) {
  if (list.length >= limit && entry.rowNo >= list[list.length - 1].rowNo) return
  let i = list.length
  while (i > 0 && list[i - 1].rowNo > entry.rowNo) i -= 1
  list.splice(i, 0, entry)
  if (list.length > limit) list.pop()
}

// --- value comparison -------------------------------------------------------
// Both sides are coerced TOGETHER, the same way v1 rules are: numbers as
// numbers, dates as dates, else trimmed text. "1,200.00" and "1200" agree;
// "2024-03-01" and "2024-03-01T00:00:00Z" agree; "10" and "9" never compare as
// strings.

function valuesAgree(sourceValue, targetValue, field) {
  const sourceBlank = isBlank(sourceValue)
  const targetBlank = isBlank(targetValue)
  if (sourceBlank || targetBlank) return sourceBlank && targetBlank

  const a = parseNumber(sourceValue)
  const b = parseNumber(targetValue)
  if (a !== null && b !== null) {
    // A relative epsilon so that floating-point noise in a large number is not
    // a mismatch even when the author asked for an exact match.
    const epsilon = Math.max(Math.abs(a), Math.abs(b)) * 1e-12
    return Math.abs(a - b) <= field.tolerance + epsilon
  }

  const da = parseDate(sourceValue)
  const db = parseDate(targetValue)
  if (da !== null && db !== null) return da === db

  const sa = String(sourceValue).trim()
  const sb = String(targetValue).trim()
  return field.ignoreCase ? sa.toLowerCase() === sb.toLowerCase() : sa === sb
}

// Apply a crosswalk to a source value. Returns { value } or { unmapped: true }.
// A blank is not translated — blank legacy data is the accuracy step's to
// judge, not a missing crosswalk row.
function translate(value, map) {
  if (!map || isBlank(value)) return { value }
  const key = String(value).trim()
  if (!map.has(key)) return { unmapped: true }
  return { value: map.get(key) }
}

// --- accumulation -----------------------------------------------------------
// Everything a report needs, gathered as rows and partitions go by. Each field
// is a count, a sum or a short sorted list, so the state stays small however
// large the files are.

function step(id, status, findings, detail = {}) {
  const meta = RECON_STEPS.find((s) => s.id === id)
  return { id, label: meta.label, question: meta.question, status, findings, ...detail }
}

function finding(stepId, code, column, message, examples = []) {
  return { step: stepId, code, column, message, examples }
}

function newSide(spec) {
  return {
    rows: 0,
    outOfScope: 0,
    blankKeys: 0,
    uniqueKeys: 0,
    duplicateKeys: 0,
    duplicateRows: 0,
    duplicateExamples: [],
    totals: spec.totals.map(() => ({ groups: new Map(), unreadable: 0 })),
  }
}

// Control totals run over every in-scope record — blank and duplicated keys
// included — because they answer for the whole population, not for the
// records that happened to match.
function addToTotals(side, spec, sideName, row) {
  spec.totals.forEach((total, i) => {
    const acc = side.totals[i]
    const group = total.groupBy?.[sideName]
    const map = sideName === 'source' ? total.groupBy?.map : null
    let label = '(all records)'
    if (group) {
      const raw = row[group]
      const translated = translate(raw, map)
      label = isBlank(raw) ? '(blank)' : translated.unmapped ? String(raw).trim() : String(translated.value).trim()
    }
    const entry = acc.groups.get(label) ?? { sum: 0, count: 0 }
    const value = parseNumber(row[total[sideName]])
    if (value !== null) entry.sum += value
    else if (!isBlank(row[total[sideName]])) acc.unreadable += 1
    entry.count += 1
    acc.groups.set(label, entry)
  })
}

// One side of one partition, indexed by key. A key that appears more than once
// is set aside rather than guessed at: matching it would mean choosing which of
// two records is "the" one, and a reconciliation that guesses is worth nothing
// at sign-off. A key's every copy lands in the same partition, so duplicates
// found per partition are exactly the duplicates in the file.
function indexPartition(entries, side, limit) {
  const byKey = new Map()
  for (const entry of entries) {
    const hit = byKey.get(entry.key)
    if (hit) hit.count += 1
    else byKey.set(entry.key, { row: entry.row, rowNo: entry.rowNo, count: 1 })
  }
  const unique = new Map()
  const duplicated = new Set()
  for (const [key, hit] of byKey) {
    if (hit.count > 1) {
      duplicated.add(key)
      side.duplicateKeys += 1
      side.duplicateRows += hit.count
      keepFirst(side.duplicateExamples, { rowNo: hit.rowNo, key, count: hit.count }, limit)
    } else {
      unique.set(key, hit)
    }
  }
  side.uniqueKeys += unique.size
  return { unique, duplicated }
}

// createReconciliation(spec, { thresholds, sourceColumns, targetColumns })
//   -> { issues, spec, columnsNeeded, observe, joinPartition, finish }
//
// The form that scales: reconcile() below is this run as a single partition.
//
//   1. observe('source' | 'target', row) for every row of each file. It applies
//      the scope, adds to control totals, counts blank keys, and returns the
//      record's key — or null when the record is out of scope or has no key.
//   2. joinPartition(sourceEntries, targetEntries) for each partition, where an
//      entry is { key, row, rowNo } and every record sharing a key is in the
//      same partition. A caller with files too large to hold splits records by
//      a hash of their key and joins one partition at a time.
//   3. finish() -> the report.
//
// A row in an entry needs only the columns in columnsNeeded — the key and the
// mapped fields — which is what a caller writes to disk between steps 1 and 2.
export function createReconciliation(rawSpec, options = {}) {
  const thresholds = { ...DEFAULT_RECON_THRESHOLDS, ...(options.thresholds ?? {}) }
  const limit = Number.isInteger(options.exampleLimit) && options.exampleLimit > 0 ? options.exampleLimit : EXAMPLES
  const spec = normalizeSpec(rawSpec)
  const issues = specIssues(spec, options.sourceColumns ?? [], options.targetColumns ?? [])
  const sides = { source: newSide(spec), target: newSide(spec) }
  const join = { expected: 0, matched: 0, missing: 0, extra: 0, rowsWithDifference: 0, rowsUnverified: 0, missingExamples: [], extraExamples: [] }
  const fieldStats = spec.mapping.map((field) => ({
    source: field.source,
    target: field.target,
    compared: 0,
    agreed: 0,
    mismatched: 0,
    unmapped: 0,
    unmappedValues: new Map(),
    examples: [],
  }))

  const columnsNeeded = {
    source: [...new Set([...spec.key.source, ...spec.mapping.map((f) => f.source)])],
    target: [...new Set([...spec.key.target, ...spec.mapping.map((f) => f.target)])],
  }

  function observe(sideName, row) {
    if (issues.length > 0) return null
    const side = sides[sideName]
    side.rows += 1
    const scope = spec.scope[sideName]
    if (scope && !conditionHolds(scope, row)) {
      side.outOfScope += 1
      return null
    }
    addToTotals(side, spec, sideName, row)
    const key = keyOf(row, spec.key[sideName])
    if (key === null) side.blankKeys += 1
    return key
  }

  function joinPartition(sourceEntries, targetEntries) {
    if (issues.length > 0) return
    const source = indexPartition(sourceEntries, sides.source, limit)
    const target = indexPartition(targetEntries, sides.target, limit)

    for (const [key, s] of source.unique) {
      join.expected += 1
      const t = target.unique.get(key)
      if (!t) {
        // A key duplicated in the target DID arrive — too many times, which the
        // keys step reports. Calling it missing as well would count one fault twice.
        if (!target.duplicated.has(key)) {
          join.missing += 1
          keepFirst(join.missingExamples, { rowNo: s.rowNo, key }, limit)
        }
        continue
      }
      join.matched += 1
      let differs = false
      let unverified = false
      spec.mapping.forEach((field, i) => {
        const stats = fieldStats[i]
        const translated = translate(s.row[field.source], field.map)
        if (translated.unmapped) {
          unverified = true
          stats.unmapped += 1
          const legacy = String(s.row[field.source]).trim()
          const seen = stats.unmappedValues.get(legacy)
          if (seen) {
            seen.count += 1
            seen.firstRow = Math.min(seen.firstRow, s.rowNo)
          } else {
            stats.unmappedValues.set(legacy, { count: 1, firstRow: s.rowNo })
          }
          return
        }
        stats.compared += 1
        if (valuesAgree(translated.value, t.row[field.target], field)) {
          stats.agreed += 1
        } else {
          stats.mismatched += 1
          differs = true
          keepFirst(stats.examples, {
            rowNo: s.rowNo,
            key: showKey(key),
            source: s.row[field.source],
            expected: translated.value,
            target: t.row[field.target],
          }, limit)
        }
      })
      // A record with a field that could not be compared — its legacy value has
      // no crosswalk entry — is NOT fully matched: nothing confirmed that field.
      // Counting it as matched would let an evidence pack attest to a value
      // nobody checked.
      if (differs) join.rowsWithDifference += 1
      else if (unverified) join.rowsUnverified += 1
    }

    for (const [key, t] of target.unique) {
      if (!source.unique.has(key) && !source.duplicated.has(key)) {
        join.extra += 1
        keepFirst(join.extraExamples, { rowNo: t.rowNo, key }, limit)
      }
    }
  }

  function finish() {
    if (issues.length > 0) {
      return {
        status: 'INVALID',
        name: spec.name,
        headline: 'This reconciliation spec cannot run against these files as written.',
        issues,
        steps: RECON_STEPS.map((s) => step(s.id, 'SKIPPED', [], { reason: 'The spec could not run.' })),
        findings: [],
        counts: null,
        fields: [],
        totals: [],
        thresholds,
      }
    }

    const steps = [
      keysStep(sides),
      completenessStep(sides, join, thresholds),
      ...mappingAndAccuracySteps(spec, fieldStats, join, thresholds, limit),
    ]
    const totals = totalsStep(spec, sides, thresholds, limit)
    steps.push(totals.result)

    const counts = {
      sourceRows: sides.source.rows,
      targetRows: sides.target.rows,
      sourceOutOfScope: sides.source.outOfScope,
      targetOutOfScope: sides.target.outOfScope,
      expected: join.expected,
      matched: join.matched,
      missing: join.missing,
      extra: join.extra,
      sourceBlankKeys: sides.source.blankKeys,
      targetBlankKeys: sides.target.blankKeys,
      sourceDuplicateKeys: sides.source.duplicateKeys,
      targetDuplicateKeys: sides.target.duplicateKeys,
      rowsWithDifference: join.rowsWithDifference,
      rowsUnverified: join.rowsUnverified,
      rowsFullyMatched: join.matched - join.rowsWithDifference - join.rowsUnverified,
    }

    return {
      status: steps.some((s) => s.status === 'FAIL') ? 'FAIL' : 'PASS',
      name: spec.name,
      headline: buildHeadline(steps, counts),
      issues: [],
      steps,
      findings: steps.flatMap((s) => s.findings),
      counts,
      fields: fieldStats.map((stats) => ({
        source: stats.source,
        target: stats.target,
        compared: stats.compared,
        agreed: stats.agreed,
        mismatched: stats.mismatched,
        unmapped: stats.unmapped,
        examples: stats.examples.map(({ rowNo: _rowNo, ...example }) => example),
        matchRate: stats.compared ? stats.agreed / stats.compared : null,
      })),
      totals: totals.totals,
      thresholds,
    }
  }

  return { issues, spec, columnsNeeded, observe, joinPartition, finish }
}

// --- the steps --------------------------------------------------------------

function keysStep({ source, target }) {
  const findings = []
  if (source.blankKeys > 0) {
    findings.push(finding('keys', 'blank-key-source', null,
      `${plural(source.blankKeys, 'source record')} ${source.blankKeys === 1 ? 'has' : 'have'} no key, so ${source.blankKeys === 1 ? 'it' : 'they'} cannot be traced into the target.`))
  }
  if (target.blankKeys > 0) {
    findings.push(finding('keys', 'blank-key-target', null,
      `${plural(target.blankKeys, 'target record')} ${target.blankKeys === 1 ? 'has' : 'have'} no key, so ${target.blankKeys === 1 ? 'it' : 'they'} cannot be traced back to the source.`))
  }
  if (source.duplicateKeys > 0) {
    findings.push(finding('keys', 'duplicate-key-source', null,
      `${plural(source.duplicateKeys, 'key')} ${source.duplicateKeys === 1 ? 'appears' : 'appear'} more than once in the source (${plural(source.duplicateRows, 'record')} in all). These are set aside rather than guessed at.`,
      source.duplicateExamples.map((d) => ({ key: showKey(d.key), detail: `${d.count} records`, count: d.count }))))
  }
  if (target.duplicateKeys > 0) {
    findings.push(finding('keys', 'duplicate-key-target', null,
      `${plural(target.duplicateKeys, 'key')} ${target.duplicateKeys === 1 ? 'appears' : 'appear'} more than once in the target (${plural(target.duplicateRows, 'record')} in all) — often a join that fanned out during the load. These are set aside rather than guessed at.`,
      target.duplicateExamples.map((d) => ({ key: showKey(d.key), detail: `${d.count} records`, count: d.count }))))
  }
  return step('keys', findings.length ? 'FAIL' : 'PASS', findings)
}

function completenessStep(sides, join, thresholds) {
  const expected = join.expected
  const missingShare = expected ? join.missing / expected : 0
  const extraShare = sides.target.uniqueKeys ? join.extra / sides.target.uniqueKeys : 0
  const findings = []

  if (join.missing > 0) {
    findings.push(finding('completeness', 'missing-in-target', null,
      `${plural(join.missing, 'source record')} (${pct(missingShare)}) did not arrive in the target.`,
      join.missingExamples.map((m) => ({ key: showKey(m.key) }))))
  }
  if (join.extra > 0) {
    findings.push(finding('completeness', 'extra-in-target', null,
      `${plural(join.extra, 'target record')} (${pct(extraShare)}) ${join.extra === 1 ? 'has' : 'have'} no source record — loaded from somewhere this extract does not cover, or created by the load itself.`,
      join.extraExamples.map((m) => ({ key: showKey(m.key) }))))
  }

  const failed = missingShare > thresholds.missingShare || extraShare > thresholds.extraShare
  const status = expected === 0 && sides.target.uniqueKeys === 0 ? 'SKIPPED' : failed ? 'FAIL' : 'PASS'
  return step('completeness', status, findings, {
    reason: status === 'SKIPPED' ? 'No record on either side could be identified by its key.' : undefined,
  })
}

function mappingAndAccuracySteps(spec, fieldStats, join, thresholds, limit) {
  const mappingFindings = []
  fieldStats.forEach((stats) => {
    if (stats.unmapped === 0) return
    const values = [...stats.unmappedValues].sort((a, b) => b[1].count - a[1].count || a[1].firstRow - b[1].firstRow)
    mappingFindings.push(finding('mapping', 'unmapped-value', stats.target,
      `${plural(values.length, 'legacy value')} in "${stats.source}" ${values.length === 1 ? 'has' : 'have'} no entry in the crosswalk to "${stats.target}", affecting ${plural(stats.unmapped, 'record')}. This is a gap in the mapping specification, not in the load.`,
      values.slice(0, limit).map(([value, seen]) => ({ value, detail: plural(seen.count, 'record'), count: seen.count }))))
  })
  const mapping = spec.mapping.some((field) => field.map)
    ? step('mapping', mappingFindings.length ? 'FAIL' : 'PASS', mappingFindings)
    : step('mapping', 'SKIPPED', [], { reason: 'No field in the spec carries a crosswalk.' })

  const accuracyFindings = []
  fieldStats.forEach((stats) => {
    if (stats.mismatched === 0) return
    const share = stats.compared ? stats.mismatched / stats.compared : 0
    accuracyFindings.push(finding('accuracy', 'field-mismatch', stats.target,
      `"${stats.target}" disagrees with "${stats.source}" on ${plural(stats.mismatched, 'record')} of ${stats.compared.toLocaleString('en-US')} compared (${pct(share)}).`,
      stats.examples.map((ex) => ({
        key: ex.key,
        detail: ex.expected !== ex.source
          ? `source ${quote(ex.source)} → expected ${quote(ex.expected)}, target has ${quote(ex.target)}`
          : `source ${quote(ex.source)}, target ${quote(ex.target)}`,
        // The same three values as fields, for a drill-down table or export.
        source: ex.source,
        expected: ex.expected,
        target: ex.target,
      }))))
  })
  const worstShare = Math.max(0, ...fieldStats.map((s) => (s.compared ? s.mismatched / s.compared : 0)))
  let accuracy
  if (spec.mapping.length === 0) {
    accuracy = step('accuracy', 'SKIPPED', [], { reason: 'The spec maps no fields, so only presence was checked.' })
  } else if (join.matched === 0) {
    accuracy = step('accuracy', 'SKIPPED', [], { reason: 'No record arrived on both sides, so there was nothing to compare.' })
  } else {
    accuracy = step('accuracy', worstShare > thresholds.mismatchShare ? 'FAIL' : 'PASS', accuracyFindings)
  }
  return [mapping, accuracy]
}

function totalsStep(spec, sides, thresholds, limit) {
  if (spec.totals.length === 0) {
    return { result: step('totals', 'SKIPPED', [], { reason: 'The spec sets no control totals.' }), totals: [] }
  }
  const findings = []
  const totals = spec.totals.map((total, i) => {
    const s = sides.source.totals[i]
    const t = sides.target.totals[i]
    const labels = [...new Set([...s.groups.keys(), ...t.groups.keys()])].sort()
    const groups = labels.map((label) => {
      const a = s.groups.get(label) ?? { sum: 0, count: 0 }
      const b = t.groups.get(label) ?? { sum: 0, count: 0 }
      const difference = b.sum - a.sum
      return {
        group: label,
        source: a.sum,
        target: b.sum,
        difference,
        sourceCount: a.count,
        targetCount: b.count,
        ties: Math.abs(difference) <= thresholds.totalsTolerance,
      }
    })
    const broken = groups.filter((g) => !g.ties)
    if (broken.length > 0) {
      const where = total.groupBy ? ` in ${plural(broken.length, 'group')} of ${groups.length} by "${total.groupBy.target}"` : ''
      findings.push(finding('totals', 'total-mismatch', total.target,
        `The total of "${total.target}" does not tie to "${total.source}"${where}.`,
        broken.slice(0, limit).map((g) => ({
          key: g.group,
          detail: `source ${money(g.source)}, target ${money(g.target)}, difference ${g.difference > 0 ? '+' : ''}${money(g.difference)}`,
          source: g.source,
          target: g.target,
          difference: g.difference,
        }))))
    }
    const unreadable = s.unreadable + t.unreadable
    if (unreadable > 0) {
      findings.push(finding('totals', 'unreadable-amount', total.target,
        `${plural(unreadable, 'value')} in "${total.source}" / "${total.target}" could not be read as a number and ${unreadable === 1 ? 'is' : 'are'} left out of the totals.`))
    }
    return { source: total.source, target: total.target, groupBy: total.groupBy?.target ?? null, groups }
  })
  return { result: step('totals', findings.length ? 'FAIL' : 'PASS', findings), totals }
}

// --- headline ---------------------------------------------------------------

function buildHeadline(steps, counts) {
  const failed = steps.filter((s) => s.status === 'FAIL')
    // "Matched one to one", not "arrived": a record loaded twice did arrive, and
  // the keys step has already said so.
  const arrived = `${counts.matched.toLocaleString('en-US')} of ${counts.expected.toLocaleString('en-US')} in-scope records matched one to one`
  if (failed.length === 0) {
    return `Reconciled. ${arrived}, and every check that ran passed.`
  }
  const first = failed[0]
  const above = steps.slice(0, steps.indexOf(first)).filter((s) => s.status === 'PASS').map((s) => s.label)
  const passedText = above.length ? ` ${joinLabels(above)} passed above it.` : ''
  return `Stopped at ${first.label}. ${arrived}.${passedText}`
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

// --- entry point ------------------------------------------------------------

// reconcile(spec, sourceRows, targetRows, { thresholds }) -> report
//
// Both files in memory, as one partition. Never throws on bad input: a spec that
// cannot run returns status INVALID with the reasons, so every caller always
// has a sentence to show.
export function reconcile(rawSpec, sourceRows, targetRows, options = {}) {
  const sourceList = Array.isArray(sourceRows) ? sourceRows : []
  const targetList = Array.isArray(targetRows) ? targetRows : []
  const run = createReconciliation(rawSpec, {
    ...options,
    sourceColumns: options.sourceColumns ?? columnsOf(sourceList),
    targetColumns: options.targetColumns ?? columnsOf(targetList),
  })
  if (run.issues.length > 0) return run.finish()

  const entries = (sideName, rows) => {
    const out = []
    rows.forEach((row, index) => {
      const key = run.observe(sideName, row)
      if (key !== null) out.push({ key, row, rowNo: index + 1 })
    })
    return out
  }
  run.joinPartition(entries('source', sourceList), entries('target', targetList))
  return run.finish()
}

function columnsOf(rows) {
  const seen = new Set()
  for (const row of rows.slice(0, 50)) for (const column of Object.keys(row ?? {})) seen.add(column)
  return [...seen]
}
