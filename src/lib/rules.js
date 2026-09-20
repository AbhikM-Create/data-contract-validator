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

import { isBlank, parseBoolean, parseDate, parseNumber } from './contract.js'

export const RULE_KINDS = {
  TYPE: 'type',
  NULL_RULE: 'nullRule',
  COMPARISON: 'comparison',
  RANGE: 'range',
  VALUE_SET: 'valueSet',
  CROSS_COLUMN: 'crossColumn',
}

export const OPS = ['=', '!=', '>', '<', '>=', '<=', 'between', 'in', 'notNull']

export const RULE_TYPES = ['numeric', 'string', 'date', 'boolean']

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
function coerce(left, right) {
  const leftNumber = parseNumber(left)
  const rightNumber = parseNumber(right)
  if (leftNumber !== null && rightNumber !== null) return [leftNumber, rightNumber]

  const leftDate = parseDate(left)
  const rightDate = parseDate(right)
  if (leftDate !== null && rightDate !== null) return [leftDate, rightDate]

  return [String(left).trim(), String(right).trim()]
}

function compare(rawLeft, rawRight, op) {
  const [left, right] = coerce(rawLeft, rawRight)
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

function matchesType(value, type) {
  switch (type) {
    case 'numeric': return parseNumber(value) !== null
    case 'date': return parseDate(value) !== null
    case 'boolean': return parseBoolean(value) !== null
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
function conditionHolds(when, row) {
  if (!when) return true
  const value = row[when.column]
  if (when.op === 'notNull') return !isBlank(value)
  if (isBlank(value)) return false

  const target = when.targetIsColumn ? row[when.target] : when.target
  if (when.targetIsColumn && isBlank(target)) return false
  return compare(value, target, when.op) === true
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
    default:
      break
  }
  if (rule.when && (typeof rule.when !== 'object' || !rule.when.column)) return 'the WHEN condition names no column'
  return null
}

// --- evaluation -------------------------------------------------------------
// Every rule except notNull treats a blank as "not applicable" rather than a
// failure. A blank is the absence of a value, so there is nothing to compare;
// requiring a value is what the null-rule is for, and saying so once here keeps
// authors from having to guard every other rule against blanks.
function evaluateRow(rule, row) {
  const value = row[rule.column]

  if (rule.kind === RULE_KINDS.NULL_RULE) {
    if (rule.op === 'nullable') return true
    return !isBlank(value)
  }

  if (isBlank(value)) return null

  switch (rule.kind) {
    case RULE_KINDS.TYPE:
      return matchesType(value, rule.target)

    case RULE_KINDS.VALUE_SET:
      return rule.target.map((allowed) => String(allowed).trim()).includes(String(value).trim())

    case RULE_KINDS.RANGE: {
      const [low, high] = rule.target
      const aboveLow = compare(value, low, '>=')
      const belowHigh = compare(value, high, '<=')
      return aboveLow === true && belowHigh === true
    }

    case RULE_KINDS.COMPARISON:
    case RULE_KINDS.CROSS_COLUMN: {
      const target = resolveTarget(rule, row)
      // A cross-column rule against a blank counterpart is not applicable, the
      // same way a blank value is: "effective_to > effective_from" says nothing
      // about a row that has no effective_from.
      if (rule.targetIsColumn && isBlank(target)) return null
      return compare(value, target, rule.op)
    }

    default:
      return null
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function violationFor(rule, failures, applicable, rowCount) {
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
    message: `The contract says ${describeRule(rule)}, and ${plural(failures.length, 'row')}${gated} break${failures.length === 1 ? 's' : ''} that.`,
    evidence: `${shown}${failures.length > examples.length ? ` · and ${failures.length - examples.length} more` : ''}`,
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
export function checkRules(rules, rows) {
  if (!Array.isArray(rules) || rules.length === 0) return []

  return rules.map((rule) => {
    const problem = ruleIssue(rule)
    if (problem) {
      return {
        rule,
        status: 'UNCHECKED',
        applicable: 0,
        failures: [],
        violation: {
          layer: ruleLayer(rule ?? {}),
          source: 'rule',
          code: 'rule:invalid',
          column: rule?.column ?? null,
          rule,
          message: `A rule in this contract can't be checked because ${problem}. Nothing was verified for it, so treat this column as unchecked.`,
          evidence: JSON.stringify(rule ?? null),
        },
      }
    }

    const failures = []
    let applicable = 0

    rows.forEach((row, index) => {
      if (!conditionHolds(rule.when, row)) return
      applicable += 1
      if (evaluateRow(rule, row) === false) {
        failures.push({ row: index + 1, value: String(row[rule.column] ?? '').trim() })
      }
    })

    return {
      rule,
      status: failures.length > 0 ? 'FAIL' : 'PASS',
      applicable,
      failures,
      violation: failures.length > 0 ? violationFor(rule, failures, applicable, rows.length) : null,
    }
  })
}

// The violations alone, for callers that only report problems.
export function evaluateRules(rules, rows) {
  return checkRules(rules, rows).map((outcome) => outcome.violation).filter(Boolean)
}
