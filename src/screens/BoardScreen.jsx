import { useState } from 'react'
import { buildBoard } from '../lib/board.js'
import { parseMigrationObjectFile } from '../lib/migrationObject.js'
import { RECON_STEPS } from '../lib/reconcile.js'
import { STATE_WORDS } from '../lib/orgRecords.js'
import { go } from '../routes.js'
import { boardSampleObjects } from '../samples/boardSample.js'
import { colors, ghostButton, label, mono, panel, sans, secondaryButton } from '../theme.js'
import { ScreenHead } from './ValidateScreen.jsx'

// The readiness board: every object's latest cycle in one view, for the
// go/no-go meeting. It reads the run summaries the objects store — counts,
// rates and verdicts — so the object files are all it needs; they are read
// in this page. With an organisation, sign-off is part of every verdict.
export default function BoardScreen({ currentObject, signoff }) {
  const [loaded, setLoaded] = useState([])
  const [problems, setProblems] = useState([])
  const [example, setExample] = useState(false)
  const [includeSignoff, setIncludeSignoff] = useState(true)

  const openFiles = async (fileList) => {
    const next = [...loaded]
    const issues = []
    for (const file of fileList) {
      const opened = parseMigrationObjectFile(await file.text())
      if (opened.error) { issues.push(`${file.name}: ${opened.error}`); continue }
      // The same object loaded again replaces the earlier copy.
      const at = next.findIndex((o) => o.name === opened.object.name)
      if (at >= 0) next[at] = opened.object
      else next.push(opened.object)
    }
    setLoaded(next)
    setProblems(issues)
  }

  const inSession = currentObject?.name && currentObject.runs?.length && !loaded.some((o) => o.name === currentObject.name) ? [currentObject] : []
  const objects = example ? boardSampleObjects() : [...inSession, ...loaded]
  const withSignoff = !example && includeSignoff && Boolean(signoff?.active)
  const board = objects.length ? buildBoard(objects, withSignoff ? { submissions: signoff.submissions } : {}) : null

  return (
    <>
      <ScreenHead
        title="Readiness board"
        blurb="Every migration object’s latest cycle in one view, for the go/no-go meeting. An object is ready only when both checks ran in its cycle and passed — anything that did not run, or could not confirm, is not confirmed, never ready."
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
        <label style={{ ...secondaryButton, display: 'inline-block' }}>
          Add migration objects (.migration.json)
          <input type="file" accept=".json,application/json" multiple onChange={(e) => { setExample(false); openFiles([...(e.target.files ?? [])]); e.target.value = '' }} style={{ display: 'none' }} />
        </label>
        <button onClick={() => setExample(!example)} style={ghostButton}>{example ? 'Back to your objects' : 'Show an example programme'}</button>
        {loaded.length > 0 && !example && <button onClick={() => setLoaded([])} style={ghostButton}>Clear</button>}
        {signoff?.active && !example && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: sans, fontSize: 13, color: colors.ink, marginLeft: 'auto' }}>
            <input type="checkbox" checked={includeSignoff} onChange={(e) => setIncludeSignoff(e.target.checked)} />
            Include sign-off from {signoff.active.name}
          </label>
        )}
      </div>
      <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 8 }}>
        Object files are read in this page and not uploaded. Pipelines add their checks to an object with <code style={{ fontFamily: mono }}>dcv check --record</code> and <code style={{ fontFamily: mono }}>dcv reconcile --record</code>; <code style={{ fontFamily: mono }}>dcv board</code> prints this board in a pipeline.
      </p>
      {problems.map((p) => <p key={p} style={{ fontFamily: sans, fontSize: 13, color: colors.fail, marginTop: 6 }}>{p}</p>)}
      {example && <p style={{ fontFamily: sans, fontSize: 13, color: colors.accent, marginTop: 8 }}>Example programme: Employees is the example migration’s real result; the other two objects are invented.</p>}

      {!board ? (
        <div style={{ ...panel, padding: '22px 22px', marginTop: 18, maxWidth: 640 }}>
          <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>No objects on the board yet</div>
          <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>
            Add the migration objects of your programme, or run a check on Migrations and come back — the object open there joins the board.
          </p>
          <button onClick={() => go('migrations')} style={{ ...secondaryButton, marginTop: 12 }}>Go to Migrations</button>
        </div>
      ) : (
        <Board board={board} />
      )}
    </>
  )
}

const TONE = { GO: colors.pass, NO_GO: colors.fail, NOT_CONFIRMED: colors.warn }
const WORD = { GO: 'Ready', NO_GO: 'No-go', NOT_CONFIRMED: 'Not confirmed' }
const pct = (share) => (Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : '—')
const points = (change) => (Number.isFinite(change) && Math.abs(change) >= 0.0005 ? `${change > 0 ? '+' : '−'}${(Math.abs(change) * 100).toFixed(1)} pts` : null)

function Board({ board }) {
  return (
    <>
      <div style={{ ...panel, marginTop: 18, padding: '16px 18px', borderLeftWidth: 4, borderLeftColor: TONE[board.verdict] }}>
        <div style={label}>The programme</div>
        <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 650, color: TONE[board.verdict], marginTop: 4 }}>
          {board.verdict === 'GO' && board.withSignoff ? 'Go' : WORD[board.verdict]}
        </div>
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.ink, margin: '6px 0 0' }}>{sentence(board.headline)}</p>
        <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
          {['NO_GO', 'NOT_CONFIRMED', 'GO'].map((v) => (
            <span key={v} style={{ fontFamily: sans, fontSize: 13, color: colors.mute }}>
              <b style={{ color: board.counts[v] ? TONE[v] : colors.faint }}>{board.counts[v]}</b> {WORD[v].toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div style={{ ...panel, marginTop: 14, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead>
            <tr>
              {['Object', 'Before the load', 'After the load', ...(board.withSignoff ? ['Sign-off'] : []), 'Verdict'].map((h) => (
                <th key={h} style={{ ...label, textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${colors.panelEdge}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.name} style={{ verticalAlign: 'top' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{row.name}</div>
                  <div style={{ color: colors.faint, fontSize: 12 }}>{[row.wave, row.cycle].filter(Boolean).join(' · ')}</div>
                </td>
                <td style={td}>
                  {row.readiness.ran ? (
                    <>
                      <div>{row.readiness.status === 'READY' ? 'Ready to load' : row.readiness.status === 'NOT_READY' ? 'Not ready' : 'Not confirmed'}</div>
                      <div style={sub}>{pct(row.readiness.acceptance)} accepted{points(row.readiness.change) ? ` (${points(row.readiness.change)} on ${row.readiness.previousCycle})` : ''}</div>
                    </>
                  ) : <span style={{ color: colors.faint }}>Not run this cycle</span>}
                </td>
                <td style={td}>
                  {row.reconciliation.ran ? (
                    <>
                      <div>{row.reconciliation.status === 'PASS' ? 'Reconciled' : `Stopped at ${RECON_STEPS.find((s) => s.id === row.reconciliation.stoppedAt)?.label ?? '—'}`}</div>
                      <div style={sub}>{pct(row.reconciliation.completeness)} arrived{points(row.reconciliation.change) ? ` (${points(row.reconciliation.change)} on ${row.reconciliation.previousCycle})` : ''}</div>
                    </>
                  ) : <span style={{ color: colors.faint }}>Not run this cycle</span>}
                </td>
                {board.withSignoff && (
                  <td style={td}>
                    {row.signoff.state === 'none' ? <span style={{ color: colors.faint }}>Not submitted</span> : (
                      <>
                        <div>{STATE_WORDS[row.signoff.state]}</div>
                        <div style={{ ...sub, fontFamily: mono }}>{row.signoff.reference}</div>
                      </>
                    )}
                  </td>
                )}
                <td style={td}>
                  <div style={{ fontWeight: 650, color: TONE[row.verdict] }}>{WORD[row.verdict]}</div>
                  {row.reasons.map((r) => <div key={r} style={sub}>{r}</div>)}
                  {row.signoff?.withExceptions && <div style={sub}>accepted with exceptions</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// The headline leads with the verdict for the command line; here the verdict
// is already the title above it.
const sentence = (headline) => headline.replace(/^(No-go|Go|Not confirmed): (\w)/, (_, _verdict, first) => first.toUpperCase())

const td = { fontFamily: sans, fontSize: 13, color: colors.ink, padding: '10px 12px', borderBottom: `1px solid ${colors.panelSunk}` }
const sub = { fontFamily: sans, fontSize: 12, color: colors.mute, marginTop: 2 }
