import { createClient } from '@supabase/supabase-js'
import { emailDomain, readSsoConfig, rememberRoute, returnUrl, ssoProblem } from './sso.js'

// The Supabase client, and the account actions built on it.
//
// The publishable key below is PUBLIC: it ships inside the browser bundle and
// anyone can read it. Row Level Security on the database is what keeps one
// account's data away from another's — never the secrecy of this key. That is
// why every table this app writes to must have RLS enabled and policies scoped
// to auth.uid().

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// The app has to work with no Supabase at all: a visitor can validate files and
// run the examples without an account, and a contributor may clone this repo
// with no .env.local. Nothing here may throw at import time.
export const isConfigured = Boolean(url && key)

// Which company sign-in this build offers (sso.js). Off without Supabase.
export const sso = isConfigured ? readSsoConfig(import.meta.env.VITE_SSO, import.meta.env.VITE_SSO_ONLY) : readSsoConfig('')

export const supabase = isConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // PKCE: a redirect back from single sign-on (or an email link) carries
        // a one-time ?code= in the QUERY, which the client exchanges for a
        // session and then removes from the address bar. The app routes on the
        // fragment (#/validate), so the two never meet — the older implicit
        // flow put tokens in the fragment, which is why this was once off.
        flowType: 'pkce',
        detectSessionInUrl: true,
      },
    })
  : null

// Supabase's own messages are written for developers. These are the ones a
// person actually hits, in the app's own voice: what happened, and what to do.
const FRIENDLY = [
  [/invalid login credentials/i, 'That email and password do not match an account. Check them, or create an account below.'],
  [/email not confirmed/i, 'This account still needs confirming — check your email for the link before signing in.'],
  [/user already registered/i, 'An account already exists for this email. Sign in instead.'],
  [/password should be at least/i, 'That password is too short — use at least six characters.'],
  [/unable to validate email address/i, 'That does not look like an email address.'],
  [/rate limit|too many requests/i, 'Too many attempts just now. Wait a minute and try again.'],
  [/failed to fetch|network/i, 'Could not reach the server. Check your connection and try again.'],
]

function readable(error) {
  if (!error) return null
  const message = error.message ?? String(error)
  const match = FRIENDLY.find(([pattern]) => pattern.test(message))
  return match ? match[1] : `Sign-in failed: ${message}`
}

const notConfigured = { error: 'This copy of the app has no Supabase project configured, so accounts are unavailable. Validation still works without one.' }

export async function signIn(email, password) {
  if (!isConfigured) return notConfigured
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return { error: readable(error) }
}

// Returns needsConfirmation so the UI can say "check your email" rather than
// pretending the person is signed in when they are not.
export async function signUp(email, password) {
  if (!isConfigured) return notConfigured
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
  if (error) return { error: readable(error) }
  return { error: null, needsConfirmation: Boolean(data.user && !data.session) }
}

export async function signOut() {
  if (!isConfigured) return notConfigured
  const { error } = await supabase.auth.signOut()
  return { error: readable(error) }
}

// Single sign-on. Both leave the page for the identity provider and come back
// with a code (see flowType above); where the person was is remembered so
// they land back there.
const leaving = () => {
  // From the sign-in screen, go('signin') has already remembered where from.
  if (window.location.hash !== '#/signin') rememberRoute(globalThis.sessionStorage, window.location.hash)
  return returnUrl(window.location)
}

export async function signInWithCompanySso(email) {
  if (!isConfigured) return notConfigured
  const domain = emailDomain(email)
  if (!domain) return { error: 'Enter your work email address — its domain picks your company’s sign-in.' }
  const { error } = await supabase.auth.signInWithSSO({ domain, options: { redirectTo: leaving() } })
  return { error: error ? ssoProblem(error.message, domain) : null }
}

export async function signInWithMicrosoft() {
  if (!isConfigured) return notConfigured
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: leaving() } })
  return { error: error ? ssoProblem(error.message) : null }
}
