import { chip, colors, mono, panel, primaryButton, sans, statusColor } from '../theme.js'

// Load readiness: which records the target will turn away, before the load.
// Records are counted, not rule failures — the question a load asks is how
// many records will not make it, and which.

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—')

// Readiness has its own verdicts; they borrow pass/fail colours only where
// they mean exactly that, and UNVERIFIED reads as a warning, never a pass.
const VERDICT = {
  READY: { text: 'READY TO LOAD', status: 'PASS' },
  NOT_READY: { text: 'NOT READY', status: 'FAIL' },
  UNVERIFIED: { text: 'NOT CONFIRMED', status: 'UNCHECKED' },
}

export default function ReadinessReport({ report, stale, onDownloadFixList }) {
  const verdict = VERDICT[report.status] ?? VERDICT.UNVERIFIED
  const c = report.counts

  return (
    <div style={{ marginTop: 18 }}>
      <span style={chip(verdict.status)}>{verdict.text}</span>
      <h3 style={{ fontFamily: sans, fontSize: 20, fontWeight: 650, color: colors.ink, margin: '8px 0 0' }}>{report.headline}</h3>
      {stale && (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.warn, margin: '6px 0 0' }}>
          The rules, the key or the file have changed since this ran — check again to see the current answer.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'stretch' }}>
        <Figure title="Records" value={fmt(c.records)} />
        <Figure title="Would be rejected" value={fmt(c.rejected)} tone={c.rejected > 0 ? colors.fail : null} />
        <Figure title="Load with a warning" value={fmt(c.warned)} />
        <Figure title="Clean" value={fmt(c.clean)} />
        {report.flaggedCount > 0 && (
          <button onClick={onDownloadFixList} style={{ ...primaryButton, fontSize: 13, alignSelf: 'center' }}>
            Download the fix list · {fmt(report.flaggedCount)} records
          </button>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        {report.checks.map((check, i) => <Check key={`${check.description}-${i}`} check={check} />)}
      </div>
    </div>
  )
}

function Figure({ title, value, tone }) {
  return (
    <div style={{ ...panel, padding: '9px 12px', minWidth: 128 }}>
      <div style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 17, color: tone ?? colors.ink, marginTop: 3 }}>{value}</div>
    </div>
  )
}

function Check({ check }) {
  const tone = statusColor[check.status] ?? colors.faint
  return (
    <div style={{ ...panel, borderLeftWidth: 3, borderLeftColor: tone, padding: '10px 14px', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: sans, fontSize: 14, color: colors.ink, flex: 1, minWidth: 220 }}>{check.description}</span>
        {/* Neutral on purpose: green and red belong to the verdict alone. */}
        <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.06em', color: colors.mute }}>
          {check.severity === 'warn' ? 'WARNING ONLY' : 'REJECTS'}
        </span>
        <span style={chip(check.status)}>{check.status}</span>
      </div>
      {check.status === 'FAIL' && (
        <div style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 4 }}>
          {fmt(check.failing)} of {fmt(check.applicable)} records
        </div>
      )}
      {check.reason && <div style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 4 }}>{check.reason}</div>}
      {check.examples.length > 0 && (
        <div style={{ fontFamily: mono, fontSize: 11.5, color: colors.faint, marginTop: 6 }}>
          {check.examples.map((ex) => `${ex.record}${ex.record.startsWith('row ') ? '' : ` (row ${ex.row})`}: ${ex.value}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

