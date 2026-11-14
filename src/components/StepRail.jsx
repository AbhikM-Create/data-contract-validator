import { colors, mono, sans } from '../theme.js'

// The workspace's steps, as one floating switcher: where you are, and how each
// step stands.
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
              display: 'flex', gap: 11, alignItems: 'center', textAlign: 'left', width: '100%', minWidth: 0,
              background: active ? colors.panel : 'transparent',
              borderWidth: 1, borderStyle: 'solid', borderColor: active ? 'var(--card-edge)' : 'transparent',
              boxShadow: active ? 'var(--elevation-chip)' : 'none',
              borderRadius: 12, padding: '10px 12px', cursor: 'pointer', minHeight: 56,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: mono, fontSize: 12, fontWeight: 600,
                background: active ? colors.accent : 'var(--disc)',
                color: active ? colors.onSolid : colors.mute,
                border: `1px solid ${active ? colors.accent : 'var(--disc-edge)'}`,
              }}
            >
              {index + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: sans, fontSize: 14, fontWeight: active ? 700 : 600, color: colors.ink }}>{step.label}</span>
              <span style={{ display: 'block', fontFamily: sans, fontSize: 12, fontWeight: step.tone ? 600 : 400, color: TONE[step.tone] ?? colors.mute, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.status}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
