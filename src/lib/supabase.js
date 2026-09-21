import { createClient } from '@supabase/supabase-js'

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

export const supabase = isConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // This app routes on the URL fragment (#/validate), and Supabase returns
        // auth tokens in that same fragment. Letting it parse the URL would put
        // the two in conflict. With email + password there is no redirect to
        // parse; turning this on later (magic links, OAuth) means teaching
        // routes.js to recognise and clear a token fragment first.
        detectSessionInUrl: false,
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
