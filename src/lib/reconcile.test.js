import { describe, expect, it } from 'vitest'
import { normalizeSpec, reconcile, specIssues } from './reconcile.js'

// A legacy HR extract (SAP-style names) and the same people after loading into
// a new system (new names, grade codes crosswalked, dates and money reformatted).
// Every person is invented.
const LEGACY = [
  { PERNR: '1001', NACHN: 'Okafor', TRFGR: 'G9', ANSAL: '186,000.00', BEGDA: '2015-03-01', BUKRS: '1000', STAT2: '3' },
  { PERNR: '1002', NACHN: 'Salas', TRFGR: 'G5', ANSAL: '104,000.00', BEGDA: '2019-07-15', BUKRS: '1000', STAT2: '3' },
  { PERNR: '1003', NACHN: 'Wei', TRFGR: 'G7', ANSAL: '119,000.00', BEGDA: '2018-01-08', BUKRS: '2000', STAT2: '3' },
  { PERNR: '1004', NACHN: 'Kaya', TRFGR: 'G6', ANSAL: '88,000.00', BEGDA: '2021-09-20', BUKRS: '2000', STAT2: '3' },
  { PERNR: '1005', NACHN: 'Novak', TRFGR: 'G8', ANSAL: '171,000.00', BEGDA: '2012-11-05', BUKRS: '2000', STAT2: '3' },
  // Withdrawn employee: out of migration scope by design.
  { PERNR: '0999', NACHN: 'Ilves', TRFGR: 'G5', ANSAL: '70,000.00', BEGDA: '2010-01-04', BUKRS: '1000', STAT2: '0' },
]

const GRADES = { G5: 'Associate', G6: 'Analyst', G7: 'Senior Analyst', G8: 'Lead', G9: 'VP' }

const TARGET = [
  { employee_id: '1001', last_name: 'OKAFOR', grade: 'VP', annual_salary: '186000', hire_date: '2015-03-01T00:00:00Z', company_code: 'US01' },
  { employee_id: '1002', last_name: 'SALAS', grade: 'Associate', annual_salary: '104000', hire_date: '2019-07-15T00:00:00Z', company_code: 'US01' },
  { employee_id: '1003', last_name: 'WEI', grade: 'Senior Analyst', annual_salary: '119000', hire_date: '2018-01-08T00:00:00Z', company_code: 'DE01' },
  { employee_id: '1004', last_name: 'KAYA', grade: 'Analyst', annual_salary: '88000', hire_date: '2021-09-20T00:00:00Z', company_code: 'DE01' },
  { employee_id: '1005', last_name: 'NOVAK', grade: 'Lead', annual_salary: '171000', hire_date: '2012-11-05T00:00:00Z', company_code: 'DE01' },
]

const SPEC = {
  name: 'Employees — Mock 2',
  key: { source: 'PERNR', target: 'employee_id' },
  scope: { source: { column: 'STAT2', op: '=', target: '3' } },
  mapping: [
    { source: 'NACHN', target: 'last_name', ignoreCase: true },
    { source: 'TRFGR', target: 'grade', map: GRADES },
    { source: 'ANSAL', target: 'annual_salary', tolerance: 0.01 },
    { source: 'BEGDA', target: 'hire_date' },
  ],
  totals: [
    {
      source: 'ANSAL',
      target: 'annual_salary',
      groupBy: { source: 'BUKRS', target: 'company_code', map: { 1000: 'US01', 2000: 'DE01' } },
    },
  ],
}

const copy = (rows) => rows.map((row) => ({ ...row }))
const stepOf = (report, id) => report.steps.find((s) => s.id === id)
const statuses = (report) => Object.fromEntries(report.steps.map((s) => [s.id, s.status]))

describe('reconcile — a clean load', () => {
  const report = reconcile(SPEC, LEGACY, TARGET)

  it('passes every step', () => {
    expect(statuses(report)).toEqual({
      keys: 'PASS', completeness: 'PASS', mapping: 'PASS', accuracy: 'PASS', totals: 'PASS',
    })
    expect(report.status).toBe('PASS')
    expect(report.findings).toEqual([])
  })

  it('counts out-of-scope records instead of dropping them silently', () => {
    expect(report.counts.sourceOutOfScope).toBe(1)
    expect(report.counts.expected).toBe(5)
    expect(report.counts.matched).toBe(5)
  })

  it('compares across formats: thousands separators, ISO timestamps, case', () => {
    for (const field of report.fields) expect(field.matchRate).toBe(1)
  })

  it('says so in one sentence', () => {
    expect(report.headline).toBe('Reconciled. 5 of 5 in-scope records matched one to one, and every check that ran passed.')
  })
})

describe('reconcile — each step catches its own break (negative controls)', () => {
  it('keys: a fanned-out join duplicates a target record', () => {
    const target = [...copy(TARGET), { ...TARGET[2] }]
    const report = reconcile(SPEC, LEGACY, target)
    expect(stepOf(report, 'keys').status).toBe('FAIL')
    expect(report.findings[0].code).toBe('duplicate-key-target')
    expect(report.findings[0].examples[0]).toEqual({ key: '1003', detail: '2 records', count: 2 })
    // It arrived — too often — so it is not ALSO reported missing.
    expect(report.counts.missing).toBe(0)
    expect(report.headline).toMatch(/^Stopped at Keys\./)
  })

  it('keys: a record with no key', () => {
    const target = copy(TARGET)
    target[0].employee_id = '  '
    const report = reconcile(SPEC, LEGACY, target)
    expect(report.findings.map((f) => f.code)).toContain('blank-key-target')
  })

  it('completeness: a record that never arrived, and one nobody sent', () => {
    const target = copy(TARGET).filter((row) => row.employee_id !== '1004')
    target.push({ ...TARGET[0], employee_id: '7777' })
    const report = reconcile(SPEC, LEGACY, target)
    expect(statuses(report)).toMatchObject({ keys: 'PASS', completeness: 'FAIL' })
    const codes = stepOf(report, 'completeness').findings.map((f) => [f.code, f.examples[0].key])
    expect(codes).toEqual([['missing-in-target', '1004'], ['extra-in-target', '7777']])
    expect(report.headline).toBe('Stopped at Completeness. 4 of 5 in-scope records matched one to one. Keys passed above it.')
  })

  it('mapping: a legacy code with no crosswalk entry is a spec gap, not a mismatch', () => {
    const source = copy(LEGACY)
    source[1].TRFGR = 'G4'
    const report = reconcile(SPEC, source, TARGET)
    expect(statuses(report)).toMatchObject({ keys: 'PASS', completeness: 'PASS', mapping: 'FAIL', accuracy: 'PASS' })
    const gap = stepOf(report, 'mapping').findings[0]
    expect(gap.examples).toEqual([{ value: 'G4', detail: '1 record', count: 1 }])
    expect(gap.message).toMatch(/mapping specification, not in the load/)
  })

  it('accuracy: a value changed in flight', () => {
    const target = copy(TARGET)
    target[3].annual_salary = '8800' // a dropped digit
    const report = reconcile(SPEC, LEGACY, target)
    expect(statuses(report)).toMatchObject({ keys: 'PASS', completeness: 'PASS', mapping: 'PASS', accuracy: 'FAIL' })
    const miss = stepOf(report, 'accuracy').findings[0]
    expect(miss.column).toBe('annual_salary')
    expect(miss.examples[0].key).toBe('1004')
    expect(report.counts.rowsWithDifference).toBe(1)
  })

  it('accuracy: the wrong crosswalk target is a mismatch, and says what was expected', () => {
    const target = copy(TARGET)
    target[2].grade = 'Analyst'
    const report = reconcile(SPEC, LEGACY, target)
    expect(stepOf(report, 'accuracy').findings[0].examples[0].detail)
      .toBe('source "G7" → expected "Senior Analyst", target has "Analyst"')
  })

  it('accuracy: within tolerance is not a mismatch, beyond it is', () => {
    const near = copy(TARGET)
    near[0].annual_salary = '186000.01'
    expect(stepOf(reconcile(SPEC, LEGACY, near), 'accuracy').status).toBe('PASS')
    const far = copy(TARGET)
    far[0].annual_salary = '186000.02'
    expect(stepOf(reconcile(SPEC, LEGACY, far), 'accuracy').status).toBe('FAIL')
  })

  it('totals: a unit error on every row of one company ties on keys and fails on totals', () => {
    // Spec without a salary field mapping: only the control total watches money.
    const spec = { ...SPEC, mapping: SPEC.mapping.filter((m) => m.target !== 'annual_salary') }
    const target = copy(TARGET).map((row) =>
      row.company_code === 'DE01' ? { ...row, annual_salary: String(Number(row.annual_salary) * 100) } : row)
    const report = reconcile(spec, LEGACY, target)
    expect(statuses(report)).toMatchObject({ keys: 'PASS', completeness: 'PASS', accuracy: 'PASS', totals: 'FAIL' })
    const total = stepOf(report, 'totals').findings[0]
    expect(total.examples.map((e) => e.key)).toEqual(['DE01'])
    expect(report.totals[0].groups.find((g) => g.group === 'US01').ties).toBe(true)
  })
})

describe('reconcile — composite keys', () => {
  it('matches on every key column together', () => {
    const spec = { key: ['id', 'effective_from'], mapping: [{ source: 'amount' }] }
    const rows = [
      { id: 'A', effective_from: '2024-01-01', amount: '1' },
      { id: 'A', effective_from: '2024-06-01', amount: '2' },
    ]
    const report = reconcile(spec, rows, copy(rows))
    expect(report.status).toBe('PASS')
    expect(report.counts.matched).toBe(2)
    const swapped = copy(rows)
    swapped[1].amount = '3'
    expect(reconcile(spec, rows, swapped).findings[0].examples[0].key).toBe('A / 2024-06-01')
  })
})

describe('reconcile — a spec that cannot run says why', () => {
  it('reports every unknown column instead of half-running', () => {
    const report = reconcile({ ...SPEC, key: { source: 'PERNR', target: 'emp_no' } }, LEGACY, TARGET)
    expect(report.status).toBe('INVALID')
    expect(report.issues).toEqual(['The target file has no column "emp_no" (named as a key).'])
    expect(report.steps.every((s) => s.status === 'SKIPPED')).toBe(true)
  })

  it('requires a key', () => {
    expect(specIssues({}, ['a'], ['a'])[0]).toMatch(/No key is set/)
  })

  it('rejects a composite key that does not pair up', () => {
    const issues = specIssues(normalizeSpec({ key: { source: ['a', 'b'], target: ['a'] } }), ['a', 'b'], ['a'])
    expect(issues[0]).toMatch(/must pair up one to one/)
  })
})

describe('reconcile — unconfigured steps', () => {
  it('reads SKIPPED, never PASS', () => {
    const report = reconcile({ key: { source: 'PERNR', target: 'employee_id' } }, LEGACY, TARGET)
    expect(statuses(report)).toMatchObject({ mapping: 'SKIPPED', accuracy: 'SKIPPED', totals: 'SKIPPED' })
  })
})

describe('reconcile — drill-down', () => {
  it('keeps five examples by default and as many as asked for, first in the file', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), amount: String(i) }))
    const changed = many.map((row) => ({ ...row, amount: String(Number(row.amount) + 1) }))
    const spec = { key: 'id', mapping: [{ source: 'amount' }] }
    expect(reconcile(spec, many, changed).fields[0].examples).toHaveLength(5)
    const drill = reconcile(spec, many, changed, { exampleLimit: 1000 })
    const finding = drill.findings.find((f) => f.code === 'field-mismatch')
    expect(finding.examples).toHaveLength(40)
    expect(finding.examples.map((e) => e.key)).toEqual(many.map((r) => r.id))
    expect(finding.examples[3]).toMatchObject({ key: '3', source: '3', expected: '3', target: '4' })
    // The sentence is the same whatever the limit: it counts, it does not list.
    expect(finding.message).toBe(reconcile(spec, many, changed).findings.find((f) => f.code === 'field-mismatch').message)
  })
})

describe('reconcile — normalising is idempotent', () => {
  it('a spec normalised twice reconciles exactly as one normalised once', () => {
    // Crosswalks become Maps when normalised; a second pass once read each Map
    // as an empty object and every legacy value came back "unmapped".
    const once = normalizeSpec(SPEC)
    expect(reconcile(normalizeSpec(once), LEGACY, TARGET)).toEqual(reconcile(SPEC, LEGACY, TARGET))
    expect(reconcile(once, LEGACY, TARGET).status).toBe('PASS')
  })
})
