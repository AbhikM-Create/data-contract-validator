// Turning an inferred draft into proposed rules. Pure: no DOM, no React.
//
// This is the hinge of v2. Inference can only ever report what the baseline
// happened to contain; a rule states what the data must be. A suggestion is the
// bridge: it shows the observed fact and offers to promote it into a
// requirement, which the author accepts, edits or ignores.
//
// Every suggestion carries the evidence it came from, because promoting a fact
// you haven't seen the basis for is how a contract ends up asserting something
// the data never supported.

import { TYPES } from './contract.js'
import { RULE_KINDS, ruleKey } from './rules.js'

const RULE_TYPE_FOR = {
  [TYPES.NUMERIC]: 'numeric',
  [TYPES.DATE]: 'date',
  [TYPES.BOOLEAN]: 'boolean',
  [TYPES.CATEGORICAL]: 'string',
  [TYPES.TEXT]: 'string',
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 })

// suggestRules(contract) -> [{ rule, label, evidence }]
//
// Ordered so the strongest ground truth comes first: a closed value set is the
// most useful thing a human can confirm, and the least discoverable from data.
export function suggestRules(contract) {
  const columns = contract?.columns ?? []
  const suggestions = []

  for (const column of columns) {
    if (column.type === TYPES.EMPTY) continue

    if ((column.type === TYPES.CATEGORICAL || column.type === TYPES.BOOLEAN) && column.domain?.length) {
      suggestions.push({
        rule: { kind: RULE_KINDS.VALUE_SET, column: column.name, op: 'in', target: [...column.domain] },
        label: `Only these ${count(column.domain.length, 'value')}`,
        evidence: `the baseline contained ${column.domain.slice(0, 4).map((v) => `"${v}"`).join(', ')}${column.domain.length > 4 ? `, +${column.domain.length - 4} more` : ''}`,
      })
    }

    if (column.type === TYPES.NUMERIC && column.min !== null && column.max !== null) {
      suggestions.push({
        rule: { kind: RULE_KINDS.RANGE, column: column.name, op: 'between', target: [column.min, column.max] },
        label: `Between ${short(column.min)} and ${short(column.max)}`,
        evidence: `every baseline value fell in this range`,
      })
    }

    if (column.nullRate === 0) {
      suggestions.push({
        rule: { kind: RULE_KINDS.NULL_RULE, column: column.name, op: 'notNull' },
        label: 'Never blank',
        evidence: `no blanks in ${count(column.rowCount, 'baseline row')}`,
      })
    }

    const ruleType = RULE_TYPE_FOR[column.type]
    // A "must be text" rule asserts nothing — every CSV cell is text until
    // something parses it — so it is not worth offering.
    if (ruleType && ruleType !== 'string') {
      suggestions.push({
        rule: { kind: RULE_KINDS.TYPE, column: column.name, op: '=', target: ruleType },
        label: `Always ${ruleType}`,
        evidence: `every baseline value parsed as ${ruleType}`,
      })
    }
  }

  return suggestions
}

// Suggestions the author has not already taken up.
export function openSuggestions(contract, rules) {
  const taken = new Set((rules ?? []).map(ruleKey))
  return suggestRules(contract).filter((suggestion) => !taken.has(ruleKey(suggestion.rule)))
}
