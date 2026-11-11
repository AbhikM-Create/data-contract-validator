import { describe, expect, it } from 'vitest'
import { newMigrationObject } from './migrationObject.js'
import { isCurrent, readinessStamp, reconciliationStamp } from './stamp.js'

const file = (name, rowCount, sha256) => ({ name, rowCount, sha256 })
const object = () => ({
  ...newMigrationObject('Employees'),
  wave: 'Wave 1',
  cycle: 'Mock 2',
  contract: { name: 'Employees (target)', rules: [{ kind: 'nullRule', column: 'last_name', op: 'notNull' }] },
  spec: { key: { source: ['PERNR'], target: ['employee_id'] }, mapping: [{ source: 'NACHN', target: 'last_name' }], totals: [] },
})

describe('result stamps', () => {
  // The defect this module exists for: the old stamp was name + row count, so a
  // different file with the same name and length was attested with the old result.
  it('a different file with the same name and row count is NOT current', () => {
    const o = object()
    const ran = readinessStamp(o, { load: file('load.csv', 46, 'aaa') })
    const now = readinessStamp(o, { load: file('load.csv', 46, 'bbb') })
    expect(isCurrent(ran, now)).toBe(false)

    const recRan = reconciliationStamp(o, { source: file('s.csv', 48, 's1'), target: file('t.csv', 47, 't1') })
    const recNow = reconciliationStamp(o, { source: file('s.csv', 48, 's1'), target: file('t.csv', 47, 't2') })
    expect(isCurrent(recRan, recNow)).toBe(false)
  })

  it('the same bytes under another name are still current', () => {
    const o = object()
    expect(isCurrent(
      readinessStamp(o, { load: file('load.csv', 46, 'aaa') }),
      readinessStamp(o, { load: file('load (1).csv', 46, 'aaa') }),
    )).toBe(true)
  })

  it('a file without a fingerprint is never current', () => {
    const o = object()
    const unhashed = { load: file('load.csv', 46, undefined) }
    expect(readinessStamp(o, unhashed)).toBeNull()
    expect(isCurrent(readinessStamp(o, unhashed), readinessStamp(o, unhashed))).toBe(false)
    expect(reconciliationStamp(o, { source: file('s.csv', 1, 's'), target: null })).toBeNull()
  })

  it('changing a rule, the key, a mapping or a format makes the result stale', () => {
    const o = object()
    const files = { load: file('load.csv', 46, 'aaa'), source: file('s.csv', 48, 's1'), target: file('t.csv', 47, 't1') }
    const ready = readinessStamp(o, files)
    const rec = reconciliationStamp(o, files)

    expect(readinessStamp({ ...o, contract: { ...o.contract, rules: [] } }, files)).not.toBe(ready)
    expect(readinessStamp({ ...o, spec: { ...o.spec, key: { ...o.spec.key, target: ['id'] } } }, files)).not.toBe(ready)
    expect(readinessStamp({ ...o, formats: { load: { decimal: ',' } } }, files)).not.toBe(ready)
    expect(reconciliationStamp({ ...o, spec: { ...o.spec, mapping: [] } }, files)).not.toBe(rec)
  })

  it('the wave and cycle are part of the stamp, because the pack is titled with them', () => {
    const o = object()
    const files = { load: file('load.csv', 46, 'aaa'), source: file('s.csv', 48, 's1'), target: file('t.csv', 47, 't1') }
    expect(readinessStamp({ ...o, cycle: 'Mock 3' }, files)).not.toBe(readinessStamp(o, files))
    expect(reconciliationStamp({ ...o, wave: 'Wave 2' }, files)).not.toBe(reconciliationStamp(o, files))
  })

  it('the same workbook read from another sheet or header row is NOT current', () => {
    const o = object()
    const ran = readinessStamp(o, { load: { ...file('load.xlsx', 46, 'aaa'), sheet: 'Employees', headerRow: 1 } })
    expect(isCurrent(ran, readinessStamp(o, { load: { ...file('load.xlsx', 46, 'aaa'), sheet: 'Contractors', headerRow: 1 } }))).toBe(false)
    expect(isCurrent(ran, readinessStamp(o, { load: { ...file('load.xlsx', 46, 'aaa'), sheet: 'Employees', headerRow: 2 } }))).toBe(false)
    expect(isCurrent(ran, readinessStamp(o, { load: { ...file('load.xlsx', 46, 'aaa'), sheet: 'Employees', headerRow: 1 } }))).toBe(true)
  })

  it('renaming the object changes neither stamp', () => {
    const o = object()
    const files = { load: file('load.csv', 46, 'aaa'), source: file('s.csv', 48, 's1'), target: file('t.csv', 47, 't1') }
    expect(readinessStamp({ ...o, name: 'Staff' }, files)).toBe(readinessStamp(o, files))
    expect(reconciliationStamp({ ...o, name: 'Staff' }, files)).toBe(reconciliationStamp(o, files))
  })
})

// final-spec C1: a result belongs to the column matching it was run under.
describe('stamps and column matching', () => {
  it('changing a match makes that check stale, and leaves the other check alone', async () => {
    const { readinessStamp, reconciliationStamp, isCurrent } = await import('./stamp.js')
    const { newMigrationObject } = await import('./migrationObject.js')
    const object = newMigrationObject('Chart')
    const files = { load: { sha256: 'a' }, source: { sha256: 'b' }, target: { sha256: 'c' } }
    const ready = readinessStamp(object, files)
    const recon = reconciliationStamp(object, files)
    const matched = { ...object, columnMap: { source: { Name: 'Ledger Name' } } }
    expect(isCurrent(recon, reconciliationStamp(matched, files))).toBe(false)
    expect(isCurrent(ready, readinessStamp(matched, files))).toBe(true)
    expect(isCurrent(ready, readinessStamp({ ...object, columnMap: { load: { Name: 'Account' } } }, files))).toBe(false)
    expect(isCurrent(ready, readinessStamp({ ...object, columnMap: { 'reference:accounts': { 'Account Name': 'Account' } } }, files))).toBe(false)
  })
})
