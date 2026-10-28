// Single sign-on: which company sign-in this deployment offers, and the small
// decisions around it. Pure; the Supabase calls are in supabase.js.
//
// Configured at build time, like the Supabase project itself:
//   VITE_SSO=saml             "Continue with SSO" — the email's domain picks the
//                             SAML identity provider registered in Supabase
//                             (Entra ID, Okta, Ping, ADFS…)
//   VITE_SSO=microsoft        "Sign in with Microsoft" — Entra ID over OpenID
//                             Connect (Supabase's Azure provider)
//   VITE_SSO=saml,microsoft   both
//   VITE_SSO_ONLY=true        hide the email-and-password form. This only hides
//                             it: turn the Email provider off in Supabase too, or
//                             a password account can still be made through the API.

export function readSsoConfig(sso, only) {
  const methods = new Set(String(sso ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  const saml = methods.has('saml')
  const microsoft = methods.has('microsoft') || methods.has('azure') || methods.has('entra')
  return { saml, microsoft, any: saml || microsoft, passwordForm: !((saml || microsoft) && String(only).toLowerCase() === 'true') }
}

// emailDomain(email) -> the part after @, lower-cased, or null. SAML sign-in in
// Supabase finds the identity provider by the domain registered for it.
export function emailDomain(email) {
  const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(String(email ?? '').trim())
  return match ? match[1].toLowerCase() : null
}

// Where the identity provider sends the person back: this page, without its
// #/route. Supabase appends ?code= to the URL it is given, and a URL that
// already has a fragment would get the code after it, where nothing reads it.
// The route is remembered separately (rememberRoute) and restored after.
export function returnUrl(location) {
  return `${location.origin}${location.pathname}`
}

const ROUTE_KEY = 'dcv.returnRoute'

export function rememberRoute(storage, hash) {
  try { storage?.setItem(ROUTE_KEY, String(hash ?? '')) } catch { /* private window: lands on home */ }
}

// takeRoute(storage) -> the hash to go back to after signing in, once.
export function takeRoute(storage) {
  try {
    const hash = storage?.getItem(ROUTE_KEY)
    storage?.removeItem(ROUTE_KEY)
    return hash && /^#\/[\w-]*$/.test(hash) && hash !== '#/signin' ? hash : null
  } catch {
    return null
  }
}

// What Supabase says when SSO cannot start, in the app's voice.
export function ssoProblem(message, domain) {
  if (/no sso provider|sso_provider_not_found|not found/i.test(message ?? '')) {
    return `Single sign-on is not set up for ${domain}. Ask whoever runs this deployment to register your company's identity provider, or sign in another way.`
  }
  if (/provider is not enabled|unsupported provider/i.test(message ?? '')) {
    return 'Sign-in with Microsoft is not switched on for this deployment yet. Ask whoever runs it to enable the Azure provider in Supabase.'
  }
  if (/fetch|network/i.test(message ?? '')) return 'Could not reach the server. Check your connection and try again.'
  return `Single sign-on could not start: ${message}`
}
