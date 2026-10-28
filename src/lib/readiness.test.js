import { describe, expect, it } from 'vitest'
import { parseContractFile, serializeContract } from './contractFile.js'
import { READINESS, checkReadiness } from './readiness.js'
import { ruleColumns, ruleIssue } from './rules.js'
import { validate } from './validate.js'

// A transformed load file for the target HR system, and the target's contract.
// Every person is invented.
const COLUMNS = ['employee_id', 'last_name', 'grade', 'hire_date', 'term_date', 'status', 'annual_salary']
const LOAD = [
  { employee_id: '1001', last_name: 'Okafor', grade: 'VP', hire_date: '2015-03-01', term_date: '', status: 'Active', annual_salary: '186000' },
  { employee_id: '1002', last_name: 'Salas', grade: 'Associate', hire_date: '2019-07-15', term_date: '', status: 'Active', annual_salary: '104000' },
  { employee_id: '1003', last_name: 'Wei', grade: 'Senior Analyst', hire_date: '2018-01-08', term_date: '2024-05-31', status: 'Terminated', annual_salary: '119000' },
  { employee_id: '1004', last_name: 'Kaya', grade: 'Analyst', hire_date: '2021-09-20', term_date: '', status: 'Active', annual_salary: '88000' },
]

const CONTRACT = {
  name: 'Employees (target)',
  rules: [
    { kind: 'nullRule', column: 'last_name', op: 'notNull' },
    { kind: 'valueSet', column: 'grade', op: 'in', target: ['Associate', 'Analyst', 'Senior Analyst', 'Lead', 'VP'] },
    { kind: 'type', column: 'hire_date', op: '=', target: 'date' },
    { kind: 'crossColumn', column: 'term_date', op: '>', target: 'hire_date', targetIsColumn: true },
    { kind: 'nullRule', column: 'term_date', op: 'notNull', when: { column: 'status', op: '=', target: 'Terminated' } },
    // The target accepts an out-of-band salary but flags it for review.
    { kind: 'range', column: 'annual_salary', op: 'between', target: [20000, 400000], severity: 'warn' },
  ],
}

const copy = () => LOAD.map((row) => ({ ...row }))
const run = (rows, options = {}) => checkReadiness(CONTRACT, rows, { columns: COLUMNS, key: ['employee_id'], ...options })
const check = (report, kind) => report.checks.find((c) => c.kind === kind)

describe('load readiness — a clean load file', () => {
  const report = run(LOAD)

  it('is ready, and every check ran and passed', () => {
    expect(report.status).toBe(READINESS.READY)
    expect(report.checks.every((c) => c.status === 'PASS')).toBe(true)
    expect(report.checks).toHaveLength(7) // six rules + the key check
    expect(report.counts).toEqual({ records: 4, rejected: 0, warned: 0, clean: 4 })
    expect(report.headline).toBe('Ready to load. All 4 records pass the 7 checks that ran.')
  })
})

describe('load readiness — each break is predicted (negative controls)', () => {
  it('a value outside the target list rejects the record, named by key', () => {
    const rows = copy()
    rows[1].grade = 'G5' // an untranslated legacy code
    const report = run(rows)
    expect(report.status).toBe(READINESS.NOT_READY)
    expect(report.counts.rejected).toBe(1)
    expect(report.checks[0].kind).toBe('valueSet')
    expect(report.checks[0].examples[0]).toEqual({ row: 2, record: '1002', value: 'G5' })
    expect(report.headline).toMatch(/^Not ready\. 1 of 4 records \(25\.0%\) would be rejected — most often because "grade" must be one of/)
  })

  it('a conditional rule only judges the records it applies to', () => {
    const rows = copy()
    rows[2].term_date = '' // terminated with no end date
    const report = run(rows)
    const gated = report.checks.find((c) => c.rule?.when)
    expect(gated.status).toBe('FAIL')
    expect(gated.applicable).toBe(1)
    expect(gated.examples[0].record).toBe('1003')
  })

  it('a duplicate key rejects every copy, the first included', () => {
    const rows = [...copy(), { ...LOAD[0] }]
    const report = run(rows)
    expect(check(report, 'key').failing).toBe(2)
    expect(report.flagged.map((f) => f.row)).toEqual([1, 5])
    expect(report.counts.rejected).toBe(2)
  })

  it('a blank key rejects the record and labels it by row', () => {
    const rows = copy()
    rows[3].employee_id = ' '
    const report = run(rows)
    expect(check(report, 'key').examples[0]).toEqual({ row: 4, record: 'row 4', value: '(blank key)' })
  })

  it('a warn rule never makes a file NOT_READY', () => {
    const rows = copy()
    rows[0].annual_salary = '1860000'
    const report = run(rows)
    expect(report.status).toBe(READINESS.READY)
    expect(report.counts).toEqual({ records: 4, rejected: 0, warned: 1, clean: 3 })
    expect(report.headline).toBe('Ready to load. None of the 4 records would be rejected by the 7 checks that ran. 1 record would load with a warning.')
  })

  it('one record broken by two rules counts as one rejection, with both reasons', () => {
    const rows = copy()
    rows[1].grade = 'G5'
    rows[1].last_name = ''
    rows[1].annual_salary = '5'
    const report = run(rows)
    expect(report.counts).toEqual({ records: 4, rejected: 1, warned: 0, clean: 3 })
    expect(report.flagged[0].severity).toBe('reject')
    expect(report.flagged[0].reasons).toHaveLength(3)
  })
})

describe('load readiness — what it will not claim', () => {
  it('a rule over a column the file lacks is UNCHECKED, never PASS', () => {
    const columns = COLUMNS.filter((c) => c !== 'grade')
    const rows = copy().map(({ grade: _grade, ...rest }) => rest)
    const report = run(rows, { columns })
    const grade = report.checks.find((c) => c.rule?.column === 'grade')
    expect(grade.status).toBe('UNCHECKED')
    expect(grade.reason).toBe('Not checked because the load file has no column "grade".')
    // A rejecting rule the file cannot satisfy means the file is built to the
    // wrong template: not ready, even though no record "failed".
    expect(report.status).toBe(READINESS.NOT_READY)
    expect(report.missingColumns).toEqual(['grade'])
    expect(report.headline).toBe('Not ready. The load file is missing a column the contract checks: "grade".')
  })

  it('a missing column read by a WHEN condition is caught too', () => {
    const columns = COLUMNS.filter((c) => c !== 'status')
    const report = run(copy(), { columns })
    expect(report.missingColumns).toEqual(['status'])
  })

  it('a warn rule over a missing column leaves the file UNVERIFIED, not READY', () => {
    const columns = COLUMNS.filter((c) => c !== 'annual_salary')
    const report = run(copy(), { columns })
    expect(report.status).toBe(READINESS.UNVERIFIED)
    expect(report.headline).toMatch(/^No rejections predicted, but 1 rule could not be checked/)
  })

  it('a rule the contract file could not read leaves the file UNVERIFIED', () => {
    const report = checkReadiness({ ...CONTRACT, skipped: [{ rule: { kind: 'regex', column: 'x' }, reason: '"regex" is not a known rule kind' }] }, LOAD, { columns: COLUMNS })
    expect(report.status).toBe(READINESS.UNVERIFIED)
  })

  it('a contract with no rules, or a key the file lacks, is INVALID with a reason', () => {
    expect(checkReadiness({ rules: [] }, LOAD).issues[0]).toMatch(/no rules/)
    const report = run(LOAD, { key: ['emp_no'] })
    expect(report.status).toBe(READINESS.INVALID)
    expect(report.issues).toEqual(['The key names "emp_no", which the load file does not have.'])
  })
})

describe('severity — part of the rule, carried everywhere', () => {
  it('rejects an unknown severity', () => {
    expect(ruleIssue({ kind: 'nullRule', column: 'a', op: 'notNull', severity: 'fatal' })).toMatch(/not a severity/)
  })

  it('survives a save and reload', () => {
    const saved = JSON.stringify(serializeContract(CONTRACT))
    const loaded = parseContractFile(saved)
    expect(loaded.skipped).toEqual([])
    expect(loaded.rules.at(-1).severity).toBe('warn')
    expect(run(LOAD).checks).toEqual(checkReadiness(loaded, LOAD, { columns: COLUMNS, key: ['employee_id'] }).checks)
  })

  it('does not change what validate() reports', () => {
    const withSeverity = validate({ rules: CONTRACT.rules }, LOAD)
    const without = validate({ rules: CONTRACT.rules.map(({ severity: _s, ...rule }) => rule) }, LOAD)
    expect(withSeverity.status).toBe(without.status)
    expect(withSeverity.rules.map((r) => r.status)).toEqual(without.rules.map((r) => r.status))
  })

  it('ruleColumns names every column a rule reads', () => {
    expect(ruleColumns(CONTRACT.rules[3])).toEqual(['term_date', 'hire_date'])
    expect(ruleColumns(CONTRACT.rules[4])).toEqual(['term_date', 'status'])
  })
})
