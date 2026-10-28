import { useRef } from 'react'
import CycleHistory from '../components/CycleHistory.jsx'
import ReadinessReport from '../components/ReadinessReport.jsx'
import ReconReport from '../components/ReconReport.jsx'
import SpecBuilder from '../components/SpecBuilder.jsx'
import UploadCard from '../components/UploadCard.jsx'
import { CYCLES, cleanSpec, cycleHistory, suggestFieldPairs } from '../lib/migrationObject.js'
import { normalizeSpec, specIssues } from '../lib/reconcile.js'
import { colors, ghostButton, label, mono, panel, primaryButton, sans, secondaryButton } from '../theme.js'

// One migration object — employees, vendors, open items — and everything that
// assures it, in the order a cycle runs:
//
//   before the load   will the target accept this load file?   (readiness)
//   after the load    did every record arrive, correctly?       (reconciliation)
//   history           is this cycle better than the last?
//
// The object (its contract, spec and run history) is saved as one file the
// CLIs also read. The files themselves are read in this browser and never
// leave it.

export default function MigrationsScreen(props) {
  const {
    object, dirty, notice, files, recon, readiness, sessionRules,
    onChange, onOpenFile, onDownload, onNew, onSample,
    onLoadFile, onClearFile, onCrosswalk,
    onReconcile, onCheckReadiness, onDownloadFixList, onExportFinding,
    onUseSessionRules, onEditRules, onLoadContract, onDownloadEvidence,
  } = props

  const openInput = useRef(null)
  const contractInput = useRef(null)
  const spec = object.spec
  const sourceColumns = files.source?.columns ?? []
  const targetColumns = files.target?.columns ?? []
  const bothRead = files.source?.rowCount > 0 && files.target?.rowCount > 0
  const issues = bothRead ? specIssues(normalizeSpec(cleanSpec(spec)), sourceColumns, targetColumns) : []
  const suggestions = bothRead ? suggestFieldPairs(sourceColumns, targetColumns, [...spec.mapping, ...spec.key.source.map((s, i) => ({ source: s, target: spec.key.target[i] }))]) : []
  const targetKey = spec.key.target.filter(Boolean)
  const rules = object.contract.rules
  const evidenceReady = Boolean((readiness && !readiness.stale) || (recon && !recon.stale))
  const empty = !object.name && rules.length === 0 && object.runs.length === 0 && spec.mapping.length === 0

  return (
    <div>
      <h1 style={{ fontFamily: sans, fontSize: 26, fontWeight: 650, color: colors.ink, margin: 0 }}>Migrations</h1>
      <p style={{ fontFamily: sans, fontSize: 14.5, lineHeight: 1.55, color: colors.mute, margin: '8px 0 0', maxWidth: 760 }}>
        One migration object — employees, vendors, open items — checked the same way every cycle: before each load, whether
        the target will accept the file; after it, whether every record arrived and still says the same thing.
      </p>

      {/* --- the object --------------------------------------------------- */}
      <section style={{ ...panel, padding: 16, marginTop: 18 }}>
        <div style={label}>Migration object</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 }}>
          <input
            value={object.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Name this object — e.g. Employees"
            aria-label="object name"
            style={{ ...field(260), fontSize: 14 }}
          />
          <input value={object.wave} onChange={(e) => onChange({ wave: e.target.value })} placeholder="Wave" aria-label="wave" style={field(110)} />
          <select value={object.cycle} onChange={(e) => onChange({ cycle: e.target.value })} aria-label="cycle" style={{ ...field(160), cursor: 'pointer' }}>
            {[...new Set([...CYCLES, object.cycle])].map((cycle) => <option key={cycle} value={cycle}>{cycle}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <input ref={openInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) onOpenFile(e.target.files[0]); e.target.value = '' }} />
          <button onClick={() => openInput.current?.click()} style={secondaryButton}>Open a file</button>
          <button onClick={onDownload} style={secondaryButton}>Download{dirty ? ' · unsaved changes' : ''}</button>
          <button onClick={onNew} style={ghostButton}>New</button>
        </div>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, margin: '10px 0 0', lineHeight: 1.5 }}>
          The file holds this object’s rules, mapping spec and the results of every check — counts and verdicts, never a record
          from your data. The CLIs read the same file: <span style={{ fontFamily: mono }}>reconcile.mjs employees.migration.json …</span>
        </p>
        {notice && <Notice notice={notice} />}
        {empty && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: colors.panelSunk, borderRadius: 7, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink, flex: 1, minWidth: 240 }}>
              New here? Open a worked example: an employee migration in its second mock, with the files, rules and mapping already in place.
            </span>
            <button onClick={onSample} style={primaryButton}>Try the example migration</button>
          </div>
        )}
      </section>

      {/* --- before the load ---------------------------------------------- */}
      <Phase step="1" title="Before the load — will the target accept it?">
        The target’s rules, run against the load file before the load window. A rejection found now costs an edit; found after the
        load, it costs a re-extract, a re-transform and another load slot.
      </Phase>

      <div style={{ ...panel, padding: 14, marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={label}>Target rules</div>
          <div style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink, marginTop: 4 }}>
            {rules.length > 0
              ? `${rules.length} rule${rules.length === 1 ? '' : 's'}${object.contract.name ? ` from “${object.contract.name}”` : ''}`
              : 'No rules yet — write them on Contracts, or load a contract file.'}
          </div>
        </div>
        <input ref={contractInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) onLoadContract(e.target.files[0]); e.target.value = '' }} />
        {sessionRules.length > 0 && (
          <button onClick={onUseSessionRules} style={ghostButton}>Use the {sessionRules.length} rule{sessionRules.length === 1 ? '' : 's'} open on Contracts</button>
        )}
        <button onClick={() => contractInput.current?.click()} style={ghostButton}>Load a contract file</button>
        <button onClick={onEditRules} style={ghostButton}>{rules.length > 0 ? 'Edit on Contracts' : 'Write rules on Contracts'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 10 }}>
        <UploadCard
          step="1"
          title="Load file"
          tag="load file"
          hint="The transformed file about to be loaded into the target system."
          file={files.load}
          accent={colors.accent}
          onFile={(file) => onLoadFile('load', file)}
          onClear={() => onClearFile('load')}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <button
          onClick={onCheckReadiness}
          disabled={!(files.load?.rowCount > 0 && rules.length > 0)}
          style={{ ...primaryButton, opacity: files.load?.rowCount > 0 && rules.length > 0 ? 1 : 0.45, cursor: files.load?.rowCount > 0 && rules.length > 0 ? 'pointer' : 'default' }}
        >
          Check load readiness
        </button>
        {/* The target key is one setting, shared with the mapping spec below —
            the same column identifies a record in the load file and in the
            target. Offered here too, so checking a load file alone does not
            require reading both extracts first. */}
        {spec.key.target.length <= 1 && files.load?.rowCount > 0 ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>Each record is identified by</span>
            <select
              value={spec.key.target[0] ?? ''}
              onChange={(e) => onChange({ spec: { ...spec, key: { ...spec.key, target: [e.target.value] } } })}
              aria-label="record key"
              style={{ ...field(190), fontFamily: mono, cursor: 'pointer' }}
            >
              <option value="">(row number only)</option>
              {files.load.columns.map((column) => <option key={column} value={column}>{column}</option>)}
            </select>
            <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>
              {targetKey.length > 0 ? 'blank and repeated keys are predicted rejections' : 'choose one to check blank and repeated keys too'}
            </span>
          </label>
        ) : (
          <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint }}>
            {targetKey.length > 0
              ? <>Records are named by <span style={{ fontFamily: mono }}>{targetKey.join(' + ')}</span>; blank and repeated keys are predicted rejections.</>
              : 'Read a load file, then choose the column that identifies each record.'}
          </span>
        )}
      </div>
      {readiness && <ReadinessReport report={readiness.report} stale={readiness.stale} onDownloadFixList={onDownloadFixList} />}

      {/* --- after the load ----------------------------------------------- */}
      <Phase step="2" title="After the load — did it arrive whole?">
        The source extract and what the target holds now, matched record by record on their key. Which step the load stops on says
        whose problem it is: a mapping gap belongs to the functional team, a value changed in flight to the load.
      </Phase>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 10 }}>
        <UploadCard
          step="2"
          title="Source extract"
          tag="source"
          hint="The legacy system’s records — what should have moved."
          file={files.source}
          accent={colors.accent}
          onFile={(file) => onLoadFile('source', file)}
          onClear={() => onClearFile('source')}
        />
        <UploadCard
          step="3"
          title="Target extract"
          tag="target"
          hint="What the new system holds after the load."
          file={files.target}
          accent={colors.accent}
          onFile={(file) => onLoadFile('target', file)}
          onClear={() => onClearFile('target')}
        />
      </div>

      {bothRead ? (
        <>
          <SpecBuilder
            spec={spec}
            sourceColumns={sourceColumns}
            targetColumns={targetColumns}
            suggestions={suggestions}
            issues={issues}
            onChange={(next) => onChange({ spec: next })}
            onCrosswalk={onCrosswalk}
          />
          <div style={{ marginTop: 12 }}>
            <button
              onClick={onReconcile}
              disabled={issues.length > 0}
              style={{ ...primaryButton, opacity: issues.length > 0 ? 0.45 : 1, cursor: issues.length > 0 ? 'default' : 'pointer' }}
            >
              Reconcile
            </button>
          </div>
        </>
      ) : (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, marginTop: 10 }}>
          Read both extracts and the mapping spec appears here, its dropdowns filled with their columns.
        </p>
      )}
      {recon && <ReconReport report={recon.report} stale={recon.stale} onExport={onExportFinding} />}

      {/* --- evidence ------------------------------------------------------ */}
      <Phase step="3" title="Evidence for sign-off">
        One self-contained document for the people who sign this cycle off: the verdicts, the records behind them, the
        SHA-256 fingerprint of every file and of the rules and mapping, and a sign-off block. It quotes records from your
        files, so it is made in this page and never uploaded. Print it, or save it as PDF from the browser.
      </Phase>
      <div style={{ ...panel, padding: 14, marginTop: 10 }}>
        <EvidenceLine title="Before the load" state={readiness ? (readiness.stale ? 'stale' : 'current') : 'none'} />
        <EvidenceLine title="After the load" state={recon ? (recon.stale ? 'stale' : 'current') : 'none'} />
        <button
          onClick={onDownloadEvidence}
          disabled={!evidenceReady}
          style={{ ...primaryButton, marginTop: 12, opacity: evidenceReady ? 1 : 0.45, cursor: evidenceReady ? 'pointer' : 'default' }}
        >
          Download the evidence pack
        </button>
      </div>

      {/* --- history ------------------------------------------------------- */}
      <Phase step="4" title="Cycle by cycle">
        Every check on this object, newest first, against the previous check of the same kind.
      </Phase>
      <CycleHistory rows={cycleHistory(object.runs)} />
    </div>
  )
}

const field = (width) => ({
  width,
  background: colors.ground,
  border: `1px solid ${colors.panelEdge}`,
  borderRadius: 6,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
})

function Phase({ step, title, children }) {
  return (
    <div style={{ marginTop: 34 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent }}>{step}</span>
        <h2 style={{ fontFamily: sans, fontSize: 19, fontWeight: 650, color: colors.ink, margin: 0 }}>{title}</h2>
      </div>
      <p style={{ fontFamily: sans, fontSize: 13.5, lineHeight: 1.55, color: colors.mute, margin: '6px 0 0', maxWidth: 760 }}>{children}</p>
    </div>
  )
}

const EVIDENCE_STATE = {
  current: { text: 'included — its result matches the files and definitions on screen', color: colors.ink },
  stale: { text: 'left out — something changed since it ran; run it again to include it', color: colors.warn },
  none: { text: 'not run — the pack will say so', color: colors.faint },
}

function EvidenceLine({ title, state }) {
  const s = EVIDENCE_STATE[state]
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 4 }}>
      <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: colors.ink, width: 130 }}>{title}</span>
      <span style={{ fontFamily: sans, fontSize: 13, color: s.color }}>{s.text}</span>
    </div>
  )
}

function Notice({ notice }) {
  const tone = notice.tone === 'bad' ? colors.fail : notice.tone === 'warn' ? colors.warn : colors.accent
  return (
    <div style={{ marginTop: 12, padding: '9px 12px', borderLeft: `3px solid ${tone}`, background: colors.panelSunk, borderRadius: 4 }}>
      <div style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>{notice.text}</div>
      {notice.details?.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {notice.details.map((d) => <li key={d} style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>{d}</li>)}
        </ul>
      )}
    </div>
  )
}
