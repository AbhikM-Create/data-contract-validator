// Demo data. Not part of the engine — the engine never imports this.
//
// EVERY ROW HERE IS INVENTED. The people, the company and the salaries are
// fabricated, and the email domain is `.example`, a TLD reserved precisely so
// it can never belong to anyone. No real employee record is shipped in this
// app, and none should ever be added to it.
//
// The shape is a daily snapshot of an employee register — the kind of extract
// an HR system drops each morning — because that is the world these checks are
// for: a file that keeps its columns while its meaning quietly moves.
//
// The CSVs are generated rather than checked in as fixtures for one reason: the
// freshness layer measures the newest row against NOW. A static file would read
// as stale a few days after it was written, and the "clean" pair would start
// failing a layer it is supposed to demonstrate passing. Generating from today
// keeps each sample demonstrating the break it is named for, and only that.

const DAY = 86_400_000

const COLUMNS = [
  'record_date',
  'employee_id',
  'employee_name',
  'department',
  'grade',
  'manager_email',
  'annual_salary_usd',
  'employment_status',
]

// Fifteen invented people. Grades come from a closed vocabulary a person could
// confirm but inference could only ever guess at — which is the whole argument
// for authoring a contract.
const PEOPLE = [
  ['E-1001', 'Ada Okafor', 'Engineering', 'VP', 'ada.okafor', 186000],
  ['E-1002', 'Bruno Salas', 'Engineering', 'Associate', 'ada.okafor', 104000],
  ['E-1003', 'Chen Wei', 'Data Engineering', 'Senior Analyst', 'ada.okafor', 119000],
  ['E-1004', 'Dilara Kaya', 'Data Engineering', 'Analyst', 'ada.okafor', 88000],
  ['E-1005', 'Emil Novak', 'Analytics', 'HOD', 'emil.novak', 171000],
  ['E-1006', 'Farida Haddad', 'Analytics', 'Senior Analyst', 'emil.novak', 121500],
  ['E-1007', 'Grace Lindqvist', 'Analytics', 'Analyst', 'emil.novak', 86500],
  ['E-1008', 'Hugo Marchetti', 'HR Operations', 'Team Lead', 'hugo.marchetti', 112000],
  ['E-1009', 'Ingrid Sorensen', 'HR Operations', 'Associate', 'hugo.marchetti', 99000],
  ['E-1010', 'Jonas Weber', 'Talent Acquisition', 'Associate', 'hugo.marchetti', 97500],
  ['E-1011', 'Keiko Tanaka', 'Finance', 'Owner', 'keiko.tanaka', 194000],
  ['E-1012', 'Liam Doherty', 'Finance', 'Analyst', 'keiko.tanaka', 90500],
  ['E-1013', 'Maya Restrepo', 'Operations', 'Team Lead', 'maya.restrepo', 108000],
  ['E-1014', 'Nikhil Rao', 'Operations', 'Analyst', 'maya.restrepo', 84000],
  ['E-1015', 'Olga Petrova', 'Corporate Strategy', 'Senior Analyst', 'keiko.tanaka', 123000],
]

const ON_LEAVE = new Set(['E-1009'])
const DOMAIN = 'meridian.example'
const DAYS = 30

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// One row per person per day, the newest row `endDaysAgo` days before today.
function register({ endDaysAgo, mutate = (row) => row }) {
  const todayUtc = Math.floor(Date.now() / DAY) * DAY
  const rows = []

  for (let dayIndex = DAYS - 1; dayIndex >= 0; dayIndex -= 1) {
    const stamp = todayUtc - (endDaysAgo + dayIndex) * DAY

    for (const [id, name, department, grade, manager, salary] of PEOPLE) {
      rows.push(mutate({
        record_date: isoDay(stamp),
        employee_id: id,
        employee_name: name,
        department,
        grade,
        manager_email: `${manager}@${DOMAIN}`,
        annual_salary_usd: String(salary),
        employment_status: ON_LEAVE.has(id) ? 'On leave' : 'Active',
      }, { daysBeforeNewest: dayIndex }))
    }
  }

  return rows
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [columns.join(','), ...rows.map((row) => columns.map((c) => escape(row[c])).join(','))].join('\n')
}

const baselineRows = () => register({ endDaysAgo: DAYS })
const cleanRows = () => register({ endDaysAgo: 0 })

// A grade nobody has ever heard of, on one person, for the last fortnight.
// Inference can only report that it is new; a contract can say it is illegal.
const gradeErrorRows = () => register({
  endDaysAgo: 0,
  mutate: (row, { daysBeforeNewest }) =>
    (row.employee_id === 'E-1007' && daysBeforeNewest < 14 ? { ...row, grade: 'Consumer' } : row),
})

// The feed stopped three weeks ago. Every column and value is otherwise
// correct, which is exactly why a schema check waves it through.
const staleRows = () => register({ endDaysAgo: 21 })

// Salaries 83x what they were: still numeric, still in a familiar column, and
// catastrophically wrong. 83 is nowhere near a unit conversion, so this reads
// as an anomaly rather than a change of meaning.
const salaryErrorRows = () => register({
  endDaysAgo: 0,
  mutate: (row) => ({ ...row, annual_salary_usd: String(Number(row.annual_salary_usd) * 83) }),
})

// A rename, a disappearance, an arrival and a retyped column — the kind of
// change an upstream "improvement" ships on a Tuesday.
const SCHEMA_BREAK_COLUMNS = [
  'record_date', 'employee_id', 'employee_name', 'department', 'grade', 'salary', 'cost_centre', 'employment_status',
]

const STATUS_CODES = { Active: '1', 'On leave': '2' }

const schemaBreakRows = () => register({ endDaysAgo: 0 }).map((row) => ({
  record_date: row.record_date,
  employee_id: row.employee_id,
  employee_name: row.employee_name,
  department: row.department,
  grade: row.grade,
  salary: row.annual_salary_usd,
  cost_centre: `CC-${row.department.slice(0, 3).toUpperCase()}`,
  employment_status: STATUS_CODES[row.employment_status],
}))

export const SAMPLE_PAIRS = [
  {
    id: 'clean',
    name: 'Clean pair',
    expectation: 'nothing wrong — all four checks pass',
    blurb: 'A month of the employee register, then the month that followed. Same columns, same grades, current, and the salaries are what they have always been.',
    baselineName: 'register_baseline.csv',
    candidateName: 'register_current.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(cleanRows(), COLUMNS),
  },
  {
    id: 'valueset',
    name: 'Unknown grade',
    expectation: 'the second check catches it',
    blurb: 'One person’s grade has become "Consumer", a value no grade list contains. The columns are perfect and the file is current, so only a check that knows what the values mean will object.',
    baselineName: 'register_baseline.csv',
    candidateName: 'register_grade_error.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(gradeErrorRows(), COLUMNS),
  },
  {
    id: 'freshness',
    name: 'Feed stopped',
    expectation: 'the third check catches it',
    blurb: 'Every column right, every value familiar — and the newest row is three weeks old. The extract stopped arriving and nothing upstream said so.',
    baselineName: 'register_baseline.csv',
    candidateName: 'register_stale.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(staleRows(), COLUMNS),
  },
  {
    id: 'distribution',
    name: 'Salaries 83x',
    expectation: 'only the last check catches it',
    blurb: 'Same columns, same people, dates right up to today — and every salary arriving 83 times too large. This is the break a column-name check waves straight through.',
    baselineName: 'register_baseline.csv',
    candidateName: 'register_salary_error.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(salaryErrorRows(), COLUMNS),
  },
  {
    id: 'schema',
    name: 'Columns changed',
    expectation: 'the very first check stops it',
    blurb: 'The salary column has been renamed, the manager column has gone, a cost centre has appeared, and employment status now arrives as codes instead of words.',
    baselineName: 'register_baseline.csv',
    candidateName: 'register_schema_change.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(schemaBreakRows(), SCHEMA_BREAK_COLUMNS),
  },
]
