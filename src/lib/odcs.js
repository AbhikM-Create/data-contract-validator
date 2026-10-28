// Open Data Contract Standard (ODCS v3, https://bitol-io.github.io/open-data-contract-standard/)
// in and out. Pure: no file handling.
//
// ODCS is how data catalogs (Collibra, Atlan, DataHub and others) and other
// quality tools exchange contracts. Speaking it means a contract written here
// can be registered in the catalog, and a contract already in the catalog can
// be checked here — instead of every rule living in a format only this tool
// reads.
//
// EXPORT is lossless. A rule with an exact ODCS equivalent is written as plain
// ODCS — not blank -> `required`, a type -> `logicalType`, an allowed list ->
// the `invalidValues` metric — so any ODCS tool understands it. A rule ODCS
// cannot express (a WHEN condition, a cross-column comparison, a range, a
// warning-only severity on `required`) is written as an ODCS `custom` check
// for engine "data-contract-validator", holding the exact rule, so a round
// trip through a catalog loses nothing.
//
// IMPORT is honest. What maps to a rule this tool enforces becomes that rule;
// everything else is listed in `notImported` with the reason — a tolerance
// ("at most 5% invalid"), a pattern, a uniqueness check, another engine's
// custom check. A contract that quietly enforced less than its ODCS source
// claimed is the failure this tool exists to catch.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { cleanFormat, formatIssue } from './formats.js'
import { describeRule, ruleIssue, RULE_KINDS, ruleSeverity } from './rules.js'

export const ODCS_API_VERSION = 'v3.2.0'
export const ENGINE = 'data-contract-validator'
const FORMAT_PROPERTY = 'dataContractValidatorFormat'

const TYPE_TO_ODCS = { numeric: 'number', date: 'date', boolean: 'boolean', string: 'string' }
const ODCS_TO_TYPE = { number: 'numeric', integer: 'numeric', date: 'date', timestamp: 'date', boolean: 'boolean' }

const slug = (text) => String(text ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'contract'
// ODCS stable ids may not hold whitespace or . # / \ @ ! % & ^
const stableId = (text) => String(text).replace(/[\s.#/\\@!%&^]+/g, '_')

// --- export -------------------------------------------------------------------

// exportOdcs({ name, rules, format }, { id, version, objectName }) -> ODCS object
export function exportOdcs(contract, options = {}) {
  const rules = (contract?.rules ?? []).filter((rule) => !ruleIssue(rule))
  const properties = new Map()
  const property = (column) => {
    if (!properties.has(column)) properties.set(column, { name: column })
    return properties.get(column)
  }
  const ids = new Map()
  const idFor = (rule) => {
    const base = stableId(`${rule.column}_${rule.kind}`)
    const n = (ids.get(base) ?? 0) + 1
    ids.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  }
  const addQuality = (column, check) => {
    const p = property(column)
    p.quality = [...(p.quality ?? []), check]
  }

  for (const rule of rules) {
    // "Plain": no condition, no warning-only severity, no layer override — the
    // only rules plain ODCS fields can carry without losing anything.
    const plain = !rule.when && !rule.layer && ruleSeverity(rule) === 'reject'
    const p = property(rule.column)

    // logicalType: string asserts nothing a CSV cell does not already satisfy,
    // and is read back as no rule at all — so a "must hold text" rule is kept
    // exact as a custom check instead.
    if (rule.kind === RULE_KINDS.TYPE && plain && rule.target !== 'string' && !p.logicalType) {
      p.logicalType = TYPE_TO_ODCS[rule.target]
      continue
    }
    if (rule.kind === RULE_KINDS.NULL_RULE && rule.op === 'notNull' && plain && !p.required) {
      p.required = true
      continue
    }
    if (rule.kind === RULE_KINDS.VALUE_SET && !rule.when && !rule.layer) {
      addQuality(rule.column, {
        id: idFor(rule),
        description: describeRule(rule),
        metric: 'invalidValues',
        arguments: { validValues: rule.target.map(String) },
        mustBe: 0,
        severity: ruleSeverity(rule) === 'warn' ? 'warning' : 'error',
      })
      continue
    }
    // Everything else, exactly — under our engine's name, so other tools skip
    // it knowingly and this one reads it back as written.
    addQuality(rule.column, {
      id: idFor(rule),
      type: 'custom',
      description: describeRule(rule),
      engine: ENGINE,
      implementation: rule,
      severity: ruleSeverity(rule) === 'warn' ? 'warning' : 'error',
    })
  }

  const format = cleanFormat(contract?.format)
  const name = String(contract?.name ?? '').trim() || 'Untitled contract'
  return {
    apiVersion: ODCS_API_VERSION,
    kind: 'DataContract',
    id: options.id ?? `${ENGINE}-${slug(name)}`,
    name,
    version: options.version ?? '1.0.0',
    status: 'active',
    schema: [{ name: options.objectName ?? slug(name), logicalType: 'object', properties: [...properties.values()] }],
    ...(format
      ? {
          customProperties: [{
            property: FORMAT_PROPERTY,
            value: format,
            vendor: ENGINE,
            description: 'How files checked against this contract are written: encoding, decimal mark, date pattern.',
          }],
        }
      : {}),
  }
}

export function toOdcsYaml(contract, options) {
  return stringifyYaml(exportOdcs(contract, options), { lineWidth: 0 })
}

// --- import -------------------------------------------------------------------

// parseOdcs(text) -> the ODCS document, from YAML or JSON (JSON is YAML).
export function parseOdcs(text) {
  try {
    return { doc: parseYaml(String(text ?? '')), error: null }
  } catch (error) {
    return { doc: null, error: `this file is neither YAML nor JSON (${error.message.split('\n')[0]})` }
  }
}

const severityOf = (check) => (/^(warn|warning|info)$/i.test(String(check?.severity ?? '')) ? 'warn' : 'reject')
const withSeverity = (rule, severity) => (severity === 'warn' ? { ...rule, severity: 'warn' } : rule)

// importOdcs(doc, { object }) -> { name, rules, format, notImported, objects, error }
//
// `object` names the schema object to import when the contract describes more
// than one; this tool checks one file against one object.
export function importOdcs(doc, options = {}) {
  const fail = (reason, extra = {}) => ({ name: null, rules: [], format: null, notImported: [], objects: [], error: `Couldn’t import this ODCS contract — ${reason}.`, ...extra })
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail('the file does not hold a contract')
  if (doc.kind !== 'DataContract') return fail('it is not an ODCS DataContract (kind is missing or different)')
  if (!/^v3\./.test(String(doc.apiVersion ?? ''))) {
    return fail(`it is ODCS ${doc.apiVersion ?? 'of an unknown version'}; this tool reads ODCS v3`)
  }

  const objects = (Array.isArray(doc.schema) ? doc.schema : []).filter((o) => o && typeof o === 'object')
  const names = objects.map((o) => o.name)
  let object
  if (options.object) {
    object = objects.find((o) => o.name === options.object)
    if (!object) return fail(`it has no schema object "${options.object}" (it has ${names.map((n) => `"${n}"`).join(', ') || 'none'})`, { objects: names })
  } else if (objects.length === 1) {
    object = objects[0]
  } else {
    return fail(objects.length === 0
      ? 'it describes no schema objects'
      : `it describes ${objects.length} schema objects (${names.map((n) => `"${n}"`).join(', ')}); choose the one to check`, { objects: names })
  }

  const rules = []
  const notImported = []
  const skip = (where, what, reason) => notImported.push({ where, what, reason })

  // How the files are written, if this tool wrote the contract.
  let format = null
  for (const cp of Array.isArray(doc.customProperties) ? doc.customProperties : []) {
    if (cp?.property !== FORMAT_PROPERTY) continue
    const problem = formatIssue(cp.value)
    if (problem) return fail(`its file format cannot be used: ${problem}`)
    format = cleanFormat(cp.value) ?? null
  }

  for (const check of Array.isArray(object.quality) ? object.quality : []) {
    skip(object.name, describeCheck(check), 'a check across the whole object (a row count, duplicates across columns) is not one of this tool’s rules')
  }

  for (const prop of Array.isArray(object.properties) ? object.properties : []) {
    const column = prop?.name
    if (!column) continue
    const where = `${object.name}.${column}`

    if (prop.required === true) rules.push({ kind: RULE_KINDS.NULL_RULE, column, op: 'notNull', target: null })

    if (prop.logicalType && prop.logicalType !== 'string') {
      const type = ODCS_TO_TYPE[prop.logicalType]
      if (type) {
        rules.push({ kind: RULE_KINDS.TYPE, column, op: '=', target: type })
        if (prop.logicalType === 'integer') skip(where, 'logicalType: integer', 'imported as numeric — this tool does not check for whole numbers')
      } else {
        skip(where, `logicalType: ${prop.logicalType}`, 'a CSV cell cannot hold this type, so there is nothing to check')
      }
    }

    const options2 = prop.logicalTypeOptions ?? {}
    importBounds(column, options2, rules, (what, reason) => skip(where, what, reason))

    if (prop.unique === true || prop.primaryKey === true) {
      skip(where, prop.primaryKey ? 'primaryKey' : 'unique', `uniqueness is checked as the record key — run the check with --key ${column} (or set it as the target key)`)
    }

    for (const check of Array.isArray(prop.quality) ? prop.quality : []) {
      const imported = importCheck(check, column)
      if (imported.rule) rules.push(imported.rule)
      else skip(where, describeCheck(check), imported.reason)
    }
  }

  return { name: String(doc.name ?? doc.id ?? '').trim() || 'Imported contract', rules, format, notImported, objects: names, error: null }
}

function importBounds(column, opts, rules, skip) {
  const has = (k) => opts[k] !== undefined && opts[k] !== null
  if (has('minimum') && has('maximum')) {
    rules.push({ kind: RULE_KINDS.RANGE, column, op: 'between', target: [opts.minimum, opts.maximum] })
  } else if (has('minimum')) {
    rules.push({ kind: RULE_KINDS.COMPARISON, column, op: '>=', target: String(opts.minimum) })
  } else if (has('maximum')) {
    rules.push({ kind: RULE_KINDS.COMPARISON, column, op: '<=', target: String(opts.maximum) })
  }
  if (has('exclusiveMinimum')) rules.push({ kind: RULE_KINDS.COMPARISON, column, op: '>', target: String(opts.exclusiveMinimum) })
  if (has('exclusiveMaximum')) rules.push({ kind: RULE_KINDS.COMPARISON, column, op: '<', target: String(opts.exclusiveMaximum) })
  for (const key of Object.keys(opts)) {
    if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key)) continue
    skip(`logicalTypeOptions.${key}`, 'this tool has no rule for it (no length, pattern or format checks)')
  }
}

// A check this tool can enforce EXACTLY — every record, no tolerance — or the
// reason it cannot.
function importCheck(check, column) {
  if (!check || typeof check !== 'object') return { reason: 'the check is not an object' }
  const severity = severityOf(check)

  if (check.type === 'custom') {
    if (check.engine !== ENGINE) return { reason: `a check for ${check.engine ?? 'another engine'}, which this tool does not run` }
    const rule = check.implementation
    const problem = ruleIssue(rule)
    if (problem) return { reason: `its rule cannot be read: ${problem}` }
    return { rule }
  }
  if (check.type === 'sql') return { reason: 'an SQL check runs against a database, not a file' }
  if (check.type === 'text') return { reason: 'a description for people, not a check' }

  const metric = check.metric ?? check.rule
  const exactlyZero = check.mustBe === 0 && (check.unit === undefined || check.unit === 'rows' || check.unit === 'percent')
  const tolerance = () => ({ reason: 'it tolerates some failing records; this tool’s rules hold for every record, so importing it would make it stricter than written' })

  if (metric === 'nullValues') {
    if (!exactlyZero) return tolerance()
    return { rule: withSeverity({ kind: RULE_KINDS.NULL_RULE, column, op: 'notNull', target: null }, severity) }
  }
  if (metric === 'invalidValues') {
    const valid = check.arguments?.validValues
    if (check.arguments?.pattern) return { reason: 'a pattern check — this tool has no pattern rule' }
    if (!Array.isArray(valid) || valid.length === 0) return { reason: 'it lists no valid values' }
    if (!exactlyZero) return tolerance()
    const allowed = valid.filter((v) => v !== null && v !== '').map(String)
    if (allowed.length === 0) return { reason: 'its valid values are only blanks' }
    return { rule: withSeverity({ kind: RULE_KINDS.VALUE_SET, column, op: 'in', target: allowed }, severity) }
  }
  return { reason: `the "${metric ?? check.type ?? 'unknown'}" check has no equivalent rule here` }
}

function describeCheck(check) {
  if (!check || typeof check !== 'object') return 'a quality check'
  const label = check.name ?? check.id ?? check.metric ?? check.rule ?? check.type ?? 'check'
  return `quality: ${label}${check.description ? ` — ${check.description}` : ''}`
}
