import { describe, expect, it } from 'vitest'
import { findingTable } from './findingTable.js'
import { reconcile } from './reconcile.js'

const source = Array.from({ length: 12 }, (_, i) => ({ id: `K${i}`, amount: String(i), grade: i === 3 ? 'G4' : 'G7', unit: 'U1' }))
const target = source.filter((_, i) => i !== 5).map((row, i) => ({ ...row, amount: i === 1 ? '99' : row.amount, grade: 'Lead' }))
const spec = {
  key: 'id',
  mapping: [{ source: 'amount' }, { source: 'grade', map: { G7: 'Lead' } }],
  totals: [{ source: 'amount', target: 'amount', groupBy: { source: 'unit', target: 'unit' } }],
}

describe('findingTable', () => {
  const report = reconcile(spec, source, target)
  const table = (code) => findingTable(report.findings.find((f) => f.code === code), report)

  it('lists missing records by key', () => {
    expect(table('missing-in-target')).toEqual({ columns: ['Key'], rows: [['K5']], shown: 1, total: 1 })
  })

  it('shows source, expected and target for a mismatch', () => {
    expect(table('field-mismatch').rows).toEqual([['K1', '1', '1', '99']])
  })

  it('lists unmapped legacy values with how many records carry them', () => {
    expect(table('unmapped-value').rows).toEqual([['G4', 1]])
  })

  it('shows each broken total with its difference', () => {
    expect(table('total-mismatch')).toMatchObject({ columns: ['Group', 'Source total', 'Target total', 'Difference'], rows: [['U1', 66, 159, 93]] }) // 66 - 5 (K5 missing) - 1 + 99 (K1 changed)
  })

  it('says how many there are in all when it shows fewer', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), v: '1' }))
    const r = reconcile({ key: 'id', mapping: [{ source: 'v' }] }, many, many.map((row) => ({ ...row, v: '2' })))
    const t = findingTable(r.findings[0], r)
    expect([t.shown, t.total]).toEqual([5, 30])
  })
})
