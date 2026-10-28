import { useCallback, useEffect, useState } from 'react'
import * as store from './orgStore.js'
import { isConfigured } from './supabase.js'

// The signed-in person's organisations and the sign-off state of the one they
// are working in. Kept out of App.jsx, which owns the files and checks; this
// owns who you are working with and what they decided.
//
// Which organisation is active is remembered per browser — a convenience, so
// it is fine for it to be missing.
const ACTIVE = 'dcv.activeOrganization'
const remembered = () => { try { return localStorage.getItem(ACTIVE) } catch { return null } }
const remember = (id) => { try { if (id) localStorage.setItem(ACTIVE, id); else localStorage.removeItem(ACTIVE) } catch { /* private window */ } }

export function useSignoff(user) {
  const [organizations, setOrganizations] = useState([])
  const [activeId, setActiveId] = useState(remembered)
  const [invitationsForMe, setInvitationsForMe] = useState([])
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)

  const active = organizations.find((o) => o.id === activeId) ?? organizations[0] ?? null

  const refreshOrganizations = useCallback(async () => {
    if (!isConfigured || !user) {
      setOrganizations([])
      setInvitationsForMe([])
      return
    }
    const [{ organizations: orgs, error }, { invitations: mine }] = await Promise.all([
      store.myOrganizations(user.id),
      store.myInvitations(user.email),
    ])
    setOrganizations(orgs)
    setInvitationsForMe(mine)
    if (error) setNotice({ tone: 'bad', text: error })
  }, [user])

  const refreshActive = useCallback(async () => {
    if (!active) {
      setMembers([]); setInvitations([]); setSubmissions([]); setAudit([])
      return
    }
    setLoading(true)
    const admin = active.roles.includes('admin')
    const [m, i, s, a] = await Promise.all([
      store.listMembers(active.id),
      admin ? store.listInvitations(active.id) : { invitations: [] },
      store.listSubmissions(active.id),
      store.listAudit(active.id),
    ])
    setMembers(m.members)
    setInvitations(i.invitations)
    setSubmissions(s.submissions)
    setAudit(a.entries)
    const error = m.error ?? i.error ?? s.error ?? a.error
    if (error) setNotice({ tone: 'bad', text: error })
    setLoading(false)
  }, [active])

  // Loading from the database when the person or the organisation changes is
  // synchronising with an external system, which is what effects are for.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { refreshOrganizations() }, [refreshOrganizations])
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { refreshActive() }, [refreshActive])

  // Runs an action, says what happened, and reloads what it may have changed.
  const act = async (work, success, { organizationsChanged = false } = {}) => {
    setNotice(null)
    const { error } = await work()
    if (error) {
      setNotice({ tone: 'bad', text: error })
      return false
    }
    if (success) setNotice({ tone: 'good', text: success })
    if (organizationsChanged) await refreshOrganizations()
    await refreshActive()
    return true
  }

  const choose = (id) => { setActiveId(id); remember(id) }

  return {
    available: isConfigured && Boolean(user),
    organizations,
    active,
    choose,
    invitationsForMe,
    members,
    invitations,
    submissions,
    audit,
    loading,
    notice,
    dismissNotice: () => setNotice(null),
    refresh: async () => { await refreshOrganizations(); await refreshActive() },
    createOrganization: async (name) => {
      const { id, error } = await store.createOrganization(name)
      if (error) { setNotice({ tone: 'bad', text: error }); return }
      choose(id)
      await refreshOrganizations()
      setNotice({ tone: 'good', text: `Created “${name.trim()}”. You are its admin: invite people and give them roles below.` })
    },
    accept: (invitation) => act(() => store.acceptInvitation(invitation.id), `You joined ${invitation.orgName}.`, { organizationsChanged: true }),
    invite: (email, role) => act(() => store.invite(active.id, email, role), `Invited ${email.trim().toLowerCase()}. They join when they sign in with that email and accept.`),
    withdraw: (invitation) => act(() => store.withdrawInvitation(invitation.id), `Withdrew the invitation for ${invitation.email}.`),
    remove: (member) => act(() => store.removeMember(active.id, member.user_id, member.role), `Removed ${member.email} as ${member.role.replace('_', ' ')}.`, { organizationsChanged: member.user_id === user?.id }),
    decide: (submission, decision) => act(() => store.decide(active.id, submission.id, decision), `Your decision on ${submission.reference} is recorded.`),
    // Called from the Migrations screen with what createEvidencePack returned.
    submit: (pack) => act(() => store.submitForSignoff(active.id, pack), `Submitted ${pack.subject.reference} to ${active.name} for sign-off. Send the pack itself to the data owner the way you would share the data — it is not uploaded.`),
    loadDefinition: store.loadDefinition,
  }
}
