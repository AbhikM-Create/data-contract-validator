import { useState } from 'react'
import { findingTable } from '../lib/findingTable.js'
import { chip, colors, ghostButton, label, mono, panel, sans, statusColor } from '../theme.js'
import Staircase from './Staircase.jsx'

// The reconciliation report. The staircase leads, as it does on Validate: the
// five steps drawn as a descent, so the eye lands on the step that caught the
// load and sees that the steps above it passed. Then one card per step, each
// finding with its first records — and the full list one click away, because
// a data owner fixes records, not sentences.

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—')
const PREVIEW = 5

export default function ReconReport({ report, stale, onExport }) {
  const steps = report.steps.map((step) => ({ ...step, violations: step.findings }))
  const lead = steps.find((s) => s.status === 'FAIL')
  const c = report.counts

  return (
    <div style={{ marginTop: 18 }}>
      <span style={chip(report.status)}>{report.status === 'PASS' ? 'RECONCILED' : 'PROBLEM FOUND'}</span>
      <h3 style={{ fontFamily: sans, fontSize: 20, fontWeight: 650, color: colors.ink, margin: '8px 0 0' }}>{report.headline}</h3>
      {stale && (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.warn, margin: '6px 0 0' }}>
          The spec or the files have changed since this ran — reconcile again to see the current answer.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        <Figure label="Source records" value={fmt(c.sourceRows)} note={c.sourceOutOfScope ? `${fmt(c.sourceOutOfScope)} out of scope` : null} />
        <Figure label="In scope" value={fmt(c.expected)} />
        <Figure label="Matched one to one" value={fmt(c.matched)} />
        <Figure label="Missing from target" value={fmt(c.missing)} />
        <Figure label="Not in source" value={fmt(c.extra)} />
        <Figure label="Matched, but differ" value={fmt(c.rowsWithDifference)} />
      </div>

      <Staircase layers={steps} title="How far the load got" subject="load" note="Each step is meaningless if the one above it broke" />

      {steps.map((step, index) => (
        <StepCard key={step.id} step={step} index={index} isLead={lead?.id === step.id} report={report} onExport={onExport} />
      ))}
    </div>
  )
}

function Figure({ label: title, value, note }) {
  return (
    <div style={{ ...panel, padding: '9px 12px', minWidth: 128 }}>
      <div style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 17, color: colors.ink, marginTop: 3 }}>{value}</div>
      {note && <div style={{ fontFamily: sans, fontSize: 11, color: colors.faint, marginTop: 2 }}>{note}</div>}
    </div>
  )
}

function StepCard({ step, index, isLead, report, onExport }) {
  const tone = statusColor[step.status] ?? colors.faint
  return (
    <section style={{ ...panel, borderColor: isLead ? `${tone}88` : colors.panelEdge, padding: '14px 16px', marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>{index + 1}</span>
        <h4 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: 0 }}>{step.label}</h4>
        <span style={{ fontFamily: sans, fontSize: 13, color: colors.faint, flex: 1, minWidth: 180 }}>{step.question}</span>
        <span style={chip(step.status)}>{step.status}</span>
      </div>
      {step.status === 'PASS' && (
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, margin: '10px 0 0' }}>Nothing wrong here — on this step, the load matches its source.</p>
      )}
      {step.status === 'SKIPPED' && step.reason && (
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, margin: '10px 0 0' }}>{step.reason}</p>
      )}
      {step.findings.map((finding, i) => (
        <Finding key={`${finding.code}-${finding.column ?? ''}-${i}`} finding={finding} tone={tone} report={report} onExport={onExport} />
      ))}
    </section>
  )
}

function Finding({ finding, tone, report, onExport }) {
  const [open, setOpen] = useState(false)
  const table = findingTable(finding, report)
  const rows = table ? (open ? table.rows : table.rows.slice(0, PREVIEW)) : []

  return (
    <div style={{ background: colors.panelSunk, border: `1px solid ${colors.panelEdge}`, borderLeft: `2px solid ${tone}`, borderRadius: 6, padding: '10px 12px', marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: tone }}>{finding.code}</span>
        {finding.column && <span style={{ fontFamily: mono, fontSize: 11, color: colors.accent }}>{finding.column}</span>}
      </div>
      <p style={{ fontFamily: sans, fontSize: 13.5, lineHeight: 1.55, color: colors.ink, margin: '6px 0 0' }}>{finding.message}</p>

      {table && (
        <>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ borderCollapse: 'collapse', fontFamily: mono, fontSize: 12, minWidth: 260 }}>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column} style={{ ...label, textAlign: 'left', padding: '4px 14px 4px 0', borderBottom: `1px solid ${colors.panelEdge}` }}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, k) => (
                      <td key={k} style={{ padding: '4px 14px 4px 0', color: colors.ink, whiteSpace: 'nowrap' }}>
                        {cell === '' || cell === null || cell === undefined ? <span style={{ color: colors.faint }}>(blank)</span> : String(typeof cell === 'number' ? fmtCell(cell) : cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            {table.rows.length > PREVIEW && (
              <button onClick={() => setOpen(!open)} style={ghostButton}>
                {open ? 'Show fewer' : `Show all ${fmt(table.shown)}`}
              </button>
            )}
            <button onClick={() => onExport(finding)} style={ghostButton}>Download as CSV</button>
            <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>
              {table.shown < table.total
                ? `The first ${fmt(table.shown)} of ${fmt(table.total)}, in file order. For every one, run the CLI on these files.`
                : `All ${fmt(table.total)}.`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function fmtCell(n) {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
