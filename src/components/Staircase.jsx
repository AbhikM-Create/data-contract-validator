import { CHECK_COPY } from '../copy.js'
import { chip, colors, mono, panel, sans, statusColor } from '../theme.js'

// The signature view: the four checks drawn as a descent, so the eye lands on
// the step where the file stopped. A flat list of four verdicts hides the one
// fact that matters — that the checks ABOVE a failure passed, which is what
// tells you the kind of problem you have. A file with perfect columns and
// familiar categories can still be carrying numbers 83x too large; on a
// staircase, that reads instantly.
//
// The steps are joined by a drawn path — a tread across each step and a riser
// down into the next. Without it the four cards float at different heights and
// read as a ragged list rather than a descent.

const STEP_DROP = 30

export default function Staircase({ layers, title = 'How far the file got', note }) {
  const firstFailure = layers.findIndex((layer) => layer.status === 'FAIL')
  const passedAbove = firstFailure > 0 ? layers.slice(0, firstFailure).filter((l) => l.status === 'PASS') : []

  return (
    <div style={{ ...panel, padding: '20px 22px 26px', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: sans, fontSize: 15, fontWeight: 600, color: colors.ink, margin: 0 }}>{title}</h2>
        <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint }}>
          {note ?? 'Each check asks something the one before it cannot'}
        </span>
      </div>

      <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.55, margin: '8px 0 0', maxWidth: 700 }}>
        {caption(layers, firstFailure, passedAbove)}
      </p>

      <div className="staircase-grid" style={{ marginTop: 26 }}>
        {layers.map((layer, index) => (
          <Step
            key={layer.id}
            layer={layer}
            index={index}
            isLead={index === firstFailure}
            isAboveFailure={firstFailure >= 0 && index < firstFailure}
            drop={index * STEP_DROP}
          />
        ))}
      </div>
    </div>
  )
}

function Step({ layer, index, isLead, isAboveFailure, drop }) {
  const tone = statusColor[layer.status] ?? colors.faint
  const problems = layer.violations.length
  // The path runs grey until the step that caught the file, where it turns the
  // colour of the verdict — so the eye follows the descent straight to it.
  const pathColor = isLead ? tone : '#C6D0D8'

  return (
    <div className="staircase-step" style={{ marginTop: drop, position: 'relative' }}>
      {/* the riser: drops from the previous tread down to this one, drawn in
          the grid gutter so the four steps read as one continuous path */}
      {index > 0 && (
        <span
          className="staircase-riser"
          aria-hidden="true"
          style={{
            position: 'absolute', left: -6, top: -STEP_DROP, width: 3, height: STEP_DROP + 3,
            background: pathColor, borderRadius: 2,
          }}
        />
      )}

      {/* Absolutely positioned: in the flow it would push this step's tread
          below the others and break the rhythm the staircase depends on. */}
      {isLead && (
        <div
          style={{
            position: 'absolute', top: -17, left: 0,
            fontFamily: sans, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tone,
          }}
        >
          CAUGHT HERE
        </div>
      )}

      {/* the tread, reaching back into the gutter to meet the riser */}
      <div style={{ height: 3, background: pathColor, borderRadius: 2, marginLeft: index > 0 ? -6 : 0 }} />

      <div
        style={{
          border: `1px solid ${isLead ? `${tone}66` : colors.panelEdge}`,
          background: isLead ? `${tone}0D` : colors.panel,
          borderRadius: 7,
          padding: '12px 13px 14px',
          marginTop: 11,
          height: 118,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: colors.faint }}>{index + 1}</span>
          <span style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: colors.ink }}>{layer.label}</span>
        </div>

        <div style={{ marginTop: 9 }}>
          <span style={chip(layer.status)}>{layer.status}</span>
        </div>

        <p style={{ fontFamily: sans, fontSize: 11.5, lineHeight: 1.45, color: colors.faint, margin: 'auto 0 0' }}>
          {layer.status === 'FAIL'
            ? `${problems} problem${problems === 1 ? '' : 's'} found`
            : layer.status === 'SKIPPED'
              ? 'Not judged on this file'
              : isAboveFailure
                ? 'Passed — and let it through'
                : shortQuestion(layer.id)}
        </p>
      </div>
    </div>
  )
}

function shortQuestion(id) {
  const plain = CHECK_COPY[id]?.plain ?? ''
  return plain.length > 52 ? `${plain.slice(0, 49)}…` : plain
}

function caption(layers, firstFailure, passedAbove) {
  if (firstFailure < 0) {
    const skipped = layers.filter((layer) => layer.status === 'SKIPPED')
    return skipped.length === 0
      ? 'The file came down all four steps without catching on any of them.'
      : `No check objected. ${skipped.map((s) => s.label).join(' and ')} could not be judged on this file.`
  }

  const lead = layers[firstFailure]
  if (passedAbove.length === 0) {
    return `${lead.label} stopped it at the first step — nothing below was reached before the problem showed.`
  }
  const names = passedAbove.map((layer) => layer.label)
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${joined} ${names.length === 1 ? 'passed' : 'all passed'}, and ${lead.label} is where the file stopped. A check that looked only at ${names[0].toLowerCase()} would have called this file fine.`
}
