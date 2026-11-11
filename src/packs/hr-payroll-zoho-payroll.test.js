import { describe, expect, it } from 'vitest'
import { createMasker, maskReconciliation } from '../lib/masking.js'
import { runnableContract, runnableSpec } from '../lib/migrationObject.js'
import { objectFromPack, packIssues, paramIssues } from '../lib/packs.js'
import { parseCsv } from '../lib/parseCsv.js'
import { checkReadiness } from '../lib/readiness.js'
import { reconcile } from '../lib/reconcile.js'
import { referenceValues } from '../lib/rules.js'
import PACK, { PROFESSIONAL_TAX_CAP, REGISTER_COMPONENTS } from './hr-payroll-zoho-payroll.js'

// Every object of the HR pack, on invented files: clean files pass, and each
// planted break is caught by the rule or the step it was planted for. Every
// person, PAN, UAN, account and amount here is invented.

const CUTOVER = { cutoverDate: '2026-10-01' }
const csv = (lines) => parseCsv(lines.join('\n'))
const object = (id) => objectFromPack(PACK, id, id === 'employee-master' ? CUTOVER : {})

const ready = (id, file, references) => {
  const o = object(id)
  return checkReadiness(runnableContract(o), file.rows, { columns: file.columns, key: o.spec?.key?.target, references })
}
const recon = (id, source, target) => reconcile(runnableSpec(object(id)), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns })
const failing = (report) => report.checks.filter((c) => c.status === 'FAIL').map((c) => c.kind).sort()
const steps = (report) => Object.fromEntries(report.steps.map((s) => [s.id, s.status]))
const refs = (name, file, column) => ({ [name]: { columns: file.columns, values: { [column]: referenceValues(file.rows, column) } } })

describe('the HR pack itself', () => {
  it('is a valid draft pack: every rule, format and spec reads, against the columns it declares', () => {
    expect(packIssues(PACK)).toEqual([])
    expect(PACK.status).toBe('draft')
    expect(PACK.objects.map((o) => o.id)).toEqual(['employee-master', 'prior-payroll', 'tds-deposits'])
  })

  it('tags every identifier and every pay column it reads, on both sides', () => {
    for (const o of PACK.objects) {
      for (const rule of o.contract.rules.filter((r) => r.kind === 'identifier' && r.target !== 'ifsc')) expect(o.tags[rule.column]).toBe('identifier')
    }
    const register = PACK.objects.find((o) => o.id === 'prior-payroll')
    for (const { source, target } of register.spec.mapping) expect([register.tags[source], register.tags[target]]).toEqual(['pay', 'pay'])
    for (const column of REGISTER_COMPONENTS) expect(register.tags[column]).toBe('pay')
  })

  it('asks for the cutover date and never guesses it', () => {
    expect(() => objectFromPack(PACK, 'employee-master')).toThrow(/Cutover date .* is needed/)
    expect(paramIssues(PACK, 'employee-master', { cutoverDate: '2026-02-30' })).toEqual(['Cutover date — the first day Zoho Payroll pays for must be a real date written YYYY-MM-DD, not "2026-02-30".'])
    expect(paramIssues(PACK, 'employee-master', { cutoverDate: '01/10/2026' })).toHaveLength(1)
    const rule = object('employee-master').contract.rules.find((r) => r.kind === 'comparison')
    expect(rule).toMatchObject({ column: 'Date of Joining', op: '<=', target: '2026-10-01' })
    expect(JSON.stringify(object('employee-master'))).not.toContain('{{')
  })

  it('a rule naming a parameter the object does not declare is refused', () => {
    const bad = structuredClone(PACK)
    bad.objects[0].contract.rules.push({ kind: 'comparison', column: 'Date of Birth', op: '<', target: '{{goLive}}' })
    bad.objects[0].params = [{ id: 'cutoverDate', label: 'Cutover', type: 'time' }]
    expect(packIssues(bad).join(' | ')).toMatch(/a parameter needs an id, a label and a type.*names the parameter "cutoverDate", which the object does not declare.*names the parameter "goLive"/)
  })
})

describe('employee master', () => {
  const locations = csv(['Work Location Name', 'Pune', 'Bengaluru'])
  const header = 'Employee Number,First Name,Last Name,Date of Birth,Date of Joining,Work Location Name,Department,Designation,PAN Number,UAN Number,PF Account Number,Bank Name,Account Number,IFSC Code'
  const load = csv([
    header,
    'E001,Asha,Kulkarni,14/02/1990,01/04/2019,Pune,Finance,Analyst,ABCPK1234F,100200300400,MH/PUN/0012345/000/0000101,HDFC Bank,50100012345678,HDFC0001234',
    'E002,Ravi,Shetty,30/11/1987,15/06/2021,Bengaluru,Sales,Manager,AQWPS5678K,100200300401,KN/BNG/0054321/000/0000202,ICICI Bank,000401234567,ICIC0000004',
    // Joined on the cutover date; no PF yet and paid by cheque.
    'E003,Meera,Iyer,02/07/1999,01/10/2026,Pune,Operations,Associate,BZTPI4321Q,,,,,',
  ])

  it('a clean master is ready', () => {
    expect(ready('employee-master', load, refs('locations', locations, 'Work Location Name')).status).toBe('READY')
  })

  it('a repeated number, a bad PAN and UAN, a joining date after the cutover, a missing IFSC and an unknown location are caught', () => {
    const broken = csv([
      header,
      'E001,Asha,Kulkarni,14/02/1990,01/04/2019,Pune,Finance,Analyst,ABCPK1234,100200300400,MH/PUN/0012345/000/0000101,HDFC Bank,50100012345678,HDFC0001234',
      'E001,Ravi,Shetty,30/11/1987,15/06/2021,Mysuru,Sales,Manager,AQWPS5678K,10020030040,KN/BNG/0054321/000/0000202,ICICI Bank,000401234567,',
      'E003,Meera,Iyer,02/07/1999,02/10/2026,Pune,Operations,Associate,,,,,,',
    ])
    const report = ready('employee-master', broken, refs('locations', locations, 'Work Location Name'))
    expect(report.status).toBe('NOT_READY')
    expect(failing(report)).toEqual(['comparison', 'identifier', 'identifier', 'key', 'nullRule', 'nullRule', 'reference', 'unique'])
    // The missing IFSC rejects the record; the missing PAN is only a warning.
    expect(report.checks.filter((c) => c.kind === 'nullRule' && c.status === 'FAIL').map((c) => c.severity).sort()).toEqual(['reject', 'warn'])
  })

  const legacy = csv([
    'Emp Code,Employee Name,Date of Joining,Location,PAN,UAN,Bank A/c No,IFSC',
    'E001,Asha Kulkarni,01/04/2019,Pune,abcpk1234f,100200300400,50100012345678,HDFC0001234',
    'E002,Ravi Shetty,15/06/2021,Bengaluru,AQWPS5678K,100200300401,000401234567,ICIC0000004',
    'E003,Meera Iyer,01/10/2026,Pune,BZTPI4321Q,,,',
  ])
  const zoho = (rows) => csv(['Employee Number,First Name,Last Name,Date of Joining,Work Location Name,PAN Number,UAN Number,Account Number,IFSC Code', ...rows])
  const clean = [
    'E001,Asha,Kulkarni,01/04/2019,Pune,ABCPK1234F,100200300400,50100012345678,HDFC0001234',
    'E002,Ravi,Shetty,15/06/2021,Bengaluru,AQWPS5678K,100200300401,000401234567,ICIC0000004',
    'E003,Meera,Iyer,01/10/2026,Pune,BZTPI4321Q,,,',
  ]

  it('the legacy list reconciles to Zoho’s, headcount by work location included', () => {
    const report = recon('employee-master', legacy, zoho(clean))
    expect(report.status).toBe('PASS')
    expect(steps(report)).toMatchObject({ keys: 'PASS', completeness: 'PASS', accuracy: 'PASS', totals: 'PASS' })
    expect(report.totals[0].groups.map((g) => [g.group, g.source, g.target])).toEqual([['Bengaluru', 1, 1], ['Pune', 2, 2]])
  })

  it('a location spelled differently on the two sides shows in the headcount instead of hiding', () => {
    const shouting = csv([legacy.columns.join(','), ...legacy.rows.map((r) => legacy.columns.map((c) => (c === 'Location' ? r[c].toUpperCase() : r[c])).join(','))])
    const report = recon('employee-master', shouting, zoho(clean))
    // Record by record the case is ignored, as declared; a headcount groups by
    // the value as written, so the person agrees the names (a group crosswalk).
    expect(steps(report)).toMatchObject({ accuracy: 'PASS', totals: 'FAIL' })
  })

  it('an employee loaded under the wrong location is caught at accuracy and in the headcount', () => {
    const report = recon('employee-master', legacy, zoho([clean[0], clean[1].replace('Bengaluru', 'Pune'), clean[2]]))
    expect(steps(report)).toMatchObject({ completeness: 'PASS', accuracy: 'FAIL', totals: 'FAIL' })
    expect(report.steps.find((s) => s.id === 'totals').findings[0].message).toMatch(/The number of records does not tie/)
  })

  it('an employee left out is caught at completeness; a PAN changed in flight leaves the screen masked', () => {
    expect(steps(recon('employee-master', legacy, zoho([clean[0], clean[2]])))).toMatchObject({ completeness: 'FAIL', totals: 'FAIL' })
    const report = recon('employee-master', legacy, zoho([clean[0].replace('ABCPK1234F', 'ABCPK1243F'), clean[1], clean[2]]))
    expect(steps(report).accuracy).toBe('FAIL')
    const o = object('employee-master')
    const masked = JSON.stringify(maskReconciliation(report, o.spec, createMasker(o.tags, { keys: [...o.spec.key.source, ...o.spec.key.target] })))
    expect(JSON.stringify(report)).toContain('ABCPK1243F')
    expect(masked).not.toContain('ABCPK1243F')
    expect(masked).not.toMatch(/abcpk1234f/i)
    expect(masked).toContain('E001')
  })
})

describe('prior-payroll register', () => {
  const employees = csv(['Employee Number', 'E001', 'E002'])
  const header = `Employee Number,Pay Month,${REGISTER_COMPONENTS.join(',')}`
  const load = csv([
    header,
    'E001,2026-04,40000,16000,24000,80000,4800,200,6500,68500',
    'E001,2026-05,40000,16000,24000,80000,4800,200,6500,68500',
    'E002,2026-04,25000,10000,15000,50000,3000,200,1200,45600',
    'E002,2026-05,25000,10000,15000,50000,3000,200,1200,45600',
  ])

  it('a clean register is ready', () => {
    expect(ready('prior-payroll', load, refs('employees', employees, 'Employee Number')).status).toBe('READY')
  })

  it('a repeated employee-month, an unknown employee, net above gross, negative TDS and professional tax over the yearly cap are caught', () => {
    const broken = csv([
      header,
      'E001,2026-04,40000,16000,24000,80000,4800,2500,6500,68500',
      'E001,2026-04,40000,16000,24000,80000,4800,200,6500,68500',
      'E002,2026-04,25000,10000,15000,50000,3000,200,-1200,45600',
      'E002,2026-05,25000,10000,15000,50000,3000,200,1200,50600',
      'E009,2026-05,25000,10000,15000,50000,3000,200,1200,45600',
    ])
    const report = ready('prior-payroll', broken, refs('employees', employees, 'Employee Number'))
    expect(report.status).toBe('NOT_READY')
    expect(failing(report)).toEqual(['aggregate', 'comparison', 'crossColumn', 'key', 'reference', 'unique'])
    const cap = report.checks.find((c) => c.kind === 'aggregate')
    expect(cap.fileLevel).toBe(true)
    expect(cap.groups.filter((g) => !g.passed).map((g) => g.group)).toEqual(['E001'])
    expect(PROFESSIONAL_TAX_CAP).toBe(2500)
  })

  it('a register without one of the target’s components is not ready', () => {
    const short = csv([header.replace(',Fixed Allowance', ''), 'E001,2026-04,40000,16000,80000,4800,200,6500,68500'])
    const report = ready('prior-payroll', short, refs('employees', employees, 'Employee Number'))
    // A required rule over a column the file lacks: Zoho would refuse the file.
    expect(report.status).toBe('NOT_READY')
    expect(report.checks.filter((c) => c.status === 'UNCHECKED').map((c) => c.reason)).toEqual(Array(2).fill('Not checked because the load file has no column "Fixed Allowance".'))
  })

  // The legacy register in Indian digit grouping (v3 F6).
  const legacy = csv([
    'Emp Code,Month,Gross,PF,PT,TDS,Net Pay',
    'E001,2026-04,"80,000.00","4,800.00",200.00,"6,500.00","68,500.00"',
    'E001,2026-05,"80,000.00","4,800.00",200.00,"6,500.00","68,500.00"',
    'E002,2026-04,"50,000.00","3,000.00",200.00,"1,200.00","45,600.00"',
  ])
  const zohoHeader = 'Employee Number,Pay Month,Gross Earnings,EPF Employee Contribution,Professional Tax,Income Tax,Net Pay'
  const zoho = (rows) => csv([zohoHeader, ...rows])
  const clean = ['E001,2026-04,80000,4800,200,6500,68500', 'E001,2026-05,80000,4800,200,6500,68500', 'E002,2026-04,50000,3000,200,1200,45600']

  it('the legacy register reconciles to Zoho’s month by month and year to date', () => {
    const report = recon('prior-payroll', legacy, zoho(clean))
    expect(report.status).toBe('PASS')
    expect(steps(report)).toMatchObject({ keys: 'PASS', completeness: 'PASS', accuracy: 'PASS', totals: 'PASS' })
  })

  it('TDS changed in one month is caught at accuracy and in that employee’s year-to-date TDS', () => {
    const report = recon('prior-payroll', legacy, zoho([clean[0], clean[1].replace(',6500,', ',5600,'), clean[2]]))
    expect(steps(report)).toMatchObject({ accuracy: 'FAIL', totals: 'FAIL' })
    const totals = report.steps.find((s) => s.id === 'totals').findings
    expect(totals.map((f) => [f.column, f.examples.map((e) => e.key)])).toEqual([['Income Tax', ['E001']]])
  })

  it('a month left out is caught at completeness and in the year-to-date totals', () => {
    expect(steps(recon('prior-payroll', legacy, zoho([clean[0], clean[2]])))).toMatchObject({ completeness: 'FAIL', totals: 'FAIL' })
  })
})

describe('TDS deposits', () => {
  const deducted = csv(['Month,TDS Deducted', '2026-04,"7,700.00"', '2026-05,"7,700.00"', '2026-06,"8,150.00"'])
  const challans = (rows) => csv(['Month,Challan Serial No,BSR Code,Date of Deposit,Tax Deposited', ...rows])
  const clean = ['2026-04,00011,0510308,07/05/2026,7700', '2026-05,00012,0510308,06/06/2026,7700', '2026-06,00013,0510308,07/07/2026,8150']

  it('deductions tie to the challans month by month', () => {
    const report = recon('tds-deposits', deducted, challans(clean))
    expect(report.status).toBe('PASS')
    expect(steps(report)).toMatchObject({ completeness: 'PASS', accuracy: 'PASS', totals: 'PASS' })
  })

  it('a short deposit is caught at accuracy and totals; a month with no challan at completeness', () => {
    expect(steps(recon('tds-deposits', deducted, challans([clean[0], clean[1].replace(',7700', ',7000'), clean[2]])))).toMatchObject({ accuracy: 'FAIL', totals: 'FAIL' })
    expect(steps(recon('tds-deposits', deducted, challans([clean[0], clean[2]])))).toMatchObject({ completeness: 'FAIL', totals: 'FAIL' })
  })
})
