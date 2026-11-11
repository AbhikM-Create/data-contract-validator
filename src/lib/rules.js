// Authored rules (v2, increment 1). Pure: no DOM, no React, no file handling,
// and no knowledge of how the contract it belongs to was produced.
//
// v1 could only ever say "this differs from the baseline". A rule says what the
// data MUST be — ground truth the file cannot reveal about itself: that "Consumer"
// is not a grade, that a closed record must carry an end date. Inference proposes
// a draft; a human promotes it into a requirement.
//
// A rule is deliberately a structured object, never typed logic:
//   { kind, column, op, target, targetIsColumn?, when? }
//   when: { column, op, target, targetIsColumn? }   — gates the rule to some rows
//
// There is no expression parser, and the absence is the design: every real rule
// collected during scoping turned out to be expressible with these six kinds. A
// future 'expression' kind slots into the same array without touching anything
// that reads it.
//
// v3 adds four kinds (v3-spec §5.1), still built from dropdowns, still closed:
//   identifier  { column, op: 'is', target: 'gstin' }       a named format (identifiers.js)
//   unique      { column, op: 'unique', target: ['month'] }  column(s) identify a record once
//   aggregate   { column, fn: 'sum'|'count', op, target, targetIsColumn?, groupBy?, tolerance? }
//               a total over the file (per group), against a number or another column's total
//   reference   { column, op: 'in', target: { file, column } }  every value exists in a
//               declared reference file
// unique and aggregate look across rows. unique needs its duplicate values found
// before any row is judged (a row cannot know its value recurs later), exactly
// like the record key in readiness; aggregate is totalled as rows pass and judged
// at the end. Both run inside createRuleChecker, the one evaluator.

import { isBlank } from './contract.js'
import { DEFAULT_READER } from './formats.js'
import { IDENTIFIERS, IDENTIFIER_NAMES, isIdentifier } from './identifiers.js'

export const RULE_KINDS = {
  TYPE: 'type',
  NULL_RULE: 'nullRule',
  COMPARISON: 'comparison',
  RANGE: 'range',
  VALUE_SET: 'valueSet',
  CROSS_COLUMN: 'crossColumn',
  IDENTIFIER: 'identifier',
  UNIQUE: 'unique',
  AGGREGATE: 'aggregate',
  REFERENCE: 'reference',
}

export const AGGREGATE_FNS = ['sum', 'count']

export const OPS = ['=', '!=', '>', '<', '>=', '<=', 'between', 'in', 'notNull']

export const RULE_TYPES = ['numeric', 'string', 'date', 'boolean']

// What happens to a record that breaks the rule when it is loaded into the
// target system: rejected outright, or accepted with a warning. Load readiness
// (readiness.js) predicts rejections from this; validate() reads every rule the
// same way, so a contract without severities behaves exactly as before.
export const SEVERITIES = ['reject', 'warn']

export function ruleSeverity(rule) {
  return rule?.severity === 'warn' ? 'warn' : 'reject'
}

// Every column a rule reads — its own, a compared column, and its WHEN
// condition's. A rule over a column the file does not have must be reported as
// unchecked by whoever calls it: evaluated anyway, every cell reads blank and
// the rule "passes" without testing anything.
export function ruleColumns(rule) {
  const columns = [rule?.column]
  if (rule?.targetIsColumn) columns.push(rule.target)
  if (rule?.kind === RULE_KINDS.UNIQUE && Array.isArray(rule.target)) columns.push(...rule.target)
  if (rule?.kind === RULE_KINDS.AGGREGATE && rule.groupBy) columns.push(rule.groupBy)
  // A reference rule's target column is in ANOTHER file; only its own column is
  // this file's.
  if (rule?.when) {
    columns.push(rule.when.column)
    if (rule.when.targetIsColumn) columns.push(rule.when.target)
  }
  return [...new Set(columns.filter((c) => typeof c === 'string' && c.trim() !== ''))]
}

// Which of the four layers each kind reports through. The layers keep their v1
// meaning: structure, meaning, recency, magnitude. A rule may override this with
// an explicit `layer`, which is what lets an authoring UI place an unusual rule
// where its reader would look for it.
export const RULE_LAYER = {
  [RULE_KINDS.TYPE]: 'schema',
  [RULE_KINDS.NULL_RULE]: 'schema',
  [RULE_KINDS.VALUE_SET]: 'semantics',
  [RULE_KINDS.CROSS_COLUMN]: 'semantics',
  [RULE_KINDS.COMPARISON]: 'distribution',
  [RULE_KINDS.RANGE]: 'distribution',
  [RULE_KINDS.IDENTIFIER]: 'schema',
  [RULE_KINDS.UNIQUE]: 'schema',
  [RULE_KINDS.REFERENCE]: 'semantics',
  [RULE_KINDS.AGGREGATE]: 'distribution',
}

const OP_WORDS = {
  '=': 'equal to',
  '!=': 'different from',
  '>': 'greater than',
  '<': 'less than',
  '>=': 'at least',
  '<=': 'at most',
}

export function ruleLayer(rule) {
  return rule.layer ?? RULE_LAYER[rule.kind] ?? 'schema'
}

// A stable identity for a rule: list keys, and telling whether a suggestion has
// already been taken up. The WHEN clause is part of the key — two rules on the
// same column that differ only by their condition are two different rules.
export function ruleKey(rule) {
  return [
    rule?.kind,
    rule?.column,
    rule?.op ?? '',
    JSON.stringify(rule?.target ?? null),
    rule?.when ? JSON.stringify(rule.when) : '',
    rule?.kind === RULE_KINDS.AGGREGATE ? JSON.stringify([rule.fn, rule.targetIsColumn ?? false, rule.groupBy ?? null, rule.tolerance ?? 0]) : '',
  ].join('|')
}

const quote = (value) => `"${value}"`
const list = (values) => values.map(quote).join(', ')

// One reader-facing sentence for a rule, used in violation messages and
// available to the authoring UI so the two can never drift apart.
export function describeRule(rule) {
  const subject = quote(rule.column)
  let body
  switch (rule.kind) {
    case RULE_KINDS.TYPE:
      body = `${subject} must hold ${rule.target} values`
      break
    case RULE_KINDS.NULL_RULE:
      body = rule.op === 'notNull' ? `${subject} must never be blank` : `${subject} may be blank`
      break
    case RULE_KINDS.VALUE_SET:
      body = `${subject} must be one of ${list(rule.target ?? [])}`
      break
    case RULE_KINDS.RANGE:
      body = `${subject} must be between ${rule.target?.[0]} and ${rule.target?.[1]}`
      break
    case RULE_KINDS.CROSS_COLUMN:
      body = `${subject} must be ${OP_WORDS[rule.op] ?? rule.op} ${quote(rule.target)}`
      break
    case RULE_KINDS.COMPARISON:
      body = `${subject} must be ${OP_WORDS[rule.op] ?? rule.op} ${rule.targetIsColumn ? quote(rule.target) : rule.target}`
      break
    case RULE_KINDS.IDENTIFIER:
      body = `${subject} must hold ${IDENTIFIERS[rule.target]?.describe ?? `a valid ${rule.target}`}`
      break
    case RULE_KINDS.UNIQUE: {
      const extra = Array.isArray(rule.target) ? rule.target : []
      body = `${[rule.column, ...extra].map(quote).join(' + ')} must identify each record exactly once`
      break
    }
    case RULE_KINDS.REFERENCE:
      body = `${subject} must exist in ${quote(rule.target?.column)} of the reference file ${quote(rule.target?.file)}`
      break
    case RULE_KINDS.AGGREGATE: {
      const of = (column) => (rule.fn === 'count' ? `the count of ${quote(column)} values` : `the sum of ${quote(column)}`)
      const against = rule.targetIsColumn ? of(rule.target) : rule.target
      const within = rule.tolerance ? ` (± ${rule.tolerance})` : ''
      const per = rule.groupBy ? ` for each ${quote(rule.groupBy)}` : ''
      body = `${of(rule.column)} must be ${OP_WORDS[rule.op] ?? rule.op} ${against}${within}${per}`
      break
    }
    default:
      body = `${subject} must satisfy an unknown rule`
  }
  return rule.when ? `${body} when ${describeCondition(rule.when)}` : body
}

function describeCondition(when) {
  const target = when.targetIsColumn ? quote(when.target) : `${when.target}`
  if (when.op === 'notNull') return `${quote(when.column)} is not blank`
  return `${quote(when.column)} is ${OP_WORDS[when.op] ?? when.op} ${target}`
}

// --- comparison -------------------------------------------------------------
// Both sides are coerced together, so "10" vs "9" compares as numbers and
// "2024-08-31" vs "2023-03-01" as dates, while anything else falls back to
// trimmed text. Coercing each side independently is what produces the classic
// "10" < "9" bug.
//
// Each side is read by its own reader (formats.js): a cell by its file's
// declared format, a literal the author typed by the canonical one. A file in
// 1.234,56 notation compared with a bound typed as 400000 must read each in its
// own notation, or one of them is wrong.
function coerce(left, right, leftReader = DEFAULT_READER, rightReader = DEFAULT_READER) {
  const leftNumber = leftReader.number(left)
  const rightNumber = rightReader.number(right)
  if (leftNumber !== null && rightNumber !== null) return [leftNumber, rightNumber]

  const leftDate = leftReader.date(left)
  const rightDate = rightReader.date(right)
  if (leftDate !== null && rightDate !== null) return [leftDate, rightDate]

  return [String(left).trim(), String(right).trim()]
}

export function compare(rawLeft, rawRight, op, leftReader, rightReader) {
  const [left, right] = coerce(rawLeft, rawRight, leftReader, rightReader)
  switch (op) {
    case '=': return left === right
    case '!=': return left !== right
    case '>': return left > right
    case '<': return left < right
    case '>=': return left >= right
    case '<=': return left <= right
    default: return null
  }
}

function matchesType(value, type, reader) {
  switch (type) {
    case 'numeric': return reader.number(value) !== null
    case 'date': return reader.date(value) !== null
    case 'boolean': return reader.boolean(value) !== null
    case 'string': return true
    default: return null
  }
}

// Resolves a rule's right-hand side for one row: another column's value when
// targetIsColumn, otherwise the literal the author typed.
function resolveTarget(rule, row) {
  return rule.targetIsColumn ? row[rule.target] : rule.target
}

// A WHEN condition gates the rule to the rows it describes. A row whose
// condition is blank or unreadable is NOT tested — the author said "check this
// where X holds", and where X is unknown it does not hold.
export function conditionHolds(when, row, reader = DEFAULT_READER) {
  if (!when) return true
  const value = row[when.column]
  if (when.op === 'notNull') return !isBlank(value)
  if (isBlank(value)) return false

  const target = when.targetIsColumn ? row[when.target] : when.target
  if (when.targetIsColumn && isBlank(target)) return false
  return compare(value, target, when.op, reader, when.targetIsColumn ? reader : DEFAULT_READER) === true
}

// --- rule shape -------------------------------------------------------------
// A malformed rule is reported as a violation rather than thrown or silently
// skipped: a contract that quietly stops checking something is the exact failure
// this tool exists to catch.
export function ruleIssue(rule) {
  if (!rule || typeof rule !== 'object') return 'the rule is not an object'
  if (!Object.values(RULE_KINDS).includes(rule.kind)) return `"${rule.kind}" is not a known rule kind`
  if (typeof rule.column !== 'string' || rule.column.trim() === '') return 'the rule names no column'

  switch (rule.kind) {
    case RULE_KINDS.TYPE:
      if (!RULE_TYPES.includes(rule.target)) return `"${rule.target}" is not one of ${RULE_TYPES.join(', ')}`
      break
    case RULE_KINDS.NULL_RULE:
      if (rule.op !== 'notNull' && rule.op !== 'nullable') return 'a null-rule must use notNull or nullable'
      break
    case RULE_KINDS.VALUE_SET:
      if (!Array.isArray(rule.target) || rule.target.length === 0) return 'a value-set rule needs a non-empty list of allowed values'
      break
    case RULE_KINDS.RANGE:
      if (!Array.isArray(rule.target) || rule.target.length !== 2) return 'a range rule needs exactly a low and a high bound'
      break
    case RULE_KINDS.COMPARISON:
    case RULE_KINDS.CROSS_COLUMN:
      if (!OP_WORDS[rule.op]) return `"${rule.op}" is not a comparison operator`
      if (rule.target === undefined || rule.target === null || rule.target === '') return 'the rule names nothing to compare against'
      break
    case RULE_KINDS.IDENTIFIER:
      if (!IDENTIFIER_NAMES.includes(rule.target)) return `"${rule.target}" is not a known identifier — use one of ${IDENTIFIER_NAMES.join(', ')}`
      break
    case RULE_KINDS.UNIQUE:
      if (rule.target !== undefined && rule.target !== null) {
        if (!Array.isArray(rule.target) || rule.target.some((c) => typeof c !== 'string' || c.trim() === '')) return 'a uniqueness rule’s other columns must be a list of column names'
        if (rule.target.includes(rule.column) || new Set(rule.target).size !== rule.target.length) return 'a uniqueness rule names a column twice'
      }
      break
    case RULE_KINDS.REFERENCE:
      if (!rule.target || typeof rule.target !== 'object' || Array.isArray(rule.target)) return 'a reference rule needs the reference file and its column'
      if (typeof rule.target.file !== 'string' || rule.target.file.trim() === '') return 'a reference rule names no reference file'
      if (typeof rule.target.column !== 'string' || rule.target.column.trim() === '') return 'a reference rule names no column in the reference file'
      break
    case RULE_KINDS.AGGREGATE:
      if (!AGGREGATE_FNS.includes(rule.fn)) return `"${rule.fn}" is not an aggregate — use sum or count`
      if (!OP_WORDS[rule.op]) return `"${rule.op}" is not a comparison operator`
      if (rule.targetIsColumn) {
        if (typeof rule.target !== 'string' || rule.target.trim() === '') return 'the rule names no column to total against'
      } else if (DEFAULT_READER.number(rule.target) === null) {
        return `the total must be compared with a number, and "${rule.target}" is not one`
      }
      if (rule.groupBy !== undefined && rule.groupBy !== null && (typeof rule.groupBy !== 'string' || rule.groupBy.trim() === '')) return 'the group column is not a column name'
      if (rule.tolerance !== undefined && rule.tolerance !== null && !(typeof rule.tolerance === 'number' && Number.isFinite(rule.tolerance) && rule.tolerance >= 0)) return 'the tolerance must be a number of zero or more'
      break
    default:
      break
  }
  if (rule.when && (typeof rule.when !== 'object' || !rule.when.column)) return 'the WHEN condition names no column'
  if (rule.severity !== undefined && !SEVERITIES.includes(rule.severity)) return `"${rule.severity}" is not a severity — use reject or warn`
  return null
}

// --- evaluation -------------------------------------------------------------
// Every rule except notNull treats a blank as "not applicable" rather than a
// failure. A blank is the absence of a value, so there is nothing to compare;
// requiring a value is what the null-rule is for, and saying so once here keeps
// authors from having to guard every other rule against blanks.
const ORDERING = new Set(['>', '<', '>=', '<='])

// Both bounds readable as one kind (number, date) -> that kind's values, with
// the cell read by its file's reader; otherwise null.
function typedBounds(low, high, value, readBound, readValue) {
  const lowValue = readBound(low)
  const highValue = readBound(high)
  if (lowValue === null || highValue === null) return null
  return { low: lowValue, high: highValue, value: readValue(value) }
}

// The value a uniqueness rule identifies a record by, or null when any part is
// blank: a blank is not applicable, as for every kind but notNull. Requiring a
// value is the null-rule's job. The parts are joined unambiguously (JSON), never
// with a separator a value could itself contain: ("x / y", "z") and
// ("x", "y / z") are two records.
export function uniqueValueOf(rule, row) {
  const columns = [rule.column, ...(Array.isArray(rule.target) ? rule.target : [])]
  if (columns.some((column) => isBlank(row?.[column]))) return null
  return JSON.stringify(columns.map((column) => String(row[column]).trim()))
}

// findDuplicateValues(rule, rows, reader) -> Set of values held by more than one
// row the rule applies to. In memory; a streaming caller builds the same set on
// disk (scripts/lib/readinessFile.mjs).
export function findDuplicateValues(rule, rows, reader = DEFAULT_READER) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows) {
    if (!conditionHolds(rule.when, row, reader)) continue
    const value = uniqueValueOf(rule, row)
    if (value === null) continue
    if (seen.has(value)) duplicates.add(value)
    else seen.add(value)
  }
  return duplicates
}

// referenceValues(rows, column) -> Set of the column's trimmed, non-blank values.
// What a reference rule checks against; built from a reference file read
// locally like any other.
export function referenceValues(rows, column) {
  const values = new Set()
  for (const row of rows) {
    const value = row?.[column]
    if (!isBlank(value)) values.add(String(value).trim())
  }
  return values
}

// prepareRules(rules, rows, { reader, references }) -> the options a checker
// needs for the cross-row kinds, built from rows held in memory:
//   duplicates  Map ruleKey -> Set of duplicated values, for every unique rule
//   references  passed through: { [file]: { columns, values: { [column]: Set } } }
export function prepareRules(rules, rows, { reader = DEFAULT_READER, references } = {}) {
  const duplicates = new Map()
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.kind === RULE_KINDS.UNIQUE && !ruleIssue(rule)) duplicates.set(ruleKey(rule), findDuplicateValues(rule, rows, reader))
  }
  return { duplicates, references }
}

function evaluateRow(rule, row, reader, state) {
  const value = row[rule.column]

  if (rule.kind === RULE_KINDS.NULL_RULE) {
    if (rule.op === 'nullable') return true
    return !isBlank(value)
  }

  if (rule.kind === RULE_KINDS.UNIQUE) {
    const key = uniqueValueOf(rule, row)
    if (key === null) return null
    // Every copy is a failure, the first included: nothing says which one is meant.
    return !state.duplicates.has(key)
  }

  if (isBlank(value)) return null

  switch (rule.kind) {
    case RULE_KINDS.IDENTIFIER:
      return isIdentifier(rule.target, value)

    case RULE_KINDS.REFERENCE:
      return state.referenceSet.has(String(value).trim())

    case RULE_KINDS.TYPE:
      return matchesType(value, rule.target, reader)

    case RULE_KINDS.VALUE_SET:
      return rule.target.map((allowed) => String(allowed).trim()).includes(String(value).trim())

    case RULE_KINDS.RANGE: {
      const [low, high] = rule.target
      // Numeric or date bounds make a numeric or date range. A value that
      // cannot be read that way is OUTSIDE it — never compared as text, where
      // "250.000,00" >= "100" holds alphabetically and an unreadable amount
      // would pass. Bounds that are neither stay a text range ("A" to "M").
      const asNumber = typedBounds(low, high, value, DEFAULT_READER.number, reader.number)
      if (asNumber) return asNumber.value !== null && asNumber.value >= asNumber.low && asNumber.value <= asNumber.high
      const asDate = typedBounds(low, high, value, DEFAULT_READER.date, reader.date)
      if (asDate) return asDate.value !== null && asDate.value >= asDate.low && asDate.value <= asDate.high
      const aboveLow = compare(value, low, '>=', reader, DEFAULT_READER)
      const belowHigh = compare(value, high, '<=', reader, DEFAULT_READER)
      return aboveLow === true && belowHigh === true
    }

    case RULE_KINDS.COMPARISON:
    case RULE_KINDS.CROSS_COLUMN: {
      const target = resolveTarget(rule, row)
      // A cross-column rule against a blank counterpart is not applicable, the
      // same way a blank value is: "effective_to > effective_from" says nothing
      // about a row that has no effective_from.
      if (rule.targetIsColumn && isBlank(target)) return null
      const targetReader = rule.targetIsColumn ? reader : DEFAULT_READER
      // An ordering against a number is a numeric claim: a value that is not a
      // number fails it rather than being ordered as text. (= and != may still
      // compare text — "status != 5" is meaningful for "closed".)
      if (ORDERING.has(rule.op) && targetReader.number(target) !== null && reader.number(value) === null
        && !(targetReader.date(target) !== null && reader.date(value) !== null)) return false
      return compare(value, target, rule.op, reader, targetReader)
    }

    default:
      return null
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// failing is the full count; failures may hold only the first few when a
// streaming caller caps them, so the count never comes from the array.
function violationFor(rule, failures, failing, applicable, rowCount) {
  const examples = failures.slice(0, 3)
  const shown = examples
    .map((f) => `row ${f.row}${f.value === '' ? ' (blank)' : `: ${f.value}`}`)
    .join(' · ')

  const gated = rule.when
    ? applicable === 1
      ? ' — the only row the condition applies to'
      : ` of the ${plural(applicable, 'row')} the condition applies to`
    : ` of ${rowCount}`

  return {
    layer: ruleLayer(rule),
    // Which half of the report a finding belongs to: a rule is a requirement
    // someone stated, a baseline finding is a difference from what was trusted.
    // They are different claims and the UI shows them separately.
    source: 'rule',
    code: `rule:${rule.kind}`,
    column: rule.column,
    rule,
    message: `The contract says ${describeRule(rule)}, and ${plural(failing, 'row')}${gated} break${failing === 1 ? 's' : ''} that.`,
    evidence: `${shown}${failing > examples.length ? ` · and ${failing - examples.length} more` : ''}`,
  }
}

function uncheckedOutcome(rule, problem, code = 'rule:invalid') {
  return {
    rule,
    status: 'UNCHECKED',
    applicable: 0,
    failures: [],
    violation: {
      layer: ruleLayer(rule ?? {}),
      source: 'rule',
      code,
      column: rule?.column ?? null,
      rule,
      message: `A rule in this contract can't be checked because ${problem}. Nothing was verified for it, so treat this column as unchecked.`,
      evidence: JSON.stringify(rule ?? null),
    },
  }
}

// --- aggregate ------------------------------------------------------------------
// A running total per group. Sums are compensated (Neumaier), so a long column of
// paise amounts does not drift; counts are of non-blank values. A value that is
// not blank and cannot be read as a number makes the total unknowable, so the
// rule is UNCHECKED with the rows named — never summed as zero.

const newTotal = () => ({ sum: 0, carry: 0, count: 0 })

function addTo(total, raw, state, rowNumber, reader) {
  if (isBlank(raw)) return
  total.count += 1
  if (state.rule.fn === 'count') return
  const n = reader.number(raw)
  if (n === null) {
    state.unreadable += 1
    if (state.unreadableRows.length < 3) state.unreadableRows.push(rowNumber)
    return
  }
  const t = total.sum + n
  total.carry += Math.abs(total.sum) >= Math.abs(n) ? (total.sum - t) + n : (n - t) + total.sum
  total.sum = t
}

const valueOf = (total, fn) => (fn === 'count' ? total.count : total.sum + total.carry)

function accumulate(state, row, rowNumber, reader) {
  const { rule } = state
  const group = rule.groupBy ? (isBlank(row[rule.groupBy]) ? '(blank)' : String(row[rule.groupBy]).trim()) : ''
  let totals = state.groups.get(group)
  if (!totals) {
    totals = { left: newTotal(), right: newTotal() }
    state.groups.set(group, totals)
  }
  addTo(totals.left, row[rule.column], state, rowNumber, reader)
  if (rule.targetIsColumn) addTo(totals.right, row[rule.target], state, rowNumber, reader)
}

// Holds within the tolerance, plus a relative epsilon for binary floating point.
function totalHolds(left, right, op, tolerance) {
  const eps = 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  const d = left - right
  switch (op) {
    case '=': return Math.abs(d) <= tolerance + eps
    case '!=': return Math.abs(d) > tolerance + eps
    case '>': return d > eps
    case '<': return d < -eps
    case '>=': return d >= -(tolerance + eps)
    case '<=': return d <= tolerance + eps
    default: return false
  }
}

const figure = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })

// Judged once, after the last row. Memoised on the state so readiness and
// validate read the same verdict.
export function aggregateResult(state) {
  if (state.result) return state.result
  const { rule } = state
  if (state.unreadable > 0) {
    state.result = { unreadable: true }
    return state.result
  }
  // No group seen: the total over no rows is zero (and there is one total).
  if (state.groups.size === 0 && !rule.groupBy) state.groups.set('', { left: newTotal(), right: newTotal() })
  const literal = rule.targetIsColumn ? null : DEFAULT_READER.number(rule.target)
  const tolerance = rule.tolerance ?? 0
  const groups = [...state.groups.entries()].map(([group, totals]) => {
    const left = valueOf(totals.left, rule.fn)
    const right = rule.targetIsColumn ? valueOf(totals.right, rule.fn) : literal
    return { group, left, right, holds: totalHolds(left, right, rule.op, tolerance) }
  })
  const failing = groups.filter((g) => !g.holds)
  state.failing = failing.length
  state.failures = failing.map((g) => ({
    row: null,
    group: g.group,
    value: `${g.group ? `${rule.groupBy} ${g.group}: ` : ''}${figure(g.left)} against ${figure(g.right)} (difference ${figure(g.left - g.right)})`,
  }))
  state.result = { groups, failing }
  return state.result
}

function aggregateOutcome(state) {
  const { rule } = state
  const result = aggregateResult(state)
  if (result.unreadable) {
    return uncheckedOutcome(
      rule,
      `${plural(state.unreadable, 'value')} in "${rule.column}"${rule.targetIsColumn ? ` or "${rule.target}"` : ''} could not be read as numbers (row ${state.unreadableRows.join(', row ')}), so the total cannot be known`,
      'rule:unreadable',
    )
  }
  const { groups, failing } = result
  if (failing.length === 0) return { rule, status: 'PASS', applicable: groups.length, failures: [], violation: null }
  const shown = state.failures.slice(0, 3).map((f) => f.value).join(' · ')
  return {
    rule,
    status: 'FAIL',
    applicable: groups.length,
    failures: state.failures,
    violation: {
      layer: ruleLayer(rule),
      source: 'rule',
      code: `rule:${rule.kind}`,
      column: rule.column,
      rule,
      message: `The contract says ${describeRule(rule)}, and ${rule.groupBy ? `${plural(failing.length, 'group')} of ${groups.length} do${failing.length === 1 ? 'es' : ''} not` : 'it does not'}.`,
      evidence: `${shown}${failing.length > 3 ? ` · and ${failing.length - 3} more` : ''}`,
    },
  }
}

// createRuleChecker(rules, { keepFailures }) -> { row, states, outcomes }
//
// THE rule evaluator: checkRules() below is a loop over it, and load readiness
// streams a file through it a row at a time. One evaluator means a rule cannot
// mean one thing in a report and another in a pipeline.
//
// row(row, rowNumber) evaluates every rule on one row and returns the indexes
// of the rules it broke. keepFailures caps how many failing rows each rule
// remembers — a streaming caller over twenty million rows wants the count and
// a few examples, not a list as long as the file. Counts are always exact.
//
// columns: the file's header. A rule that reads a column the file does not
// have is UNCHECKED, never evaluated: every cell would read as blank, and a
// rule that tested nothing would report PASS.
// reader: how the file's cells are read (formats.js); the default is the
// notation rules have always used.
//
// duplicates: Map ruleKey -> Set, the duplicated values of each unique rule,
// found before any row is judged (prepareRules, or a streamed first pass). A
// unique rule without its set is UNCHECKED, never evaluated against nothing.
// references: { [file]: { columns, values: { [column]: Set } } }, the reference
// files' values. A reference rule whose file or column is absent is UNCHECKED.
export function createRuleChecker(rules, { keepFailures = Infinity, columns = null, reader = DEFAULT_READER, duplicates = null, references = null } = {}) {
  const present = columns ? new Set(columns) : null
  const states = (Array.isArray(rules) ? rules : []).map((rule) => {
    let problem = ruleIssue(rule)
    let code = 'rule:invalid'
    if (!problem && present) {
      const missing = ruleColumns(rule).filter((column) => !present.has(column))
      if (missing.length > 0) {
        problem = `the file has no column ${missing.map((c) => `"${c}"`).join(', ')}`
        code = 'rule:missing-column'
      }
    }
    const state = { rule, problem, code, applicable: 0, failing: 0, failures: [] }
    if (!problem && rule.kind === RULE_KINDS.UNIQUE) {
      state.duplicates = duplicates?.get(ruleKey(rule))
      if (!state.duplicates) {
        state.problem = 'the whole file was not read before this rule ran, so repeated values could not be known'
        state.code = 'rule:not-prepared'
      }
    }
    if (!problem && rule.kind === RULE_KINDS.REFERENCE) {
      const file = references?.[rule.target.file]
      if (!file) {
        state.problem = `the reference file "${rule.target.file}" was not provided — add it, then check again`
        state.code = 'rule:missing-reference'
      } else if (!file.values?.[rule.target.column]) {
        state.problem = `the reference file "${rule.target.file}" has no column "${rule.target.column}"`
        state.code = 'rule:missing-reference'
      } else {
        state.referenceSet = file.values[rule.target.column]
      }
    }
    if (!problem && rule.kind === RULE_KINDS.AGGREGATE) {
      state.groups = new Map() // group label -> { left, right } running totals
      state.unreadable = 0
      state.unreadableRows = []
    }
    return state
  })

  return {
    states,
    row(row, rowNumber) {
      const broken = []
      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]
        if (state.problem || !conditionHolds(state.rule.when, row, reader)) continue
        state.applicable += 1
        // A total is judged once, over the file: it rejects no single record.
        if (state.groups) {
          accumulate(state, row, rowNumber, reader)
          continue
        }
        if (evaluateRow(state.rule, row, reader, state) === false) {
          state.failing += 1
          if (state.failures.length < keepFailures) {
            state.failures.push({ row: rowNumber, value: String(row[state.rule.column] ?? '').trim() })
          }
          broken.push(i)
        }
      }
      return broken
    },
    outcomes(rowCount) {
      return states.map((state) => {
        if (state.problem) return uncheckedOutcome(state.rule, state.problem, state.code)
        if (state.groups) return aggregateOutcome(state)
        return {
          rule: state.rule,
          status: state.failing > 0 ? 'FAIL' : 'PASS',
          applicable: state.applicable,
          failures: state.failures,
          violation: state.failing > 0
            ? violationFor(state.rule, state.failures, state.failing, state.applicable, rowCount)
            : null,
        }
      })
    },
  }
}

// checkRules(rules, rows) -> one outcome per rule, PASSING ONES INCLUDED.
//
// Reporting only failures would leave an author unable to tell a rule that held
// from a rule that was never evaluated — and "which of my rules actually ran"
// is the first question anyone asks of a contract.
//
// Row numbers are 1-based over the data rows, matching what a reader counts in
// a spreadsheet under the header.
export function checkRules(rules, rows, options = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return []
  // The rows are all here, so a uniqueness rule's repeated values can be found
  // first; a streaming caller passes them in instead.
  const duplicates = options.duplicates ?? prepareRules(rules, rows, { reader: options.reader }).duplicates
  const checker = createRuleChecker(rules, { ...options, duplicates })
  rows.forEach((row, index) => checker.row(row, index + 1))
  return checker.outcomes(rows.length)
}

// The violations alone, for callers that only report problems.
export function evaluateRules(rules, rows) {
  return checkRules(rules, rows).map((outcome) => outcome.violation).filter(Boolean)
}
