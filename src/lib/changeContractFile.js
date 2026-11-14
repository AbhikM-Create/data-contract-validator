// A change contract as a file: what the workspace downloads and opens, and what
// `dcv change` reads. A contract is a DEFINITION — what may change — so the file
// holds the contract's own fields and nothing else; anything a hand-edited file
// adds is dropped on read, field by field, as cleanRun does for runs.
//
// The approved file and the change log are inputs, like reference files: they
// are never part of the contract and never saved with it.

import { COVERAGE, POLICIES } from './changeContract.js'

export const CHANGE_CONTRACT_FORMAT = 'data-contract-validator/change-contract'
export const CHANGE_CONTRACT_VERSION = 1

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const names = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(text).filter(Boolean)
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)

// The key as written: one or more column names, or { before, after } when the
// two files name it differently.
function cleanKey(key) {
  const pair = object(key)
  if (!pair) return names(key)
  const out = { before: names(pair.before ?? pair.source) }
  const after = names(pair.after ?? pair.target)
  if (after.length > 0) out.after = after
  if (Array.isArray(pair.normalize)) out.normalize = pair.normalize.filter((n) => n === 'stripLeadingZeros' || n === 'ignoreCase')
  return out
}

// A condition (a field's `when`, a side's `scope`) in the shape rules.js reads.
// Its operator is kept as written: the engine judges it, and refuses one it
// does not know, so a typo surfaces instead of being dropped here.
function cleanWhen(when) {
  const w = object(when)
  if (!w || !text(w.column) || !text(w.op)) return undefined
  const out = { column: text(w.column), op: text(w.op) }
  if (w.target !== undefined && w.target !== null) out.target = Array.isArray(w.target) ? w.target.map(String) : String(w.target)
  if (w.targetIsColumn === true) out.targetIsColumn = true
  return out
}

function cleanField(raw) {
  const f = object(raw) ?? {}
  const out = { policy: POLICIES.includes(f.policy) ? f.policy : 'preserve' }
  if (number(f.tolerance) !== undefined) out.tolerance = f.tolerance
  if (f.ignoreCase === true) out.ignoreCase = true
  if (Array.isArray(f.values)) out.values = f.values.map((v) => String(v))
  if (text(f.reference)) out.reference = text(f.reference)
  const map = object(f.map)
  if (map) out.map = Object.fromEntries(Object.entries(map).map(([from, to]) => [String(from), String(to)]))
  if (['up', 'down', 'either'].includes(f.direction)) out.direction = f.direction
  for (const limit of ['min', 'max', 'minPercent', 'maxPercent']) if (number(f[limit]) !== undefined) out[limit] = f[limit]
  if (f.onlyFor === 'approved') out.onlyFor = 'approved'
  if (text(f.approvedColumn)) out.approvedColumn = text(f.approvedColumn)
  const when = cleanWhen(f.when)
  if (when) out.when = when
  return out
}

function cleanTotal(raw) {
  const t = object(raw) ?? {}
  const out = { column: text(t.column), compare: t.compare === 'delta' ? 'delta' : 'equal' }
  for (const limit of ['tolerance', 'min', 'max']) if (number(t[limit]) !== undefined) out[limit] = t[limit]
  return out
}

// cleanChangeContract(raw) -> the contract with only the fields a contract has.
export function cleanChangeContract(raw) {
  const c = object(raw) ?? {}
  const out = {}
  if (text(c.name)) out.name = text(c.name)
  out.key = cleanKey(c.key)
  if (COVERAGE.includes(c.added)) out.added = c.added
  if (COVERAGE.includes(c.removed)) out.removed = c.removed
  if (c.others === 'ignore') out.others = 'ignore'
  const rename = object(c.rename)
  if (rename && Object.keys(rename).length > 0) out.rename = Object.fromEntries(Object.entries(rename).map(([b, a]) => [text(b), text(a)]).filter(([b, a]) => b && a))
  const scope = object(c.scope)
  if (scope) {
    const before = cleanWhen(scope.before ?? scope.source)
    const after = cleanWhen(scope.after ?? scope.target)
    if (before || after) out.scope = { ...(before ? { before } : {}), ...(after ? { after } : {}) }
  }
  out.fields = Object.fromEntries(Object.entries(object(c.fields) ?? {}).filter(([column]) => text(column)).map(([column, f]) => [text(column), cleanField(f)]))
  const approved = object(c.approved)
  if (approved) out.approved = { key: names(approved.key) }
  const log = object(c.changeLog)
  if (log) out.changeLog = log.key === undefined ? {} : { key: names(log.key) }
  if (Array.isArray(c.totals) && c.totals.length > 0) out.totals = c.totals.map(cleanTotal)
  const formats = object(c.formats)
  if (formats) {
    const side = (f) => (object(f) ? Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'string')) : undefined)
    const before = side(formats.before ?? formats.source)
    const after = side(formats.after ?? formats.target)
    if (before || after) out.formats = { ...(before ? { before } : {}), ...(after ? { after } : {}) }
  }
  return out
}

export function changeContractToJson(contract) {
  return `${JSON.stringify({ format: CHANGE_CONTRACT_FORMAT, version: CHANGE_CONTRACT_VERSION, contract: cleanChangeContract(contract) }, null, 2)}\n`
}

// readChangeContract(parsed) -> { contract } or { error }. Takes the file form
// above, or a bare contract (what a person writes by hand for `dcv change`).
export function readChangeContract(parsed) {
  const o = object(parsed)
  if (!o) return { error: 'This is not a change contract: the file holds no object.' }
  if (o.format !== undefined) {
    if (o.format !== CHANGE_CONTRACT_FORMAT) return { error: `This is not a change contract file (its format is "${String(o.format)}").` }
    if (o.version !== CHANGE_CONTRACT_VERSION) return { error: `This change contract file is version ${String(o.version)}; this version of the tool reads version ${CHANGE_CONTRACT_VERSION}.` }
    return { contract: cleanChangeContract(o.contract) }
  }
  return { contract: cleanChangeContract(o) }
}

export function parseChangeContractFile(textValue) {
  try {
    return readChangeContract(JSON.parse(textValue))
  } catch (error) {
    return { error: `This file could not be read as JSON — ${error.message}` }
  }
}
