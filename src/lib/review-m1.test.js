import { describe, expect, it } from 'vitest'
import { checkReadiness } from './readiness.js'
import { checkRules } from './rules.js'
import { cleanSignoff, decisionFor, exceptionsFor } from './signoff.js'

// Fixes from the review of M1 (2026-11-09), each pinned by a test that fails on
// the code before the fix. The masking fixes are in masking.test.js, the CLI's
// --reference fix in cli.test.js.

describe('values that contain the separator used to join columns', () => {
  const rows = [{ a: 'x / y', b: 'z', v: '' }, { a: 'x', b: 'y / z', v: '' }]

  it('a unique rule over two columns: ("x / y", "z") and ("x", "y / z") are different records', () => {
    const [outcome] = checkRules([{ kind: 'unique', column: 'a', op: 'unique', target: ['b'] }], rows)
    expect(outcome.status).toBe('PASS')
  })

  it('a composite readiness key: two keys, each still named as written', () => {
    const report = checkReadiness({ rules: [{ kind: 'nullRule', column: 'v', op: 'notNull', target: null }] }, rows, { columns: ['a', 'b', 'v'], key: ['a', 'b'] })
    expect(report.checks.find((c) => c.kind === 'key').status).toBe('PASS')
    expect(report.checks.find((c) => c.kind === 'nullRule').examples.map((e) => e.record)).toEqual(['x / y / z', 'x / y / z'])
  })

  it('a real duplicate is still caught, every copy', () => {
    const dup = [{ a: 'x', b: 'y', v: '1' }, { a: 'x', b: 'y', v: '1' }]
    const report = checkReadiness({ rules: [{ kind: 'unique', column: 'a', op: 'unique', target: ['b'] }] }, dup, { columns: ['a', 'b', 'v'], key: ['a', 'b'] })
    expect(report.checks.find((c) => c.kind === 'key')).toMatchObject({ status: 'FAIL', failing: 2 })
    expect(report.checks.find((c) => c.kind === 'unique')).toMatchObject({ status: 'FAIL', failing: 2 })
    expect(report.checks.find((c) => c.kind === 'key').examples[0].value).toBe('x / y')
  })
})

describe('sign-off decisions on long rules', () => {
  // A value set of 60 codes describes itself in more than 400 characters, past
  // what a saved exception id may be: the decision was dropped on save.
  const longRule = `"code" must be one of ${Array.from({ length: 60 }, (_, i) => `CODE-${i}`).join(', ')}`
  const readiness = { checks: [{ status: 'FAIL', description: longRule, failing: 2, applicable: 9, severity: 'reject' }] }

  it('a decision on a long rule survives saving and reading, under a short stable id', () => {
    const [exception] = exceptionsFor(readiness, null)
    expect(exception.id.length).toBeLessThan(40)
    expect(exceptionsFor(readiness, null)[0].id).toBe(exception.id)
    const saved = cleanSignoff(JSON.parse(JSON.stringify({ exceptions: { [exception.id]: { disposition: 'accepted', reason: 'agreed with the client' } } })))
    expect(decisionFor(saved, exception)).toEqual({ disposition: 'accepted', reason: 'agreed with the client' })
  })

  it('two different rules get different ids', () => {
    const two = { checks: [readiness.checks[0], { ...readiness.checks[0], description: `${longRule}, CODE-60` }] }
    const [a, b] = exceptionsFor(two, null)
    expect(a.id).not.toBe(b.id)
  })

  it('a decision saved under the old id — the description itself — is still read', () => {
    const short = { checks: [{ ...readiness.checks[0], description: '"code" must not be blank' }] }
    const [exception] = exceptionsFor(short, null)
    const saved = cleanSignoff({ exceptions: { 'readiness|"code" must not be blank': { disposition: 'corrected' } } })
    expect(decisionFor(saved, exception)).toEqual({ disposition: 'corrected' })
  })
})
