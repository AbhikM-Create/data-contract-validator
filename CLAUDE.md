# Data Contract Validator

## What it is
A tool for the in-house team running a business transformation (ERP or HCM
cutover, CRM consolidation, post-merger integration). It answers three
questions, each with its own engine, all of them running where the data is —
in the browser or on the machine running the CLI. Data never leaves it.

| Question | Engine | When |
|---|---|---|
| Will the target accept this load file? | load readiness (`readiness.js`) | before each load |
| Did every record arrive, correctly? | reconciliation (`reconcile.js`) | after each load |
| Has this feed drifted from the file I trust? / What must be true? | `validate()` | every file, and after go-live |

The answer is never one verdict: it is which step caught the problem and which
steps above it passed — that tells you what KIND of problem it is and whose fix
it is. Product spec and history: `docs/v2-spec.md`.

## Architecture (this is the spec — do not collapse it)
- `src/lib/` is the engine: pure, no DOM, no network, no React, unit-tested.
  It imports nothing from `src/components/`, `src/screens/` or `src/App.jsx`,
  and never imports `src/samples/` (demo data).
- `src/lib/parseCsv.js` is the only engine module that knows about papaparse
  (reading, and writing via `toCsv`). Rows in and out are plain objects.
- `src/lib/parseXlsx.js` is the only module that knows about SheetJS (v3 F7).
  SheetJS CE 0.20.3 is pinned from cdn.sheetjs.com (the npm registry copy is
  stale and has known advisories) as a devDependency, bundled into the worker
  only, and left out of the npm package. A number cell is written in the file's
  declared decimal mark and a date cell as ISO, so the engine and its readers
  are unchanged; merged cells, multi-row headers and .xls are refused. The page
  recognises a workbook by its bytes through `fileKind.js`, never importing it.
- `scripts/lib/` is the Node layer (streaming, partitions on disk, hashing);
  `cli/` is the `dcv` commands; `bin/dcv.mjs` dispatches. The browser runs the
  engine in `engineWorker.js`, which owns the parsed rows.
- Components render; they do not compute. `App.jsx` owns session state, so a
  contract authored on Contracts is already loaded on Validate and Migrations.
- ONE implementation per engine, never a large-file copy: `createRuleChecker`
  is THE rule evaluator (`checkRules` loops it); `createReadinessCheck` and
  `createReconciliation` are the row- and partition-at-a-time forms;
  `checkReadiness`/`reconcile` are them run over an array as one partition.
  `scripts/lib/streaming.test.js` holds the streamed path to deep equality with
  the in-memory report (1, 7, 64 partitions). Keep it.

## validate() — drift from a trusted file, and authored rules
Four layers, run as a descent:
1. SCHEMA — missing/extra columns, changed types, a column gone all-blank.
2. SEMANTICS — unseen/vanished categorical values; numeric scale changes that
   match a KNOWN unit conversion (x100, x1000, x60…).
3. FRESHNESS — newest timestamp vs now against the baseline's cadence; SKIPPED,
   not failed, without a date column.
4. DISTRIBUTION — mean/median shift, values outside the baseline range,
   row-count change, null-rate jump.
Below schema, only columns present on both sides WITH the same type are compared.

**The line between semantics and distribution (load-bearing):** a clean x100 is
a UNIT change (the number means something else) → semantics; an arbitrary 83x is
a DISTRIBUTION break (same meaning, wrong value). `samples.test.js` pins that the
83x sample passes schema, semantics and freshness and fails only distribution.

**The two false alarms, and what fixed them (from real HR snapshots):**
- A median gap is not a cadence. Contracts carry `cadenceSpread` (IQR/median);
  above `cadenceIrregularity` the staleness check declines to judge and says
  why. The went-backwards check needs no cadence and always runs.
- A blank is not always missing data. `explainBlanks()` looks for one value of
  one other column that covers nearly all the blanks AND is nearly always blank
  itself — both tests. A NEW explaining value leaves distribution quiet
  (semantics already reports it); an existing one is named as the condition.

**Authored rules.** A contract has two independent halves, either may be empty:
`columns[]` (the baseline profile, what the data WAS — inference fills it) and
`rules[]` (what it MUST BE — a person fills it). A rule is
`{ kind, column, op, target, targetIsColumn?, when?, severity? }`; kinds are
`type`, `nullRule`, `comparison`, `range`, `valueSet`, `crossColumn`, and from v3
`identifier`, `unique`, `aggregate`, `reference` (v3-spec §5.1). There is
deliberately NO expression parser. `rules.js` is the only place that evaluates
rules; `authoredContract.js` builds contracts. `validate()` only normalises the
contract and merges rule outcomes into the layers — never put authoring logic
in the drift checks; the contract object is the interface.
- Both sides of a comparison are coerced TOGETHER (numbers, dates, else text).
  A file cell is read by the file's declared format; a literal the author typed
  by the canonical one.
- A blank is "not applicable" for every kind except `notNull`.
- A malformed rule, or one over a column the file lacks, is UNCHECKED with the
  reason (`rule:invalid`, `rule:missing-column`) — never a silent PASS.
- Numeric/date ranges and orderings FAIL a value that cannot be read that way;
  they never fall back to comparing text.
- Rule → layer: type/nullRule/identifier/unique → schema, valueSet/crossColumn/
  reference → semantics, comparison/range/aggregate → distribution.
- The v3 kinds, inside `createRuleChecker` like the rest:
  - `identifier` is a CLOSED list in `identifiers.js` (pan, gstin with its Luhn
    mod-36 check character, ifsc, uan, pin) — never a pattern an author types.
    Adding one is an engine change with reference vectors and a mutation test.
  - `unique` needs its repeated values found before rows are judged, like the
    record key: `prepareRules` in memory, a tagged first pass on disk when
    streaming. Every copy fails. Without its set it is UNCHECKED
    (`rule:not-prepared`), never judged against nothing.
  - `aggregate` (sum/count, optional `groupBy`, `tolerance`) is totalled as rows
    pass and judged once at the end. It rejects no record: in readiness a failed
    reject-severity total is a FILE-LEVEL finding that makes the file NOT_READY,
    reported in `groups` (examples stay row-level). An unreadable amount makes
    the total UNCHECKED (`rule:unreadable`), never summed as zero.
  - `reference` checks values against a declared reference file's column —
    role `reference:<name>` in the workspace, `--reference name=file` on the
    CLI (value sets must fit in memory; refused past 10M). Without the file it
    is UNCHECKED (`rule:missing-reference`) and the file is not called ready.
  - `unique` on one column exports as ODCS `unique`; ODCS `unique`/`primaryKey`
    import as `unique` rules. `severity: 'reject' | 'warn'` matters to
  readiness; `validate()` ignores it. Reject is the default and is omitted when
  saved, so older contracts read exactly as before.

**Once-frozen engine.** Default posture: an engine edit needs a reason and
re-verification against real data, not only unit tests. Every change since has
been either behaviour-preserving and proved so (golden master
`golden.test.js`; equivalence tests `parseNumber.test.js`, the reader fuzz in
`formats.test.js`) or a deliberate fix of a silent wrong answer, pinned by a
test that fails on the old code.

## reconcile() — did the load arrive whole and correct?
Matches RECORDS by business key across two systems. Five steps as a descent:
keys → completeness → mapping → accuracy → totals. A sibling of `validate()`,
not an extension of it.
- An unmapped legacy value is a MAPPING gap (functional team), never an accuracy
  mismatch (the load). Counting it as a mismatch sends the wrong person.
- Duplicate/blank keys are set aside, never guessed at; a key duplicated in the
  target is not ALSO reported missing — one fault, one finding.
- Out-of-scope rows are counted and reported, never silently dropped.
- A control total is a SUM of an amount (default) or, from v3, a COUNT of
  records per group (`fn: 'count'`, no amount column) — headcount by location.
  Groups are the values as written: a group spelled differently on the two
  sides shows as a broken total until a group crosswalk joins them.
- An unconfigured step is SKIPPED, never PASS; a spec naming a missing column,
  an unknown key option or an unknown format is INVALID, with every reason.
- A matched record with a field that could not be compared (no crosswalk entry)
  is `rowsUnverified`, never "fully matched".
- Examples are the first K IN THE FILE (`keepFirst`); the CLIs keep 5, the
  workspace asks for 1,000 (`exampleLimit`).
- `normalizeSpec` is idempotent (a crosswalk Map normalised twice once emptied).
- A crosswalk mapping one legacy value two ways is refused whole.

## Load readiness — will the target accept the file?
A view over `createRuleChecker`, never a second evaluator. Counts RECORDS: a
record broken by three rules is one rejection with three reasons. With a key,
blank and duplicate keys are rejections (every copy). A composite key, and a
`unique` rule's columns, are compared joined unambiguously (JSON), never with
a separator a value could hold — ("x / y", "z") and ("x", "y / z") are two
records; " / " is only the display form (`keyLabel`). Statuses: READY,
NOT_READY, UNVERIFIED (nothing failed but something could not be checked —
never call that ready), INVALID.

## File formats — declared, never guessed
A format is declared once per file — encoding, decimal point or comma, date
pattern, digit grouping (`formats.js`) — in a contract's `format`, a spec's `formats`, a
migration object's `formats` per role. Where a value could be read two ways and
nothing is declared, it is NOT read as a number or date at all, so a
disagreement surfaces instead of a guess.
- Indian digit grouping (`1,23,456.78`) is a declared part, `grouping: 'indian'`,
  decimal point only. Undeclared it stays unreadable; the undeclared and western
  readers are unchanged (v3 F6, `formats.test.js`).
- UTF-8 is decoded strictly and refused with the likely cause, never repaired
  (`decodeBytes`, and a strict streaming decoder in `csvStream.mjs`).
- `parseNumber`: a comma must be a well-formed thousands separator; "1,5" is
  unreadable, not 15.
- Reconciliation reads each side by its own format; a crosswalked value by the
  target's. A guessed day/month order would make a swap in flight read correct.
- Key options `stripLeadingZeros` (all-digit keys only) and `ignoreCase`
  (Unicode folding: Weiß = WEISS) are declared, never inferred.

## Column matching — declared, never guessed (final-spec C1)
A definition names the column it reads; a client's export rarely uses the same
header. A migration object's `columnMap` says, per file role (`load`, `source`,
`target`, `reference:<name>`), which file column stands for the column the
definitions expect: `{ source: { "Name": "Ledger Name" } }`. `columnMap.js` is
pure and holds column names only.
- Applied in ONE place per runtime, where rows enter the engine: `engineWorker.js`
  (`applyColumnMap` renames the held rows; `requireColumnMap` before each check)
  and `csvStream.mjs` (`readCsvHeader`/`streamCsv` take the map). The engine sees
  the expected names and is unchanged; so do tags, masking and the fix list.
- Chosen from dropdowns (`ColumnMatcher.jsx`). `proposeMatches` proposes only
  when exactly one unused file column has the same name ignoring case, spaces
  and punctuation, and nothing is matched until a person accepts it.
- A map that does not fit the file (a column the file lacks, one file column
  for two names, a name the file already uses) is refused WHOLE — never applied
  in part. An unmatched expected column stays missing, so its rules are
  UNCHECKED as before.
- The map is part of the stamps (changing a match makes that check stale) and
  is printed and fingerprinted in the evidence pack — only when there is one,
  so an object without it carries the fingerprints it always did.
- Proof: `streaming.test.js` and the Finance pack's tests rename every header
  and hold the mapped reports to deep equality with the originals; a wrong
  match is caught by the check it breaks.

## Data boundaries — what is stored, what never is
Each boundary is enforced in ONE place and proved by a test that collects real
values from real reports and asserts none reaches the stored form. Read the
module before adding any store.
- `contractFile.js` — a saved contract holds rules, a name and its declared
  format. Never the inferred profile (value domains are real values).
- `runRecord.js` — a saved run holds the SHAPE of findings (layer, code,
  column) and counts. Never messages or evidence.
- `migrationObject.js` — an object file holds rules, spec, formats and runs;
  a run holds counts, rates and verdicts. `cleanRun` rebuilds runs field by
  field on read, so a hand-edited file cannot smuggle a value in. From v3 it
  also holds `columnMap` (column names) and `tags`, `owners` and `signoff` — what people typed (identity,
  who exported each file, a decision per difference keyed by a short hash of
  the rule description or by step/code/column, scope, signer names and dates;
  `decisionFor` still reads decisions saved under the unhashed description,
  so a long value-set rule cannot lose its decision on save). `cleanSignoff`
  (`signoff.js`) keeps only bounded strings in known fields, on save and read.
  Signer names are the signers' personal data, kept by the user.
- `shareDefinitions.js` (final-spec C7) — the ONE file that may be sent to
  someone else (workspace "Share definitions", `dcv share`). Definitions and
  run counts; never the sign-off record, owners' names, the object's name, its
  wave or any file name. A crosswalk leaves only if it was DECLARED a code list
  (`mapKind: 'codeList'`, the person's choice; packs' crosswalks are code lists)
  and holds at most 500 entries; a key map (`keyMap`) never leaves, and an
  undeclared one is treated as record values. The file lists what it left out
  and opens like any object file. `mapKind` changes no check: `runnableSpec`
  strips it, so the engine, the stamps and the fingerprints never see it, and
  loading a new crosswalk file clears it. `readCrosswalk` refuses a file with
  more than two columns — a data file offered by mistake.
  `shareDefinitions.test.js` plants every cell of real files, file names and
  typed client names, and asserts none is in the shared file (the full object
  file is the negative control).
- The evidence pack QUOTES records — that is what evidence is — so it is built
  locally and handed to the person who asked; never stored or uploaded.
- Sensitivity tags (v3 §5.2, `masking.js`): a migration object's `tags` map
  column names to personal | identifier | pay | aadhaar — definitions, never
  values (`cleanTags` on read). Tagged values are masked wherever a report
  LEAVES the screen: the evidence pack, the fix list, exported findings, the
  CLI's `--json`, `--rejects` and terminal summary. Identifiers keep their last
  4; personal and pay read `[masked]`. Counts, totals and record keys are never
  masked (keys find the record), except an Aadhaar column — and except a total
  of a tagged amount grouped by a record key or a tagged column, which is one
  person's figure (YTD pay per employee): its amounts leave as null with
  `masked: true`, `ties` kept. Group labels follow their column's tag, and the
  readiness headline is rewritten from the masked group. Unmasking is a
  per-output choice (`--unmask`, the workspace checkbox); the pack then says it
  contains unmasked personal data and the fix list is named `-UNMASKED`.
  Aadhaar stays masked regardless. On screen, values stay visible. Never call
  this "DPDP compliant". `masking.test.js` tags every non-key column of real
  reports and asserts none of their values leaves (with an unmasked control).
- JUnit output carries sentences and counts, never an example record (CI logs
  are widely read).
- Temp partitions hold company data: `dcv-<pid>-*`, owner-only, 0600, deleted on
  exit and Ctrl-C, and every run sweeps dirs whose process is dead.

## The evidence pack — the cutover sign-off record (v3 §5.3)
`createEvidencePack` — one self-contained HTML document per check, used by the
workspace and both CLIs (`--evidence`). Its front is the cutover sign-off
record: identity, chain of custody (SHA-256 + who exported, when), results,
every difference with its decision and owner (`exceptionsFor`), what was not
checked (`notChecked` plus typed scope), the fixed `STATEMENT_OF_CLAIM`, and
signatures as typed (said to be unverified), with a "received by the auditor"
line that is not a certification. It is NEVER called a certificate and never
claims anything in `NEVER_CLAIM` (a test scans the pack). Each failing step,
the readiness report and the fix list (`_owner` column) name whose fix it is:
`DEFAULT_OWNERS`, editable per object (§5.4). Trustworthy on its own or worthless:
- files named by the SHA-256 of their exact BYTES (never decoded text);
- rules, spec and formats fingerprinted from canonical JSON printed in full;
- only checks whose result still matches the files and definitions (`stamp`);
- tool version and commit stamped in.
Hostile-input safe: every value through `escapeHtml`, no script, no external
reference, and a CSP meta forbidding scripts and requests even if escaping
failed. `evidencePack.test.js` and `e2e/evidence.spec.js` prove it. Keep both.

## The CLI and its formats (`dcv`)
`dcv check`, `dcv reconcile`, `dcv odcs export|import`, `dcv pack`, `dcv share`,
`dcv --version`. Exit
codes are the contract with a pipeline: 0 passed, 1 a check found something,
2 could not be completed (incl. "could not confirm"). Options are parsed
strictly — an unknown option is refused, never ignored, and so is a
`--reference` name no rule in the contract uses (a typo, not a file to skip).
- `--json` is versioned: `$schema` names `schemas/*-report.schema.json`. Fields
  may be ADDED within a version; removing or renaming one bumps it.
  `cli/cli.test.js` validates real output for every status against the schemas.
- `--junit` — one test case per step/rule; warn-only rules are skipped, not failed.
- A contract or spec argument may be a migration object (`*.migration.json`).
- `VERSION` in `src/lib/version.js` equals package.json (a test holds it); the
  commit (`commitFor`, `cli/buildInfo.mjs`) comes from `DCV_COMMIT` (container),
  else `cli/commit.json` (stamped by the release workflow before `npm publish`),
  else git ONLY when the package is its own checkout — installed inside someone
  else's project it must never report their repository's commit — else unknown.

## ODCS (Open Data Contract Standard v3.2.0)
`src/lib/odcs.js`. EXPORT is lossless: a rule with an exact ODCS equivalent is
plain ODCS (required, logicalType, invalidValues); anything else is an ODCS
`custom` check for engine `data-contract-validator` holding the exact rule.
IMPORT is honest: what maps exactly becomes a rule; tolerances, patterns,
uniqueness and other engines' checks are listed in `notImported` with reasons
(the CLI exits 2). Exports are validated against the vendored official schema
(`schemas/vendor/`), and real examples from the standard are test fixtures.

## UI
Screens: Migrations, Contracts, Validate, History (`routes.js`, hash routing —
a static app needs no server rewrites). `components/AppShell.jsx` carries the
nav and the trust line, which must stay true ("Files stay on this device.
Nothing is uploaded: the records and fix lists you download go only to your
computer, and an account, if you use one, stores only rules, names and
counts."). It carries no green dot: green is a verdict's colour.
- `components/Staircase.jsx` is the signature view and leads every report —
  four layers on Validate, five steps on Migrations. A flat list of verdicts
  hides the one fact that matters: the checks ABOVE the failure passed.
- **Two checks, two places — do not re-merge them.** On Validate, "Rules you
  set" (rule by rule, passing rules included — `RuleResults`) and "Compared with
  the file you trust" (the layer cards, drift only) are separate sections with
  their own tiles. Every violation carries `source: 'rule' | 'baseline'`, and
  `validate()` returns `rules`, `ruleViolations` and `baselineViolations`. A
  layer that failed only because of a rule reads PASS in the comparison section.
- Rules and specs are built from dropdowns only (`RuleBuilder`, `SpecBuilder`):
  nothing can be authored that the engine cannot read. Inference proposes
  (`suggestions.js`) with its evidence; the person disposes.
- The Migrations screen is a workspace of FOUR STEPS, one on screen at a time:
  Set up (files, column matching, rules, mapping, sensitive fields) → Before the
  load (readiness) → After the load (reconciliation, cycle history) → Sign-off
  (decisions, the record). `StepRail.jsx` shows each step's status, so the whole
  object reads at a glance; a stale result reads "Out of date — run again" on
  the rail from any step, and on the result itself. The step is in the link
  (`#/migrations/before`; `useSubRoute`/`goSub` in `routes.js`). Do not put the
  steps back on one page: with an example run it was 7.7 screens and 126
  controls (measured 11 Nov 2026).
- Machinery folds to one line until someone wants it: `FormatPicker` reads
  "Read as UTF-8 · 1,234.56 · ISO dates only · Change"; the mapping reads as a
  summary with "Edit mapping" when it is complete, and stays open once opened
  or needed — it must never fold away under someone mid-edit.
- User states (approved design, 12 Nov 2026). Built: (1) first visit — the home
  page says what this is in three beats, with "See it work in 2 minutes";
  (2) first use — `TourPanel.jsx`, a checklist beside the finance example whose
  items are done only when the person has really done them in the real
  workspace, never simulated, always leavable; (3) signed out — a "This device
  only" chip, and the sign-in screen lists what works without an account, what
  an account keeps and what it never keeps, each line true of the code today.
  NOT built: (4) projects saved to an account; (5) organisations, invitations,
  roles. Nothing on screen may promise either until it exists
  (`e2e/journeys.spec.js` holds that).
- Never show a blank screen: every dead end has a sentence (unreadable or empty
  file, baseline < 8 rows → INSUFFICIENT, candidate < 4 rows → distribution
  SKIPPED). Violations are plain-language sentences naming columns and numbers.
- The home page leads with the cutover job ("Start a cutover", then "Monitor a
  feed"), and its first worked example is finance: an opening trial balance,
  Tally to Zoho Books, built from the Finance pack (`samples/financeSample.js`),
  then the employee migration (`samples/migrationExamples.js` lists them; an
  example names every file its checks read, reference files included). The
  drift check follows on the same page as the after-go-live job.
  `financeSample.test.js` pins its story step by step, like the others.
- Reading order for a first-time reader: what this is → how it works → upload
  cards with real "Upload CSV file" buttons (drag-and-drop is the fallback) →
  ready-made examples → what the checks look for. Machinery (inferred columns,
  threshold inputs) goes last and starts collapsed; threshold values are always
  visible as chips — a verdict is only as meaningful as its line.
- Vocabulary is fixed: "the file you trust" (`baseline`) and "the file to check"
  (`new file`); engine messages and `src/copy.js` say the same thing.
- Visual direction: calm enterprise, light ground, one muted teal accent for
  interaction (`theme.js`). Green and red appear ONLY on a verdict.
- `DEFAULT_THRESHOLDS` / `THRESHOLD_FIELDS` drive the threshold UI, so a new
  threshold needs no UI change.

## Accounts and persistence (Supabase)
Optional: without `.env.local` the app runs fully, minus saving. Contracts and
run summaries save to the signed-in account; row-level security scoped to
`auth.uid()` is the whole access model (the publishable key ships in the
bundle by design). `npm run verify:rls` applies `supabase/schema.sql` to a
throwaway Postgres with a Supabase auth shim and runs 20 isolation checks
(`supabase/tests/rls.sql`); CI runs it. A foreign key is checked WITHOUT RLS —
the run insert policy therefore requires the contract to be the inserter's own.
Migration objects persist as files only (Supabase storage for them is not built).

## Security
- The production build carries a Content-Security-Policy (`vite.config.js`,
  build only); `frame-ancestors` must be set as an HTTP header where hosted.
- CI: high-severity audit of production dependencies, Dependabot, and a
  CycloneDX SBOM from `scripts/sbom.mjs` (not `npm sbom`, which drops a
  production dependency a dev tool shares).

## Verification
- `npm test` — unit, golden master, samples pinned to their verdict, CLI
  against published schemas, ODCS against the official schema.
- `npm run test:e2e` — Playwright against the production build (`e2e/`).
- `npm run verify:rls` — account isolation on a real Postgres.
- `node scripts/benchmark-migration.mjs [rows]` — fails unless every planted
  break is reported exactly. 5M rows under a 512 MB heap: reconcile ~2 min.
- `node scripts/verify-authored-contract.mjs <baseline> <candidate>` — rules
  against real snapshots AND deliberately broken copies.
- Negative controls everywhere: a check is trusted only once it has been seen
  to fail on the thing it guards against.

## Publishing
Static app (`vite.config.js`: `base: './'`, fixed names `dist/app.js`,
`dist/app.css`, `dist/app-worker.js` — the engine worker, which a host given a
file list must be given too). `publish/artifact.html` is the Artifact-host
entry: page content only, stylesheet inlined. It is GENERATED from the build by
`npm run publish:files` (`scripts/publish-files.mjs`), which also prints the
files to publish beside it; CI fails if the committed wrapper differs. To
republish: `npm run build`, `npm run publish:files`, then publish it with the
printed files (`app.js` and `app-worker.js`) and the same URL.
Steps, decisions and what was checked: `docs/release.md`.
CLI: published to public npm as `data-contract-validator` (command `dcv`) by
`.github/workflows/release.yml` on a `v*` tag matching package.json, with npm
provenance; it refuses to publish without a LICENSE file and `license` field
(Apache-2.0).
`npm pack` (the `files` list decides what ships) and the `Dockerfile` build the
same package. `npm run verify:package` installs the packed tarball into an
empty prefix and uses only that copy: a pack object, a check, a sign-off record,
and the record's own re-run command giving the same answer; CI and the release
workflow run it.

## Packs (v3 §6)
A pack is DATA in `src/packs/` (registry `index.js`): for one source → target
path, each object's expected headers (`columns.load/source/target`), the
target's rules, a mapping spec, declared formats, tags, the record's scope and
a guide (which export, which load file, how to compare). Standard codes only —
never a client's values. `src/lib/packs.js` validates (`packIssues`: every rule,
format and spec through the engine's own readers, against the declared headers;
the target key must be in the load file) and builds objects (`objectFromPack`);
it never imports a pack. An object keeps `pack: { id, version, status, object }`
(`packRef.js`), shown in the workspace and the evidence pack. A pack is `draft`
until a pilot has run it on real exports, then `verified` with the date and the
exports checked; a draft says so wherever it is shown, and lists `toConfirm`.
A value only the client knows (the cutover date) is a declared PARAMETER of the
object (`params`, a rule target `'{{cutoverDate}}'`), supplied when the object
is built — the workspace asks, the CLI takes `--param` — never defaulted;
`objectFromPack` throws without it, so no placeholder reaches a rule.
- Finance: `finance-tally-zoho-books` — chart of accounts, opening trial
  balance, customers and vendors, open AR/AP, GST ledgers. Zoho values (account
  types, GST treatments, headers) and Tally's 28 predefined groups are sourced
  in the pack; the Tally group → Zoho type crosswalk is a template to agree
  with the client's accountant (Suspense A/c, Branch/Divisions left unmapped on
  purpose). `finance-tally-zoho-books.test.js` runs every object on invented
  clean and broken files: each planted break is caught at its rule or step.
- HR: `hr-payroll-zoho-payroll` — employee master (PAN, UAN, IFSC identifiers;
  joining date on or before the cutover date; work location from Zoho's list;
  headcount by location), prior-payroll register (employee-month unique;
  employee in the master; every component a number ≥ 0; professional tax ≤
  ₹2,500 per employee per year, Art. 276(2); YTD gross, TDS, PF and PT per
  employee) and TDS deposits (deducted vs deposited by month). Every pay and
  identifier column is tagged on both sides. Zoho's employee import fields are
  sourced; its prior-payroll sample file is not public, so the register's
  headers are `toConfirm`. greytHR (the other §6.2 target) is NOT covered: its
  import templates are not public — a greytHR pack waits on a pilot's files.
- CLI: `dcv pack list`, `dcv pack <pack> <object> [--param name=value]...
  [--out x.migration.json]`.

## Out of scope — do not build without a decision
Data connectors in the browser; transforming or loading data (this tool proves
a load, never performs one); an expression language; storing record values.

## Known gaps
No format picker on Validate (it refuses non-UTF-8, but cannot be told a file
uses decimal commas); formats are per file, not per column; Supabase storage for migration objects; the npm release
workflow has not run yet (its first run is the first version tag; `docs/release.md`). Excel is read in the
browser only; the CLI refuses .xlsx with the fix (save as CSV). The 25 MB
workbook limit in `App.jsx` is conservative and not yet measured. Dependabot
does not track the SheetJS tarball: check cdn.sheetjs.com for releases.

## Conventions
- Plain JS + React, function components, hooks. No state library.
- Engine logic in `src/lib/`, pure, with unit tests.
- Drift samples are generated from today's date so the clean pair never rots
  into a false freshness failure; the migration examples are static (no dates
  measured against now). Every person, company and amount in every sample is
  invented. In the employee example the load file is the one prepared for the
  NEXT load (hence `load_file_mock3.csv` in cycle Mock 2); the example says so.
