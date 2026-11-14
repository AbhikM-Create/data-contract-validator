import { useState } from 'react'
import { isConfigured, signIn, signUp } from '../lib/supabase.js'
import { go } from '../routes.js'
import { colors, panel, primaryButton, sans, tint } from '../theme.js'
import { ScreenHead } from './ValidateScreen.jsx'

// Signing in buys you saved contracts and saved runs. It buys nothing else —
// validating a file works fully without an account, and this screen says so,
// because a sign-in wall in front of something that needs no account is the
// fastest way to lose the person evaluating your tool.
const ACCESS = [
  {
    title: 'Without an account',
    items: [
      'Check a load file, reconcile a load, monitor a feed',
      'Packs, examples and the guided tour',
      'Download the fix list and the sign-off record',
      'Your work kept in this browser',
    ],
  },
  {
    title: 'An account also keeps',
    items: [
      'Migration objects you save to it: rules, mapping, formats, column matching, tags and run counts, on every device you sign in from',
      'Your contracts: the rules you wrote, their names and declared formats',
      'Run summaries of feed checks: which step caught what, as counts',
      'Organisations: the people who share your objects, each with a role',
    ],
  },
  {
    title: 'An account never keeps',
    items: [
      'Your files, or any record in them',
      'Report messages and examples, because they quote real values',
      'The files an object was checked against: open them again on each device, and the app confirms by fingerprint that they are the ones',
    ],
  },
]

export default function SignInScreen({ user }) {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const creating = mode === 'up'

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)

    const result = creating ? await signUp(email, password) : await signIn(email, password)

    setBusy(false)
    if (result.error) {
      setNotice({ tone: 'bad', text: result.error })
      return
    }
    if (result.needsConfirmation) {
      setNotice({ tone: 'good', text: `Account created. Check ${email} for a confirmation link, then sign in.` })
      setMode('in')
      return
    }
    go('contracts')
  }

  if (user) {
    return (
      <>
        <ScreenHead title="Signed in" blurb={`You are signed in as ${user.email}.`} />
        <div style={{ marginTop: 18 }}>
          <button onClick={() => go('contracts')} style={primaryButton}>Go to your contracts</button>
        </div>
      </>
    )
  }

  return (
    <>
      <ScreenHead
        title={creating ? 'Create an account' : 'Sign in'}
        blurb="An account saves your contracts and your validation history. Checking a file needs no account at all — that works signed out."
      />

      {/* What each state can do, said before anyone types a password. Each line
          is what the code stores today (contractFile.js, runRecord.js) — a
          promise here that the product does not keep would be the worst kind. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 18, maxWidth: 860 }}>
        {ACCESS.map((group) => (
          <div key={group.title} style={{ ...panel, padding: '14px 16px' }}>
            <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 650, color: colors.ink }}>{group.title}</div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {group.items.map((item) => <li key={item} style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.55, color: colors.mute }}>{item}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {!isConfigured && (
        <Notice tone="warn">
          This copy of the app has no Supabase project configured, so accounts are unavailable here. Everything
          else works.
        </Notice>
      )}

      <form onSubmit={submit} style={{ ...panel, padding: '20px 22px', marginTop: 20, maxWidth: 420 }}>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={creating ? 'new-password' : 'current-password'}
          hint={creating ? 'At least six characters.' : null}
        />

        {notice && (
          <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, marginTop: 14, color: notice.tone === 'bad' ? colors.fail : colors.pass }}>
            {notice.text}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !isConfigured || !email || !password}
          style={{
            ...primaryButton,
            width: '100%',
            marginTop: 18,
            opacity: busy || !isConfigured || !email || !password ? 0.55 : 1,
            cursor: busy || !isConfigured ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Working…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, marginTop: 14 }}>
        {creating ? 'Already have an account?' : 'No account yet?'}{' '}
        <button
          onClick={() => { setMode(creating ? 'in' : 'up'); setNotice(null) }}
          style={{ background: 'none', border: 'none', padding: 0, color: colors.accent, fontFamily: sans, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {creating ? 'Sign in' : 'Create one'}
        </button>
      </p>
    </>
  )
}

function Field({ label, type, value, onChange, autoComplete, hint }) {
  return (
    <label style={{ display: 'block', marginTop: 14 }}>
      <span style={{ display: 'block', fontFamily: sans, fontSize: 13, fontWeight: 600, color: colors.ink, marginBottom: 6 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', background: colors.panel, border: `1px solid ${colors.panelEdge}`,
          borderRadius: 6, color: colors.ink, fontFamily: sans, fontSize: 14, padding: '9px 11px', outline: 'none',
        }}
      />
      {hint && <span style={{ display: 'block', fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 5 }}>{hint}</span>}
    </label>
  )
}

function Notice({ tone, children }) {
  const colour = tone === 'warn' ? colors.warn : colors.pass
  return (
    <div style={{ marginTop: 18, padding: '10px 12px', borderRadius: 6, border: `1px solid ${tint(colour, '55')}`, background: `${tint(colour, '10')}`, maxWidth: 560 }}>
      <span style={{ fontFamily: sans, fontSize: 13, color: colour, lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}
