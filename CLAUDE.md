# Data Contract Validator — v1

## Job
An analyst uploads two CSVs: a BASELINE they trust and a CANDIDATE that
arrived. The baseline implies a contract; the candidate is checked against
it on four layers. The answer is not one verdict — it is which layer caught
the break, and which layers above it passed.

## Architecture (this is the spec — do not collapse it)
The engine is standalone and knows nothing about the UI:

- `src/lib/contract.js` — `inferContract(baselineRows) -> contract`
- `src/lib/validate.js` — `validate(contract, candidateRows, opts) -> report`
- `src/lib/parseCsv.js` — the only module that knows about papaparse or File

Rows in and out of the engine are plain objects (`{ column: "value" }`).
The engine imports nothing from `src/components/` or `src/App.jsx`, so it can
be lifted into another app or a Node script unchanged. Components render; they
do not compute. `src/samples/` is demo data and is never imported by the engine.

## The four layers
1. SCHEMA — missing columns, extra columns, changed types, a column gone all-blank.
2. SEMANTICS — categorical domains (unseen values, vanished values); numeric
   scale changes that match a KNOWN unit conversion (x100, x1000, x60, ...).
3. FRESHNESS — newest candidate timestamp vs now, measured against the cadence
   the baseline implies. Skipped, not failed, when there is no date column.
4. DISTRIBUTION — mean/median shift, values outside the baseline range,
   row-count change, null-rate jump.

Layers below schema only compare columns present on both sides WITH the same
type — comparing a number against a string produces nonsense statistics, and
schema has already reported the reason.

## The line between semantics and distribution (load-bearing)
A clean x100 is a UNIT change: the number means something else now → semantics.
An arbitrary 83x is a DISTRIBUTION break: the number means the same thing and
is wrong → distribution. This split is what lets the report say which KIND of
problem this is, and it is why the 83x sample passes schema, semantics and
freshness and fails only distribution. `samples.test.js` pins that.

## v2 — authored contracts (increments 1-2 done; 3-4 pending)
A contract has two independent halves, and either may be empty:
- `columns[]` — the baseline profile, what the data WAS (inference fills this)
- `rules[]` — authored requirements, what the data MUST BE (a human fills this)

A rule is `{ kind, column, op, target, targetIsColumn?, when? }`; kinds are
`type`, `nullRule`, `comparison`, `range`, `valueSet`, `crossColumn`. `when` is
an optional `{ column, op, target, targetIsColumn }` that gates the rule to the
rows it selects. There is deliberately NO expression parser: every real rule
collected in scoping was expressible with these six. A future `expression` kind
slots into the same array without touching anything that reads it.

`src/lib/rules.js` evaluates rules and is the only place that knows about them.
`src/lib/authoredContract.js` builds and normalises contracts (`defineContract`,
`withRules`, `normalizeContract`). The ENGINE IS NOT THE PLACE TO ADD AUTHORING:
`validate()` gained exactly two things — it normalises whatever contract it is
handed, and it merges rule violations into the same four layers. If you find
yourself editing the drift checks to support authoring, stop; the contract
object is the interface.

Evaluation rules that matter: both sides of a comparison are coerced TOGETHER
(numbers as numbers, dates as dates, else text), a blank is "not applicable" for
every kind except `notNull`, and a malformed rule reports itself as unchecked
rather than silently passing. Rule → layer: type/nullRule → schema,
valueSet/crossColumn → semantics, comparison/range → distribution.

Verify with `node scripts/verify-authored-contract.mjs` — it runs a hand-written
contract against the real HR snapshots AND against deliberately broken
copies, because a rule that never fires looks correct for the wrong reason.

### Final build (PRD) — screens, and a once-frozen engine
The PRD froze the engine, and it stayed frozen for that whole build: routing,
auth, persistence and History were added around it without touching a
detection rule. Default to that posture — an engine edit needs a reason and
re-verification against real data, not a hunch.

It was unfrozen ONCE, deliberately, to fix two false alarms found against real
HR snapshots. Both fixes were re-verified against those same files and not
only against unit tests, which is the bar any future engine change must clear.

### The two false alarms, and what fixed them
**A median gap is not a cadence.** Freshness read `effective_from` — business
dates 17 to 472 days apart — as an update schedule, and called a healthy file
three weeks dead. Contracts now carry `cadenceSpread` (interquartile range over
median: 0 for a daily feed, 0.69 for those hire dates). Above
`cadenceIrregularity` the staleness check declines to judge and says why. The
went-backwards check needs no cadence and always runs.

**A blank is not always missing data.** `effective_to` went 0% → 95.5% blank
and distribution called it an upstream failure. It was a column that had become
conditional: blank exactly where `is_current` is `Y`. `explainBlanks()` looks
for one value of one other column that covers nearly all the blanks AND is
nearly always blank itself — both tests, or any sufficiently frequent value
would "explain" anything. When the explaining value is NEW, distribution stays
quiet, because semantics already reports that new kind of row and one event
should not be reported twice; when the value existed in the baseline, the
violation names the condition instead of asserting a breakage.

Structure: `routes.js` (hash routing, no router dependency — the app is served
as static files and a hash route survives a refresh with no server rewrites),
`components/AppShell.jsx` (nav + trust line, on every screen), and
`screens/` — Landing, Contracts, Validate, History. `App.jsx` owns the session
state so a contract authored on Contracts is already loaded on Validate.

`components/Staircase.jsx` is the signature view and leads every report: the
four checks drawn as a descent so the eye lands on the step that caught the
file. A flat list of verdicts hides the one fact that matters — that the checks
ABOVE the failure passed. Keep it first.

Visual direction is calm enterprise: one muted teal accent carries interaction,
and green/red appear ONLY on a verdict. If they ever decorate anything else
they stop meaning pass and fail. All of it comes from `theme.js`.

PRD increments: 1 (routing + nav + visual direction) done. Still to build, in
order: auth, run persistence, History panel, demo data + walkthrough. Auth and
run persistence need Supabase credentials — see below.

## Two checks, two places in the UI — do not re-merge them
Comparing against a baseline and enforcing authored rules answer different
questions ("what changed?" vs "what must be true?"), so the report shows them
as two sections with their own verdict tiles, never as one blended list:

- **Rules you set** — reported RULE BY RULE (`RuleResults`), passing rules
  included, because "which of my rules actually ran" is the first question an
  author asks. These do not depend on the baseline.
- **Compared with the file you trust** — the four layer cards, showing ONLY
  drift findings.

Every violation carries `source: 'rule' | 'baseline'`, and `validate()` returns
`rules` (per-rule outcomes), `ruleViolations` and `baselineViolations` alongside
the layer-tagged list, so the UI never re-derives the split from codes. A layer
that failed only because of a rule reads PASS in the comparison section — that
is correct: nothing drifted, a requirement was broken. The headline names the
check that caught it, so it never says "Semantics caught it" above a Semantics
card that passed.

### Increment 2 — the authoring UI (local only, no persistence)
`RuleBuilder.jsx` composes a rule from dropdowns only; there is no text field
for logic, so nothing can be authored that the engine cannot read. It shows the
rule as a sentence (`describeRule`) while it is being built and refuses to add
one until `ruleIssue()` is clean. `ContractRules.jsx` holds the authored list
plus the promotions from `suggestions.js`, which are kept visibly separate:
inference proposes with its evidence attached, the human disposes.

Authoring appears as soon as a baseline parses — before any file is checked —
because the contract belongs to the baseline, not to a comparison. The results
view offers "check another file", which clears ONLY the file being checked:
a contract that dies with each file is not worth authoring. "Start over" clears
everything including rules.

With no rules authored, `withRules(draft, [])` is the v1 contract exactly, so
nothing about v1's behaviour changes for someone who never opens the authoring
section.

### Increment 4 — portable contracts (done)
`contractFile.js` serialises a contract to JSON and reads it back. It is the
single definition of WHAT GETS PERSISTED, so read it before adding any store.

**A saved contract holds rules and a name — nothing else.** The inferred half
(`columns[]`: value domains, ranges, timestamps) is made of real values out of
the file — a domain for an email column is a list of real email addresses — so
it never reaches storage. A test asserts a sample address cannot appear in the
saved JSON; keep it.

A rule that no longer parses is reported on load and listed as NOT being
checked, never dropped in silence. A contract that quietly enforces less than
it claims is the exact failure this tool exists to catch.

Because a contract needs no baseline, the app now runs in three modes, all
through the same `validate()`: baseline + file (comparison), contract + file
(rules only — the comparison tile reads NOT RUN), or both. The headline only
mentions the baseline when there was one.

### Increment 3 — Supabase (NOT built; needs credentials)
`supabase/schema.sql` is ready to run: a `contracts` table holding name +
rules + format_version, RLS scoped to `auth.uid()`, unique on (user_id, name)
so saving amends rather than duplicating, and a trigger owning `updated_at`.

Still needed before this can be built AND VERIFIED: a Supabase project URL and
anon key. When it lands, the header copy must change — "Nothing is uploaded or
stored" stops being true for contracts, and becomes the spec's wording: raw
data never leaves the browser; only the contract you author is saved.

## Never show a blank screen
Every dead end has a sentence: unreadable file, empty file, baseline too thin
(< 8 rows → INSUFFICIENT, never a fabricated range), candidate too small for
statistics (< 4 rows → distribution SKIPPED). Violations are plain-language
sentences naming the column and the numbers, not codes.

## Reading order (the page is for someone who has never used it)
The landing view is: what this is → three how-it-works steps → two numbered
upload cards with real filled "Upload CSV file" buttons (drag-and-drop is the
fallback, never the only way in) → ready-made examples → what the four checks
look for, in plain language. Once both files parse, all of that is replaced by
the report; the files collapse to a one-line bar.

Vocabulary is fixed and shared: the two files are "the file you trust"
(tagged `baseline`) and "the file to check" (tagged `new file`), and violation
sentences in the engine use those same words. `src/copy.js` holds the
plain-language wording; keep engine messages and UI copy saying the same thing.

Machinery goes last and starts collapsed: inferred contract behind "show
columns", the nine threshold inputs behind "adjust limits" with their current
values always visible as chips. Never open a first-time reader on nine inputs.

## Thresholds
Defaults live in `DEFAULT_THRESHOLDS`; `THRESHOLD_FIELDS` drives the UI so a
new threshold needs no UI change. They are shown, not hidden — a verdict is
only as meaningful as the line it was measured against.

## Publishing
The app is static, so any static host works. `vite.config.js` sets `base: './'`
and fixed output names (`dist/app.js`, `dist/app.css`) so the bundle runs from
any path and the publish wrapper never needs updating.

`publish/artifact.html` is the Artifact-host entry: page content only (the host
supplies doctype/head/body), with the app's stylesheet inlined so the dark
ground paints before the bundle evaluates. To republish: `npm run build`, then
publish that file with `files: { "app.js": "dist/app.js" }` and the same URL.

## Privacy
Everything runs in the page: no backend, no storage, no network calls. The
page says so and that must stay true.

## Explicitly OUT of v1 — do not build, scaffold, or "prepare for"
Contract authoring/editing UI. Saving or persistence of any kind. Accounts.
Live data connectors. Any backend. Export/PDF. Multi-file batches.

## Conventions
- Plain JS + React, function components, hooks. No state library.
- All engine logic lives in `src/lib/`, is pure, and has unit tests (`npm test`).
- Samples are generated from today's date, not checked in as fixtures, so the
  clean pair never rots into a false freshness failure.
- Visual language: dark ground, mono labels, cyan = baseline, amber = candidate,
  green = pass, red = fail.

## v2 — Migration reconciliation (increments 1-5 done)
Spec: `docs/v2-spec.md`. The audience is the data engineer on a business
transformation (ERP/HCM cutover, M&A integration) who must prove, every mock
cycle, that a load arrived whole and correct.

`src/lib/reconcile.js` — `reconcile(spec, sourceRows, targetRows) -> report` —
matches RECORDS by business key, which `validate()` (profile drift) cannot.
Five steps as a descent: keys → completeness → mapping → accuracy → totals.
It is a sibling of `validate()`, not an extension of it: do not merge the two.

The buyer is the IN-HOUSE transformation team, who own the system after
go-live. The data contract is not superseded by reconciliation — it is used
twice: as LOAD READINESS before each mock (rules run on the load file predict
target rejections) and as the PRODUCTION CONTRACT after go-live (cutover
snapshot becomes the baseline). Reconciliation sits between them. A contract
describes one dataset; a reconciliation spec describes the correspondence
between two — keep them separate files.

Load-bearing distinctions:
- An unmapped legacy value is a MAPPING gap (functional team's spec), never an
  accuracy mismatch (engineer's load). Counting it as a mismatch sends the
  wrong person to fix it.
- Duplicate/blank keys are set aside, never guessed at, and a key duplicated in
  the target is not ALSO reported missing — one fault, one finding.
- Out-of-scope rows (`scope`) are counted and reported, never silently dropped.
- An unconfigured step is SKIPPED, never PASS. A spec naming a missing column
  returns INVALID with reasons, never a half-run.

CLI: `node scripts/reconcile.mjs <spec.json> <source.csv> <target.csv> [--json]`
— exit 0 reconciled, 1 a step failed, 2 spec/file unusable. Any file size: see
increment 3.

### Increment 2 — load readiness (done)
`src/lib/readiness.js` — `checkReadiness(contract, rows, { columns, key })` —
predicts which records the target will REJECT and which it will load with a
WARNING, before the load window. It is a view over `checkRules()`, never a
second evaluator: a rule must mean the same thing here and in `validate()`.

- `severity: 'reject' | 'warn'` lives on the rule (`rules.js`: `SEVERITIES`,
  `ruleSeverity`), persists through `contractFile.js`, and is set in
  `RuleBuilder`. Reject is the default and is omitted when saved, so contracts
  written before severities read exactly as before. `validate()` ignores it.
- Records are counted, not rule failures: a record broken by three rules is one
  rejection carrying three reasons.
- A rule over a column the load file lacks is UNCHECKED, never PASS (see
  `ruleColumns`). A missing column under a reject rule makes the file
  NOT_READY — it was built to the wrong template.
- Statuses: READY, NOT_READY, UNVERIFIED (nothing failed but something could
  not be checked — never call that ready), INVALID.

CLI: `node scripts/check.mjs <contract.json> <load.csv> [--key col] [--json]
[--rejects out.csv]` — exit 0 ready, 1 not ready, 2 unverified/unusable.
`--rejects` writes the flagged records with their reasons: the fix list.

KNOWN GAP, not fixed here: `validate()` in rules-only mode has the same hole
readiness closes — a rule on a missing column reports PASS, because the schema
layer only runs with a baseline. Fixing it changes engine output, so it needs
the real-data re-verification the engine bar requires.

### Increment 3 — files of any size (done)
Both CLIs stream. ONE implementation per engine, never a "large-file version":
- `createRuleChecker` (rules.js) is THE rule evaluator; `checkRules` loops it.
- `createReadinessCheck` / `createReconciliation` are the row-at-a-time and
  partition-at-a-time forms; `checkReadiness` / `reconcile` are those run over
  an in-memory array as ONE partition.
`scripts/lib/streaming.test.js` holds the streamed path to `toEqual` the
in-memory report (1, 7 and 64 partitions) on data planting every finding more
than five times. Keep that test; it is what makes the refactor safe.

- Examples are the first K IN THE FILE (`keepFirst`, by row number), because
  partitions are joined in no particular order.
- Reconciliation spills key + mapped columns to hash partitions, ~32 MB of CSV
  each: memory is set by that, not by file size (64 MB did not fit a 512 MB
  heap at 5M rows). Readiness spills only keys, to find duplicates up front,
  then streams and writes `--rejects` as it goes.
- Partitions are escaped TSV (`partitions.mjs`), measured 4-5x faster to read
  than JSON. A cell may hold tab/newline/backslash; the codec escapes them and
  the parity data carries such a cell.
- Temp data is company data. Scratch dirs are `dcv-<pid>-*`, owner-only, files
  0600, removed on exit/Ctrl-C, and every run sweeps dirs whose pid is dead —
  an out-of-memory abort skips every handler, so this is the only cleanup a
  crash gets.
- `scripts/lib/csvStream.mjs` reads by parseCsv's own exported rules
  (`readHeader`, `cleanRow`, `isMisaligned`). Settle BEFORE `parser.abort()`:
  Papa runs `complete()` synchronously inside abort.
- `parseNumber` has two fast paths; `parseNumber.test.js` holds them to the
  original verbatim over every short string of a hostile alphabet. Any change
  to it must keep that test.

Measure with `node scripts/benchmark-migration.mjs [rows]`; it fails unless every
planted break is reported exactly. 5M rows under a 512 MB heap: reconcile 123 s,
readiness 39 s (docs/v2-spec.md).

Fixed on the way: parseCsv rejected every single-column CSV ("row 2 doesn't
line up"), because Papa's UndetectableDelimiter warning was counted as a broken
row. Only TooManyFields/TooFewFields are now (`isMisaligned`).

### Increment 4 — the migration object workspace (done)
Route `#/migrations` (`screens/MigrationsScreen.jsx`), first in the nav. One
migration object, in the order a cycle runs: BEFORE the load (readiness on the
load file) → AFTER the load (reconcile source extract vs target extract) →
cycle history. Three files, because on a real project the load file and the
target extract are different files. Worker file slots: `load`, `source`,
`target`.

`src/lib/migrationObject.js` is the object and its file format
(`*.migration.json`): name, wave, cycle, contract (rules), spec, runs. It is a
DATA BOUNDARY like `contractFile.js`/`runRecord.js`: a run (`summarise*`) holds
counts, rates and verdicts — never a key, value, example or group label — and
`cleanRun` rebuilds runs field by field on read, so a hand-edited file cannot
smuggle values in. `migrationObject.test.js` collects every value from real
reports and asserts none reaches the saved JSON. Keep it.

- The CLIs accept the object file: `reconcile.mjs` uses its spec, `check.mjs`
  its contract and (unless `--key`) its spec's target key. One artifact for the
  pipeline and the screen.
- `runnableSpec` returns the spec in its SAVED form — what is saved is what runs.
  `normalizeSpec` is idempotent (`trimMap` accepts a Map); it once was not, and
  normalising twice silently emptied every crosswalk. A test pins it.
- Crosswalks are two-column CSVs (`readCrosswalk`). A legacy value mapped two
  ways refuses the WHOLE crosswalk — keeping either would be the tool choosing.
- `suggestFieldPairs` pairs only names equal modulo case/punctuation. Anything
  cleverer is a guess, and a reconciliation against a guessed column passes
  for the wrong reason.
- Drill-down: the worker asks `reconcile` for `exampleLimit: 1000`; the CLIs keep
  5. `findingTable.js` builds both the on-screen table and the CSV export, and
  the table says "first N of M" when it shows fewer. The readiness fix list is
  built IN the worker (`toCsv`), so flagged rows never cross to the page.
- The target key is one setting shared by readiness and the spec; the readiness
  section offers a picker so a load file can be checked without both extracts.
- Reports remember what they ran against (`stamp`) and say when the spec or
  files have changed since.
- `Staircase.jsx` takes any number of steps (`--steps` CSS variable), an optional
  per-step `question`, and a `subject` ("file"/"load"). Validate's four-layer
  output is unchanged.
- `src/samples/migrationSample.js` — an invented employee migration whose story
  is pinned: Keys and Completeness pass, Mapping catches legacy grade G4; the
  load file has two blank surnames and one warned salary.

Not built: Supabase storage for objects (needs credentials to verify RLS, like
contracts did). Until then an object persists as its downloaded file. Files
over 90 MB are refused in the browser with a pointer to the CLIs.

### Increment 5 — the evidence pack (done)
`src/lib/evidencePack.js` — `createEvidencePack(input) -> { html, reference,
fileName }` — one self-contained HTML document per check for the people who
sign a cycle off. The workspace ("Evidence for sign-off") and both CLIs
(`--evidence pack.html`) call the same function, so a pack means the same
wherever it was made.

It is trustworthy on its own or worth nothing:
- Files are named with the SHA-256 of their exact BYTES (`hashing.js`;
  `file.arrayBuffer()` in the page, a streamed hash in `scripts/lib/fileInfo.mjs`)
  — never of decoded text, which drops a BOM and would not match `sha256sum`.
- Rules and spec are fingerprinted from `canonicalJson` (sorted keys, cleaned
  rules) and printed in Appendix A: same fingerprint = same definitions.
- It includes ONLY checks whose result still matches the files and
  definitions on screen (the report `stamp`); a stale check is left out and the
  pack says "Not run". Never attest to files that were not the ones checked.
- `rowsFullyMatched` excludes records with a field that had no crosswalk entry
  (`rowsUnverified`): a value nobody compared is not verified.

It QUOTES RECORDS — that is what evidence is — so it is never stored or
uploaded, and it is hostile-input safe: every interpolation goes through
`escapeHtml`, there is no script and no external reference, and a CSP meta
(`default-src 'none'`) forbids scripts and requests even if escaping failed.
`evidencePack.test.js` feeds it markup from "files" and asserts none survives as
a tag; it fails with escaping disabled. Keep both.

## Enterprise phase 1 — correct on real enterprise data (done)
Probed against German/SAP/legacy conventions, the engine gave WRONG answers
without a word: "1,5" read as 15, "1.234,56" as 1.23456, 01/03/2024 as 3
January, 01.03.2024 and 20240301 not read as dates, SAP key 00012345 never
matching 12345, Windows-1252 decoded as "M�ller". All fixed under one rule:

**A format is DECLARED once per file, never guessed per cell. Where a value
could be read two ways and nothing is declared, it is not read as a number or a
date at all** — so a disagreement surfaces as a disagreement.

- `src/lib/formats.js`: `createReader(format)` and `DEFAULT_READER`;
  `formatIssue`, `cleanFormat`; `decodeBytes` (UTF-8 is decoded STRICTLY and
  refused with the likely cause, never repaired).
- Rules take a reader (`createRuleChecker(rules, { reader, columns })`). File
  cells are read by the file's format; literals the author typed by the
  canonical one. Undeclared, rules read exactly as before (`DEFAULT_READER`).
- Reconciliation always reads with `createReader` per side: non-ISO dates only
  in a declared pattern, because a guessed day/month order makes a swap in
  flight read as correct. A crosswalked value is read in the TARGET's format.
- `parseNumber` (everything, incl. Validate): a comma must be a well-formed
  thousands separator; "1,5" is unreadable, not 15. `parseNumber.test.js`
  holds it to the original plus exactly this rule.
- Numeric/date ranges and orderings against a number FAIL an unreadable value
  instead of comparing text ("250.000,00" >= "100" was true alphabetically).
- Key `normalize`: `stripLeadingZeros` (all-digit keys only), `ignoreCase`.
  Unknown options and formats are reported as INVALID, never dropped.
- ignoreCase folds the Unicode way (upper then lower): Weiß = WEISS.
- `validate()` passes the candidate's columns: a rule on a missing column is
  UNCHECKED (`rule:missing-column`), never a PASS that tested nothing.
- Encodings are decoded at the edge: `engineClient.parseBytesInWorker` in the
  page, a strict streaming decoder in `scripts/lib/csvStream.mjs`.
- Formats persist in contracts (`format`), migration objects (`formats` per
  role) and specs (`formats`), and are inside the evidence fingerprints.

### Account isolation, verified
`npm run verify:rls` (scripts/verify-rls.sh) builds a throwaway Postgres,
applies `supabase/tests/supabase-shim.sql` (anon/authenticated, auth.users,
auth.uid() as Supabase defines it) then `supabase/schema.sql`, and runs
`supabase/tests/rls.sql`: 20 checks across two accounts and anon. It found one
hole, now fixed: a foreign key is checked without RLS, so one account could
attach a run to another account's contract id. The run insert policy now
requires the contract to be the inserter's own. CI runs this as its own job.
