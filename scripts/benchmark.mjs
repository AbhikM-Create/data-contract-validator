// Where does this fall over?
//
// The engine is verified for CORRECTNESS against real files of a few dozen
// rows. Correct and usable are different claims: an HR export is tens of
// thousands of rows and a transaction extract is millions, and every stage here
// runs in the page, on the main thread, in front of someone waiting.
//
//   node scripts/benchmark.mjs [rowCounts...]     default: 10000 50000 200000

import { performance } from 'node:perf_hooks'
import { parseCsv } from '../src/lib/parseCsv.js'
import { inferContract } from '../src/lib/contract.js'
import { validate } from '../src/lib/validate.js'

const SIZES = process.argv.slice(2).map(Number).filter(Boolean)
const ROW_COUNTS = SIZES.length > 0 ? SIZES : [10_000, 50_000, 200_000]

const COLUMNS = [
  'record_date', 'employee_id', 'employee_name', 'department', 'grade',
  'manager_email', 'annual_salary_usd', 'employment_status', 'location',
  'cost_centre', 'fte', 'tenure_days', 'is_current',
]

const DEPARTMENTS = ['Engineering', 'Data Engineering', 'Analytics', 'HR Operations', 'Finance', 'Operations']
const GRADES = ['Analyst', 'Senior Analyst', 'Associate', 'Team Lead', 'VP', 'HOD']
const LOCATIONS = ['Mumbai', 'Pune', 'Bengaluru', 'London', 'New York']
const DAY = 86_400_000

// A file shaped like the ones this tool is pointed at: a wide-ish register with
// dates, categoricals, numerics and a boolean.
function makeCsv(rows, { salaryFactor = 1, endDaysAgo = 0 } = {}) {
  const out = [COLUMNS.join(',')]
  const today = Math.floor(Date.now() / DAY) * DAY

  for (let i = 0; i < rows; i += 1) {
    const day = new Date(today - (endDaysAgo + (i % 365)) * DAY).toISOString().slice(0, 10)
    out.push([
      day,
      `E-${100000 + (i % 25000)}`,
      `Person ${i % 25000}`,
      DEPARTMENTS[i % DEPARTMENTS.length],
      GRADES[i % GRADES.length],
      `manager${i % 40}@meridian.example`,
      String(Math.round((80000 + (i % 90) * 1100) * salaryFactor)),
      i % 37 === 0 ? 'On leave' : 'Active',
      LOCATIONS[i % LOCATIONS.length],
      `CC-${1000 + (i % 60)}`,
      (i % 4 === 0 ? 0.5 : 1).toFixed(1),
      String(200 + (i % 3000)),
      i % 11 === 0 ? 'N' : 'Y',
    ].join(','))
  }
  return out.join('\n')
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`
const ms = (value) => `${value.toFixed(0)} ms`

function time(label, fn) {
  const before = performance.now()
  const result = fn()
  return { label, elapsed: performance.now() - before, result }
}

console.log('rows      csv     parse      infer   validate      TOTAL   heap after')
console.log('─'.repeat(74))

for (const rowCount of ROW_COUNTS) {
  globalThis.gc?.()

  const baselineCsv = makeCsv(rowCount, { endDaysAgo: 400 })
  const candidateCsv = makeCsv(rowCount, { salaryFactor: 83 })

  const parsedBaseline = time('parse', () => parseCsv(baselineCsv))
  const parsedCandidate = parseCsv(candidateCsv)
  const contract = time('infer', () => inferContract(parsedBaseline.result.rows))
  const checked = time('validate', () => validate(contract.result, parsedCandidate.rows))

  const total = parsedBaseline.elapsed + contract.elapsed + checked.elapsed
  const heap = process.memoryUsage().heapUsed

  console.log(
    `${String(rowCount).padEnd(9)} ${mb(baselineCsv.length).padStart(6)} ` +
    `${ms(parsedBaseline.elapsed).padStart(9)} ${ms(contract.elapsed).padStart(10)} ` +
    `${ms(checked.elapsed).padStart(10)} ${ms(total).padStart(10)}  ${mb(heap).padStart(8)}` +
    `   ${checked.result.status}`,
  )
}

console.log('\nEverything above runs on the browser\'s main thread today: while it runs,')
console.log('the page cannot paint, scroll, or respond to a click.')
