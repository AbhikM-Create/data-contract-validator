import { useState } from 'react'
import { colors, ghostButton, sans } from '../theme.js'

// A button whose action throws work away asks first, in place: the question
// appears where the click happened, with the safe choice focused. When there is
// nothing to lose (`needsConfirm` false) it acts at once.
//
// Neutral colours on purpose: red is kept for a FAIL verdict.
export default function ConfirmButton({ children, question, confirmLabel, keepLabel = 'Keep', needsConfirm = true, onConfirm, style = ghostButton }) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <button onClick={() => (needsConfirm ? setAsking(true) : onConfirm())} style={style}>
        {children}
      </button>
    )
  }

  return (
    <span role="group" aria-label={question} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span role="status" style={{ fontFamily: sans, fontSize: 13, color: colors.ink, fontWeight: 600 }}>{question}</span>
      <button
        onClick={() => { setAsking(false); onConfirm() }}
        style={{ ...ghostButton, color: colors.ink, borderColor: colors.mute, fontWeight: 600 }}
      >
        {confirmLabel}
      </button>
      {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- focus moves to the safe choice the moment the question appears */}
      <button autoFocus onClick={() => setAsking(false)} style={ghostButton}>{keepLabel}</button>
    </span>
  )
}
