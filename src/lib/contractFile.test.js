import { describe, expect, it } from 'vitest'
import { defineContract, withRules } from './authoredContract.js'
import { contractToJson, parseContractFile, serializeContract } from './contractFile.js'
import { inferContract } from './contract.js'
import { validate } from './validate.js'

const rules = [
  { kind: 'valueSet', column: 'grade', op: 'in', target: ['Analyst', 'VP'] },
  { kind: 'crossColumn', column: 'end', op: '>', target: 'start', targetIsColumn: true },
  { kind: 'nullRule', column: 'end', op: 'notNull', when: { column: 'is_current', op: '=', target: 'N' } },
]

const rows = [
  { grade: 'Analyst', start: '2024-01-01', end: '2024-06-01', is_current: 'N', email: 'a@x.com' },
  { grade: 'Consumer', start: '2024-02-01', end: '', is_current: 'Y', email: 'b@x.com' },
]

describe('serializeContract', () => {
  it('keeps the rules and the name', () => {
    const spec = serializeContract({ name: '  Employee snapshot  ', rules })
    expect(spec.name).toBe('Employee snapshot')
    expect(spec.rules).toHaveLength(3)
    expect(spec.formatVersion).toBe(1)
    expect(spec.kind).toBe('data-contract-validator/contract')
  })

  it('names an unnamed contract rather than saving a blank', () => {
    expect(serializeContract({ rules }).name).toBe('Untitled contract')
  })

  // The promise is that raw data never leaves the browser. An inferred profile
  // holds real values from the file — domains, ranges, timestamps — so none of
  // it may reach the saved spec.
  it('never saves the inferred baseline profile', () => {
    const baseline = Array.from({ length: 10 }, (_, i) => ({
      grade: 'Analyst',
      email: `person${i}@example.com`,
      revenue: String(100 + i),
      day: `2024-01-${String(i + 1).padStart(2, '0')}`,
    }))
    const contract = withRules(inferContract(baseline), rules)
    const json = contractToJson({ name: 'x', rules: contract.rules })

    expect(json).not.toContain('person3@example.com')
    expect(json).not.toContain('columns')
    expect(json).not.toContain('nullRate')
    expect(json).not.toContain('cadence')
    const spec = JSON.parse(json)
    expect(Object.keys(spec).sort()).toEqual(['formatVersion', 'kind', 'name', 'rules', 'savedAt'])
  })

  it('strips fields the engine does not read', () => {
    const noisy = [{ ...rules[0], uiDraftState: 'open', target: ['Analyst'] }]
    expect(serializeContract({ rules: noisy }).rules[0]).not.toHaveProperty('uiDraftState')
  })
})

describe('parseContractFile', () => {
  it('round-trips a contract unchanged', () => {
    const json = contractToJson({ name: 'Employee snapshot', rules })
    const loaded = parseContractFile(json)
    expect(loaded.error).toBeNull()
    expect(loaded.name).toBe('Employee snapshot')
    expect(loaded.rules).toEqual(serializeContract({ rules }).rules)
    expect(loaded.skipped).toEqual([])
  })

  // The point of round-tripping: the reloaded contract must judge a file
  // exactly as the original did.
  it('produces a contract that validates identically', () => {
    const before = validate(defineContract({ rules }), rows)
    const after = validate(defineContract({ rules: parseContractFile(contractToJson({ rules })).rules }), rows)
    expect(after.status).toBe(before.status)
    expect(after.ruleViolations.map((v) => v.message)).toEqual(before.ruleViolations.map((v) => v.message))
  })

  it('reports an unreadable rule instead of dropping it silently', () => {
    const json = JSON.stringify({ kind: 'data-contract-validator/contract', formatVersion: 1, rules: [rules[0], { kind: 'nonsense', column: 'x' }] })
    const loaded = parseContractFile(json)
    expect(loaded.rules).toHaveLength(1)
    expect(loaded.skipped).toHaveLength(1)
    expect(loaded.skipped[0].reason).toMatch(/not a known rule kind/)
  })

  it.each([
    ['not JSON at all', 'hello {', /not valid JSON/],
    ['a JSON array', '[1,2,3]', /does not contain a contract object/],
    ['someone else’s JSON', '{"kind":"invoice","rules":[]}', /was not saved as a contract/],
    ['a newer format', '{"kind":"data-contract-validator/contract","formatVersion":99,"rules":[]}', /newer than this app understands/],
    ['a contract with no rules list', '{"kind":"data-contract-validator/contract","formatVersion":1}', /no rules list/],
  ])('explains %s in one sentence', (_label, text, expected) => {
    const loaded = parseContractFile(text)
    expect(loaded.error).toMatch(expected)
    expect(loaded.rules).toEqual([])
  })

  it('accepts a hand-written file without the kind marker', () => {
    const loaded = parseContractFile('{"rules":[{"kind":"nullRule","column":"email","op":"notNull"}]}')
    expect(loaded.error).toBeNull()
    expect(loaded.rules).toHaveLength(1)
  })

  it('never throws on junk', () => {
    for (const input of [null, undefined, '', '{}', '[]', '0']) {
      expect(() => parseContractFile(input)).not.toThrow()
    }
  })
})
