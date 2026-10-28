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

// How many example records each finding carries. Enough to start an
// investigation; the full list belongs in the evidence pack, not the headline.
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

function trimMap(map) {
  const out = new Map()
  for (const [from, to] of Object.entries(map)) out.set(String(from).trim(), to)
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

// --- indexing ---------------------------------------------------------------

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

// Index one side by key. Rows with a blank key, and every row of a key that
// appears more than once, are set aside: matching them would mean guessing
// which of two records is "the" one, and a reconciliation that guesses is
// worth nothing at sign-off.
function indexSide(rows, keyColumns, scope) {
  const byKey = new Map()
  const duplicates = new Map()
  let blankKeys = 0
  let outOfScope = 0
  let inScope = 0
  const inScopeRows = []

  for (const row of rows) {
    if (scope && !conditionHolds(scope, row)) {
      outOfScope += 1
      continue
    }
    inScope += 1
    inScopeRows.push(row)
    const key = keyOf(row, keyColumns)
    if (key === null) {
      blankKeys += 1
      continue
    }
    if (duplicates.has(key)) {
      duplicates.set(key, duplicates.get(key) + 1)
    } else if (byKey.has(key)) {
      byKey.delete(key)
      duplicates.set(key, 2)
    } else {
      byKey.set(key, row)
    }
  }

  let duplicateRows = 0
  for (const count of duplicates.values()) duplicateRows += count

  return { byKey, duplicates, duplicateRows, blankKeys, outOfScope, inScope, inScopeRows }
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

// --- the steps --------------------------------------------------------------

function step(id, status, findings, detail = {}) {
  const meta = RECON_STEPS.find((s) => s.id === id)
  return { id, label: meta.label, question: meta.question, status, findings, ...detail }
}

function finding(stepId, code, column, message, examples = []) {
  return { step: stepId, code, column, message, examples }
}

function checkKeys(source, target) {
  const findings = []
  if (source.blankKeys > 0) {
    findings.push(finding('keys', 'blank-key-source', null,
      `${plural(source.blankKeys, 'source record')} ${source.blankKeys === 1 ? 'has' : 'have'} no key, so ${source.blankKeys === 1 ? 'it' : 'they'} cannot be traced into the target.`))
  }
  if (target.blankKeys > 0) {
    findings.push(finding('keys', 'blank-key-target', null,
      `${plural(target.blankKeys, 'target record')} ${target.blankKeys === 1 ? 'has' : 'have'} no key, so ${target.blankKeys === 1 ? 'it' : 'they'} cannot be traced back to the source.`))
  }
  if (source.duplicates.size > 0) {
    findings.push(finding('keys', 'duplicate-key-source', null,
      `${plural(source.duplicates.size, 'key')} ${source.duplicates.size === 1 ? 'appears' : 'appear'} more than once in the source (${plural(source.duplicateRows, 'record')} in all). These are set aside rather than guessed at.`,
      [...source.duplicates].slice(0, EXAMPLES).map(([key, n]) => ({ key: showKey(key), detail: `${n} records` }))))
  }
  if (target.duplicates.size > 0) {
    findings.push(finding('keys', 'duplicate-key-target', null,
      `${plural(target.duplicates.size, 'key')} ${target.duplicates.size === 1 ? 'appears' : 'appear'} more than once in the target (${plural(target.duplicateRows, 'record')} in all) — often a join that fanned out during the load. These are set aside rather than guessed at.`,
      [...target.duplicates].slice(0, EXAMPLES).map(([key, n]) => ({ key: showKey(key), detail: `${n} records` }))))
  }
  return step('keys', findings.length ? 'FAIL' : 'PASS', findings)
}

function checkCompleteness(source, target, thresholds) {
  const missing = []
  const matched = []
  for (const [key, row] of source.byKey) {
    const other = target.byKey.get(key)
    if (other) matched.push([key, row, other])
    // A key duplicated in the target DID arrive — too many times, which the
    // keys step reports. Calling it missing as well would count one fault twice.
    else if (!target.duplicates.has(key)) missing.push(key)
  }
  const extra = []
  for (const key of target.byKey.keys()) {
    if (!source.byKey.has(key) && !source.duplicates.has(key)) extra.push(key)
  }

  const expected = source.byKey.size
  const missingShare = expected ? missing.length / expected : 0
  const extraShare = target.byKey.size ? extra.length / target.byKey.size : 0
  const findings = []

  if (missing.length > 0) {
    findings.push(finding('completeness', 'missing-in-target', null,
      `${plural(missing.length, 'source record')} (${pct(missingShare)}) did not arrive in the target.`,
      missing.slice(0, EXAMPLES).map((key) => ({ key: showKey(key) }))))
  }
  if (extra.length > 0) {
    findings.push(finding('completeness', 'extra-in-target', null,
      `${plural(extra.length, 'target record')} (${pct(extraShare)}) ${extra.length === 1 ? 'has' : 'have'} no source record — loaded from somewhere this extract does not cover, or created by the load itself.`,
      extra.slice(0, EXAMPLES).map((key) => ({ key: showKey(key) }))))
  }

  const failed = missingShare > thresholds.missingShare || extraShare > thresholds.extraShare
  const status = expected === 0 && target.byKey.size === 0 ? 'SKIPPED' : failed ? 'FAIL' : 'PASS'
  return {
    result: step('completeness', status, findings, {
      reason: status === 'SKIPPED' ? 'No record on either side could be identified by its key.' : undefined,
    }),
    matched,
    missing: missing.length,
    extra: extra.length,
  }
}

function checkMappingAndAccuracy(spec, matched, thresholds) {
  const crosswalked = spec.mapping.filter((field) => field.map)
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
  const rowsWithDifference = new Set()

  for (const [key, sourceRow, targetRow] of matched) {
    spec.mapping.forEach((field, i) => {
      const stats = fieldStats[i]
      const translated = translate(sourceRow[field.source], field.map)
      if (translated.unmapped) {
        stats.unmapped += 1
        const legacy = String(sourceRow[field.source]).trim()
        stats.unmappedValues.set(legacy, (stats.unmappedValues.get(legacy) ?? 0) + 1)
        return
      }
      stats.compared += 1
      if (valuesAgree(translated.value, targetRow[field.target], field)) {
        stats.agreed += 1
      } else {
        stats.mismatched += 1
        rowsWithDifference.add(key)
        if (stats.examples.length < EXAMPLES) {
          stats.examples.push({
            key: showKey(key),
            source: sourceRow[field.source],
            expected: translated.value,
            target: targetRow[field.target],
          })
        }
      }
    })
  }

  // --- mapping step
  const mappingFindings = []
  fieldStats.forEach((stats) => {
    if (stats.unmapped === 0) return
    const values = [...stats.unmappedValues].sort((a, b) => b[1] - a[1])
    mappingFindings.push(finding('mapping', 'unmapped-value', stats.target,
      `${plural(values.length, 'legacy value')} in "${stats.source}" ${values.length === 1 ? 'has' : 'have'} no entry in the crosswalk to "${stats.target}", affecting ${plural(stats.unmapped, 'record')}. This is a gap in the mapping specification, not in the load.`,
      values.slice(0, EXAMPLES).map(([value, n]) => ({ value, detail: plural(n, 'record') }))))
  })
  const mapping = crosswalked.length === 0
    ? step('mapping', 'SKIPPED', [], { reason: 'No field in the spec carries a crosswalk.' })
    : step('mapping', mappingFindings.length ? 'FAIL' : 'PASS', mappingFindings)

  // --- accuracy step
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
      }))))
  })
  const worstShare = Math.max(0, ...fieldStats.map((s) => (s.compared ? s.mismatched / s.compared : 0)))
  let accuracy
  if (spec.mapping.length === 0) {
    accuracy = step('accuracy', 'SKIPPED', [], { reason: 'The spec maps no fields, so only presence was checked.' })
  } else if (matched.length === 0) {
    accuracy = step('accuracy', 'SKIPPED', [], { reason: 'No record arrived on both sides, so there was nothing to compare.' })
  } else {
    accuracy = step('accuracy', worstShare > thresholds.mismatchShare ? 'FAIL' : 'PASS', accuracyFindings)
  }

  const fields = fieldStats.map((stats) => ({
    source: stats.source,
    target: stats.target,
    compared: stats.compared,
    agreed: stats.agreed,
    mismatched: stats.mismatched,
    unmapped: stats.unmapped,
    examples: stats.examples,
    matchRate: stats.compared ? stats.agreed / stats.compared : null,
  }))
  return { mapping, accuracy, fields, rowsWithDifference: rowsWithDifference.size }
}

function sumBy(rows, measure, group, map) {
  const groups = new Map()
  let unreadable = 0
  for (const row of rows) {
    let label = '(all records)'
    if (group) {
      const raw = row[group]
      const translated = translate(raw, map)
      label = isBlank(raw) ? '(blank)' : translated.unmapped ? String(raw).trim() : String(translated.value).trim()
    }
    const entry = groups.get(label) ?? { sum: 0, count: 0 }
    const value = parseNumber(row[measure])
    if (value !== null) entry.sum += value
    else if (!isBlank(row[measure])) unreadable += 1
    entry.count += 1
    groups.set(label, entry)
  }
  return { groups, unreadable }
}

function checkTotals(spec, source, target, thresholds) {
  if (spec.totals.length === 0) {
    return { result: step('totals', 'SKIPPED', [], { reason: 'The spec sets no control totals.' }), totals: [] }
  }
  const findings = []
  const totals = spec.totals.map((total) => {
    const s = sumBy(source.inScopeRows, total.source, total.groupBy?.source, total.groupBy?.map)
    const t = sumBy(target.inScopeRows, total.target, total.groupBy?.target, null)
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
        broken.slice(0, EXAMPLES).map((g) => ({
          key: g.group,
          detail: `source ${money(g.source)}, target ${money(g.target)}, difference ${g.difference > 0 ? '+' : ''}${money(g.difference)}`,
        }))))
    }
    if (s.unreadable + t.unreadable > 0) {
      findings.push(finding('totals', 'unreadable-amount', total.target,
        `${plural(s.unreadable + t.unreadable, 'value')} in "${total.source}" / "${total.target}" could not be read as a number and ${s.unreadable + t.unreadable === 1 ? 'is' : 'are'} left out of the totals.`))
    }
    return { source: total.source, target: total.target, groupBy: total.groupBy?.target ?? null, groups }
  })
  const status = findings.some((f) => f.code === 'total-mismatch' || f.code === 'unreadable-amount') ? 'FAIL' : 'PASS'
  return { result: step('totals', status, findings), totals }
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
// Never throws on bad input: a spec that cannot run returns status INVALID
// with the reasons, so every caller always has a sentence to show.
export function reconcile(rawSpec, sourceRows, targetRows, options = {}) {
  const thresholds = { ...DEFAULT_RECON_THRESHOLDS, ...(options.thresholds ?? {}) }
  const spec = normalizeSpec(rawSpec)
  const sourceList = Array.isArray(sourceRows) ? sourceRows : []
  const targetList = Array.isArray(targetRows) ? targetRows : []
  const sourceColumns = options.sourceColumns ?? columnsOf(sourceList)
  const targetColumns = options.targetColumns ?? columnsOf(targetList)

  const issues = specIssues(spec, sourceColumns, targetColumns)
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

  const source = indexSide(sourceList, spec.key.source, spec.scope.source)
  const target = indexSide(targetList, spec.key.target, spec.scope.target)

  const keys = checkKeys(source, target)
  const completeness = checkCompleteness(source, target, thresholds)
  const { mapping, accuracy, fields, rowsWithDifference } = checkMappingAndAccuracy(spec, completeness.matched, thresholds)
  const totals = checkTotals(spec, source, target, thresholds)

  const steps = [keys, completeness.result, mapping, accuracy, totals.result]
  const counts = {
    sourceRows: sourceList.length,
    targetRows: targetList.length,
    sourceOutOfScope: source.outOfScope,
    targetOutOfScope: target.outOfScope,
    expected: source.byKey.size,
    matched: completeness.matched.length,
    missing: completeness.missing,
    extra: completeness.extra,
    sourceBlankKeys: source.blankKeys,
    targetBlankKeys: target.blankKeys,
    sourceDuplicateKeys: source.duplicates.size,
    targetDuplicateKeys: target.duplicates.size,
    rowsWithDifference,
    rowsFullyMatched: completeness.matched.length - rowsWithDifference,
  }

  return {
    status: steps.some((s) => s.status === 'FAIL') ? 'FAIL' : 'PASS',
    name: spec.name,
    headline: buildHeadline(steps, counts),
    issues: [],
    steps,
    findings: steps.flatMap((s) => s.findings),
    counts,
    fields,
    totals: totals.totals,
    thresholds,
  }
}

function columnsOf(rows) {
  const seen = new Set()
  for (const row of rows.slice(0, 50)) for (const column of Object.keys(row ?? {})) seen.add(column)
  return [...seen]
}
