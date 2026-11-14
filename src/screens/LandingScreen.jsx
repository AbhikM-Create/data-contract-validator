import { useRef } from 'react'
import Staircase from '../components/Staircase.jsx'
import { useDescent } from '../components/descent.js'
import { isoStair } from '../components/isoStair.js'
import { RECON_STEPS } from '../lib/reconcile.js'
import { LAYERS } from '../lib/validate.js'
import { CHECK_COPY, HOW_IT_WORKS } from '../copy.js'
import { MIGRATION_EXAMPLES } from '../samples/migrationExamples.js'
import { SAMPLE_PAIRS } from '../samples/samples.js'
import { go } from '../routes.js'
import { colors, mono, panel, primaryButton, sans, secondaryButton, tint } from '../theme.js'

// The first look. A visitor can read what the tool does and run a ready-made
// example without an account — the checks all happen in their browser, so there
// is nothing to gate behind a sign-up.
//
// It leads with the job most people arrive for: a cutover — checking a load
// file before the load and proving the load after it (final-spec §4.1). The
// drift check, for a feed after go-live, follows as its own section.
// The same Staircase the report uses, filled with a worked example rather than
// a mock-up: showing the app's one distinctive view on the way in beats
// describing it. Labelled as an example so nobody reads it as their own result.
const EXAMPLE_LAYERS = LAYERS.map((layer) => ({
  ...layer,
  status: layer.id === 'distribution' ? 'FAIL' : 'PASS',
  violations: layer.id === 'distribution' ? [{ code: 'central-shift' }, { code: 'out-of-range' }] : [],
}))

// What the tool answers, for someone who has never heard of it.
const BEATS = [
  { title: 'Before the load', body: 'Will the new system accept this file? See what it would reject while fixing it still costs an edit.' },
  { title: 'After the load', body: 'Did every record and balance arrive, correctly? The step that catches a problem says whose fix it is.' },
  { title: 'Sign-off', body: 'One record of what was checked, on which files, with every difference decided. An auditor can check it.' },
]

export default function LandingScreen({ onLoadSample, onMigrationExample, onTour, recent = [], onOpenRecent }) {
  return (
    <>
      <section className="hero" style={{ paddingTop: 18 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ display: 'inline-block', fontFamily: sans, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.accent, background: `${tint(colors.accent, '1A')}`, borderRadius: 6, padding: '4px 10px' }}>
            For ERP, HCM and finance cutovers
          </span>
          <h1 className="hero-title" style={{ fontFamily: sans, fontWeight: 700, letterSpacing: '-0.045em', color: colors.ink, margin: '16px 0 0', lineHeight: 1.02 }}>
            Prove every load before anyone signs it off.
          </h1>
          <p style={{ fontFamily: sans, fontSize: 18, color: colors.mute, lineHeight: 1.55, marginTop: 18, maxWidth: 560 }}>
            For teams moving finance and HR data into a new system. Plumbstep walks each load down five checks and stops where the problem is — so you know what kind of problem it is, and whose fix.
          </p>
        </div>
        <HeroStair />
      </section>

      <section style={{ marginTop: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {BEATS.map((beat, index) => (
            <div key={beat.title} style={{ ...panel, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent }}>{index + 1}</span>
                <span style={{ fontFamily: sans, fontSize: 14, fontWeight: 620, color: colors.ink }}>{beat.title}</span>
              </div>
              <p style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.5, color: colors.mute, margin: '7px 0 0' }}>{beat.body}</p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={onTour} style={primaryButton}>See it work in 2 minutes</button>
          <button onClick={() => go('migrations')} style={secondaryButton}>Start with my files</button>
          <button onClick={() => go('validate')} style={secondaryButton}>Monitor a feed</button>
          <span style={{ fontFamily: sans, fontSize: 13, color: colors.mute }}>No account needed. Your files stay on this device.</span>
        </div>
      </section>

      {recent.length > 0 && (
        <section style={{ marginTop: 34 }} aria-label="Pick up where you left off">
          <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 620, color: colors.ink, margin: 0 }}>Pick up where you left off</h2>
          <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 680 }}>
            Objects saved to your account. Open one, then open its files again on this device.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', maxWidth: 760 }}>
            {recent.map((item) => (
              <li key={item.id} style={{ ...panel, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{item.name}</div>
                  <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                    {[item.wave, item.cycle].filter(Boolean).join(' · ')}{item.runs ? ` · ${item.runs} check${item.runs === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                <button onClick={() => onOpenRecent(item.id)} style={secondaryButton} aria-label={`Open ${item.name}`}>Open</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 34 }}>
        <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 620, color: colors.ink, margin: 0 }}>
          Or open an example and look around
        </h2>
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 680 }}>
          Each example opens with its files, rules and mapping in place. Every company, person and amount in them is invented.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 16 }}>
          {MIGRATION_EXAMPLES.map((example) => (
            <div key={example.id} style={{ ...panel, padding: '15px 16px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{example.name}</div>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 4 }}>{example.path}</div>
              <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: colors.mute, marginTop: 9, flex: 1 }}>{example.blurb}</p>
              <button onClick={() => onMigrationExample(example.id)} style={{ ...secondaryButton, marginTop: 14 }} aria-label={`Open this example: ${example.name}`}>
                Open this example
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 52, paddingTop: 30, borderTop: `1px solid ${colors.panelEdge}`, maxWidth: 720 }}>
        <h2 style={{ fontFamily: sans, fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em', color: colors.ink, margin: 0, lineHeight: 1.2 }}>
          After go-live: the columns match. That does not make it the same data.
        </h2>
        <p style={{ fontFamily: sans, fontSize: 16, color: colors.mute, lineHeight: 1.6, marginTop: 16 }}>
          A file can keep every column name, every type and every category, and still be wrong — values 83&times;
          what they were, a feed that stopped updating, a grade nobody has ever heard of. This checks a new CSV
          four ways and tells you which check caught it.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <button onClick={() => go('validate')} style={primaryButton}>Monitor a feed</button>
          <button onClick={() => go('contracts')} style={secondaryButton}>Write a contract</button>
        </div>
      </section>

      <section style={{ marginTop: 34 }}>
        <Staircase
          layers={EXAMPLE_LAYERS}
          title="What the report tells you"
          note="An example — salaries arriving 83× too large"
        />
      </section>

      <section style={{ marginTop: 44 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18 }}>
          {HOW_IT_WORKS.map((step, index) => (
            <div key={step.title} style={{ display: 'flex', gap: 11 }}>
              <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent, paddingTop: 2 }}>{index + 1}</span>
              <div>
                <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{step.title}</div>
                <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.5, marginTop: 4 }}>{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 44 }}>
        <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 620, color: colors.ink, margin: 0 }}>
          Try it now — no account needed
        </h2>
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 660 }}>
          Each example is a pair of files. They load straight into the validator so you can see a real report
          before using your own data.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 16 }}>
          {SAMPLE_PAIRS.map((sample) => (
            <div key={sample.id} style={{ ...panel, padding: '15px 16px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{sample.name}</div>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 4 }}>{sample.expectation}</div>
              <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: colors.mute, marginTop: 9, flex: 1 }}>{sample.blurb}</p>
              <button onClick={() => onLoadSample(sample)} style={{ ...secondaryButton, marginTop: 14 }}>
                Run this example
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 44 }}>
        <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 620, color: colors.ink, margin: 0 }}>
          The four checks, in order
        </h2>
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 680 }}>
          A file can pass the first three and still fail the last. Knowing <em>which</em> one caught a problem
          tells you what kind of problem it is.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))', gap: 12, marginTop: 16 }}>
          {LAYERS.map((layer, index) => (
            <div key={layer.id} style={{ ...panel, padding: '14px 15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: mono, fontSize: 12, color: colors.faint }}>{index + 1}</span>
                <span style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{layer.label}</span>
              </div>
              <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.45, marginTop: 8 }}>
                {CHECK_COPY[layer.id].plain}
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                {CHECK_COPY[layer.id].catches.map((item) => (
                  <li key={item} style={{ fontFamily: sans, fontSize: 13, color: colors.faint, lineHeight: 1.5, display: 'flex', gap: 7 }}>
                    <span style={{ color: colors.accent }}>&middot;</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

// The hero: the staircase on its own, every step named. Decorative — the same
// five steps are words in the report. The plumb bob walks down all five once
// (descent.js) and rests on the last: every load is taken down every check.
// No verdict colours here, only the accent: this is the process, not a result.
function HeroStair() {
  const stair = isoStair(RECON_STEPS.length)
  const last = stair.steps.length - 1
  const [bx, by] = stair.steps[last].rest
  const svg = useRef(null)
  useDescent(svg, { rests: stair.steps.map((s) => s.rest), stopAt: last, beamY: stair.beamY, key: 'home-hero' })
  return (
    <div className="hero-art" aria-hidden="true" style={{ position: 'relative' }}>
      <svg ref={svg} viewBox={`0 0 ${stair.width} ${stair.height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <ellipse cx={stair.width / 2} cy={stair.height - 14} rx={stair.width * 0.42} ry={12} style={{ fill: 'var(--floor-shadow)' }} />
        <g strokeWidth="1" strokeLinejoin="round" style={{ stroke: 'var(--face-edge)' }}>
          {stair.steps.map((step, i) => (
            <g key={i} data-descent-step={i}>
              <polygon points={step.right} style={{ fill: 'var(--face-first-right)' }} />
              <polygon points={step.front} style={{ fill: 'var(--face-first-front)' }} />
              <polygon points={step.top} style={{ fill: 'var(--face-first-top)' }} />
            </g>
          ))}
        </g>
        <g data-descent="carriage">
          <line x1={bx - 34} y1={stair.beamY} x2={bx + 34} y2={stair.beamY} strokeWidth="3" strokeLinecap="round" style={{ stroke: colors.ink }} />
          <g className="plumb">
            <line data-descent="string" x1={bx} y1={stair.beamY} x2={bx} y2={by - 19} strokeWidth="2" style={{ stroke: colors.accent, transformBox: 'fill-box', transformOrigin: 'top' }} />
            <g data-descent="bob">
              <ellipse cx={bx} cy={by + 1} rx="15" ry="5" style={{ fill: tint(colors.accent, '38') }} />
              <polygon points={`${bx - 9},${by - 19} ${bx + 9},${by - 19} ${bx},${by - 1}`} style={{ fill: colors.accent }} />
            </g>
          </g>
        </g>
      </svg>
      {stair.steps.map((step, i) => (
        <span
          key={RECON_STEPS[i].id}
          style={{
            position: 'absolute',
            left: `${((step.label[0] + 46) / stair.width) * 100}%`,
            top: `${((step.label[1] - 12) / stair.height) * 100}%`,
            display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap',
            fontFamily: sans, fontSize: 12, fontWeight: 600, color: colors.ink,
            background: 'var(--tag-bg)', borderRadius: 999, padding: '4px 10px',
            boxShadow: 'var(--tag-shadow)',
          }}
        >
          <span style={{ fontFamily: mono, color: colors.accent }}>{String(i + 1).padStart(2, '0')}</span>
          {RECON_STEPS[i].label}
        </span>
      ))}
    </div>
  )
}
