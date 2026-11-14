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
import { STATEMENT_OF_CLAIM } from '../src/lib/signoff.js'
import { CHANGE_OWNERS, CHANGE_STEPS } from '../src/lib/changeContract.js'
import { isoStair } from '../src/components/isoStair.js'
import { docsBody, DOCS_PAGES, packReferenceFile } from './site-docs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ISSUES = pkg.bugs?.url ?? 'https://github.com/AbhikM-Create/data-contract-validator/issues'
const REPO = ISSUES.replace(/\/issues$/, '')

const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const PAGES = [
  { file: 'index.html', nav: null, title: 'Plumbstep — the independent check on business records', description: 'Whoever changed your records shouldn’t be the one who checks them. Plumbstep shows what changed, whether it was allowed, and whose fix each difference is — and your records stay on your computer.' },
  { file: 'teams.html', nav: 'Finance and HR', title: 'For finance and HR teams — Plumbstep', description: 'Before you sign for a migration, a salary revision or an AI run, check it yourself: what changed, what was allowed, and what does not add up.' },
  { file: 'auditors.html', nav: 'CAs and auditors', title: 'For CAs and auditors — Plumbstep', description: 'A record of a data change you can re-check yourself: the files by SHA-256, the rules in full, who did what, and what was not checked.' },
  { file: 'partners.html', nav: 'Partners', title: 'For implementation partners and bureaus — Plumbstep', description: 'Make your work independently checkable: the client’s rules, the client’s check, the same record for every object and every client.' },
  { file: 'packs.html', nav: 'Packs', title: 'Packs — Plumbstep', description: 'Ready-made checks for a source → target path: Tally to Zoho Books, and mid-year payroll to Zoho Payroll.' },
  { file: 'security.html', nav: 'Security', title: 'Security and privacy — Plumbstep', description: 'What Plumbstep reads, what it keeps, and what never leaves your computer.' },
  { file: 'pricing.html', nav: 'Pricing', title: 'Pricing — Plumbstep', description: 'Free while in pilot.' },
  { file: 'docs/index.html', nav: 'Docs', navFor: 'docs/' },
  ...DOCS_PAGES.filter((p) => p.file !== 'docs/index.html'),
].map((page) => ({ ...DOCS_PAGES.find((d) => d.file === page.file), ...page }))

// The app's page by name: a host given a file list (the Artifact host) may not
// serve a folder's index.
const APP = 'app/index.html' // from a page at the root
// The mark, coloured by the stylesheet so it follows the light and dark themes.
const MARK = () => '<svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><path class="ink" d="M6 12H18V24H30V36H40" fill="none" stroke-width="5.5" stroke-linejoin="round"/><line class="plumb-line" x1="50" y1="5" x2="50" y2="40" stroke-width="4"/><path class="plumb-bob" d="M42.5 40H57.5L50 59Z"/></svg>'

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
  const APP = `${up}app/index.html`
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${h(page.title)}</title>
<meta name="description" content="${h(page.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#EEF3F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A1117" media="(prefers-color-scheme: dark)">
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
<p class="fine">The independent check on business records as they change hands. Files stay on your device; Plumbstep checks a change, it never makes one. The engine, the app and the <code>dcv</code> command are open source under Apache-2.0, as <code>data-contract-validator</code>.</p>
</div>
<div class="cols">
<div><h3>Product</h3><ul><li><a href="${APP}">Open the workspace</a></li><li><a href="${up}packs.html">Packs</a></li><li><a href="${up}pricing.html">Pricing</a></li></ul></div>
<div><h3>Docs</h3><ul><li><a href="${up}docs/index.html">Help centre</a></li><li><a href="${up}docs/cli.html">Command line</a></li><li><a href="${up}docs/changelog.html">Changelog</a></li></ul></div>
<div><h3>Who it is for</h3><ul><li><a href="${up}teams.html">Finance and HR teams</a></li><li><a href="${up}auditors.html">CAs and auditors</a></li><li><a href="${up}partners.html">Partners and bureaus</a></li></ul></div>
<div><h3>Trust</h3><ul><li><a href="${up}security.html">Security and privacy</a></li><li><a href="${up}docs/legal.html">Legal</a></li><li><a href="${REPO}">Source code</a></li><li><a href="${ISSUES}">Report a problem</a></li></ul></div>
</div>
</div></footer>
</body>
</html>
`
}

// The staircase, drawn isometric from the app's own geometry (isoStair.js): one
// worked change check, a salary revision. Every step runs; the step where the
// first failure shows says what kind of problem it is. Colours come from the
// stylesheet by class, so the drawing follows the light and dark themes.
const STAIR = [
  { status: 'pass', note: 'Every employee appears once in both files.' },
  { status: 'pass', note: 'No one added, no one removed.' },
  { status: 'fail', note: '“Bank account” changed for 3 employees; the contract says it must not.' },
  { status: 'fail', note: 'Basic rose 30% for 1 employee; the cap is 20%.' },
  { status: 'pass', note: 'Every approved revision arrived, as approved.' },
  { status: 'pass', note: 'The pay bill rose within the budget.' },
].map((s, i) => ({ ...s, ...CHANGE_STEPS[i] }))

function isoSvg(steps) {
  const lead = steps.findIndex((s) => s.status === 'fail')
  const stair = isoStair(steps.length)
  const [bx, by] = stair.steps[lead >= 0 ? lead : steps.length - 1].rest
  const faces = stair.steps.map((g, i) => `<g class="${i === lead ? 'lead' : steps[i].status}"><polygon class="r" points="${g.right}"/><polygon class="f" points="${g.front}"/><polygon class="t" points="${g.top}"/><text x="${g.label[0]}" y="${g.label[1] + 4}">${String(i + 1).padStart(2, '0')}</text></g>`).join('')
  return `<svg class="iso" viewBox="0 0 ${stair.width} ${stair.height}" aria-hidden="true" focusable="false"><ellipse class="shadow" cx="${stair.width / 2}" cy="${stair.height - 14}" rx="${Math.round(stair.width * 0.42)}" ry="12"/>${faces}<line class="beam" x1="${bx - 34}" y1="${stair.beamY}" x2="${bx + 34}" y2="${stair.beamY}"/><g class="plumb"><line x1="${bx}" y1="${stair.beamY}" x2="${bx}" y2="${by - 19}"/><ellipse cx="${bx}" cy="${by + 1}" rx="15" ry="5"/><polygon points="${bx - 9},${by - 19} ${bx + 9},${by - 19} ${bx},${by - 1}"/></g></svg>`
}

const staircase = () => {
  const lead = STAIR.findIndex((s) => s.status === 'fail')
  const above = STAIR.slice(0, lead).map((s) => s.label.toLowerCase())
  return `<figure class="stair" aria-label="Example report: a salary revision checked against its change contract">
<div class="stair-head"><h3>FY27 salary revision · change check</h3><span class="mono">payroll_oct.csv → payroll_nov.csv</span></div>
<div class="stair-body">${isoSvg(STAIR)}
<ol class="legend">${STAIR.map((s, i) => `<li${i === lead ? ' class="caught"' : ''}><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${i === lead ? '<span class="flag">CAUGHT HERE</span>' : ''}<b>${h(s.label)}</b><span class="small">${h(s.note)}</span></span><span class="chip ${s.status}">${s.status === 'pass' ? 'Pass' : 'Fail'}</span></li>`).join('')}</ol></div>
<figcaption class="stair-foot"><b>${h(above.join(' and ').replace(/^./, (c) => c.toUpperCase()))} passed; permitted fields is where the change stopped.</b> Someone touched a column the contract never allowed to change — ${h(CHANGE_OWNERS.permitted.toLowerCase())}’s to explain. An illustration; every figure is invented.</figcaption>
</figure>`
}

const home = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">Record assurance</span>
<h1>Whoever changed your records shouldn’t be the one who checks them.</h1>
<p class="lead">Plumbstep is the independent check on business records as they change hands — a migration, a salary revision, an AI run, a bureau’s clean-up. It shows what changed, whether that was allowed, and whose fix each difference is. It runs on your computer: the records never leave it.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="auditors.html">For CAs and auditors</a></div>
<p class="trust">No account needed. Open a file from your computer; your files are not sent anywhere.</p>
${staircase()}
</div></section>

<section><div class="wrap">
<span class="eyebrow">The gap</span>
<h2>Code, money and documents leave a trail when they change. Business records rarely do.</h2>
<div class="table-wrap"><table class="handoffs">
<thead><tr><th scope="col">What changes hands</th><th scope="col">How the change is usually proved</th></tr></thead>
<tbody>
<tr><td>Code</td><td>A reviewed change, with a permanent history</td></tr>
<tr><td>Money</td><td>Double entry and a bank statement: two records that must agree</td></tr>
<tr><td>Documents</td><td>Signatures, versions and dates</td></tr>
<tr class="records"><td>Employee masters, ledgers, payroll registers, vendor lists</td><td>Often a file in, a file out, and the word of whoever did the work</td></tr>
</tbody></table></div>
<p class="intro">Records change hands between systems (a migration, a new integration), between parties (a payroll bureau and its client, a CA firm and its client) and between people and AI (an agent that categorises or corrects). Plumbstep is built to be the second check on each of those handoffs.</p>
</div></section>

<section><div class="wrap">
<span class="eyebrow">Four checks, one engine</span>
<h2>Ask the question the handoff needs.</h2>
<div class="grid four">
<div class="card"><span class="num">Any bulk change</span><h3>Was this change allowed?</h3><p>Say what may change — this column freely, that one only within 20%, only for the approved list — and everything you did not name must stay as it was. The change check sorts every difference into allowed, not allowed, and approved but missing.</p></div>
<div class="card"><span class="num">Before a load</span><h3>Will the target accept this file?</h3><p>Your rules and the pack’s, record by record: missing values, bad PANs and GSTINs, dates after the cutover, duplicates, totals that do not balance. A fix list names whose fix each line is.</p></div>
<div class="card"><span class="num">After a load</span><h3>Did every record arrive, correctly?</h3><p>Matched by business key in five steps: keys, completeness, mapping, accuracy and control totals. An unmapped value is a mapping gap, never counted as a wrong amount — so the right person gets the fix.</p></div>
<div class="card"><span class="num">Every feed, after go-live</span><h3>Has this feed drifted?</h3><p>Compare each new file with one you trust: columns, values, freshness and distribution. A ×100 that is a change of unit is told apart from a number that is simply wrong.</p></div>
</div>
</div></section>

<section class="band"><div class="wrap">
<span class="eyebrow">The record</span>
<h2>A record someone else can re-check.</h2>
<p class="intro">Each check writes one self-contained document: the files named by the SHA-256 of their bytes, the rules printed in full with their fingerprint, every difference with whose fix it is, what was not checked, and the command that runs the check again. It says exactly what it claims, and nothing more:</p>
<blockquote>${h(STATEMENT_OF_CLAIM)}</blockquote>
<div class="grid">
<div class="card"><h3>Who did what, in writing</h3><p>The change record states who made the change, who exported each file and when, who wrote the rules and who ran the check — as typed, and said to be unverified. Without who exported the files, it is marked a draft.</p></div>
<div class="card"><h3>Self-checked says so</h3><p>If the rules, an export or the run came from whoever made the change, the record is labelled self-checked on its first page. Independence comes from who writes the rules and who runs the check — not from the tool.</p></div>
<div class="card"><h3>Personal data masked</h3><p>Tag a column as personal, identifier, pay or Aadhaar, and its values are masked wherever a report leaves the screen. A result that no longer matches its files reads “Out of date — run again”.</p></div>
</div>
</div></section>

<section><div class="wrap">
<span class="eyebrow">Start here</span>
<h2>Who it is for</h2>
<div class="grid">
<a class="card" href="teams.html"><h3>Whoever signs</h3><p>The controller, the CFO, the payroll head: check a migration, a revision or an AI run yourself before you sign for it.</p><span>For finance and HR →</span></a>
<a class="card" href="auditors.html"><h3>CAs and auditors</h3><p>A record you can re-check with <code>sha256sum</code> and one command, that names who did what and what it does not cover.</p><span>For CAs and auditors →</span></a>
<a class="card" href="partners.html"><h3>Partners and bureaus</h3><p>Make your work independently checkable: the client’s rules, the client’s check, the same record every time.</p><span>For partners →</span></a>
</div>
</div></section>`

const teams = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">For finance and HR teams</span>
<h1>Check the change before you sign for it.</h1>
<p class="lead">You know the ledgers and the people. When someone else changes them — a migration partner, a payroll bureau, an AI tool, your own team in a hurry — open the file from before and the file from after, and see what changed, whether it was allowed, and what does not add up.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="packs.html">What the packs check</a></div>
</div></section>
<section><div class="wrap">
<h2>Three changes you might sign for this year</h2>
<div class="grid">
<div class="card"><span class="num">A salary revision</span><h3>Only the approved list, within the cap</h3><ul class="plain"><li>Basic and HRA may rise, by at most the percentage you set, and only for employees on the approved list.</li><li>Every approved revision must arrive exactly as approved.</li><li>Every other column — bank details, PAN, joining date — must stay as it was.</li></ul></div>
<div class="card"><span class="num">An AI categorisation run</span><h3>It may touch two columns</h3><ul class="plain"><li>Category may change, only to one of your categories; tax code may change.</li><li>An amount, a date or a party that moved is reported, record by record.</li><li>No transaction may appear or vanish.</li></ul></div>
<div class="card"><span class="num">A migration</span><h3>Every record arrived, correctly</h3><ul class="plain"><li>Before the load: will Zoho Books or Zoho Payroll accept the file?</li><li>After: every ledger and every employee matched, balances and control totals tied.</li><li>Ready-made packs for Tally to Zoho Books and mid-year payroll.</li></ul></div>
</div>
<p class="note">Formats are declared, never guessed: Indian digit grouping (1,23,456.78), decimal commas, day-first dates, Tally’s Dr and Cr. A value that could be read two ways is not read at all, so a disagreement shows instead of a guess.</p>
</div></section>`

const auditors = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">For CAs and auditors</span>
<h1>A record of a data change you can re-check yourself.</h1>
<p class="lead">When a client migrates its books, revises salaries in bulk or lets an AI tool post entries, the evidence usually comes from whoever did the work. A Plumbstep record is built so that you do not have to take its word: it names the files, prints the rules and says how to run the check again.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="docs/cli.html">The command line</a></div>
</div></section>
<section><div class="wrap">
<h2>What the record gives you</h2>
<div class="grid">
<div class="card"><h3>The files, by their bytes</h3><p>Every file is named by the SHA-256 of its exact bytes. Run <code>sha256sum</code> (or <code>certutil -hashfile</code> on Windows) on the client’s copy and compare.</p></div>
<div class="card"><h3>The rules, in full</h3><p>The contract or rules are printed in full with the fingerprint of their canonical form, so two records held to the same rules say so, and an edited copy shows.</p></div>
<div class="card"><h3>The check, again</h3><p>Each record ends with the command that re-runs its check on the same files. The engine is open source; you can run it on your own machine.</p></div>
<div class="card"><h3>Who did what</h3><p>Who made the change, who exported each file and when, who wrote the rules and who ran the check — as typed, and said to be unverified. A check run by the party that made the change is labelled self-checked.</p></div>
<div class="card"><h3>What it does not cover</h3><p>Columns in one file only, steps that could not run and inputs that were not given are listed, never passed. A check that could not be confirmed is never called allowed.</p></div>
<div class="card"><h3>What it claims</h3><p>Only what ran. It gives no opinion and no assurance beyond the checks it lists. Every record carries the same statement, word for word, below.</p></div>
</div>
<blockquote>${h(STATEMENT_OF_CLAIM)}</blockquote>
</div></section>
<section><div class="wrap">
<h2>Shape it with us</h2>
<p class="intro">The record is young. Tell us what you would need to see before relying on it — a field, a wording, a check — and it will be designed with you. Free while in pilot.</p>
<div class="actions spaced"><a class="btn" href="${ISSUES}">Talk to us</a></div>
</div></section>`

const partners = () => `<section class="hero"><div class="wrap">
<span class="eyebrow">For implementation partners and bureaus</span>
<h1>Make your work independently checkable.</h1>
<p class="lead">Your clients are asked to sign for changes you made. Hand them the means to check: the client’s rules, run on the client’s machine, with a record their auditor can re-check. Plumbstep gives every object the same descent, the same fix list and the same record — and keeps the client’s data where it already is.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="pricing.html">Pilot terms</a></div>
</div></section>
<section><div class="wrap">
<h2>What changes on a project</h2>
<div class="grid">
<div class="card"><h3>Checkable, not taken on trust</h3><p>A check is only as independent as who wrote its rules and who ran it. The record names both, and labels a check you ran on your own work as self-checked — so offer the client the check, not a verdict.</p></div>
<div class="card"><h3>Every mock load, judged the same way</h3><p>A migration object holds the rules, the mapping, the declared file formats and each run’s counts. Run mock 1, 2 and 3 against it and the cycle history sets each run beside the last.</p></div>
<div class="card"><h3>The right fix to the right team</h3><p>Each failing step names whose fix it is — the source data owner, the functional team, the load team, whoever made the change. Owners are editable per object.</p></div>
<div class="card"><h3>Definitions travel, data does not</h3><p>Share definitions sends only rules, mappings and run counts. Never the sign-off, owners’ names, file names or record values; a key map never leaves.</p></div>
<div class="card"><h3>Their headers, your definitions</h3><p>A client’s export rarely uses the expected headers. Match columns from dropdowns once; the match is saved with the object and printed in the record.</p></div>
<div class="card"><h3>A pipeline can run it too</h3><p>The <code>dcv</code> command runs the same checks on files of millions of rows, with exit codes and JSON or JUnit output for CI.</p></div>
</div>
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
<tr><td>A change contract</td><td>A file you download</td><td class="no">No — what may change, nothing else; the approved list and change log are never saved with it</td></tr>
<tr><td>Shared definitions</td><td>A file you send to someone</td><td class="no">No — and no sign-off, owners or file names</td></tr>
<tr><td>The evidence pack and the change record</td><td>Files built on your machine, handed to you</td><td class="yes">Yes, as evidence — sensitive columns masked</td></tr>
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
<p class="lead">Plumbstep is in pilot with its first projects. The workspace, the packs, the records and the <code>dcv</code> command are free to use while it is. Paid plans for partners and organisations will follow what pilots tell us they need.</p>
<div class="actions"><a class="btn primary" href="${APP}">Open the workspace</a><a class="btn" href="${ISSUES}">Talk to us</a></div>
</div></section>
<section><div class="wrap">
<h2>What you get today</h2>
<div class="table-wrap"><table>
<thead><tr><th scope="col">Feature</th><th scope="col">Without an account</th><th scope="col">With an account</th></tr></thead>
<tbody>
<tr><td>Change checks and the change record</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Readiness, reconciliation and drift checks</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Packs and the evidence pack</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Objects saved as files you download</td><td class="yes">Yes</td><td class="yes">Yes</td></tr>
<tr><td>Objects saved to your account, on any device</td><td class="no">—</td><td class="yes">Yes</td></tr>
<tr><td>Organisations, members and roles</td><td class="no">—</td><td class="yes">Yes</td></tr>
</tbody></table></div>
<p class="note">A pilot means a project uses it on real exports and tells us what broke. That is also how a draft pack becomes verified.</p>
</div></section>`

const BODIES = { 'index.html': home, 'auditors.html': auditors, 'partners.html': partners, 'teams.html': teams, 'packs.html': packsPage, 'security.html': security, 'pricing.html': pricing }

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
