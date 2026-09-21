// Turning a contract into a portable spec, and back. Pure: no DOM, no network.
//
// This is the thing that gets persisted — to a file now, to Supabase next — so
// what it does NOT contain matters as much as what it does.
//
// The inferred half of a contract (columns[], with value domains, ranges and
// timestamps) is DERIVED FROM THE FILE: a domain for an email column is a list
// of real email addresses. Saving that would put raw data in the store, which
// is exactly what this app promises never to do. So a saved contract carries
// only the rules a human authored, plus a name — the spec, never the sample.
//
// The values inside a rule are the author's own declaration ("these seven
// grades are legal"), and they are saved, because a rule without its values is
// not a rule. Promoting a suggestion copies observed values into a rule, so the
// UI says so at the point of saving rather than after.

import { ruleIssue } from './rules.js'

export const CONTRACT_FILE_VERSION = 1

const CONTRACT_FILE_KIND = 'data-contract-validator/contract'

// serializeContract({ name, rules }) -> a plain object safe to store anywhere.
export function serializeContract({ name, rules, savedAt } = {}) {
  return {
    kind: CONTRACT_FILE_KIND,
    formatVersion: CONTRACT_FILE_VERSION,
    name: (name ?? '').trim() || 'Untitled contract',
    savedAt: savedAt ?? new Date().toISOString(),
    rules: (rules ?? []).map(cleanRule),
  }
}

export function contractToJson(contract) {
  return `${JSON.stringify(serializeContract(contract), null, 2)}\n`
}

// Only the fields the engine reads, so an object that has been round-tripped
// through the UI never carries stray keys into storage.
function cleanRule(rule) {
  const cleaned = { kind: rule.kind, column: rule.column, op: rule.op, target: rule.target }
  if (rule.targetIsColumn) cleaned.targetIsColumn = true
  if (rule.when) {
    cleaned.when = { column: rule.when.column, op: rule.when.op, target: rule.when.target }
    if (rule.when.targetIsColumn) cleaned.when.targetIsColumn = true
  }
  if (rule.layer) cleaned.layer = rule.layer
  return cleaned
}

// parseContractFile(text) -> { name, rules, savedAt, skipped[], error }
//
// A rule that no longer parses is REPORTED, never dropped in silence: a contract
// that quietly enforces less than it says is the failure this tool exists to
// catch. `error` is set only when nothing usable could be read at all.
export function parseContractFile(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? ''))
  } catch {
    return fail('this file is not valid JSON, so no contract could be read from it')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('this file does not contain a contract object')
  }
  if (parsed.kind !== undefined && parsed.kind !== CONTRACT_FILE_KIND) {
    return fail('this JSON file is something else — it was not saved as a contract by this tool')
  }
  if (Number(parsed.formatVersion) > CONTRACT_FILE_VERSION) {
    return fail(`this contract was saved in format version ${parsed.formatVersion}, which is newer than this app understands (version ${CONTRACT_FILE_VERSION})`)
  }
  if (!Array.isArray(parsed.rules)) {
    return fail('this contract has no rules list')
  }

  const { rules, skipped } = readRules(parsed.rules)

  return {
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Untitled contract',
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
    rules,
    skipped,
    error: null,
  }
}

function fail(reason) {
  return { name: null, savedAt: null, rules: [], skipped: [], error: `Couldn’t load this contract — ${reason}.` }
}

// readRules(raw) -> { rules, skipped }
//
// Shared by every route a contract can arrive on — a JSON file, a database row,
// whatever comes next. A rule this version cannot read is REPORTED, never
// dropped in silence, and that judgement has to be made in one place: two
// copies of it would eventually disagree, and the disagreement would be a
// contract that quietly enforces less than it claims.
export function readRules(raw) {
  const rules = []
  const skipped = []
  for (const rule of Array.isArray(raw) ? raw : []) {
    const issue = ruleIssue(rule)
    if (issue) skipped.push({ rule, reason: issue })
    else rules.push(cleanRule(rule))
  }
  return { rules, skipped }
}
