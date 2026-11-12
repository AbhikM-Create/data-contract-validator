import { isConfigured, signOut } from '../lib/supabase.js'
import { ROUTES, go } from '../routes.js'
import { colors, ghostButton, mono, sans } from '../theme.js'

// The frame every screen sits in: brand, the three destinations, the account,
// and the trust line. The trust line is part of the chrome rather than one
// screen's copy, because the claim it makes is true on every screen and a
// reader should never have to go looking for it.
export default function AppShell({ route, user, authLoading, busy, engineError, onDismissError, restored, onDismissRestored, autosaveProblem, children }) {
  const onLanding = route === 'home'

  return (
    <div style={{ background: colors.ground, minHeight: '100vh' }}>
      {/* First thing a keyboard reaches: past the header and nav to the screen. */}
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>
        Skip to the main content
      </a>
      <header
        style={{
          background: colors.panel,
          borderBottom: `1px solid ${colors.panelEdge}`,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 1080, margin: '0 auto', padding: '0 24px',
            display: 'flex', alignItems: 'center', gap: 24, minHeight: 58, flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => go('home')}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 9,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colors.accent, transform: 'rotate(45deg)' }} />
            <span style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 650, color: colors.ink, letterSpacing: '-0.01em' }}>
              Data Contract Validator
            </span>
          </button>

          <nav style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
            {ROUTES.map((item) => {
              const active = item.id === route
              return (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  aria-current={active ? 'page' : undefined}
                  title={item.blurb}
                  style={{
                    background: active ? colors.panelSunk : 'transparent',
                    border: '1px solid transparent',
                    borderBottom: `2px solid ${active ? colors.accent : 'transparent'}`,
                    color: active ? colors.ink : colors.mute,
                    fontFamily: sans, fontSize: 13.5, fontWeight: active ? 600 : 500,
                    padding: '9px 14px', borderRadius: '6px 6px 0 0', cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>

          {/* Which state the person is in, said plainly: signed out, the work
              lives on this device and nowhere else. */}
          {!authLoading && !user && (
            <span title="Signed out: your work is kept in this browser only." style={{ fontFamily: sans, fontSize: 12, color: colors.mute, border: `1px solid ${colors.panelEdge}`, borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>
              This device only
            </span>
          )}
          {isConfigured && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 10, borderLeft: `1px solid ${colors.panelEdge}` }}>
              {/* Nothing is claimed about the account until the session has
                  actually been restored — showing "Sign in" to someone who is
                  signed in reads as having been logged out. */}
              {authLoading ? (
                <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint }}>…</span>
              ) : user ? (
                <>
                  <span
                    title={user.email}
                    style={{
                      fontFamily: sans, fontSize: 12.5, color: colors.mute, maxWidth: 170,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {user.email}
                  </span>
                  <button onClick={() => signOut()} style={ghostButton}>Sign out</button>
                </>
              ) : (
                <button onClick={() => go('signin')} style={ghostButton}>Sign in</button>
              )}
            </div>
          )}
        </div>
      </header>

      <div style={{ background: colors.panelSunk, borderBottom: `1px solid ${colors.panelEdge}` }}>
        <div
          style={{
            maxWidth: 1080, margin: '0 auto', padding: '7px 24px',
            display: 'flex', alignItems: 'baseline', gap: 8,
          }}
        >
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.mute, flex: 1, minWidth: 0 }}>
            Files stay on this device. Nothing is uploaded: the records and fix lists you download go only to your
            computer, and an account, if you use one, stores only rules, names and counts.
          </span>
        </div>
      </div>

      {/* Work happens in a worker, so the page can say what is going on instead
          of freezing and looking crashed. */}
      {/* Announced, not just drawn: a screen reader hears that a check started
          and, through the screens' own status regions, how it ended. The region
          is always present so its first message is read. */}
      <div role="status" aria-live="polite">
      {busy && (
        <div style={{ background: `${colors.accent}0F`, borderBottom: `1px solid ${colors.accent}33` }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: colors.accent }} />
            <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.accent }}>
              {busy} The page stays usable while this runs.
            </span>
          </div>
        </div>
      )}
      </div>

      {(restored || autosaveProblem) && (
        <div style={{ background: colors.panel, borderBottom: `1px solid ${colors.panelEdge}` }}>
          <div role="status" style={{ maxWidth: 1080, margin: '0 auto', padding: '9px 24px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.ink, lineHeight: 1.55, flex: 1 }}>
              {restored && (
                <>
                  Restored your work from {when(restored.savedAt)} — the migration object and the rules you had open.
                  Files are never stored, so open them again to check.
                  {restored.skipped > 0 && ` ${restored.skipped} rule${restored.skipped === 1 ? '' : 's'} could not be read back and ${restored.skipped === 1 ? 'is' : 'are'} NOT being checked.`}
                </>
              )}
              {autosaveProblem && <>{restored ? ' ' : ''}{autosaveProblem}</>}
            </span>
            {restored && <button onClick={onDismissRestored} style={ghostButton}>Dismiss</button>}
          </div>
        </div>
      )}

      {engineError && (
        <div role="alert" style={{ background: `${colors.fail}0D`, borderBottom: `1px solid ${colors.fail}33` }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '11px 24px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.fail, lineHeight: 1.55, flex: 1 }}>
              {engineError}
            </span>
            <button onClick={onDismissError} style={{ ...ghostButton, color: colors.fail, borderColor: `${colors.fail}55` }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main id="main" tabIndex={-1} style={{ maxWidth: onLanding ? 1080 : 1080, margin: '0 auto', padding: '28px 24px 80px', outline: 'none' }}>
        {children}
      </main>

      <footer style={{ borderTop: `1px solid ${colors.panelEdge}`, background: colors.panel }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '16px 24px' }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>
            {isConfigured
              ? 'Parsing and checking happen in this page. Signed in, contracts and run counts are saved to your account; files and records never are.'
              : 'Parsing and checking happen in this page. No backend; your work is kept only in this browser.'}
          </span>
        </div>
      </footer>
    </div>
  )
}

// "3 Nov, 14:05" in the reader's own time zone.
function when(iso) {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return 'earlier'
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
