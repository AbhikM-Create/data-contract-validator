// Load readiness. Pure: no DOM, no React, no file handling.
//
// Before each mock load, the transformed load file is run against the target's
// contract to predict which records the target system will reject — while there
// is still time to fix them. A rejection found AFTER a load costs a re-extract,
// a re-transform and another load slot; it is the largest single time sink in a
// migration cycle. See docs/v2-spec.md.
//
// This is a view over the same rules validate() enforces, evaluated by the same
// createRuleChecker() that checkRules() runs on, so a rule cannot mean one
// thing here and another there. What it
// adds is the question a load asks: not "which rules broke?" but "which RECORDS
// will be turned away, and which will load with a warning?"

import { isBlank } from './contract.js'
import { createReader, DEFAULT_READER } from './formats.js'
import { createRuleChecker, describeRule, ruleColumns, ruleIssue, ruleSeverity } from './rules.js'

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

// The key a record is identified by, or null when any part of it is blank.
function keyValue(row, keyColumns) {
  if (keyColumns.some((column) => isBlank(row?.[column]))) return null
  return keyColumns.map((column) => String(row[column]).trim()).join(' / ')
}

function normalizeKey(key) {
  return (Array.isArray(key) ? key : key ? [key] : []).map((c) => String(c).trim()).filter(Boolean)
}

// Keys appearing more than once in rows. In memory here; a caller streaming a
// file too large to hold builds the same set by partitioning keys on disk.
export function findDuplicateKeys(rows, key) {
  const keyColumns = normalizeKey(key)
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows) {
    const value = keyValue(row, keyColumns)
    if (value === null) continue
    if (seen.has(value)) duplicates.add(value)
    else seen.add(value)
  }
  return duplicates
}

// createReadinessCheck(contract, { columns, key, duplicateKeys, collectFlagged })
//   -> { issues, keyOf, row, finish }
//
// The record-at-a-time form, so a twenty-million-row load file can be judged in
// bounded memory: feed every row to row(row, rowNumber), then call
// finish(rowCount). checkReadiness() below is this, over an array.
//
// duplicateKeys: the keys that appear more than once in the whole file. A row
// cannot know that its key recurs ninety thousand rows later, so a key check
// needs the set up front. Every copy of a duplicated key is rejected, the first
// included: the target cannot tell which one is meant, and neither can this.
//
// collectFlagged keeps every flagged record in the report — right for a few
// thousand rows, wrong for a stream, where the caller writes them out as row()
// returns them instead.
export function createReadinessCheck(contract, options = {}) {
  const rules = Array.isArray(contract?.rules) ? contract.rules : []
  const skipped = Array.isArray(contract?.skipped) ? contract.skipped : []
  const columns = options.columns ?? []
  const columnSet = new Set(columns)
  const key = normalizeKey(options.key)
  const duplicateKeys = options.duplicateKeys ?? new Set()
  const collectFlagged = options.collectFlagged === true

  const issues = []
  if (rules.length === 0 && skipped.length === 0) {
    issues.push('The contract has no rules, so there is nothing to predict a load against.')
  }
  const missingKey = key.filter((column) => !columnSet.has(column))
  if (missingKey.length > 0) {
    issues.push(`The key names ${quote(missingKey)}, which the load file does not have.`)
  }

  // Sort rules into what can be evaluated and what cannot, BEFORE evaluating:
  // a rule over a missing column would otherwise read every cell as blank and
  // pass without testing anything.
  const unevaluable = []
  const evaluable = []
  const missingColumns = new Set()
  for (const rule of rules) {
    const problem = ruleIssue(rule)
    if (problem) {
      unevaluable.push(unchecked(rule, `it can't be read — ${problem}`))
      continue
    }
    const missing = ruleColumns(rule).filter((column) => !columnSet.has(column))
    if (missing.length > 0) {
      missing.forEach((column) => missingColumns.add(column))
      unevaluable.push(unchecked(rule, `the load file has no column ${quote(missing)}`, missing))
      continue
    }
    evaluable.push(rule)
  }
  for (const entry of skipped) {
    unevaluable.push(unchecked(entry.rule, `the contract file holds it in a form this version can't read — ${entry.reason}`))
  }

  // The load file is read in the format its contract declares — a target
  // template in 1.234,56 notation must not have its amounts read as 1.234.
  const reader = contract?.format ? createReader(contract.format) : DEFAULT_READER
  const checker = createRuleChecker(evaluable, { keepFailures: EXAMPLES, reader })
  const severities = evaluable.map(ruleSeverity)
  const descriptions = evaluable.map(describeRule)
  const keyDescription = `${quote(key)} must identify each record exactly once`
  const keyCheck = { failing: 0, examples: [] }
  const labels = new Map() // example row number -> record label, for examples only
  const flaggedList = []
  let rejected = 0
  let warned = 0

  const labelFor = (row, rowNumber) => {
    if (key.length === 0) return `row ${rowNumber}`
    return keyValue(row, key) ?? `row ${rowNumber}`
  }

  return {
    issues,
    keyOf: (row) => keyValue(row, key),

    // Judges one record; returns { severity, reasons } when it is flagged,
    // null when it would load clean.
    row(row, rowNumber) {
      if (issues.length > 0) return null
      let severity = null
      const reasons = []

      if (key.length > 0) {
        const value = keyValue(row, key)
        if (value === null || duplicateKeys.has(value)) {
          keyCheck.failing += 1
          if (keyCheck.examples.length < EXAMPLES) {
            keyCheck.examples.push({ row: rowNumber, record: labelFor(row, rowNumber), value: value ?? '(blank key)' })
          }
          severity = 'reject'
          reasons.push(keyDescription)
        }
      }

      const before = checker.states.map((state) => state.failures.length)
      for (const index of checker.row(row, rowNumber)) {
        if (severities[index] === 'reject') severity = 'reject'
        else if (severity === null) severity = 'warn'
        reasons.push(descriptions[index])
        // Remember how to name this record only if it became an example.
        if (checker.states[index].failures.length > before[index]) labels.set(rowNumber, labelFor(row, rowNumber))
      }

      if (severity === null) return null
      if (severity === 'reject') rejected += 1
      else warned += 1
      const flag = { row: rowNumber, record: labelFor(row, rowNumber), severity, reasons }
      if (collectFlagged) flaggedList.push(flag)
      return flag
    },

    finish(rowCount) {
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

      const checks = [...unevaluable]
      if (key.length > 0) {
        checks.push({
          kind: 'key',
          description: keyDescription,
          severity: 'reject',
          status: keyCheck.failing > 0 ? 'FAIL' : 'PASS',
          applicable: rowCount,
          failing: keyCheck.failing,
          share: rowCount ? keyCheck.failing / rowCount : 0,
          examples: keyCheck.examples,
          reason: null,
        })
      }
      checker.states.forEach((state, index) => {
        checks.push({
          kind: state.rule.kind,
          rule: state.rule,
          description: descriptions[index],
          severity: severities[index],
          status: state.failing > 0 ? 'FAIL' : 'PASS',
          applicable: state.applicable,
          failing: state.failing,
          share: state.applicable ? state.failing / state.applicable : 0,
          examples: state.failures.map((f) => ({
            row: f.row,
            record: labels.get(f.row) ?? `row ${f.row}`,
            value: f.value === '' ? '(blank)' : f.value,
          })),
          reason: state.applicable === 0 ? 'No record met the rule\u2019s condition, so nothing was tested against it.' : null,
        })
      })

      // Most damaging first: rejections by size, then warnings, then what could
      // not be checked, then what passed.
      const rank = (c) =>
        c.status === 'FAIL' ? (c.severity === 'reject' ? 0 : 1) : c.status === 'UNCHECKED' ? 2 : 3
      checks.sort((a, b) => rank(a) - rank(b) || b.failing - a.failing)

      const counts = { records: rowCount, rejected, warned, clean: rowCount - rejected - warned }
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
    },
  }
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
  const columns = options.columns ?? columnsOf(rowList)
  const key = normalizeKey(options.key)
  const keyUsable = key.length > 0 && key.every((column) => columns.includes(column))
  const check = createReadinessCheck(contract, {
    columns,
    key,
    duplicateKeys: keyUsable ? findDuplicateKeys(rowList, key) : new Set(),
    collectFlagged: true,
  })
  rowList.forEach((row, index) => check.row(row, index + 1))
  return check.finish(rowList.length)
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
