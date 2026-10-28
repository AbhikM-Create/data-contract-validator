# v2 — Transformation Data Assurance

**One line:** for the in-house team running a business transformation — know a
load will be accepted before you run it, prove it arrived whole after you run
it, and keep the new system's data honest after go-live. One contract carries
all three.

## The buyer: the in-house transformation team

An ERP move (ECC → S/4HANA), an HCM cutover (legacy payroll → Workday or
SuccessFactors), a CRM consolidation, a post-merger integration. The team that
buys this is the company's own: a data migration lead, the data engineers who
build the loads, the business data owners who sign each object off, and
internal audit who will ask for evidence.

What separates them from a systems integrator, and shapes this spec:

- **They own the outcome after go-live.** An SI leaves after hypercare; the
  in-house team lives with every bad record that got through. Whatever protects
  the new system's data *after* cutover is worth as much to them as getting
  through cutover.
- **They run waves.** In-house programmes roll out by country, entity or
  business unit — the same object migrates many times over a year or more.
  Work done for wave 1 has to carry over to wave 2 unchanged.
- **They answer to internal audit.** SOX and internal controls want evidence of
  completeness and accuracy for financially relevant objects, owned by the
  company, not a consultant's spreadsheet.
- **They buy what clears infosec fast.** A tool that runs locally and never
  receives company data skips the review that kills most tool purchases.
- **They have no army for Excel.** An SI staffs reconciliation with people; an
  in-house team needs it to run unattended in the load pipeline.

## The two engines, and the one contract

```
            PREPARE                MIGRATE                  RUN
        (before each load)      (each mock / wave)     (after go-live)

        Will the target         Did every record        Is the data still
        accept this load?       arrive, correctly?      what we signed off?

        CONTRACT rules     →    RECONCILIATION     →    CONTRACT rules
        on the load file        source ↔ target         + drift vs the
                                by business key          cutover snapshot
```

**The data contract** (`validate()`, built in v1/v2) says what must be true of
the data in the *target* system. It is authored once per migration object —
mandatory fields, legal value sets, formats, cross-field logic ("an end date
once a record closes"). It is used twice:

1. **Load readiness (Prepare).** Run against the transformed load file *before*
   the load window, it predicts what the target will reject. Mock-load
   rejections are the largest single time sink in a migration cycle — each one
   found after a load costs a re-extract, a re-transform and a load slot.
2. **Production contract (Run).** At go-live the cutover snapshot becomes the
   baseline. The same rules, plus the four drift layers, now guard every feed
   and interface into the new system. This is the deliverable that outlives
   the project — and the reason an in-house team, not an SI, is the buyer.

**Reconciliation** (`reconcile()`, v2 increment 1) says whether the load
*matches its source*, record by record. It cannot be done with a contract,
because it needs both systems at once and a mapping between them.

They stay separate files with separate jobs — a contract describes one dataset;
a reconciliation spec describes the correspondence between two — and a
reconciliation spec names the contract for its target, so an object's whole
assurance lives together.

## Reconciliation: the staircase

Same principle as v1: the checks run in order, and **which step a load falls
on is the finding**, because each step is meaningless if the one above broke.

```
1 Keys          Is every record identifiable, exactly once, on both sides?
  2 Completeness   Did every in-scope source record arrive — and nothing else?
    3 Mapping        Does every legacy code have a target value defined?
      4 Accuracy       For records that arrived, do the mapped fields agree?
        5 Totals         Do control totals (sums per group) still tie out?
```

- **Mapping** before **accuracy**: an unmapped legacy value is a *spec* problem
  owned by the functional team, not a load defect owned by the engineer.
- **Totals** last and over whole populations: a currency loaded in the wrong
  unit for one company code ties out on keys and fails on totals.
- A step that isn't configured reads **SKIPPED**, never PASS.

```json
{
  "name": "Employees — Wave 2, Mock 2",
  "contract": "Employees (target)",
  "formats": { "source": { "encoding": "windows-1252", "decimal": ",", "date": "DD.MM.YYYY" } },
  "key": { "source": ["PERNR"], "target": ["employee_id"], "normalize": ["stripLeadingZeros"] },
  "scope": { "source": { "column": "STAT2", "op": "=", "target": "3" } },
  "mapping": [
    { "source": "NACHN", "target": "last_name", "ignoreCase": true },
    { "source": "ANSAL", "target": "annual_salary", "tolerance": 0.01 },
    { "source": "TRFGR", "target": "grade", "map": { "G7": "Senior Analyst", "G8": "Lead" } }
  ],
  "totals": [
    { "source": "ANSAL", "target": "annual_salary",
      "groupBy": { "source": "BUKRS", "target": "company_code" } }
  ]
}
```

## Scope — what v2 ships, in order

| # | Increment | Why here |
|---|---|---|
| 1 | **Reconciliation engine + CLI** (`reconcile.js`, `scripts/reconcile.mjs`). | **Done.** |
| 2 | **Done.** **Load readiness** — `scripts/check.mjs <contract.json> <load.csv>`: the contract run rules-only from the CLI, with exit codes and `--json`. Rules gain `severity: reject | warn`, mirroring how a target system rejects some records and accepts others with a warning; the report predicts rejections per rule with counts and example keys. | Uses `validate()`'s rules-only mode, which already exists. Puts the contract into the pipeline on day one, ahead of the most expensive failure in a mock cycle. |
| 3 | **Done.** **Streaming for large files**, both CLIs — key-hash join and rule evaluation over streamed CSV, millions of rows in bounded memory. | Real objects are 1–20M rows. Nobody adopts a tool that fails on their first real file. |
| 4 | **Done** (persistence by file; Supabase sync pending credentials). **Migration object workspace** (UI) — one object holds its contract, its reconciliation spec, and its runs per wave and mock. Mapping builder from dropdowns; crosswalks uploaded as CSV; the reconcile staircase with drill-down. | The business data owner's and migration lead's view. Reuses the Staircase and the rule builder. |
| 5 | **Done.** **Evidence pack** — a self-contained HTML report generated locally: contract + spec + their hashes, file names + SHA-256, row counts, every step's verdict, rejection and mismatch samples, thresholds, timestamp, sign-off block. | What internal audit files and the go/no-go decision cites. Never uploaded. |
| 6 | **Go-live handover** — promote the cutover snapshot to the contract's baseline in one action; the readiness board (every object × latest mock, worst step first) becomes the run-state board for production feeds. | Turns the project's contracts into the production team's. |

## Measured scale (increment 3)

`node --max-old-space-size=512 scripts/benchmark-migration.mjs 5000000` on a
4-core cloud container, heap capped at 512 MB to prove memory is bounded:

| | Rows | Input | Time | Peak RSS |
|---|---|---|---|---|
| Reconcile (17 partitions) | 5,000,000 source / 4.9M target | 538 MB | 123 s | 642 MB |
| Load readiness, with key | 4.9M | 283 MB | 39 s | 718 MB |

Every planted break (out of scope, missing, duplicated, unmapped, wrong value)
is reported exactly; the benchmark fails if one is not. Uncapped, the same
reconciliation took ~115 s with a larger, lazily collected heap. Against the
"under 2 minutes" measure above: met uncapped, ~3 s over when capped — on this
machine; a laptop has not been measured.

## Enterprise phase 1 — correct on real data (done)

Declared file formats (`src/lib/formats.js`): encoding (UTF-8 strictly, or
Windows-1252, ISO-8859-1, UTF-16 LE), decimal point or comma, and a date pattern
(DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, YYYYMMDD; ISO always read).
Declared per file — in a spec's `formats`, a contract's `format`, a migration
object's `formats` — never guessed per cell. Undeclared, a value that could be
read two ways is not read as a number or date at all. Key options
`stripLeadingZeros` (SAP's zero-padded numeric keys) and `ignoreCase`. Accounting
and SAP trailing-minus negatives are read. Account isolation is verified on a
local Postgres (`npm run verify:rls`) and gated in CI.

## Explicitly out of v2

- **Database or application connectors.** Extracts and load files are files on
  every real project; a connector puts system credentials in this tool and
  breaks the local-only promise. The CLIs read what a pipeline already wrote.
- **Transformation or loading.** This tool proves a load; it never performs one.
- **An expression language.** The six rule kinds, crosswalks, tolerances and
  scope cover every rule collected so far.
- **Storing values.** Example records live in the local report and evidence
  pack only; anything persisted is counts, rates and rule outcomes.

## What "market ready" means here

- A data engineer adds two lines to a load pipeline and it fails the run on a
  predicted rejection or a broken reconciliation.
- A contract and spec written for wave 1 run unchanged on wave 2.
- A 5M-row object reconciles from the CLI in under 2 minutes on a laptop.
- A business data owner reads the evidence pack with no tool knowledge and can
  say what failed and whose job it is.
- At go-live, the project's contracts become production checks without being
  rewritten.
- Every check has a negative control: a deliberately broken file it must catch.
