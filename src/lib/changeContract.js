// Change contracts (design: docs/strategy/11-change-contracts-design.md).
//
// Most handoffs of business records are neither "the file must look like this"
// (rules) nor "the target must equal the source" (reconciliation). They are
// PERMITTED CHANGES: an AI run may recategorise transactions but not touch an
// amount; a salary revision may raise pay for an approved list, within a cap; a
// migration may transform some fields through a crosswalk and must preserve
// everything else.
//
// A change contract declares, before the change, what may change. A change
// check reads a BEFORE file and an AFTER file, matches records by key, and
// sorts every difference: allowed, not allowed (with whose fix), out of limits,
// approved but missing, approved but different, unlogged — or unverified, when
// a value cannot be read by its declared format. It never guesses.
//
// The one default that makes a contract safe: a column the contract does not
// name is PRESERVED. Forgetting a column cannot let it change silently.
//
// Pure, like every engine module. It reuses reconciliation's key, comparison
// and crosswalk functions, so a migration checked as a contract and as a
// reconciliation compare values the same way (changeContract.test.js holds the
// two to equal counts on the samples).

import { isBlank } from './contract.js'
import { createReader, formatIssue } from './formats.js'
import { keepFirst, keyOf, showKey, translate, valuesAgree } from './reconcile.js'
import { conditionHolds } from './rules.js'

export const CHANGE_STEPS = [
  { id: 'keys', label: 'Keys', question: 'Is every record identifiable, exactly once, in both files?' },
  { id: 'coverage', label: 'Coverage', question: 'Were records added or removed only as the contract allows?' },
  { id: 'permitted', label: 'Permitted fields', question: 'Did anything change that the contract does not allow to change?' },
  { id: 'limits', label: 'Limits', question: 'Did every allowed change stay within its policy?' },
  { id: 'approvals', label: 'Approvals', question: 'Did every approved change happen, exactly as approved?' },
  { id: 'totals', label: 'Totals', question: 'Does the net effect stay within the declared totals?' },
]

// Whose fix, by default — editable per object, like DEFAULT_OWNERS.
export const CHANGE_OWNERS = {
  keys: 'Whoever exported the files',
  coverage: 'Whoever made the change',
  permitted: 'Whoever made the change',
  limits: 'Whoever made the change',
  approvals: 'Whoever made the change',
  totals: 'The finance owner',
}

export const POLICIES = ['preserve', 'free', 'oneOf', 'map', 'bounded', 'asApproved']
export const COVERAGE = ['none', 'listed', 'any']
const DIRECTIONS = ['up', 'down', 'either']
const EXAMPLES = 5

// --- the contract -------------------------------------------------------------

const list = (value) => (value === null || value === undefined ? [] : (Array.isArray(value) ? value : [value]))
  .map((v) => String(v).trim()).filter(Boolean)
const num = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : NaN)

function keyPair(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const before = list(value.before ?? value.source)
    return { before, after: list(value.after ?? value.target ?? value.before ?? value.source), normalize: list(value.normalize) }
  }
  const both = list(value)
  return { before: both, after: both, normalize: [] }
}

function asMap(map) {
  if (!map || typeof map !== 'object') return null
  const out = new Map()
  for (const [from, to] of map instanceof Map ? map.entries() : Object.entries(map)) out.set(String(from).trim(), to)
  return out
}

// normalizeContract(raw) -> the contract as the check reads it. Idempotent: a
// normalised contract normalised again is the same contract (a crosswalk Map
// stays a Map, as in normalizeSpec).
export function normalizeContract(raw) {
  const c = raw ?? {}
  const rename = Object.fromEntries(Object.entries(c.rename ?? {}).map(([b, a]) => [String(b).trim(), String(a).trim()]))
  const fields = Object.entries(c.fields ?? {}).map(([column, f]) => {
    const policy = f?.policy ?? 'preserve'
    return {
      before: String(column).trim(),
      after: rename[String(column).trim()] ?? String(column).trim(),
      policy,
      tolerance: Math.abs(num(f?.tolerance) ?? 0) || 0,
      ignoreCase: f?.ignoreCase === true,
      values: Array.isArray(f?.values) ? f.values.map((v) => String(v).trim()) : null,
      reference: f?.reference ? String(f.reference) : null,
      map: asMap(f?.map),
      direction: f?.direction ?? 'either',
      min: num(f?.min),
      max: num(f?.max),
      minPercent: num(f?.minPercent),
      maxPercent: num(f?.maxPercent),
      onlyFor: f?.onlyFor === 'approved' ? 'approved' : null,
      approvedColumn: f?.approvedColumn ? String(f.approvedColumn).trim() : null,
      when: f?.when ?? null,
    }
  })
  const formats = { before: c.formats?.before ?? c.formats?.source ?? {}, after: c.formats?.after ?? c.formats?.target ?? {} }
  return {
    name: String(c.name ?? '').trim() || null,
    key: keyPair(c.key),
    added: c.added ?? 'none',
    removed: c.removed ?? 'none',
    others: c.others === 'ignore' ? 'ignore' : 'preserve',
    rename,
    scope: { before: c.scope?.before ?? c.scope?.source ?? null, after: c.scope?.after ?? c.scope?.target ?? null },
    fields,
    approved: c.approved ? { key: list(c.approved.key) } : null,
    changeLog: c.changeLog ? { key: list(c.changeLog.key === undefined ? null : c.changeLog.key) } : null,
    totals: (Array.isArray(c.totals) ? c.totals : []).map((t) => ({
      column: String(t?.column ?? '').trim(),
      compare: t?.compare === 'delta' ? 'delta' : 'equal',
      tolerance: Math.abs(num(t?.tolerance) ?? 0) || 0,
      min: num(t?.min),
      max: num(t?.max),
    })),
    formats,
    readers: { before: createReader(formats.before), after: createReader(formats.after) },
  }
}

const needsApproved = (contract) => contract.fields.some((f) => f.policy === 'asApproved' || f.onlyFor === 'approved')
  || contract.added === 'listed' || contract.removed === 'listed'

// contractIssues(contract, beforeColumns, afterColumns) -> [sentence]
//
// Every reason the contract cannot be run as written. A contract that names a
// column a file lacks, or a policy the check does not know, is never half-run:
// a check that quietly checks less than it claims is the failure this exists
// to catch. With no column lists (a contract checked on its own), only the
// contract's own shape is judged.
export function contractIssues(raw, beforeColumns = null, afterColumns = null) {
  const c = raw?.readers ? raw : normalizeContract(raw)
  const issues = []
  if (c.key.before.length === 0) issues.push('The contract names no key: say which column(s) identify a record.')
  if (c.key.before.length !== c.key.after.length) issues.push('The key has a different number of columns in the before and after files.')
  for (const option of c.key.normalize) if (!['stripLeadingZeros', 'ignoreCase'].includes(option)) issues.push(`"${option}" is not a key option (use stripLeadingZeros or ignoreCase).`)
  if (!COVERAGE.includes(c.added)) issues.push(`"added" must be one of ${COVERAGE.join(', ')}.`)
  if (!COVERAGE.includes(c.removed)) issues.push(`"removed" must be one of ${COVERAGE.join(', ')}.`)
  for (const side of ['before', 'after']) {
    const problem = formatIssue(c.formats[side])
    if (problem) issues.push(`The ${side} file's format: ${problem}.`)
  }
  for (const f of c.fields) {
    const name = `"${f.before}"`
    if (!POLICIES.includes(f.policy)) { issues.push(`${name}: "${f.policy}" is not a policy (use ${POLICIES.join(', ')}).`); continue }
    if (f.policy === 'oneOf' && !f.values && !f.reference) issues.push(`${name}: "oneOf" needs a list of values or a reference column.`)
    if (f.policy === 'map' && !f.map) issues.push(`${name}: "map" needs a crosswalk.`)
    if (f.policy === 'bounded') {
      if (!DIRECTIONS.includes(f.direction)) issues.push(`${name}: direction must be up, down or either.`)
      if ([f.min, f.max, f.minPercent, f.maxPercent].some((v) => Number.isNaN(v))) issues.push(`${name}: a limit is not a number.`)
      if ([f.min, f.max, f.minPercent, f.maxPercent].every((v) => v === null) && f.direction === 'either') issues.push(`${name}: "bounded" needs a limit or a direction.`)
    }
    if ((f.policy === 'asApproved' || f.onlyFor === 'approved') && !c.approved) issues.push(`${name}: it depends on the approved file, but the contract does not say how that file's records are keyed ("approved": { "key": [...] }).`)
  }
  if ((c.added === 'listed' || c.removed === 'listed') && !c.approved) issues.push('"listed" additions or removals depend on the approved file, but the contract does not say how it is keyed.')
  for (const t of c.totals) {
    if (!t.column) issues.push('A total names no column.')
    if (t.compare === 'delta' && t.min === null && t.max === null) issues.push(`The total of "${t.column}" bounds the change but gives no min or max.`)
  }
  if (beforeColumns && afterColumns) {
    const inBefore = new Set(beforeColumns)
    const inAfter = new Set(afterColumns)
    for (const k of c.key.before) if (!inBefore.has(k)) issues.push(`The before file has no key column "${k}".`)
    for (const k of c.key.after) if (!inAfter.has(k)) issues.push(`The after file has no key column "${k}".`)
    for (const f of c.fields) {
      if (!inBefore.has(f.before)) issues.push(`The before file has no column "${f.before}", which the contract names.`)
      if (!inAfter.has(f.after)) issues.push(`The after file has no column "${f.after}", which the contract names.`)
    }
    for (const t of c.totals) {
      if (t.column && !inBefore.has(t.column)) issues.push(`The before file has no column "${t.column}" for its total.`)
      if (t.column && !inAfter.has(c.rename[t.column] ?? t.column)) issues.push(`The after file has no column "${c.rename[t.column] ?? t.column}" for its total.`)
    }
  }
  return issues
}

// --- the check ------------------------------------------------------------------

function stepOf(id, status, findings, detail = {}) {
  const meta = CHANGE_STEPS.find((s) => s.id === id)
  return { id, label: meta.label, question: meta.question, status, findings, ...detail }
}

// createChangeCheck(contract, { beforeColumns, afterColumns, approved, changeLog, references, exampleLimit })
//   -> { issues, contract, observe, joinPartition, finish }
//
// The same three-part form as createReconciliation, so a file too large to hold
// can be partitioned by key on disk later: observe each row of each file, join
// one partition at a time (every record sharing a key in the same partition),
// then finish. checkChange() below runs it as one partition.
//
//   approved   rows of the approved file (the signer's), or null
//   changeLog  rows of the mover's change log, or null
//   references { name: [values] } for oneOf policies that name a reference
export function createChangeCheck(rawContract, options = {}) {
  const contract = rawContract?.readers ? rawContract : normalizeContract(rawContract)
  const limit = Number.isInteger(options.exampleLimit) && options.exampleLimit > 0 ? options.exampleLimit : EXAMPLES
  const beforeColumns = options.beforeColumns ?? null
  const afterColumns = options.afterColumns ?? null
  const issues = contractIssues(contract, beforeColumns, afterColumns)
  const { readers } = contract

  // The fields the check compares: the ones named, plus — unless the contract
  // says otherwise — every other column the two files share, preserved.
  const named = new Set(contract.fields.map((f) => f.before))
  const keyColumns = new Set(contract.key.before)
  const fields = [...contract.fields]
  const notCompared = []
  if (contract.others === 'preserve' && beforeColumns && afterColumns) {
    const inAfter = new Set(afterColumns)
    for (const column of beforeColumns) {
      if (named.has(column) || keyColumns.has(column)) continue
      const after = contract.rename[column] ?? column
      if (inAfter.has(after)) fields.push({ ...normalizeContract({ fields: { [column]: {} } }).fields[0], after, implicit: true })
      else notCompared.push(`"${column}" is in the before file only, so whether it was kept could not be checked.`)
    }
    const shared = new Set(beforeColumns.map((b) => contract.rename[b] ?? b))
    for (const column of afterColumns) if (!shared.has(column) && !contract.key.after.includes(column)) notCompared.push(`"${column}" is in the after file only: it is new, and nothing about it was checked.`)
  }

  // Inputs that may be missing: their checks are UNCHECKED, never passed.
  const approvedNeeded = needsApproved(contract)
  const approvedRows = Array.isArray(options.approved) ? options.approved : null
  const approved = new Map()
  if (approvedRows && contract.approved) {
    for (const row of approvedRows) {
      const k = keyOf(row, contract.approved.key, contract.key.normalize)
      if (k !== null) approved.set(k, row)
    }
  }
  const logRows = Array.isArray(options.changeLog) ? options.changeLog : null
  const logged = new Set()
  if (logRows && contract.changeLog) {
    const logKey = contract.changeLog.key.length ? contract.changeLog.key : contract.key.after
    for (const row of logRows) {
      const k = keyOf(row, logKey, contract.key.normalize)
      if (k !== null) logged.add(k)
    }
  }
  const references = options.references ?? {}
  const referenceSets = new Map()
  for (const f of fields) {
    if (f.policy === 'oneOf' && f.reference && references[f.reference]) {
      referenceSets.set(f.reference, new Set(references[f.reference].map((v) => fold(String(v).trim(), f.ignoreCase))))
    }
  }

  const sides = { before: newSide(contract), after: newSide(contract) }
  const counts = { matched: 0, unchanged: 0, changed: 0, allowedOnly: 0, withViolation: 0, unverified: 0, added: 0, removed: 0, addedAllowed: 0, removedAllowed: 0, approvedMissing: 0, approvedDifferent: 0, unlogged: 0, loggedUnchanged: 0 }
  const fieldStats = fields.map((f) => ({ before: f.before, after: f.after, policy: f.policy, implicit: Boolean(f.implicit), compared: 0, unchanged: 0, allowed: 0, notAllowed: 0, outOfLimits: 0, unmapped: 0, unverified: 0, approvedMissing: 0, approvedDifferent: 0, examples: [] }))
  const findings = new Map() // code -> { step, code, column, count, examples }
  const seenAfterKeys = new Set()
  const approvedSeen = new Set()

  const note = (stepId, code, column, entry) => {
    const id = `${stepId}|${code}|${column ?? ''}`
    const found = findings.get(id) ?? { step: stepId, code, column: column ?? null, count: 0, examples: [] }
    found.count += 1
    keepFirst(found.examples, entry, limit)
    findings.set(id, found)
  }

  function observe(sideName, row) {
    if (issues.length > 0) return null
    const side = sides[sideName]
    side.rows += 1
    const scope = contract.scope[sideName]
    if (scope && !conditionHolds(scope, row, readers[sideName])) {
      side.outOfScope += 1
      return null
    }
    addToTotals(side, contract, sideName, row)
    const key = keyOf(row, contract.key[sideName], contract.key.normalize)
    if (key === null) side.blankKeys += 1
    return key
  }

  function joinPartition(beforeEntries, afterEntries) {
    if (issues.length > 0) return
    const before = indexSide(beforeEntries, sides.before, limit)
    const after = indexSide(afterEntries, sides.after, limit)

    for (const [key, b] of before.unique) {
      const a = after.unique.get(key)
      if (!a) {
        if (after.duplicated.has(key)) continue // the keys step reports it once
        counts.removed += 1
        const ok = contract.removed === 'any' || (contract.removed === 'listed' && approved.has(key))
        if (ok) counts.removedAllowed += 1
        else note('coverage', 'removed-not-allowed', null, { rowNo: b.rowNo, key: showKey(key) })
        if (approved.has(key)) approvedSeen.add(key)
        continue
      }
      seenAfterKeys.add(key)
      counts.matched += 1
      judgeRecord(key, b, a)
    }
    for (const [key, a] of after.unique) {
      if (before.unique.has(key) || before.duplicated.has(key)) continue
      counts.added += 1
      const ok = contract.added === 'any' || (contract.added === 'listed' && approved.has(key))
      if (ok) counts.addedAllowed += 1
      else note('coverage', 'added-not-allowed', null, { rowNo: a.rowNo, key: showKey(key) })
      if (approved.has(key)) approvedSeen.add(key)
    }
  }

  function judgeRecord(key, b, a) {
    const isApproved = approved.has(key)
    if (isApproved) approvedSeen.add(key)
    let changed = false
    let violation = false
    let unverified = false
    let approvalDue = false
    let approvalDone = false

    fields.forEach((f, i) => {
      const stats = fieldStats[i]
      const bv = b.row[f.before]
      const av = a.row[f.after]
      stats.compared += 1
      const example = (extra = {}) => ({ rowNo: b.rowNo, key: showKey(key), before: bv ?? '', after: av ?? '', ...extra })

      // A condition, judged on the BEFORE record: where it does not hold, the
      // field must be preserved.
      const applies = conditionHolds(f.when, b.row, readers.before)
      const policy = applies ? f.policy : 'preserve'

      if (policy === 'map') {
        const t = translate(bv, f.map)
        if (t.unmapped) {
          stats.unmapped += 1
          unverified = true
          note('limits', 'unmapped', f.before, example())
          return
        }
        const reader = t.crosswalked ? readers.after : readers.before
        if (valuesAgree(t.value, av, f, reader, readers.after)) {
          if (valuesAgree(bv, av, f, readers.before, readers.after)) stats.unchanged += 1
          else { stats.allowed += 1; changed = true }
        } else {
          stats.outOfLimits += 1
          changed = true
          violation = true
          note('limits', 'out-of-limits', f.before, example({ expected: t.value }))
        }
        return
      }

      const same = valuesAgree(bv, av, f, readers.before, readers.after)
      const approvedRow = isApproved ? approved.get(key) : null
      // An approved record is expected to change in its approval-bound fields;
      // set before the "unchanged" return below, or a missing approval would
      // never be seen.
      if (f.onlyFor === 'approved' && isApproved) approvalDue = true

      if (policy === 'asApproved') {
        approvalDue = approvalDue || isApproved
        if (!approvedRow) {
          if (same) stats.unchanged += 1
          else if (!approvedRows) { stats.unverified += 1; unverified = true; changed = true }
          else { stats.notAllowed += 1; changed = true; violation = true; note('permitted', 'not-on-approved-list', f.before, example()) }
          return
        }
        const target = approvedRow[f.approvedColumn ?? f.after]
        if (isBlank(target)) {
          // Approved, but the approved file gives no value for this field:
          // any change is allowed, and a change counts as the approval done.
          if (same) stats.unchanged += 1
          else { stats.allowed += 1; changed = true; approvalDone = true }
          return
        }
        if (valuesAgree(target, av, f, readers.after, readers.after)) {
          // Now holds its approved value — by this change, or already did.
          if (same) stats.unchanged += 1
          else { stats.allowed += 1; changed = true }
          approvalDone = true
          return
        }
        if (same) {
          stats.approvedMissing += 1
          note('approvals', 'approved-missing', f.before, example({ approved: target ?? '' }))
        } else {
          stats.approvedDifferent += 1
          changed = true
          note('approvals', 'approved-different', f.before, example({ approved: target ?? '' }))
        }
        violation = true
        approvalDone = true // reported here, not again as "approved but nothing changed"
        return
      }

      if (same) { stats.unchanged += 1; return }
      changed = true

      if (f.onlyFor === 'approved') {
        if (!approvedRows) { stats.unverified += 1; unverified = true; return }
        if (!isApproved) { stats.notAllowed += 1; violation = true; note('permitted', 'not-on-approved-list', f.before, example()); return }
        approvalDone = true
      }

      if (policy === 'preserve') {
        stats.notAllowed += 1
        violation = true
        note('permitted', 'changed-not-allowed', f.before, example())
        return
      }
      if (policy === 'free') { stats.allowed += 1; return }
      if (policy === 'oneOf') {
        if (isBlank(av)) { stats.allowed += 1; return } // a cleared value: allowed unless the contract says notNull (a later option)
        const value = fold(String(av).trim(), f.ignoreCase)
        const pool = f.values ? new Set(f.values.map((v) => fold(v, f.ignoreCase))) : referenceSets.get(f.reference)
        if (!pool) { stats.unverified += 1; unverified = true; note('limits', 'missing-reference', f.before, example()); return }
        if (pool.has(value)) stats.allowed += 1
        else { stats.outOfLimits += 1; violation = true; note('limits', 'out-of-limits', f.before, example()) }
        return
      }
      if (policy === 'bounded') {
        const x = readers.before.number(bv)
        const y = readers.after.number(av)
        if (x === null || y === null) {
          // Unreadable, or a blank on one side: a change that cannot be
          // measured is never called within its limits.
          stats.unverified += 1
          unverified = true
          note('limits', 'unreadable', f.before, example())
          return
        }
        const reason = outsideBounds(f, x, y)
        if (reason) { stats.outOfLimits += 1; violation = true; note('limits', 'out-of-limits', f.before, example({ reason })) }
        else stats.allowed += 1
      }
    })

    // An approved record none of whose approval-bound fields changed: the
    // approval did not happen.
    if (approvalDue && !approvalDone) {
      counts.approvedMissing += 1
      note('approvals', 'approved-missing', null, { rowNo: b.rowNo, key: showKey(key) })
      violation = true
    }

    if (changed) {
      counts.changed += 1
      if (contract.changeLog && logRows && !logged.has(key)) {
        counts.unlogged += 1
        violation = true
        note('permitted', 'unlogged', null, { rowNo: b.rowNo, key: showKey(key) })
      }
    } else {
      counts.unchanged += 1
      if (contract.changeLog && logRows && logged.has(key)) {
        counts.loggedUnchanged += 1
        note('permitted', 'logged-unchanged', null, { rowNo: b.rowNo, key: showKey(key) })
      }
    }
    if (violation) counts.withViolation += 1
    else if (unverified) counts.unverified += 1
    else if (changed) counts.allowedOnly += 1
  }

  function finish() {
    if (issues.length > 0) {
      return { status: 'INVALID', issues, steps: CHANGE_STEPS.map((s) => stepOf(s.id, 'SKIPPED', [], { reason: 'The contract could not run.' })), counts: null, fields: [], totals: [], notChecked: [] }
    }

    // Approved records that appear in neither file.
    if (approvedRows && contract.approved) {
      for (const key of approved.keys()) {
        if (!approvedSeen.has(key)) {
          counts.approvedMissing += 1
          note('approvals', 'approved-not-found', null, { rowNo: Number.MAX_SAFE_INTEGER, key: showKey(key) })
        }
      }
    }

    const byStep = (id) => [...findings.values()].filter((f) => f.step === id).map((f) => ({ ...f, owner: CHANGE_OWNERS[id], message: sentence(f) }))
    const keyFindings = []
    for (const side of ['before', 'after']) {
      const s = sides[side]
      if (s.blankKeys > 0) keyFindings.push({ step: 'keys', code: 'blank-key', column: null, count: s.blankKeys, examples: [], owner: CHANGE_OWNERS.keys, message: `${s.blankKeys} record${s.blankKeys === 1 ? '' : 's'} in the ${side} file ha${s.blankKeys === 1 ? 's' : 've'} no key, so ${s.blankKeys === 1 ? 'it was' : 'they were'} set aside, not checked.` })
      if (s.duplicateKeys > 0) keyFindings.push({ step: 'keys', code: 'duplicate-key', column: null, count: s.duplicateKeys, examples: s.duplicateExamples.map((e) => ({ ...e, key: showKey(e.key) })), owner: CHANGE_OWNERS.keys, message: `${s.duplicateKeys} key${s.duplicateKeys === 1 ? '' : 's'} appear more than once in the ${side} file (${s.duplicateRows} records), so ${s.duplicateKeys === 1 ? 'it was' : 'they were'} set aside, not guessed at.` })
    }

    const totals = contract.totals.map((t) => judgeTotal(t, sides, contract))
    const totalFindings = totals.filter((t) => t.status === 'FAIL').map((t) => ({ step: 'totals', code: 'total-out-of-limits', column: t.column, count: 1, examples: [], owner: CHANGE_OWNERS.totals, message: t.message }))
    const totalsUnchecked = totals.some((t) => t.status === 'UNCHECKED')

    const status = (stepFindings, unchecked = false) => (stepFindings.length > 0 ? 'FAIL' : unchecked ? 'UNCHECKED' : 'PASS')
    const fieldUnverified = fieldStats.some((s) => s.unverified > 0 || s.unmapped > 0)
    const approvalsUnchecked = approvedNeeded && !approvedRows
    const steps = [
      stepOf('keys', status(keyFindings), keyFindings),
      stepOf('coverage', status(byStep('coverage')), byStep('coverage')),
      stepOf('permitted', status(byStep('permitted'), contract.changeLog && !logRows), byStep('permitted'), contract.changeLog && !logRows ? { reason: 'The contract asks for the change log, and none was given: unlogged changes could not be checked.' } : {}),
      stepOf('limits', status(byStep('limits').filter((f) => f.code === 'out-of-limits'), fieldUnverified), byStep('limits')),
      approvedNeeded
        ? stepOf('approvals', status(byStep('approvals'), approvalsUnchecked), byStep('approvals'), approvalsUnchecked ? { reason: 'The contract depends on the approved file, and none was given: approvals could not be checked.' } : {})
        : stepOf('approvals', 'SKIPPED', [], { reason: 'Nothing in this contract depends on an approved list.' }),
      contract.totals.length === 0
        ? stepOf('totals', 'SKIPPED', [], { reason: 'The contract declares no totals.' })
        : stepOf('totals', status(totalFindings, totalsUnchecked), totalFindings),
    ]
    const failed = steps.some((s) => s.status === 'FAIL')
    const unchecked = steps.some((s) => s.status === 'UNCHECKED') || counts.unverified > 0
    return {
      status: failed ? 'NOT_ALLOWED' : unchecked ? 'UNVERIFIED' : 'ALLOWED',
      issues: [],
      steps,
      counts: {
        ...counts,
        beforeRows: sides.before.rows,
        afterRows: sides.after.rows,
        outOfScope: { before: sides.before.outOfScope, after: sides.after.outOfScope },
        blankKeys: { before: sides.before.blankKeys, after: sides.after.blankKeys },
        duplicateKeys: { before: sides.before.duplicateKeys, after: sides.after.duplicateKeys },
      },
      fields: fieldStats.map(({ examples: _e, ...s }) => s),
      totals,
      notChecked: notCompared,
    }
  }

  return { issues, contract, observe, joinPartition, finish }
}

// checkChange(contract, beforeRows, afterRows, options) -> report. The check run
// as one partition, with the columns read from the rows when not given.
export function checkChange(rawContract, beforeRows, afterRows, options = {}) {
  const columnsOf = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const check = createChangeCheck(rawContract, {
    ...options,
    beforeColumns: options.beforeColumns ?? columnsOf(beforeRows),
    afterColumns: options.afterColumns ?? columnsOf(afterRows),
  })
  if (check.issues.length > 0) return check.finish()
  const entries = (side, rows) => {
    const out = []
    rows.forEach((row, i) => {
      const key = check.observe(side, row)
      if (key !== null) out.push({ key, row, rowNo: i + 2 })
    })
    return out
  }
  check.joinPartition(entries('before', beforeRows), entries('after', afterRows))
  return check.finish()
}

// toChangeContract(spec) -> the reconciliation spec as a change contract:
// every mapped field preserved (or mapped through its crosswalk), no record
// added or removed, and nothing else compared — reconciliation compares only
// the fields it maps.
export function toChangeContract(spec) {
  const fields = {}
  const rename = {}
  for (const field of spec.mapping ?? []) {
    const before = String(field.source ?? '').trim()
    const after = String(field.target ?? field.source ?? '').trim()
    if (after !== before) rename[before] = after
    fields[before] = field.map
      ? { policy: 'map', map: field.map, tolerance: field.tolerance, ignoreCase: field.ignoreCase }
      : { policy: 'preserve', tolerance: field.tolerance, ignoreCase: field.ignoreCase }
  }
  return {
    name: spec.name ?? null,
    key: { before: spec.key?.source ?? spec.key, after: spec.key?.target ?? spec.key?.source ?? spec.key, normalize: spec.key?.normalize ?? [] },
    added: 'none',
    removed: 'none',
    others: 'ignore',
    rename,
    scope: { before: spec.scope?.source ?? null, after: spec.scope?.target ?? null },
    fields,
    formats: { before: spec.formats?.source ?? {}, after: spec.formats?.target ?? {} },
  }
}

// --- helpers --------------------------------------------------------------------

function fold(text, ignoreCase) {
  return ignoreCase ? text.toUpperCase().toLowerCase() : text
}

function newSide(contract) {
  return { rows: 0, outOfScope: 0, blankKeys: 0, duplicateKeys: 0, duplicateRows: 0, duplicateExamples: [], totals: contract.totals.map(() => ({ sum: 0, unreadable: 0 })) }
}

function addToTotals(side, contract, sideName, row) {
  contract.totals.forEach((t, i) => {
    const column = sideName === 'after' ? (contract.rename[t.column] ?? t.column) : t.column
    const value = contract.readers[sideName].number(row[column])
    if (value !== null) side.totals[i].sum += value
    else if (!isBlank(row[column])) side.totals[i].unreadable += 1
  })
}

function indexSide(entries, side, limit) {
  const byKey = new Map()
  for (const entry of entries) {
    const hit = byKey.get(entry.key)
    if (hit) hit.count += 1
    else byKey.set(entry.key, { row: entry.row, rowNo: entry.rowNo, count: 1 })
  }
  const unique = new Map()
  const duplicated = new Set()
  for (const [key, hit] of byKey) {
    if (hit.count > 1) {
      duplicated.add(key)
      side.duplicateKeys += 1
      side.duplicateRows += hit.count
      keepFirst(side.duplicateExamples, { rowNo: hit.rowNo, key, count: hit.count }, limit)
    } else unique.set(key, hit)
  }
  return { unique, duplicated }
}

// Why a bounded change falls outside its limits, or null when it is within them.
export function outsideBounds(f, before, after) {
  const delta = after - before
  if (f.direction === 'up' && delta < 0) return 'went down; the contract allows only increases'
  if (f.direction === 'down' && delta > 0) return 'went up; the contract allows only decreases'
  if (f.min !== null && delta < f.min) return `changed by ${round(delta)}, below the allowed ${f.min}`
  if (f.max !== null && delta > f.max) return `changed by ${round(delta)}, above the allowed ${f.max}`
  if (f.minPercent !== null || f.maxPercent !== null) {
    if (before === 0) return 'changed from zero, so a percentage limit cannot be applied'
    const percent = (delta / Math.abs(before)) * 100
    if (f.minPercent !== null && percent < f.minPercent - 1e-9) return `changed by ${round(percent)}%, below the allowed ${f.minPercent}%`
    if (f.maxPercent !== null && percent > f.maxPercent + 1e-9) return `changed by ${round(percent)}%, above the allowed ${f.maxPercent}%`
  }
  return null
}

function judgeTotal(t, sides, contract) {
  const before = sides.before.totals[contract.totals.indexOf(t)]
  const after = sides.after.totals[contract.totals.indexOf(t)]
  const base = { column: t.column, compare: t.compare, before: round(before.sum), after: round(after.sum), change: round(after.sum - before.sum) }
  if (before.unreadable > 0 || after.unreadable > 0) {
    return { ...base, status: 'UNCHECKED', message: `The total of "${t.column}" could not be judged: ${before.unreadable + after.unreadable} value${before.unreadable + after.unreadable === 1 ? '' : 's'} could not be read as numbers, and are never summed as zero.` }
  }
  const delta = after.sum - before.sum
  if (t.compare === 'equal') {
    const ok = Math.abs(delta) <= t.tolerance + Math.max(Math.abs(before.sum), Math.abs(after.sum)) * 1e-12
    return { ...base, status: ok ? 'PASS' : 'FAIL', message: ok ? `The total of "${t.column}" is unchanged.` : `The total of "${t.column}" changed by ${round(delta)}; the contract says it must not.` }
  }
  const low = t.min !== null && delta < t.min
  const high = t.max !== null && delta > t.max
  const ok = !low && !high
  return { ...base, status: ok ? 'PASS' : 'FAIL', message: ok ? `The total of "${t.column}" changed by ${round(delta)}, within the allowed range.` : `The total of "${t.column}" changed by ${round(delta)}, ${high ? `above the allowed ${t.max}` : `below the allowed ${t.min}`}.` }
}

const round = (n) => Math.round(n * 100) / 100

function sentence(f) {
  const n = f.count
  const records = `${n} record${n === 1 ? '' : 's'}`
  const col = f.column ? `"${f.column}"` : null
  switch (f.code) {
    case 'removed-not-allowed': return `${records} in the before file ${n === 1 ? 'is' : 'are'} missing from the after file; the contract allows no removals.`
    case 'added-not-allowed': return `${records} in the after file ${n === 1 ? 'was' : 'were'} not in the before file; the contract allows no additions.`
    case 'changed-not-allowed': return `${col} changed in ${records}; the contract says it must stay the same.`
    case 'not-on-approved-list': return `${col} changed in ${records} that ${n === 1 ? 'is' : 'are'} not on the approved list.`
    case 'unlogged': return `${records} changed but ${n === 1 ? 'is' : 'are'} not in the change log.`
    case 'logged-unchanged': return `${records} ${n === 1 ? 'is' : 'are'} in the change log but did not change.`
    case 'out-of-limits': return `${col} changed beyond its policy in ${records}.`
    case 'unmapped': return `${col} has no crosswalk entry for the value in ${records}, so the change could not be checked.`
    case 'unreadable': return `${col} could not be read as a number in ${records}, so the size of the change could not be measured.`
    case 'missing-reference': return `${col} is checked against a reference file that was not given, in ${records}.`
    case 'approved-missing': return col ? `${col} did not change to its approved value in ${records}.` : `${records} on the approved list did not change.`
    case 'approved-different': return `${col} changed to something other than its approved value in ${records}.`
    case 'approved-not-found': return `${records} on the approved list ${n === 1 ? 'is' : 'are'} in neither file.`
    default: return `${records}: ${f.code}${col ? ` (${col})` : ''}.`
  }
}
