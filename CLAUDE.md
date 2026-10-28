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
`type`, `nullRule`, `comparison`, `range`, `valueSet`, `crossColumn`. There is
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
- Rule → layer: type/nullRule → schema, valueSet/crossColumn → semantics,
  comparison/range → distribution. `severity: 'reject' | 'warn'` matters to
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
blank and duplicate keys are rejections (every copy). Statuses: READY,
NOT_READY, UNVERIFIED (nothing failed but something could not be checked —
never call that ready), INVALID.

## File formats — declared, never guessed
A format is declared once per file — encoding, decimal point or comma, date
pattern (`formats.js`) — in a contract's `format`, a spec's `formats`, a
migration object's `formats` per role. Where a value could be read two ways and
nothing is declared, it is NOT read as a number or date at all, so a
disagreement surfaces instead of a guess.
- UTF-8 is decoded strictly and refused with the likely cause, never repaired
  (`decodeBytes`, and a strict streaming decoder in `csvStream.mjs`).
- `parseNumber`: a comma must be a well-formed thousands separator; "1,5" is
  unreadable, not 15.
- Reconciliation reads each side by its own format; a crosswalked value by the
  target's. A guessed day/month order would make a swap in flight read correct.
- Key options `stripLeadingZeros` (all-digit keys only) and `ignoreCase`
  (Unicode folding: Weiß = WEISS) are declared, never inferred.

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
  field on read, so a hand-edited file cannot smuggle a value in.
- The evidence pack QUOTES records — that is what evidence is — so it is built
  locally and handed to the person who asked; never stored or uploaded.
- JUnit output carries sentences and counts, never an example record (CI logs
  are widely read).
- Temp partitions hold company data: `dcv-<pid>-*`, owner-only, 0600, deleted on
  exit and Ctrl-C, and every run sweeps dirs whose process is dead.

## The evidence pack
`createEvidencePack` — one self-contained HTML document per check, used by the
workspace and both CLIs (`--evidence`). Trustworthy on its own or worthless:
- files named by the SHA-256 of their exact BYTES (never decoded text);
- rules, spec and formats fingerprinted from canonical JSON printed in full;
- only checks whose result still matches the files and definitions (`stamp`);
- tool version and commit stamped in.
Hostile-input safe: every value through `escapeHtml`, no script, no external
reference, and a CSP meta forbidding scripts and requests even if escaping
failed. `evidencePack.test.js` and `e2e/evidence.spec.js` prove it. Keep both.

## The CLI and its formats (`dcv`)
`dcv check`, `dcv reconcile`, `dcv odcs export|import`, `dcv --version`. Exit
codes are the contract with a pipeline: 0 passed, 1 a check found something,
2 could not be completed (incl. "could not confirm"). Options are parsed
strictly — an unknown option is refused, never ignored.
- `--json` is versioned: `$schema` names `schemas/*-report.schema.json`. Fields
  may be ADDED within a version; removing or renaming one bumps it.
  `cli/cli.test.js` validates real output for every status against the schemas.
- `--junit` — one test case per step/rule; warn-only rules are skipped, not failed.
- A contract or spec argument may be a migration object (`*.migration.json`).
- `VERSION` in `src/lib/version.js` equals package.json (a test holds it); the
  commit comes from `DCV_COMMIT` (container) or git, else is reported unknown.

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
nav and the trust line, which must stay true.
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
- The Migrations screen runs in cycle order: before the load (readiness), after
  it (reconciliation), evidence for sign-off, cycle by cycle (history). Reports
  say when the files or definitions changed since they ran.
- Never show a blank screen: every dead end has a sentence (unreadable or empty
  file, baseline < 8 rows → INSUFFICIENT, candidate < 4 rows → distribution
  SKIPPED). Violations are plain-language sentences naming columns and numbers.
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
`dist/app.css`). `publish/artifact.html` is the Artifact-host entry: page
content only, stylesheet inlined. To republish: `npm run build`, then publish it
with `files: { "app.js": "dist/app.js" }` and the same URL.
CLI: published to public npm as `data-contract-validator` (command `dcv`) by
`.github/workflows/release.yml` on a `v*` tag matching package.json, with npm
provenance; it refuses to publish without a LICENSE file and `license` field
(Apache-2.0).
`npm pack` (the `files` list decides what ships) and the `Dockerfile` build the
same package.

## Out of scope — do not build without a decision
Data connectors in the browser; transforming or loading data (this tool proves
a load, never performs one); an expression language; storing record values.

## Known gaps
No format picker on Validate (it refuses non-UTF-8, but cannot be told a file
uses decimal commas); formats are per file, not per column; Indian grouping
(1,23,456) is refused; Supabase storage for migration objects; the npm release
workflow has not run yet (first run is the v2.0.0 tag).

## Conventions
- Plain JS + React, function components, hooks. No state library.
- Engine logic in `src/lib/`, pure, with unit tests.
- Drift samples are generated from today's date so the clean pair never rots
  into a false freshness failure; the migration example is static (no dates
  measured against now). Every person in every sample is invented.
