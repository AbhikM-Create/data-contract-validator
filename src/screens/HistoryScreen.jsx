import { useState } from 'react'
import Staircase from '../components/Staircase.jsx'
import { leadFailingLayer } from '../lib/runRecord.js'
import { contractsInRuns, summariseRuns } from '../lib/runSummary.js'
import { LAYERS } from '../lib/validate.js'
import { go } from '../routes.js'
import { chip, colors, ghostButton, label, mono, panel, sans, secondaryButton } from '../theme.js'
import { ScreenHead } from './ValidateScreen.jsx'

const ORDER = LAYERS.map((layer) => layer.id)
const layerLabel = (id) => LAYERS.find((layer) => layer.id === id)?.label ?? id

// Your own runs, counted up. Everything here comes from records you created by
// checking files in this app — nothing polls, schedules, or watches a source.
export default function HistoryScreen({ runs = [], loading, error, signedIn, onRefresh }) {
  const [contractFilter, setContractFilter] = useState('all')
  const [openId, setOpenId] = useState(null)

  if (!signedIn) {
    return (
      <>
        <ScreenHead
          title="History"
          blurb="Every validation you run is recorded here — when it ran, which contract it used, which file it checked, and how each layer came out."
        />
        <div style={{ ...panel, padding: '24px 22px', marginTop: 20, maxWidth: 560 }}>
          <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>Sign in to keep a history</div>
          <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>
            Runs are saved to your account, so they need somewhere to belong. Signed out, checking a file still
            works — the result just lives as long as the page is open.
          </p>
          <button onClick={() => go('signin')} style={{ ...secondaryButton, marginTop: 14 }}>Sign in</button>
        </div>
      </>
    )
  }

  const visible = contractFilter === 'all'
    ? runs
    : runs.filter((run) => (run.contract_id ?? '__none__') === contractFilter)

  const stats = summariseRuns(visible, ORDER)
  const contracts = contractsInRuns(runs)

  return (
    <>
      <ScreenHead
        title="History"
        blurb="Files you have checked, and how each one came out. These are your own runs — this reads records, it does not watch anything."
        action={<button onClick={onRefresh} style={ghostButton}>Refresh</button>}
      />

      {error && <p style={{ fontFamily: sans, fontSize: 13, color: colors.fail, marginTop: 16 }}>{error}</p>}

      {loading && runs.length === 0 ? (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, marginTop: 18 }}>Loading your runs…</p>
      ) : runs.length === 0 ? (
        <div style={{ ...panel, padding: '24px 22px', marginTop: 20, maxWidth: 560 }}>
          <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>No runs yet</div>
          <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>
            Check a file and it appears here, with the verdict and the layer that caught it.
          </p>
          <button onClick={() => go('validate')} style={{ ...secondaryButton, marginTop: 14 }}>Validate a file</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
            <Tile name="Runs" value={stats.total} detail={contractFilter === 'all' ? 'all time' : 'for this contract'} />
            <Tile
              name="Passed"
              value={stats.passed}
              detail={stats.total ? `${Math.round((stats.passed / stats.total) * 100)}% of runs` : ''}
              tone={stats.passed > 0 ? colors.pass : null}
            />
            <Tile
              name="Failed"
              value={stats.failed}
              detail={stats.insufficient > 0 ? `${stats.insufficient} could not be judged` : 'files that broke something'}
              tone={stats.failed > 0 ? colors.fail : null}
            />
            <Tile
              name="Usually stops at"
              small
              value={stats.mostCommonFailingLayer
                ? layerLabel(stats.mostCommonFailingLayer)
                : stats.tiedFailingLayers.length > 0 ? 'Tied' : '—'}
              detail={stats.mostCommonFailingLayer
                ? `${stats.failingLayerCounts[stats.mostCommonFailingLayer]} of ${stats.failed} failures`
                : stats.tiedFailingLayers.length > 0
                  ? stats.tiedFailingLayers.map(layerLabel).join(' and ')
                  : 'nothing has failed yet'}
            />
          </div>

          {contracts.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <span style={label}>Contract</span>
              <select
                value={contractFilter}
                aria-label="filter by contract"
                onChange={(e) => { setContractFilter(e.target.value); setOpenId(null) }}
                style={{
                  background: colors.panel, border: `1px solid ${colors.panelEdge}`, borderRadius: 6,
                  color: colors.ink, fontFamily: sans, fontSize: 13, padding: '7px 9px', cursor: 'pointer',
                }}
              >
                <option value="all">All contracts ({runs.length})</option>
                {contracts.map((c) => (
                  <option key={c.key} value={c.key}>{c.name} ({c.count})</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ ...panel, marginTop: 16, overflow: 'hidden' }}>
            <div className="history-row" style={headerRow}>
              <span>When</span>
              <span>File checked</span>
              <span>Contract</span>
              <span>Caught by</span>
              <span style={{ textAlign: 'right' }}>Result</span>
            </div>

            {visible.map((run, index) => {
              const lead = leadFailingLayer(run, ORDER)
              const open = openId === run.id
              return (
                <div key={run.id}>
                  <button
                    onClick={() => setOpenId(open ? null : run.id)}
                    className="history-row"
                    style={{
                      ...bodyRow,
                      background: open ? colors.panelSunk : 'transparent',
                      borderTop: index === 0 ? 'none' : `1px solid ${colors.panelEdge}`,
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 11.5, color: colors.faint }}>{when(run.ran_at)}</span>
                    <span style={{ fontFamily: mono, fontSize: 12.5, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {run.candidate_name}
                    </span>
                    <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {run.contract_name ?? '—'}
                    </span>
                    <span style={{ fontFamily: sans, fontSize: 12.5, color: lead ? colors.ink : colors.faint }}>
                      {lead ? layerLabel(lead) : '—'}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span style={chip(run.status)}>{run.status}</span>
                    </span>
                  </button>

                  {open && <RunDetail run={run} />}
                </div>
              )
            })}
          </div>

          {visible.length === 0 && (
            <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, marginTop: 14 }}>No runs for that contract.</p>
          )}
        </>
      )}
    </>
  )
}

// A stored run drawn with the same staircase the live report used. The record
// holds each layer's status and how many findings it had, which is everything
// the staircase reads — so a run opened a month later reads as it did the
// moment it ran.
function RunDetail({ run }) {
  const layers = LAYERS.map((layer) => ({
    ...layer,
    status: run.layers?.[layer.id]?.status ?? 'SKIPPED',
    violations: Array.from({ length: run.layers?.[layer.id]?.violations ?? 0 }, () => ({})),
  }))

  return (
    <div style={{ padding: '4px 16px 20px', background: colors.panelSunk, borderTop: `1px solid ${colors.panelEdge}` }}>
      <Staircase layers={layers} title="How far that file got" note={`checked ${when(run.ran_at)}`} />

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 14 }}>
        <Fact name="Baseline" value={run.baseline_name ?? 'none — rules only'} />
        <Fact name="Rows" value={run.baseline_rows ? `${run.baseline_rows} → ${run.candidate_rows}` : `${run.candidate_rows ?? '—'}`} />
        <Fact name="Rules" value={run.rules_total ? `${run.rules_broken} of ${run.rules_total} broken` : 'none set'} />
      </div>

      {run.findings?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={label}>What was found</span>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {run.findings.map((finding, i) => (
              <li
                key={`${finding.code}-${finding.column}-${i}`}
                style={{
                  fontFamily: mono, fontSize: 11, color: colors.mute,
                  background: colors.panel, border: `1px solid ${colors.panelEdge}`,
                  borderRadius: 4, padding: '4px 8px',
                }}
              >
                {finding.code}{finding.column ? ` · ${finding.column}` : ''}
              </li>
            ))}
          </ul>
          {/* Said plainly, because someone will wonder why this is thinner than
              the live report was. */}
          <p style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint, lineHeight: 1.5, marginTop: 10, maxWidth: 620 }}>
            A saved run records what was found and where — never the values themselves. The figures in the live
            report stayed in your browser. Check the file again to see them.
          </p>
        </div>
      )}
    </div>
  )
}

function Tile({ name, value, detail, tone, small }) {
  return (
    <div style={{ ...panel, padding: '13px 16px', flex: '1 1 170px' }}>
      <div style={label}>{name}</div>
      <div
        style={{
          fontFamily: sans, fontSize: small ? 18 : 26, fontWeight: 650, lineHeight: 1.2,
          color: tone ?? colors.ink, marginTop: 7, letterSpacing: '-0.01em',
        }}
      >
        {value}
      </div>
      <div style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint, marginTop: 4 }}>{detail}</div>
    </div>
  )
}

function Fact({ name, value }) {
  return (
    <div>
      <div style={label}>{name}</div>
      <div style={{ fontFamily: sans, fontSize: 13, color: colors.ink, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function when(iso) {
  if (!iso) return '—'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

const headerRow = {
  ...label,
  padding: '10px 16px',
  background: colors.panelSunk,
  borderBottom: `1px solid ${colors.panelEdge}`,
}

const bodyRow = {
  width: '100%',
  border: 'none',
  padding: '11px 16px',
  cursor: 'pointer',
  textAlign: 'left',
  alignItems: 'center',
}
