import { describe, expect, it } from 'vitest'
import { checkChange } from './changeContract.js'
import { parseDate } from './contract.js'
import { addCompensated, totalOf } from './formats.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

// Review of 15 Nov 2026, finding 8. Each case failed on the old code.

describe('dates nobody declared are never guessed, and never read in local time', () => {
  it('01/03/2024 is not read as a date at all (it was read month-first, as 3 January)', () => {
    expect(parseDate('01/03/2024')).toBeNull()
    expect(parseDate('13/03/2024')).toBeNull()
    const contract = { rules: [{ kind: 'type', column: 'd', op: '=', target: 'date' }] }
    const report = checkReadiness(contract, [{ d: '01/03/2024' }], { columns: ['d'] })
    expect(report.status).toBe('NOT_READY') // not a readable date until its pattern is declared
  })

  it('a date and time with no zone is UTC, whatever zone this machine is in', () => {
    expect(parseDate('2024-03-01 00:00:00')).toBe(Date.UTC(2024, 2, 1))
    expect(parseDate('2024/03/01')).toBe(Date.UTC(2024, 2, 1))
    expect(parseDate('2024-03-01T05:30:00+05:30')).toBe(Date.UTC(2024, 2, 1))
    expect(parseDate('2024-02-30')).toBeNull()
  })

  it('so a reconciliation of the same files gives one answer', () => {
    const spec = { key: 'id', mapping: [{ source: 'd' }] }
    const source = [{ id: '1', d: '2024-03-01 00:00:00' }, { id: '2', d: '2024/03/01' }]
    const target = [{ id: '1', d: '2024-03-01' }, { id: '2', d: '2024-03-01' }]
    expect(reconcile(spec, source, target).fields[0]).toMatchObject({ agreed: 2, mismatched: 0 })
  })
})

describe('control totals do not depend on row order', () => {
  it('the same amounts in two orders sum the same', () => {
    const amounts = [1e16, 1, -1e16, 3.3, 0.1, 0.2, -0.3]
    const a = { sum: 0, carry: 0 }
    const b = { sum: 0, carry: 0 }
    amounts.forEach((v) => addCompensated(a, v))
    ;[...amounts].reverse().forEach((v) => addCompensated(b, v))
    expect(totalOf(a)).toBe(totalOf(b))
  })

  it('a reconciliation total ties for identical records in a different order', () => {
    const rows = [['1', '1e16'], ['2', '1'], ['3', '-1e16'], ['4', '0.13']].map(([id, amt]) => ({ id, amt }))
    const spec = { key: 'id', totals: [{ source: 'amt' }] }
    const report = reconcile(spec, rows, [...rows].reverse())
    expect(report.totals[0].groups[0].ties).toBe(true)
  })

  it('a change-check total "must not move" holds for the same amounts reordered', () => {
    const rows = [['1', '1e16'], ['2', '1'], ['3', '-1e16']].map(([e, amt]) => ({ e, amt }))
    const report = checkChange({ key: 'e', totals: [{ column: 'amt', compare: 'equal' }] }, rows, [...rows].reverse())
    expect(report.totals[0].status).toBe('PASS')
  })

  it('and a real difference of 1 on a total of 1e12 is not absorbed', () => {
    const before = [{ e: '1', amt: '1000000000000' }]
    const after = [{ e: '1', amt: '1000000000001' }]
    const report = checkChange({ key: 'e', fields: { amt: { policy: 'free' } }, totals: [{ column: 'amt', compare: 'equal' }] }, before, after)
    expect(report.totals[0].status).toBe('FAIL')
  })
})
