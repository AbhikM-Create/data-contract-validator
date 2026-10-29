// What an account adds, and what to say when there is not one. Pure.
//
// Four places talk about accounts — the header, Contracts, History and
// Sign-off — and before this module they disagreed: the header REMOVED its
// sign-in control when no Supabase project was configured, while the other
// three still offered a "Sign in" button that led to a disabled form. A
// first-time reader of a deployment without a project was left to conclude
// that the product has no accounts, no teams and no sign-off at all — which
// is the opposite of true, and the part an enterprise is buying.
//
// So: the control is ALWAYS shown, and every surface says the same thing
// about the same state. A deployment with no project explains itself instead
// of going quiet.

export const ACCOUNT_STATES = ['loading', 'signed-in', 'signed-out', 'unavailable']

// accountState({ configured, loading, user }) -> one of ACCOUNT_STATES.
// `unavailable` means this build has no account service configured, which is
// a property of the deployment, not of the person.
export function accountState({ configured, loading = false, user = null } = {}) {
  if (!configured) return 'unavailable'
  if (loading) return 'loading'
  return user ? 'signed-in' : 'signed-out'
}

// What the header shows. Never null: a control that disappears teaches
// nothing, so even `unavailable` keeps its place and says why.
export function headerAccount(state, email = null) {
  switch (state) {
    case 'loading':
      // Nothing is claimed about the account until the session has actually
      // been restored — showing "Sign in" to someone who is signed in reads
      // as having been logged out.
      return { kind: 'waiting', label: '…' }
    case 'signed-in':
      return { kind: 'account', label: email, action: 'Sign out' }
    case 'signed-out':
      return { kind: 'action', label: 'Sign in', to: 'signin', title: 'Sign in to save contracts, keep a history, and sign off as a team' }
    default:
      return { kind: 'action', label: 'Accounts off', to: 'signin', title: 'This copy has no account service configured — what that means, and what still works' }
  }
}

// What each screen says in place of its account-only content. `null` when
// there is nothing to say (the content itself is shown).
const ADDS = {
  contracts: 'Your contracts are saved to your account, ready for the next file that arrives.',
  history: 'Every check you run is recorded, so you can see whether this cycle is better than the last.',
  signoff: 'A programme works as an organisation: an engineer submits a check, a business data owner decides, an auditor reads the record — and nobody signs off their own work.',
}
const WITHOUT = {
  contracts: 'Without one you can still write rules and keep them as a file, which the CLI reads too.',
  history: 'Without one, checking a file still works — the result lives as long as the page is open.',
  signoff: 'Without one the evidence pack still works: print its sign-off sheet and sign it on paper.',
}

export function accountNotice(state, surface) {
  if (state === 'signed-in' || state === 'loading') return null
  if (state === 'signed-out') {
    return {
      title: `Sign in to ${surface === 'signoff' ? 'work with your organisation' : surface === 'history' ? 'keep a history' : 'save your contracts'}`,
      body: `${ADDS[surface]} ${WITHOUT[surface]}`,
      cta: { label: 'Sign in', to: 'signin' },
    }
  }
  return {
    title: 'Accounts are not set up in this copy',
    body: `${ADDS[surface]} ${WITHOUT[surface]}`,
    cta: { label: 'What an account adds', to: 'signin' },
  }
}

// The explainer the sign-in screen shows when the deployment has no account
// service. It says what is missing, what still works, and how to turn it on —
// a page that explains is not a dead end; a disabled form is.
export const ACCOUNTS_OFF = {
  title: 'Accounts are not set up in this copy',
  lead: 'Nothing is wrong, and nothing here is locked. This build was not pointed at an account service, so the parts that need one are switched off.',
  adds: [
    'Saved contracts — the rules you write, ready for the next file.',
    'A history of every check you run, as counts and verdicts.',
    'Sign-off: roles, submissions, decisions and an audit log, so a cycle is accepted by the right person and the record cannot be rewritten.',
  ],
  works: 'Everything else is what you already have: checking a load file, reconciling a migration, the readiness board, and the evidence pack — all of it in this browser, with your files never uploaded.',
  howTo: 'To turn accounts on, copy .env.example to .env.local with a Supabase project’s URL and publishable key, apply supabase/schema.sql, and rebuild. The README has the steps, single sign-on included.',
}
