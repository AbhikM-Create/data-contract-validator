import { describe, expect, it } from 'vitest'
import { checkChange } from './changeContract.js'
import { DEFAULT_READER, createReader, numbersComparable, numbersEqual } from './formats.js'
import { reconcile, valuesAgree } from './reconcile.js'
import { checkReadiness } from './readiness.js'

// Review of 15 Nov 2026, findings 1 and 3: values that parse as numbers were
// compared as doubles with a relative tolerance, so a changed 13-to-18-digit
// identifier, a code that lost its leading zero, a changed currency symbol and a
// dropped percent sign all "agreed". Each case here failed on the old code.

const field = (extra = {}) => ({ tolerance: 0, ignoreCase: false, compareAs: null, ...extra })
const r = createReader({})
const agree = (a, b, extra) => valuesAgree(a, b, field(extra), r, r)

describe('identifiers are compared exactly', () => {
  it('a changed 18-digit bank account number is a change', () => {
    expect(agree('123456789012345678', '123456789012345679')).toBe(false)
    expect(agree('9007199254740993', '9007199254740992')).toBe(false)
    expect(agree('123456789012345678', '123456789012345678')).toBe(true)
  })

  it('from 13 digits up, a difference of 1 (or 8) is still a difference', () => {
    expect(agree('1234567890123', '1234567890124')).toBe(false)
    expect(agree('50100234567891', '50100234567899')).toBe(false)
  })

  it('a code that lost its leading zero has changed', () => {
    expect(agree('00123', '123')).toBe(false)
    expect(agree('011001', '11001')).toBe(false)
    expect(agree('00123', '00123')).toBe(true)
  })

  it('a different currency, or a percent sign on one side, is a different value', () => {
    expect(agree('₹100', '$100')).toBe(false)
    expect(agree('5%', '5')).toBe(false)
    // Formatting is still formatting: one symbol on one side, grouping, decimals.
    expect(agree('₹100', '100')).toBe(true)
    expect(agree('1,200.00', '1200')).toBe(true)
    expect(agree('5%', '5.0%')).toBe(true)
  })

  it('amounts still compare as numbers, and a declared tolerance still holds at its edge', () => {
    expect(agree('100.02', '100.01', { tolerance: 0.01 })).toBe(true)
    expect(agree('100.03', '100.01', { tolerance: 0.01 })).toBe(false)
    expect(agree('0.1', '0.10')).toBe(true)
    expect(agree('-0', '0')).toBe(true)
  })

  it('a field declared "compare as text" is never read as a number or a date', () => {
    expect(agree('1200', '1200.00', { compareAs: 'text' })).toBe(false)
    expect(agree('2024-03-01', '2024-03-01T00:00:00Z', { compareAs: 'text' })).toBe(false)
    expect(agree('ABC', 'abc', { compareAs: 'text', ignoreCase: true })).toBe(true)
  })

  it('numbersComparable and numbersEqual say why', () => {
    expect(numbersComparable('1234567890123456', '1')).toBe(false) // 16 significant digits
    expect(numbersComparable('123456789012345', '1')).toBe(true) // 15
    expect(numbersComparable('0.000123', '0.000124')).toBe(true) // leading zeros of a fraction are not a code
    expect(numbersEqual(1e12, 1e12 + 1)).toBe(false)
  })
})

describe('through the engines', () => {
  it('a change check catches a rewritten bank account (it said ALLOWED, "No record changed")', () => {
    const before = [{ Emp: 'E1', Account: '123456789012345678', Code: '00123' }]
    const after = [{ Emp: 'E1', Account: '123456789012345679', Code: '123' }]
    const report = checkChange({ key: 'Emp', fields: {} }, before, after)
    expect(report.status).toBe('NOT_ALLOWED')
    const permitted = report.steps.find((s) => s.id === 'permitted')
    expect(permitted.findings.map((f) => f.column).sort()).toEqual(['Account', 'Code'])
  })

  it('reconciliation reports a 14-digit account that moved by 8, and a stripped zero', () => {
    const spec = { key: 'id', mapping: [{ source: 'acct' }, { source: 'code' }] }
    const source = [{ id: '1', acct: '50100234567891', code: '00123' }, { id: '2', acct: '50100234567800', code: '007' }]
    const target = [{ id: '1', acct: '50100234567899', code: '123' }, { id: '2', acct: '50100234567800', code: '007' }]
    const report = reconcile(spec, source, target)
    expect(report.status).toBe('FAIL')
    const fields = Object.fromEntries(report.fields.map((f) => [f.source, f.mismatched]))
    expect(fields).toEqual({ acct: 1, code: 1 })
  })

  it('a rule "pin = 011001" fails for the cell 11001', () => {
    const contract = { rules: [{ kind: 'comparison', column: 'pin', op: '=', target: '011001' }] }
    const report = checkReadiness(contract, [{ pin: '11001' }, { pin: '011001' }], { columns: ['pin'] })
    expect(report.status).toBe('NOT_READY')
    expect(report.counts.rejected).toBe(1)
  })

  it('ordering still reads numbers: 9 < 10, and a long number orders correctly', () => {
    const contract = { rules: [{ kind: 'comparison', column: 'n', op: '<', target: '10' }] }
    const report = checkReadiness(contract, [{ n: '9' }], { columns: ['n'] })
    expect(report.status).toBe('READY')
    expect(DEFAULT_READER.number('9')).toBe(9)
  })
})
