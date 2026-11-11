import { describe, expect, it } from 'vitest'
import { parseContractFile, contractToJson } from './contractFile.js'
import { createReader } from './formats.js'
import { checkRules, createRuleChecker, describeRule, referenceValues, ruleIssue, ruleLayer } from './rules.js'

// v3 §5.1: identifier, unique, aggregate, reference. Each is checked by the one
// evaluator (createRuleChecker), and each has a negative control.

const outcome = (rule, rows, options) => checkRules([rule], rows, options)[0]

describe('identifier', () => {
  const rule = { kind: 'identifier', column: 'gstin', op: 'is', target: 'gstin' }
  it('passes valid values, fails invalid ones, skips blanks', () => {
    const o = outcome(rule, [{ gstin: '27AAPFU0939F1ZV' }, { gstin: '27AAPFU0939F1ZO' }, { gstin: '' }])
    expect(o.status).toBe('FAIL')
    expect(o.applicable).toBe(3) // as for every kind: rows the rule applies to, blanks included
    expect(o.failures).toEqual([{ row: 2, value: '27AAPFU0939F1ZO' }])
    expect(o.violation.message).toMatch(/must hold a valid GSTIN, check character included/)
    expect(ruleLayer(rule)).toBe('schema')
  })
  it('an unknown identifier is a malformed rule, never a PASS', () => {
    const o = outcome({ ...rule, target: 'aadhaar' }, [{ gstin: 'x' }])
    expect(o.status).toBe('UNCHECKED')
    expect(o.violation.code).toBe('rule:invalid')
  })
})

describe('unique', () => {
  it('every copy of a repeated value fails, the first included', () => {
    const o = outcome({ kind: 'unique', column: 'id', op: 'unique' }, [{ id: '1' }, { id: '2' }, { id: '1' }, { id: '' }])
    expect(o.status).toBe('FAIL')
    expect(o.failures.map((f) => f.row)).toEqual([1, 3])
    expect(o.applicable).toBe(4)
  })
  it('a set of columns: (employee_id, month) may repeat employee_id across months', () => {
    const rows = [{ e: '1', m: 'Apr' }, { e: '1', m: 'May' }, { e: '1', m: 'Apr' }]
    const o = outcome({ kind: 'unique', column: 'e', op: 'unique', target: ['m'] }, rows)
    expect(o.failures.map((f) => f.row)).toEqual([1, 3])
    expect(describeRule({ kind: 'unique', column: 'e', target: ['m'] })).toBe('"e" + "m" must identify each record exactly once')
    expect(outcome({ kind: 'unique', column: 'e', op: 'unique', target: ['m'] }, rows.slice(0, 2)).status).toBe('PASS')
  })
  it('without its repeated values found first, the rule is UNCHECKED — never judged against nothing', () => {
    const checker = createRuleChecker([{ kind: 'unique', column: 'id', op: 'unique' }])
    checker.row({ id: '1' }, 1)
    expect(checker.outcomes(1)[0].violation.code).toBe('rule:not-prepared')
  })
  it('a column it names that the file lacks is UNCHECKED', () => {
    const o = outcome({ kind: 'unique', column: 'e', op: 'unique', target: ['month'] }, [{ e: '1' }], { columns: ['e'] })
    expect(o.violation.code).toBe('rule:missing-column')
  })
})

describe('aggregate', () => {
  const tb = [
    { ledger: 'Cash', debit: '1,200.00', credit: '', company: 'DE01' },
    { ledger: 'Sales', debit: '', credit: '1,150.00', company: 'DE01' },
    { ledger: 'Bank', debit: '300.10', credit: '', company: 'DE02' },
    { ledger: 'Loan', debit: '', credit: '300.10', company: 'DE02' },
  ]
  const balanced = { kind: 'aggregate', column: 'debit', fn: 'sum', op: '=', target: 'credit', targetIsColumn: true }

  it('sum of debits against sum of credits: a 50.00 gap fails, and says the totals', () => {
    const o = outcome(balanced, tb)
    expect(o.status).toBe('FAIL')
    expect(o.violation.evidence).toBe('1,500.1 against 1,450.1 (difference 50)')
    expect(ruleLayer(balanced)).toBe('distribution')
  })
  it('per group: only the group that does not tie fails', () => {
    const o = outcome({ ...balanced, groupBy: 'company' }, tb)
    expect(o.applicable).toBe(2)
    expect(o.failures.map((f) => f.group)).toEqual(['DE01'])
    expect(o.violation.message).toMatch(/1 group of 2 does not/)
  })
  it('within a tolerance it holds; floating point never decides it', () => {
    expect(outcome({ ...balanced, tolerance: 50 }, tb).status).toBe('PASS')
    const cents = Array.from({ length: 1000 }, () => ({ a: '0.10', b: '' }))
    expect(outcome({ kind: 'aggregate', column: 'a', fn: 'sum', op: '=', target: '100' }, cents).status).toBe('PASS')
  })
  it('a count against a number', () => {
    const rule = { kind: 'aggregate', column: 'ledger', fn: 'count', op: '=', target: '4' }
    expect(outcome(rule, tb).status).toBe('PASS')
    expect(outcome({ ...rule, target: '5' }, tb).status).toBe('FAIL')
  })
  it('an amount that cannot be read makes the total unknown: UNCHECKED, never summed as zero', () => {
    const o = outcome(balanced, [...tb, { ledger: 'Odd', debit: 'n/a', credit: '' }])
    expect(o.status).toBe('UNCHECKED')
    expect(o.violation.code).toBe('rule:unreadable')
    expect(o.violation.message).toMatch(/1 value in "debit" or "credit" could not be read as numbers \(row 5\)/)
  })
  it('reads amounts in the file’s declared notation', () => {
    const eu = [{ d: '1.200,50', c: '' }, { d: '', c: '1.200,50' }]
    const rule = { kind: 'aggregate', column: 'd', fn: 'sum', op: '=', target: 'c', targetIsColumn: true }
    expect(outcome(rule, eu, { reader: createReader({ decimal: ',' }) }).status).toBe('PASS')
    expect(outcome(rule, eu).status).toBe('UNCHECKED') // undeclared: not read as numbers at all
  })
  it('rejects a malformed aggregate with the reason', () => {
    expect(ruleIssue({ kind: 'aggregate', column: 'a', fn: 'avg', op: '=', target: '1' })).toMatch(/"avg" is not an aggregate/)
    expect(ruleIssue({ kind: 'aggregate', column: 'a', fn: 'sum', op: '=', target: 'lots' })).toMatch(/compared with a number/)
    expect(ruleIssue({ kind: 'aggregate', column: 'a', fn: 'sum', op: '=', target: '1', tolerance: -1 })).toMatch(/tolerance/)
  })
})

describe('reference', () => {
  const rule = { kind: 'reference', column: 'vendor_id', op: 'in', target: { file: 'vendors', column: 'id' } }
  const vendors = [{ id: 'V1' }, { id: 'V2' }, { id: '' }]
  const references = { vendors: { columns: ['id'], values: { id: referenceValues(vendors, 'id') } } }

  it('every value must exist in the reference file; blanks are not applicable', () => {
    const o = outcome(rule, [{ vendor_id: 'V1' }, { vendor_id: 'V9' }, { vendor_id: '' }], { references })
    expect(o.status).toBe('FAIL')
    expect(o.failures).toEqual([{ row: 2, value: 'V9' }])
    expect(ruleLayer(rule)).toBe('semantics')
  })
  it('a reference file not provided, or without the column, is UNCHECKED with the reason', () => {
    expect(outcome(rule, [{ vendor_id: 'V1' }]).violation.message).toMatch(/reference file "vendors" was not provided/)
    const o = outcome({ ...rule, target: { file: 'vendors', column: 'code' } }, [{ vendor_id: 'V1' }], { references })
    expect(o.violation.message).toMatch(/has no column "code"/)
  })
})

describe('the new kinds in a saved contract', () => {
  it('round-trip exactly, and an older contract reads as before', () => {
    const rules = [
      { kind: 'identifier', column: 'pan', op: 'is', target: 'pan' },
      { kind: 'unique', column: 'e', op: 'unique', target: ['m'] },
      { kind: 'aggregate', column: 'debit', op: '=', target: 'credit', targetIsColumn: true, fn: 'sum', groupBy: 'company', tolerance: 0.01 },
      { kind: 'reference', column: 'vendor_id', op: 'in', target: { file: 'vendors', column: 'id' } },
    ]
    const back = parseContractFile(contractToJson({ name: 'v3', rules }))
    expect(back.skipped).toEqual([])
    expect(back.rules).toEqual(rules)
  })
})

describe('the new kinds in validate()', () => {
  it('report through their layers; a reference rule with no file is UNCHECKED, never PASS', async () => {
    const { validate } = await import('./validate.js')
    const { defineContract } = await import('./authoredContract.js')
    const rows = [{ id: '1', pan: 'ABCPE1234F', amt: '10' }, { id: '1', pan: 'BAD', amt: '20' }, { id: '2', pan: 'ABCPE1234F', amt: '5' }]
    const contract = defineContract({
      rules: [
        { kind: 'unique', column: 'id', op: 'unique' },
        { kind: 'identifier', column: 'pan', op: 'is', target: 'pan' },
        { kind: 'aggregate', column: 'amt', fn: 'sum', op: '=', target: '100' },
        { kind: 'reference', column: 'id', op: 'in', target: { file: 'x', column: 'id' } },
      ],
    })
    const result = validate(contract, rows, {})
    expect(result.status).toBe('FAIL')
    expect(result.rules.map((o) => [o.rule.kind, o.status, o.violation?.layer])).toEqual([
      ['unique', 'FAIL', 'schema'], ['identifier', 'FAIL', 'schema'], ['aggregate', 'FAIL', 'distribution'], ['reference', 'UNCHECKED', 'semantics'],
    ])
  })
})
