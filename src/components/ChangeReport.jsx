import { useState } from 'react'
import { chip, colors, ghostButton, label, mono, panel, sans, statusColor, tint } from '../theme.js'
import Staircase from './Staircase.jsx'

// The change check's report. The staircase leads, as on every report: six
// steps drawn as a descent, so the eye lands on the step that caught the change
// and sees that the steps above it passed. Then one card per step, each finding
// with its first records, whose fix it is, and the full list one click away.

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—')
const PREVIEW = 5

// The verdict's colour comes from the step palette: allowed is a pass, not
// allowed a fail, and "not confirmed" the colour of something left unchecked.
const VERDICT = {
  ALLOWED: { tone: 'PASS', text: 'ALLOWED' },
  NOT_ALLOWED: { tone: 'FAIL', text: 'NOT ALLOWED' },
  UNVERIFIED: { tone: 'UNCHECKED', text: 'NOT CONFIRMED' },
  INVALID: { tone: 'SKIPPED', text: 'CANNOT RUN' },
}

const POLICY_WORDS = {
  preserve: 'must stay the same',
  free: 'may change freely',
  oneOf: 'one of a list',
  map: 'through a crosswalk',
  bounded: 'within limits',
  asApproved: 'as approved',
}

export default function ChangeReport({ report, stale }) {
  const verdict = VERDICT[report.status] ?? VERDICT.INVALID
  const steps = report.steps.map((step) => ({ ...step, violations: step.findings }))
  const lead = steps.find((s) => s.status === 'FAIL')
  const c = report.counts

  return (
    <div style={{ marginTop: 18 }}>
      <span style={chip(verdict.tone)}>{verdict.text}</span>
      <h3 style={{ fontFamily: sans, fontSize: 22, fontWeight: 650, color: colors.ink, margin: '8px 0 0' }}>{report.headline}</h3>
      {stale && (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.warn, margin: '6px 0 0' }}>
          Out of date — the contract or the files have changed since this ran. Check again to see the current answer.
        </p>
      )}

      {report.status === 'INVALID' ? (
        <ul style={{ margin: '12px 0 0', paddingLeft: 18 }}>
          {report.issues.map((issue) => <li key={issue} style={{ fontFamily: sans, fontSize: 14, color: colors.mute, marginTop: 4 }}>{issue}</li>)}
        </ul>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <Figure label="Records before" value={fmt(c.beforeRows)} />
            <Figure label="Records after" value={fmt(c.afterRows)} />
            <Figure label="In both" value={fmt(c.matched)} />
            <Figure label="Changed" value={fmt(c.changed)} note={`${fmt(c.unchanged)} unchanged`} />
            <Figure label="Broke the contract" value={fmt(c.withViolation)} />
            {c.unverified > 0 && <Figure label="Could not be confirmed" value={fmt(c.unverified)} />}
            <Figure label="Added" value={fmt(c.added)} />
            <Figure label="Removed" value={fmt(c.removed)} />
          </div>

          <Staircase layers={steps} title="How far the change got" subject="change" note="Each step asks something the one before it cannot" />

          {steps.map((step, index) => (
            <StepCard key={step.id} step={step} index={index} isLead={lead?.id === step.id} />
          ))}

          <Fields fields={report.fields} />

          {report.notChecked.length > 0 && (
            <section style={{ ...panel, padding: '14px 16px', marginTop: 10 }}>
              <h4 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: 0 }}>Not checked</h4>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {report.notChecked.map((line) => <li key={line} style={{ fontFamily: sans, fontSize: 14, color: colors.mute, marginTop: 3 }}>{line}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Figure({ label: title, value, note }) {
  return (
    <div style={{ ...panel, padding: '9px 12px', minWidth: 120 }}>
      <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 16, color: colors.ink, marginTop: 3 }}>{value}</div>
      {note && <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 2 }}>{note}</div>}
    </div>
  )
}

function StepCard({ step, index, isLead }) {
  const tone = statusColor[step.status] ?? colors.faint
  return (
    <section style={{ ...panel, borderColor: isLead ? tint(tone, '88') : colors.panelEdge, padding: '14px 16px', marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 12, color: colors.faint }}>{index + 1}</span>
        <h4 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: 0 }}>{step.label}</h4>
        <span style={{ fontFamily: sans, fontSize: 13, color: colors.faint, flex: 1, minWidth: 180 }}>{step.question}</span>
        <span style={chip(step.status)}>{step.status}</span>
      </div>
      {step.status === 'PASS' && step.findings.length === 0 && (
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, margin: '10px 0 0' }}>Nothing wrong here — on this step, the change kept to its contract.</p>
      )}
      {step.reason && <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, margin: '10px 0 0' }}>{step.reason}</p>}
      {step.findings.map((finding) => <Finding key={`${finding.code}:${finding.column ?? ''}`} finding={finding} />)}
    </section>
  )
}

function Finding({ finding }) {
  const [all, setAll] = useState(false)
  const shown = all ? finding.examples : finding.examples.slice(0, PREVIEW)
  const has = (field) => finding.examples.some((e) => e[field] !== undefined)
  const columns = ['key', ...['before', 'after', 'approved', 'reason'].filter(has)]
  const heading = { key: 'Record', before: 'Before', after: 'After', approved: 'Approved', reason: 'Why' }
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontFamily: sans, fontSize: 14, color: colors.ink, margin: 0 }}>{finding.message}</p>
      <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, margin: '3px 0 0' }}>
        Whose fix: <strong style={{ color: colors.ink, fontWeight: 600 }}>{finding.owner}</strong>
      </p>
      {shown.length > 0 && (
        <div tabIndex={0} style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ borderCollapse: 'collapse', fontFamily: mono, fontSize: 13 }}>
            <thead>
              <tr>{columns.map((c) => <th key={c} style={{ ...label, textAlign: 'left', padding: '4px 14px 4px 0' }}>{heading[c]}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((example, i) => (
                <tr key={`${example.key}-${i}`}>
                  {columns.map((c) => <td key={c} style={{ padding: '3px 14px 3px 0', color: c === 'reason' ? colors.mute : colors.ink, fontFamily: c === 'reason' ? sans : mono }}>{example[c] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {finding.examples.length > PREVIEW && (
        <button onClick={() => setAll(!all)} style={{ ...ghostButton, marginTop: 6 }}>
          {all ? 'Show fewer' : `Show all ${fmt(finding.examples.length)}${finding.count > finding.examples.length ? ` of ${fmt(finding.count)}` : ''}`}
        </button>
      )}
    </div>
  )
}

function Fields({ fields }) {
  if (fields.length === 0) return null
  const cols = [['compared', 'Compared'], ['unchanged', 'Unchanged'], ['allowed', 'Allowed'], ['notAllowed', 'Not allowed'], ['outOfLimits', 'Out of limits'], ['unverified', 'Unconfirmed']]
  return (
    <section style={{ ...panel, padding: '14px 16px', marginTop: 10 }}>
      <h4 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: 0 }}>Column by column</h4>
      <div tabIndex={0} style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: sans, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...label, textAlign: 'left', padding: '4px 14px 4px 0' }}>Column</th>
              <th style={{ ...label, textAlign: 'left', padding: '4px 14px 4px 0' }}>Contract</th>
              {cols.map(([, h]) => <th key={h} style={{ ...label, textAlign: 'right', padding: '4px 0 4px 14px' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.before}>
                <td style={{ fontFamily: mono, color: colors.ink, padding: '3px 14px 3px 0' }}>{f.before === f.after ? f.before : `${f.before} → ${f.after}`}</td>
                <td style={{ color: colors.mute, padding: '3px 14px 3px 0' }}>{f.implicit ? 'not named, so must stay the same' : POLICY_WORDS[f.policy] ?? f.policy}</td>
                {cols.map(([k]) => <td key={k} style={{ fontFamily: mono, textAlign: 'right', padding: '3px 0 3px 14px', color: (k === 'notAllowed' || k === 'outOfLimits') && f[k] > 0 ? colors.fail : colors.ink }}>{fmt(f[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
