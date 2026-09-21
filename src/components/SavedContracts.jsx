import { useState } from 'react'
import { go } from '../routes.js'
import { colors, ghostButton, label, panel, sans, secondaryButton } from '../theme.js'

// The contracts in this account. A contract is worth writing only if it
// outlives the file it was written against, and this is where that becomes
// visible: a list you come back to, not a download you have to find again.
export default function SavedContracts({ contracts, loading, openId, signedIn, error, onOpen, onDelete, onNew }) {
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState(null)

  if (!signedIn) {
    return (
      <div style={{ ...panel, padding: '18px 20px' }}>
        <span style={label}>Your contracts</span>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.55, margin: '8px 0 0', maxWidth: 520 }}>
          Sign in and your contracts are saved to your account, ready for the next file that arrives. Signed
          out, you can still write rules and keep them as a file.
        </p>
        <button onClick={() => go('signin')} style={{ ...secondaryButton, marginTop: 14 }}>Sign in</button>
      </div>
    )
  }

  const text = query.trim().toLowerCase()
  const visible = text ? contracts.filter((c) => c.name.toLowerCase().includes(text)) : contracts

  return (
    <div style={{ ...panel, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={label}>Your contracts</span>
        <button onClick={onNew} style={ghostButton}>+ New contract</button>
      </div>

      {error && (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.fail, lineHeight: 1.5, marginTop: 10 }}>{error}</p>
      )}

      {loading ? (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, marginTop: 12 }}>Loading…</p>
      ) : contracts.length === 0 ? (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, lineHeight: 1.55, marginTop: 12, maxWidth: 520 }}>
          Nothing saved yet. Write some rules below and save them — they will be here next time, and on any
          other machine you sign in from.
        </p>
      ) : (
        <>
          {contracts.length > 4 && (
            <input
              type="text"
              value={query}
              aria-label="search saved contracts"
              placeholder="Search your contracts…"
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%', background: colors.panel, border: `1px solid ${colors.panelEdge}`,
                borderRadius: 6, color: colors.ink, fontFamily: sans, fontSize: 13,
                padding: '8px 11px', outline: 'none', marginTop: 12,
              }}
            />
          )}

          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
            {visible.map((contract) => {
              const open = contract.id === openId
              return (
                <li
                  key={contract.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: open ? colors.panelSunk : 'transparent',
                    borderWidth: 1, borderStyle: 'solid', borderColor: colors.panelEdge,
                    borderLeftWidth: 2, borderLeftColor: open ? colors.accent : colors.panelEdge,
                    borderRadius: 6, padding: '10px 12px', marginBottom: 6,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: open ? 650 : 500, color: colors.ink }}>
                      {contract.name}
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                      {contract.ruleCount} rule{contract.ruleCount === 1 ? '' : 's'} · saved {when(contract.updatedAt)}
                      {open ? ' · open' : ''}
                    </div>
                  </div>

                  {confirming === contract.id ? (
                    <>
                      <span style={{ fontFamily: sans, fontSize: 12, color: colors.fail }}>Delete for good?</span>
                      <button
                        onClick={() => { onDelete(contract.id); setConfirming(null) }}
                        style={{ ...ghostButton, color: colors.fail, borderColor: `${colors.fail}66` }}
                      >
                        Delete
                      </button>
                      <button onClick={() => setConfirming(null)} style={ghostButton}>Keep</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onOpen(contract.id)} style={ghostButton}>{open ? 'Reload' : 'Open'}</button>
                      <button onClick={() => setConfirming(contract.id)} style={ghostButton}>Delete</button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          {visible.length === 0 && (
            <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint }}>Nothing matches that search.</p>
          )}
        </>
      )}
    </div>
  )
}

// Recent saves are the ones you are working with, so they read in relative
// terms; older ones get a date, because "43 days ago" is not a useful fact.
function when(iso) {
  if (!iso) return 'just now'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'recently'
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toISOString().slice(0, 10)
}
