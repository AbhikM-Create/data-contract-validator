import { describe, expect, it } from 'vitest'
// The test builds real workbooks with the library's writer; the app itself only
// ever reads, through parseXlsx.js.
import { utils, write } from 'xlsx'
import { parseCsv, toCsv } from './parseCsv.js'
import { looksLikeWorkbook, parseXlsx, plainNumber } from './parseXlsx.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { runnableContract, runnableSpec } from './migrationObject.js'

const book = (sheets, { hidden = [], merges = {} } = {}) => {
  const wb = utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = utils.aoa_to_sheet(aoa, { cellDates: false })
    if (merges[name]) ws['!merges'] = merges[name]
    utils.book_append_sheet(wb, ws, name)
  }
  wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) }
  return new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' }))
}

// A cell with an explicit type and number format, as Excel stores it.
const dateCell = (serial) => ({ t: 'n', v: serial, z: 'yyyy-mm-dd' })

describe('parseXlsx — cells keep what they hold', () => {
  const bytes = book({
    Employees: [
      ['employee_id', 'last_name', 'annual_salary', 'hire_date', 'active'],
      [40100, 'OKAFOR', 52000.5, dateCell(40917), true],
      [40101, 'Lindqvist', 61234, dateCell(45352), false],
    ],
  })

  it('numbers, dates, text and booleans', () => {
    const r = parseXlsx(bytes)
    expect(r.errors).toEqual([])
    expect(r.columns).toEqual(['employee_id', 'last_name', 'annual_salary', 'hire_date', 'active'])
    expect(r.rows[0]).toEqual({ employee_id: '40100', last_name: 'OKAFOR', annual_salary: '52000.5', hire_date: '2012-01-09', active: 'true' })
    expect(r.rows[1].hire_date).toBe('2024-03-01')
  })

  it('a stored number is written in the declared decimal mark, so the declared reader reads the same number', () => {
    expect(parseXlsx(bytes, { decimal: ',' }).rows[0].annual_salary).toBe('52000,5')
    expect(plainNumber(1e21)).toBe('1000000000000000000000')
    expect(plainNumber(1.5e-7)).toBe('0.00000015')
    expect(plainNumber(-0.25, ',')).toBe('-0,25')
  })

  it('recognises a workbook by its bytes, and refuses legacy .xls with the fix', () => {
    expect(looksLikeWorkbook(bytes)).toBe(true)
    expect(looksLikeWorkbook(new TextEncoder().encode('a,b\n1,2\n'))).toBe(false)
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(parseXlsx(xls).errors[0]).toMatch(/older \.xls format.*save it as \.xlsx/)
    expect(parseXlsx(new TextEncoder().encode('a,b\n1,2\n')).errors[0]).toMatch(/not an \.xlsx workbook/)
  })
})

describe('parseXlsx — sheets and header rows', () => {
  const bytes = book({
    Notes: [['Exported from Tally on 31-Mar-2026']],
    Ledger: [['Trial balance as at 31-Mar-2026'], ['ledger', 'debit', 'credit'], ['Cash', 1200, 0], ['Sales', 0, 1200]],
    Secret: [['x'], [1]],
  }, { hidden: ['Notes', 'Secret'] })

  it('lists every sheet, hidden ones marked, and reads the first visible sheet by default', () => {
    const r = parseXlsx(bytes, { headerRow: 2 })
    expect(r.sheets).toEqual([{ name: 'Notes', hidden: true }, { name: 'Ledger', hidden: false }, { name: 'Secret', hidden: true }])
    expect(r.sheet).toBe('Ledger')
    expect(r.columns).toEqual(['ledger', 'debit', 'credit'])
    expect(r.rows).toEqual([{ ledger: 'Cash', debit: '1200', credit: '0' }, { ledger: 'Sales', debit: '0', credit: '1200' }])
  })

  it('a title row above the header, read as the header, is refused — not guessed past', () => {
    const r = parseXlsx(bytes, { sheet: 'Ledger', headerRow: 1 })
    expect(r.rows).toEqual([])
    expect(r.errors[0]).toMatch(/column B has values but no name in row 1/)
  })

  it('merged cells are refused with where they are', () => {
    const merged = book({ S: [['Pay', null, 'id'], ['basic', 'hra', ''], [100, 40, 1]] }, { merges: { S: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] } })
    expect(parseXlsx(merged).errors[0]).toMatch(/merged cells \(A1:B1\)/)
  })

  it('a repeated column name is refused as in a CSV; an unknown sheet is named', () => {
    expect(parseXlsx(book({ S: [['id', 'id'], [1, 2]] })).errors[0]).toMatch(/uses the name "id" more than once/)
    expect(parseXlsx(bytes, { sheet: 'Nope' }).errors[0]).toMatch(/no sheet called "Nope"/)
    expect(parseXlsx(book({ S: [['id', 'name']] })).errors[0]).toMatch(/header row but no data rows/)
  })
})

describe('parseXlsx — formulas and mixed columns are reported, never recalculated', () => {
  it('a formula reads its cached value; one with none is unreadable and reported', () => {
    const wb = utils.book_new()
    const ws = utils.aoa_to_sheet([['a', 'b', 'total'], [1, 2, 0], [3, 4, 0]])
    ws.C2 = { t: 'n', v: 3, f: 'A2+B2' }
    ws.C3 = { t: 'n', f: 'A3+B3' } // no cached value
    utils.book_append_sheet(wb, ws, 'S')
    const r = parseXlsx(new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' })))
    expect(r.rows[0].total).toBe('3')
    expect(r.rows[1].total).toBe('=A3+B3')
    expect(r.notes.join(' ')).toMatch(/1 formula cell has no saved value/)
  })

  it('a column mixing stored numbers and numbers typed as text says so', () => {
    const r = parseXlsx(book({ S: [['id', 'amount'], [1, 1200], [2, '1,200.00'], [3, '900']] }))
    expect(r.rows.map((row) => row.amount)).toEqual(['1200', '1,200.00', '900'])
    expect(r.notes.join(' ')).toMatch(/column "amount" mixes 1 number stored as numbers with 2 stored as text/)
  })
})

// v3 F7: the Excel and CSV versions of the same data give identical reports.
describe('parseXlsx — Excel and CSV of the same data give identical reports', () => {
  // The sample's files as workbooks: digits stored as numbers, everything else
  // as text — what Excel holds after a user types or pastes these values.
  const asWorkbook = (csvText) => {
    const { columns, rows } = parseCsv(csvText)
    const typedValue = (v) => (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v) ? Number(v) : v)
    return book({ Data: [columns, ...rows.map((row) => columns.map((c) => typedValue(row[c])))] })
  }
  // The CSV that holds exactly those stored values: what the workbook says.
  const asCsv = (bytes) => {
    const r = parseXlsx(bytes)
    return parseCsv(toCsv(r.columns, r.rows.map((row) => r.columns.map((c) => row[c]))))
  }

  it('load readiness', () => {
    const xlsx = parseXlsx(asWorkbook(migrationLoadFile()))
    const csv = asCsv(asWorkbook(migrationLoadFile()))
    const contract = runnableContract(migrationSampleObject())
    const fromXlsx = checkReadiness(contract, xlsx.rows, { columns: xlsx.columns, key: ['employee_id'] })
    const fromCsv = checkReadiness(contract, csv.rows, { columns: csv.columns, key: ['employee_id'] })
    expect(fromXlsx.status).toBe('NOT_READY')
    expect(fromXlsx).toEqual(fromCsv)
  })

  it('reconciliation', () => {
    const spec = runnableSpec(migrationSampleObject())
    const xs = parseXlsx(asWorkbook(migrationSource()))
    const xt = parseXlsx(asWorkbook(migrationTarget()))
    const cs = asCsv(asWorkbook(migrationSource()))
    const ct = asCsv(asWorkbook(migrationTarget()))
    const fromXlsx = reconcile(spec, xs.rows, xt.rows, { sourceColumns: xs.columns, targetColumns: xt.columns })
    const fromCsv = reconcile(spec, cs.rows, ct.rows, { sourceColumns: cs.columns, targetColumns: ct.columns })
    expect(fromXlsx.status).toBe('FAIL')
    expect(fromXlsx).toEqual(fromCsv)
  })

  it('and the verdicts match the original CSV sample', () => {
    const contract = runnableContract(migrationSampleObject())
    const original = parseCsv(migrationLoadFile())
    const xlsx = parseXlsx(asWorkbook(migrationLoadFile()))
    const a = checkReadiness(contract, original.rows, { columns: original.columns, key: ['employee_id'] })
    const b = checkReadiness(contract, xlsx.rows, { columns: xlsx.columns, key: ['employee_id'] })
    expect(b.status).toBe(a.status)
    expect(b.counts).toEqual(a.counts)
  })
})
