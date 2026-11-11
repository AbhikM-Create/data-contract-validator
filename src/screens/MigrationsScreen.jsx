import { useRef } from 'react'
import ColumnMatcher from '../components/ColumnMatcher.jsx'
import ConfirmButton from '../components/ConfirmButton.jsx'
import CycleHistory from '../components/CycleHistory.jsx'
import FormatPicker from '../components/FormatPicker.jsx'
import SignoffForm from '../components/SignoffForm.jsx'
import PackPicker, { PackGuide } from '../components/PackPicker.jsx'
import ReadinessReport from '../components/ReadinessReport.jsx'
import ReconReport from '../components/ReconReport.jsx'
import SpecBuilder from '../components/SpecBuilder.jsx'
import UploadCard from '../components/UploadCard.jsx'
import { expectedColumns } from '../lib/columnMap.js'
import { SENSITIVITIES, suggestTag } from '../lib/masking.js'
import { ownersOf } from '../lib/signoff.js'
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
    onChange, onOpenFile, onDownload, onNew, onSample, onStartFromPack,
    onLoadFile, onClearFile, onCrosswalk,
    onReconcile, onCheckReadiness, onDownloadFixList, onExportFinding,
    onUseSessionRules, onEditRules, onLoadContract, onDownloadEvidence, onFormat, onWorkbook, unmask, onUnmask, onColumnMap, onShare,
  } = props
  // Column matching: what the definitions read from each file, and which of
  // the file's columns stands for it (columnMap.js).
  const expected = expectedColumns(object)
  const columnMap = object.columnMap ?? {}
  const matcher = (role, what) => (
    <ColumnMatcher what={what} expected={expected[role] ?? []} file={files[role]} map={columnMap[role] ?? {}} onChange={(map) => onColumnMap(role, map)} />
  )
  const formats = object.formats ?? { load: {}, source: {}, target: {} }

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
  // The reference files this object's rules name — one card each, no declaring.
  const referenceNames = [...new Set(rules.filter((r) => r.kind === 'reference' && r.target?.file).map((r) => r.target.file))]
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
          <button onClick={onShare} disabled={empty} title="A copy safe to send: definitions and counts, no file names, no key maps, no sign-off" style={{ ...secondaryButton, opacity: empty ? 0.45 : 1, cursor: empty ? 'default' : 'pointer' }}>Share definitions</button>
          <ConfirmButton
            needsConfirm={dirty || !empty}
            question={dirty
              ? `Start a new object? “${object.name || 'This object'}” has changes you haven’t downloaded — they will be lost.`
              : `Start a new object? “${object.name || 'This object'}” is cleared from this page.`}
            confirmLabel="Start a new object"
            onConfirm={onNew}
          >
            New
          </ConfirmButton>
        </div>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, margin: '10px 0 0', lineHeight: 1.5 }}>
          The file holds this object’s rules, mapping spec and the results of every check — counts and verdicts, never a record
          from your data. The command line reads the same file: <span style={{ fontFamily: mono }}>dcv reconcile employees.migration.json …</span>
        </p>
        <PackPicker needsConfirm={dirty || !empty} onStart={onStartFromPack} />
        {notice && <Notice notice={notice} />}
        {object.pack && <PackGuide packRef={object.pack} />}
        {empty && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: colors.panelSunk, borderRadius: 7, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink, flex: 1, minWidth: 240 }}>
              New here? Open a worked example, with the files, rules and mapping already in place: an opening trial balance moving
              from Tally to Zoho Books, or an employee migration in its second mock.
            </span>
            <button onClick={() => onSample('finance')} style={primaryButton}>Try the finance example</button>
            <button onClick={() => onSample('employees')} style={secondaryButton}>Try the example migration</button>
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
        <div>
        <UploadCard
          step="1"
          title="Load file"
          tag="load file"
          hint="The transformed file about to be loaded into the target system."
          file={files.load}
          accent={colors.accent}
          onFile={(file) => onLoadFile('load', file)}
          onClear={() => onClearFile('load')}
          onWorkbook={(choice) => onWorkbook('load', choice)}
        />
        <FormatPicker format={formats.load ?? {}} onChange={(format) => onFormat('load', format)} />
        {matcher('load', 'load file')}
        </div>
        {referenceNames.map((name) => (
          <div key={name}>
          <UploadCard
            step="1"
            title={`Reference file “${name}”`}
            tag={`reference: ${name}`}
            hint={`The file the rules call “${name}” — every value they check must exist in it. Read here like the load file; never stored.`}
            file={files[`reference:${name}`]}
            accent={colors.accent}
            onFile={(file) => onLoadFile(`reference:${name}`, file)}
            onClear={() => onClearFile(`reference:${name}`)}
            onWorkbook={(choice) => onWorkbook(`reference:${name}`, choice)}
          />
          {matcher(`reference:${name}`, `reference file “${name}”`)}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <button
          onClick={onCheckReadiness}
          disabled={!(files.load?.rowCount > 0 && rules.length > 0)}
          style={{ ...primaryButton, opacity: files.load?.rowCount > 0 && rules.length > 0 ? 1 : 0.45, cursor: files.load?.rowCount > 0 && rules.length > 0 ? 'pointer' : 'default' }}
        >
          Check load readiness
        </button>
        {!(files.load?.rowCount > 0 && rules.length > 0) && (
          <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint }}>
            {rules.length === 0 && !(files.load?.rowCount > 0)
              ? 'Needs the target rules and a load file.'
              : rules.length === 0 ? 'Needs the target rules — write them on Contracts or load a contract file.' : 'Needs a load file.'}
          </span>
        )}
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
      {readiness && <ReadinessReport report={readiness.report} stale={readiness.stale} onDownloadFixList={onDownloadFixList} owner={ownersOf(object).readiness} />}

      {/* --- after the load ----------------------------------------------- */}
      <Phase step="2" title="After the load — did it arrive whole?">
        The source extract and what the target holds now, matched record by record on their key. Which step the load stops on says
        whose problem it is: a mapping gap belongs to the functional team, a value changed in flight to the load.
      </Phase>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 10 }}>
        <div>
        <UploadCard
          step="2"
          title="Source extract"
          tag="source"
          hint="The legacy system’s records — what should have moved."
          file={files.source}
          accent={colors.accent}
          onFile={(file) => onLoadFile('source', file)}
          onClear={() => onClearFile('source')}
          onWorkbook={(choice) => onWorkbook('source', choice)}
        />
        <FormatPicker format={formats.source ?? {}} onChange={(format) => onFormat('source', format)} />
        {matcher('source', 'source extract')}
        </div>
        <div>
        <UploadCard
          step="3"
          title="Target extract"
          tag="target"
          hint="What the new system holds after the load."
          file={files.target}
          accent={colors.accent}
          onFile={(file) => onLoadFile('target', file)}
          onClear={() => onClearFile('target')}
          onWorkbook={(choice) => onWorkbook('target', choice)}
        />
        <FormatPicker format={formats.target ?? {}} onChange={(format) => onFormat('target', format)} />
        {matcher('target', 'target extract')}
        </div>
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
            {issues.length > 0 && (
              <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginLeft: 12 }}>
                Fix the {issues.length === 1 ? 'issue' : `${issues.length} issues`} in the mapping spec above first.
              </span>
            )}
          </div>
        </>
      ) : (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, marginTop: 10 }}>
          Read both extracts and the mapping spec appears here, its dropdowns filled with their columns.
        </p>
      )}
      {recon && <ReconReport report={recon.report} stale={recon.stale} onExport={onExportFinding} owners={ownersOf(object)} />}

      {/* --- evidence ------------------------------------------------------ */}
      <Phase step="3" title="Evidence for sign-off">
        One self-contained document for the people who sign this cycle off: the verdicts, the records behind them, the
        SHA-256 fingerprint of every file and of the rules and mapping, and a sign-off block. It quotes records from your
        files, so it is made in this page and never uploaded. Print it, or save it as PDF from the browser.
      </Phase>
      <SensitiveFields
        tags={object.tags ?? {}}
        columns={[...new Set(Object.values(files).filter(Boolean).flatMap((f) => f.columns ?? []))]}
        onChange={(tags) => onChange({ tags })}
      />
      <SignoffForm object={object} files={files} readiness={readiness} recon={recon} onChange={onChange} />
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
        {Object.keys(object.tags ?? {}).length > 0 && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, cursor: 'pointer', maxWidth: 760 }}>
            <input type="checkbox" checked={unmask} onChange={(e) => onUnmask(e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
              Show tagged values unmasked in the next evidence pack, fix list and export
              <span style={{ display: 'block', fontSize: 12, color: unmask ? colors.warn : colors.faint }}>
                {unmask
                  ? 'Unmasked: the pack will say it contains unmasked personal data, and the fix list is named …-UNMASKED. Aadhaar stays masked.'
                  : 'Masked by default: identifiers show their last 4 characters, personal and pay values show as [masked]. Keys, counts and totals always show.'}
              </span>
            </span>
          </label>
        )}
        {!evidenceReady && (
          <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginLeft: 12 }}>
            {readiness || recon
              ? 'Every result has changed since it ran — run a check again to include it.'
              : 'Run a check first: only results that match the files on screen go in.'}
          </span>
        )}
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

// Which fields are sensitive: a tag per column, saved with the object, applied
// wherever a value leaves the page. Proposed from the column name; the person
// decides. On screen, values stay visible — these are the person's own files.
function SensitiveFields({ tags, columns, onChange }) {
  const all = [...new Set([...columns, ...Object.keys(tags)])]
  if (all.length === 0) return null
  const set = (column, tag) => {
    const next = { ...tags }
    if (tag) next[column] = tag
    else delete next[column]
    onChange(next)
  }
  const proposals = all.filter((c) => !tags[c] && suggestTag(c))
  return (
    <div style={{ ...panel, padding: 14, marginTop: 10 }}>
      <div style={label}>Sensitive fields</div>
      <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, margin: '6px 0 10px', lineHeight: 1.5, maxWidth: 760 }}>
        Tagged values are masked in the evidence pack, the fix list and exported findings. Tags are saved with the object — column
        names only, never a value. This supports the masking safeguard; it does not by itself make anyone DPDP compliant.
      </p>
      {proposals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.ink }}>
            Suggested from the column names: {proposals.map((c) => `${c} (${suggestTag(c)})`).join(', ')}
          </span>
          <button onClick={() => onChange({ ...tags, ...Object.fromEntries(proposals.map((c) => [c, suggestTag(c)])) })} style={ghostButton}>
            Tag these
          </button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
        {all.map((column) => (
          <label key={column} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: colors.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{column}</span>
            <select
              aria-label={`sensitivity of ${column}`}
              value={tags[column] ?? ''}
              onChange={(e) => set(column, e.target.value)}
              style={{ ...field(150), fontSize: 12, padding: '5px 6px', cursor: 'pointer' }}
            >
              <option value="">not sensitive</option>
              {SENSITIVITIES.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}

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
    <div role={notice.tone === 'bad' ? 'alert' : 'status'} style={{ marginTop: 12, padding: '9px 12px', borderLeft: `3px solid ${tone}`, background: colors.panelSunk, borderRadius: 4 }}>
      <div style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>{notice.text}</div>
      {notice.details?.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {notice.details.map((d) => <li key={d} style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>{d}</li>)}
        </ul>
      )}
    </div>
  )
}
