import { describe, expect, it } from 'vitest'
import { inferContract } from './contract.js'
import { openSuggestions, suggestRules } from './suggestions.js'

const rows = Array.from({ length: 12 }, (_, i) => ({
  grade: ['Analyst', 'VP', 'Owner'][i % 3],
  revenue: String(100 + i * 10),
  day: `2024-01-${String(i + 1).padStart(2, '0')}`,
  note: i % 2 === 0 ? `free text ${i}` : '',
}))

const contract = inferContract(rows)
const forColumn = (name) => suggestRules(contract).filter((s) => s.rule.column === name)
const kinds = (name) => forColumn(name).map((s) => s.rule.kind)

describe('suggestRules', () => {
  it('offers the observed value set for a categorical column', () => {
    const valueSet = forColumn('grade').find((s) => s.rule.kind === 'valueSet')
    expect(valueSet.rule.target).toEqual(['Analyst', 'Owner', 'VP'])
    expect(valueSet.evidence).toContain('"Analyst"')
  })

  it('offers the observed range for a numeric column', () => {
    const range = forColumn('revenue').find((s) => s.rule.kind === 'range')
    expect(range.rule.target).toEqual([100, 210])
  })

  it('offers never-blank only for columns with no blanks', () => {
    expect(kinds('grade')).toContain('nullRule')
    expect(kinds('note')).not.toContain('nullRule')
  })

  it('offers a type rule only where it asserts something', () => {
    expect(forColumn('revenue').find((s) => s.rule.kind === 'type').rule.target).toBe('numeric')
    expect(forColumn('day').find((s) => s.rule.kind === 'type').rule.target).toBe('date')
    // "must be text" is true of every CSV cell, so it is not worth offering
    expect(kinds('note')).not.toContain('type')
  })

  it('carries evidence on every suggestion', () => {
    for (const suggestion of suggestRules(contract)) {
      expect(suggestion.evidence.length).toBeGreaterThan(8)
      expect(suggestion.label.length).toBeGreaterThan(0)
    }
  })

  it('survives a contract with no columns', () => {
    expect(suggestRules({ columns: [] })).toEqual([])
    expect(suggestRules(null)).toEqual([])
  })
})

describe('openSuggestions', () => {
  it('hides a suggestion once the author has taken it up', () => {
    const all = suggestRules(contract)
    const taken = all[0]
    const open = openSuggestions(contract, [taken.rule])
    expect(open).toHaveLength(all.length - 1)
    expect(open.map((s) => s.rule)).not.toContainEqual(taken.rule)
  })

  it('treats an edited version of a suggestion as still open', () => {
    const valueSet = forColumn('grade').find((s) => s.rule.kind === 'valueSet')
    const edited = { ...valueSet.rule, target: ['Analyst'] }
    expect(openSuggestions(contract, [edited]).map((s) => s.rule)).toContainEqual(valueSet.rule)
  })
})
