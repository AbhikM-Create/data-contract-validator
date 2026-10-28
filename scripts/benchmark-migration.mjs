// How large a migration the CLIs handle, measured rather than claimed — and
// checked: every run plants known breaks and fails if a single count is off.
//
//   node scripts/benchmark-migration.mjs [rows=1000000] [--keep]
//   node --max-old-space-size=512 scripts/benchmark-migration.mjs 5000000
//
// Generates a legacy HR extract, its transformed target and a target contract
// in a temp directory (streamed to disk, never held), then runs reconciliation
// and load readiness exactly as the CLIs do. Every person is invented.

import { closeSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkReadinessFile } from './lib/readinessFile.mjs'
import { reconcileFiles } from './lib/reconcileFiles.mjs'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 1_000_000)
const dir = mkdtempSync(join(tmpdir(), 'dcv-bench-'))

const GRADES = { G5: 'Associate', G6: 'Analyst', G7: 'Senior Analyst', G8: 'Lead', G9: 'VP' }
const codes = Object.keys(GRADES)

// Planted breaks, at spacings that scale with N so every size has some.
const every = (n) => Math.max(7, Math.floor(N / n))
const UNMAPPED = every(5)
const MISSING = every(6)
const WRONG = every(7)
const DUPLICATE = every(4)

const expected = { outOfScope: 0, missing: 0, unmapped: 0, mismatch: 0, duplicateKeys: 0 }

function generate() {
  const legacy = openSync(join(dir, 'legacy.csv'), 'w')
  const target = openSync(join(dir, 'target.csv'), 'w')
  writeSync(legacy, 'PERNR,NACHN,TRFGR,ANSAL,BEGDA,BUKRS,STAT2\n')
  writeSync(target, 'employee_id,last_name,grade,annual_salary,hire_date,company_code\n')
  let lb = []
  let tb = []
  for (let i = 0; i < N; i += 1) {
    const id = 1_000_000 + i
    const grade = codes[i % 5]
    const salary = 50_000 + ((i * 37) % 150_000)
    const company = i % 3 ? '1000' : '2000'
    const day = new Date(Date.UTC(2005, 0, 1) + (i % 6000) * 86_400_000).toISOString().slice(0, 10)
    const inScope = i % 50 !== 0
    const legacyGrade = i % UNMAPPED === 3 ? 'G4' : grade
    lb.push(`${id},Name${i},${legacyGrade},"${salary.toLocaleString('en-US')}.00",${day},${company},${inScope ? 3 : 0}`)

    if (!inScope) expected.outOfScope += 1
    else if (i % MISSING === 5) expected.missing += 1
    else {
      const duplicated = i % DUPLICATE === 1
      if (duplicated) expected.duplicateKeys += 1
      if (legacyGrade === 'G4' && !duplicated) expected.unmapped += 1
      const wrong = i % WRONG === 2 && legacyGrade !== 'G4'
      if (wrong && !duplicated) expected.mismatch += 1
      const line = `${id},NAME${i},${GRADES[grade]},${wrong ? salary * 10 : salary},${day}T00:00:00Z,${company === '1000' ? 'US01' : 'DE01'}`
      tb.push(line)
      if (duplicated) tb.push(line)
    }
    if (lb.length >= 50_000) { writeSync(legacy, `${lb.join('\n')}\n`); lb = [] }
    if (tb.length >= 50_000) { writeSync(target, `${tb.join('\n')}\n`); tb = [] }
  }
  writeSync(legacy, `${lb.join('\n')}\n`)
  writeSync(target, `${tb.join('\n')}\n`)
  closeSync(legacy)
  closeSync(target)
}

const SPEC = {
  name: 'Employees',
  key: { source: 'PERNR', target: 'employee_id' },
  scope: { source: { column: 'STAT2', op: '=', target: '3' } },
  mapping: [
    { source: 'NACHN', target: 'last_name', ignoreCase: true },
    { source: 'TRFGR', target: 'grade', map: GRADES },
    { source: 'ANSAL', target: 'annual_salary', tolerance: 0.01 },
    { source: 'BEGDA', target: 'hire_date' },
  ],
  totals: [{ source: 'ANSAL', target: 'annual_salary', groupBy: { source: 'BUKRS', target: 'company_code', map: { 1000: 'US01', 2000: 'DE01' } } }],
}

const CONTRACT = {
  name: 'Employees (target)',
  rules: [
    { kind: 'nullRule', column: 'last_name', op: 'notNull' },
    { kind: 'valueSet', column: 'grade', op: 'in', target: Object.values(GRADES) },
    { kind: 'type', column: 'hire_date', op: '=', target: 'date' },
    { kind: 'range', column: 'annual_salary', op: 'between', target: [20_000, 400_000], severity: 'warn' },
  ],
  skipped: [],
}

const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`
const failures = []
const expect = (label, got, want) => {
  if (got !== want) failures.push(`${label}: got ${got}, planted ${want}`)
}

try {
  console.log(`Generating ${N.toLocaleString('en-US')} legacy rows in ${dir} …`)
  generate()
  const sourceSize = statSync(join(dir, 'legacy.csv')).size
  const targetSize = statSync(join(dir, 'target.csv')).size
  console.log(`  legacy ${mb(sourceSize)}, target ${mb(targetSize)}\n`)

  const recon = await reconcileFiles(SPEC, join(dir, 'legacy.csv'), join(dir, 'target.csv'), { tmpDir: dir })
  if (recon.error) throw new Error(recon.error)
  const c = recon.report.counts
  console.log(`reconcile  ${recon.seconds.toFixed(1)}s  ${recon.partitions} partition(s)  peak RSS so far ${mb(process.resourceUsage().maxRSS * 1024)}`)
  expect('out of scope', c.sourceOutOfScope, expected.outOfScope)
  expect('missing', c.missing, expected.missing)
  expect('duplicated target keys', c.targetDuplicateKeys, expected.duplicateKeys)
  expect('unmapped', recon.report.fields[1].unmapped, expected.unmapped)
  expect('salary mismatches', recon.report.fields[2].mismatched, expected.mismatch)

  const ready = await checkReadinessFile(CONTRACT, join(dir, 'target.csv'), { key: ['employee_id'], tmpDir: dir })
  if (ready.error) throw new Error(ready.error)
  console.log(`readiness  ${ready.seconds.toFixed(1)}s  peak RSS so far ${mb(process.resourceUsage().maxRSS * 1024)}`)
  expect('rejected (both copies of each duplicate)', ready.report.counts.rejected, expected.duplicateKeys * 2)

  console.log(`\nplanted: ${JSON.stringify(expected)}`)
  if (failures.length > 0) {
    console.error(`\nFAILED — a planted break was not reported exactly:\n  ${failures.join('\n  ')}`)
    process.exitCode = 1
  } else {
    console.log('every planted break reported exactly')
  }
} finally {
  if (keep) console.log(`files kept in ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
}
