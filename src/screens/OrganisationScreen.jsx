import { useState } from 'react'
import ConfirmButton from '../components/ConfirmButton.jsx'
import { can, ROLES, roleLabel } from '../lib/roles.js'
import { go } from '../routes.js'
import { colors, ghostButton, label, mono, panel, primaryButton, sans, secondaryButton } from '../theme.js'
import { ScreenHead } from './ValidateScreen.jsx'

// An organisation: the people who share a set of migration objects, each with
// a role (user state 5). What they share is definitions, results as counts,
// decisions and typed signatures; files are never uploaded, so a teammate opens
// the same files on their own machine and the stamps say they match.

const BLURB = 'Share migration objects with the people who work on them — a partner’s consultants, a client’s controller, the auditor — each with a role. Files are never uploaded: members share definitions, results as counts, decisions and signatures.'

export default function OrganisationScreen(props) {
  const { signedIn, user, organisations, selectedId, members, invitations, loading, notice, onSelect, onCreate, onInvite, onChangeRole, onRemove, onRevoke, onDelete } = props
  const [newName, setNewName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')

  if (!signedIn) {
    return (
      <>
        <ScreenHead title="Organisation" blurb={BLURB} />
        <div style={{ ...panel, padding: '24px 22px', marginTop: 20, maxWidth: 560 }}>
          <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>Sign in to create or join an organisation</div>
          <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>
            An organisation belongs to accounts. Signed out, everything else works: check, reconcile, sign off, and keep your work in this browser and in files.
          </p>
          <button onClick={() => go('signin')} style={{ ...secondaryButton, marginTop: 14 }}>Sign in</button>
        </div>
        <RolesTable />
      </>
    )
  }

  const selected = organisations.find((o) => o.id === selectedId) ?? null
  const myRole = selected?.role ?? null
  const admin = can(myRole, 'manageMembers')

  return (
    <>
      <ScreenHead title="Organisation" blurb={BLURB} />

      {notice && (
        <p role={notice.tone === 'bad' ? 'alert' : 'status'} style={{ fontFamily: sans, fontSize: 13, color: notice.tone === 'bad' ? colors.fail : colors.ink, margin: '14px 0 0' }}>{notice.text}</p>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 18 }}>
        {organisations.length > 0 && (
          <select aria-label="organisation" value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value)} style={{ ...field(260), cursor: 'pointer' }}>
            {organisations.map((o) => <option key={o.id} value={o.id}>{o.name} — you are {roleLabel(o.role).toLowerCase()}</option>)}
          </select>
        )}
        <form onSubmit={(e) => { e.preventDefault(); onCreate(newName); setNewName('') }} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label="new organisation name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={organisations.length ? 'Another organisation' : 'Your firm or company'} style={field(220)} />
          <button type="submit" disabled={!newName.trim()} style={{ ...(organisations.length ? secondaryButton : primaryButton), opacity: newName.trim() ? 1 : 0.5 }}>Create organisation</button>
        </form>
      </div>

      {loading && <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, marginTop: 14 }}>Loading…</p>}

      {!loading && organisations.length === 0 && (
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 14, maxWidth: 620 }}>
          You are not in an organisation yet. Create one and invite the people who work on your objects — or wait for an invitation: it is accepted the moment you sign in with the invited email.
        </p>
      )}

      {selected && (
        <section style={{ ...panel, padding: '16px 18px', marginTop: 18 }} aria-label={`Members of ${selected.name}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={label}>Members</div>
              <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 650, color: colors.ink, marginTop: 4 }}>{selected.name}</div>
            </div>
            <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>You are {roleLabel(myRole).toLowerCase()}{admin ? '' : ' — only an admin can invite or change roles'}</span>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
            {members.map((m) => {
              const me = m.userId === user?.id
              return (
                <li key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${colors.panelEdge}`, padding: '9px 0' }}>
                  <span style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink, flex: 1, minWidth: 200 }}>
                    {m.email ?? <span style={{ fontFamily: mono, fontSize: 12 }}>{m.userId.slice(0, 8)}…</span>}{me ? <span style={{ color: colors.mute }}> · you</span> : ''}
                  </span>
                  {admin ? (
                    <select aria-label={`role of ${m.email ?? m.userId}`} value={m.role} onChange={(e) => onChangeRole(m.userId, e.target.value)} style={{ ...field(150), cursor: 'pointer' }}>
                      {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, width: 150 }}>{roleLabel(m.role)}</span>
                  )}
                  {(admin || me) && (
                    <ConfirmButton
                      needsConfirm
                      question={me ? `Leave ${selected.name}? You will no longer see its objects.` : `Remove ${m.email ?? 'this member'} from ${selected.name}?`}
                      confirmLabel={me ? 'Leave' : 'Remove'}
                      onConfirm={() => onRemove(m.userId)}
                      style={ghostButton}
                    >
                      {me ? 'Leave' : 'Remove'}
                    </ConfirmButton>
                  )}
                </li>
              )
            })}
          </ul>

          {admin && (
            <>
              <form onSubmit={(e) => { e.preventDefault(); onInvite(email, role); setEmail('') }} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.panelEdge}` }}>
                <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink, fontWeight: 600 }}>Invite</span>
                <input aria-label="email to invite" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" style={field(240)} />
                <select aria-label="role to invite as" value={role} onChange={(e) => setRole(e.target.value)} style={{ ...field(150), cursor: 'pointer' }}>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <button type="submit" disabled={!email.trim()} style={{ ...secondaryButton, opacity: email.trim() ? 1 : 0.5 }}>Send invitation</button>
                <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>They join when they sign in with that email.</span>
              </form>
              {invitations.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                  {invitations.map((i) => (
                    <li key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0' }}>
                      <span style={{ fontFamily: sans, fontSize: 13, color: colors.mute, flex: 1, minWidth: 200 }}>{i.email} · invited as {roleLabel(i.role).toLowerCase()}</span>
                      <button onClick={() => onRevoke(i.id)} style={ghostButton}>Revoke</button>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.panelEdge}` }}>
                <ConfirmButton
                  needsConfirm
                  question={`Delete ${selected.name}? Its members lose access; its objects stay with whoever saved them, as personal objects.`}
                  confirmLabel="Delete organisation"
                  onConfirm={onDelete}
                  style={{ ...ghostButton, color: colors.fail, borderColor: `${colors.fail}66` }}
                >
                  Delete organisation
                </ConfirmButton>
              </div>
            </>
          )}
        </section>
      )}

      <RolesTable />
    </>
  )
}

function RolesTable() {
  return (
    <section style={{ marginTop: 22, maxWidth: 760 }} aria-label="Roles">
      <div style={label}>Roles</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
        <tbody>
          {ROLES.map((r) => (
            <tr key={r.id} style={{ borderTop: `1px solid ${colors.panelEdge}` }}>
              <th scope="row" style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: colors.ink, textAlign: 'left', padding: '7px 12px 7px 0', width: 110, verticalAlign: 'top' }}>{r.label}</th>
              <td style={{ fontFamily: sans, fontSize: 13, color: colors.mute, padding: '7px 0', lineHeight: 1.5 }}>{r.can}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, lineHeight: 1.5, margin: '10px 0 0' }}>
        A role applies to the organisation’s objects, never to a member’s personal ones. To see the records behind a result, a member opens the same files on their own machine; the record says by fingerprint whether they are the ones.
      </p>
    </section>
  )
}

const field = (width) => ({
  width, background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink,
  fontFamily: sans, fontSize: 13, padding: '8px 10px', minHeight: 28, boxSizing: 'border-box',
})
