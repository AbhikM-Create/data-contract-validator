import { definitionRows, readSubmission, submissionRow, verifyDefinition } from './orgRecords.js'
import { isConfigured, supabase } from './supabase.js'

// Organisations, roles and sign-off, in the database (supabase/schema.sql).
//
// Thin on purpose: rows are built and read by orgRecords.js, and every rule
// that matters — who may decide, separation of duties, append-only history —
// is enforced by the database, not here. A client that skipped this file
// would be refused the same way.

const NOT_CONFIGURED = 'This copy of the app has no Supabase project configured, so organisations and sign-off are unavailable. Evidence packs still work.'

function readable(error) {
  if (!error) return null
  const message = error.message ?? String(error)
  // The database's own refusals are written for people; pass them through.
  if (/^(Separation of duties|An organisation needs|Confirm your email|There is no open invitation|Sign in to)/.test(message)) return message
  if (/append-only/.test(message)) return 'That record is part of the sign-off history and cannot be changed.'
  if (error.code === '23505') return /decisions/.test(message) ? 'You have already decided on this submission.' : 'That already exists.'
  if (error.code === '42501' || /row-level security/i.test(message)) return 'Your role in this organisation does not allow that.'
  if (error.code === '42P01' || error.code === 'PGRST202') return 'The organisation tables do not exist yet — run the latest supabase/schema.sql.'
  if (/fetch|network/i.test(message)) return 'Could not reach the server. Try again.'
  return message
}

const guard = () => (isConfigured ? null : NOT_CONFIGURED)

// myOrganizations(userId) -> { organizations: [{ id, name, roles[] }], error }
export async function myOrganizations(userId) {
  if (guard()) return { organizations: [], error: guard() }
  const { data, error } = await supabase
    .from('memberships')
    .select('role, organizations(id, name)')
    .eq('user_id', userId)
  if (error) return { organizations: [], error: readable(error) }
  const byId = new Map()
  for (const row of data ?? []) {
    const org = row.organizations
    if (!org) continue
    const entry = byId.get(org.id) ?? { id: org.id, name: org.name, roles: [] }
    entry.roles.push(row.role)
    byId.set(org.id, entry)
  }
  return { organizations: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)), error: null }
}

export async function createOrganization(name) {
  if (guard()) return { error: guard() }
  const { data, error } = await supabase.from('organizations').insert({ name: name.trim() }).select('id').single()
  return { id: data?.id ?? null, error: readable(error) }
}

export async function listMembers(orgId) {
  if (guard()) return { members: [], error: guard() }
  const { data, error } = await supabase.rpc('organization_members', { org: orgId })
  return { members: data ?? [], error: readable(error) }
}

// Invitations addressed to this account, in any organisation.
export async function myInvitations(email) {
  if (guard() || !email) return { invitations: [], error: guard() }
  const { data, error } = await supabase
    .from('invitations')
    .select('id, org_id, role, created_at, organizations(name)')
    .eq('email', email.toLowerCase())
    .is('accepted_at', null)
  return {
    invitations: (data ?? []).map((i) => ({ id: i.id, orgId: i.org_id, orgName: i.organizations?.name ?? 'an organisation', role: i.role })),
    error: readable(error),
  }
}

export async function listInvitations(orgId) {
  if (guard()) return { invitations: [], error: guard() }
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, created_at, accepted_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  return { invitations: data ?? [], error: readable(error) }
}

export async function invite(orgId, email, role) {
  if (guard()) return { error: guard() }
  const { error } = await supabase.from('invitations').insert({ org_id: orgId, email: email.trim().toLowerCase(), role })
  return { error: readable(error) }
}

export async function withdrawInvitation(id) {
  if (guard()) return { error: guard() }
  const { error } = await supabase.from('invitations').delete().eq('id', id)
  return { error: readable(error) }
}

export async function acceptInvitation(id) {
  if (guard()) return { error: guard() }
  const { error } = await supabase.rpc('accept_invitation', { invitation: id })
  return { error: readable(error) }
}

export async function removeMember(orgId, userId, role) {
  if (guard()) return { error: guard() }
  const { data, error } = await supabase.from('memberships').delete().match({ org_id: orgId, user_id: userId, role }).select('role')
  if (error) return { error: readable(error) }
  return { error: data?.length ? null : 'Only an admin can remove a member.' }
}

// submitForSignoff(orgId, { subject, fingerprints }) -> { id, error }
//
// Records the definitions (once per fingerprint — a second submission held to
// the same rules points at the same row) and then the submission.
export async function submitForSignoff(orgId, { subject, fingerprints }) {
  if (guard()) return { id: null, error: guard() }
  const rows = definitionRows(orgId, fingerprints, subject.object.name)
  const { error: recordError } = await supabase.from('definitions').upsert(rows, { onConflict: 'org_id,kind,sha256', ignoreDuplicates: true })
  if (recordError) return { id: null, error: readable(recordError) }
  const { data: defs, error: readError } = await supabase
    .from('definitions')
    .select('id, kind, sha256')
    .eq('org_id', orgId)
    .in('sha256', rows.map((r) => r.sha256))
  if (readError) return { id: null, error: readable(readError) }
  const idOf = (kind) => defs.find((d) => d.kind === kind && d.sha256 === fingerprints[kind].sha256)?.id
  const { data, error } = await supabase
    .from('submissions')
    .insert(submissionRow(orgId, subject, { contract: idOf('contract'), spec: idOf('spec') }))
    .select('id')
    .single()
  return { id: data?.id ?? null, error: readable(error) }
}

// listSubmissions(orgId) -> { submissions, error } — newest first, each with
// its decisions and who recorded the definitions it was held to.
export async function listSubmissions(orgId, { limit = 100 } = {}) {
  if (guard()) return { submissions: [], error: guard() }
  const { data: rows, error } = await supabase
    .from('submissions')
    .select('id, reference, object_name, wave, cycle, contract_def, spec_def, subject, submitted_by, submitted_at')
    .eq('org_id', orgId)
    .order('submitted_at', { ascending: false })
    .limit(limit)
  if (error) return { submissions: [], error: readable(error) }
  const ids = (rows ?? []).map((r) => r.id)
  const defIds = [...new Set((rows ?? []).flatMap((r) => [r.contract_def, r.spec_def]))]
  const [{ data: decisions, error: decisionError }, { data: defs, error: defError }] = await Promise.all([
    ids.length ? supabase.from('decisions').select('id, submission_id, decision, exceptions, comment, decided_by, decided_at').in('submission_id', ids) : { data: [] },
    defIds.length ? supabase.from('definitions').select('id, recorded_by').in('id', defIds) : { data: [] },
  ])
  if (decisionError || defError) return { submissions: [], error: readable(decisionError ?? defError) }
  const recorder = new Map((defs ?? []).map((d) => [d.id, d.recorded_by]))
  return {
    submissions: (rows ?? []).map((row) => ({
      ...readSubmission(row, decisions ?? []),
      definitionsRecordedBy: [recorder.get(row.contract_def), recorder.get(row.spec_def)].filter(Boolean),
    })),
    error: null,
  }
}

// loadDefinition(id) -> { definition: { kind, sha256, body, json, verified }, error }
export async function loadDefinition(id) {
  if (guard()) return { definition: null, error: guard() }
  const { data, error } = await supabase.from('definitions').select('id, kind, sha256, body, recorded_by, recorded_at').eq('id', id).single()
  if (error) return { definition: null, error: readable(error) }
  const check = await verifyDefinition(data)
  return { definition: { ...data, ...check }, error: null }
}

export async function decide(orgId, submissionId, { decision, exceptions, comment }) {
  if (guard()) return { error: guard() }
  const { error } = await supabase.from('decisions').insert({ org_id: orgId, submission_id: submissionId, decision, exceptions, comment })
  return { error: readable(error) }
}

export async function listAudit(orgId, { limit = 200 } = {}) {
  if (guard()) return { entries: [], error: guard() }
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, at, actor, action, entity, entity_id, detail')
    .eq('org_id', orgId)
    .order('at', { ascending: false })
    .limit(limit)
  return { entries: data ?? [], error: readable(error) }
}
