// v2 increment 1 verification.
//
// Hand-writes a Contract (no UI, no database), runs it against the two real
// HR snapshots through the untouched v1 validate(), and prints the
// per-layer violations.
//
// A rule that never fires looks correct for the wrong reason, so each rule is
// also run against a deliberately broken copy of the candidate. A rule is only
// verified when it stays quiet on data that satisfies it AND speaks on data
// that does not.
//
//   node scripts/verify-authored-contract.mjs <baseline.csv> <candidate.csv>

import { readFileSync } from 'node:fs'
import { defineContract } from '../src/lib/authoredContract.js'
import { parseCsv } from '../src/lib/parseCsv.js'
import { describeRule } from '../src/lib/rules.js'
import { validate } from '../src/lib/validate.js'

// Both files are supplied by the caller. No default path: the snapshots this
// was written against are real HR records that live outside the repo, and
// baking someone's local path — or a client's name — into a checked-in script
// is how private context leaks into a public history.
const [baselinePath, candidatePath] = process.argv.slice(2)

if (!baselinePath || !candidatePath) {
  console.error('Usage: node scripts/verify-authored-contract.mjs <baseline.csv> <candidate.csv>')
  process.exit(1)
}

const read = (path) => {
  const parsed = parseCsv(readFileSync(path, 'utf8'))
  if (parsed.errors.length > 0) throw new Error(`${path}: ${parsed.errors[0]}`)
  return parsed.rows
}

const baseline = read(baselinePath)
const candidate = read(candidatePath)

// The contract a human would author for this feed: the grade vocabulary is a
// closed legal set (inference could only ever report what it happened to see),
// a validity period must move forwards, and a closed record must say when it
// closed. None of this is discoverable from the data itself.
const LEGAL_GRADES = ['VP', 'HOD', 'Owner', 'Associate', 'Analyst', 'Senior Analyst', 'Team Lead']

const contract = defineContract({
  name: 'Employee snapshot',
  rules: [
    { kind: 'valueSet', column: 'grade', op: 'in', target: LEGAL_GRADES },
    { kind: 'crossColumn', column: 'effective_to', op: '>', target: 'effective_from', targetIsColumn: true },
    { kind: 'nullRule', column: 'effective_to', op: 'notNull', when: { column: 'is_current', op: '=', target: 'N' } },
    { kind: 'nullRule', column: 'employee_email', op: 'notNull' },
  ],
})

const line = (char = '─') => console.log(char.repeat(78))

function report(label, rows) {
  line('═')
  console.log(`${label}  (${rows.length} rows)`)
  line('═')
  const result = validate(contract, rows)
  console.log(`STATUS: ${result.status}   ${result.headline.text}`)
  for (const layer of result.layers) {
    console.log(`\n  ${layer.label.padEnd(13)} ${layer.status}`)
    if (layer.note) console.log(`    note: ${layer.note}`)
    for (const v of layer.violations) {
      console.log(`    [${v.code}] ${v.column}`)
      console.log(`      ${v.message}`)
      console.log(`      ${v.evidence}`)
    }
  }
  console.log()
  return result
}

console.log('CONTRACT (hand-written, no baseline profile — rules only)\n')
contract.rules.forEach((rule, i) => console.log(`  ${i + 1}. ${describeRule(rule)}`))
console.log()

report(`BASELINE  ${baselinePath.split('/').pop()}`, baseline)
report(`CANDIDATE ${candidatePath.split('/').pop()}`, candidate)

// --- negative controls ------------------------------------------------------
// Each mutation breaks exactly one rule, so a rule that fails to fire here is
// broken even though it looked fine above.
line('═')
console.log('NEGATIVE CONTROLS — each plants one violation into the candidate')
line('═')

const controls = [
  {
    label: 'reverse EMP018\u2019s validity period (effective_to before effective_from)',
    expect: 'crossColumn fires on that row',
    rows: candidate.map((row) => (row.id_src_employee === 'EMP018' ? { ...row, effective_to: '2020-01-01' } : row)),
  },
  {
    label: 'blank EMP018\u2019s effective_to while it stays is_current = N',
    expect: 'the WHEN rule fires on that row only',
    rows: candidate.map((row) => (row.id_src_employee === 'EMP018' ? { ...row, effective_to: '' } : row)),
  },
  {
    label: 'blank one employee_email',
    expect: 'the unconditional notNull rule fires',
    rows: candidate.map((row) => (row.id_src_employee === 'EMP005' ? { ...row, employee_email: '' } : row)),
  },
]

for (const control of controls) {
  const result = validate(contract, control.rows)
  const fired = result.violations.filter((v) => v.code.startsWith('rule:'))
  console.log(`\n  ${control.label}`)
  console.log(`    expected: ${control.expect}`)
  for (const v of fired) console.log(`    fired:    [${v.code}] ${v.column} — ${v.evidence}`)
  if (fired.length === 0) console.log('    fired:    NOTHING  <-- rule did not fire, investigate')
}

console.log(`\nRow numbers above are data rows (row 1 = the first row under the header).`)
console.log(`EMP018 is data row ${candidate.findIndex((r) => r.id_src_employee === 'EMP018') + 1}, ` +
  `EMP021 is data row ${candidate.findIndex((r) => r.id_src_employee === 'EMP021') + 1}, ` +
  `EMP005 is data row ${candidate.findIndex((r) => r.id_src_employee === 'EMP005') + 1}.`)
