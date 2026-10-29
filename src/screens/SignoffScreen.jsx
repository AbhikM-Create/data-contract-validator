import { useState } from 'react'
import AccountNotice from '../components/AccountNotice.jsx'
import { accountState } from '../lib/accounts.js'
import { describeAudit, mayDecide, packReference, STATE_WORDS, verifyDefinition } from '../lib/orgRecords.js'
import { DECISIONS, exceptionChoices, readDecision, ROLES } from '../lib/signoff.js'
import { isConfigured } from '../lib/supabase.js'
import { signoffSample } from '../samples/signoffSample.js'
import { colors, ghostButton, label, mono, panel, primaryButton, sans, secondaryButton } from '../theme.js'
import { ScreenHead, Section } from './ValidateScreen.jsx'

// Sign-off, in the app: who is in the programme in which role, the checks put
// forward for a decision, the decisions, and the log of all of it. The rules
// that make it worth something — nobody approves their own work, nothing is
// rewritten — are enforced by the database; this screen only explains them
// and never offers an action the database would refuse.
export default function SignoffScreen({ user, signoff }) {
  const [newOrg, setNewOrg] = useState('')

  if (!isConfigured || !user) {
    return <WithoutAnAccount state={accountState({ configured: isConfigured, user })} />
  }

  const { organizations, active, choose, invitationsForMe, notice } = signoff
  const roles = active?.roles ?? []
  const nameOf = (id) => signoff.members.find((m) => m.user_id === id)?.email ?? (id === user.id ? user.email : 'someone no longer in the organisation')

  return (
    <>
      <ScreenHead
        title="Sign-off"
        blurb="Each decision is recorded against the SHA-256 of every file checked and the fingerprints of the rules and mapping — not against a name. Nobody decides on their own work, and nothing here can be changed afterwards."
        action={<button onClick={signoff.refresh} style={ghostButton}>Refresh</button>}
      />

      {notice && <Notice notice={notice} onDismiss={signoff.dismissNotice} />}

      {invitationsForMe.length > 0 && (
        <div style={{ ...panel, padding: 14, marginTop: 16, borderColor: `${colors.accent}66` }}>
          {invitationsForMe.map((inv) => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink }}>
                You are invited to <b>{inv.orgName}</b> as {roleLabel(inv.role).toLowerCase()}.
              </span>
              <button onClick={() => signoff.accept(inv)} style={{ ...secondaryButton, padding: '6px 12px' }}>Accept</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
        {organizations.length > 0 && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={label}>Organisation</span>
            <select value={active?.id ?? ''} onChange={(e) => choose(e.target.value)} style={field(220)}>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        {active && <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>Your roles: {roles.map(roleLabel).join(', ')}</span>}
        <form
          onSubmit={(e) => { e.preventDefault(); if (newOrg.trim()) { signoff.createOrganization(newOrg); setNewOrg('') } }}
          style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}
        >
          <input value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="New organisation name" aria-label="New organisation name" style={field(200)} />
          <button type="submit" disabled={!newOrg.trim()} style={{ ...ghostButton, opacity: newOrg.trim() ? 1 : 0.5 }}>Create</button>
        </form>
      </div>

      {!active ? (
        <div style={{ ...panel, padding: '22px 22px', marginTop: 18, maxWidth: 680 }}>
          <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>You are not in an organisation yet</div>
          <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>
            Create one for your programme, or ask its admin to invite the email you signed in with. The roles:
          </p>
          <RoleList />
        </div>
      ) : (
        <>
          <Section
            title="Checks submitted for sign-off"
            blurb="Submitted from Migrations → Evidence for sign-off. The pack itself is never uploaded: the engineer sends it to the data owner the way they share the data, and the data owner opens it here so the decision is recorded against the pack they read."
          >
            {signoff.loading && signoff.submissions.length === 0 ? (
              <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint }}>Loading…</p>
            ) : signoff.submissions.length === 0 ? (
              <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint }}>Nothing submitted yet.</p>
            ) : (
              signoff.submissions.map((s) => (
                <Submission key={s.id} submission={s} me={user.id} roles={roles} nameOf={nameOf} signoff={signoff} />
              ))
            )}
          </Section>

          <Section title="People" blurb="One person can hold several roles, but the database refuses a decision on a check they submitted or on definitions they recorded.">
            <People signoff={signoff} roles={roles} me={user.id} />
          </Section>

          <Section title="Audit log" blurb="Written by the database itself on every change, and append-only: no role can edit or delete an entry.">
            <div style={{ ...panel, padding: '6px 14px', maxHeight: 360, overflowY: 'auto' }}>
              {signoff.audit.length === 0 && <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint }}>No entries.</p>}
              {signoff.audit.map((entry) => (
                <div key={entry.id} style={{ display: 'flex', gap: 14, padding: '6px 0', borderBottom: `1px solid ${colors.panelSunk}` }}>
                  <span style={{ fontFamily: mono, fontSize: 11.5, color: colors.faint, whiteSpace: 'nowrap' }}>{when(entry.at)}</span>
                  <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>{describeAudit(entry, nameOf)}</span>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </>
  )
}

// --- without an account ------------------------------------------------------

// Sign-off is what a programme buys this tool for, so the screen has to show
// it to someone who cannot sign in — otherwise the most important thing here
// is a grey card. The example is the real engine's output (samples/
// signoffSample.js), rendered by the same components as a real submission.
function WithoutAnAccount({ state }) {
  const [example, setExample] = useState(null)
  const [busy, setBusy] = useState(false)

  const show = async () => {
    if (example) return setExample(null)
    setBusy(true)
    setExample(await signoffSample())
    setBusy(false)
  }

  const nameOf = (id) => example?.members.find((m) => m.user_id === id)?.email ?? 'someone no longer in the organisation'
  // The example's definitions are already in hand, but they go through the
  // same verification orgStore does on a real read — so "show exactly what
  // was signed off" proves the fingerprint here exactly as it would against
  // the database, rather than being told to trust it.
  const reader = {
    loadDefinition: async (id) => {
      const row = example.definitions[id]
      return { definition: { ...row, ...(await verifyDefinition(row)) }, error: null }
    },
  }

  return (
    <>
      <ScreenHead
        title="Sign-off"
        blurb="Each decision is recorded against the SHA-256 of every file checked and the fingerprints of the rules and mapping — not against a name. Nobody decides on their own work, and nothing here can be changed afterwards."
      />
      <AccountNotice state={state} surface="signoff">
        <button onClick={show} disabled={busy} style={{ ...ghostButton, padding: '9px 14px', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Building it…' : example ? 'Hide the example' : 'Show an example sign-off'}
        </button>
      </AccountNotice>

      {example && (
        <div style={{ marginTop: 20, borderLeft: `3px solid ${colors.accent}`, paddingLeft: 16 }}>
          <div style={{ ...label, color: colors.accent }}>An example — nobody here is real</div>
          <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.6, margin: '6px 0 0', maxWidth: 720 }}>
            {example.organization.name}, signing off the example migration’s second mock. The people and their decision are invented;
            the verdicts, counts, file fingerprints and rules are the real output of the checks on this page’s example files, so
            “show exactly what was signed off” verifies here as it would anywhere.
          </p>

          <Section title="Checks submitted for sign-off" blurb="An engineer submits; a business data owner decides. The pack itself is never uploaded.">
            {example.submissions.map((s) => (
              <Submission key={s.id} submission={s} me="nobody" roles={[]} nameOf={nameOf} signoff={reader} example />
            ))}
          </Section>

          <Section title="People" blurb="One person can hold several roles, but the database refuses a decision on a check they submitted or on definitions they recorded.">
            <div style={{ ...panel, padding: 14 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  {example.members.map((m) => (
                    <tr key={`${m.user_id}:${m.role}`}>
                      <td style={cell()}>{m.email}</td>
                      <td style={cell(200)}>{roleLabel(m.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <RoleList />
            </div>
          </Section>

          <Section title="Audit log" blurb="Written by the database itself on every change, and append-only: no role can edit or delete an entry.">
            <div style={{ ...panel, padding: '6px 14px' }}>
              {example.audit.map((entry) => (
                <div key={entry.id} style={{ display: 'flex', gap: 14, padding: '6px 0', borderBottom: `1px solid ${colors.panelSunk}` }}>
                  <span style={{ fontFamily: mono, fontSize: 11.5, color: colors.mute, whiteSpace: 'nowrap' }}>{when(entry.at)}</span>
                  <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>{describeAudit(entry, nameOf)}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </>
  )
}

// --- one submission -------------------------------------------------------------

const STATE_TONE = { awaiting: colors.faint, accepted: colors.pass, 'accepted-with-exceptions': colors.warn, rejected: colors.fail }
const VERDICT = { READY: 'Ready to load', NOT_READY: 'Not ready', UNVERIFIED: 'Not confirmed', PASS: 'Reconciled', FAIL: 'Did not reconcile' }

function Submission({ submission: s, me, roles, nameOf, signoff, example = false }) {
  const [open, setOpen] = useState(false)
  const may = mayDecide(s, me, roles, s.definitionsRecordedBy)
  const tone = STATE_TONE[s.state]
  return (
    <div style={{ ...panel, marginTop: 10, borderLeftWidth: 3, borderLeftColor: tone }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ display: 'flex', width: '100%', gap: 14, alignItems: 'baseline', background: 'none', border: 'none', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}
      >
        <span style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{[s.objectName, s.wave, s.cycle].filter(Boolean).join(' · ')}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: colors.mute }}>{s.reference}</span>
        <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 600, color: tone }}>{STATE_WORDS[s.state]}</span>
        <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginLeft: 'auto' }}>submitted by {nameOf(s.submittedBy)}, {when(s.submittedAt)}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {!s.subject ? (
            <p style={{ fontFamily: sans, fontSize: 13, color: colors.fail }}>This submission’s record cannot be read by this version of the app, so nothing about it is shown as fact.</p>
          ) : (
            <>
              {s.subject.checks.map((c) => <CheckLine key={c.kind} check={c} />)}
              <table style={{ borderCollapse: 'collapse', marginTop: 10, width: '100%' }}>
                <tbody>
                  {s.subject.files.map((f) => (
                    <tr key={f.role}>
                      <td style={cell(130)}>{f.role === 'load' ? 'Load file' : f.role === 'source' ? 'Source extract' : 'Target extract'}</td>
                      <td style={cell()}>{f.name}{Number.isFinite(f.rows) ? ` — ${f.rows.toLocaleString('en-US')} rows` : ''}</td>
                      <td style={{ ...cell(), fontFamily: mono, fontSize: 11.5, color: colors.mute, wordBreak: 'break-all' }}>{f.sha256}</td>
                    </tr>
                  ))}
                  <Definition title="Target rules" id={s.contractDef} sha={s.subject.definitions.contract} signoff={signoff} />
                  <Definition title="Mapping spec" id={s.specDef} sha={s.subject.definitions.spec} signoff={signoff} />
                </tbody>
              </table>
            </>
          )}
          {s.decisions.map((d) => (
            <div key={d.id} style={{ marginTop: 10, padding: '8px 10px', background: colors.panelSunk, borderRadius: 6 }}>
              <div style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>
                <b>{DECISIONS.find((x) => x.id === d.decision)?.label}</b> by {nameOf(d.decidedBy)}, {when(d.decidedAt)}
              </div>
              {d.exceptions.map((e, i) => (
                <div key={i} style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 4 }}>
                  Exception — {exceptionChoices(s.subject).find((c) => c.id === e.finding)?.label ?? e.finding}: {e.reason} (owner: {e.owner}{e.fixBy ? `, fix by ${e.fixBy}` : ''})
                </div>
              ))}
              {d.comment && <div style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 4 }}>“{d.comment}”</div>}
            </div>
          ))}
          {s.subject && !example && (may.allowed
            ? <DecisionForm submission={s} onDecide={(decision) => signoff.decide(s, decision)} />
            : <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 10 }}>{may.reason}</p>)}
        </div>
      )}
    </div>
  )
}

function CheckLine({ check }) {
  const c = check.counts
  const detail = check.kind === 'readiness'
    ? `${(c.rejected ?? 0).toLocaleString('en-US')} of ${(c.records ?? 0).toLocaleString('en-US')} records would be rejected`
    : `${(c.matched ?? 0).toLocaleString('en-US')} of ${(c.expected ?? 0).toLocaleString('en-US')} expected records arrived; ${(c.missing ?? 0).toLocaleString('en-US')} missing, ${(c.withDifferences ?? 0).toLocaleString('en-US')} with differences`
  const tone = ['READY', 'PASS'].includes(check.status) ? colors.pass : ['NOT_READY', 'FAIL'].includes(check.status) ? colors.fail : colors.warn
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 4, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: colors.ink, width: 130 }}>{check.kind === 'readiness' ? 'Before the load' : 'After the load'}</span>
      <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: tone }}>{VERDICT[check.status] ?? check.status}</span>
      <span style={{ fontFamily: sans, fontSize: 13, color: colors.mute }}>{detail}</span>
    </div>
  )
}

// A recorded definition, verified against its fingerprint when opened.
function Definition({ title, id, sha, signoff }) {
  const [shown, setShown] = useState(null)
  const open = async () => {
    const { definition, error } = await signoff.loadDefinition(id)
    setShown(error ? { error } : definition)
  }
  return (
    <>
      <tr>
        <td style={cell(130)}>{title}</td>
        <td style={cell()}>
          <button onClick={shown ? () => setShown(null) : open} style={{ ...ghostButton, padding: '3px 8px', fontSize: 11.5 }}>{shown ? 'Hide' : 'Show exactly what was signed off'}</button>
        </td>
        <td style={{ ...cell(), fontFamily: mono, fontSize: 11.5, color: colors.mute, wordBreak: 'break-all' }}>{sha}</td>
      </tr>
      {shown && (
        <tr>
          <td colSpan={3} style={cell()}>
            {shown.error ? <span style={{ color: colors.fail }}>{shown.error}</span> : (
              <>
                <div style={{ fontFamily: sans, fontSize: 12.5, color: shown.verified ? colors.ink : colors.fail }}>
                  {shown.verified ? 'Verified: this text hashes to the fingerprint above.' : 'This record does NOT match its fingerprint — do not rely on it.'}
                </div>
                <pre style={{ fontFamily: mono, fontSize: 11.5, background: colors.panelSunk, padding: 10, borderRadius: 6, maxHeight: 280, overflow: 'auto', marginTop: 6 }}>{shown.json}</pre>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// --- deciding -------------------------------------------------------------------

function DecisionForm({ submission, onDecide }) {
  const [packOk, setPackOk] = useState(null)
  const [decision, setDecision] = useState('')
  const [exceptions, setExceptions] = useState([])
  const [comment, setComment] = useState('')
  const [issues, setIssues] = useState([])
  const [busy, setBusy] = useState(false)
  const choices = exceptionChoices(submission.subject)

  // The pack is read in this page and not sent anywhere: only its reference
  // is compared.
  const openPack = async (file) => {
    if (!file) return
    const found = packReference(await file.text())
    setPackOk(found === submission.reference ? { ok: true } : { ok: false, found })
  }

  const submit = async (e) => {
    e.preventDefault()
    const read = readDecision({ decision, exceptions: decision === 'accept-with-exceptions' ? exceptions : [], comment }, submission.subject)
    setIssues(read.issues)
    if (!read.decision) return
    setBusy(true)
    await onDecide(read.decision)
    setBusy(false)
  }

  const setException = (i, patch) => setExceptions((all) => all.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  return (
    <form onSubmit={submit} style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.panelEdge}` }}>
      <div style={{ ...label, marginBottom: 6 }}>Your decision</div>
      <label style={{ display: 'block', fontFamily: sans, fontSize: 13, color: colors.ink }}>
        1. Open the evidence pack you were sent ({submission.reference}). It is read in this page only.
        <input type="file" accept=".html,text/html" onChange={(e) => openPack(e.target.files?.[0])} style={{ display: 'block', marginTop: 6, fontFamily: sans, fontSize: 12.5 }} />
      </label>
      {packOk && (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: packOk.ok ? colors.ink : colors.fail, marginTop: 6 }}>
          {packOk.ok ? `This is pack ${submission.reference}.` : `That pack is ${packOk.found ?? 'not an evidence pack'}, not ${submission.reference}. Ask for the pack that was submitted.`}
        </p>
      )}
      {packOk?.ok && (
        <>
          <div style={{ fontFamily: sans, fontSize: 13, color: colors.ink, marginTop: 12 }}>2. Decide.</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            {DECISIONS.map((d) => (
              <label key={d.id} style={{ fontFamily: sans, fontSize: 13, color: colors.ink, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" name={`decision-${submission.id}`} value={d.id} checked={decision === d.id} onChange={() => { setDecision(d.id); if (d.id === 'accept-with-exceptions' && !exceptions.length) setExceptions([{ finding: choices[0]?.id ?? '', reason: '', owner: '', fixBy: '' }]) }} />
                {d.label}
              </label>
            ))}
          </div>
          {decision === 'accept-with-exceptions' && (
            <div style={{ marginTop: 10 }}>
              {exceptions.map((ex, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <select aria-label="Finding accepted" value={ex.finding} onChange={(e) => setException(i, { finding: e.target.value })} style={field(300)}>
                    {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <input aria-label="Why it is acceptable" placeholder="Why it is acceptable" value={ex.reason} onChange={(e) => setException(i, { reason: e.target.value })} style={field(240)} />
                  <input aria-label="Owner of the fix" placeholder="Owner of the fix" value={ex.owner} onChange={(e) => setException(i, { owner: e.target.value })} style={field(160)} />
                  <input aria-label="Fix by" type="date" value={ex.fixBy} onChange={(e) => setException(i, { fixBy: e.target.value })} style={field(150)} />
                  <button type="button" onClick={() => setExceptions((all) => all.filter((_, j) => j !== i))} style={ghostButton}>Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => setExceptions((all) => [...all, { finding: choices[0]?.id ?? '', reason: '', owner: '', fixBy: '' }])} style={{ ...ghostButton, marginTop: 8 }}>Add an exception</button>
            </div>
          )}
          <textarea
            aria-label="Comment"
            placeholder={decision === 'reject' ? 'Why is this cycle rejected? (required)' : 'Comment (optional)'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            style={{ ...field('100%'), marginTop: 10, resize: 'vertical' }}
          />
          <p style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint, marginTop: 4 }}>
            This is stored with your decision. Describe findings; do not paste record values from the pack.
          </p>
          {issues.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{issues.map((t) => <li key={t} style={{ fontFamily: sans, fontSize: 12.5, color: colors.fail }}>{t}</li>)}</ul>}
          <button type="submit" disabled={!decision || busy} style={{ ...primaryButton, marginTop: 10, opacity: decision && !busy ? 1 : 0.5 }}>
            Record my decision
          </button>
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginLeft: 10 }}>A decision cannot be changed afterwards.</span>
        </>
      )}
    </form>
  )
}

// --- people ---------------------------------------------------------------------

function People({ signoff, roles, me }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('engineer')
  const admin = roles.includes('admin')
  return (
    <div style={{ ...panel, padding: 14 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {signoff.members.map((m) => (
            <tr key={`${m.user_id}:${m.role}`}>
              <td style={cell()}>{m.email}{m.user_id === me ? ' (you)' : ''}</td>
              <td style={cell(200)}>{roleLabel(m.role)}</td>
              <td style={{ ...cell(90), textAlign: 'right' }}>
                {admin && <button onClick={() => signoff.remove(m)} style={{ ...ghostButton, padding: '3px 8px', fontSize: 11.5 }}>Remove</button>}
              </td>
            </tr>
          ))}
          {signoff.invitations.map((inv) => (
            <tr key={inv.id}>
              <td style={{ ...cell(), color: colors.faint }}>{inv.email} — invited</td>
              <td style={{ ...cell(200), color: colors.faint }}>{roleLabel(inv.role)}</td>
              <td style={{ ...cell(90), textAlign: 'right' }}>
                <button onClick={() => signoff.withdraw(inv)} style={{ ...ghostButton, padding: '3px 8px', fontSize: 11.5 }}>Withdraw</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {admin ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (email.trim()) { signoff.invite(email, role); setEmail('') } }}
          style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}
        >
          <input type="email" aria-label="Email to invite" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={field(240)} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} style={field(200)}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="submit" disabled={!email.trim()} style={{ ...secondaryButton, padding: '7px 12px', opacity: email.trim() ? 1 : 0.5 }}>Invite</button>
        </form>
      ) : (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 10 }}>Only an admin can invite people or change roles.</p>
      )}
      <RoleList />
    </div>
  )
}

function RoleList() {
  return (
    <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
      {ROLES.map((r) => <li key={r.id} style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 2 }}><b style={{ color: colors.ink }}>{r.label}</b> — {r.does}</li>)}
    </ul>
  )
}

// --- bits -----------------------------------------------------------------------

const roleLabel = (id) => ROLES.find((r) => r.id === id)?.label ?? id
const when = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '')
const cell = (width) => ({ fontFamily: sans, fontSize: 12.5, color: colors.ink, padding: '5px 8px 5px 0', verticalAlign: 'top', borderBottom: `1px solid ${colors.panelSunk}`, width })
const field = (width) => ({
  width,
  background: colors.ground,
  border: `1px solid ${colors.panelEdge}`,
  borderRadius: 6,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 13,
  padding: '7px 9px',
  outline: 'none',
})

function Notice({ notice, onDismiss }) {
  const tone = notice.tone === 'bad' ? colors.fail : colors.accent
  return (
    <div style={{ marginTop: 14, padding: '9px 12px', borderLeft: `3px solid ${tone}`, background: colors.panelSunk, borderRadius: 4, display: 'flex', gap: 10 }}>
      <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink, flex: 1 }}>{notice.text}</span>
      <button onClick={onDismiss} style={{ ...ghostButton, padding: '2px 8px' }}>Dismiss</button>
    </div>
  )
}
