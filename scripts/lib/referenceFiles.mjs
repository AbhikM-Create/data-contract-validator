// Reference files for `reference` rules (v3 §5.1), read from disk for the CLI.
//
// A reference rule asks whether every value exists in a column of another file —
// a vendor master, an employee master. The checked file streams; the reference
// file's VALUES must fit in memory, because every row of the checked file is
// looked up in them. So only the columns the rules actually name are kept, and
// a file whose values pass the ceiling is refused with the limit, never read
// half-way into a slow death.

import { isBlank } from '../../src/lib/contract.js'
import { RULE_KINDS } from '../../src/lib/rules.js'
import { readCsvHeader, streamCsv } from './csvStream.mjs'

export const MAX_REFERENCE_VALUES = 10_000_000

// parseReferenceArgs(['vendors=vendors.csv']) -> { vendors: 'vendors.csv' } or { error }
export function parseReferenceArgs(list) {
  const out = {}
  for (const entry of list ?? []) {
    const at = entry.indexOf('=')
    const name = at > 0 ? entry.slice(0, at).trim() : ''
    const path = at > 0 ? entry.slice(at + 1).trim() : ''
    if (!name || !path) return { error: `--reference takes name=file, as in --reference vendors=vendors.csv (got "${entry}")` }
    if (out[name]) return { error: `--reference names "${name}" twice` }
    out[name] = path
  }
  return { files: out }
}

// readReferenceFiles(rules, { name: path }) -> { references } or { error }
//   references: { [name]: { columns, values: { [column]: Set } } } — the shape
//   createRuleChecker reads. A file no rule names is not read at all.
//   columnMap: the object's column matching; a reference file's is under
//   "reference:<name>".
export async function readReferenceFiles(rules, files, { limit = MAX_REFERENCE_VALUES, columnMap = null } = {}) {
  const wanted = new Map() // file name -> Set of columns the rules read
  for (const rule of rules ?? []) {
    if (rule?.kind !== RULE_KINDS.REFERENCE || !rule.target?.file) continue
    if (!wanted.has(rule.target.file)) wanted.set(rule.target.file, new Set())
    wanted.get(rule.target.file).add(rule.target.column)
  }

  const references = {}
  let total = 0
  for (const [name, path] of Object.entries(files ?? {})) {
    const columnsWanted = wanted.get(name)
    if (!columnsWanted) continue
    const map = columnMap?.[`reference:${name}`] ?? null
    const header = readCsvHeader(path, 'utf-8', map)
    if (header.error) return { error: `${path}: ${header.error}` }
    const present = [...columnsWanted].filter((c) => header.columns.includes(c))
    const values = Object.fromEntries(present.map((c) => [c, new Set()]))
    let tooMany = false
    const read = await streamCsv(path, (row) => {
      if (tooMany) return
      for (const column of present) {
        const value = row[column]
        if (isBlank(value)) continue
        const set = values[column]
        const before = set.size
        set.add(String(value).trim())
        if (set.size > before) total += 1
      }
      if (total > limit) tooMany = true
    }, 'utf-8', map)
    if (read.error) return { error: `${path}: ${read.error}` }
    if (tooMany) {
      return { error: `${path}: the reference file holds more than ${limit.toLocaleString('en-US')} distinct values, which is more than can be looked up in memory — check it is the right file, or split the check by entity` }
    }
    references[name] = { columns: header.columns, values }
  }
  return { references }
}
