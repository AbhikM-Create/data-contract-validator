import { useRef } from 'react'
import ChangeContractBuilder from '../components/ChangeContractBuilder.jsx'
import ChangeCustody from '../components/ChangeCustody.jsx'
import ChangeReport from '../components/ChangeReport.jsx'
import UploadCard from '../components/UploadCard.jsx'
import { contractIssues, normalizeContract } from '../lib/changeContract.js'
import { missingForFinal, selfChecked } from '../lib/changeCustody.js'
import { colors, ghostButton, label, panel, primaryButton, sans } from '../theme.js'

// A change check: was this bulk change allowed? Someone — a vendor, a payroll
// bureau, an AI run, your own team — changed a set of records. The contract
// says what they were allowed to change; the check reads the records before
// and after and sorts every difference, naming whose fix each one is.
//
// The files are read in this browser and never leave it. The contract is a
// definition and can be saved as a file `dcv change` also reads.

export default function ChangeScreen({ files, contract, custody, run, stale, notice, busy, onLoadFile, onClearFile, onContract, onCustody, onRun, onDownloadContract, onOpenContract, onNew, onDownloadRecord }) {
  const openInput = useRef(null)
  const before = files.before
  const after = files.after
  const ready = before?.rowCount > 0 && after?.rowCount > 0
  const beforeColumns = before?.columns ?? []
  const afterColumns = after?.columns ?? []
  const issues = ready ? contractIssues(normalizeContract(contract), beforeColumns, afterColumns) : []
  const self = selfChecked(custody)
  const missing = missingForFinal(custody)

  return (
    <div>
      <p style={label}>Change check</p>
      <h1 style={{ fontFamily: sans, fontSize: 22, fontWeight: 650, color: colors.ink, letterSpacing: '-0.015em', margin: '6px 0 0', maxWidth: 760, lineHeight: 1.25 }}>
        Was this bulk change allowed?
      </h1>
      <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.6, margin: '8px 0 0', maxWidth: 760 }}>
        Someone changed a set of records — a salary revision, an AI categorisation run, a vendor’s clean-up. Say what they were allowed to change;
        the check reads the records before and after and sorts every difference into allowed, not allowed, and approved but missing.
        Whoever made the change should not be the one who checks it.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button onClick={onDownloadContract} style={ghostButton}>Save the contract</button>
        <button onClick={() => openInput.current?.click()} style={ghostButton}>Open a contract file</button>
        <button onClick={onNew} style={ghostButton}>New change check</button>
        <input
          ref={openInput}
          type="file"
          accept=".json,application/json"
          aria-label="Open a change contract file"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.[0]) onOpenContract(e.target.files[0]); e.target.value = '' }}
        />
      </div>
      {notice && <p role="status" style={{ fontFamily: sans, fontSize: 13, color: notice.tone === 'error' ? colors.fail : colors.mute, margin: '10px 0 0' }}>{notice.text}</p>}

      <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: '24px 0 0' }}>The records</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 10 }}>
        <UploadCard step="1" title="Before" tag="before" hint="The records as they were, exported before the change." file={before} accent={colors.accent} onFile={(f) => onLoadFile('before', f)} onClear={() => onClearFile('before')} />
        <UploadCard step="2" title="After" tag="after" hint="The same records after the change, exported the same way." file={after} accent={colors.accent} onFile={(f) => onLoadFile('after', f)} onClear={() => onClearFile('after')} />
        <UploadCard step="3" title="Approved list (optional)" tag="approved" hint="What the signer approved, keyed like the records. Needed when the contract allows changes only for approved records." file={files.approved} accent={colors.accent} onFile={(f) => onLoadFile('approved', f)} onClear={() => onClearFile('approved')} />
        <UploadCard step="4" title="Change log (optional)" tag="change log" hint="The log kept by whoever made the change: the records they say they touched." file={files.log} accent={colors.accent} onFile={(f) => onLoadFile('log', f)} onClear={() => onClearFile('log')} />
      </div>

      <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: '24px 0 0' }}>The contract</h2>
      {ready ? (
        <ChangeContractBuilder
          contract={contract}
          beforeColumns={beforeColumns}
          afterColumns={afterColumns}
          approvedColumns={files.approved?.columns ?? []}
          issues={issues}
          onChange={onContract}
        />
      ) : (
        <div style={{ ...panel, padding: 18, marginTop: 12 }}>
          <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, margin: 0 }}>
            Open the before and after files first: the contract is built from their columns.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <button onClick={onRun} disabled={!ready || issues.length > 0 || Boolean(busy)} style={{ ...primaryButton, opacity: !ready || issues.length > 0 ? 0.55 : 1 }}>
          Check the change
        </button>
        {busy && <span role="status" style={{ fontFamily: sans, fontSize: 13, color: colors.mute }}>{busy}</span>}
      </div>

      {run?.report && self.length > 0 && (
        <p role="status" style={{ fontFamily: sans, fontSize: 13, color: colors.warn, fontWeight: 600, margin: '18px 0 0' }}>
          Self-checked: {self.join(' ')}
        </p>
      )}
      {run?.report && <ChangeReport report={run.report} stale={stale} />}

      {run?.report && run.report.status !== 'INVALID' && (
        <>
          <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: '28px 0 0' }}>The record</h2>
          <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.6, margin: '6px 0 0', maxWidth: 760 }}>
            One HTML document for whoever approves this change: the answer, who did what, each file by the SHA-256 of its bytes, and the contract
            in full. It quotes records, so it is made here and handed to you — never stored or uploaded.
          </p>
          <ChangeCustody custody={custody} selfChecked={self} missing={missing} onChange={onCustody} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <button onClick={onDownloadRecord} disabled={stale} style={{ ...primaryButton, opacity: stale ? 0.55 : 1 }}>
              Download the change record{missing.length ? ' (draft)' : ''}
            </button>
            {stale && <span style={{ fontFamily: sans, fontSize: 13, color: colors.warn }}>Out of date — check the change again first: a record states only a current result.</span>}
          </div>
        </>
      )}
    </div>
  )
}
