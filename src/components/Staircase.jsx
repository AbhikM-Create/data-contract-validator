import { CHECK_COPY } from '../copy.js'
import { chip, colors, mono, panel, sans, statusColor, tint } from '../theme.js'
import { isoStair } from './isoStair.js'

// The signature view: the checks drawn as an isometric staircase, with the
// plumb bob of the logo resting on the step where the file (or load) stopped.
// A flat list of verdicts hides the one fact that matters — that the checks
// ABOVE a failure passed, which is what tells you the kind of problem you have.
//
// The drawing is decoration over the legend beside it: every step's number,
// name, verdict and line are in the legend as words, so nothing is said by
// colour alone and a screen reader hears it all. Any number of steps: the four
// drift layers, or reconciliation's five. A step is { id, label, status,
// violations } and may carry its own `question`; `subject` names what came down
// the stairs — a file, or a load.

// Face tints per verdict: top, front, right. The step that caught the file is
// the strongest; other failures stay quieter so the eye lands on the first.
const FACES = {
  lead: faces('lead'),
  FAIL: faces('fail'),
  PASS: faces('pass'),
  warn: faces('warn'),
  idle: faces('idle'),
}
const WARN = new Set(['INSUFFICIENT', 'UNCHECKED'])
function faces(kind) {
  return ['top', 'front', 'right'].map((side) => `var(--face-${kind}-${side})`)
}

export default function Staircase({ layers, title = 'How far the file got', note, subject = 'file' }) {
  const firstFailure = layers.findIndex((layer) => layer.status === 'FAIL')
  const passedAbove = firstFailure > 0 ? layers.slice(0, firstFailure).filter((l) => l.status === 'PASS') : []

  return (
    <div style={{ ...panel, padding: '22px 24px 24px', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 650, color: colors.ink, margin: 0 }}>{title}</h2>
        <span style={{ fontFamily: sans, fontSize: 13, color: colors.faint }}>
          {note ?? 'Each check asks something the one before it cannot'}
        </span>
      </div>

      <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.55, margin: '8px 0 0', maxWidth: 700 }}>
        {caption(layers, firstFailure, passedAbove, subject)}
      </p>

      <div className="iso-stair" style={{ marginTop: 18 }}>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
          {layers.map((layer, index) => (
            <Step key={layer.id} layer={layer} index={index} isLead={index === firstFailure} isAboveFailure={firstFailure >= 0 && index < firstFailure} />
          ))}
        </ol>
        <div className="iso-drawing">
          <Drawing layers={layers} lead={firstFailure} />
        </div>
      </div>
    </div>
  )
}

function Step({ layer, index, isLead, isAboveFailure }) {
  const tone = statusColor[layer.status] ?? colors.faint
  const problems = layer.violations?.length ?? 0
  return (
    <li
      className="staircase-step"
      style={{
        display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) auto', gap: 12, alignItems: 'center',
        padding: '11px 12px', borderRadius: 12,
        background: isLead ? `${tint(tone, '0F')}` : 'transparent',
        borderWidth: 1, borderStyle: 'solid', borderColor: isLead ? `${tint(tone, '55')}` : 'transparent',
        borderTopColor: isLead ? `${tint(tone, '55')}` : index > 0 ? 'var(--hairline)' : 'transparent',
      }}
    >
      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: isLead ? tone : colors.faint }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <span style={{ minWidth: 0 }}>
        {isLead && (
          <span style={{ display: 'block', fontFamily: sans, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: tone }}>
            CAUGHT HERE
          </span>
        )}
        <span style={{ display: 'block', fontFamily: sans, fontSize: 15, fontWeight: isLead ? 700 : 600, color: colors.ink }}>{layer.label}</span>
        <span style={{ display: 'block', fontFamily: sans, fontSize: 13, lineHeight: 1.45, color: colors.mute, marginTop: 1 }}>
          {layer.status === 'FAIL'
            ? `${problems} problem${problems === 1 ? '' : 's'} found`
            : layer.status === 'SKIPPED'
              ? 'Not judged on this file'
              : isAboveFailure
                ? 'Passed — and let it through'
                : shortQuestion(layer)}
        </span>
      </span>
      <span style={isLead ? { ...chip(layer.status), background: tone, color: colors.onSolid, borderColor: tone } : chip(layer.status)}>{layer.status}</span>
    </li>
  )
}

// The drawing. Decorative: the legend says everything it shows.
function Drawing({ layers, lead }) {
  const stair = isoStair(layers.length)
  const restOn = lead >= 0 ? lead : layers.length - 1
  const [bx, by] = stair.steps[restOn].rest
  const bobTone = colors.accent
  return (
    <svg viewBox={`0 0 ${stair.width} ${stair.height}`} aria-hidden="true" focusable="false">
      <ellipse cx={stair.width / 2} cy={stair.height - 14} rx={stair.width * 0.42} ry={12} style={{ fill: 'var(--floor-shadow)' }} />
      <g strokeWidth="1" strokeLinejoin="round" style={{ stroke: 'var(--face-edge)' }}>
        {stair.steps.map((step, i) => {
          const layer = layers[i]
          const faces = i === lead ? FACES.lead : layer.status === 'FAIL' ? FACES.FAIL : layer.status === 'PASS' ? FACES.PASS : WARN.has(layer.status) ? FACES.warn : FACES.idle
          return (
            <g key={layer.id}>
              <polygon points={step.right} style={{ fill: faces[2] }} />
              <polygon points={step.front} style={{ fill: faces[1] }} />
              <polygon points={step.top} style={{ fill: faces[0], stroke: i === lead ? colors.fail : undefined }} strokeWidth={i === lead ? 2 : undefined} />
            </g>
          )
        })}
      </g>
      <g fontFamily={mono} fontSize="13" fontWeight="600" textAnchor="middle">
        {stair.steps.map((step, i) => (
          <text key={layers[i].id} x={step.label[0]} y={step.label[1] + 4} style={{ fill: i === lead ? colors.fail : statusColor[layers[i].status] ?? colors.faint }}>
            {String(i + 1).padStart(2, '0')}
          </text>
        ))}
      </g>
      {/* the plumb line and its bob, resting on the step that caught it */}
      <line x1={bx - 34} y1={stair.beamY} x2={bx + 34} y2={stair.beamY} strokeWidth="3" strokeLinecap="round" style={{ stroke: colors.ink }} />
      <g className="plumb">
        <line x1={bx} y1={stair.beamY} x2={bx} y2={by - 19} strokeWidth="2" style={{ stroke: bobTone }} />
        <ellipse cx={bx} cy={by + 1} rx="15" ry="5" style={{ fill: tint(lead >= 0 ? colors.fail : colors.accent, '38') }} />
        <polygon points={`${bx - 9},${by - 19} ${bx + 9},${by - 19} ${bx},${by - 1}`} style={{ fill: bobTone }} />
      </g>
    </svg>
  )
}

function shortQuestion(layer) {
  const plain = layer.question ?? CHECK_COPY[layer.id]?.plain ?? ''
  return plain.length > 64 ? `${plain.slice(0, 61)}…` : plain
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']

function caption(layers, firstFailure, passedAbove, subject) {
  if (firstFailure < 0) {
    const skipped = layers.filter((layer) => layer.status === 'SKIPPED')
    return skipped.length === 0
      ? `The ${subject} came down all ${COUNT_WORDS[layers.length] ?? layers.length} steps without catching on any of them.`
      : `No check objected. ${skipped.map((s) => s.label).join(' and ')} could not be judged on this ${subject}.`
  }

  const lead = layers[firstFailure]
  if (passedAbove.length === 0) {
    return `${lead.label} stopped it at the first step — nothing below was reached before the problem showed.`
  }
  const names = passedAbove.map((layer) => layer.label)
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const verb = names.length === 1 ? 'passed' : names.length === 2 ? 'both passed' : 'all passed'
  return `${joined} ${verb}, and ${lead.label} is where the ${subject} stopped. A check that looked only at ${names[0].toLowerCase()} would have called this ${subject} fine.`
}
