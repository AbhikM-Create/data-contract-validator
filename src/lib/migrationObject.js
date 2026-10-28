// A migration object: one thing being moved — employees, vendors, open items —
// with everything that assures it kept together. Pure: no DOM, no network.
//
//   contract   what the TARGET requires (rules) — load readiness, and after
//              go-live the production contract
//   spec       how source records correspond to target records — reconciliation
//   runs       what each check found, wave by wave and cycle by cycle
//
// It is saved as a portable JSON file the CLIs also read, so the engineer's
// pipeline and the data owner's screen work from the same file in git.
//
// THIS IS A DATA BOUNDARY, like contractFile.js and runRecord.js. The contract
// and spec hold only what a person authored. A run holds counts, rates and
// verdicts — never a key, a value, an example or a group label, because those
// are real records out of the files. A test proves no value can reach it.

import { readRules, serializeContract } from './contractFile.js'

export const MIGRATION_OBJECT_VERSION = 1
const KIND = 'data-contract-validator/migration-object'

// The cycles a real programme runs each object through, in order. Free text is
// allowed too; these are what the picker offers.
export const CYCLES = ['Mock 1', 'Mock 2', 'Mock 3', 'Dress rehearsal', 'Cutover']

export function newMigrationObject(name = '') {
  return {
    name,
    wave: 'Wave 1',
    cycle: CYCLES[0],
    contract: { name: '', rules: [] },
    spec: emptySpec(),
    runs: [],
  }
}

export function emptySpec() {
  return { key: { source: [''], target: [''] }, scope: { source: null }, mapping: [], totals: [] }
}

// --- the spec, as a person authors it ----------------------------------------
// The builder edits this shape directly; normalizeSpec (reconcile.js) is what
// the engine reads. cleanSpec keeps only fields the engine understands, so a
// saved file never carries UI state or stray keys.

function cleanMap(map) {
  if (!map || typeof map !== 'object') return undefined
  const entries = Object.entries(map instanceof Map ? Object.fromEntries(map) : map)
    .map(([from, to]) => [String(from).trim(), String(to ?? '').trim()])
    .filter(([from]) => from !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function cleanSpec(spec) {
  const s = spec ?? {}
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v ?? '').trim())
  const out = {
    key: { source: list(s.key?.source).filter(Boolean), target: list(s.key?.target).filter(Boolean) },
    mapping: (Array.isArray(s.mapping) ? s.mapping : [])
      .filter((field) => field?.source || field?.target)
      .map((field) => {
        const clean = { source: String(field.source ?? '').trim(), target: String(field.target ?? '').trim() }
        const tolerance = Number(field.tolerance)
        if (Number.isFinite(tolerance) && tolerance > 0) clean.tolerance = tolerance
        if (field.ignoreCase) clean.ignoreCase = true
        const map = cleanMap(field.map)
        if (map) clean.map = map
        return clean
      }),
    totals: (Array.isArray(s.totals) ? s.totals : [])
      .filter((total) => total?.source || total?.target)
      .map((total) => {
        const clean = { source: String(total.source ?? '').trim(), target: String(total.target ?? '').trim() }
        if (total.groupBy?.source || total.groupBy?.target) {
          clean.groupBy = { source: String(total.groupBy.source ?? '').trim(), target: String(total.groupBy.target ?? '').trim() }
          const map = cleanMap(total.groupBy.map)
          if (map) clean.groupBy.map = map
        }
        return clean
      }),
  }
  const scope = s.scope?.source
  if (scope?.column) {
    out.scope = { source: { column: scope.column, op: scope.op ?? '=', target: scope.op === 'notNull' ? null : String(scope.target ?? '') } }
  }
  return out
}

// The same spec, re-opened for editing: at least one key slot on each side, so
// the builder always has a dropdown to show.
function editableSpec(spec) {
  const clean = cleanSpec(spec)
  return {
    key: {
      source: clean.key.source.length ? clean.key.source : [''],
      target: clean.key.target.length ? clean.key.target : [''],
    },
    scope: { source: clean.scope?.source ?? null },
    mapping: clean.mapping,
    totals: clean.totals,
  }
}

// --- run summaries: the data boundary ----------------------------------------

const count = (value) => (Number.isFinite(value) ? value : null)
const ratio = (part, whole) => (whole > 0 ? part / whole : null)

// summariseReconciliation(report, context) -> a run record holding no values.
export function summariseReconciliation(report, { wave, cycle, sourceName, targetName, at } = {}) {
  if (!report || report.status === 'INVALID') return null
  const c = report.counts
  return {
    kind: 'reconcile',
    at: at ?? new Date().toISOString(),
    wave: wave ?? null,
    cycle: cycle ?? null,
    files: { source: sourceName ?? null, target: targetName ?? null },
    status: report.status,
    steps: Object.fromEntries(report.steps.map((step) => [step.id, step.status])),
    counts: {
      sourceRows: count(c.sourceRows),
      targetRows: count(c.targetRows),
      outOfScope: count(c.sourceOutOfScope),
      expected: count(c.expected),
      matched: count(c.matched),
      missing: count(c.missing),
      extra: count(c.extra),
      duplicateKeys: count((c.sourceDuplicateKeys ?? 0) + (c.targetDuplicateKeys ?? 0)),
      blankKeys: count((c.sourceBlankKeys ?? 0) + (c.targetBlankKeys ?? 0)),
      withDifferences: count(c.rowsWithDifference),
      unverified: count(c.rowsUnverified),
      unmappedRecords: count(report.fields.reduce((sum, f) => sum + f.unmapped, 0)),
      totalsBroken: count(report.totals.reduce((sum, t) => sum + t.groups.filter((g) => !g.ties).length, 0)),
    },
    completeness: ratio(c.matched, c.expected),
    accuracy: ratio(c.rowsFullyMatched, c.matched),
  }
}

// summariseReadiness(report, context) -> a run record holding no values.
export function summariseReadiness(report, { wave, cycle, fileName, at } = {}) {
  if (!report || report.status === 'INVALID') return null
  const c = report.counts
  return {
    kind: 'readiness',
    at: at ?? new Date().toISOString(),
    wave: wave ?? null,
    cycle: cycle ?? null,
    files: { load: fileName ?? null },
    status: report.status,
    counts: {
      records: count(c.records),
      rejected: count(c.rejected),
      warned: count(c.warned),
      clean: count(c.clean),
      checksFailing: count(report.checks.filter((check) => check.status === 'FAIL').length),
      checksUnchecked: count(report.checks.filter((check) => check.status === 'UNCHECKED').length),
    },
    acceptance: ratio(c.records - c.rejected, c.records),
  }
}

// A run read back from a file is rebuilt field by field from what this version
// writes — so a hand-edited file cannot smuggle a value into the history, and
// a field added to runs later is NOT kept unless it is added here on purpose.
function cleanRun(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = raw.kind === 'reconcile' || raw.kind === 'readiness' ? raw.kind : null
  if (!kind) return null
  const numbers = (object, keys) => Object.fromEntries(keys.map((k) => [k, count(Number(object?.[k]))]))
  const text = (value) => (typeof value === 'string' ? value.slice(0, 200) : null)
  const base = {
    kind,
    at: text(raw.at),
    wave: text(raw.wave),
    cycle: text(raw.cycle),
    status: text(raw.status),
  }
  if (kind === 'reconcile') {
    return {
      ...base,
      files: { source: text(raw.files?.source), target: text(raw.files?.target) },
      steps: Object.fromEntries(['keys', 'completeness', 'mapping', 'accuracy', 'totals'].map((id) => [id, text(raw.steps?.[id])])),
      counts: numbers(raw.counts, ['sourceRows', 'targetRows', 'outOfScope', 'expected', 'matched', 'missing', 'extra', 'duplicateKeys', 'blankKeys', 'withDifferences', 'unverified', 'unmappedRecords', 'totalsBroken']),
      completeness: count(Number(raw.completeness)),
      accuracy: count(Number(raw.accuracy)),
    }
  }
  return {
    ...base,
    files: { load: text(raw.files?.load) },
    counts: numbers(raw.counts, ['records', 'rejected', 'warned', 'clean', 'checksFailing', 'checksUnchecked']),
    acceptance: count(Number(raw.acceptance)),
  }
}

// --- history -------------------------------------------------------------------

// cycleHistory(runs) -> runs newest first, each with the change since the
// previous run of the same kind — the PMO's question is "is it getting
// better?", and no single run answers that.
export function cycleHistory(runs) {
  const ordered = [...(runs ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const lastOfKind = {}
  const rows = ordered.map((run) => {
    const previous = lastOfKind[run.kind] ?? null
    lastOfKind[run.kind] = run
    const metric = run.kind === 'reconcile' ? 'completeness' : 'acceptance'
    const now = run[metric]
    const before = previous?.[metric]
    return {
      run,
      metric,
      value: now ?? null,
      change: Number.isFinite(now) && Number.isFinite(before) ? now - before : null,
      previousCycle: previous ? `${previous.wave ?? ''} ${previous.cycle ?? ''}`.trim() : null,
    }
  })
  return rows.reverse()
}

// --- the file ------------------------------------------------------------------

export function serializeMigrationObject(object, { savedAt } = {}) {
  const contract = serializeContract({ name: object.contract?.name || object.name, rules: object.contract?.rules ?? [] })
  return {
    kind: KIND,
    formatVersion: MIGRATION_OBJECT_VERSION,
    name: String(object.name ?? '').trim() || 'Untitled object',
    wave: String(object.wave ?? '').trim() || null,
    cycle: String(object.cycle ?? '').trim() || null,
    savedAt: savedAt ?? new Date().toISOString(),
    contract: { name: contract.name, rules: contract.rules },
    spec: cleanSpec(object.spec),
    runs: (object.runs ?? []).map(cleanRun).filter(Boolean),
  }
}

export function migrationObjectToJson(object) {
  return `${JSON.stringify(serializeMigrationObject(object), null, 2)}\n`
}

export function isMigrationObjectFile(parsed) {
  return parsed?.kind === KIND
}

// parseMigrationObjectFile(text) -> { object, skipped, error }
//
// A rule this version cannot read is REPORTED in `skipped`, never dropped in
// silence — the same judgement contractFile.js makes, made by the same code.
export function parseMigrationObjectFile(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? ''))
  } catch {
    return fail('this file is not valid JSON')
  }
  return readMigrationObject(parsed)
}

export function readMigrationObject(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('this file does not contain a migration object')
  if (parsed.kind !== KIND) return fail('this JSON file is something else — it was not saved as a migration object by this tool')
  if (Number(parsed.formatVersion) > MIGRATION_OBJECT_VERSION) {
    return fail(`it was saved in format version ${parsed.formatVersion}, which is newer than this app understands (version ${MIGRATION_OBJECT_VERSION})`)
  }
  const { rules, skipped } = readRules(parsed.contract?.rules)
  return {
    object: {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      wave: typeof parsed.wave === 'string' ? parsed.wave : 'Wave 1',
      cycle: typeof parsed.cycle === 'string' ? parsed.cycle : CYCLES[0],
      contract: { name: typeof parsed.contract?.name === 'string' ? parsed.contract.name : '', rules },
      spec: editableSpec(parsed.spec),
      runs: (Array.isArray(parsed.runs) ? parsed.runs : []).map(cleanRun).filter(Boolean),
    },
    skipped,
    error: null,
  }
}

function fail(reason) {
  return { object: null, skipped: [], error: `Couldn’t open this migration object — ${reason}.` }
}

// The object's spec exactly as it is saved, which is exactly what reconcile()
// and the CLI run — there is no second form to drift from it.
export function runnableSpec(object) {
  return { name: object?.name || null, ...cleanSpec(object?.spec) }
}

// --- builder helpers -----------------------------------------------------------

const comparable = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '')

// suggestFieldPairs(sourceColumns, targetColumns, taken) -> [{ source, target }]
//
// Only names that are the same once case, spaces and punctuation are ignored —
// "Hire Date" and "hire_date". Anything cleverer (PERNR -> employee_id) is a
// guess, and a mapping built on guesses is how a load gets reconciled against
// the wrong column with a clean bill of health.
export function suggestFieldPairs(sourceColumns, targetColumns, taken = []) {
  const used = new Set(taken.flatMap((pair) => [`s:${pair.source}`, `t:${pair.target}`]))
  const byName = new Map()
  for (const target of targetColumns ?? []) {
    if (!byName.has(comparable(target))) byName.set(comparable(target), target)
  }
  const pairs = []
  for (const source of sourceColumns ?? []) {
    const target = byName.get(comparable(source))
    if (!target || used.has(`s:${source}`) || used.has(`t:${target}`)) continue
    pairs.push({ source, target })
    used.add(`t:${target}`)
  }
  return pairs
}

// readCrosswalk(parsed) -> { map, entries, issues }
//
// A crosswalk is a two-column CSV: legacy value, target value. The first two
// columns are used whatever they are called. A legacy value listed twice with
// two different targets is refused — the crosswalk would be choosing for you.
export function readCrosswalk(parsed) {
  const columns = parsed?.columns ?? []
  if (columns.length < 2) {
    return { map: null, entries: 0, issues: ['A crosswalk needs two columns: the legacy value, then the value it becomes in the target.'] }
  }
  const [fromColumn, toColumn] = columns
  const map = Object.create(null)
  const issues = []
  let conflicts = 0
  let blank = 0
  for (const row of parsed.rows ?? []) {
    const from = String(row[fromColumn] ?? '').trim()
    const to = String(row[toColumn] ?? '').trim()
    if (from === '') {
      blank += 1
      continue
    }
    if (Object.hasOwn(map, from) && map[from] !== to) {
      conflicts += 1
      issues.push(`"${from}" is listed twice, becoming "${map[from]}" and "${to}". Keep one.`)
      continue
    }
    map[from] = to
  }
  if (blank > 0) issues.push(`${blank} row${blank === 1 ? ' has' : 's have'} no legacy value and ${blank === 1 ? 'was' : 'were'} left out.`)
  const entries = Object.keys(map).length
  if (entries === 0) issues.push('The crosswalk has no usable rows.')
  // Refused outright on a conflict: keeping either target would be the
  // crosswalk choosing for you, and reconciling against its choice would pass
  // or fail records on a decision nobody made.
  return { map: entries > 0 && conflicts === 0 ? map : null, entries, issues }
}
