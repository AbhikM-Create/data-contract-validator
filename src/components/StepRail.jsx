import { colors, mono, sans } from '../theme.js'

// The workspace's steps, as a rail: where you are, and how each step stands.
// One step is on screen at a time; the rail is how the whole object reads at a
// glance — set up, checked before the load, proved after it, signed off.
//
// tone: 'fail' and 'pass' colour a VERDICT only (green and red appear nowhere
// else); 'warn' marks a result that is out of date; anything else is plain.
const TONE = { fail: colors.fail, pass: colors.pass, warn: colors.warn }

export default function StepRail({ steps, current, onStep }) {
  return (
    <nav aria-label="Steps" className="step-rail">
      {steps.map((step, index) => {
        const active = step.id === current
        return (
          <button
            key={step.id}
            onClick={() => onStep(step.id)}
            aria-current={active ? 'step' : undefined}
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', width: '100%',
              background: active ? colors.panel : 'transparent',
              borderWidth: 1, borderStyle: 'solid', borderColor: active ? colors.panelEdge : 'transparent',
              borderRadius: 8, padding: '10px 11px', cursor: 'pointer',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: mono, fontSize: 12,
                background: active ? colors.accent : 'transparent',
                color: active ? '#FFFFFF' : colors.mute,
                border: `1px solid ${active ? colors.accent : colors.faint}`,
              }}
            >
              {index + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{step.label}</span>
              <span style={{ display: 'block', fontFamily: sans, fontSize: 12, color: TONE[step.tone] ?? colors.mute, marginTop: 2 }}>{step.status}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
