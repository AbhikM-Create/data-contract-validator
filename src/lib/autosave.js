import { serializeContract, parseContractFile } from './contractFile.js'
import { migrationObjectToJson, parseMigrationObjectFile } from './migrationObject.js'
import { DEFAULT_THRESHOLDS } from './validate.js'

// Autosave of what a person AUTHORED in this tab — the migration object, the
// rules open on Contracts, the thresholds — to the browser's own storage, so a
// refresh or a closed tab loses nothing. Never a file, never a record.
//
// The boundary is the existing one: the object goes through
// migrationObjectToJson (rules, spec, formats, crosswalks, runs rebuilt field by
// field by cleanRun) and the rules through serializeContract. Whatever those
// refuse to write, this cannot store. Read back, both go through their own
// parsers, so a hand-edited entry is checked like a file.
//
// The storage is passed in (window.localStorage in the app, a Map-backed fake in
// tests), which keeps this module free of the DOM.

export const DRAFT_KEY = 'data-contract-validator:draft:v1'

// draftToJson({ migration, migrationDirty, contractName, rules, thresholds }, now) -> string
export function draftToJson({ migration, migrationDirty = false, contractName = '', rules = [], thresholds }, now = new Date()) {
  return JSON.stringify({
    kind: 'data-contract-validator/draft',
    version: 1,
    savedAt: now.toISOString(),
    migration: JSON.parse(migrationObjectToJson(migration)),
    migrationDirty: Boolean(migrationDirty),
    contract: { name: String(contractName ?? ''), rules: serializeContract({ rules }).rules },
    thresholds: cleanThresholds(thresholds),
  })
}

// readDraft(text) -> { migration, migrationDirty, contractName, rules, thresholds, savedAt, skipped } or null
export function readDraft(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? ''))
  } catch {
    return null
  }
  if (parsed?.kind !== 'data-contract-validator/draft' || parsed.version !== 1) return null

  const object = parseMigrationObjectFile(JSON.stringify(parsed.migration ?? null))
  const contract = parseContractFile(JSON.stringify({ name: parsed.contract?.name || 'draft', rules: parsed.contract?.rules ?? [] }))
  if (object.error || contract.error) return null

  return {
    migration: object.object,
    migrationDirty: parsed.migrationDirty === true,
    contractName: typeof parsed.contract?.name === 'string' ? parsed.contract.name : '',
    rules: contract.rules,
    thresholds: { ...DEFAULT_THRESHOLDS, ...cleanThresholds(parsed.thresholds) },
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
    skipped: [...object.skipped, ...contract.skipped],
  }
}

// Whether a draft holds anything worth restoring.
export function hasWork({ migration, rules }) {
  const m = migration ?? {}
  return Boolean(m.name || m.contract?.rules?.length || m.spec?.mapping?.length || m.spec?.key?.source?.some(Boolean) || m.runs?.length || rules?.length)
}

// saveDraft(storage, state, now) -> null on success, or a sentence saying why it failed.
export function saveDraft(storage, state, now) {
  try {
    if (!hasWork(state)) storage.removeItem(DRAFT_KEY)
    else storage.setItem(DRAFT_KEY, draftToJson(state, now))
    return null
  } catch (error) {
    return /quota/i.test(String(error?.name ?? error?.message))
      ? 'Your work is too large for this browser’s storage, so it is not being saved automatically. Download the object to keep it.'
      : 'This browser would not let the page save your work automatically. Download the object to keep it.'
  }
}

export function loadDraft(storage) {
  try {
    return readDraft(storage.getItem(DRAFT_KEY))
  } catch {
    return null
  }
}

function cleanThresholds(thresholds) {
  const out = {}
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const value = thresholds?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}
