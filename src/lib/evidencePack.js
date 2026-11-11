// The evidence pack: one self-contained HTML document per check, written for
// the people who sign a migration cycle off — the migration lead, the business
// data owner, internal audit — and for the file the go/no-go decision cites.
// Pure: reports and fingerprints in, an HTML string out.
//
// It is TRUSTWORTHY ON ITS OWN or it is worth nothing:
//   - every input is named with the SHA-256 of its exact bytes, so an auditor
//     can run `sha256sum` and know these were the files checked
//   - the rules and the mapping spec are fingerprinted from canonical JSON and
//     printed in full, so two packs prove whether Mock 2 and Cutover were held
//     to the same spec
//   - it states only what ran: a check that did not run says so
//
// It QUOTES REAL RECORDS — keys, values, rejected rows — which is the point of
// evidence, and why it is never stored or uploaded: it is built in the page
// (or the CLI) and handed to the person who asked for it. Because those values
// come from files, every one is escaped, and the page carries a policy that
// forbids scripts and network requests even if escaping ever failed: a pack
// opened by an auditor must not be able to run anything.

import { serializeContract } from './contractFile.js'
import { cleanColumnMap } from './columnMap.js'
import { canonicalJson, sha256Hex } from './hashing.js'
import { cycleHistory, runnableContract, runnableSpec } from './migrationObject.js'
import { RECON_STEPS } from './reconcile.js'
import { createMasker, maskingSummary, maskReadiness, maskReconciliation } from './masking.js'
import { cleanPackRef, packLabel } from './packRef.js'
import { cleanSignoff, decisionFor, DISPOSITIONS, exceptionsFor, IDENTITY_FIELDS, notChecked, ownersOf, SIGNATORIES, STATEMENT_OF_CLAIM } from './signoff.js'
import { describeRule } from './rules.js'
import { VERSION } from './version.js'

export const EVIDENCE_FORMAT_VERSION = 1
const EXAMPLES = 25

// --- escaping ----------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])
}
const h = escapeHtml
const blankable = (value) => (value === '' || value === null || value === undefined ? '<span class="faint">(blank)</span>' : h(value))

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—')
const pct = (share) => (Number.isFinite(share) ? `${(share * 100).toFixed(share > 0 && share < 0.001 ? 2 : 1)}%` : '—')
const bytes = (n) => (Number.isFinite(n) ? (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`) : '—')
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`
const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—')

// Readiness and reconciliation verdicts in the words a signatory reads.
const VERDICT = {
  READY: { word: 'Ready to load', tone: 'pass' },
  NOT_READY: { word: 'Not ready', tone: 'fail' },
  UNVERIFIED: { word: 'Not confirmed', tone: 'warn' },
  PASS: { word: 'Reconciled', tone: 'pass' },
  FAIL: { word: 'Did not reconcile', tone: 'fail' },
}


// --- sections ------------------------------------------------------------------

function verdictBlock(title, verdict, headline, when) {
  if (!verdict) {
    return `<div class="verdict none"><div class="vt">${h(title)}</div><div class="vw">Not run</div><p>This check was not part of this pack. Nothing here attests to it.</p></div>`
  }
  const v = VERDICT[verdict] ?? { word: verdict, tone: 'warn' }
  return `<div class="verdict ${h(v.tone)}"><div class="vt">${h(title)}</div><div class="vw">${h(v.word)}</div><p>${h(headline)}</p>${when ? `<div class="faint small">${h(when)}</div>` : ''}</div>`
}

// The chain of custody: each file by the SHA-256 of its bytes, and who
// exported it and when, as the person typed it (signoff.js).
function filesTable(files, custody = {}) {
  const exported = (f) => {
    const c = custody[f.custodyRole] ?? {}
    return c.exportedBy || c.exportedAt ? h([c.exportedBy, c.exportedAt].filter(Boolean).join(', ')) : '<span class="faint">not stated</span>'
  }
  const rows = files.map((f) => `<tr><td>${h(f.role)}</td><td class="mono">${h(f.name)}</td><td class="num">${fmt(f.rows)}</td><td class="num">${bytes(f.bytes)}</td><td>${f.sheet ? `${h(`sheet “${f.sheet}”, header row ${f.headerRow ?? 1}`)}; ` : ''}${h(describeFormat(f.format))}</td><td>${exported(f)}</td><td class="mono hash">${h(f.sha256 ?? 'not computed')}</td></tr>`)
  return `<table><thead><tr><th>Role</th><th>File</th><th class="num">Records</th><th class="num">Size</th><th>Read as</th><th>Exported by, when</th><th>SHA-256 of the file’s bytes</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

// How a file was read, in words — a reader of the pack should not need to know
// what { "decimal": "," } means.
function describeFormat(format) {
  if (!format || Object.keys(format).length === 0) return 'UTF-8, 1,234.56, ISO dates'
  return [
    format.encoding && format.encoding !== 'utf-8' ? format.encoding : 'UTF-8',
    format.decimal === ',' ? '1.234,56' : format.grouping === 'indian' ? '12,34,567.89 (Indian grouping)' : '1,234.56',
    format.date ? `dates ${format.date}` : 'ISO dates',
  ].join(', ')
}

function staircase(steps) {
  const lead = steps.findIndex((s) => s.status === 'FAIL')
  return `<div class="stairs">${steps.map((s, i) => `<div class="step ${h(s.status.toLowerCase())}${i === lead ? ' lead' : ''}" style="margin-top:${i * 14}px">${i === lead ? '<div class="caught">CAUGHT HERE</div>' : ''}<div class="sn">${i + 1} · ${h(s.label)}</div><div class="chip ${h(s.status.toLowerCase())}">${h(s.status)}</div></div>`).join('')}</div>`
}

const TABLES = {
  'missing-in-target': [['Key'], (e) => [e.key]],
  'extra-in-target': [['Key'], (e) => [e.key]],
  'duplicate-key-source': [['Key', 'Records'], (e) => [e.key, e.count]],
  'duplicate-key-target': [['Key', 'Records'], (e) => [e.key, e.count]],
  'unmapped-value': [['Legacy value', 'Records'], (e) => [e.value, e.count]],
  'field-mismatch': [['Key', 'Source', 'Expected in target', 'Target has'], (e) => [e.key, e.source, e.expected, e.target]],
  'total-mismatch': [['Group', 'Source total', 'Target total', 'Difference'], (e) => [e.key, num(e.source), num(e.target), num(e.difference)]],
}

function findingHtml(finding, limit) {
  const spec = TABLES[finding.code]
  let table = ''
  if (spec && finding.examples?.length) {
    const [columns, row] = spec
    const shown = finding.examples.slice(0, limit)
    table = `<table class="examples"><thead><tr>${columns.map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${shown.map((e) => `<tr>${row(e).map((cell) => `<td class="mono">${blankable(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    if (finding.examples.length > shown.length) table += `<p class="faint small">The first ${fmt(shown.length)} shown, in file order.</p>`
  }
  return `<div class="finding"><div class="code">${h(finding.code)}${finding.column ? ` · <span class="col">${h(finding.column)}</span>` : ''}</div><p>${h(finding.message)}</p>${table}</div>`
}

function reconciliationSection(recon, limit, owners) {
  const r = recon.report
  const c = r.counts
  const steps = r.steps
  const stepsHtml = steps.map((s, i) => {
    const owner = s.status === 'FAIL' ? `<p class="owner">Whose fix: ${h(owners[s.id])}.</p>` : ''
    const body = s.status === 'PASS'
      ? '<p>Nothing wrong on this step.</p>'
      : s.status === 'SKIPPED'
        ? `<p class="faint">Not judged: ${h(s.reason ?? 'not configured in the spec')}</p>`
        : s.findings.map((f) => findingHtml(f, limit)).join('')
    return `<div class="stepcard ${h(s.status.toLowerCase())}"><div class="sh"><span>${i + 1} · ${h(s.label)}</span><span class="chip ${h(s.status.toLowerCase())}">${h(s.status)}</span></div><p class="q">${h(RECON_STEPS[i]?.question ?? '')}</p>${owner}${body}</div>`
  }).join('')

  return `
<section class="page">
  <h2>Reconciliation — did the load arrive whole?</h2>
  <p class="lead">${h(r.headline)}</p>
  ${staircase(steps)}
  <table class="counts"><tbody>
    <tr><td>Source records</td><td class="num">${fmt(c.sourceRows)}</td><td>Out of scope</td><td class="num">${fmt(c.sourceOutOfScope)}</td></tr>
    <tr><td>In scope (expected)</td><td class="num">${fmt(c.expected)}</td><td>Matched one to one</td><td class="num">${fmt(c.matched)}</td></tr>
    <tr><td>Missing from target</td><td class="num">${fmt(c.missing)}</td><td>In target, not in source</td><td class="num">${fmt(c.extra)}</td></tr>
    <tr><td>Matched but differ</td><td class="num">${fmt(c.rowsWithDifference)}</td><td>Duplicated keys (source / target)</td><td class="num">${fmt(c.sourceDuplicateKeys)} / ${fmt(c.targetDuplicateKeys)}</td></tr>
    <tr><td>Matched, a field not compared (no crosswalk entry)</td><td class="num">${fmt(c.rowsUnverified)}</td><td>Fully verified — every mapped field compared and agreed</td><td class="num">${fmt(c.rowsFullyMatched)} of ${fmt(c.matched)}</td></tr>
    <tr><td>Completeness</td><td class="num">${pct(c.expected ? c.matched / c.expected : null)}</td><td>Fully verified, of matched</td><td class="num">${pct(c.matched ? c.rowsFullyMatched / c.matched : null)}</td></tr>
  </tbody></table>
  ${stepsHtml}
  <h3>Limits this was measured against</h3>
  <table><tbody>
    <tr><td>Records allowed missing</td><td class="num">${pct(r.thresholds.missingShare)}</td></tr>
    <tr><td>Records allowed unexpected</td><td class="num">${pct(r.thresholds.extraShare)}</td></tr>
    <tr><td>Records allowed to differ, per field</td><td class="num">${pct(r.thresholds.mismatchShare)}</td></tr>
    <tr><td>Control-total tolerance</td><td class="num">± ${num(r.thresholds.totalsTolerance)}</td></tr>
  </tbody></table>
</section>`
}

function readinessSection(readiness) {
  const r = readiness.report
  const c = r.counts
  const checks = r.checks.map((check) => `<tr class="${h(check.status.toLowerCase())}"><td>${h(check.description)}</td><td>${check.severity === 'warn' ? 'warning only' : 'rejects'}</td><td><span class="chip ${h(check.status.toLowerCase())}">${h(check.status)}</span></td><td class="num">${check.status === 'FAIL' ? `${fmt(check.failing)} of ${fmt(check.applicable)}` : '—'}</td><td class="mono small">${check.reason ? h(check.reason) : check.examples.map((e) => `${h(e.record)}: ${blankable(e.value)}`).join('<br>')}</td></tr>`).join('')
  return `
<section class="page">
  <h2>Load readiness — will the target accept the load file?</h2>
  <p class="lead">${h(r.headline)}</p>
  <table class="counts"><tbody>
    <tr><td>Records in the load file</td><td class="num">${fmt(c.records)}</td><td>Would be rejected</td><td class="num">${fmt(c.rejected)}</td></tr>
    <tr><td>Would load with a warning</td><td class="num">${fmt(c.warned)}</td><td>Clean</td><td class="num">${fmt(c.clean)}</td></tr>
  </tbody></table>
  <table><thead><tr><th>Rule</th><th>If broken</th><th>Result</th><th class="num">Records</th><th>First records affected</th></tr></thead><tbody>${checks}</tbody></table>
  ${readiness.flaggedCount ? `<p class="faint small">The full list of ${fmt(readiness.flaggedCount)} flagged records is the fix list exported with this check, not this pack.</p>` : ''}
</section>`
}

function historySection(runs) {
  const rows = cycleHistory(runs)
  if (rows.length === 0) return ''
  const body = rows.map(({ run, value, change, metric }) => `<tr><td>${h(run.at ? run.at.slice(0, 16).replace('T', ' ') : '—')}</td><td>${h([run.wave, run.cycle].filter(Boolean).join(' · '))}</td><td>${run.kind === 'reconcile' ? 'Reconciliation' : 'Load readiness'}</td><td>${h(VERDICT[run.status]?.word ?? run.status)}</td><td class="num">${pct(value)} ${metric === 'completeness' ? 'arrived' : 'accepted'}</td><td class="num">${change === null ? '—' : `${change >= 0 ? '+' : '−'}${(Math.abs(change) * 100).toFixed(2)} pts`}</td></tr>`).join('')
  return `<section class="page"><h2>This object, cycle by cycle</h2><p>Every check recorded in the migration object, newest first. Counts and verdicts only.</p><table><thead><tr><th>When (UTC)</th><th>Cycle</th><th>Check</th><th>Result</th><th class="num">Measure</th><th class="num">Since previous</th></tr></thead><tbody>${body}</tbody></table></section>`
}

function rulesTable(rules) {
  if (!rules.length) return '<p class="faint">No rules.</p>'
  return `<ol class="rules">${rules.map((rule) => `<li>${h(describeRule(rule))}${rule.severity === 'warn' ? ' <span class="faint">(warning only)</span>' : ''}</li>`).join('')}</ol>`
}

// The sign-off record (v3 §5.3): every difference and what was decided about
// it, what was not checked, the one claim made, and the signatures — names as
// typed, which the record says are not verified identities.
function signoffSection({ exceptions, record, missing }) {
  const decided = (e) => decisionFor(record, e)
  const dispositionLabel = (id) => DISPOSITIONS.find((d) => d.id === id)?.label
  const rows = exceptions.map((e) => {
    const d = decided(e)
    return `<tr><td>${h(e.step)}</td><td>${h(e.what)}</td><td>${d.disposition ? h(dispositionLabel(d.disposition)) : '<span class="faint">not yet decided</span>'}</td><td>${h(d.reason ?? '')}</td><td>${h(d.owner || e.owner)}</td></tr>`
  }).join('')
  const open = exceptions.filter((e) => !decided(e).disposition).length
  const scope = [...missing, ...(record.scope ? [record.scope] : [])]
  const signer = (s) => {
    const entry = record.signatures[s.id] ?? {}
    return `<tr><td>${h(s.label)}</td><td class="line">${entry.name ? h(entry.name) : ''}</td><td class="line">${entry.date ? h(entry.date) : ''}</td><td class="line"></td></tr>`
  }
  return `
<section class="page signoff">
  <h2>Sign-off record</h2>
  <h3>Exceptions</h3>
  ${exceptions.length === 0
    ? '<p>No check in this record found a difference.</p>'
    : `<p>${plural(exceptions.length, 'difference')}${open ? `, ${fmt(open)} not yet decided` : ', each decided'}. The step that caught each says whose it is.</p>
  <table class="exceptions"><thead><tr><th>Caught at</th><th>What</th><th>Decision</th><th>Reason</th><th>Owner</th></tr></thead><tbody>${rows}</tbody></table>`}
  <h3>Scope and limits — what this record does not cover</h3>
  ${scope.length ? `<ul>${scope.map((line) => `<li>${h(line)}</li>`).join('')}</ul>` : '<p>Every check described above ran on the files listed.</p>'}
  <h3>Statement of claim</h3>
  <p class="claim">${h(STATEMENT_OF_CLAIM)}</p>
  <h3>Signatures</h3>
  <table><thead><tr><th>Role</th><th>Name</th><th>Date</th><th>Signature</th></tr></thead><tbody>${SIGNATORIES.map(signer).join('')}</tbody></table>
  <p class="faint small">Names and dates are as typed by the person who prepared this record; they are not verified identities.</p>
</section>`
}

// --- the document ----------------------------------------------------------------

// buildEvidencePack(input) -> HTML
//
// input:
//   object          the migration object: name, wave, cycle, contract, spec, runs
//   readiness       { report, file, flaggedCount } or null — report as checkReadiness returns it
//   reconciliation  { report, source, target } or null — report as reconcile returns it
//                   file = { name, rows, bytes, sha256 }
//   fingerprints    { contract: { json, sha256 }, spec: { json, sha256 } } from evidenceFingerprints()
//   generatedAt     ISO timestamp
//   generatedBy     'the workspace' | 'the command line'
//   reproduce       the command that re-runs these checks, shown for audit
//   unmask          true when the person asked for tagged values unmasked (masking.js);
//                   Aadhaar stays masked whatever is asked
export function buildEvidencePack(input) {
  const { object, fingerprints, generatedAt, generatedBy, reproduce } = input
  // The pack leaves the screen, so tagged values in its examples are masked
  // (v3 §5.2). Counts, totals and record keys stay; the pack says what it hid.
  const keys = { readiness: object.spec?.key?.target?.filter(Boolean) ?? [], recon: [...(object.spec?.key?.source ?? []), ...(object.spec?.key?.target ?? [])].filter(Boolean) }
  const readinessMasker = createMasker(object.tags, { unmask: input.unmask === true, keys: keys.readiness })
  const reconMasker = createMasker(object.tags, { unmask: input.unmask === true, keys: keys.recon })
  const readiness = input.readiness && { ...input.readiness, report: maskReadiness(input.readiness.report, readinessMasker, keys.readiness) }
  const reconciliation = input.reconciliation && { ...input.reconciliation, report: maskReconciliation(input.reconciliation.report, object.spec, reconMasker) }
  const masking = maskingSummary(readinessMasker)
  const owners = ownersOf(object)
  const record = cleanSignoff(object.signoff)
  const limit = input.exampleLimit ?? EXAMPLES
  const title = [object.name || 'Untitled object', object.wave, object.cycle].filter(Boolean).join(' · ')
  const files = [
    readiness && { role: 'Load file', custodyRole: 'load', format: object.formats?.load, ...readiness.file },
    // Reference files are inputs of the readiness result, so they are attested too.
    ...(readiness?.references ?? []).map((ref) => ({ role: `Reference file “${ref.name}”`, custodyRole: `reference:${ref.name}`, ...ref.file })),
    reconciliation && { role: 'Source extract', custodyRole: 'source', format: object.formats?.source, ...reconciliation.source },
    reconciliation && { role: 'Target extract', custodyRole: 'target', format: object.formats?.target, ...reconciliation.target },
  ].filter(Boolean)
  const scope = object.spec?.scope?.source
  const reference = input.reference ?? '—'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="generator" content="data-contract-validator ${h(VERSION)} — evidence pack format ${EVIDENCE_FORMAT_VERSION}">
<title>Cutover sign-off record — ${h(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="page">
  <div class="kicker">Cutover sign-off record</div>
  <h1>${h(title)}</h1>
  <table class="meta"><tbody>
    ${IDENTITY_FIELDS.map((f) => `<tr><td>${h(f.label)}</td><td>${record.identity[f.id] ? h(record.identity[f.id]) : '<span class="faint">not stated</span>'}</td></tr>`).join('')}
    ${object.pack ? `<tr><td>Definitions from</td><td>${h(packLabel(cleanPackRef(object.pack)) ?? 'a pack')}</td></tr>` : ''}
    <tr><td>Generated</td><td>${h(generatedAt)} (UTC) by ${h(generatedBy)}</td></tr>
    <tr><td>Evidence reference</td><td class="mono">${h(reference)}</td></tr>
  </tbody></table>
  <div class="notice">This document quotes records from the files it describes. It was produced on the machine that ran the checks and was not uploaded anywhere; handle it as you would the data it quotes.</div>
  ${maskingNotice(masking)}
  <div class="verdicts">
    ${verdictBlock('Before the load', readiness?.report.status, readiness?.report.headline, readiness?.file?.name)}
    ${verdictBlock('After the load', reconciliation?.report.status, reconciliation?.report.headline, reconciliation ? `${reconciliation.source?.name} → ${reconciliation.target?.name}` : null)}
  </div>
  <h2>What was checked</h2>
  ${files.length ? filesTable(files, record.custody) : '<p class="faint">No files.</p>'}
  <table><thead><tr><th>Definition</th><th>Contents</th><th>SHA-256 of its canonical JSON (Appendix)</th></tr></thead><tbody>
    <tr><td>Target rules</td><td>${plural(object.contract?.rules?.length ?? 0, 'rule')}${object.contract?.name ? ` — “${h(object.contract.name)}”` : ''}</td><td class="mono hash">${h(fingerprints.contract.sha256)}</td></tr>
    <tr><td>Mapping spec</td><td>${plural(object.spec?.mapping?.length ?? 0, 'field')}, ${plural(object.spec?.totals?.length ?? 0, 'control total')}${scope?.column ? `; in scope only where “${h(scope.column)}” ${h(scope.op)} ${h(scope.target ?? '')}` : ''}</td><td class="mono hash">${h(fingerprints.spec.sha256)}</td></tr>
    ${fingerprints.columns ? `<tr><td>Column matching</td><td>${plural(Object.values(cleanColumnMap(object.columnMap)).reduce((n, map) => n + Object.keys(map).length, 0), 'column')} of the files read under another name (Appendix)</td><td class="mono hash">${h(fingerprints.columns.sha256)}</td></tr>` : ''}
  </tbody></table>
  <p class="faint small">Two packs with the same fingerprint were held to the same rules or the same mapping, whatever else changed between them.</p>
</header>
${signoffSection({ exceptions: exceptionsFor(readiness?.report, reconciliation?.report, owners), record, missing: notChecked(readiness, reconciliation) })}
${readiness ? readinessSection(readiness) : ''}
${reconciliation ? reconciliationSection(reconciliation, limit, owners) : ''}
${historySection(object.runs)}
<section class="page appendix">
  <h2>Appendix A — the definitions, exactly as fingerprinted</h2>
  <h3>Target rules</h3>
  ${rulesTable(object.contract?.rules ?? [])}
  <pre>${h(fingerprints.contract.json)}</pre>
  <h3>Mapping spec</h3>
  <pre>${h(fingerprints.spec.json)}</pre>
  ${fingerprints.columns ? columnMatchingSection(object.columnMap, fingerprints.columns.json) : ''}
  <h2>Appendix B — how to verify this pack</h2>
  <ol>
    <li>Fingerprint each file and compare with “What was checked”: <code>sha256sum &lt;file&gt;</code> (macOS: <code>shasum -a 256 &lt;file&gt;</code>; Windows: <code>certutil -hashfile &lt;file&gt; SHA256</code>).</li>
    <li>Re-run the same checks on the same files and compare the results:${reproduce ? `<pre>${h(reproduce)}</pre>` : ' open the migration object in the workspace and run them again.'}</li>
  </ol>
</section>
</body>
</html>
`
}

// Column matching (columnMap.js): which of a file's columns each definition
// read, said in the record — a reader must be able to see that "Name" was read
// from the file's "Ledger Name", and that someone declared it.
const ROLE_LABELS = { load: 'Load file', source: 'Source extract', target: 'Target extract' }
function columnMatchingSection(columnMap, json) {
  const map = cleanColumnMap(columnMap)
  const rows = Object.keys(map).sort().flatMap((role) => Object.entries(map[role]).map(([expected, actual]) =>
    `<tr><td>${h(ROLE_LABELS[role] ?? `Reference file “${role.slice('reference:'.length)}”`)}</td><td class="mono">${h(expected)}</td><td class="mono">${h(actual)}</td></tr>`))
  return `<h3>Column matching</h3>
  <p class="small">Where a file names a column differently from the definitions, a person declared which column stands for which. No column was matched by the tool on its own.</p>
  <table><thead><tr><th>File</th><th>The definitions say</th><th>The file’s column</th></tr></thead><tbody>${rows.join('')}</tbody></table>
  <pre>${h(json)}</pre>`
}

// evidenceFingerprints(object) -> { contract: { json, sha256 }, spec: { json, sha256 }, columns }
//
// The canonical JSON of the rules and the spec, and their fingerprints. The
// JSON is printed in the pack, so the fingerprint is of text anyone can see.
export async function evidenceFingerprints(object) {
  // serializeContract cleans each rule to the fields the engine reads — the
  // same cleaning a saved contract gets — so UI state cannot move a fingerprint.
  // How the files were read is part of what was checked: the declared formats
  // are inside both fingerprints, so a pack read in 1.234,56 notation and one
  // read in 1,234.56 can never claim the same definitions.
  const contract = runnableContract(object)
  const contractJson = canonicalJson({ rules: serializeContract({ rules: contract.rules }).rules, ...(contract.format ? { format: contract.format } : {}) })
  const { name: _name, ...spec } = runnableSpec(object)
  const specJson = canonicalJson(spec)
  // The column matching is fingerprinted only when there is one, so an object
  // without it carries exactly the fingerprints it always did.
  const columnMap = cleanColumnMap(object?.columnMap)
  const columnsJson = Object.keys(columnMap).length > 0 ? canonicalJson(columnMap) : null
  return {
    contract: { json: contractJson, sha256: await sha256Hex(contractJson) },
    spec: { json: specJson, sha256: await sha256Hex(specJson) },
    columns: columnsJson ? { json: columnsJson, sha256: await sha256Hex(columnsJson) } : null,
  }
}

// A short reference for the sign-off sheet and an email subject: the first 12
// hex digits of a digest over everything the pack attests to.
export async function evidenceReference({ fingerprints, files, statuses, generatedAt }) {
  const basis = JSON.stringify([fingerprints.contract.sha256, fingerprints.spec.sha256, files.map((f) => f.sha256), statuses, generatedAt, ...(fingerprints.columns ? [fingerprints.columns.sha256] : [])])
  const digest = await sha256Hex(basis)
  return `EV-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`.toUpperCase()
}

const STYLES = `
:root { --ink:#16222B; --mute:#4E5D68; --faint:#5F6C76; --edge:#DCE3E8; --sunk:#EFF3F5; --accent:#1F6F8B; --pass:#2A7353; --fail:#B23A34; --warn:#8A6414; }
* { box-sizing: border-box; }
body { margin: 0; background: #F4F6F8; color: var(--ink); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.page { background: #fff; max-width: 980px; margin: 18px auto; padding: 28px 34px; border: 1px solid var(--edge); border-radius: 8px; }
h1 { font-size: 26px; margin: 4px 0 12px; } h2 { font-size: 18px; margin: 24px 0 8px; } h3 { font-size: 15px; margin: 18px 0 6px; }
.kicker { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.mono, pre, code { font-family: ui-monospace, 'SF Mono', Consolas, Menlo, monospace; font-size: 12px; }
.hash { word-break: break-all; font-size: 11px; }
.faint { color: var(--faint); } .small { font-size: 12px; } .lead { font-size: 16px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; } th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); border-bottom: 1px solid var(--edge); padding: 6px 8px 6px 0; }
td { border-bottom: 1px solid var(--edge); padding: 6px 8px 6px 0; vertical-align: top; } .num { text-align: right; white-space: nowrap; }
table.meta td:first-child, table.counts td:nth-child(odd) { color: var(--mute); width: 22%; }
.notice { margin: 12px 0; padding: 10px 12px; background: var(--sunk); border-left: 3px solid var(--accent); font-size: 13px; } .notice.unmasked { border-left: 4px solid var(--warn); } .notice ul { margin: 6px 0 0 18px; padding: 0; }
.verdicts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
.verdict { border: 1px solid var(--edge); border-left-width: 4px; border-radius: 6px; padding: 12px 14px; } .verdict p { margin: 6px 0 0; font-size: 13px; }
.verdict .vt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); } .verdict .vw { font-size: 20px; font-weight: 700; }
.verdict.pass { border-left-color: var(--pass); } .verdict.pass .vw { color: var(--pass); }
.verdict.fail { border-left-color: var(--fail); } .verdict.fail .vw { color: var(--fail); }
.verdict.warn { border-left-color: var(--warn); } .verdict.warn .vw { color: var(--warn); }
.verdict.none .vw { color: var(--faint); }
.chip { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; padding: 1px 6px; border-radius: 4px; border: 1px solid currentColor; }
.chip.pass { color: var(--pass); } .chip.fail { color: var(--fail); } .chip.skipped, .chip.unchecked { color: var(--faint); }
.stairs { display: flex; gap: 8px; align-items: flex-start; margin: 22px 0 12px; }
.step { flex: 1; border: 1px solid var(--edge); border-top: 3px solid #C6D0D8; border-radius: 6px; padding: 8px 10px 12px; position: relative; }
.step.lead { border-top-color: var(--fail); background: #B23A340D; } .step .sn { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.caught { position: absolute; top: -18px; left: 0; font-size: 10px; font-weight: 700; letter-spacing: .08em; color: var(--fail); }
.stepcard { border: 1px solid var(--edge); border-radius: 6px; padding: 10px 14px; margin: 10px 0; break-inside: avoid; }
.stepcard.fail { border-left: 3px solid var(--fail); } .sh { display: flex; justify-content: space-between; font-weight: 600; } .q { color: var(--faint); margin: 2px 0 6px; font-size: 13px; }
.owner { font-size: 13px; color: var(--mute); margin: 4px 0; }
.finding { background: var(--sunk); border-radius: 5px; padding: 8px 10px; margin: 8px 0; } .finding p { margin: 4px 0; } .finding .code { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--fail); } .col { color: var(--accent); }
table.examples td, table.examples th { padding: 3px 10px 3px 0; }
ol.rules li { margin: 2px 0; }
pre { background: var(--sunk); padding: 10px 12px; border-radius: 5px; white-space: pre-wrap; word-break: break-all; }
.signoff td.line { height: 34px; min-width: 110px; } .signoff td.choices { font-size: 12px; white-space: nowrap; }
@media (max-width: 640px) { .page { padding: 18px; margin: 8px; } .verdicts { grid-template-columns: 1fr; } .stairs { flex-direction: column; } .step { margin-top: 0 !important; } }
@media print {
  body { background: #fff; } .page { border: none; margin: 0; padding: 0 0 12px; max-width: none; }
  section.page { break-before: page; } .stepcard, tr, .finding { break-inside: avoid; }
  @page { size: A4; margin: 16mm 14mm; }
}
`

// What the pack hid, or the warning that it hides nothing a tag asked to hide.
function maskingNotice(masking) {
  if (!masking) return ''
  const list = masking.columns.map((c) => `<li><span class="mono">${h(c.column)}</span> (${h(c.tag)}) — ${h(c.how)}</li>`).join('')
  if (masking.unmasked) {
    return `<div class="notice unmasked"><strong>This pack contains unmasked personal data.</strong> The person who made it chose to show tagged values in full (Aadhaar stays masked). Share it only with those entitled to see these columns:<ul>${list}</ul></div>`
  }
  return `<div class="notice"><strong>Masked in this pack:</strong> values in the columns tagged as sensitive. Counts, totals and record keys are shown in full.<ul>${list}</ul></div>`
}

// createEvidencePack(input) -> { html, reference, fileName }
//
// The one entry point both the workspace and the CLIs use, so a pack means the
// same wherever it was made. input is buildEvidencePack's, minus fingerprints
// and reference, which are computed here; generatedAt defaults to now (UTC).
export async function createEvidencePack(input) {
  const generatedAt = (input.generatedAt ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z')
  const fingerprints = await evidenceFingerprints(input.object)
  const files = [input.readiness?.file, input.reconciliation?.source, input.reconciliation?.target].filter(Boolean)
  const statuses = [input.readiness?.report.status ?? null, input.reconciliation?.report.status ?? null]
  const reference = await evidenceReference({ fingerprints, files, statuses, generatedAt })
  const html = buildEvidencePack({ ...input, fingerprints, reference, generatedAt })
  const slug = [input.object.name || 'migration', input.object.wave, input.object.cycle]
    .filter(Boolean).join('-').replace(/[^\w.-]+/g, '-').toLowerCase()
  return { html, reference, fileName: `${slug}-evidence-${reference.toLowerCase()}.html` }
}
