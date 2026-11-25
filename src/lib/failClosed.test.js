import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './parseCsv.js'
import { reconcile } from './reconcile.js'

// Review of 15 Nov 2026: three places where a check quietly checked less than it
// claimed. Each case failed on the old code.

describe('a misspelt spec field is refused, never ignored', () => {
  it('"mappings" for "mapping" makes the spec INVALID (it removed the accuracy step and read PASS)', () => {
    const source = [{ id: '1', v: 'a' }]
    const target = [{ id: '1', v: 'b' }]
    const report = reconcile({ key: 'id', mappings: [{ source: 'v' }], total: [] }, source, target)
    expect(report.status).toBe('INVALID')
    expect(report.issues.join(' ')).toMatch(/"mappings" is not a field of a reconciliation spec/)
    expect(report.issues.join(' ')).toMatch(/"total" is not a field/)
  })

  it('so is a misspelt option inside a field', () => {
    const report = reconcile({ key: 'id', mapping: [{ source: 'v', tolerence: 1 }] }, [{ id: '1', v: '1' }], [{ id: '1', v: '1' }])
    expect(report.status).toBe('INVALID')
    expect(report.issues.join(' ')).toMatch(/"tolerence" is not a field of mapping field 1/)
  })

  it('a spec with only known fields runs as before', () => {
    const report = reconcile({ name: 'x', key: { source: 'id', target: 'id' }, mapping: [{ source: 'v', compareAs: 'text' }], totals: [{ fn: 'count', groupBy: { source: 'v' } }] }, [{ id: '1', v: 'a' }], [{ id: '1', v: 'a' }])
    expect(report.status).toBe('PASS')
  })
})

describe('a column with no header', () => {
  it('that holds a value is refused with its line (it was dropped without a word)', () => {
    const parsed = parseCsv('Emp,,CTC\nE1,secret-old,100\n')
    expect(parsed.rows).toEqual([])
    expect(parsed.errors[0]).toMatch(/a column has no header but holds a value on line 2/)
  })

  it('that is empty — a trailing comma on every line — is harmless and stays silent', () => {
    expect(parseCsv('Emp,CTC,\nE1,100,\n').errors).toEqual([])
    expect(parseCsv('Emp,,CTC\nE1,,100\n').columns).toEqual(['Emp', 'CTC'])
  })
})

describe('the fix list', () => {
  it('never writes a live formula, and leaves amounts alone', () => {
    const csv = toCsv(['value'], [['=HYPERLINK("x")'], ['@SUM(1)'], ['+1+1'], ['-500'], ['-1,200.50'], ['ok']])
    const cells = parseCsv(csv).rows.map((r) => r.value)
    expect(cells).toEqual([`'=HYPERLINK("x")`, "'@SUM(1)", "'+1+1", '-500', '-1,200.50', 'ok'])
  })
})

describe('the streamed fix list (dcv check --rejects) is guarded too', () => {
  it('csvRows writes no live formula', async () => {
    const { csvRows } = await import('./parseCsv.js')
    // A guarded cell is quoted, so the apostrophe survives any reader.
    expect(csvRows([['=1+1', '-500', '@x']])).toBe(`"'=1+1",-500,"'@x"\n`)
  })
})
