import { colors, ghostButton, mono, panel, primaryButton, sans } from '../theme.js'

// The guided first run: a short checklist beside the worked example, for
// someone who knows what the tool is for and has never used it. It never
// blocks: every step is something the person does in the real workspace, and
// the list only notices that it happened. "Exit tour" is always there.
//
// The marks are plain — a tick, an arrow, a ring. Green is a verdict's colour.
export default function TourPanel({ items, onEnd }) {
  const current = items.find((item) => !item.done)
  const done = items.filter((item) => item.done).length
  return (
    <aside aria-label="Your first cutover" style={{ ...panel, padding: 14, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 650, color: colors.ink }}>Your first cutover</span>
        <span style={{ fontFamily: mono, fontSize: 11.5, color: colors.mute }}>{done} of {items.length}</span>
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
        {items.map((item) => {
          const now = item === current
          return (
            <li key={item.id} aria-current={now ? 'step' : undefined} style={{ padding: '5px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span aria-hidden="true" style={{ fontFamily: mono, fontSize: 12, width: 14, color: now ? colors.accent : colors.mute }}>
                  {item.done ? '✓' : now ? '→' : '○'}
                </span>
                <span style={{ fontFamily: sans, fontSize: 13, fontWeight: now ? 600 : 400, color: now ? colors.ink : colors.mute }}>
                  {item.label}
                  <span style={visuallyHidden}>{item.done ? ' — done' : now ? ' — next' : ''}</span>
                </span>
              </div>
              {now && (
                <div style={{ margin: '6px 0 4px 22px' }}>
                  <p style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, color: colors.mute, margin: 0 }}>{item.hint}</p>
                  {item.action && (
                    <button onClick={item.action.run} style={{ ...primaryButton, fontSize: 12.5, padding: '7px 12px', marginTop: 8 }}>{item.action.label}</button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!current && (
        <p style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, color: colors.ink, margin: '8px 0 0' }}>
          That is the whole loop: check before the load, prove after it, sign.
        </p>
      )}
      <button onClick={onEnd} style={{ ...ghostButton, marginTop: 10, fontSize: 12 }}>{current ? 'Exit tour' : 'Close'}</button>
    </aside>
  )
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
