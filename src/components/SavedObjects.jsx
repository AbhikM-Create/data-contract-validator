import { useState } from 'react'
import { go } from '../routes.js'
import { colors, ghostButton, label, panel, sans, secondaryButton } from '../theme.js'
import { when } from './when.js'

// The migration objects in this account (user state 4). Saving one keeps its
// definitions and run counts on any device the person signs in from; the files
// it was checked against are opened again on each device, and the stamps say
// whether they are the ones.
export default function SavedObjects({ objects, loading, openId, signedIn, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(null)

  if (!signedIn) {
    return (
      <div style={{ ...panel, background: colors.panelSunk, padding: '12px 14px', marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: sans, fontSize: 13, color: colors.mute, flex: 1, minWidth: 240 }}>
          This object is kept in this browser, and in the file you download. Sign in to keep it in your account as well.
        </span>
        <button onClick={() => go('signin')} style={secondaryButton}>Sign in</button>
      </div>
    )
  }

  return (
    <div style={{ ...panel, padding: '14px 16px', marginTop: 12 }}>
      <span style={label}>Your objects</span>
      {loading ? (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, margin: '10px 0 0' }}>Loading…</p>
      ) : objects.length === 0 ? (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, lineHeight: 1.55, margin: '10px 0 0', maxWidth: 560 }}>
          Nothing saved to your account yet. “Save to account” keeps this object’s rules, mapping and run counts — never a record from your files.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {objects.map((item) => {
            const open = item.id === openId
            return (
              <li
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  background: open ? colors.panelSunk : 'transparent',
                  borderWidth: 1, borderStyle: 'solid', borderColor: colors.panelEdge,
                  borderLeftWidth: 2, borderLeftColor: open ? colors.accent : colors.panelEdge,
                  borderRadius: 6, padding: '9px 12px', marginBottom: 6,
                }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontFamily: sans, fontSize: 14, fontWeight: open ? 650 : 500, color: colors.ink }}>{item.name}</div>
                  <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                    {[item.wave, item.cycle].filter(Boolean).join(' · ')}
                    {item.orgName ? ` · ${item.orgName}` : ''}{item.pack ? ` · from ${item.pack}` : ''}
                    {` · ${item.runs} check${item.runs === 1 ? '' : 's'} · saved ${when(item.updatedAt)}`}
                    {open ? ' · open' : ''}
                  </div>
                </div>
                {confirming === item.id ? (
                  <>
                    <span style={{ fontFamily: sans, fontSize: 12, color: colors.fail }}>Delete from your account?</span>
                    <button onClick={() => { onDelete(item.id); setConfirming(null) }} style={{ ...ghostButton, color: colors.fail, borderColor: `${colors.fail}66` }}>Delete</button>
                    <button onClick={() => setConfirming(null)} style={ghostButton}>Keep</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => onOpen(item.id)} style={ghostButton}>{open ? 'Reload' : 'Open'}</button>
                    <button onClick={() => setConfirming(item.id)} style={ghostButton}>Delete</button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
