// Declared file formats, and the readers that read cells by them. Pure.
//
// Enterprise extracts do not arrive in one notation. A German SAP extract says
// 1.234,56 and 01.03.2024; a legacy system writes 20240301 and 1200- ; a US
// export writes 03/01/2024; a Windows tool saves Windows-1252, not UTF-8. Read
// in the wrong notation these do not fail — they come out as DIFFERENT, WRONG
// values ("1,5" as 15, 01/03 as 3 January), and a check built on wrong values
// passes or fails for the wrong reason.
//
// So a format is DECLARED, once per file, never guessed per cell:
//
//   { encoding: 'windows-1252', decimal: ',', date: 'DD.MM.YYYY' }
//
// and where nothing is declared and a value could be read two ways, it is not
// read as a number or a date at all — it stays text, so a disagreement shows up
// as a disagreement instead of being resolved by a guess.

import { isBlank, parseBoolean, parseDate, parseNumber } from './contract.js'

export const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'windows-1252', label: 'Windows-1252 — Western European, from Windows and many legacy systems' },
  { id: 'iso-8859-1', label: 'ISO-8859-1 (Latin-1)' },
  { id: 'utf-16le', label: 'UTF-16 LE — some Excel “Unicode text” exports' },
]

export const DECIMALS = [
  { id: '.', label: '1,234.56 — decimal point' },
  { id: ',', label: '1.234,56 — decimal comma' },
]

export const DATE_FORMATS = [
  { id: 'YYYY-MM-DD', label: '2024-03-01 (ISO)' },
  { id: 'DD.MM.YYYY', label: '01.03.2024' },
  { id: 'DD/MM/YYYY', label: '01/03/2024 — day first' },
  { id: 'MM/DD/YYYY', label: '03/01/2024 — month first' },
  { id: 'DD-MM-YYYY', label: '01-03-2024' },
  { id: 'YYYYMMDD', label: '20240301 — SAP internal' },
]

const KNOWN = {
  encoding: new Set(ENCODINGS.map((e) => e.id)),
  decimal: new Set(DECIMALS.map((d) => d.id)),
  date: new Set(DATE_FORMATS.map((d) => d.id)),
}

// formatIssue(format) -> a sentence, or null when every declared part is known.
export function formatIssue(format) {
  if (format === null || format === undefined) return null
  if (typeof format !== 'object' || Array.isArray(format)) return 'a file format must be an object such as { "decimal": "," }'
  for (const [part, value] of Object.entries(format)) {
    if (!KNOWN[part]) return `"${part}" is not part of a file format (use encoding, decimal or date)`
    if (!KNOWN[part].has(value)) return `"${value}" is not a known ${part} — use one of ${[...KNOWN[part]].join(', ')}`
  }
  return null
}

// Only the declared, known parts — what gets saved and fingerprinted.
export function cleanFormat(format) {
  if (!format || typeof format !== 'object') return undefined
  const out = {}
  for (const part of ['encoding', 'decimal', 'date']) {
    if (KNOWN[part].has(format[part])) out[part] = format[part]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// --- readers ------------------------------------------------------------------
// A reader turns a cell into a number, a date (epoch ms) or a boolean, or null.

// What the rules have always used. A contract that declares no format reads
// exactly as it did before formats existed.
export const DEFAULT_READER = { number: parseNumber, date: parseDate, boolean: parseBoolean, declared: false }

const SPACES = /[\s  ]/g
const CURRENCY = /\p{Sc}/gu
const FINAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// One compiled pattern per (separator, decimal) pair: this runs on every cell
// of every comparison, and compiling per value cost a large run real time.
const GROUPING = new Map()
function groupingPattern(group, decimal) {
  const id = group + decimal
  if (!GROUPING.has(id)) {
    GROUPING.set(id, new RegExp(`^[+-]?\\d{1,3}(${escapeRegExp(group)}\\d{3})+(${escapeRegExp(decimal)}\\d*)?$`))
  }
  return GROUPING.get(id)
}

// Fast paths, held to readNumberFully by a fuzz test in formats.test.js: a
// plain number needs no cleaning, and a value holding a character no number
// can contain (a letter other than e/E, a slash, a colon) cannot become one.
// Names and dates are most cells in a reconciliation; they no longer pay for
// the full path.
const PLAIN_POINT = /^[+-]?\d+(\.\d+)?$/
const PLAIN_COMMA = /^[+-]?\d+(,\d+)?$/
const CANNOT_BE_NUMBER = /[^\d+\-.,'eE%()\s\p{Sc}]/u

function readNumber(raw, decimal) {
  if (isBlank(raw)) return null
  const text = String(raw)
  if (decimal === '.' && PLAIN_POINT.test(text)) return Number(text)
  if (decimal === ',' && PLAIN_COMMA.test(text)) return Number(text.replace(',', '.'))
  if (CANNOT_BE_NUMBER.test(text)) return null
  return readNumberFully(text, decimal)
}

export function readNumberFully(raw, decimal) {
  if (isBlank(raw)) return null
  let text = String(raw).trim()
  let negative = false
  // Accounting negatives, (1,200.00), and SAP's trailing minus, 1200- : both
  // unambiguous, both common in finance extracts.
  const bracketed = /^\((.*)\)$/.exec(text)
  if (bracketed) {
    negative = true
    text = bracketed[1].trim()
  }
  if (/^[^-]*\d-$/.test(text)) {
    negative = !negative
    text = text.slice(0, -1)
  }
  text = text.replace(CURRENCY, '').replace(/%/g, '').trim().replace(SPACES, ' ')

  // Grouping: ONE kind of separator, in well-formed groups of three. "1,5" is
  // not a thousands-grouped number in any notation; reading it as 15 is how a
  // decimal comma silently becomes a value ten times too large.
  const groupChars = decimal === ',' ? ['.', ' '] : [',', ' ', "'"]
  const used = groupChars.filter((c) => text.includes(c))
  if (used.length > 1) return null
  if (used.length === 1) {
    if (!groupingPattern(used[0], decimal).test(text)) return null
    text = text.split(used[0]).join('')
  }
  if (decimal === ',') {
    if (text.includes('.')) return null
    text = text.replace(',', '.')
  }
  if (!FINAL.test(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

const TIME = '(?:[T ](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?'
const PATTERNS = {
  'DD.MM.YYYY': { re: new RegExp(`^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})${TIME}$`), order: ['d', 'm', 'y'] },
  'DD/MM/YYYY': { re: new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})${TIME}$`), order: ['d', 'm', 'y'] },
  'MM/DD/YYYY': { re: new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})${TIME}$`), order: ['m', 'd', 'y'] },
  'DD-MM-YYYY': { re: new RegExp(`^(\\d{1,2})-(\\d{1,2})-(\\d{4})${TIME}$`), order: ['d', 'm', 'y'] },
  YYYYMMDD: { re: /^(\d{4})(\d{2})(\d{2})$/, order: ['y', 'm', 'd'] },
}

// A calendar date that exists — 31.02.2024 is not a date in any format.
function utc(y, m, d, hh = 0, mm = 0, ss = 0) {
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  if (hh > 23 || mm > 59 || ss > 59) return null
  return ms
}

function readDate(raw, pattern) {
  if (isBlank(raw)) return null
  const text = String(raw).trim()
  // ISO is unambiguous whatever else is declared: a target system writing
  // 2024-03-01 next to a source writing 01.03.2024 is the normal case.
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(text)) return parseDate(text)
  const spec = PATTERNS[pattern]
  if (!spec) return null // nothing declared: a non-ISO date is not guessed at
  const match = spec.re.exec(text)
  if (!match) return null
  const parts = {}
  spec.order.forEach((name, i) => { parts[name] = Number(match[i + 1]) })
  return utc(parts.y, parts.m, parts.d, Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0))
}

// createReader(format) -> a reader for a file in that format.
//
// For any declared format — even an empty one — non-ISO dates are read only in
// the declared pattern. Reconciliation always reads this way: comparing two
// systems is exactly where a day/month swap hides, and guessing the order would
// make a swapped date and a correct one agree.
export function createReader(format = {}) {
  const decimal = format?.decimal === ',' ? ',' : '.'
  const pattern = format?.date ?? null
  return {
    number: (raw) => readNumber(raw, decimal),
    date: (raw) => readDate(raw, pattern),
    boolean: parseBoolean,
    declared: true,
  }
}

// --- text: decoding bytes by a declared encoding --------------------------------

// decodeBytes(bytes, encoding) -> { text, error }
//
// UTF-8 is decoded STRICTLY. A Windows-1252 file read as UTF-8 does not fail by
// itself — every accented letter silently becomes "�", names stop matching,
// and the evidence pack quotes garbage. So invalid UTF-8 is refused with the
// likely cause, never repaired.
export function decodeBytes(bytes, encoding = 'utf-8') {
  const id = KNOWN.encoding.has(encoding) ? encoding : 'utf-8'
  try {
    return { text: new TextDecoder(id, { fatal: id === 'utf-8' }).decode(bytes), error: null }
  } catch {
    return {
      text: null,
      error: 'it is not valid UTF-8 — most likely it was saved as Windows-1252, as legacy systems and Excel on Windows often do. Declare its encoding and read it again',
    }
  }
}
