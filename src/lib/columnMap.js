// Column matching (final-spec C1). Pure.
//
// A definition names the column it reads — a pack's rule says "Account Name",
// its mapping says "Name" and "Under". A client's real export rarely uses the
// same headers: "Ledger Name", "Parent". Without a way to say "this column is
// that one", every rule over a differently named column is UNCHECKED and the
// definitions have to be rewritten by hand for each client.
//
// So an object carries a column map, per file role:
//
//   columnMap: { source: { "Name": "Ledger Name" }, load: { … }, "reference:accounts": { … } }
//
// read as: where the definitions say "Name", this file says "Ledger Name". It
// is DECLARED by a person from dropdowns. proposeMatches() may propose a match
// when the two names differ only in case, spaces and punctuation, and the
// person accepts it; nothing is ever matched silently, because a wrong match
// is a wrong answer that looks right.
//
// The map is applied in ONE place per runtime, where rows enter the engine (the
// worker; the streaming readers), by renaming the file's columns to the names
// the definitions use. The engine sees the expected names and is unchanged.
//
// It holds column names only — never a value.

import { ruleColumns, RULE_KINDS } from './rules.js'

const ROLE = /^(load|source|target|reference:[\w .-]{1,60})$/
const text = (value) => (typeof value === 'string' ? value.trim() : '')

// Only known roles, and only pairs of non-empty, different column names.
export function cleanColumnMap(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [role, map] of Object.entries(raw)) {
    if (!ROLE.test(role) || !map || typeof map !== 'object' || Array.isArray(map)) continue
    const clean = {}
    for (const [expected, actual] of Object.entries(map)) {
      const from = text(expected)
      const to = text(actual)
      if (from && to && from !== to && from.length <= 200 && to.length <= 200) clean[from] = to
    }
    if (Object.keys(clean).length > 0) out[role] = clean
  }
  return out
}

const entries = (map) => Object.entries(map && typeof map === 'object' ? map : {})

// columnMapIssues(map, fileColumns) -> why one role's map cannot be applied to
// this file, or []. Every reason is refused whole: a map applied in part would
// rename some columns and leave a definition reading a blank.
export function columnMapIssues(map, fileColumns) {
  const issues = []
  const present = new Set(fileColumns)
  const usedBy = new Map()
  const renamedAway = new Set(entries(map).map(([, actual]) => actual))
  for (const [expected, actual] of entries(map)) {
    if (!present.has(actual)) {
      issues.push(`"${expected}" is matched to "${actual}", which this file does not have.`)
      continue
    }
    if (usedBy.has(actual)) {
      issues.push(`"${actual}" is matched to both "${usedBy.get(actual)}" and "${expected}"; a file column can stand for only one.`)
      continue
    }
    usedBy.set(actual, expected)
    // The new name must be free: either the file has no such column, or that
    // column is itself being read under another name (a swap).
    if (present.has(expected) && !renamedAway.has(expected)) {
      issues.push(`"${actual}" cannot be read as "${expected}": this file already has a column "${expected}".`)
    }
  }
  return issues
}

// The file's columns as the engine will see them, in file order.
export function mappedColumns(map, fileColumns) {
  const nameOf = new Map(entries(map).map(([expected, actual]) => [actual, expected]))
  return fileColumns.map((column) => nameOf.get(column) ?? column)
}

// renameRows(rows, from, to) -> rows with column from[i] read as to[i]. The same
// array when nothing changes. Used to re-map rows that are already held.
export function renameRows(rows, from, to) {
  if (from.every((column, i) => column === to[i])) return rows
  return rows.map((row) => {
    const out = {}
    for (let i = 0; i < from.length; i += 1) out[to[i]] = row[from[i]]
    return out
  })
}

// createRenamer(map, fileColumns) -> (row) => the row under the expected names.
// For a streaming reader. With nothing to rename it returns the row itself.
export function createRenamer(map, fileColumns) {
  const to = mappedColumns(map, fileColumns)
  if (fileColumns.every((column, i) => column === to[i])) return (row) => row
  return (row) => {
    const out = {}
    for (let i = 0; i < fileColumns.length; i += 1) out[to[i]] = row[fileColumns[i]]
    return out
  }
}

// Names compared for a PROPOSAL only: letters and digits, case folded.
const loose = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// proposeMatches(expected, fileColumns, map) -> [{ expected, actual }] for the
// expected columns the file lacks, where exactly one unused file column has the
// same name ignoring case, spaces and punctuation. A proposal is shown with its
// evidence — the two names — and does nothing until a person accepts it.
export function proposeMatches(expected, fileColumns, map = {}) {
  const present = new Set(fileColumns)
  const taken = new Set(entries(map).map(([, actual]) => actual))
  const out = []
  for (const column of expected) {
    if (present.has(column) || map?.[column]) continue
    const candidates = fileColumns.filter((c) => !taken.has(c) && loose(c) !== '' && loose(c) === loose(column))
    if (candidates.length === 1) out.push({ expected: column, actual: candidates[0] })
  }
  return out
}

const unique = (list) => [...new Set(list.filter((c) => typeof c === 'string' && c.trim() !== ''))]

// expectedColumns(object) -> the columns its definitions read, per file role:
// the load file's from the rules, the extracts' from the spec, and each
// reference file's from the reference rules that name it.
export function expectedColumns(object) {
  const rules = Array.isArray(object?.contract?.rules) ? object.contract.rules : []
  const spec = object?.spec ?? {}
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : [])
  const side = (name) => unique([
    ...list(spec.key?.[name]),
    ...(name === 'source' ? [spec.scope?.source?.column] : [spec.scope?.target?.column]),
    ...list(spec.mapping).flatMap((field) => [name === 'source' ? field?.source : field?.target ?? field?.source]),
    ...list(spec.totals).flatMap((total) => [
      total?.fn === 'count' ? null : name === 'source' ? total?.source : total?.target ?? total?.source,
      name === 'source' ? total?.groupBy?.source : total?.groupBy?.target ?? total?.groupBy?.source,
    ]),
  ])
  const out = { load: unique(rules.flatMap((rule) => ruleColumns(rule))), source: side('source'), target: side('target') }
  for (const rule of rules) {
    if (rule?.kind !== RULE_KINDS.REFERENCE || !text(rule.target?.file) || !text(rule.target?.column)) continue
    const role = `reference:${rule.target.file}`
    out[role] = unique([...(out[role] ?? []), rule.target.column])
  }
  return out
}
