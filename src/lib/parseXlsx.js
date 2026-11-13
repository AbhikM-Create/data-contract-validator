// Reading an Excel workbook (.xlsx) into the same rows a CSV becomes. Pure, and
// the ONLY module that knows about SheetJS — the way parseCsv.js is the only one
// that knows about papaparse.
//
// TallyPrime exports Excel, not CSV, and a hand-converted CSV is not what the
// source system produced: the evidence pack would fingerprint the conversion.
// So the workbook's own bytes are read, and fingerprinted, here.
//
// What a cell holds is kept, never reinterpreted:
//   - a number cell is written out as plain digits in the file's DECLARED
//     decimal notation (1234.56, or 1234,56 under a decimal comma), so the
//     declared reader reads back exactly the stored number — a declared format
//     never changes what a typed number means;
//   - a number cell whose number format shows a side — Tally's "25,000.00 Cr",
//     where the stored value is positive and only the format says credit —
//     keeps it: "25000 Cr". Undeclared that is not a number; declared (formats.js
//     side 'drcr') it reads signed. Dropping the format would read a credit as a
//     debit, and the balances would still add up;
//   - a date cell (a serial with a date format) becomes an ISO date, which every
//     reader reads whatever is declared;
//   - a text cell stays the text it is, and the declared format reads it, as in
//     a CSV.
// A formula is read by its cached value and never recalculated; one with no
// cached value is reported and left unreadable. Merged cells in the header or
// the data, and header rows with gaps above data (multi-row headers), are
// refused with the reason, rather than guessed at; merged cells wholly above
// the header row (a report title, as Tally writes) are left out with the rest
// of those rows. A column mixing stored numbers and numbers typed as text is
// reported. Legacy .xls (binary) is refused.

import { read, SSF } from 'xlsx'
import { isLegacyXls, isZip } from './fileKind.js'
import { readHeader } from './parseCsv.js'

export { looksLikeWorkbook } from './fileKind.js'

const refuse = (reason) => `Couldn’t read this workbook — ${reason}.`

// parseXlsx(bytes, { sheet, headerRow, decimal }) ->
//   { rows, columns, errors, notes, sheets: [{ name, hidden }], sheet, headerRow }
//
//   sheet      the sheet to read; default the first visible one
//   headerRow  1-based row that holds the column names; default 1
//   decimal    the file's declared decimal mark, '.' (default) or ','
export function parseXlsx(bytes, { sheet = null, headerRow = 1, decimal = '.' } = {}) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const empty = (error, extra = {}) => ({ rows: [], columns: [], errors: [error], notes: [], sheets: [], sheet: null, headerRow, ...extra })

  if (view.length === 0) return empty(refuse('the file is empty'))
  if (isLegacyXls(view)) return empty(refuse('it is in the older .xls format, which is not read here — open it in Excel and save it as .xlsx (Excel Workbook)'))
  if (!isZip(view)) return empty(refuse('it is not an .xlsx workbook'))

  let workbook
  try {
    workbook = read(view, { type: 'array', cellFormula: true, cellNF: true, cellDates: false, cellStyles: false })
  } catch (error) {
    return empty(refuse(`it could not be opened as an .xlsx workbook (${error?.message ?? 'unknown error'})`))
  }
  if (!workbook.SheetNames?.length || !workbook.Workbook) {
    return empty(refuse('it is not an .xlsx workbook'))
  }

  const sheets = workbook.SheetNames.map((name, i) => ({ name, hidden: Boolean(workbook.Workbook?.Sheets?.[i]?.Hidden) }))
  const chosen = sheet ?? sheets.find((s) => !s.hidden)?.name ?? sheets[0].name
  const base = { sheets, sheet: chosen, headerRow }
  const ws = workbook.Sheets[chosen]
  if (!ws) return { ...empty(refuse(`it has no sheet called "${chosen}"`)), ...base }
  if (!Number.isInteger(headerRow) || headerRow < 1) return { ...empty(refuse('the header row must be a row number from 1')), ...base }
  if (!ws['!ref']) return { ...empty(refuse(`the sheet "${chosen}" is empty`)), ...base }

  const range = decodeRange(ws['!ref'])
  const headerIndex = headerRow - 1
  // Rows above the header are not read, so a title merged across them is no
  // obstacle. A merge that reaches the header or the data still is.
  const allMerges = ws['!merges'] ?? []
  const merges = allMerges.filter((m) => m.e.r >= headerIndex)
  if (merges.length > 0) {
    const shown = merges.slice(0, 3).map(encodeRange).join(', ')
    return { ...empty(refuse(`the sheet "${chosen}" has merged cells (${shown}${merges.length > 3 ? `, +${merges.length - 3} more` : ''}), so its columns can’t be told apart reliably — unmerge them, or copy the data to a new sheet with one header row`)), ...base }
  }

  if (headerIndex > range.e.r) return { ...empty(refuse(`the sheet "${chosen}" has no row ${headerRow}`)), ...base }

  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904)
  const columnIndexes = []
  for (let c = range.s.c; c <= range.e.c; c += 1) columnIndexes.push(c)

  // The header: column names as text, checked by the same rules as a CSV's.
  const rawHeader = columnIndexes.map((c) => headerText(ws[cellAddress(headerIndex, c)]))
  const header = readHeader(rawHeader, null)
  if (header.error) return { ...empty(header.error.replace('Couldn’t read this file', 'Couldn’t read this workbook')), columns: header.columns, ...base }

  // A data column with no name in the header row is usually a two-row header
  // (a group title above, the names below) or the wrong header row chosen.
  for (const [i, c] of columnIndexes.entries()) {
    if (rawHeader[i] !== '') continue
    for (let r = headerIndex + 1; r <= range.e.r; r += 1) {
      if (hasValue(ws[cellAddress(r, c)])) {
        return { ...empty(refuse(`column ${columnLetter(c)} has values but no name in row ${headerRow} — a header of more than one row is not read; choose the row that holds the column names, or give every column one name in a single row`)), ...base }
      }
    }
  }

  const named = columnIndexes.map((c, i) => ({ c, name: rawHeader[i] })).filter((col) => col.name !== '')
  const rows = []
  let uncached = 0
  let errorCells = 0
  const typed = new Map(named.map((col) => [col.name, { numbers: 0, numericText: 0, sided: 0 }]))

  for (let r = headerIndex + 1; r <= range.e.r; r += 1) {
    const row = {}
    let any = false
    for (const col of named) {
      const cell = ws[cellAddress(r, col.c)]
      const value = cellText(cell, decimal, date1904)
      if (cell?.f !== undefined && cell?.v === undefined) uncached += 1
      if (cell?.t === 'e') errorCells += 1
      if (cell?.t === 'n' && !isDateCell(cell)) typed.get(col.name).numbers += 1
      if (cell?.t === 'n' && shownSide(cell)) typed.get(col.name).sided += 1
      if (cell?.t === 's' && NUMERIC_TEXT.test(String(cell.v).trim())) typed.get(col.name).numericText += 1
      row[col.name] = value
      if (value !== '') any = true
    }
    if (any) rows.push(row)
  }

  const notes = []
  if (uncached > 0) notes.push(`${uncached} formula cell${uncached === 1 ? ' has' : 's have'} no saved value, so ${uncached === 1 ? 'it is' : 'they are'} read as unreadable — open the workbook in Excel, let it calculate, and save it again`)
  if (errorCells > 0) notes.push(`${errorCells} cell${errorCells === 1 ? ' holds' : 's hold'} an Excel error such as #N/A, read as text`)
  for (const [name, counts] of typed) {
    if (counts.sided > 0) {
      notes.push(`column "${name}" shows Dr or Cr through its number format in ${counts.sided} cell${counts.sided === 1 ? '' : 's'} — kept as written ("25000 Cr"); declare Dr/Cr in this file’s format to read them as signed amounts`)
    }
    if (counts.numbers > 0 && counts.numericText > 0) {
      notes.push(`column "${name}" mixes ${counts.numbers} number${counts.numbers === 1 ? '' : 's'} stored as numbers with ${counts.numericText} stored as text — the text ones are read by the declared format, not converted`)
    }
  }

  const titleMerges = allMerges.length - merges.length
  if (titleMerges > 0) notes.push(`${titleMerges} merged cell${titleMerges === 1 ? '' : 's'} above row ${headerRow} (a title) ${titleMerges === 1 ? 'was' : 'were'} left out with the rows above the header`)

  if (rows.length === 0) return { ...empty(refuse(`the sheet "${chosen}" has a header row but no data rows below row ${headerRow}`)), columns: header.columns, notes, ...base }
  return { rows, columns: header.columns, errors: [], notes, ...base }
}

const NUMERIC_TEXT = /^[+-]?[\d,.\s']*\d[\d,.\s']*$/

// --- cells ---------------------------------------------------------------------

function cellText(cell, decimal, date1904) {
  if (!cell || cell.t === 'z') return ''
  if (cell.f !== undefined && cell.v === undefined) return `=${cell.f}` // never recalculated: unreadable as a number or date
  switch (cell.t) {
    case 's': return String(cell.v ?? '').trim()
    case 'b': return cell.v ? 'true' : 'false'
    case 'e': return String(cell.w ?? '#ERROR')
    case 'd': return isoFromDate(cell.v)
    case 'n': {
      if (isDateCell(cell)) return isoFromSerial(cell.v, date1904)
      const side = shownSide(cell)
      if (!side) return plainNumber(cell.v, decimal)
      // The amount as the format shows it — a format can drop the minus and let
      // the side carry it ("#,##0 Dr;#,##0 Cr") — then the side.
      return `${plainNumber(side.negative ? -Math.abs(cell.v) : Math.abs(cell.v), decimal)} ${side.side}`
    }
    default: return String(cell.v ?? '').trim()
  }
}

// The side a number cell's FORMAT shows, as Tally writes balances: { side:
// 'Dr' | 'Cr', negative } where negative says the shown amount carries a minus
// or brackets too. null when the format shows no side.
const SHOWN_SIDE = /(?:^|[^A-Za-z])(Dr|Cr)\.?(?![A-Za-z])/i
function shownSide(cell) {
  if (cell?.t !== 'n' || typeof cell.v !== 'number' || typeof cell.z !== 'string' || !/dr|cr/i.test(cell.z)) return null
  let shown
  try {
    shown = SSF.format(cell.z, cell.v)
  } catch {
    return null
  }
  const match = SHOWN_SIDE.exec(shown)
  if (!match) return null
  const side = match[1].toLowerCase() === 'cr' ? 'Cr' : 'Dr'
  return { side, negative: /-|\(.*\d.*\)/.test(shown) }
}

function headerText(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  return String(cell.w ?? cell.v).trim()
}

const hasValue = (cell) => Boolean(cell) && cell.t !== 'z' && cell.v !== undefined && String(cell.v).trim() !== ''

function isDateCell(cell) {
  return cell?.t === 'n' && typeof cell.z === 'string' && SSF.is_date(cell.z)
}

// The shortest digits that read back as the same number, in the declared
// decimal mark, never with an exponent or a thousands separator.
export function plainNumber(value, decimal = '.') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  let text = String(value)
  if (/e/i.test(text)) {
    text = Number.isInteger(value) ? BigInt(value).toString() : value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '')
  }
  return decimal === ',' ? text.replace('.', ',') : text
}

const pad = (n, width = 2) => String(n).padStart(width, '0')

function isoFromSerial(serial, date1904) {
  const p = SSF.parse_date_code(serial, { date1904 })
  if (!p) return ''
  const time = p.H || p.M || p.S
  if (serial < 1 && !date1904) return `${pad(p.H)}:${pad(p.M)}:${pad(p.S)}` // a time of day with no date
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}${time ? `T${pad(p.H)}:${pad(p.M)}:${pad(p.S)}` : ''}`
}

function isoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace('.000Z', '').replace(/T00:00:00$/, '')
}

// --- addresses -------------------------------------------------------------------

function columnLetter(c) {
  let n = c + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

const cellAddress = (r, c) => `${columnLetter(c)}${r + 1}`

function decodeCell(address) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(address)
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

function decodeRange(ref) {
  const [start, end = start] = ref.split(':')
  return { s: decodeCell(start), e: decodeCell(end) }
}

const encodeRange = (range) => `${cellAddress(range.s.r, range.s.c)}:${cellAddress(range.e.r, range.e.c)}`
