#!/usr/bin/env node
// The Plumbstep marketing site (brand Phase B). Plain static HTML, generated
// here into dist-site/: the pages at the root, the built app copied under app/
// — one static build, served from one origin. No script on any page, no
// external request (a CSP meta says so even if a page were edited by hand).
// The Packs page is built from src/packs, so it cannot drift from what ships.
//
//   npm run build && npm run build:site     → dist-site/
//
// Every sentence here must be true of the code today. site.test.js scans the
// pages for the claims the sign-off record may never make (NEVER_CLAIM).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PACKS } from '../src/packs/index.js'
import { SENSITIVITIES } from '../src/lib/masking.js'
import { DEFAULT_OWNERS, STATEMENT_OF_CLAIM } from '../src/lib/signoff.js'
import { docsBody, DOCS_PAGES, packReferenceFile } from './site-docs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ISSUES = pkg.bugs?.url ?? 'https://github.com/AbhikM-Create/data-contract-validator/issues'
const REPO = ISSUES.replace(/\/issues$/, '')

const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const PAGES = [
  { file: 'index.html', nav: null, title: 'Plumbstep — prove the cutover', description: 'Check a load file before it goes in, reconcile the target against the source after, and keep the sign-off record. Your records stay on your computer.' },
  { file: 'partners.html', nav: 'For partners', title: 'For implementation partners — Plumbstep', description: 'One way to prove every migration object, client after client, without taking their data.' },
  { file: 'teams.html', nav: 'For finance and HR', title: 'For finance and HR teams — Plumbstep', description: 'Check that your ledgers and your people arrived whole in the new system, and keep the record of it.' },
  { file: 'packs.html', nav: 'Packs', title: 'Packs — Plumbstep', description: 'Ready-made checks for a source → target path: Tally to Zoho Books, and mid-year payroll to Zoho Payroll.' },
  { file: 'security.html', nav: 'Security and privacy', title: 'Security and privacy — Plumbstep', description: 'What Plumbstep reads, what it keeps, and what never leaves your computer.' },
  { file: 'pricing.html', nav: 'Pricing', title: 'Pricing — Plumbstep', description: 'Free while in pilot.' },
  { file: 'docs/index.html', nav: 'Docs', navFor: 'docs/' },
  ...DOCS_PAGES.filter((p) => p.file !== 'docs/index.html'),
].map((page) => ({ ...DOCS_PAGES.find((d) => d.file === page.file), ...page }))

const APP = 'app/' // from a page at the root
const MARK = (inverse = false) => {
  const ink = inverse ? '#F4F6F8' : '#16222B'
  const plumb = inverse ? '#5AAECB' : '#1F6F8B'
  return `<svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><path d="M6 12H18V24H30V36H40" fill="none" stroke="${ink}" stroke-width="5.5" stroke-linejoin="round"/><line x1="50" y1="5" x2="50" y2="40" stroke="${plumb}" stroke-width="4"/><path d="M42.5 40H57.5L50 59Z" fill="${plumb}"/></svg>`
}

// Scripts none; styles and fonts from this origin; images only the inline mark.
const CSP = "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"

// A box that can scroll sideways (a wide table, a long command) must take
// keyboard focus, or a keyboard user cannot scroll it (WCAG 2.1.1).
const focusable = (body) => body.replaceAll('<div class="table-wrap">', '<div class="table-wrap" tabindex="0">').replaceAll('<pre class="code">', '<pre class="code" tabindex="0">')

function layout(page, body) {
  // Pages under docs/ reach the root through ../ — every link stays relative,
  // so the site works from any folder or path prefix.
  const up = '../'.repeat(page.file.split('/').length - 1)
  const current = (p) => p.file === page.file || (p.navFor && page.file.startsWith(p.navFor))
  const nav = PAGES.filter((p) => p.nav).map((p) => `<a href="${up}${p.file}"${current(p) ? ' aria-current="page"' : ''}>${h(p.nav)}</a>`).join('')
  const APP = `${up}app/`
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${h(page.title)}</title>
<meta name="description" content="${h(page.description)}">
<meta name="theme-color" content="#16222B">
<link rel="icon" href="${up}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${up}site.css">
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="bar"><div class="wrap">
<a class="brand" href="${up}index.html" aria-label="Plumbstep home">${MARK()}<span>Plumbstep</span></a>
<nav class="nav" aria-label="Site">${nav}</nav>
<span class="spacer"></span>
<a class="btn primary small" href="${APP}">Open the workspace</a>
</div></header>
<main id="main">
${focusable(body)}
</main>
<footer><div class="wrap">
<div>
<a class="brand" href="${up}index.html" aria-label="Plumbstep home">${MARK()}<span>Plumbstep</span></a>
<p class="fine">Files stay on your device. Plumbstep proves a load; it never performs one. The engine, the app and the <code>dcv</code> command are open source under Apache-2.0, as <code>data-contract-validator</code>.</p>
</div>
<div class="cols">
<div><h3>Product</h3><ul><li><a href="${APP}">Open the workspace</a></li><li><a href="${up}packs.html">Packs</a></li><li><a href="${up}pricing.html">Pricing</a></li></ul></div>
<div><h3>Docs</h3><ul><li><a href="${up}docs/index.html">Help centre</a></li><li><a href="${up}docs/cli.html">Command line</a></li><li><a href="${up}docs/changelog.html">Changelog</a></li></ul></div>
<div><h3>Who it is for</h3><ul><li><a href="${up}partners.html">Implementation partners</a></li><li><a href="${up}teams.html">Finance and HR teams</a></li></ul></div>
<div><h3>Trust</h3><ul><li><a href="${up}security.html">Security and privacy</a></li><li><a href="${up}docs/legal.html">Legal</a></li><li><a href="${REPO}">Source code</a></li><li><a href="${ISSUES}">Report a problem</a></li></ul></div>
</div>
</div></footer>
</body>
</html>
`
}

// The staircase, drawn: one worked reconciliation of an opening trial balance.
// Every step runs; the first failure says what kind of problem it is.
const STAIR = [
  { label: 'Keys', status: 'pass', note: 'Every ledger has one name on each side.' },
  { label: 'Completeness', status: 'pass', note: '412 of 412 ledgers arrived.' },
  { label: 'Mapping', status: 'pass', note: 'Every Tally group has a Zoho account type.' },
  { label: 'Accuracy', status: 'fail', note: '2 ledgers arrived with a different balance.', flag: 'Caught here' },
  { label: 'Totals', status: 'fail', note: 'Debit total differs by ₹4,800.' },
]
const staircase = () => `<figure class="stair" aria-label="Example report: an opening trial balance reconciled, Tally to Zoho Books">
<div class="stair-head"><h3>Opening trial balance · after the load</h3><span class="mono">tally_tb.csv → zoho_tb.csv</span></div>
<div class="steps">${STAIR.map((s, i) => `<div class="step${s.flag ? ' caught' : ''}"><span class="chip ${s.status}">${s.status === 'pass' ? 'Pass' : 'Fail'}</span><b>${i + 1}. ${h(s.label)}</b><span class="small">${h(s.note)}</span>${s.flag ? `<span class="flag">${h(s.flag)}</span>` : ''}</div>`).join('')}</div>
<figcaption class="stair-foot"><b>Keys, completeness and mapping passed, and accuracy is where the load stopped.</b> Every ledger arrived and every group mapped, so the fault is in the amounts — ${h(DEFAULT_OWNERS.accuracy.toLowerCase())}’s to fix, not the functional team’s mapping. An illustration; every figure is invented.</figcaption>
</figure>`

const home = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">Data assurance for ERP, HCM and CRM cutovers</span>
<h1>Prove every record arrived, before you sign off the cutover.</h1>
<p class="lead">Plumbstep checks a load file before it goes in, reconciles the new system against the old one after, and writes the record your sign-off rests on. It runs on your computer: the records never leave it.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="packs.html">See the packs</a></div>
<p class="trust">No account needed. Open a file from your computer; nothing is uploaded.</p>
${staircase()}
</div></section>

<section><div class="wrap">
<span class="eyebrow">Three questions, three checks</span>
<h2>A cutover asks the same three things of every file.</h2>
<div class="grid">
<div class="card"><span class="num">Before the load</span><h3>Will the target accept this file?</h3><p>Your rules and the pack’s, record by record: missing values, bad PANs and GSTINs, dates after the cutover, duplicates, totals that do not balance. You get a fix list naming whose fix each line is.</p></div>
<div class="card"><span class="num">After the load</span><h3>Did every record arrive, correctly?</h3><p>Matched by business key, in five steps: keys, completeness, mapping, accuracy and control totals. An unmapped value is a mapping gap, never counted as a wrong amount — so the right person gets the fix.</p></div>
<div class="card"><span class="num">After go-live</span><h3>Has this feed drifted?</h3><p>Compare each new file with one you trust: columns, values, freshness and distribution. A ×100 that is a change of unit is told apart from a number that is simply wrong.</p></div>
</div>
</div></section>

<section class="band"><div class="wrap">
<span class="eyebrow">The sign-off record</span>
<h2>Evidence that stands on its own.</h2>
<p class="intro">Each check writes one self-contained document: which files (named by the SHA-256 of their bytes), which rules, what passed, every difference with its decision and owner, and what was not checked. It says exactly what it claims, and nothing more:</p>
<blockquote>${h(STATEMENT_OF_CLAIM)}</blockquote>
<div class="grid">
<div class="card"><h3>Out of date shows</h3><p>A result stays in the record only while it still matches the files and the definitions it ran on. Change either, and it reads “Out of date — run again”.</p></div>
<div class="card"><h3>Personal data masked</h3><p>Tag a column as personal, identifier, pay or Aadhaar, and its values are masked wherever a report leaves the screen.</p></div>
<div class="card"><h3>Signatures as typed</h3><p>Names and dates are recorded as people typed them, and the record says they are unverified: it records who signed, it does not vouch for them.</p></div>
</div>
</div></section>

<section><div class="wrap">
<span class="eyebrow">Start here</span>
<h2>Who it is for</h2>
<div class="grid two">
<a class="card" href="partners.html"><h3>Implementation partners</h3><p>The same proof on every object for every client, a record that travels to the client’s auditor, and nothing of theirs on your servers.</p><span>For partners →</span></a>
<a class="card" href="teams.html"><h3>Finance and HR teams</h3><p>Moving from Tally to Zoho Books, or payroll mid-year? Check the opening balances and every employee arrived — yourself, before you sign.</p><span>For finance and HR →</span></a>
</div>
</div></section>`

const partners = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">For implementation partners</span>
<h1>One way to prove every object, for every client.</h1>
<p class="lead">Your consultants already reconcile in spreadsheets, each their own way. Plumbstep gives every migration object the same descent, the same fix list and the same sign-off record — and keeps the client’s data on the machine where it already is.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="pricing.html">Pilot terms</a></div>
</div></section>
<section><div class="wrap">
<h2>What changes on a project</h2>
<div class="grid">
<div class="card"><h3>Every mock load, judged the same way</h3><p>A migration object holds the rules, the mapping, the declared file formats and each run’s counts. Run mock 1, 2 and 3 against it and the cycle history sets each run beside the last.</p></div>
<div class="card"><h3>The right fix to the right team</h3><p>Each failing step names whose fix it is — the source data owner, the functional team, the load team or the transformation team. Owners are editable per object.</p></div>
<div class="card"><h3>Definitions travel, data does not</h3><p>Share definitions sends only rules, mappings and run counts. Never the sign-off, owners’ names, file names or record values; a key map never leaves.</p></div>
<div class="card"><h3>Their headers, your definitions</h3><p>A client’s export rarely uses the expected headers. Match columns from dropdowns once; the match is saved with the object and printed in the record.</p></div>
<div class="card"><h3>A pipeline can run it too</h3><p>The <code>dcv</code> command runs the same checks on files of millions of rows, with exit codes and JSON or JUnit output for CI.</p></div>
<div class="card"><h3>Organisations and roles</h3><p>With an account, an organisation keeps its objects: admin, editor, approver and viewer. Files are never shared — each member opens them on their own machine.</p></div>
</div>
</div></section>`

const teams = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">For finance and HR teams</span>
<h1>Check the new system before you sign for it.</h1>
<p class="lead">You know the ledgers and the people. Plumbstep lets you check them yourself: open the export from the old system and the one from the new, and see what is missing, what changed and what does not add up.</p>
<div class="actions"><a class="btn primary" href="${APP}">Try the finance example</a><a class="btn" href="packs.html">What the packs check</a></div>
</div></section>
<section><div class="wrap">
<div class="grid two">
<div class="card"><span class="num">Finance · Tally to Zoho Books</span><h3>Opening balances, parties and GST</h3><ul class="plain"><li>Debits equal credits in the opening trial balance, before it is loaded.</li><li>Every ledger arrived with its balance, and every Tally group has a Zoho account type.</li><li>Open receivables and payables by party; GSTINs checked, check character included.</li></ul></div>
<div class="card"><span class="num">HR · mid-year to Zoho Payroll</span><h3>Employees, prior payroll and TDS</h3><ul class="plain"><li>PAN, UAN and IFSC read as what they are; no joining date after the cutover.</li><li>Headcount by work location, legacy against Zoho.</li><li>Year-to-date pay, TDS, PF and professional tax per employee; TDS deducted against deposited.</li></ul></div>
</div>
<p class="note">Formats are declared, never guessed: Indian digit grouping (1,23,456.78), decimal commas, day-first dates. A value that could be read two ways is not read at all, so a disagreement shows instead of a guess.</p>
</div></section>`

function packsPage() {
  const cards = PACKS.map((pack) => {
    const objects = pack.objects.map((o) => {
      const rules = o.contract?.rules?.length ?? 0
      const totals = o.spec?.totals?.length ?? 0
      const meta = [rules ? `${rules} rule${rules === 1 ? '' : 's'} before the load` : 'no load rules', o.spec?.key?.target?.length ? `matched by ${o.spec.key.target.join(' + ')}` : null, totals ? `${totals} control total${totals === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
      return `<div class="object"><h3>${h(o.name)}</h3><p>${h(o.scope)}</p><span class="meta">${h(meta)}</span>${o.params?.length ? `<span class="meta">Asks for: ${h(o.params.map((p) => p.label).join('; '))}</span>` : ''}</div>`
    }).join('')
    const draft = pack.status === 'draft'
    return `<article class="pack" id="${h(pack.id)}">
<div class="pack-head"><div><h2>${h(pack.name)}</h2><p class="path">${h(pack.path.source)} → ${h(pack.path.target)} · <code>${h(pack.id)}</code> v${h(pack.version)}</p></div>
<span class="chip ${draft ? 'draft' : 'pass'}">${draft ? 'Draft — not yet run on real exports' : `Verified ${h(pack.verified?.date ?? '')}`}</span></div>
<div class="objects">${objects}</div>
<p class="note"><a href="${packReferenceFile(pack)}">Every column, rule and mapping in this pack</a></p>
${pack.toConfirm?.length ? `<details><summary>To confirm with the first pilot (${pack.toConfirm.length})</summary><ul class="plain">${pack.toConfirm.map((t) => `<li>${h(t)}</li>`).join('')}</ul></details>` : ''}
${pack.sources?.length ? `<details><summary>Where the target’s values come from (${pack.sources.length})</summary><ul class="plain">${pack.sources.map((s) => `<li><a href="${h(s.url)}">${h(s.what)}</a>, read ${h(s.read)}</li>`).join('')}</ul></details>` : ''}
</article>`
  }).join('\n')
  return `<section class="hero"><div class="wrap">
<span class="eyebrow">Packs</span>
<h1>Ready-made checks for one path.</h1>
<p class="lead">A pack holds, for one source → target path, each object’s expected headers, the target’s rules, a mapping, the declared formats and which columns are sensitive. Standard codes only — never a client’s values. Start an object from a pack in the workspace, or with <code>dcv pack</code>.</p>
<p class="note">A pack is a draft until a pilot has run it on real exports; a draft says so wherever it is shown. Pack values the client must agree, such as the cutover date or the group-to-type crosswalk, are asked for, never defaulted.</p>
</div></section>
<section><div class="wrap">
${cards}
<p class="note">Your path not here? greytHR, for one, waits on a pilot’s import templates. <a href="${ISSUES}">Tell us which path you need.</a></p>
</div></section>`
}

const security = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">Security and privacy</span>
<h1>Your records stay on your computer.</h1>
<p class="lead">Plumbstep reads files in your browser, or on the machine running the <code>dcv</code> command. There is no server that receives them. This page lists what is kept and where — each line true of the code today.</p>
</div></section>
<section><div class="wrap">
<h2>What goes where</h2>
<div class="table-wrap"><table>
<thead><tr><th scope="col">What</th><th scope="col">Where it goes</th><th scope="col">Record values in it?</th></tr></thead>
<tbody>
<tr><td>The files you open</td><td>Read in your browser’s memory, or streamed from disk by <code>dcv</code></td><td class="no">Never leave your machine</td></tr>
<tr><td>A saved contract</td><td>A file you download, or your account</td><td class="no">No — rules, a name, its format</td></tr>
<tr><td>A migration object</td><td>A file you download, or your account</td><td class="no">No — definitions, typed sign-off, run counts</td></tr>
<tr><td>Shared definitions</td><td>A file you send to someone</td><td class="no">No — and no sign-off, owners or file names</td></tr>
<tr><td>The evidence pack</td><td>A file built on your machine, handed to you</td><td class="yes">Yes, as evidence — sensitive columns masked</td></tr>
<tr><td>The fix list</td><td>A file you download</td><td class="yes">Yes — sensitive columns masked</td></tr>
</tbody></table></div>
<p class="note">Each of these boundaries is enforced in one place in the code and proved by a test that plants real values and checks none reaches the stored form.</p>
</div></section>
<section><div class="wrap">
<h2>Masking</h2>
<p class="intro">Tag a column and its values are masked wherever a report leaves the screen — the evidence pack, the fix list, exported findings and the command line’s output. On screen, values stay visible. Unmasking is a per-output choice, and the output then says so; Aadhaar stays masked regardless.</p>
<div class="table-wrap"><table>
<thead><tr><th scope="col">Tag</th><th scope="col">How values leave</th></tr></thead>
<tbody>${SENSITIVITIES.map((s) => `<tr><td>${h(s.label)}</td><td>${h(s.masked)}</td></tr>`).join('')}</tbody>
</table></div>
<p class="note">Masking is one safeguard among others; it does not by itself make any processing lawful under any law.</p>
</div></section>
<section><div class="wrap">
<h2>Accounts, if you use one</h2>
<ul class="plain spaced">
<li>Everything works without an account. An account saves contracts, run summaries and migration objects — rules, names and counts, never a record.</li>
<li>Each row is visible only to its owner, or to members of its organisation by role, enforced by the database’s row-level security and tested on a real Postgres.</li>
<li>The app and these pages load no script or font from anywhere else; a Content-Security-Policy forbids it.</li>
</ul>
<p class="note">Found a security problem? <a href="${ISSUES}">Report it</a> — without including any client data.</p>
</div></section>`

const pricing = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">Pricing</span>
<h1>Free while in pilot.</h1>
<p class="lead">Plumbstep is in pilot with its first projects. The workspace, the packs and the <code>dcv</code> command are free to use while it is. Paid plans for partners and organisations will follow what pilots tell us they need.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="${ISSUES}">Talk to us</a></div>
</div></section>
<section><div class="wrap">
<h2>What you get today</h2>
<div class="table-wrap"><table>
<thead><tr><th scope="col">Feature</th><th scope="col">Without an account</th><th scope="col">With an account</th></tr></thead>
<tbody>
<tr><td>Readiness, reconciliation and drift checks</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Packs and the evidence pack</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Objects saved as files you download</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Objects saved to your account, on any device</td><td class="no">—</td><td class="yes">Yes</td></tr>
<tr><td>Organisations, members and roles</td><td class="no">—</td><td class="yes">Yes</td></tr>
</tbody></table></div>
<p class="note">A pilot means a project uses it on real exports and tells us what broke. That is also how a draft pack becomes verified.</p>
</div></section>`

const BODIES = { 'index.html': home, 'partners.html': partners, 'teams.html': teams, 'packs.html': packsPage, 'security.html': security, 'pricing.html': pricing }

// Builds into `out`. `app` is the built app (dist/) to copy under app/, or null.
export function buildSite({ out, app = null }) {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'assets', 'fonts'), { recursive: true })
  mkdirSync(join(out, 'docs'), { recursive: true })
  for (const page of PAGES) writeFileSync(join(out, page.file), layout(page, BODIES[page.file] ? BODIES[page.file]() : docsBody(page, { ISSUES, REPO })))
  cpSync(join(root, 'site', 'site.css'), join(out, 'site.css'))
  cpSync(join(root, 'public', 'favicon.svg'), join(out, 'favicon.svg'))
  for (const font of ['Geist.woff2', 'GeistMono.woff2', 'OFL.txt']) cpSync(join(root, 'src', 'fonts', font), join(out, 'assets', 'fonts', font))
  if (app) cpSync(app, join(out, 'app'), { recursive: true })
  return PAGES.map((p) => p.file)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = join(root, 'dist-site')
  const app = join(root, 'dist')
  const hasApp = existsSync(join(app, 'index.html'))
  const files = buildSite({ out, app: hasApp ? app : null })
  console.log(`Built ${files.length} pages into dist-site/${hasApp ? ', with the app under app/' : ''}.`)
  if (!hasApp) console.log('No dist/ found: run `npm run build` first to include the app under app/.')
}
