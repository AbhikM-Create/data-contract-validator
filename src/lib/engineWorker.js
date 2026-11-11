// The engine, running off the main thread.
//
// Parsing and checking a large file is seconds of unbroken CPU work. On the
// main thread that is seconds where the page cannot paint, scroll, or respond
// to a click — the tab simply appears to have crashed, and on a big enough file
// it actually does. Here, the page stays alive and can say what is happening.
//
// The worker also OWNS the parsed rows. They are the largest thing in the
// system — about 2 KB per row once V8 is done with them — and keeping them here
// means the main thread never holds a million row objects while trying to
// render. It also means re-checking after a threshold change costs nothing: the
// rows are already parsed.

import { columnMapIssues, mappedColumns, renameRows } from './columnMap.js'
import { inferContract } from './contract.js'
import { parseCsv, toCsv } from './parseCsv.js'
import { parseXlsx } from './parseXlsx.js'
import { defineContract, withRules } from './authoredContract.js'
import { checkReadiness } from './readiness.js'
import { createMasker } from './masking.js'
import { reconcile } from './reconcile.js'
import { referenceValues, RULE_KINDS } from './rules.js'
import { validate } from './validate.js'

// baseline/candidate for Validate; load/source/target for the migration
// workspace — the load file before a load, and the source and target extracts
// reconciled after it.
const files = { baseline: null, candidate: null, load: null, source: null, target: null }

// The last readiness check's flagged records stay here, with the rows they
// point at; the page asks for the fix list only when someone wants it.
let lastFlagged = null

// The workspace drills into a finding's records, so it asks for more examples
// than a CLI summary needs. Bounded, because they cross to the page.
const DRILL_DOWN_LIMIT = 1000

// A profile carries every value of every numeric column. The main thread only
// ever displays summaries, so the arrays are stripped before crossing — sending
// them would undo the point of keeping the rows over here.
function summarise(file) {
  if (!file) return null
  return {
    name: file.name,
    rowCount: file.rows.length,
    // columns: as the engine reads them (column matching applied);
    // fileColumns: the headers the file itself has.
    columns: file.columns,
    fileColumns: file.fileColumns ?? file.columns,
    errors: file.errors,
    // A workbook says which sheet and header row were read, and what it noticed.
    ...(file.kind === 'xlsx' ? { kind: 'xlsx', sheets: file.sheets, sheet: file.sheet, headerRow: file.headerRow, notes: file.notes } : {}),
  }
}

function lightContract(contract) {
  if (!contract) return null
  return {
    ...contract,
    columns: contract.columns.map(({ values: _values, counts: _counts, ...rest }) => rest),
    byName: undefined,
  }
}

// The reference files a contract's reference rules name, as the value sets the
// rule checker reads. Each was opened as role "reference:<name>"; a name with no
// file is simply absent, and its rules come back UNCHECKED with the reason.
function referencesFor(contract) {
  const references = {}
  for (const rule of contract?.rules ?? []) {
    if (rule?.kind !== RULE_KINDS.REFERENCE || !rule.target?.file) continue
    const file = files[`reference:${rule.target.file}`]
    if (!file?.rows.length) continue
    const entry = references[rule.target.file] ?? { columns: file.columns, values: {} }
    if (file.columns.includes(rule.target.column) && !entry.values[rule.target.column]) {
      entry.values[rule.target.column] = referenceValues(file.rows, rule.target.column)
    }
    references[rule.target.file] = entry
  }
  return references
}

// Column matching (columnMap.js), applied HERE and nowhere else in the page:
// the held rows are renamed to the names the definitions use, so every check
// below reads them unchanged. Returns why the map cannot be applied, or [].
function applyColumnMap(which, map = {}) {
  const file = files[which]
  if (!file) return []
  const fileColumns = file.fileColumns ?? file.columns
  const issues = columnMapIssues(map, fileColumns)
  if (issues.length > 0) return issues
  const to = mappedColumns(map, fileColumns)
  file.rows = renameRows(file.rows, file.columns, to)
  file.columns = to
  file.fileColumns = fileColumns
  return []
}

// Before a check: every file it reads must be under the object's current map.
// A map that does not fit the file stops the check with the reason: a check
// run under half a map would read blanks and call them clean.
function requireColumnMap(columnMap, roles) {
  for (const role of roles) {
    const issues = applyColumnMap(role, columnMap?.[role] ?? {})
    const name = role.startsWith('reference:') ? `reference file "${role.slice('reference:'.length)}"` : `${role} file`
    if (issues.length > 0) throw new Error(`The column matching for the ${name} cannot be used. ${issues.join(' ')}`)
  }
}

function handle(message) {
  const { type } = message

  if (type === 'columnMap') {
    const issues = applyColumnMap(message.which, message.map ?? {})
    return { file: summarise(files[message.which]), issues }
  }

  if (type === 'parse') {
    const { which, text, name } = message
    const parsed = parseCsv(text)
    files[which] = { ...parsed, fileColumns: parsed.columns, name }

    const draft = which === 'baseline' && parsed.rows.length > 0 ? inferContract(parsed.rows) : null
    return { file: summarise(files[which]), draft: lightContract(draft) }
  }

  // A workbook arrives as its bytes and is read here, so the rows never cross.
  if (type === 'parseXlsx') {
    const { which, bytes, name, sheet, headerRow, decimal } = message
    const parsed = parseXlsx(bytes, { sheet, headerRow, decimal })
    files[which] = { ...parsed, fileColumns: parsed.columns, name, kind: 'xlsx' }

    const draft = which === 'baseline' && parsed.rows.length > 0 ? inferContract(parsed.rows) : null
    return { file: summarise(files[which]), draft: lightContract(draft) }
  }

  if (type === 'clear') {
    files[message.which] = null
    if (message.which === 'load') lastFlagged = null
    return { file: null, draft: null }
  }

  if (type === 'reconcile') {
    requireColumnMap(message.columnMap, ['source', 'target'])
    const { source, target } = files
    if (!source?.rows.length || !target?.rows.length) return { report: null }
    const report = reconcile(message.spec, source.rows, target.rows, {
      sourceColumns: source.columns,
      targetColumns: target.columns,
      exampleLimit: DRILL_DOWN_LIMIT,
    })
    return { report }
  }

  if (type === 'readiness') {
    requireColumnMap(message.columnMap, ['load', ...Object.keys(files).filter((role) => role.startsWith('reference:'))])
    const load = files.load
    if (!load?.rows.length) return { report: null }
    const { flagged, ...report } = checkReadiness(message.contract, load.rows, { columns: load.columns, key: message.key, references: referencesFor(message.contract) })
    lastFlagged = { flagged, rows: load.rows, columns: load.columns }
    return { report: { ...report, flaggedCount: flagged.length } }
  }

  // The fix list: every flagged record, its own columns plus why — the same
  // file the CLI's --rejects writes. Built here, so the rows never cross.
  if (type === 'fixList') {
    if (!lastFlagged || lastFlagged.flagged.length === 0) return { csv: null }
    const { flagged, rows, columns } = lastFlagged
    // The fix list leaves the page: tagged values are masked (masking.js), the
    // record key and the reasons stay so each record can still be found.
    const mask = createMasker(message.tags, { unmask: message.unmask === true, keys: message.key ?? [] })
    const csv = toCsv(
      [...columns, '_row', '_readiness', '_reasons', '_owner'],
      flagged.map((f) => [
        ...columns.map((column) => mask(column, rows[f.row - 1][column])),
        f.row,
        f.severity === 'reject' ? 'REJECT' : 'WARN',
        f.reasons.join('; '),
        message.owner ?? '',
      ]),
    )
    return { csv }
  }

  if (type === 'validate') {
    const { rules, thresholds } = message
    const baseline = files.baseline
    const candidate = files.candidate

    if (!candidate || candidate.rows.length === 0) return { result: null }

    const draft = baseline && baseline.rows.length > 0 ? inferContract(baseline.rows) : null
    const contract = draft
      ? withRules(draft, rules)
      : rules.length > 0
        ? defineContract({ rules })
        : null

    if (!contract) return { result: null }

    const result = validate(contract, candidate.rows, { thresholds })

    // The result holds no rows, but it does hold rule objects and violation
    // strings, all of which clone cleanly.
    return { result, contract: lightContract(contract) }
  }

  return {}
}

self.onmessage = (event) => {
  const { id, ...message } = event.data
  try {
    self.postMessage({ id, ok: true, ...handle(message) })
  } catch (error) {
    // A worker that dies silently looks exactly like a slow one. Anything that
    // goes wrong comes back as an answer, so the page can say so.
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) })
  }
}
