import { describeRule, ruleKey } from '../lib/rules.js'
import { colors, ghostButton, mono, panel, sans, statusColor } from '../theme.js'

// Results for the rules a human authored, reported RULE BY RULE rather than by
// layer — an author thinks in the requirements they wrote, not in the engine's
// categories. Passing rules are listed too: "which of my rules actually ran" is
// the first thing anyone asks of a contract.
export default function RuleResults({ outcomes, onRemove }) {
  if (outcomes.length === 0) return null

  return (
    <div>
      {outcomes.map(({ rule, status, applicable, failures, violation }) => {
        const tone = status === 'FAIL' ? colors.fail : status === 'UNCHECKED' ? colors.warn : colors.pass
        return (
          <div
            key={ruleKey(rule)}
            style={{
              ...panel,
              // Longhand only: setting `border` (from panel) and `borderLeft`
              // together makes React drop one of them on re-render.
              borderColor: status === 'FAIL' ? `${tone}88` : colors.panelEdge,
              borderLeftWidth: 3,
              borderLeftColor: tone,
              padding: '12px 14px',
              marginTop: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: sans, fontSize: 14, color: colors.ink, flex: 1, minWidth: 220 }}>
                {describeRule(rule)}
              </span>
              <span
                style={{
                  fontFamily: mono, fontSize: 10.5, letterSpacing: '0.08em', color: tone,
                  border: `1px solid ${tone}66`, borderRadius: 5, padding: '2px 7px',
                }}
              >
                {status}
              </span>
              {onRemove && (
                <button onClick={() => onRemove(rule)} style={{ ...ghostButton, fontSize: 11 }}>remove</button>
              )}
            </div>

            {status === 'PASS' && (
              <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>
                {applicable === 0
                  ? 'No rows met the condition, so nothing was tested against this rule.'
                  : `Held for all ${applicable.toLocaleString('en-US')} row${applicable === 1 ? '' : 's'} it applies to.`}
              </p>
            )}

            {violation && (
              <>
                <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.55, color: colors.ink, marginTop: 8 }}>
                  {violation.message}
                </p>
                <div style={{ fontFamily: mono, fontSize: 11.5, color: colors.faint, marginTop: 6 }}>
                  {violation.evidence}
                </div>
              </>
            )}

            {status === 'FAIL' && failures.length > 0 && (
              <div style={{ fontFamily: mono, fontSize: 11, color: colors.faint, marginTop: 4 }}>
                {failures.length.toLocaleString('en-US')} of {applicable.toLocaleString('en-US')} rows checked
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// A compact verdict for one half of the report, used above both sections so the
// two kinds of finding can be compared at a glance.
export function ResultTile({ title, subtitle, status, detail }) {
  const tone = statusColor[status] ?? colors.faint
  const decided = status === 'PASS' || status === 'FAIL'

  return (
    <div
      style={{
        ...panel,
        borderLeftWidth: 3,
        borderLeftColor: decided ? tone : colors.panelEdge,
        padding: '14px 16px',
        flex: '1 1 260px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: colors.ink }}>{title}</div>
        <div style={{ fontFamily: sans, fontSize: 13, color: colors.mute, marginTop: 4 }}>{detail}</div>
        <div style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{subtitle}</div>
      </div>
      {/* The verdict is what a reader scans for, so it is sized to be found
          rather than tucked into a corner. */}
      <span
        style={{
          fontFamily: sans, fontSize: decided ? 15 : 11.5, fontWeight: 700,
          letterSpacing: decided ? '0.02em' : '0.06em',
          color: tone, whiteSpace: 'nowrap',
        }}
      >
        {status}
      </span>
    </div>
  )
}
