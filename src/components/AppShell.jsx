import { isConfigured, signOut } from '../lib/supabase.js'
import { ROUTES, go } from '../routes.js'
import { colors, ghostButton, mono, sans } from '../theme.js'

// The frame every screen sits in: brand, the three destinations, the account,
// and the trust line. The trust line is part of the chrome rather than one
// screen's copy, because the claim it makes is true on every screen and a
// reader should never have to go looking for it.
export default function AppShell({ route, user, authLoading, busy, engineError, onDismissError, children }) {
  const onLanding = route === 'home'

  return (
    <div style={{ background: colors.ground, minHeight: '100vh' }}>
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
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: colors.pass, flexShrink: 0 }} />
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.mute }}>
            Your CSVs are read in this browser and never uploaded. Only the contracts you author leave this
            page, and only when you download them.
          </span>
        </div>
      </div>

      {/* Work happens in a worker, so the page can say what is going on instead
          of freezing and looking crashed. */}
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

      {engineError && (
        <div style={{ background: `${colors.fail}0D`, borderBottom: `1px solid ${colors.fail}33` }}>
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

      <main style={{ maxWidth: onLanding ? 1080 : 1080, margin: '0 auto', padding: '28px 24px 80px' }}>
        {children}
      </main>

      <footer style={{ borderTop: `1px solid ${colors.panelEdge}`, background: colors.panel }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '16px 24px' }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>
            Parsing and checking happen in this page. No backend, no data storage.
          </span>
        </div>
      </footer>
    </div>
  )
}
