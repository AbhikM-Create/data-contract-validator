// What the organisation tables hold, built and read in one place. Pure — the
// Supabase calls are in orgStore.js; everything here is testable without one.
//
// A definition row is the canonical JSON the evidence pack prints, parsed; its
// fingerprint is checked again on every read, because the database cannot
// recompute a canonical form and a row is only worth something if its body is
// what was fingerprinted.

import { canonicalJson, sha256Hex } from './hashing.js'
import { DECISIONS, readSubject, ROLES } from './signoff.js'

// definitionRows(orgId, fingerprints, objectName) -> rows for `definitions`
export function definitionRows(orgId, fingerprints, objectName) {
  return ['contract', 'spec'].map((kind) => ({
    org_id: orgId,
    kind,
    sha256: fingerprints[kind].sha256,
    body: JSON.parse(fingerprints[kind].json),
    object_name: objectName || null,
  }))
}

// verifyDefinition(row) -> { verified, body }
//
// verified is true only when the body's canonical JSON hashes to the
// fingerprint the row was recorded under.
export async function verifyDefinition(row) {
  if (!row || typeof row.body !== 'object' || row.body === null) return { verified: false, body: null }
  const json = canonicalJson(row.body)
  return { verified: (await sha256Hex(json)) === row.sha256, body: row.body, json }
}

// submissionRow(orgId, subject, definitionIds) -> a row for `submissions`.
// The columns beside the subject are copies of its fields, which the database
// holds to agree with it.
export function submissionRow(orgId, subject, { contract, spec }) {
  return {
    org_id: orgId,
    reference: subject.reference,
    object_name: subject.object.name,
    wave: subject.object.wave,
    cycle: subject.object.cycle,
    contract_def: contract,
    spec_def: spec,
    subject,
  }
}

// readSubmission(row, decisions) -> what the sign-off screen shows, with the
// subject re-read field by field: a row whose subject does not read is shown
// as unreadable, never trusted.
export function readSubmission(row, decisions = []) {
  const subject = readSubject(row.subject)
  const own = decisions.filter((d) => d.submission_id === row.id)
  return {
    id: row.id,
    reference: row.reference,
    objectName: row.object_name,
    wave: row.wave,
    cycle: row.cycle,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    contractDef: row.contract_def,
    specDef: row.spec_def,
    subject,
    decisions: own.map((d) => ({
      id: d.id,
      decision: d.decision,
      exceptions: Array.isArray(d.exceptions) ? d.exceptions : [],
      comment: d.comment ?? null,
      decidedBy: d.decided_by,
      decidedAt: d.decided_at,
    })),
    state: signoffState(own),
  }
}

// signoffState(decisions) -> 'awaiting' | 'accepted' | 'accepted-with-exceptions' | 'rejected'
//
// One rejection outweighs any number of acceptances: a cycle someone with the
// authority to reject has rejected is not signed off.
export function signoffState(decisions) {
  if (!decisions?.length) return 'awaiting'
  if (decisions.some((d) => d.decision === 'reject')) return 'rejected'
  if (decisions.some((d) => d.decision === 'accept-with-exceptions')) return 'accepted-with-exceptions'
  return 'accepted'
}

export const STATE_WORDS = {
  awaiting: 'Awaiting a decision',
  accepted: 'Accepted',
  'accepted-with-exceptions': 'Accepted with exceptions',
  rejected: 'Rejected',
}

// mayDecide(submission, me, myRoles) -> { allowed, reason }
//
// The screen's answer to "can I decide on this?", matching what the database
// will enforce — so the button is never offered to someone it will refuse.
export function mayDecide(submission, me, myRoles, definitionsRecordedBy = []) {
  if (!myRoles.includes('data_owner')) return { allowed: false, reason: 'Only a business data owner can decide.' }
  if (submission.submittedBy === me) return { allowed: false, reason: 'You submitted this check, so someone else must decide on it.' }
  if (definitionsRecordedBy.includes(me)) return { allowed: false, reason: 'You recorded the rules or the mapping this check was held to, so someone else must decide on it.' }
  if (submission.decisions.some((d) => d.decidedBy === me)) return { allowed: false, reason: 'You have already decided on this submission.' }
  return { allowed: true, reason: null }
}

const roleWord = (id) => ROLES.find((r) => r.id === id)?.label.toLowerCase() ?? id
const decisionWord = (id) => DECISIONS.find((d) => d.id === id)?.label.toLowerCase() ?? id

// describeAudit(entry, nameOf) -> one sentence for the audit log view.
export function describeAudit(entry, nameOf = (id) => id ?? 'the system') {
  const who = nameOf(entry.actor)
  const d = entry.detail ?? {}
  const key = `${entry.entity}:${entry.action}`
  switch (key) {
    case 'organizations:insert': return `${who} created the organisation “${d.name}”.`
    case 'memberships:insert': return `${nameOf(d.user_id)} became ${roleWord(d.role)}${entry.actor && entry.actor !== d.user_id ? ` (added by ${who})` : ''}.`
    case 'memberships:delete': return `${who} removed ${nameOf(d.user_id)} as ${roleWord(d.role)}.`
    case 'invitations:insert': return `${who} invited ${d.email} as ${roleWord(d.role)}.`
    case 'invitations:update': return d.accepted ? `${d.email} accepted the invitation as ${roleWord(d.role)}.` : `${who} changed the invitation for ${d.email}.`
    case 'invitations:delete': return `${who} withdrew the invitation for ${d.email}.`
    case 'definitions:insert': return `${who} recorded ${d.kind === 'contract' ? 'target rules' : 'a mapping spec'}${d.object ? ` for ${d.object}` : ''} (${String(d.sha256 ?? '').slice(0, 12)}…).`
    case 'submissions:insert': return `${who} submitted ${d.reference} — ${[d.object, d.cycle].filter(Boolean).join(', ')} — for sign-off.`
    case 'decisions:insert': return `${who} decided “${decisionWord(d.decision)}”${d.exceptions ? ` with ${d.exceptions} exception${d.exceptions === 1 ? '' : 's'}` : ''}.`
    default: return `${who}: ${entry.action} on ${entry.entity}.`
  }
}

// packReference(html) -> the evidence reference a pack declares, or null.
// Read locally from the file a data owner was sent, so the decision is
// recorded against the pack they actually read.
export function packReference(html) {
  const match = /<meta name="dcv-evidence-reference" content="(EV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4})">/.exec(String(html ?? ''))
  return match ? match[1] : null
}
