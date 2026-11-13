import { cleanEmail, looksLikeEmail, ROLE_IDS } from './roles.js'
import { isConfigured, supabase } from './supabase.js'

// Organisations, members and invitations (user state 5).
//
// What an organisation shares is what an account holds: definitions, run
// counts, decisions and typed signatures. Never a file. Every policy is in
// supabase/schema.sql and exercised by supabase/tests/rls.sql; this module
// only speaks to it and turns Postgres into sentences.

const NOT_CONFIGURED = 'This copy of the app has no Supabase project configured, so organisations are unavailable here.'
const guard = () => (isConfigured ? null : NOT_CONFIGURED)

function readable(error) {
  if (!error) return null
  if (error.code === '42P01') return 'The organisation tables do not exist yet — run the latest supabase/schema.sql in your project.'
  if (error.code === '23505') return 'That email is already invited to, or a member of, this organisation.'
  if (error.code === '23514' && /admin/i.test(error.message ?? '')) return 'An organisation keeps at least one admin. Make someone else an admin first.'
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) return 'Your role in this organisation does not allow that.'
  if (/jwt|not authenticated|session/i.test(error.message ?? '')) return 'Your session has expired. Sign in again.'
  if (/fetch|network/i.test(error.message ?? '')) return 'Could not reach the server. Try again.'
  return `Something went wrong: ${error.message}`
}

// listOrganisations(userId) -> { organisations: [{ id, name, role }], error }
// Filtered to the person's own memberships: a member can read every member's
// row of their organisations, and those are not "my organisations".
export async function listOrganisations(userId) {
  const blocked = guard()
  if (blocked) return { organisations: [], error: blocked }
  const { data, error } = await supabase.from('memberships').select('role, organisations ( id, name )').eq('user_id', userId).order('created_at', { ascending: true })
  if (error) return { organisations: [], error: readable(error) }
  return {
    organisations: (data ?? []).filter((row) => row.organisations).map((row) => ({ id: row.organisations.id, name: row.organisations.name, role: row.role })),
    error: null,
  }
}

// createOrganisation(name) -> { organisation, error }. The database makes the
// creator its first admin.
export async function createOrganisation(name) {
  const blocked = guard()
  if (blocked) return { organisation: null, error: blocked }
  const clean = String(name ?? '').trim()
  if (!clean) return { organisation: null, error: 'Give the organisation a name.' }
  const { data, error } = await supabase.from('organisations').insert({ name: clean }).select('id, name').single()
  if (error) return { organisation: null, error: readable(error) }
  return { organisation: { ...data, role: 'admin' }, error: null }
}

export async function deleteOrganisation(id) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  const { error } = await supabase.from('organisations').delete().eq('id', id)
  return { error: readable(error) }
}

// listMembers(orgId) -> { members: [{ userId, email, role, since }], invitations: [{ id, email, role, since }], error }
export async function listMembers(orgId) {
  const blocked = guard()
  if (blocked) return { members: [], invitations: [], error: blocked }
  const [m, i] = await Promise.all([
    supabase.from('memberships').select('user_id, email, role, created_at').eq('org_id', orgId).order('created_at', { ascending: true }),
    supabase.from('invitations').select('id, email, role, created_at').eq('org_id', orgId).is('accepted_at', null).order('created_at', { ascending: true }),
  ])
  if (m.error) return { members: [], invitations: [], error: readable(m.error) }
  return {
    members: (m.data ?? []).map((row) => ({ userId: row.user_id, email: row.email, role: row.role, since: row.created_at })),
    // Invitations are an admin's to see; anyone else gets an empty list, not an error.
    invitations: i.error ? [] : (i.data ?? []).map((row) => ({ id: row.id, email: row.email, role: row.role, since: row.created_at })),
    error: null,
  }
}

// invite(orgId, email, role) -> { error }. The invitee joins when they next
// sign in with that email (acceptInvitations below).
export async function invite(orgId, email, role) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  if (!looksLikeEmail(email)) return { error: 'That does not look like an email address.' }
  if (!ROLE_IDS.includes(role)) return { error: 'Choose a role.' }
  const { error } = await supabase.from('invitations').insert({ org_id: orgId, email: cleanEmail(email), role })
  return { error: readable(error) }
}

export async function revokeInvitation(id) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  const { error } = await supabase.from('invitations').delete().eq('id', id)
  return { error: readable(error) }
}

export async function changeRole(orgId, userId, role) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  if (!ROLE_IDS.includes(role)) return { error: 'Choose a role.' }
  const { data, error } = await supabase.from('memberships').update({ role }).eq('org_id', orgId).eq('user_id', userId).select('user_id')
  if (error) return { error: readable(error) }
  if (!data?.length) return { error: 'Your role in this organisation does not allow that.' }
  return { error: null }
}

// removeMember(orgId, userId) -> { error }. A member may remove themselves.
export async function removeMember(orgId, userId) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  const { data, error } = await supabase.from('memberships').delete().eq('org_id', orgId).eq('user_id', userId).select('user_id')
  if (error) return { error: readable(error) }
  if (!data?.length) return { error: 'Your role in this organisation does not allow that.' }
  return { error: null }
}

// acceptInvitations() -> { joined, error }: every pending invitation to the
// signed-in email becomes a membership. Called on sign-in.
export async function acceptInvitations() {
  const blocked = guard()
  if (blocked) return { joined: 0, error: null }
  const { data, error } = await supabase.rpc('accept_invitations')
  if (error) return { joined: 0, error: readable(error) }
  return { joined: Number(data) || 0, error: null }
}
