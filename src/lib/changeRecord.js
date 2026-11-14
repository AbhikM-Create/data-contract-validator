// The change record: one self-contained HTML document per change check, for
// the person who approves the change and whoever later asks how it was
// approved. The sibling of the evidence pack (evidencePack.js), held to the
// same rules — it is TRUSTWORTHY ON ITS OWN or worth nothing:
//   - every file is named by the SHA-256 of its exact bytes;
//   - the contract is fingerprinted from canonical JSON printed in full;
//   - custody is stated as typed, and said to be unverified; a check whose
//     inputs came from the mover is labelled SELF-CHECKED on the first page;
//   - without who exported each file and when, it is a DRAFT, never final.
// It quotes records, so it is built locally and handed to the person who asked;
// tagged values are masked (masking.js); every value is escaped, and a policy
// forbids scripts and requests even if escaping failed.

import { cleanChangeContract } from './changeContractFile.js'
import { cleanCustody, CUSTODY_FIELDS, missingForFinal, partyLabel, selfChecked } from './changeCustody.js'
import { escapeHtml, EVIDENCE_STYLES } from './evidencePack.js'
import { canonicalJson, sha256Hex } from './hashing.js'
import { createMasker, maskChange, maskingSummary } from './masking.js'
import { normalizeContract } from './changeContract.js'
import { STATEMENT_OF_CLAIM } from './signoff.js'
import { VERSION } from './version.js'

export const CHANGE_RECORD_FORMAT_VERSION = 1
const EXAMPLES = 25

const h = escapeHtml
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—')
const bytes = (n) => (Number.isFinite(n) ? (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`) : '—')
const blankable = (value) => (value === '' || value === null || value === undefined ? '<span class="faint">(blank)</span>' : h(value))
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`

const VERDICT = {
  ALLOWED: { word: 'Allowed', tone: 'pass' },
  NOT_ALLOWED: { word: 'Not allowed', tone: 'fail' },
  UNVERIFIED: { word: 'Not confirmed', tone: 'warn' },
}

const POLICY_WORDS = {
  preserve: 'must stay the same', free: 'may change freely', oneOf: 'may change to one of a list',
  map: 'changes through a crosswalk', bounded: 'may change within limits', asApproved: 'must change to its approved value',
}

const ROLE_LABELS = { before: 'Before', after: 'After', approved: 'Approved list', log: 'Change log' }

// changeFingerprint(contract) -> { json, sha256 }: the contract as it is saved,
// so a fingerprint means the same definition wherever it was made.
export async function changeFingerprint(contract) {
  const json = canonicalJson(cleanChangeContract(contract))
  return { json, sha256: await sha256Hex(json) }
}

function findingHtml(finding, limit) {
  const has = (field) => finding.examples.some((e) => e[field] !== undefined)
  const columns = [['key', 'Record'], ['before', 'Before'], ['after', 'After'], ['approved', 'Approved'], ['reason', 'Why']].filter(([f]) => f === 'key' || has(f))
  const shown = finding.examples.slice(0, limit)
  let table = ''
  if (shown.length) {
    table = `<table class="examples"><thead><tr>${columns.map(([, c]) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${shown.map((e) => `<tr>${columns.map(([f]) => `<td class="${f === 'reason' ? '' : 'mono'}">${blankable(e[f])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    if (finding.count > shown.length) table += `<p class="faint small">The first ${fmt(shown.length)} of ${fmt(finding.count)} shown, in file order.</p>`
  }
  return `<div class="finding"><div class="code">${h(finding.code)}${finding.column ? ` · <span class="col">${h(finding.column)}</span>` : ''}</div><p>${h(finding.message)}</p>${table}</div>`
}

function stepsHtml(steps, limit) {
  const lead = steps.findIndex((s) => s.status === 'FAIL')
  const stairs = `<div class="stairs">${steps.map((s, i) => `<div class="step ${h(s.status.toLowerCase())}${i === lead ? ' lead' : ''}" style="margin-top:${i * 14}px">${i === lead ? '<div class="caught">CAUGHT HERE</div>' : ''}<div class="sn">${i + 1} · ${h(s.label)}</div><div class="chip ${h(s.status.toLowerCase())}">${h(s.status)}</div></div>`).join('')}</div>`
  const cards = steps.map((s, i) => {
    const owners = [...new Set(s.findings.map((f) => f.owner).filter(Boolean))]
    const owner = s.status === 'FAIL' && owners.length ? `<p class="owner">Whose fix: ${h(owners.join('; '))}.</p>` : ''
    const body = s.status === 'PASS' && s.findings.length === 0
      ? '<p>Nothing wrong on this step.</p>'
      : `${s.reason ? `<p class="faint">${h(s.reason)}</p>` : ''}${s.findings.map((f) => findingHtml(f, limit)).join('')}`
    return `<div class="stepcard ${h(s.status.toLowerCase())}"><div class="sh"><span>${i + 1} · ${h(s.label)}</span><span class="chip ${h(s.status.toLowerCase())}">${h(s.status)}</span></div><p class="q">${h(s.question)}</p>${owner}${body}</div>`
  }).join('')
  return stairs + cards
}

function custodyTable(custody) {
  const rows = CUSTODY_FIELDS.map((f) => {
    const line = custody[f.id]
    const who = line.by ? `${h(partyLabel(line.by))}${line.name ? ` — ${h(line.name)}` : ''}` : '<span class="faint">not stated</span>'
    const when = f.when ? (line.at ? h(line.at) : '<span class="faint">not stated</span>') : ''
    return `<tr><td>${h(f.label)}</td><td>${who}</td><td>${when}</td></tr>`
  }).join('')
  return `<table><thead><tr><th>Custody</th><th>Who</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>`
}

function maskingNotice(masking) {
  if (!masking) return '<div class="notice">No column was tagged as sensitive, so the records quoted below show their values as they are in the files.</div>'
  const list = masking.columns.map((c) => `<li><span class="mono">${h(c.column)}</span> (${h(c.tag)}) — ${h(c.how)}</li>`).join('')
  if (masking.unmasked) return `<div class="notice unmasked"><strong>This record contains unmasked personal data.</strong> The person who made it chose to show tagged values in full (Aadhaar stays masked):<ul>${list}</ul></div>`
  return `<div class="notice"><strong>Masked in this record:</strong> values in the columns tagged as sensitive. Counts and record keys are shown in full.<ul>${list}</ul></div>`
}

// buildChangeRecord(input) -> HTML
//   report       checkChange's report (ALLOWED, NOT_ALLOWED or UNVERIFIED)
//   contract     the contract it ran
//   files        { before, after, approved?, log? }: { name, rows, bytes, sha256 }
//   custody      as typed (changeCustody.js)
//   tags, unmask how tagged values are masked (masking.js)
//   fingerprint  from changeFingerprint(); reference; generatedAt; generatedBy; reproduce
export function buildChangeRecord(input) {
  const { report, contract, files, fingerprint, reference, generatedAt, generatedBy, reproduce } = input
  const normal = normalizeContract(contract)
  const keys = [...normal.key.before, ...normal.key.after]
  const masker = createMasker(input.tags, { unmask: input.unmask === true, keys })
  const shown = maskChange(report, normal, masker)
  const custody = cleanCustody(input.custody)
  const self = selfChecked(custody)
  const missing = missingForFinal(custody)
  const verdict = VERDICT[report.status] ?? { word: report.status, tone: 'warn' }
  const title = report.name || normal.name || 'Change check'
  const c = report.counts
  const limit = input.exampleLimit ?? EXAMPLES
  const fileRows = Object.entries(files).filter(([, f]) => f).map(([role, f]) => `<tr><td>${h(ROLE_LABELS[role] ?? role)}</td><td class="mono">${h(f.name)}</td><td class="num">${fmt(f.rows)}</td><td class="num">${bytes(f.bytes)}</td><td class="mono hash">${h(f.sha256 ?? 'not computed')}</td></tr>`).join('')
  const fields = shown.fields.map((f) => `<tr><td class="mono">${h(f.before === f.after ? f.before : `${f.before} → ${f.after}`)}</td><td>${f.implicit ? 'not named, so must stay the same' : h(POLICY_WORDS[f.policy] ?? f.policy)}</td><td class="num">${fmt(f.compared)}</td><td class="num">${fmt(f.unchanged)}</td><td class="num">${fmt(f.allowed)}</td><td class="num">${fmt(f.notAllowed)}</td><td class="num">${fmt(f.outOfLimits)}</td><td class="num">${fmt(f.unverified)}</td></tr>`).join('')
  const notCovered = [
    ...shown.notChecked,
    ...shown.steps.filter((s) => s.status === 'UNCHECKED' || s.status === 'SKIPPED').map((s) => `${s.label}: ${s.reason ?? 'not judged.'}`),
  ]

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="generator" content="data-contract-validator ${h(VERSION)} — change record format ${CHANGE_RECORD_FORMAT_VERSION}">
<title>Change record — ${h(title)}</title>
<style>${EVIDENCE_STYLES}
.selfcheck { margin: 12px 0; padding: 10px 12px; border: 2px solid var(--warn); border-radius: 6px; } .selfcheck strong { color: var(--warn); }
.draft { display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--warn); border: 1px solid var(--warn); border-radius: 4px; padding: 1px 6px; vertical-align: middle; }
</style>
</head>
<body>
<header class="page">
  <div class="kicker">Change record${missing.length ? '<span class="draft">DRAFT</span>' : ''}</div>
  <h1>${h(title)}</h1>
  <table class="meta"><tbody>
    <tr><td>Change made by</td><td>${custody.mover ? h(custody.mover) : '<span class="faint">not stated</span>'}</td></tr>
    <tr><td>Generated</td><td>${h(generatedAt)} (UTC) by ${h(generatedBy)}</td></tr>
    <tr><td>Record reference</td><td class="mono">${h(reference)}</td></tr>
  </tbody></table>
  ${self.length ? `<div class="selfcheck"><strong>Self-checked.</strong> Part of this check came from whoever made the change, so it is not independent of it:<ul>${self.map((s) => `<li>${h(s)}</li>`).join('')}</ul></div>` : ''}
  ${missing.length ? `<div class="notice">This is a draft, not a final record: it does not state ${h(missing.join(', '))}.</div>` : ''}
  <div class="notice">This document quotes records from the files it describes. It was produced on the machine that ran the check and was not uploaded anywhere; handle it as you would the data it quotes.</div>
  ${maskingNotice(maskingSummary(masker))}
  <div class="verdicts" style="grid-template-columns:1fr">
    <div class="verdict ${h(verdict.tone)}"><div class="vt">Was this change allowed?</div><div class="vw">${h(verdict.word)}</div><p>${h(shown.headline)}</p></div>
  </div>
  <h2>Who did what</h2>
  ${custodyTable(custody)}
  <p class="faint small">As typed by the person who prepared this record; names, parties and dates are not verified identities.</p>
  <h2>What was checked</h2>
  <table><thead><tr><th>Role</th><th>File</th><th class="num">Records</th><th class="num">Size</th><th>SHA-256 of the file’s bytes</th></tr></thead><tbody>${fileRows}</tbody></table>
  <table><thead><tr><th>Definition</th><th>Contents</th><th>SHA-256 of its canonical JSON (Appendix)</th></tr></thead><tbody>
    <tr><td>Change contract</td><td>${plural(normal.fields.length, 'column')} named; every other column must stay the same. Added: ${h(normal.added)}; removed: ${h(normal.removed)}${normal.totals.length ? `; ${plural(normal.totals.length, 'total')}` : ''}</td><td class="mono hash">${h(fingerprint.sha256)}</td></tr>
  </tbody></table>
</header>
<section class="page">
  <h2>The check</h2>
  <table class="counts"><tbody>
    <tr><td>Records before</td><td class="num">${fmt(c.beforeRows)}</td><td>Records after</td><td class="num">${fmt(c.afterRows)}</td></tr>
    <tr><td>In both</td><td class="num">${fmt(c.matched)}</td><td>Changed</td><td class="num">${fmt(c.changed)}</td></tr>
    <tr><td>Broke the contract</td><td class="num">${fmt(c.withViolation)}</td><td>Could not be confirmed</td><td class="num">${fmt(c.unverified)}</td></tr>
    <tr><td>Added</td><td class="num">${fmt(c.added)}</td><td>Removed</td><td class="num">${fmt(c.removed)}</td></tr>
  </tbody></table>
  ${stepsHtml(shown.steps, limit)}
  <h3>Column by column</h3>
  <table><thead><tr><th>Column</th><th>Contract</th><th class="num">Compared</th><th class="num">Unchanged</th><th class="num">Allowed</th><th class="num">Not allowed</th><th class="num">Out of limits</th><th class="num">Unconfirmed</th></tr></thead><tbody>${fields}</tbody></table>
  <h3>What this record does not cover</h3>
  ${notCovered.length ? `<ul>${notCovered.map((line) => `<li>${h(line)}</li>`).join('')}</ul>` : '<p>Every step above judged the files listed.</p>'}
  <h3>Statement of claim</h3>
  <p class="claim">${h(STATEMENT_OF_CLAIM)}</p>
</section>
<section class="page appendix">
  <h2>Appendix A — the contract, exactly as fingerprinted</h2>
  <pre>${h(fingerprint.json)}</pre>
  <h2>Appendix B — how to verify this record</h2>
  <ol>
    <li>Fingerprint each file and compare with “What was checked”: <code>sha256sum &lt;file&gt;</code> (macOS: <code>shasum -a 256 &lt;file&gt;</code>; Windows: <code>certutil -hashfile &lt;file&gt; SHA256</code>).</li>
    <li>Save Appendix A as a file and re-run the check on the same files:${reproduce ? `<pre>${h(reproduce)}</pre>` : '<pre>dcv change contract.json before.csv after.csv</pre>'}</li>
  </ol>
</section>
</body>
</html>
`
}

// createChangeRecord(input) -> { html, reference, fileName }. The one entry
// point for the workspace and the CLI; refuses an INVALID report, which
// attests to nothing.
export async function createChangeRecord(input) {
  if (!input.report || input.report.status === 'INVALID') throw new Error('A change check that could not run has no record.')
  const generatedAt = (input.generatedAt ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z')
  const fingerprint = await changeFingerprint(input.contract)
  const basis = JSON.stringify([fingerprint.sha256, Object.values(input.files).filter(Boolean).map((f) => f.sha256), input.report.status, generatedAt, cleanCustody(input.custody)])
  const digest = await sha256Hex(basis)
  const reference = `CR-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`.toUpperCase()
  const html = buildChangeRecord({ ...input, fingerprint, reference, generatedAt })
  const slug = (input.report.name || 'change').replace(/[^\w.-]+/g, '-').toLowerCase()
  return { html, reference, fileName: `${slug}-change-record-${reference.toLowerCase()}.html` }
}
