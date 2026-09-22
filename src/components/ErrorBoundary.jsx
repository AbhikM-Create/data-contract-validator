import { Component } from 'react'
import { colors, panel, primaryButton, sans, secondaryButton } from '../theme.js'

// The last line of defence.
//
// Without this, a single bad render empties the page: no message, no way back,
// and — because everything here lives in the tab — the file someone just
// checked is gone with it. A blank white screen is the worst thing an app whose
// whole promise is "never show a blank screen on bad input" can do.
//
// This is deliberately not clever. It catches, it says what happened, and it
// offers the two things that actually help: try this screen again, or start
// over. It also prints the error, because a support conversation goes very
// differently when the person can paste the actual message.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // No telemetry: this app sends nothing anywhere, and an error reporter
    // would be the one exception to that promise. The console is where a
    // developer looks anyway.
    console.error('Something in the interface failed to render.', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={{ background: colors.ground, minHeight: '100vh', padding: '64px 24px' }}>
        <div style={{ ...panel, maxWidth: 620, margin: '0 auto', padding: '28px 30px' }}>
          <h1 style={{ fontFamily: sans, fontSize: 20, fontWeight: 650, color: colors.ink, margin: 0 }}>
            This screen stopped working
          </h1>
          <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.6, marginTop: 10 }}>
            Something in the interface failed while drawing this page. Your data was never uploaded anywhere,
            so nothing has leaked — but anything loaded in this tab is gone, and any file will need reading again.
          </p>

          <pre
            style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 12, color: colors.fail,
              background: colors.panelSunk, border: `1px solid ${colors.panelEdge}`, borderRadius: 6,
              padding: '10px 12px', marginTop: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {error?.message ?? String(error)}
          </pre>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button onClick={() => window.location.reload()} style={primaryButton}>Reload the app</button>
            <button
              onClick={() => { window.location.hash = '/'; window.location.reload() }}
              style={secondaryButton}
            >
              Start over
            </button>
          </div>
        </div>
      </div>
    )
  }
}
