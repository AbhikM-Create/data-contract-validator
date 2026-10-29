import { accountNotice } from '../lib/accounts.js'
import { go } from '../routes.js'
import { colors, panel, sans, secondaryButton } from '../theme.js'

// What Contracts, History and Sign-off show in place of their account-only
// content. One component over one copy module (lib/accounts.js), so the three
// screens and the header can never tell a person different things about the
// same state — and so neither offers a sign-in a deployment cannot perform.
export default function AccountNotice({ state, surface, children }) {
  const notice = accountNotice(state, surface)
  if (!notice) return null
  return (
    <div style={{ ...panel, padding: '22px 22px', marginTop: 20, maxWidth: 620 }}>
      <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>{notice.title}</div>
      <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>{notice.body}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={() => go(notice.cta.to)} style={secondaryButton}>{notice.cta.label}</button>
        {children}
      </div>
    </div>
  )
}
