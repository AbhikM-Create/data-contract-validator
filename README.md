# Data Contract Validator

Prove that data is what it should be — before a load, after a load, and every
day after go-live — and hand the people who sign it off the evidence. Built for
in-house teams running a business transformation: ERP and HCM cutovers, CRM
consolidations, post-merger integrations.

Everything runs where the data already is: in your browser, or on the machine
running the command line. **Your data is never uploaded.**

## Three questions, three checks

| Before each load | After each load | Every file, and after go-live |
|---|---|---|
| **Will the target accept this load file?** | **Did every record arrive, correctly?** | **Is this still the data we trust?** |
| Load readiness: the target's rules run on the load file, predicting rejections — with a fix list for the data owners. | Reconciliation: source and target matched record by record on their key. | Validation: drift from a trusted file, and the rules the data must always obey. |

### Which step caught it is the finding

Each check runs as a descent, and the step a load falls on says what kind of
problem it is — and whose fix:

```
1 Keys          PASS   Is every record identifiable, exactly once, on both sides?
  2 Completeness  PASS   Did every in-scope record arrive — and nothing else?
    3 Mapping       FAIL ← legacy grade G4 has no crosswalk entry   → the functional team's mapping spec
      4 Accuracy      FAIL   two salaries lost their decimal point    → the transformation
        5 Totals        FAIL   company totals no longer tie
```

A mapping gap is not a load error, and counting it as one sends the wrong
person to fix it. A file can keep every column and every category and still
carry salaries 83× too large; a schema check waves that through, the
distribution step does not.

## Quick start

```bash
npm install
npm run dev                 # http://localhost:5174
```

Open **Migrations → Try the example migration**: an invented employee migration
in its second mock load, with files, rules and mapping in place. Check the load
file, reconcile, upload a crosswalk, download the evidence pack.

Needs Node 20.19+ or 22.12+.

## The command line — for pipelines

```bash
npm install --global data-contract-validator    # once published; until then: npm pack, then install the .tgz

dcv check employees.migration.json load.csv --rejects fixes.csv --junit readiness.xml
dcv reconcile employees.migration.json legacy.csv target.csv --evidence pack.html --junit reconcile.xml
dcv odcs export contract.json > contract.odcs.yaml
dcv --version
```

Or as a container, for Airflow, Azure Data Factory, Databricks or Jenkins:

```bash
docker build -t data-contract-validator:2.0.0 --build-arg DCV_COMMIT=$(git rev-parse --short=12 HEAD) .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/data" data-contract-validator:2.0.0 \
  reconcile employees.migration.json legacy.csv target.csv --junit results.xml
```

- **Exit codes**: `0` passed · `1` a check found something · `2` could not be
  completed (including "could not confirm" — a pipeline should stop on it).
- **`--json`** prints a report described by a published JSON Schema
  (`schemas/`); fields may be added within a version, never removed.
- **`--junit`** writes results every CI system shows natively. It carries
  sentences and counts, never a record — CI logs are widely read.
- **`--evidence`** writes the evidence pack. **`--rejects`** writes the fix list.
- **Any size**: files are streamed and partitioned by key on local disk, in
  bounded memory. 5 million rows reconcile in about two minutes under a 512 MB
  heap (`node scripts/benchmark-migration.mjs 5000000`).
- The same `*.migration.json` the workspace saves is what the commands read, so
  the pipeline and the people work from one file, kept in git.

## Real enterprise data: formats are declared, never guessed

A German SAP extract says `1.234,56`, `01.03.2024`, `1200-` and stores employee
`00012345`; the target says `1234.56`, `2024-03-01`, `-1200` and `12345`.
Read in the wrong notation these do not fail — they become different, wrong
values. So each file's format is declared once — encoding (UTF-8, Windows-1252,
ISO-8859-1, UTF-16), decimal point or comma, date pattern — and keys can
declare *ignore leading zeros* and *ignore case*. Undeclared, a value that could
be read two ways is not read as a number or a date at all: a disagreement shows
up as a disagreement, never as a guess. A file that is not valid UTF-8 is
refused with the likely cause instead of showing `M�ller`.

## Evidence for sign-off

One self-contained HTML document per check, for the migration lead, the
business data owner and internal audit:

- each file named by the **SHA-256 of its bytes** — run `sha256sum` and compare;
- the rules, mapping and formats **fingerprinted** and printed in full — two
  packs with the same fingerprint were held to the same definitions;
- only checks whose result still matches the files and definitions on screen;
- the tool version and commit that produced it, how to re-run it, and a
  sign-off block. It prints to PDF.

It quotes records — that is what evidence is — so it is made on your machine and
never uploaded. It cannot run anything when opened: every value is escaped, and
a strict content security policy forbids scripts and network requests.

## Open Data Contract Standard

Contracts export to and import from **ODCS v3.2.0**, so they can live in your
data catalog. Export is lossless: rules with an ODCS equivalent are written as
plain ODCS; the rest as exact checks for this engine. Import is honest: what can
be enforced exactly becomes a rule, and everything else — a tolerance, a
pattern, another tool's check — is listed with the reason, never dropped.

## What is stored, and what never is

**Your files are never uploaded.** Without an account nothing is stored at all.
Signed in (optional, Supabase), two things are saved to your account:

- **contracts** — the rules you wrote, their name and declared format; never the
  inferred profile of a file (value lists are made of real values);
- **run summaries** — which layer caught what, as counts; never messages or
  examples, which quote real values.

Migration objects are files you keep. Each boundary is enforced in one module
and proved by a test that feeds real values in and checks none comes out.

## Security

- Account isolation is verified on a real Postgres — `npm run verify:rls` runs
  20 checks across two accounts and an anonymous visitor, in CI.
- The production page ships a Content-Security-Policy. Where you host it, also
  send `Content-Security-Policy: frame-ancestors 'none'` as a header.
- CI audits production dependencies; Dependabot proposes updates;
  `npm run sbom` writes a CycloneDX SBOM.

## Development

```bash
npm test               # unit, golden master, CLI against its schemas, ODCS against the standard
npm run test:e2e       # Playwright, against the production build
npm run verify:rls     # account isolation (needs PostgreSQL server binaries)
npm run lint
npm run build          # static files in dist/
```

How it is built: `src/lib/` is the engine — pure, no DOM, no network, used
unchanged by the browser, its Web Worker and the CLI. `scripts/lib/` streams
files of any size; `cli/` and `bin/` are the `dcv` commands; `src/screens/` and
`src/components/` render. Notes for contributors are in `CLAUDE.md`.

How it is tested: a golden master pins the drift engine's full output; every
demo sample is pinned to the break it exists to show; every check has a
negative control that must fail; the large-file path is proven identical to the
in-memory one; and equivalence tests hold every performance shortcut to the
code it replaced.

## Limits

| | |
|---|---|
| Browser | files up to 90 MB (memory, not policy) — beyond that, use the CLI |
| CLI | any size; memory is set by partition size, not file size |
| Formats | per file, not per column; Indian digit grouping is refused |
| Validate page | refuses non-UTF-8 files, but has no format picker yet |
