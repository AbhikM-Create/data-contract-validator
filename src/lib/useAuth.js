import { useEffect, useState } from 'react'
import { isConfigured, supabase } from './supabase.js'

// Who is signed in, kept in sync with Supabase.
//
// `loading` matters: on a reload Supabase restores the session asynchronously,
// and without it the UI would flash "Sign in" at somebody who is already signed
// in — which reads as having been logged out.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(isConfigured)

  useEffect(() => {
    if (!isConfigured) return undefined

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    // Fires on sign-in, sign-out, and token refresh — including in another tab,
    // so signing out once signs out everywhere this app is open.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      setLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  return { session, user: session?.user ?? null, loading }
}
