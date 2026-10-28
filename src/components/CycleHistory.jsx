import { chip, colors, label, mono, panel, sans } from '../theme.js'

// Every check this object has had, newest first, each against the previous
// check of the same kind — "is Mock 3 better than Mock 2?" is the migration
// lead's question, and no single run answers it. Counts and rates only: a run
// keeps no key or value from the files (migrationObject.js).

const pct = (share) => (Number.isFinite(share) ? `${(share * 100).toFixed(share > 0.999 && share < 1 ? 2 : 1)}%` : '—')
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—')
const VERDICT = { PASS: 'PASS', FAIL: 'FAIL', READY: 'PASS', NOT_READY: 'FAIL', UNVERIFIED: 'UNCHECKED' }
const WORDS = { PASS: 'RECONCILED', FAIL: 'PROBLEM', READY: 'READY', NOT_READY: 'NOT READY', UNVERIFIED: 'NOT CONFIRMED' }

export default function CycleHistory({ rows }) {
  if (rows.length === 0) {
    return (
      <div style={{ ...panel, padding: 16, marginTop: 10 }}>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, margin: 0 }}>
          No checks yet. Each readiness check and reconciliation you run is added here with its wave and cycle, and saved in the object file.
        </p>
      </div>
    )
  }

  return (
    <div style={{ ...panel, padding: '6px 16px 10px', marginTop: 10, overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
        <thead>
          <tr>
            {['When', 'Cycle', 'Check', 'Result', 'Measure', 'Since last time', 'Detail'].map((h) => (
              <th key={h} style={{ ...label, textAlign: 'left', padding: '10px 12px 8px 0', borderBottom: `1px solid ${colors.panelEdge}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ run, metric, value, change, previousCycle }, i) => (
            <tr key={`${run.at}-${i}`} style={{ borderBottom: `1px solid ${colors.panelEdge}` }}>
              <td style={cell}>{when(run.at)}</td>
              <td style={cell}>{[run.wave, run.cycle].filter(Boolean).join(' · ') || '—'}</td>
              <td style={cell}>{run.kind === 'reconcile' ? 'Reconciliation' : 'Load readiness'}</td>
              <td style={cell}><span style={chip(VERDICT[run.status] ?? 'SKIPPED')}>{WORDS[run.status] ?? run.status}</span></td>
              <td style={{ ...cell, fontFamily: mono }}>
                {pct(value)} <span style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint }}>{metric === 'completeness' ? 'arrived' : 'accepted'}</span>
              </td>
              <td style={{ ...cell, fontFamily: mono, color: colors.mute }} title={previousCycle ? `against ${previousCycle}` : undefined}>
                {change === null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : '±'}${(Math.abs(change) * 100).toFixed(2)} pts`}
              </td>
              <td style={{ ...cell, fontSize: 12, color: colors.mute }}>{detail(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const cell = { fontFamily: sans, fontSize: 13, color: colors.ink, padding: '9px 12px 9px 0', verticalAlign: 'top' }

function detail(run) {
  const c = run.counts ?? {}
  if (run.kind === 'reconcile') {
    const parts = [`${fmt(c.matched)} of ${fmt(c.expected)} matched`]
    if (c.missing) parts.push(`${fmt(c.missing)} missing`)
    if (c.withDifferences) parts.push(`${fmt(c.withDifferences)} differ`)
    if (c.unmappedRecords) parts.push(`${fmt(c.unmappedRecords)} unmapped`)
    return parts.join(' · ')
  }
  const parts = [`${fmt(c.rejected)} of ${fmt(c.records)} rejected`]
  if (c.warned) parts.push(`${fmt(c.warned)} warned`)
  return parts.join(' · ')
}

function when(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
