import { useState } from 'react'
import { ACCOUNTS_OFF } from '../lib/accounts.js'
import { isConfigured, signIn, signInWithCompanySso, signInWithMicrosoft, signUp, sso } from '../lib/supabase.js'
import { go } from '../routes.js'
import { colors, label, panel, primaryButton, sans, secondaryButton } from '../theme.js'
import { ScreenHead } from './ValidateScreen.jsx'

// Signing in buys you saved contracts and saved runs. It buys nothing else —
// validating a file works fully without an account, and this screen says so,
// because a sign-in wall in front of something that needs no account is the
// fastest way to lose the person evaluating your tool.
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
    // useAuth has already sent the person back where they came from, if
    // anywhere was remembered; otherwise, to their contracts.
    if (window.location.hash === '#/signin') go('contracts')
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

  // No account service in this build. An explanation is not a dead end; a
  // disabled form is — so this says what is off, what still works, and how to
  // turn it on, rather than pretending to take a password.
  if (!isConfigured) return <AccountsOff />

  return (
    <>
      <ScreenHead
        title={creating ? 'Create an account' : 'Sign in'}
        blurb="An account saves your contracts, your validation history, and your programme’s sign-off. Checking a file needs no account at all — that works signed out."
      />


      {sso.any && !creating && <CompanySignIn />}

      {sso.passwordForm && (
      <>
      {sso.any && !creating && (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 18 }}>Or with an email and password:</p>
      )}
      <form onSubmit={submit} style={{ ...panel, padding: '20px 22px', marginTop: sso.any && !creating ? 8 : 20, maxWidth: 420 }}>
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
          <p style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, color: notice.tone === 'bad' ? colors.fail : colors.pass }}>
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
      )}
    </>
  )
}

// Company sign-in: SAML by email domain, and/or Microsoft Entra ID. Both leave
// for the identity provider and come back signed in; the identity provider
// decides who may, so a leaver it has disabled cannot sign in again.
function CompanySignIn() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const start = async (work) => {
    setBusy(true)
    setProblem(null)
    const { error } = await work()
    // On success the page is already on its way to the identity provider.
    if (error) {
      setProblem(error)
      setBusy(false)
    }
  }

  return (
    <div style={{ ...panel, padding: '20px 22px', marginTop: 20, maxWidth: 420 }}>
      <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>Sign in with your company account</div>
      {sso.saml && (
        <form onSubmit={(e) => { e.preventDefault(); start(() => signInWithCompanySso(email)) }}>
          <Field label="Work email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <button type="submit" disabled={busy || !email} style={{ ...primaryButton, width: '100%', marginTop: 14, opacity: busy || !email ? 0.55 : 1 }}>
            {busy ? 'Opening your company sign-in…' : 'Continue with SSO'}
          </button>
        </form>
      )}
      {sso.microsoft && (
        <button
          onClick={() => start(signInWithMicrosoft)}
          disabled={busy}
          style={{ ...(sso.saml ? secondaryButton : primaryButton), width: '100%', marginTop: sso.saml ? 10 : 14, opacity: busy ? 0.55 : 1 }}
        >
          Sign in with Microsoft
        </button>
      )}
      {problem && <p style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, marginTop: 12, color: colors.fail }}>{problem}</p>}
    </div>
  )
}

function AccountsOff() {
  return (
    <>
      <ScreenHead title={ACCOUNTS_OFF.title} blurb={ACCOUNTS_OFF.lead} />
      <div style={{ ...panel, padding: '20px 22px', marginTop: 20, maxWidth: 640 }}>
        <span style={label}>What an account adds</span>
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {ACCOUNTS_OFF.adds.map((line) => (
            <li key={line} style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink, lineHeight: 1.6, marginTop: 4 }}>{line}</li>
          ))}
        </ul>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 14 }}>{ACCOUNTS_OFF.works}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={() => go('signoff')} style={primaryButton}>See an example sign-off</button>
          <button onClick={() => go('migrations')} style={secondaryButton}>Check a migration</button>
        </div>
      </div>
      <div style={{ ...panel, padding: '16px 22px', marginTop: 14, maxWidth: 640, background: colors.panelSunk }}>
        <span style={label}>Turning them on</span>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>{ACCOUNTS_OFF.howTo}</p>
      </div>
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
      {hint && <span style={{ display: 'block', fontFamily: sans, fontSize: 11.5, color: colors.faint, marginTop: 5 }}>{hint}</span>}
    </label>
  )
}
