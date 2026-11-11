import { describe, expect, it } from 'vitest'
import { runnableContract, runnableSpec } from '../lib/migrationObject.js'
import { parseCsv } from '../lib/parseCsv.js'
import { checkReadiness } from '../lib/readiness.js'
import { reconcile } from '../lib/reconcile.js'
import { referenceValues } from '../lib/rules.js'
import { financeAccounts, financeLoadFile, financeSampleObject, financeSource, financeTarget } from './financeSample.js'
import { MIGRATION_EXAMPLES } from './migrationExamples.js'

// The finance example tells one story. If a rule, a format or the pack changes
// so that it stops telling it, the example has become a lie — so it is pinned.

const object = financeSampleObject()
const source = parseCsv(financeSource())
const target = parseCsv(financeTarget())
const load = parseCsv(financeLoadFile())
const accounts = parseCsv(financeAccounts())
const references = { accounts: { columns: accounts.columns, values: { 'Account Name': referenceValues(accounts.rows, 'Account Name') } } }

describe('the finance example', () => {
  it('parses cleanly, and the old books balance', () => {
    for (const file of [source, target, load, accounts]) expect(file.errors).toEqual([])
    expect(source.rows).toHaveLength(10)
    // Tally writes lakh and crore: "12,25,000.50".
    expect(source.rows.find((r) => r.Particulars === 'HDFC Current').Debit).toBe('12,25,000.50')
  })

  it('before the load: the file total does not tie, and one ledger is not in the chart', () => {
    const report = checkReadiness(runnableContract(object), load.rows, { columns: load.columns, key: object.spec.key.target, references })
    expect(report.status).toBe('NOT_READY')
    expect(report.checks.filter((c) => c.status === 'FAIL').map((c) => c.kind).sort()).toEqual(['aggregate', 'reference'])
    expect(report.checks.find((c) => c.kind === 'aggregate')).toMatchObject({ fileLevel: true, groups: [{ group: null, value: '2,280,500.5 against 2,280,000.5 (difference 500)' }] })
    expect(report.checks.find((c) => c.kind === 'reference').examples.map((e) => e.record)).toEqual(['Suspense'])
    expect(report.counts).toMatchObject({ records: 10, rejected: 1 })
  })

  it('after the load: every key is sound, one ledger never arrived, one balance changed, neither total ties', () => {
    const report = reconcile(runnableSpec(object), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns })
    expect(Object.fromEntries(report.steps.map((s) => [s.id, s.status]))).toEqual({ keys: 'PASS', completeness: 'FAIL', mapping: 'SKIPPED', accuracy: 'FAIL', totals: 'FAIL' })
    expect(report.counts).toMatchObject({ expected: 10, matched: 9, missing: 1, extra: 0, rowsWithDifference: 1 })
    expect(report.headline).toMatch(/^Stopped at Completeness/)
    const accuracy = report.steps.find((s) => s.id === 'accuracy').findings
    expect(accuracy.map((f) => [f.column, f.examples.map((e) => e.key)])).toEqual([['Debit', ['HDFC CURRENT']]]) // a key compared without case is shown folded
    expect(report.totals.map((t) => [t.target, t.groups[0].difference])).toEqual([['Debit', 500], ['Credit', -25000]])
  })

  it('with the slip corrected and Suspense in the chart, both checks pass — the breaks are the planted ones and nothing else', () => {
    const fixed = parseCsv(financeLoadFile().replace('1225500.50', '1225000.50'))
    const all = { accounts: { columns: ['Account Name'], values: { 'Account Name': new Set([...references.accounts.values['Account Name'], 'Suspense']) } } }
    expect(checkReadiness(runnableContract(object), fixed.rows, { columns: fixed.columns, key: object.spec.key.target, references: all }).status).toBe('READY')
    expect(reconcile(runnableSpec(object), source.rows, fixed.rows, { sourceColumns: source.columns, targetColumns: fixed.columns }).status).toBe('PASS')
  })
})

describe('the worked examples', () => {
  it('finance comes first, and every example names a file for each role its checks read', () => {
    expect(MIGRATION_EXAMPLES.map((e) => e.id)).toEqual(['finance', 'employees'])
    for (const example of MIGRATION_EXAMPLES) {
      const roles = example.files.map((f) => f.role)
      expect(roles).toEqual(expect.arrayContaining(['load', 'source', 'target']))
      const referenced = example.object().contract.rules.filter((r) => r.kind === 'reference').map((r) => `reference:${r.target.file}`)
      expect(roles).toEqual(expect.arrayContaining(referenced))
      for (const file of example.files) expect(parseCsv(file.text()).errors).toEqual([])
    }
  })
})
