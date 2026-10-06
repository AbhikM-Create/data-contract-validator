# Data Contract Validator

Check whether a new CSV is really the same data as one you trust — not just the
same shape. Everything runs in the browser.

## The problem

A file can keep every column name, every type and every category, and still be
wrong:

- every salary arrives 83× too large, because an upstream job changed units
- a grade reads `Consumer`, which is not a grade
- the feed stopped three weeks ago and nothing said so

A schema check waves all three of those through. They are not schema problems.

## Four checks, in order

The checks run as a descent, and **which step a file falls on is the finding**:

```
1 Schema        PASS   Are the columns there, holding the same kinds of value?
  │
  2 Semantics   PASS   Do the values still mean what they meant?
    │
    3 Freshness PASS   Is the file as current as the baseline implies?
      │
      4 Distribution   FAIL  ← caught here: salaries 83× the baseline
```

> Schema, Semantics and Freshness all passed, and Distribution is where the file
> stopped. A check that looked only at schema would have called this file fine.

That sentence is the product. A single overall pass/fail would hide it.

## Two different questions

The report keeps them apart, because they are not the same claim:

| | Asks | Needs |
|---|---|---|
| **Comparison** | What *changed* since the file I trust? | a baseline file |
| **Rules** | What must be *true*, whatever any file says? | a contract you author |

Inference can only ever report what a file happened to contain. A **rule** states
what the data must be — that `Consumer` is not a legal grade, that `effective_to`
must follow `effective_from`, that an end date is required once a record closes.
That is ground truth no file can tell you about itself.

Rules are built from dropdowns, never typed logic: six kinds (`type`, `nullRule`,
`comparison`, `range`, `valueSet`, `crossColumn`) plus an optional `WHEN`
condition. There is deliberately no expression parser — every real rule collected
in scoping was expressible with these six.

## What is stored, and what never is

**Your CSV data is read in the browser and never uploaded.** Parsing and checking
happen in a Web Worker in the page; there is no backend for the data to go to.

When you sign in, two things are saved to your Supabase account:

- **Contracts** — the rules you authored, and their name. Never the inferred
  profile of the baseline, because value domains and ranges are made of real
  values out of the file.
- **Run summaries** — when, which file, which contract, how each layer came out,
  and the *shape* of each finding (layer, code, column). **Never the violation
  messages or evidence**, because those quote real cell values.

Both boundaries are enforced in one place each (`contractFile.js`,
`runRecord.js`) and asserted by tests — one of which runs a real validation and
proves no quoted value can reach the stored record.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5174
```

Needs Node 20.19+ or 22.12+. The app is fully usable with no account and no
Supabase project: load a file, or run one of the five built-in examples.

```bash
npm test             # 128 tests
npm run lint
npm run build        # static files in dist/
```

## Optional: accounts, saved contracts and history

1. Create a Supabase project.
2. Run `supabase/schema.sql` in its SQL editor. It creates `contracts` and
   `validation_runs`, enables row level security, and scopes every policy to
   `auth.uid()`. RLS is the whole access model — the publishable key ships in the
   browser bundle by design, so the database, not the key, is what protects data.
3. Copy `.env.example` to `.env.local` and fill in the project URL and
   publishable key.

Without this the app runs exactly as before, minus saving.

## How it is built

```
src/lib/          the engine — pure, no DOM, no network, no React
  contract.js       infers a contract from a baseline file
  validate.js       the four layers
  rules.js          authored rules and WHEN conditions
  parseCsv.js       CSV in, rows or one plain-language reason out
  engineWorker.js   runs all of the above off the main thread
src/screens/      Contracts · Validate · History · landing · sign-in
src/components/   Staircase (the signature view), upload, rule builder, report
```

The engine never imports anything from the UI, and the UI never reimplements a
check. A contract is the interface between them: inference produces one, a person
edits one, and `validate()` cannot tell which it was handed.

## Testing

```bash
npm test                                  # unit + golden master
node scripts/benchmark.mjs 10000 200000   # performance
node scripts/verify-authored-contract.mjs <baseline.csv> <candidate.csv>
```

Three things worth knowing about how this is tested:

- **A golden master** (`golden.test.js`) pins the engine's *full* output — every
  verdict, message, evidence string and column profile — across nine cases. A
  refactor that changes it was not a refactor.
- **Samples are pinned to their verdict.** Each demo pair exists to demonstrate
  one specific break; a test asserts it still does, so a threshold change cannot
  quietly turn the demo into a lie.
- **Negative controls.** Rules are checked against deliberately broken copies as
  well as good data, because a rule that never fires looks correct for the wrong
  reason.

## Performance and limits

Measured on a register-shaped CSV (`scripts/benchmark.mjs`):

| Rows | CSV | Time | Memory |
|---|---|---|---|
| 10,000 | 1 MB | 0.2 s | 30 MB |
| 50,000 | 6 MB | 0.9 s | 138 MB |
| 200,000 | 23 MB | 5.3 s | 406 MB |
| 1,000,000 | 114 MB | ~30 s | ~2.1 GB |

The engine runs in a worker, so the page stays responsive throughout — on two
150,000-row files a 50 ms timer kept a median gap of 47 ms. Memory is roughly
2 KB per row, which is the real ceiling: files over 90 MB are refused with that
reason rather than killing the tab. Going further needs columnar or streaming
parsing.

## Status

A working demo build, verified against real process snapshots. 
