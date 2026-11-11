// Packs (v3-spec §6): a versioned bundle of definitions for one source → target
// path — the source exports' declared formats, the target's rules, a mapping
// spec template, crosswalk templates (structure and standard codes, never a
// client's values), sensitivity tags and the sign-off record's scope. Pure.
//
// A pack is DATA, shipped with the app (src/packs/) and handed to these
// functions; this module never imports one, the way the engine never imports
// the samples. A pack is labelled draft until it has run on real exports in a
// pilot; then verified, with the date and the export versions it was checked
// against. A migration object built from a pack carries a reference to it, so
// the evidence pack can say which pack — and which status — it came from.

import { ruleColumns, ruleIssue } from './rules.js'
import { formatIssue } from './formats.js'
import { cleanTags } from './masking.js'
import { newMigrationObject } from './migrationObject.js'
import { PACK_STATUSES, packRef } from './packRef.js'

export { cleanPackRef, PACK_STATUSES, packLabel, packRef } from './packRef.js'
import { normalizeSpec, specIssues } from './reconcile.js'


// Parameters. Some definitions hold a value only the client knows — the cutover
// date a joining date must precede. A pack object declares it,
//   params: [{ id: 'cutoverDate', label: '…', type: 'date' }]
// and a rule names it as its target, '{{cutoverDate}}'. The person supplies it
// when the object is built (the workspace asks; the CLI takes --param), and the
// object holds the plain value from then on. Never a default: a guessed cutover
// date would make a wrong joining date read as right.
export const PARAM_TYPES = ['date']
const PLACEHOLDER = /^\{\{([A-Za-z][A-Za-z0-9]*)\}\}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SAMPLE = { date: '2000-01-01' }
// 2026-02-30 matches the pattern and is no date: it must survive the round trip.
const isIsoDate = (value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return ISO_DATE.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const packParams = (pack, objectId) => (pack?.objects ?? []).find((o) => o.id === objectId)?.params ?? []

// paramIssues(pack, objectId, values) -> why the values cannot build the object, or [].
export function paramIssues(pack, objectId, values = {}) {
  const issues = []
  for (const param of packParams(pack, objectId)) {
    const value = String(values?.[param.id] ?? '').trim()
    if (!value) issues.push(`${param.label} is needed (${param.id}, YYYY-MM-DD).`)
    else if (param.type === 'date' && !isIsoDate(value)) issues.push(`${param.label} must be a real date written YYYY-MM-DD, not "${value}".`)
  }
  return issues
}

// Each rule with its placeholders replaced; an unknown placeholder stays as written.
function withParams(rules, values) {
  return rules.map((rule) => {
    const name = typeof rule?.target === 'string' ? PLACEHOLDER.exec(rule.target)?.[1] : null
    return name && values[name] !== undefined ? { ...rule, target: String(values[name]).trim() } : rule
  })
}

// packIssues(pack) -> every reason the pack cannot be used, or [] — checked by
// the same code that reads rules, formats and specs, so a pack can never hold
// a definition the engine would refuse.
export function packIssues(pack) {
  const issues = []
  if (!pack || typeof pack !== 'object') return ['the pack is not an object']
  if (!/^[a-z0-9-]+$/.test(pack.id ?? '')) issues.push('the pack has no id')
  if (!/^\d+\.\d+\.\d+$/.test(pack.version ?? '')) issues.push(`pack ${pack.id}: version must be x.y.z`)
  if (!PACK_STATUSES.includes(pack.status)) issues.push(`pack ${pack.id}: status must be draft or verified`)
  if (pack.status === 'verified' && !(pack.verified?.date && pack.verified?.against)) issues.push(`pack ${pack.id}: a verified pack names the date and the exports it was checked against`)
  const ids = new Set()
  for (const object of pack.objects ?? []) {
    const where = `${pack.id}/${object.id}`
    if (!/^[a-z0-9-]+$/.test(object.id ?? '')) issues.push(`${where}: object has no id`)
    if (ids.has(object.id)) issues.push(`${where}: the id is used twice`)
    ids.add(object.id)
    // Each object declares the headers its files carry (columns.load / source /
    // target): every rule and mapping must name one of them.
    const load = new Set(object.columns?.load ?? [])
    const declared = new Map()
    for (const param of object.params ?? []) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(param?.id ?? '') || !param?.label || !PARAM_TYPES.includes(param?.type)) issues.push(`${where}: a parameter needs an id, a label and a type (${PARAM_TYPES.join(', ')})`)
      else declared.set(param.id, SAMPLE[param.type])
    }
    for (const rule of object.contract?.rules ?? []) {
      const name = typeof rule?.target === 'string' ? PLACEHOLDER.exec(rule.target)?.[1] : null
      if (name && !declared.has(name)) issues.push(`${where}: a rule on "${rule.column}" names the parameter "${name}", which the object does not declare`)
    }
    for (const rule of withParams(object.contract?.rules ?? [], Object.fromEntries(declared))) {
      const problem = ruleIssue(rule)
      if (problem) issues.push(`${where}: rule on "${rule?.column}": ${problem}`)
      else for (const column of ruleColumns(rule)) if (!load.has(column)) issues.push(`${where}: a rule reads "${column}", which is not in the load file's columns`)
    }
    for (const role of ['load', 'source', 'target']) {
      const problem = formatIssue(object.formats?.[role])
      if (problem) issues.push(`${where}: ${role} format: ${problem}`)
    }
    if (object.spec) {
      for (const problem of specIssues(normalizeSpec(object.spec), object.columns?.source ?? [], object.columns?.target ?? [])) issues.push(`${where}: spec: ${problem}`)
    }
    if (!object.spec && !(object.contract?.rules?.length)) issues.push(`${where}: it has neither rules nor a mapping spec`)
    // Load readiness keys the load file by the target key, so it must be there.
    if (object.contract?.rules?.length) {
      for (const column of object.spec?.key?.target ?? []) if (!load.has(column)) issues.push(`${where}: the target key "${column}" is not in the load file's columns, so readiness cannot key the load file`)
    }
    if (Object.keys(object.tags ?? {}).length !== Object.keys(cleanTags(object.tags)).length) issues.push(`${where}: a tag is not one of personal, identifier, pay, aadhaar`)
  }
  if (ids.size === 0) issues.push(`pack ${pack.id}: it holds no objects`)
  return issues
}

// A pack's crosswalks are standard codes by rule (never a client's values), so
// each says so: a code list, which may be shared (shareDefinitions.js).
function codeLists(spec) {
  return {
    ...spec,
    mapping: (spec.mapping ?? []).map((field) => (field.map ? { ...field, mapKind: 'codeList' } : field)),
    totals: (spec.totals ?? []).map((total) => (total.groupBy?.map ? { ...total, groupBy: { ...total.groupBy, mapKind: 'codeList' } } : total)),
  }
}

// objectFromPack(pack, objectId, params) -> a migration object, ready for the
// files. Throws when a declared parameter is missing or unreadable: an object
// with a placeholder in a rule would compare dates against text.
export function objectFromPack(pack, objectId, params = {}) {
  const def = (pack?.objects ?? []).find((o) => o.id === objectId)
  if (!def) return null
  const issues = paramIssues(pack, objectId, params)
  if (issues.length) throw new Error(issues.join(' '))
  const values = Object.fromEntries(packParams(pack, objectId).map((p) => [p.id, String(params[p.id]).trim()]))
  const object = newMigrationObject(def.name)
  return {
    ...object,
    contract: { name: def.contract?.name ?? `${def.name} (${pack.path?.target ?? 'target'})`, rules: withParams(structuredClone(def.contract?.rules ?? []), values) },
    spec: def.spec ? { ...object.spec, ...codeLists(structuredClone(def.spec)) } : object.spec,
    formats: { ...object.formats, ...structuredClone(def.formats ?? {}) },
    tags: { ...(def.tags ?? {}) },
    signoff: { ...object.signoff, scope: def.scope ?? '', identity: { legacySystem: pack.path?.source ?? '', newSystem: pack.path?.target ?? '' } },
    pack: packRef(pack, objectId),
  }
}
