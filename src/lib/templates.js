// Contracts from the TARGET's own load template: the fields it requires and the
// values it accepts, read from what the target system publishes, instead of
// typed in by hand. Pure — text in, proposals out.
//
// Two sources:
//   * an SAP S/4HANA Migration Cockpit file template (Microsoft XML
//     Spreadsheet 2003). SAP documents it as: a "Field List" sheet with each
//     field's importance and, in hidden columns, its SAP structure and field;
//     and one sheet per structure whose rows give the structure's technical
//     name, each field's technical name, and its description — a description
//     ending in "*" marks a mandatory field.
//   * a field list as CSV — field, required, type, allowed values, min, max —
//     the shape of a data-load specification for any target (a Workday EIB
//     or Salesforce template saved as CSV, a mapping workbook's field sheet).
//
// HONEST, like ODCS import: rows are found by what they contain, never by a
// fixed position; a file that does not read as a template is refused with the
// reason; and what the engine cannot check exactly (a maximum length, a
// conditional importance) is listed as not imported, never dropped. Every
// result is a PROPOSAL with the line of the template it came from — the
// person adds the ones they accept, like a suggestion from a baseline.
//
// The Migration Cockpit reader is built from SAP's published description of
// the layout and tested on files constructed to it, not yet on a template
// downloaded from a live system: a template that does not match is refused,
// not misread.

import { RULE_KINDS } from './rules.js'

// --- XML Spreadsheet 2003 -------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
  return ENTITIES[name.toLowerCase()] ?? whole
})
const attr = (attrs, name) => new RegExp(`(?:ss:)?${name}="([^"]*)"`, 'i').exec(attrs)?.[1] ?? null

export function isSpreadsheetXml(text) {
  const head = String(text ?? '').slice(0, 4000)
  return /progid="Excel\.Sheet"/i.test(head) || /urn:schemas-microsoft-com:office:spreadsheet/i.test(head)
}

// readSpreadsheetXml(text) -> { sheets: [{ name, rows: string[][] }], error }
// Cells keep their column position (ss:Index, ss:MergeAcross); comments and
// formatting inside a cell are dropped, only its data is kept.
export function readSpreadsheetXml(text) {
  if (!isSpreadsheetXml(text)) return { sheets: [], error: 'this is not a Microsoft XML Spreadsheet 2003 file' }
  const sheets = []
  for (const sheet of String(text).matchAll(/<(?:ss:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi)) {
    const rows = []
    let r = 0
    for (const row of sheet[2].matchAll(/<(?:ss:)?Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)) {
      const at = Number(attr(row[1], 'Index'))
      r = at > 0 ? at - 1 : r
      const cells = []
      let c = 0
      for (const cell of (row[2] ?? '').matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
        const index = Number(attr(cell[1], 'Index'))
        c = index > 0 ? index - 1 : c
        const inner = (cell[2] ?? '').replace(/<(?:ss:)?Comment\b[\s\S]*?<\/(?:ss:)?Comment>/gi, '')
        const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(inner)
        cells[c] = data ? decode(data[1].replace(/<[^>]+>/g, '')).trim() : ''
        c += 1 + (Number(attr(cell[1], 'MergeAcross')) || 0)
      }
      rows[r] = Array.from(cells, (v) => v ?? '')
      r += 1
    }
    sheets.push({ name: decode(attr(sheet[1], 'Name') ?? `Sheet ${sheets.length + 1}`), rows: Array.from(rows, (v) => v ?? []) })
  }
  if (!sheets.length) return { sheets, error: 'the file has no worksheets' }
  return { sheets, error: null }
}

// --- SAP Migration Cockpit --------------------------------------------------------

const TECHNICAL = /^[A-Z][A-Z0-9_]{1,29}$/
const filled = (row) => (row ?? []).map((v, i) => [i, String(v ?? '').trim()]).filter(([, v]) => v)
const share = (row, test) => { const f = filled(row); return f.length ? f.filter(([, v]) => test(v)).length / f.length : 0 }
const TYPE_WORDS = { text: 'string', char: 'string', string: 'string', number: 'numeric', numeric: 'numeric', decimal: 'numeric', amount: 'numeric', integer: 'numeric', date: 'date', time: null, boolean: 'boolean' }
const typeOf = (word) => TYPE_WORDS[String(word ?? '').trim().toLowerCase()]

// A structure sheet: the row of field technical names (most cells technical,
// at least two of them), the row of structure names just above it, and below
// it a row of descriptions — words, not technical names, at the same columns.
function readStructureSheet(sheet) {
  const isTechnical = (row) => filled(row).length >= 2 && share(row, (v) => TECHNICAL.test(v)) >= 0.9
  // Both rows look technical; the field names are the second of the pair.
  const t = sheet.rows.findIndex((row, i) => i > 0 && isTechnical(row) && isTechnical(sheet.rows[i - 1]))
  if (t < 1) return null
  const technical = filled(sheet.rows[t])
  const above = sheet.rows[t - 1]
  const descriptionRow = sheet.rows.slice(t + 1, t + 6).find((row) => {
    const hits = technical.filter(([i]) => String(row?.[i] ?? '').trim())
    return hits.length >= technical.length * 0.6 && share(row, (v) => !TECHNICAL.test(v) && /\p{L}/u.test(v)) >= 0.6 && share(row, (v) => typeOf(v) === undefined) >= 0.6
  })
  if (!descriptionRow) return null
  const between = sheet.rows.slice(t + 1, sheet.rows.indexOf(descriptionRow))
  const typeRow = between.find((row) => share(row, (v) => typeOf(v) !== undefined) >= 0.8)
  const lengthRow = between.find((row) => share(row, (v) => /^\d+(,\d+)?$/.test(v)) >= 0.8)
  return technical.map(([i, field]) => {
    const description = String(descriptionRow[i] ?? '').trim()
    return {
      sheet: sheet.name,
      structure: String(above[i] ?? '').trim() || null,
      field,
      description: description.replace(/\s*\*$/, '') || field,
      mandatory: /\*$/.test(description),
      type: typeRow ? typeOf(typeRow[i]) ?? null : null,
      typeWord: typeRow ? String(typeRow[i] ?? '').trim() || null : null,
      length: lengthRow ? String(lengthRow[i] ?? '').trim() || null : null,
    }
  })
}

// The "Field List" sheet, when it is there, says the same per field with an
// Importance column. Its columns are found by their headings.
function readFieldListSheet(sheet) {
  const h = sheet.rows.findIndex((row) => row.some((v) => /^importance$/i.test(v)) && row.some((v) => /^sap field$/i.test(v)))
  if (h < 0) return null
  const head = sheet.rows[h].map((v) => String(v ?? '').trim().toLowerCase())
  const col = (...names) => head.findIndex((v) => names.includes(v))
  const c = { sheet: col('sheet name', 'sheet'), description: col('field description', 'field name', 'description'), importance: col('importance'), type: col('type', 'data type'), length: col('length'), structure: col('sap structure'), field: col('sap field') }
  return sheet.rows.slice(h + 1).filter((row) => String(row?.[c.field] ?? '').trim()).map((row) => {
    const importance = String(row[c.importance] ?? '').trim()
    return {
      sheet: String(row[c.sheet] ?? '').trim() || null,
      structure: String(row[c.structure] ?? '').trim() || null,
      field: String(row[c.field]).trim(),
      description: String(row[c.description] ?? '').trim().replace(/\s*\*$/, '') || String(row[c.field]).trim(),
      importance,
      // Only an unconditional importance is a rule; "Mandatory if …" is
      // listed as not imported by cockpitProposals.
      mandatory: /^mandatory( for sheet)?$/i.test(importance),
      type: c.type >= 0 ? typeOf(row[c.type]) ?? null : null,
      typeWord: c.type >= 0 ? String(row[c.type] ?? '').trim() || null : null,
      length: c.length >= 0 ? String(row[c.length] ?? '').trim() || null : null,
    }
  })
}

// readMigrationCockpitTemplate(text) -> { structures: [{ sheet, structure, fields[] }], error }
export function readMigrationCockpitTemplate(text) {
  const book = readSpreadsheetXml(text)
  if (book.error) return { structures: [], error: book.error }
  const fieldList = book.sheets.map(readFieldListSheet).find(Boolean)
  const fromSheets = book.sheets.filter((s) => !/^(introduction|field list)$/i.test(s.name)).map(readStructureSheet).filter(Boolean).flat()
  // The Field List is the authority where it names a field; structure sheets
  // fill in fields it does not list.
  const fields = [...(fieldList ?? [])]
  for (const f of fromSheets) if (!fields.some((g) => g.field === f.field && g.structure === f.structure)) fields.push(f)
  if (!fields.length) {
    return { structures: [], error: 'no field list was found: neither a "Field List" sheet with Importance and SAP Field columns, nor a sheet with a row of technical field names under a row of structure names and above a row of descriptions' }
  }
  const bySheet = new Map()
  for (const f of fields) {
    const key = f.sheet ?? f.structure ?? 'Fields'
    bySheet.set(key, [...(bySheet.get(key) ?? []), f])
  }
  return {
    structures: [...bySheet.entries()].map(([sheet, list]) => ({ sheet, structure: list.find((f) => f.structure)?.structure ?? null, fields: list })),
    error: null,
  }
}

// cockpitProposals(structure, { naming }) -> { proposals, notImported }
//
// One load file is one structure's rows, so proposals are per structure.
// `naming` says what the load file's columns are called: the technical field
// names (KUNNR) or the descriptions (Customer).
export function cockpitProposals(structure, { naming = 'technical' } = {}) {
  const proposals = []
  const notImported = []
  for (const f of structure.fields) {
    const column = naming === 'description' ? f.description : f.field
    const where = `sheet “${structure.sheet}”, ${f.field}${f.description !== f.field ? ` (${f.description})` : ''}`
    if (f.mandatory) {
      proposals.push({ rule: { kind: RULE_KINDS.NULL_RULE, column, op: 'notNull' }, label: 'Required', evidence: `${where} is marked mandatory${f.importance ? ` (${f.importance})` : ' (*)'}` })
    } else if (f.importance && !/^(optional|)$/i.test(f.importance)) {
      notImported.push({ column, what: `importance “${f.importance}”`, reason: 'it depends on other fields or sheets, which a rule cannot express exactly' })
    }
    if (f.type === 'numeric' || f.type === 'date') {
      proposals.push({ rule: { kind: RULE_KINDS.TYPE, column, op: '=', target: f.type }, label: f.type === 'numeric' ? 'A number' : 'A date', evidence: `${where} is of type ${f.typeWord}` })
    }
    if (f.length) notImported.push({ column, what: `length ${f.length}`, reason: 'this tool has no length rule' })
  }
  return { proposals, notImported }
}

// --- a field list as CSV ---------------------------------------------------------------

const HEADINGS = {
  field: /^(field|field name|column|column name|target field|technical name|sap field|name)$/i,
  required: /^(required|mandatory|importance)$/i,
  optional: /^(optional|nullable)$/i,
  type: /^(type|data type|datatype)$/i,
  values: /^(allowed values|valid values|values|value list|list of values|domain|picklist values)$/i,
  min: /^(min|minimum|min value)$/i,
  max: /^(max|maximum|max value)$/i,
  length: /^(length|max length|maximum length|size)$/i,
}
const YES = /^(y|yes|true|x|1|mandatory|required)$/i
const NO = /^(n|no|false|0|optional|)$/i

// fieldListProposals(rows, columns) -> { proposals, notImported, error }
// rows/columns as parseCsv returns them.
export function fieldListProposals(rows, columns) {
  const pick = (re) => columns.find((c) => re.test(String(c).trim())) ?? null
  const c = Object.fromEntries(Object.entries(HEADINGS).map(([k, re]) => [k, pick(re)]))
  if (!c.field) return { proposals: [], notImported: [], error: `no column names the fields: expected one headed ${['Field', 'Field name', 'Column', 'Target field'].map((h) => `“${h}”`).join(', ')} or similar` }
  if (!c.required && !c.optional && !c.type && !c.values && !c.min && !c.max) {
    return { proposals: [], notImported: [], error: 'no column says anything a rule can check: expected Required, Type, Allowed values, Min or Max' }
  }
  const proposals = []
  const notImported = []
  for (const [i, row] of rows.entries()) {
    const column = String(row[c.field] ?? '').trim()
    if (!column) continue
    const where = `line ${i + 2}, ${column}`
    const required = c.required ? String(row[c.required] ?? '').trim() : null
    const optional = c.optional ? String(row[c.optional] ?? '').trim() : null
    if (required !== null && YES.test(required)) proposals.push({ rule: { kind: RULE_KINDS.NULL_RULE, column, op: 'notNull' }, label: 'Required', evidence: `${where}: ${c.required} is “${required}”` })
    else if (optional !== null && NO.test(optional) && optional !== '') proposals.push({ rule: { kind: RULE_KINDS.NULL_RULE, column, op: 'notNull' }, label: 'Required', evidence: `${where}: ${c.optional} is “${optional}”` })
    else if (required !== null && !NO.test(required)) notImported.push({ column, what: `${c.required} “${required}”`, reason: 'not a yes or no' })

    const word = c.type ? String(row[c.type] ?? '').trim() : ''
    const type = typeOf(word)
    if (type === 'numeric' || type === 'date' || type === 'boolean') proposals.push({ rule: { kind: RULE_KINDS.TYPE, column, op: '=', target: type }, label: `A ${type === 'numeric' ? 'number' : type}`, evidence: `${where}: type “${word}”` })
    else if (word && type === undefined) notImported.push({ column, what: `type “${word}”`, reason: 'not a type this tool reads (number, date, boolean, text)' })

    const values = c.values ? String(row[c.values] ?? '').trim() : ''
    if (values) {
      if (/[;|\n]/.test(values)) {
        const list = [...new Set(values.split(/[;|\n]/).map((v) => v.trim()).filter(Boolean))]
        proposals.push({ rule: { kind: RULE_KINDS.VALUE_SET, column, op: 'in', target: list }, label: `Only these ${list.length} values`, evidence: `${where}: allowed values` })
      } else if (values.includes(',')) {
        notImported.push({ column, what: 'allowed values', reason: 'separate them with ; or | — a comma can be part of a value' })
      } else {
        proposals.push({ rule: { kind: RULE_KINDS.VALUE_SET, column, op: 'in', target: [values] }, label: 'Only this value', evidence: `${where}: allowed values` })
      }
    }

    const low = c.min ? String(row[c.min] ?? '').trim() : ''
    const high = c.max ? String(row[c.max] ?? '').trim() : ''
    if (low && high) proposals.push({ rule: { kind: RULE_KINDS.RANGE, column, op: 'between', target: [num(low), num(high)] }, label: `Between ${low} and ${high}`, evidence: `${where}: min ${low}, max ${high}` })
    else if (low) proposals.push({ rule: { kind: RULE_KINDS.COMPARISON, column, op: '>=', target: num(low) }, label: `At least ${low}`, evidence: `${where}: min ${low}` })
    else if (high) proposals.push({ rule: { kind: RULE_KINDS.COMPARISON, column, op: '<=', target: num(high) }, label: `At most ${high}`, evidence: `${where}: max ${high}` })

    const length = c.length ? String(row[c.length] ?? '').trim() : ''
    if (length) notImported.push({ column, what: `length ${length}`, reason: 'this tool has no length rule' })
  }
  return { proposals, notImported, error: null }
}

// A bound the author's file wrote as a plain number stays a number; anything
// else (a date) is kept as written, read later by the canonical reader.
const num = (text) => (/^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text)
