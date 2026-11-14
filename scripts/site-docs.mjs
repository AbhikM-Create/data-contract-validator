// Docs and trust (brand Phase C): the help centre, the command line, a
// reference page per pack, the changelog and the legal shells. Built by
// build-site.mjs into dist-site/docs/. Like the rest of the site, every fact
// that the code knows is read from the code: rule sentences from describeRule,
// statuses from RECON_STEPS, formats from formats.js, identifiers from
// identifiers.js, usage lines from each command's USAGE, pack contents from
// src/packs. What only a person knows (the changelog, the glossary) is
// written here, and must stay true.
import { USAGE as CHANGE_USAGE } from '../cli/change.mjs'
import { USAGE as CHECK_USAGE } from '../cli/check.mjs'
import { USAGE as ODCS_USAGE } from '../cli/odcs.mjs'
import { USAGE as PACK_USAGE } from '../cli/pack.mjs'
import { USAGE as RECONCILE_USAGE } from '../cli/reconcile.mjs'
import { USAGE as SHARE_USAGE } from '../cli/share.mjs'
import { DATE_FORMATS, DECIMALS, ENCODINGS, GROUPINGS } from '../src/lib/formats.js'
import { IDENTIFIERS } from '../src/lib/identifiers.js'
import { SENSITIVITIES } from '../src/lib/masking.js'
import { RECON_STEPS } from '../src/lib/reconcile.js'
import { describeRule, ruleSeverity } from '../src/lib/rules.js'
import { DEFAULT_OWNERS } from '../src/lib/signoff.js'
import { PACKS } from '../src/packs/index.js'

export const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// The repository's links, from package.json, set by docsBody.
const LINKS = { issues: '', repo: '' }

const packFile = (pack) => `docs/pack-${pack.id}.html`

export const DOCS_PAGES = [
  { file: 'docs/index.html', docs: 'Help centre', title: 'Help centre — Plumbstep', description: 'Your first cutover in Plumbstep, how to read a report, the formats and identifiers it reads, and a glossary.' },
  { file: 'docs/cli.html', docs: 'Command line', title: 'Command line (dcv) — Plumbstep', description: 'The dcv command: check, reconcile, pack, share and ODCS, with exit codes for pipelines.' },
  ...PACKS.map((pack) => ({ file: packFile(pack), docs: `Pack: ${pack.name.split(' — ')[0]}`, title: `${pack.name} — pack reference — Plumbstep`, description: `Every expected column, rule, mapping and control total in the ${pack.name} pack, read from the pack itself.`, pack })),
  { file: 'docs/changelog.html', docs: 'Changelog', title: 'Changelog — Plumbstep', description: 'What changed, and when.' },
  { file: 'docs/legal.html', docs: 'Legal', title: 'Legal — Plumbstep', description: 'Terms, privacy notice and data processing agreement: what exists today and what does not.' },
]

function docsNav(current) {
  const links = DOCS_PAGES.map((p) => `<a href="${h(p.file.slice('docs/'.length))}"${p.file === current ? ' aria-current="page"' : ''}>${h(p.docs)}</a>`).join('')
  return `<nav class="subnav" aria-label="Docs"><div class="wrap">${links}</div></nav>`
}

const hero = (eyebrow, title, lead) => `<section class="hero docs-hero"><div class="wrap">
<span class="eyebrow">${h(eyebrow)}</span>
<h1>${h(title)}</h1>
${lead ? `<p class="lead">${lead}</p>` : ''}
</div></section>`

// --- Help centre ------------------------------------------------------------

const VALIDATE_LAYERS = [
  ['Schema', 'Missing or extra columns, changed types, a column gone all-blank.'],
  ['Semantics', 'Category values never seen before, or gone; a numeric change that matches a known unit conversion (×100, ×1000, ×60).'],
  ['Freshness', 'The newest date against how often the file usually arrives. Skipped, not failed, when the file has no date column.'],
  ['Distribution', 'Mean and median shifts, values outside the trusted range, row-count change, a jump in blanks.'],
]

const READINESS = [
  ['READY', 'pass', 'Every record passed every rule that applies to it.'],
  ['NOT READY', 'fail', 'At least one record would be rejected, or a file total failed. The fix list names each record and why.'],
  ['UNVERIFIED', 'warn', 'Nothing failed, but something could not be checked — a reference file not opened, a column missing. Never called ready.'],
  ['INVALID', 'skip', 'The check could not run as set up: a rule or key names a column the file lacks, or a format is unknown.'],
]

const GLOSSARY = [
  ['Migration object', 'One kind of record being moved — employees, the chart of accounts, open payables — with its rules, mapping, formats and every run’s counts. Saved as a .migration.json file, or to your account.'],
  ['Load file', 'The file you are about to load into the new system. Checked before the load.'],
  ['Source extract and target extract', 'The same records exported from the old system and from the new one after the load. Reconciled against each other.'],
  ['Business key', 'The column or columns that identify a record on each side, such as the employee number. Records are matched by it, never by position.'],
  ['Crosswalk', 'A table that says which old value becomes which new one, such as a Tally group to a Zoho account type. A value with no entry is a mapping gap.'],
  ['Control total', 'A sum of an amount, or a count of records, on each side, optionally per group — headcount by location, balance by party.'],
  ['The file you trust', 'For monitoring a feed: an earlier file you have checked and accept. New files are compared with it.'],
  ['The file to check', 'The new file being compared with the file you trust.'],
  ['Fix list', 'The records that would be rejected, each with its reasons and whose fix it is, as a CSV you download.'],
  ['Evidence pack', 'One self-contained document per check, recording the files by their SHA-256, the definitions, the results, the decisions and what was not checked.'],
  ['Out of date', 'A result whose files or definitions have changed since it ran. It is left out of the evidence pack until it is run again.'],
  ['Pack', 'Ready-made definitions for one source → target path. A draft until a pilot has run it on real exports.'],
  ['Sensitivity tag', 'A mark on a column — personal, identifier, pay or Aadhaar — that masks its values wherever a report leaves the screen.'],
]

function helpCentre() {
  const steps = RECON_STEPS.map((s, i) => `<tr><td>${i + 1}. ${h(s.label)}</td><td>${h(s.question)}</td><td>${h(DEFAULT_OWNERS[s.id] ?? '')}</td></tr>`).join('')
  const layers = VALIDATE_LAYERS.map(([name, text], i) => `<tr><td>${i + 1}. ${h(name)}</td><td>${h(text)}</td></tr>`).join('')
  const statuses = READINESS.map(([name, tone, text]) => `<tr><td><span class="chip ${tone}">${h(name)}</span></td><td>${h(text)}</td></tr>`).join('')
  const list = (items) => items.map((i) => `<li>${h(i.label)}</li>`).join('')
  return `${hero('Help centre', 'Your first cutover, step by step.', 'The workspace has four steps, one on screen at a time. Here is what each asks of you, how to read what comes back, and what the words mean.')}
<section><div class="wrap">
<h2 id="first-cutover">Your first cutover</h2>
<div class="grid">
<div class="card"><span class="num">Step 1 · Set up</span><h3>Files, columns, rules, mapping</h3><p>Start an object from a pack or from scratch. Open the load file, and later the source and target extracts. Where the file’s headers differ from the ones the definitions read, match them from the dropdowns. Declare each file’s format, and tag sensitive columns.</p></div>
<div class="card"><span class="num">Step 2 · Before the load</span><h3>Will the target accept it?</h3><p>Run the readiness check. It counts records: one record broken by three rules is one rejection with three reasons. Download the fix list and send it to the data owner.</p></div>
<div class="card"><span class="num">Step 3 · After the load</span><h3>Did every record arrive?</h3><p>Open the target extract and reconcile. Each run is kept with its counts, so mock 2 can be set beside mock 1.</p></div>
<div class="card"><span class="num">Step 4 · Sign-off</span><h3>Decide, and keep the record</h3><p>Record a decision and an owner for every difference, state what was out of scope, type the signers’ names, and download the evidence pack.</p></div>
</div>
<p class="note">Try it on invented files first: the workspace’s home page opens a finance example, Tally to Zoho Books, with a checklist beside it. <a href="../app/index.html">Open the workspace</a>.</p>
</div></section>
<section><div class="wrap">
<h2 id="reading-a-report">Reading a report: the staircase</h2>
<p class="intro">Every check runs as a descent, and every step runs. The step where the first failure shows says what kind of problem it is; the steps above it that passed say what it is not.</p>
<h3 class="table-title">After the load — reconciliation</h3>
<div class="table-wrap"><table><thead><tr><th scope="col">Step</th><th scope="col">The question</th><th scope="col">Whose fix, by default</th></tr></thead><tbody>${steps}</tbody></table></div>
<p class="note">A step that is not set up reads SKIPPED, never PASS. A record whose field could not be compared — no crosswalk entry — is unverified, never fully matched. Owners can be changed per object.</p>
<h3 class="table-title">Before the load — readiness</h3>
<div class="table-wrap"><table><thead><tr><th scope="col">Status</th><th scope="col">What it means</th></tr></thead><tbody>${statuses}</tbody></table></div>
<h3 class="table-title">Monitoring a feed — compared with the file you trust</h3>
<div class="table-wrap"><table><thead><tr><th scope="col">Layer</th><th scope="col">What it looks for</th></tr></thead><tbody>${layers}</tbody></table></div>
<p class="note">A clean ×100 is a change of unit, reported under semantics; an arbitrary 83× is a wrong value, reported under distribution. Rules you set are shown in their own section, rule by rule, apart from the comparison.</p>
</div></section>
<section><div class="wrap">
<h2 id="formats">Formats are declared, never guessed</h2>
<p class="intro">Each file’s format is declared once. Where a value could be read two ways and nothing is declared, it is not read as a number or a date at all, so a disagreement shows instead of a guess. A file that is not valid UTF-8 is refused with the likely cause, never repaired.</p>
<div class="grid">
<div class="card"><h3>Encoding</h3><ul class="plain">${list(ENCODINGS)}</ul></div>
<div class="card"><h3>Decimal mark and grouping</h3><ul class="plain">${list(DECIMALS)}${list(GROUPINGS)}</ul></div>
<div class="card"><h3>Dates</h3><ul class="plain">${list(DATE_FORMATS)}</ul></div>
</div>
<p class="note">Keys can also declare “ignore leading zeros” (all-digit keys only) and “ignore case”.</p>
</div></section>
<section><div class="wrap">
<h2 id="identifiers">Identifiers it reads</h2>
<p class="intro">An identifier rule checks a value is what it says it is. The list is closed — an author cannot type a pattern — and each one is tested against reference values.</p>
<div class="table-wrap"><table><thead><tr><th scope="col">Identifier</th><th scope="col">Must hold</th></tr></thead><tbody>${Object.values(IDENTIFIERS).map((i) => `<tr><td>${h(i.label)}</td><td>${h(i.describe)}</td></tr>`).join('')}</tbody></table></div>
</div></section>
<section><div class="wrap">
<h2 id="masking">Sensitive columns</h2>
<div class="table-wrap"><table><thead><tr><th scope="col">Tag</th><th scope="col">How values leave the screen</th></tr></thead><tbody>${SENSITIVITIES.map((s) => `<tr><td>${h(s.label)}</td><td>${h(s.masked)}</td></tr>`).join('')}</tbody></table></div>
<p class="note">Counts, totals and record keys are not masked — keys find the record — except an Aadhaar column. More on the <a href="../security.html">security and privacy page</a>.</p>
</div></section>
<section><div class="wrap">
<h2 id="glossary">Glossary</h2>
<dl class="glossary">${GLOSSARY.map(([term, text]) => `<dt>${h(term)}</dt><dd>${h(text)}</dd>`).join('')}</dl>
<p class="note">Something missing or unclear? <a href="${LINKS.issues}">Ask on the issue tracker</a>.</p>
</div></section>`
}

// --- Command line -------------------------------------------------------------

const COMMANDS = [
  ['dcv check', CHECK_USAGE, 'Load readiness on a load file: will the target accept it? The contract may be a contract file, an imported ODCS contract or a migration object. --rejects writes the fix list; --reference opens a reference file a rule names; --key sets the record key.'],
  ['dcv reconcile', RECONCILE_USAGE, 'Reconciles a source extract against a target extract by business key, in five steps. The spec may be a migration object. --evidence writes the evidence pack.'],
  ['dcv change', CHANGE_USAGE, 'Checks a bulk change against its change contract: what may change, and how. Every column the contract does not name must stay the same. --approved is the signer’s approved list, --log the change log; --evidence writes the change record, --custody states who did what.'],
  ['dcv pack', PACK_USAGE, 'Lists the packs, or builds a migration object from one. A value only you know, such as the cutover date, is asked for with --param and never defaulted.'],
  ['dcv share', SHARE_USAGE, 'Writes the copy of a migration object that is safe to send: definitions and run counts, never the sign-off record, owners’ names, file names or record values.'],
  ['dcv odcs', ODCS_USAGE, 'Exports a contract to the Open Data Contract Standard v3.2.0, losslessly, or imports one, listing everything that could not be imported exactly.'],
]

function cli() {
  return `${hero('Command line', 'The same checks, in a pipeline.', 'The <code>dcv</code> command runs the engine the workspace runs, on files of any size, streamed and partitioned on local disk in bounded memory. It reads the same <code>.migration.json</code> the workspace saves, so people and pipelines work from one file.')}
<section><div class="wrap">
<h2 id="install">Install</h2>
<p class="intro">The first release to the public npm registry has not been made yet. Until it is, run the command from a copy of the repository (Node 20.19+ or 22.12+):</p>
<pre class="code"><code>git clone ${LINKS.repo}.git
cd data-contract-validator
npm ci
node bin/dcv.mjs --version</code></pre>
<p class="note">Once released, it installs as <code>npm install --global data-contract-validator</code>, and the command is <code>dcv</code>. A Dockerfile in the repository builds the same package as a container.</p>
</div></section>
<section><div class="wrap">
<h2 id="commands">Commands</h2>
${COMMANDS.map(([name, usage, text]) => `<article class="command"><h3 id="${h(name.replace(/\s+/g, '-'))}"><code>${h(name)}</code></h3><p>${h(text)}</p><pre class="code"><code>${h(usage)}</code></pre></article>`).join('\n')}
</div></section>
<section><div class="wrap">
<h2 id="exit-codes">Exit codes and outputs</h2>
<div class="table-wrap"><table><thead><tr><th scope="col">Exit code</th><th scope="col">Meaning</th></tr></thead><tbody>
<tr><td><code>0</code></td><td>Every check passed.</td></tr>
<tr><td><code>1</code></td><td>A check found something.</td></tr>
<tr><td><code>2</code></td><td>The check could not be completed, including “could not confirm”. A pipeline should stop on it.</td></tr>
</tbody></table></div>
<ul class="plain spaced">
<li><code>--json</code> prints a report described by a published JSON Schema (<code>schemas/</code>). Fields may be added within a version, never removed or renamed.</li>
<li><code>--junit</code> writes one test case per step or rule. It carries sentences and counts, never a record: CI logs are widely read.</li>
<li><code>--unmask</code> lifts masking of tagged columns for that one output, and the output says so. Aadhaar stays masked.</li>
<li>Options are parsed strictly: an unknown option is refused, never ignored.</li>
<li>Excel workbooks are read in the browser only; save them as CSV for the command line.</li>
</ul>
</div></section>
<section><div class="wrap">
<h2 id="example">An example run</h2>
<pre class="code"><code>node bin/dcv.mjs pack hr-payroll-zoho-payroll employee-master --param cutoverDate=2026-10-01 --out employees.migration.json
node bin/dcv.mjs check employees.migration.json load.csv --reference locations=locations.csv --rejects fixes.csv
node bin/dcv.mjs reconcile employees.migration.json legacy.csv zoho.csv --evidence pack.html --junit reconcile.xml</code></pre>
</div></section>`
}

// --- Pack reference -------------------------------------------------------------

const ROLE_NAMES = { load: 'Load file', source: 'Source extract', target: 'Target extract' }
const label = (list, id) => list.find((x) => x.id === id)?.label ?? id

function describeFormat(format = {}) {
  const parts = []
  if (format.encoding && format.encoding !== 'utf-8') parts.push(label(ENCODINGS, format.encoding))
  if (format.decimal) parts.push(label(DECIMALS, format.decimal))
  if (format.grouping) parts.push(label(GROUPINGS, format.grouping))
  if (format.date) parts.push(`dates ${label(DATE_FORMATS, format.date)}`)
  return parts.length ? parts.join(' · ') : 'Nothing declared: UTF-8, and only numbers and dates that cannot be read two ways'
}

function paramText(text, params = []) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, id) => `‹${params.find((p) => p.id === id)?.label?.split(' — ')[0]?.toLowerCase() ?? id}›`)
}

function packReference(pack) {
  const objects = pack.objects.map((o) => {
    const roles = Object.entries(o.columns ?? {})
    const rules = o.contract?.rules ?? []
    const spec = o.spec ?? {}
    const tags = Object.entries(o.tags ?? {})
    const columnTable = `<div class="table-wrap"><table><thead><tr><th scope="col">File</th><th scope="col">Expected headers</th><th scope="col">Format</th></tr></thead><tbody>${roles.map(([role, cols]) => `<tr><td>${h(ROLE_NAMES[role] ?? role)}</td><td class="mono-cell">${cols.map(h).join(', ')}</td><td>${h(describeFormat(o.formats?.[role]))}</td></tr>`).join('')}</tbody></table></div>`
    const ruleTable = rules.length
      ? `<div class="table-wrap"><table><thead><tr><th scope="col">Rule</th><th scope="col">If it fails</th></tr></thead><tbody>${rules.map((r) => `<tr><td>${h(paramText(describeRule(r), o.params))}</td><td>${ruleSeverity(r) === 'warn' ? 'A warning' : 'The record is rejected'}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="note">No rules on the load file: this object is proved by reconciliation alone.</p>'
    const key = spec.key ? `<p><b>Matched by</b> ${h(spec.key.source.join(' + '))} → ${h(spec.key.target.join(' + '))}${spec.key.normalize?.length ? ` (${h(spec.key.normalize.map((n) => (n === 'ignoreCase' ? 'ignoring case' : 'ignoring leading zeros')).join(', '))})` : ''}.</p>` : ''
    const mapping = spec.mapping?.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Source field</th><th scope="col">Target field</th><th scope="col">Compared</th></tr></thead><tbody>${spec.mapping.map((m) => {
      const how = [m.map ? `through a crosswalk of ${Object.keys(m.map).length} values` : null, m.tolerance ? `within ± ${m.tolerance}` : null, m.ignoreCase ? 'ignoring case' : null].filter(Boolean).join(', ') || 'exactly'
      return `<tr><td class="mono-cell">${h(m.source)}</td><td class="mono-cell">${h(m.target)}</td><td>${h(how)}</td></tr>`
    }).join('')}</tbody></table></div>` : ''
    const totals = spec.totals?.length ? `<ul class="plain spaced">${spec.totals.map((t) => {
      const what = t.fn === 'count' ? 'Count of records' : `Sum of ${t.source} against ${t.target}`
      const per = t.groupBy ? `, per ${t.groupBy.source} / ${t.groupBy.target}${t.groupBy.map ? ' through a crosswalk' : ''}` : ''
      return `<li>${h(what + per)}</li>`
    }).join('')}</ul>` : ''
    const crosswalks = (spec.mapping ?? []).filter((m) => m.map).map((m) => `<details><summary>Crosswalk: ${h(m.source)} → ${h(m.target)} (${Object.keys(m.map).length})</summary><div class="table-wrap"><table><thead><tr><th scope="col">${h(m.source)}</th><th scope="col">${h(m.target)}</th></tr></thead><tbody>${Object.entries(m.map).map(([a, b]) => `<tr><td>${h(a)}</td><td>${h(b)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')
    return `<article class="pack" id="${h(o.id)}">
<h2>${h(o.name)}</h2>
<p class="intro">${h(o.scope)}</p>
${o.guide ? `<dl class="glossary guide"><dt>Export</dt><dd>${h(o.guide.export)}</dd><dt>Load</dt><dd>${h(o.guide.load)}</dd><dt>Compare</dt><dd>${h(o.guide.compare)}</dd></dl>` : ''}
${o.params?.length ? `<p class="note">Asked for when the object is built, never defaulted: ${h(o.params.map((p) => `${p.label} (--param ${p.id}=…)`).join('; '))}.</p>` : ''}
<h3 class="table-title">Files</h3>${columnTable}
<h3 class="table-title">Before the load — ${rules.length} rule${rules.length === 1 ? '' : 's'}</h3>${ruleTable}
<h3 class="table-title">After the load — reconciliation</h3>${key}${mapping}${totals}${crosswalks}
${tags.length ? `<h3 class="table-title">Sensitive columns</h3><p>${tags.map(([c, t]) => `<code>${h(c)}</code> ${h(t)}`).join(' · ')}</p>` : ''}
<pre class="code"><code>dcv pack ${h(pack.id)} ${h(o.id)}${(o.params ?? []).map((p) => ` --param ${h(p.id)}=…`).join('')} --out ${h(o.id)}.migration.json</code></pre>
</article>`
  }).join('\n')
  const draft = pack.status === 'draft'
  return `${hero(`Pack reference · v${pack.version}`, pack.name, `${h(pack.path.source)} → ${h(pack.path.target)}. Every expected header, rule, mapping and control total below is read from the pack file the app and the command line use.`)}
<section><div class="wrap">
<p><span class="chip ${draft ? 'draft' : 'pass'}">${draft ? 'Draft — not yet run on real exports' : 'Verified'}</span></p>
<nav class="toc" aria-label="Objects in this pack"><ul>${pack.objects.map((o) => `<li><a href="#${h(o.id)}">${h(o.name)}</a></li>`).join('')}</ul></nav>
${pack.toConfirm?.length ? `<details open><summary>To confirm with the first pilot (${pack.toConfirm.length})</summary><ul class="plain">${pack.toConfirm.map((t) => `<li>${h(t)}</li>`).join('')}</ul></details>` : ''}
${pack.sources?.length ? `<details><summary>Sources for the target’s values (${pack.sources.length})</summary><ul class="plain">${pack.sources.map((s) => `<li><a href="${h(s.url)}">${h(s.what)}</a>, read ${h(s.read)}</li>`).join('')}</ul></details>` : ''}
${objects}
</div></section>`
}

// --- Changelog ------------------------------------------------------------------
// Written by hand from the merged pull requests. Dates are merge dates.

const CHANGES = [
  { when: 'Not yet released', items: ['The product is named Plumbstep on screen, with its logo, the Geist typefaces, a six-size type scale and a two-row bar.', 'This website: the marketing pages, the help centre, the command-line docs, the pack reference, this changelog and the legal shells.'] },
  { when: '13 Nov 2026', items: ['Organisations: members, invitations and four roles — admin, editor, approver and viewer.', 'Migration objects saved to your account, and opened again on any device.'] },
  { when: '12 Nov 2026', items: ['The workspace in four steps, one on screen at a time, with a rail that shows each step’s status.', 'A first-visit home page, a guided tour beside the finance example, and a sign-in screen that lists what an account keeps and never keeps.'] },
  { when: '11 Nov 2026', items: ['The home page leads with the cutover job; the finance example, Tally to Zoho Books, comes first.', 'New rule kinds: identifiers (PAN, GSTIN, IFSC, UAN, PIN), uniqueness, totals and reference files.', 'The sign-off record: decisions, owners, scope and typed signatures in the evidence pack.', 'Packs: Finance (Tally to Zoho Books) and HR (mid-year payroll to Zoho Payroll), both drafts.', 'Column matching, sensitivity tags and masking, Excel workbooks in the browser, Indian digit grouping, and safe sharing of definitions.'] },
  { when: '28 Oct 2026', items: ['Migration assurance: load readiness, reconciliation in five steps, the evidence pack and the migration object workspace.', 'Files of any size on the command line; declared formats; ODCS import and export; accounts with row-level security.'] },
]

function changelog() {
  return `${hero('Changelog', 'What changed, and when.', 'Each entry is a change merged into the main branch, dated by its merge. There is no status page yet: a status page needs a monitoring service, and the app runs on your machine.')}
<section><div class="wrap">
${CHANGES.map((c) => `<article class="change"><h2>${h(c.when)}</h2><ul class="plain">${c.items.map((i) => `<li>${h(i)}</li>`).join('')}</ul></article>`).join('\n')}
<p class="note">Every change, with its tests: <a href="${LINKS.repo}/pulls?q=is%3Apr+is%3Amerged">the merged pull requests</a>.</p>
</div></section>`
}

// --- Legal shells ---------------------------------------------------------------

function legal() {
  const shell = (id, title, text, covers) => `<article class="pack" id="${id}"><div class="pack-head"><h2>${h(title)}</h2><span class="chip skip">Not yet written</span></div><p class="intro">${h(text)}</p><p class="note">When written, it will cover:</p><ul class="plain">${covers.map((c) => `<li>${h(c)}</li>`).join('')}</ul></article>`
  return `${hero('Legal', 'Terms, privacy and data processing.', 'These documents need a lawyer, and have not been written yet. Until they are, nothing on this site is a binding term, and no commitment beyond the open-source licence is offered. What the code does is described, as fact, on the security and privacy page.')}
<section><div class="wrap">
<article class="pack" id="licence"><div class="pack-head"><h2>Licence</h2><span class="chip pass">In force</span></div><p class="intro">The code — the engine, the app and the <code>dcv</code> command — is open source under the Apache License 2.0. The licence text is in the repository.</p><p><a href="${LINKS.repo}/blob/main/LICENSE">Read the licence</a></p></article>
${shell('terms', 'Terms of use', 'The terms for using the hosted app and an account.', ['Who may use the service, and the pilot’s terms.', 'What an account holds: rules, names and counts, never a record.', 'Availability, changes and ending an account.'])}
${shell('privacy', 'Privacy notice', 'What personal data the service itself processes, and why.', ['The email address and organisation memberships of an account.', 'That files opened in the app are read on your device and never received by the service.', 'Signer names typed into a sign-off are kept where you save the object.'])}
${shell('dpa', 'Data processing agreement', 'For organisations that need one in place before a pilot.', ['The account data processed on your behalf, and where it is stored.', 'Sub-processors, such as the database host.', 'Security measures, breach notice and deletion.'])}
<p class="note">Need one of these before a pilot? <a href="${LINKS.issues}">Tell us</a>.</p>
</div></section>`
}

export function docsBody(page, { ISSUES, REPO }) {
  LINKS.issues = ISSUES
  LINKS.repo = REPO
  let body
  if (page.file === 'docs/index.html') body = helpCentre()
  else if (page.file === 'docs/cli.html') body = cli()
  else if (page.file === 'docs/changelog.html') body = changelog()
  else if (page.file === 'docs/legal.html') body = legal()
  else body = packReference(page.pack)
  return docsNav(page.file) + body
}

export const packReferenceFile = (pack) => packFile(pack)
