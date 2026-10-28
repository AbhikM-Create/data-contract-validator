// Sign-off: the decision a person records against an evidence pack, and the
// exact thing that decision is about. Pure.
//
// The pack's fingerprints only pay off if a decision is recorded AGAINST them:
// "accepted" means nothing unless it says which files, read by which
// definitions, gave which result. So a decision never points at "Employees,
// Mock 2" — it points at a SUBJECT: the SHA-256 of every file checked, the
// fingerprints of the rules and the mapping, and the counts each check
// produced. Change one byte of a file or one rule, and the decision no longer
// applies (subjectMatches), which is what a board must show.
//
// A subject is STORED (in the account's database, when there is one), so it
// holds the same things a saved run may hold — counts, rates, verdicts, file
// names and hashes — and never a value from a file. It is built from the run
// summaries the migration object already stores, and read back field by field
// (readSubject), so a hand-made row cannot smuggle a value in. The evidence
// pack, which quotes records, stays on the machine that made it.

import { cleanRun, summariseReadiness, summariseReconciliation } from './migrationObject.js'

export const SUBJECT_VERSION = 1

// What a signatory can decide, in the words the pack's sign-off sheet uses.
export const DECISIONS = [
  { id: 'accept', label: 'Accept' },
  { id: 'accept-with-exceptions', label: 'Accept with exceptions' },
  { id: 'reject', label: 'Reject' },
]

// Who may do what. A role is held per organisation; a person may hold several,
// but never decides on something they submitted (separation of duties — the
// database refuses it, see supabase/schema.sql).
export const ROLES = [
  { id: 'admin', label: 'Admin', does: 'invites people and assigns roles' },
  { id: 'engineer', label: 'Migration engineer', does: 'records definitions and submits checks for sign-off' },
  { id: 'data_owner', label: 'Business data owner', does: 'accepts or rejects a cycle' },
  { id: 'auditor', label: 'Auditor', does: 'reads everything, including the audit log; changes nothing' },
]

const HEX64 = /^[0-9a-f]{64}$/
const REFERENCE = /^EV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/
const LIMIT = { name: 200, reason: 1000, comment: 2000, owner: 200 }

const text = (value, max = LIMIT.name) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)
const hex = (value) => (typeof value === 'string' && HEX64.test(value) ? value : null)
const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : null)

// signoffSubject(...) -> the subject of a decision.
//
// Takes what createEvidencePack takes, plus the fingerprints and reference it
// computed, so the pack and the subject can never describe different things.
export function signoffSubject({ object, readiness, reconciliation, fingerprints, reference, generatedAt }) {
  const where = { wave: object.wave, cycle: object.cycle, at: generatedAt }
  const files = [
    readiness && { role: 'load', ...readiness.file },
    reconciliation && { role: 'source', ...reconciliation.source },
    reconciliation && { role: 'target', ...reconciliation.target },
  ].filter(Boolean)
  const checks = [
    readiness && summariseReadiness(readiness.report, { ...where, fileName: readiness.file?.name }),
    reconciliation && summariseReconciliation(reconciliation.report, { ...where, sourceName: reconciliation.source?.name, targetName: reconciliation.target?.name }),
  ].filter(Boolean)
  return readSubject({
    version: SUBJECT_VERSION,
    reference,
    generatedAt,
    object: { name: object.name, wave: object.wave, cycle: object.cycle },
    definitions: { contract: fingerprints.contract.sha256, spec: fingerprints.spec.sha256 },
    files,
    checks,
  })
}

// readSubject(raw) -> a subject rebuilt from what this version writes, or null.
//
// Every field is copied by name and type-checked. Anything else in the input —
// an example someone pasted, a field from a later version — is dropped.
export function readSubject(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== SUBJECT_VERSION) return null
  const reference = typeof raw.reference === 'string' && REFERENCE.test(raw.reference) ? raw.reference : null
  const contract = hex(raw.definitions?.contract)
  const spec = hex(raw.definitions?.spec)
  if (!reference || !contract || !spec) return null
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .filter((f) => ['load', 'source', 'target'].includes(f?.role) && hex(f?.sha256))
    .map((f) => ({ role: f.role, name: text(f.name), sha256: f.sha256, rows: whole(f.rows), bytes: whole(f.bytes) }))
  const checks = (Array.isArray(raw.checks) ? raw.checks : []).map(cleanRun).filter(Boolean)
  if (!files.length || !checks.length) return null
  return {
    version: SUBJECT_VERSION,
    reference,
    generatedAt: text(raw.generatedAt, 40),
    object: { name: text(raw.object?.name), wave: text(raw.object?.wave), cycle: text(raw.object?.cycle) },
    definitions: { contract, spec },
    files,
    checks,
  }
}

// subjectMatches(subject, current) -> { matches, changed[] }
//
// Does a decision recorded against `subject` still apply to `current` (another
// subject, built from the files and definitions in hand now)? It applies only
// if every file is byte-for-byte the same and both definitions are unchanged.
// `changed` names what moved, in words, so a board can say why a sign-off no
// longer counts.
export function subjectMatches(subject, current) {
  if (!subject || !current) return { matches: false, changed: ['nothing to compare'] }
  const changed = []
  if (subject.definitions.contract !== current.definitions.contract) changed.push('the target rules')
  if (subject.definitions.spec !== current.definitions.spec) changed.push('the mapping spec')
  for (const role of ['load', 'source', 'target']) {
    const then = subject.files.find((f) => f.role === role)
    const now = current.files.find((f) => f.role === role)
    if (!then && !now) continue
    if (!then || !now || then.sha256 !== now.sha256) changed.push(`the ${role === 'load' ? 'load file' : `${role} extract`}`)
  }
  return { matches: changed.length === 0, changed }
}

// exceptionChoices(subject) -> what a person may accept as an exception: each
// failing reconciliation step and, when the load file was not ready, the
// readiness result. An exception names one of these — never a record.
export function exceptionChoices(subject) {
  const choices = []
  for (const check of subject?.checks ?? []) {
    if (check.kind === 'readiness' && check.status !== 'READY') {
      choices.push({ id: 'readiness', label: `Load readiness: ${check.counts.rejected ?? 0} record(s) would be rejected` })
    }
    if (check.kind === 'reconcile') {
      for (const [step, status] of Object.entries(check.steps)) {
        if (status === 'FAIL') choices.push({ id: `reconcile:${step}`, label: `Reconciliation — ${step} did not pass` })
      }
    }
  }
  return choices
}

// readDecision(raw, subject) -> { decision, issues[] }
//
// The single definition of a well-formed decision. Accepting with exceptions
// needs at least one exception, each naming a finding from exceptionChoices,
// a reason and an owner; a rejection needs a comment saying why. A decision is
// typed by a person: the form asks them not to paste record values, and the
// lengths are capped, but what they write is theirs.
export function readDecision(raw, subject) {
  const issues = []
  const decision = DECISIONS.some((d) => d.id === raw?.decision) ? raw.decision : null
  if (!decision) issues.push('Choose accept, accept with exceptions, or reject.')
  const allowed = new Set(exceptionChoices(subject).map((c) => c.id))
  const exceptions = []
  for (const [i, e] of (Array.isArray(raw?.exceptions) ? raw.exceptions : []).entries()) {
    const finding = allowed.has(e?.finding) ? e.finding : null
    const reason = text(e?.reason, LIMIT.reason)
    const owner = text(e?.owner, LIMIT.owner)
    const fixBy = typeof e?.fixBy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.fixBy) ? e.fixBy : null
    if (!finding) issues.push(`Exception ${i + 1}: choose which finding it accepts.`)
    if (!reason) issues.push(`Exception ${i + 1}: say why it is acceptable.`)
    if (!owner) issues.push(`Exception ${i + 1}: name who owns the fix.`)
    exceptions.push({ finding, reason, owner, fixBy })
  }
  const comment = text(raw?.comment, LIMIT.comment)
  if (decision === 'accept-with-exceptions' && !exceptions.length) issues.push('Accepting with exceptions needs at least one exception.')
  if (decision !== 'accept-with-exceptions' && exceptions.length) issues.push('Exceptions belong to “accept with exceptions”.')
  if (decision === 'reject' && !comment) issues.push('Say why the cycle is rejected.')
  return { decision: issues.length ? null : { decision, exceptions, comment }, issues }
}
