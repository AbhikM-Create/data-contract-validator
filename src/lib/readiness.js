// Load readiness. Pure: no DOM, no React, no file handling.
//
// Before each mock load, the transformed load file is run against the target's
// contract to predict which records the target system will reject — while there
// is still time to fix them. A rejection found AFTER a load costs a re-extract,
// a re-transform and another load slot; it is the largest single time sink in a
// migration cycle. See docs/v2-spec.md.
//
// This is a view over the same rules validate() enforces, evaluated by the same
// checkRules(), so a rule cannot mean one thing here and another there. What it
// adds is the question a load asks: not "which rules broke?" but "which RECORDS
// will be turned away, and which will load with a warning?"

import { isBlank } from './contract.js'
import { checkRules, describeRule, ruleColumns, ruleIssue, ruleSeverity } from './rules.js'

export const READINESS = {
  READY: 'READY',
  NOT_READY: 'NOT_READY',
  // Nothing predicted to fail, but something the contract asks for could not
  // be checked. Calling that READY would be a contract quietly enforcing less
  // than it claims.
  UNVERIFIED: 'UNVERIFIED',
  INVALID: 'INVALID',
}

const EXAMPLES = 5

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`
const pct = (share) => {
  if (share > 0 && share < 0.0001) return '<0.01%'
  return `${(share * 100).toFixed(share > 0 && share < 0.001 ? 2 : 1)}%`
}
const quote = (columns) => columns.map((c) => `"${c}"`).join(', ')

function columnsOf(rows) {
  const seen = new Set()
  for (const row of rows.slice(0, 50)) for (const column of Object.keys(row ?? {})) seen.add(column)
  return [...seen]
}

// The key check a target load performs before any field rule: a record it
// cannot identify, or one it already has, is turned away.
function checkKey(rows, keyColumns) {
  const firstRow = new Map()
  const failures = []
  rows.forEach((row, index) => {
    if (keyColumns.some((column) => isBlank(row[column]))) {
      failures.push({ row: index + 1, value: '(blank key)' })
      return
    }
    const key = keyColumns.map((column) => String(row[column]).trim()).join(' / ')
    if (firstRow.has(key)) {
      const first = firstRow.get(key)
      // Every copy is rejected, the first included: the target cannot tell
      // which one is meant, and neither can this tool.
      if (first.counted === false) {
        failures.push({ row: first.row, value: key })
        first.counted = true
      }
      failures.push({ row: index + 1, value: key })
    } else {
      firstRow.set(key, { row: index + 1, counted: false })
    }
  })
  failures.sort((a, b) => a.row - b.row)
  return failures
}

// checkReadiness(contract, rows, { columns, key }) -> report
//
// contract: { name?, rules, skipped? } — what parseContractFile returns, or any
//           object with a rules array. `skipped` lists rules the contract file
//           held but this version could not read; they make a file UNVERIFIED.
// columns:  the load file's header (from parseCsv). Inferred from rows if absent,
//           but pass it — a column present in the header and blank in every row
//           is still present.
// key:      column(s) identifying a record, e.g. ['employee_id']. Optional; when
//           given, blank and duplicate keys are predicted rejections and every
//           example names its record by key, not just by row number.
export function checkReadiness(contract, rows, options = {}) {
  const rowList = Array.isArray(rows) ? rows : []
  const rules = Array.isArray(contract?.rules) ? contract.rules : []
  const skipped = Array.isArray(contract?.skipped) ? contract.skipped : []
  const columns = options.columns ?? columnsOf(rowList)
  const columnSet = new Set(columns)
  const key = (Array.isArray(options.key) ? options.key : options.key ? [options.key] : [])
    .map((c) => String(c).trim())
    .filter(Boolean)

  const issues = []
  if (rules.length === 0 && skipped.length === 0) {
    issues.push('The contract has no rules, so there is nothing to predict a load against.')
  }
  const missingKey = key.filter((column) => !columnSet.has(column))
  if (missingKey.length > 0) {
    issues.push(`The key names ${quote(missingKey)}, which the load file does not have.`)
  }
  if (issues.length > 0) {
    return {
      status: READINESS.INVALID,
      name: contract?.name ?? null,
      headline: 'This readiness check cannot run as set up.',
      issues,
      counts: null,
      checks: [],
      missingColumns: [],
      flagged: [],
    }
  }

  const label = (rowNumber) => {
    if (key.length === 0) return `row ${rowNumber}`
    const row = rowList[rowNumber - 1]
    if (key.some((column) => isBlank(row?.[column]))) return `row ${rowNumber}`
    return key.map((column) => String(row[column]).trim()).join(' / ')
  }

  // Sort rules into what can be evaluated and what cannot, BEFORE evaluating:
  // a rule over a missing column would otherwise read every cell as blank and
  // pass without testing anything.
  const checks = []
  const evaluable = []
  const missingColumns = new Set()
  for (const rule of rules) {
    const problem = ruleIssue(rule)
    if (problem) {
      checks.push(unchecked(rule, `it can't be read — ${problem}`))
      continue
    }
    const missing = ruleColumns(rule).filter((column) => !columnSet.has(column))
    if (missing.length > 0) {
      missing.forEach((column) => missingColumns.add(column))
      checks.push(unchecked(rule, `the load file has no column ${quote(missing)}`, missing))
      continue
    }
    evaluable.push(rule)
  }
  for (const entry of skipped) {
    checks.push(unchecked(entry.rule, `the contract file holds it in a form this version can't read — ${entry.reason}`))
  }

  // Per-record tally: one record broken by three rules is one rejection.
  const flagged = new Map()
  const flag = (rowNumber, severity, reason) => {
    const entry = flagged.get(rowNumber) ?? { row: rowNumber, record: label(rowNumber), severity: 'warn', reasons: [] }
    if (severity === 'reject') entry.severity = 'reject'
    entry.reasons.push(reason)
    flagged.set(rowNumber, entry)
  }

  if (key.length > 0) {
    const failures = checkKey(rowList, key)
    const description = `${quote(key)} must identify each record exactly once`
    failures.forEach((f) => flag(f.row, 'reject', description))
    checks.push({
      kind: 'key',
      description,
      severity: 'reject',
      status: failures.length > 0 ? 'FAIL' : 'PASS',
      applicable: rowList.length,
      failing: failures.length,
      share: rowList.length ? failures.length / rowList.length : 0,
      examples: failures.slice(0, EXAMPLES).map((f) => ({ row: f.row, record: label(f.row), value: f.value })),
      reason: null,
    })
  }

  for (const outcome of checkRules(evaluable, rowList)) {
    const severity = ruleSeverity(outcome.rule)
    const description = describeRule(outcome.rule)
    outcome.failures.forEach((f) => flag(f.row, severity, description))
    checks.push({
      kind: outcome.rule.kind,
      rule: outcome.rule,
      description,
      severity,
      status: outcome.status,
      applicable: outcome.applicable,
      failing: outcome.failures.length,
      share: outcome.applicable ? outcome.failures.length / outcome.applicable : 0,
      examples: outcome.failures.slice(0, EXAMPLES).map((f) => ({
        row: f.row,
        record: label(f.row),
        value: f.value === '' ? '(blank)' : f.value,
      })),
      reason: outcome.applicable === 0 ? 'No record met the rule’s condition, so nothing was tested against it.' : null,
    })
  }

  // Most damaging first: rejections by size, then warnings, then what could not
  // be checked, then what passed.
  const rank = (c) =>
    c.status === 'FAIL' ? (c.severity === 'reject' ? 0 : 1) : c.status === 'UNCHECKED' ? 2 : 3
  checks.sort((a, b) => rank(a) - rank(b) || b.failing - a.failing)

  const flaggedList = [...flagged.values()].sort((a, b) => a.row - b.row)
  const rejected = flaggedList.filter((f) => f.severity === 'reject').length
  const warned = flaggedList.length - rejected
  const counts = { records: rowList.length, rejected, warned, clean: rowList.length - flaggedList.length }

  const missing = [...missingColumns]
  const missingRequired = checks.some((c) => c.status === 'UNCHECKED' && c.severity === 'reject' && c.missing?.length)
  const uncheckedCount = checks.filter((c) => c.status === 'UNCHECKED').length

  let status
  if (rejected > 0 || missingRequired) status = READINESS.NOT_READY
  else if (uncheckedCount > 0) status = READINESS.UNVERIFIED
  else status = READINESS.READY

  return {
    status,
    name: contract?.name ?? null,
    headline: buildHeadline(status, counts, checks, missing, uncheckedCount),
    issues: [],
    counts,
    checks,
    missingColumns: missing,
    flagged: flaggedList,
  }
}

function unchecked(rule, why, missing = []) {
  return {
    kind: rule?.kind ?? 'unknown',
    rule,
    description: ruleIssue(rule) ? `A rule on ${rule?.column ? `"${rule.column}"` : 'an unnamed column'}` : describeRule(rule),
    severity: ruleSeverity(rule),
    status: 'UNCHECKED',
    applicable: 0,
    failing: 0,
    share: 0,
    examples: [],
    reason: `Not checked because ${why}.`,
    missing,
  }
}

function buildHeadline(status, counts, checks, missing, uncheckedCount) {
  const ran = checks.filter((c) => c.status === 'PASS' || c.status === 'FAIL').length
  const warnText = (other) =>
    counts.warned > 0 ? ` ${plural(counts.warned, other ? 'other record' : 'record')} would load with a warning.` : ''

  if (status === READINESS.READY) {
    return counts.warned > 0
      ? `Ready to load. None of the ${counts.records.toLocaleString('en-US')} records would be rejected by the ${plural(ran, 'check')} that ran.${warnText(false)}`
      : `Ready to load. All ${counts.records.toLocaleString('en-US')} records pass the ${plural(ran, 'check')} that ran.`
  }
  if (status === READINESS.UNVERIFIED) {
    return `No rejections predicted, but ${plural(uncheckedCount, 'rule')} could not be checked, so this file is not confirmed ready.${warnText(false)}`
  }

  const parts = []
  if (counts.rejected > 0) {
    const worst = checks.find((c) => c.status === 'FAIL' && c.severity === 'reject')
    parts.push(
      `${counts.rejected.toLocaleString('en-US')} of ${counts.records.toLocaleString('en-US')} records (${pct(counts.rejected / counts.records)}) would be rejected — most often because ${worst.description} (${plural(worst.failing, 'record')}).`,
    )
  }
  if (missing.length > 0) {
    parts.push(`The load file is missing ${missing.length === 1 ? 'a column' : 'columns'} the contract checks: ${quote(missing)}.`)
  }
  return `Not ready. ${parts.join(' ')}${warnText(counts.rejected > 0)}`
}
