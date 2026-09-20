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

### Final build (PRD) — screens, and the frozen engine
THE ENGINE IS FROZEN. `inferContract`, `validate`, the four layer checks and
their thresholds are verified against real data and must not be modified,
re-tuned or "improved". All remaining work is UI, routing, auth and
persistence AROUND them. If a requirement seems to need an engine change,
stop and flag it rather than editing `src/lib/`.

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
