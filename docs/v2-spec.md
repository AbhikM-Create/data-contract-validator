# v2 — Migration Reconciliation

**One line:** prove that a migrated dataset arrived whole and correct, mock load
after mock load, and hand the business an evidence pack they can sign.

## The problem this is for

Every business transformation — an ERP move (ECC → S/4HANA), an HCM cutover
(legacy payroll → Workday/SuccessFactors), a CRM consolidation, a post-merger
integration — moves data from a system people trust into one they don't yet.
The data engineer on that project owns one question, asked three to six times
(Mock 1, Mock 2, dress rehearsal, cutover) for every migration object
(employees, vendors, open items, cost centres…):

> Did every record that should have moved arrive, and does it still say the
> same thing after mapping?

Today that answer is built in Excel: VLOOKUPs over two extracts, a pivot for
control totals, and a screenshot pasted into a sign-off deck. It is slow, it is
rebuilt every mock cycle, it breaks on a million rows, and it cannot tell a
**mapping gap** (nobody said what legacy grade `G7` becomes) from a **data
defect** (the salary really did change in flight). Auditors and business owners
sign it anyway, because there is nothing better at the speed a cutover runs.

v1 answers a neighbouring question — *has this feed drifted from the file I
trust?* — by comparing profiles. A migration needs something v1 cannot do:
**match records by business key**, row against row, across two systems that
name the same thing differently.

## Who uses it

| Role | What they need from it |
|---|---|
| **Migration data engineer** | Run it in the load pipeline after every mock; fail the run when completeness or accuracy drops. CLI + exit code + JSON. |
| **Data migration lead / PMO** | One readiness view across every object and every mock: is Mock 3 better than Mock 2, and what is blocking go-live? |
| **Business data owner** | A plain-language report they can read and sign: what moved, what didn't, why, and who accepted it. |
| **Client infosec** | Assurance the tool never ships client data anywhere. It runs locally — browser or CLI — and that is the product, not a caveat. |

## The reconciliation staircase

Same principle as v1: the checks run in order, and **which step a load falls
on is the finding**, because each step is meaningless if the one above it broke.

```
1 Keys          Is every record identifiable, exactly once, on both sides?
  2 Completeness   Did every in-scope source record arrive — and nothing else?
    3 Mapping        Does every legacy code have a target value defined?
      4 Accuracy       For records that arrived, do the mapped fields agree?
        5 Totals         Do control totals (sums per group) still tie out?
```

- **Keys** first: duplicate or blank keys make "missing" and "matched" undefined.
  Downstream steps still run on the unambiguous keys and say how many they set aside.
- **Mapping** before **accuracy**: an unmapped legacy value is a *spec* problem
  owned by the functional team, not a load defect owned by the engineer. Counting
  it as a mismatch sends the wrong person to fix it — the single most expensive
  confusion in a real mock cycle.
- **Totals** last and over whole populations: they catch what record matching
  misses — a currency field loaded in the wrong unit across every row ties out on
  keys and fails on totals.

A step that isn't configured reads **SKIPPED**, never PASS.

## The reconciliation spec (the new contract)

Declarative JSON, checked into the migration repo next to the load code. No
expression language — the same posture as v1's six rule kinds.

```json
{
  "name": "Employees — Mock 2",
  "key": { "source": ["PERNR"], "target": ["employee_id"] },
  "scope": { "source": { "column": "STAT2", "op": "=", "target": "3" } },
  "mapping": [
    { "source": "NACHN",  "target": "last_name", "ignoreCase": true },
    { "source": "ANSAL",  "target": "annual_salary", "tolerance": 0.01 },
    { "source": "TRFGR",  "target": "grade", "map": { "G7": "Senior Analyst", "G8": "Lead" } },
    { "source": "BEGDA",  "target": "hire_date" }
  ],
  "totals": [
    { "source": "ANSAL", "target": "annual_salary",
      "groupBy": { "source": "BUKRS", "target": "company_code" } }
  ]
}
```

- `key` — single or composite, named per side.
- `scope` — the migration's exclusion rules (e.g. "only active employees
  migrate"). Out-of-scope rows are **counted and reported**, never silently dropped.
- `mapping` — source→target field pairs. Values are compared as numbers, dates or
  text, coerced together exactly as v1 rules are. `map` is a crosswalk; a source
  value with no crosswalk entry is a **mapping gap**, not a mismatch.
- `totals` — control totals, optionally per group, with the group crosswalked.

## Scope — what v2 ships, in order

| # | Increment | Why it is in this position |
|---|---|---|
| 1 | **Reconciliation engine** (`src/lib/reconcile.js`) + `scripts/reconcile.mjs` CLI. Pure, tested, exit code 1 on FAIL, `--json`. | Everything else renders or stores what this computes. Usable by an engineer on day one. |
| 2 | **Streaming CLI for large loads** — key-hash join over streamed CSV, millions of rows in bounded memory. | Real objects are 1–20M rows. The browser ceiling (~90 MB) is fine for v1 drift, wrong for migrations. |
| 3 | **Reconcile screen** — mapping builder (dropdowns, column-to-column, crosswalk upload as CSV), the five-step staircase, drill-down to the mismatched records. | The business owner's view. Reuses the Staircase. |
| 4 | **Mock-cycle tracking** — a *migration object* with runs per cycle (Mock 1…Cutover); trend of completeness and accuracy. Stores counts and rates only, never values (same boundary as `runRecord.js`). | The PMO's question is "is it getting better?", which no single run answers. |
| 5 | **Evidence pack** — a self-contained HTML report, generated locally: spec + its hash, file names + SHA-256, row counts, every step's verdict, mismatch samples, thresholds, timestamp, sign-off block. | What actually gets attached to the go/no-go decision and the audit file. Generated on the user's machine; never uploaded. |
| 6 | **Cutover readiness board** — every object × latest cycle, one row each, worst step first. | The go/no-go meeting's single screen. |

## Explicitly out of v2

- **Database connectors.** Extracts arrive as files on every real project; a
  connector moves client credentials into this tool and breaks the local-only
  promise. The CLI reads whatever a pipeline already wrote.
- **Transformation / loading.** This tool proves a load; it never performs one.
- **An expression language.** Crosswalks + tolerances + scope cover every rule
  collected so far. A future kind slots into the spec without a parser.
- **Storing values.** Mismatch samples live in the local report and the evidence
  pack only; anything persisted is counts and rates.

## Success measures for "market ready"

- An engineer reconciles a 5M-row object from the CLI in under 2 minutes on a laptop.
- A spec written for Mock 1 runs unchanged on Mock 2.
- A business owner reads the evidence pack with no tool knowledge and can say
  what failed and whose job it is.
- Every step has a negative control: a deliberately broken load that it catches.
