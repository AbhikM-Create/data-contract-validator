import { describe, expect, it } from 'vitest'
import { defineContract, withRules } from './authoredContract.js'
import { inferContract } from './contract.js'
import { describeRule, evaluateRules } from './rules.js'
import { validate } from './validate.js'

const rows = [
  { id: '1', grade: 'Analyst', revenue: '100', start: '2024-01-01', end: '2024-06-01', is_current: 'N', email: 'a@x.com' },
  { id: '2', grade: 'VP', revenue: '250', start: '2024-02-01', end: '', is_current: 'Y', email: 'b@x.com' },
  { id: '3', grade: 'Consumer', revenue: '-5', start: '2024-03-01', end: '2024-02-01', is_current: 'N', email: '' },
]

const fire = (rule, data = rows) => evaluateRules([rule], data)

describe('rule kinds', () => {
  it('type: flags values that are not the declared type', () => {
    expect(fire({ kind: 'type', column: 'revenue', target: 'numeric' })).toHaveLength(0)
    const bad = fire({ kind: 'type', column: 'grade', target: 'numeric' })
    expect(bad).toHaveLength(1)
    expect(bad[0].layer).toBe('schema')
  })

  it('nullRule: notNull flags blanks, nullable never flags', () => {
    const required = fire({ kind: 'nullRule', column: 'email', op: 'notNull' })
    expect(required).toHaveLength(1)
    expect(required[0].evidence).toContain('row 3')
    expect(fire({ kind: 'nullRule', column: 'email', op: 'nullable' })).toHaveLength(0)
  })

  it('valueSet: rejects a value outside the authored set', () => {
    const violations = fire({ kind: 'valueSet', column: 'grade', op: 'in', target: ['Analyst', 'VP'] })
    expect(violations).toHaveLength(1)
    expect(violations[0].layer).toBe('semantics')
    expect(violations[0].evidence).toContain('Consumer')
  })

  it('comparison: compares against a literal', () => {
    const violations = fire({ kind: 'comparison', column: 'revenue', op: '>', target: 0 })
    expect(violations).toHaveLength(1)
    expect(violations[0].layer).toBe('distribution')
    expect(violations[0].evidence).toContain('row 3')
  })

  it('range: bounds are inclusive', () => {
    expect(fire({ kind: 'range', column: 'revenue', op: 'between', target: [100, 250] })).toHaveLength(1)
    expect(fire({ kind: 'range', column: 'revenue', op: 'between', target: [-5, 250] })).toHaveLength(0)
  })

  it('crossColumn: compares two columns in the same row', () => {
    const violations = fire({ kind: 'crossColumn', column: 'end', op: '>', target: 'start', targetIsColumn: true })
    expect(violations).toHaveLength(1)
    expect(violations[0].evidence).toContain('row 3')
    expect(violations[0].evidence).not.toContain('row 2') // row 2's end is blank
  })
})

describe('comparison semantics', () => {
  it('compares numbers as numbers, not as text', () => {
    const data = [{ n: '9' }, { n: '10' }]
    expect(fire({ kind: 'comparison', column: 'n', op: '>=', target: 9 }, data)).toHaveLength(0)
  })

  it('compares dates as dates', () => {
    const data = [{ a: '2024-12-01', b: '2024-02-01' }]
    expect(fire({ kind: 'crossColumn', column: 'a', op: '>', target: 'b', targetIsColumn: true }, data)).toHaveLength(0)
  })

  // A blank is the absence of a value, not a wrong one. Requiring a value is
  // what nullRule is for; without this, every other rule would double-report it.
  it.each([
    ['comparison', { kind: 'comparison', column: 'v', op: '>', target: 10 }],
    ['valueSet', { kind: 'valueSet', column: 'v', op: 'in', target: ['only-this'] }],
    ['range', { kind: 'range', column: 'v', op: 'between', target: [1, 2] }],
    ['type', { kind: 'type', column: 'v', target: 'numeric' }],
    ['crossColumn', { kind: 'crossColumn', column: 'v', op: '>', target: 'other', targetIsColumn: true }],
  ])('treats a blank as not-applicable for a %s rule', (_kind, rule) => {
    expect(fire(rule, [{ v: '', other: '5' }])).toHaveLength(0)
  })

  it('treats a blank counterpart in a cross-column rule as not-applicable', () => {
    const rule = { kind: 'crossColumn', column: 'v', op: '>', target: 'other', targetIsColumn: true }
    expect(fire(rule, [{ v: '5', other: '' }])).toHaveLength(0)
  })

  it('still flags a blank when the rule is notNull', () => {
    expect(fire({ kind: 'nullRule', column: 'v', op: 'notNull' }, [{ v: '' }])).toHaveLength(1)
  })
})

describe('WHEN conditions', () => {
  const rule = { kind: 'nullRule', column: 'end', op: 'notNull', when: { column: 'is_current', op: '=', target: 'N' } }

  it('tests only the rows the condition selects', () => {
    // rows 1 and 3 are is_current=N and both have an end date; row 2 is gated out
    expect(fire(rule)).toHaveLength(0)
  })

  it('flags a gated row that breaks the rule', () => {
    const data = [...rows, { id: '4', is_current: 'N', end: '', start: '2024-01-01', grade: 'VP', revenue: '1', email: 'd@x.com' }]
    const violations = fire(rule, data)
    expect(violations).toHaveLength(1)
    expect(violations[0].evidence).toContain('row 4')
    expect(violations[0].message).toContain('the 3 rows the condition applies to')
  })

  it('does not test rows whose condition value is blank', () => {
    const data = [{ end: '', is_current: '' }]
    expect(fire(rule, data)).toHaveLength(0)
  })

  it('supports a column as the condition target', () => {
    const data = [{ a: '5', b: '5', c: '' }]
    const gated = { kind: 'nullRule', column: 'c', op: 'notNull', when: { column: 'a', op: '=', target: 'b', targetIsColumn: true } }
    expect(fire(gated, data)).toHaveLength(1)
  })
})

describe('malformed rules', () => {
  it.each([
    [{ kind: 'nonsense', column: 'grade' }, /not a known rule kind/],
    [{ kind: 'valueSet', column: 'grade', op: 'in', target: [] }, /non-empty list/],
    [{ kind: 'range', column: 'revenue', op: 'between', target: [1] }, /low and a high bound/],
    [{ kind: 'comparison', column: 'revenue', op: '~', target: 1 }, /not a comparison operator/],
    [{ kind: 'type', column: 'revenue', target: 'money' }, /not one of numeric/],
  ])('reports %o as unchecked rather than passing it silently', (rule, expected) => {
    const violations = fire(rule)
    expect(violations).toHaveLength(1)
    expect(violations[0].code).toBe('rule:invalid')
    expect(violations[0].message).toMatch(expected)
  })
})

describe('describeRule', () => {
  it('reads as a sentence an author could have written', () => {
    expect(describeRule({ kind: 'crossColumn', column: 'end', op: '>', target: 'start', targetIsColumn: true }))
      .toBe('"end" must be greater than "start"')
    expect(describeRule({ kind: 'nullRule', column: 'end', op: 'notNull', when: { column: 'is_current', op: '=', target: 'N' } }))
      .toBe('"end" must never be blank when "is_current" is equal to N')
  })
})

describe('validate() with an authored contract', () => {
  const rules = [
    { kind: 'valueSet', column: 'grade', op: 'in', target: ['Analyst', 'VP'] },
    { kind: 'crossColumn', column: 'end', op: '>', target: 'start', targetIsColumn: true },
  ]

  it('accepts a rules-only contract and reports through the same four layers', () => {
    const result = validate(defineContract({ rules }), rows)
    expect(result.status).toBe('FAIL')
    expect(result.layers.map((l) => l.id)).toEqual(['schema', 'semantics', 'freshness', 'distribution'])
    expect(result.layers.find((l) => l.id === 'semantics').violations).toHaveLength(2)
    expect(result.summary.rulesChecked).toBe(2)
    expect(result.summary.hasBaseline).toBe(false)
  })

  it('accepts a bare object literal as a contract', () => {
    expect(validate({ rules }, rows).status).toBe('FAIL')
  })

  // The v2 flow: infer a draft, then promote it with authored rules. Both the
  // baseline drift checks and the rules must run.
  it('runs drift checks and rules together when a contract has both halves', () => {
    const baseline = Array.from({ length: 10 }, (_, i) => ({ grade: 'Analyst', revenue: String(100 + i), start: '2024-01-01' }))
    const draft = inferContract(baseline)
    const promoted = withRules(draft, [{ kind: 'valueSet', column: 'grade', op: 'in', target: ['Analyst'] }])
    const candidate = [...baseline.slice(0, 9), { grade: 'Consumer', revenue: '109', start: '2024-01-01' }]

    const result = validate(promoted, candidate)
    const semantics = result.layers.find((l) => l.id === 'semantics')
    const codes = semantics.violations.map((v) => v.code)
    expect(codes).toContain('rule:valueSet')   // the authored requirement
    expect(codes).toContain('new-category')    // the v1 drift check, still running
    expect(result.summary.hasBaseline).toBe(true)
  })

  // A rules-only contract has no baseline, so the headline must not claim the
  // file matched one.
  it('does not mention a baseline when there is none', () => {
    const headline = validate(defineContract({ rules }), rows).headline
    expect(headline.text).toBe('2 rules you set were broken')
    expect(headline.text).not.toMatch(/baseline/)
  })

  it('mentions the baseline when one was actually compared', () => {
    const baseline = Array.from({ length: 10 }, () => ({ grade: 'VP', start: '2024-01-01', end: '2024-06-01' }))
    const promoted = withRules(inferContract(baseline), [{ kind: 'valueSet', column: 'grade', op: 'in', target: ['Analyst'] }])
    expect(validate(promoted, baseline).headline.text).toMatch(/the file matches the baseline, but not your requirements/)
  })

  it('reports INSUFFICIENT for a contract with neither rules nor a baseline', () => {
    expect(validate({ rules: [] }, rows).status).toBe('INSUFFICIENT')
  })

  it('passes a file that satisfies every rule', () => {
    const clean = rows.slice(0, 2).map((row) => ({ ...row, grade: 'VP' }))
    expect(validate(defineContract({ rules }), clean).status).toBe('PASS')
  })
})
