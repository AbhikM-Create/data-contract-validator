// The CLI as a pipeline sees it: the installed command, real files, its exit
// code, its --json against the published schema, its JUnit file.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterAll, describe, expect, it } from 'vitest'
import { migrationObjectToJson } from '../src/lib/migrationObject.js'
import { parseCsv } from '../src/lib/parseCsv.js'
const parseCsvRows = (text) => parseCsv(text).rows
import { VERSION } from '../src/lib/version.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../src/samples/migrationSample.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'dcv-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p }

const object = file('employees.migration.json', migrationObjectToJson(migrationSampleObject()))
const source = file('legacy.csv', migrationSource())
const target = file('target.csv', migrationTarget())
const load = file('load.csv', migrationLoadFile())
const clean = file('clean.csv', migrationLoadFile().replace(/^(\d+,\w+,),/gm, '$1FILLED,').replace('1250000.00', '125000.00'))

const dcv = (...args) => {
  const result = spawnSync(process.execPath, [join(root, 'bin/dcv.mjs'), ...args], { cwd: dir, encoding: 'utf8' })
  return { code: result.status, out: result.stdout, err: result.stderr }
}
const ajv = new Ajv2020({ strict: false, allErrors: true })
const schema = (name) => ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', name), 'utf8')))
const reconcileSchema = schema('reconcile-report.schema.json')
const readinessSchema = schema('readiness-report.schema.json')
const errors = (validate, doc) => (validate(doc) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`))

describe('dcv', () => {
  // v3 §5.1: a reference rule reads a declared reference file. Without it the
  // rule is unchecked and the file is not called ready (exit 2: could not confirm).
  it('checks reference rules against --reference files, and refuses to confirm without them', () => {
    const contract = file('vendors-rule.contract.json', JSON.stringify({
      kind: 'data-contract-validator/contract', formatVersion: 1, name: 'AP (target)',
      rules: [{ kind: 'reference', column: 'company_code', op: 'in', target: { file: 'companies', column: 'code' } }],
    }))
    const companies = file('companies.csv', ['code,name', 'DE01,Germany', ''].join(String.fromCharCode(10)))
    const withRef = dcv('check', contract, 'load.csv', '--reference', `companies=${companies}`, '--json')
    const report = JSON.parse(withRef.out)
    expect(report.status).toBe('NOT_READY') // the sample's other company codes are not in the file
    expect(withRef.code).toBe(1)
    const without = dcv('check', contract, 'load.csv', '--json')
    expect(JSON.parse(without.out).status).toBe('UNVERIFIED')
    expect(without.code).toBe(2)
    expect(dcv('check', contract, 'load.csv', '--reference', 'companies').code).toBe(2)
  })

  // A file-level total in --json still validates against the published schema.
  it('reports a failed aggregate as a file-level check that validates against the schema', () => {
    const contract = file('totals.contract.json', JSON.stringify({
      kind: 'data-contract-validator/contract', formatVersion: 1, name: 'Totals',
      rules: [{ kind: 'aggregate', column: 'annual_salary', fn: 'sum', op: '=', target: '1', groupBy: 'company_code' }],
    }))
    const run = dcv('check', contract, 'load.csv', '--json')
    const report = JSON.parse(run.out)
    expect(errors(readinessSchema, report)).toEqual([])
    const total = report.checks.find((c) => c.kind === 'aggregate')
    expect(total.fileLevel).toBe(true)
    expect(total.examples).toEqual([])
    expect(total.groups.length).toBeGreaterThan(0)
    expect(report.status).toBe('NOT_READY')
    expect(run.code).toBe(1)
  })

  // v3 §5.2: a migration object's sensitivity tags mask what leaves — the fix
  // list and --json; --unmask shows them in full.
  it('masks tagged values in --rejects and --json, and shows them with --unmask', () => {
    const tagged = file('tagged.migration.json', migrationObjectToJson({ ...migrationSampleObject(), tags: { last_name: 'personal', annual_salary: 'pay', first_name: 'aadhaar' } }))
    const masked = dcv('check', tagged, 'load.csv', '--json', '--rejects', 'fixes-masked.csv')
    const fixes = readFileSync(join(dir, 'fixes-masked.csv'), 'utf8')
    expect(errors(readinessSchema, JSON.parse(masked.out))).toEqual([])
    expect(fixes).toMatch(/\[masked\]/)
    expect(fixes).not.toMatch(/1250000\.00/) // the out-of-band salary, masked
    expect(masked.out).not.toMatch(/1250000\.00/)
    const open = dcv('check', tagged, 'load.csv', '--json', '--rejects', 'fixes-open.csv', '--unmask')
    expect(readFileSync(join(dir, 'fixes-open.csv'), 'utf8')).toMatch(/1250000\.00/)
    expect(open.out).toMatch(/1250000\.00/)
    // Aadhaar-tagged values stay masked even unmasked: only the last 4 remain.
    const firstNames = parseCsvRows(readFileSync(join(dir, 'fixes-open.csv'), 'utf8')).map((r) => r.first_name)
    expect(firstNames.every((v) => v === '' || /^•+.{0,4}$/.test(v))).toBe(true)
  })

  // v3 §6: a pack becomes a migration object the other commands read.
  it('lists packs, writes an object from one, and that object checks a load file', () => {
    const listed = dcv('pack', 'list')
    expect(listed.code).toBe(0)
    expect(listed.out).toMatch(/finance-tally-zoho-books\s+v0\.1\.0\s+DRAFT/)
    expect(listed.out).toMatch(/opening-trial-balance/)
    const made = dcv('pack', 'finance-tally-zoho-books', 'opening-trial-balance', '--out', 'tb.migration.json')
    expect(made.code).toBe(0)
    expect(made.err).toMatch(/DRAFT: not yet run on real exports/)
    file('tb-load.csv', ['Account Name,Debit,Credit', 'Cash,100,0', 'Capital,0,90', ''].join(String.fromCharCode(10)))
    const checked = dcv('check', 'tb.migration.json', 'tb-load.csv', '--json')
    const report = JSON.parse(checked.out)
    expect(report.status).toBe('NOT_READY') // 100 of debits against 90 of credits: the file total does not tie
    expect(report.checks.find((c) => c.kind === 'aggregate').fileLevel).toBe(true)
    expect(dcv('pack', 'finance-tally-zoho-books', 'nope').code).toBe(2)
    expect(dcv('pack', 'nope', 'x').code).toBe(2)
  })

  // v3 §6.2: the HR pack's employee master needs the cutover date, never guesses it.
  it('asks for a pack object’s cutover date, and the object then judges joining dates by it', () => {
    expect(dcv('pack', 'list').out).toMatch(/employee-master\s+Employee master\s+\(needs --param cutoverDate=YYYY-MM-DD\)/)
    const without = dcv('pack', 'hr-payroll-zoho-payroll', 'employee-master', '--out', 'emp.migration.json')
    expect(without.code).toBe(2)
    expect(without.err).toMatch(/Cutover date .* is needed.*--param cutoverDate=YYYY-MM-DD/s)
    expect(dcv('pack', 'hr-payroll-zoho-payroll', 'employee-master', '--param', 'cutoverDate=2026-02-30').code).toBe(2)
    expect(dcv('pack', 'hr-payroll-zoho-payroll', 'employee-master', '--param', 'goLive=2026-10-01').err).toMatch(/takes no parameter "goLive"; it takes cutoverDate/)

    const made = dcv('pack', 'hr-payroll-zoho-payroll', 'employee-master', '--param', 'cutoverDate=2026-10-01', '--out', 'emp.migration.json')
    expect(made.code).toBe(0)
    const nl = String.fromCharCode(10)
    file('locations.csv', ['Work Location Name', 'Pune', ''].join(nl))
    file('emp-load.csv', [
      'Employee Number,First Name,Last Name,Date of Birth,Date of Joining,Work Location Name,Department,Designation,PAN Number,UAN Number,PF Account Number,Bank Name,Account Number,IFSC Code',
      'E001,Asha,Kulkarni,14/02/1990,01/04/2019,Pune,Finance,Analyst,ABCPK1234F,100200300400,,,,',
      'E002,Ravi,Shetty,30/11/1987,15/10/2026,Pune,Sales,Manager,AQWPS5678K,,,,,',
      '',
    ].join(nl))
    const checked = dcv('check', 'emp.migration.json', 'emp-load.csv', '--reference', 'locations=locations.csv', '--json')
    expect(checked.code).toBe(1)
    const report = JSON.parse(checked.out)
    expect(report.status).toBe('NOT_READY')
    expect(report.checks.filter((c) => c.status === 'FAIL').map((c) => c.kind)).toEqual(['comparison'])
    // Tagged identifiers leave the CLI masked.
    expect(checked.out).not.toContain('AQWPS5678K')

    // Year-to-date pay per employee leaves --json without its amounts, and the
    // report still validates against the published schema.
    expect(dcv('pack', 'hr-payroll-zoho-payroll', 'prior-payroll', '--out', 'pay.migration.json').code).toBe(0)
    file('legacy-pay.csv', ['Emp Code,Month,Gross,PF,PT,TDS,Net Pay', 'E001,2026-04,80000,4800,200,6500,68500', ''].join(nl))
    file('zoho-pay.csv', ['Employee Number,Pay Month,Gross Earnings,EPF Employee Contribution,Professional Tax,Income Tax,Net Pay', 'E001,2026-04,80000,4800,200,5600,68500', ''].join(nl))
    const pay = dcv('reconcile', 'pay.migration.json', 'legacy-pay.csv', 'zoho-pay.csv', '--json')
    expect(pay.code).toBe(1)
    const payReport = JSON.parse(pay.out)
    expect(errors(reconcileSchema, payReport)).toEqual([])
    expect(pay.out).not.toMatch(/6,?500|5,?600/)
    expect(payReport.totals.find((t) => t.target === 'Income Tax').groups[0]).toMatchObject({ group: 'E001', ties: false, masked: true })

    // final-spec C1: the object's column matching is applied by the CLI too —
    // the same files under the client's own headers give the same answer.
    const matched = JSON.parse(readFileSync(join(dir, 'pay.migration.json'), 'utf8'))
    matched.columnMap = { source: { 'Emp Code': 'Staff No', TDS: 'Tax' }, target: { 'Income Tax': 'TDS Amount' } }
    file('pay-matched.migration.json', JSON.stringify(matched))
    file('legacy-pay-client.csv', ['Staff No,Month,Gross,PF,PT,Tax,Net Pay', 'E001,2026-04,80000,4800,200,6500,68500', ''].join(nl))
    file('zoho-pay-client.csv', ['Employee Number,Pay Month,Gross Earnings,EPF Employee Contribution,Professional Tax,TDS Amount,Net Pay', 'E001,2026-04,80000,4800,200,5600,68500', ''].join(nl))
    const viaMap = dcv('reconcile', 'pay-matched.migration.json', 'legacy-pay-client.csv', 'zoho-pay-client.csv', '--json')
    expect(viaMap.code).toBe(1)
    const strip = (r) => ({ ...r, generatedAt: null, files: null })
    expect(strip(JSON.parse(viaMap.out))).toEqual(strip(payReport))
    // Without the matching the same files cannot be judged (exit 2), and a
    // matching that does not fit a file is refused with the reason.
    expect(dcv('reconcile', 'pay.migration.json', 'legacy-pay-client.csv', 'zoho-pay-client.csv').code).toBe(2)
    matched.columnMap.source.TDS = 'Tax Deducted'
    file('pay-wrong.migration.json', JSON.stringify(matched))
    const refused = dcv('reconcile', 'pay-wrong.migration.json', 'legacy-pay-client.csv', 'zoho-pay-client.csv')
    expect(refused.code).toBe(2)
    expect(refused.err).toMatch(/the column matching cannot be used\. "TDS" is matched to "Tax Deducted", which this file does not have/)

    // final-spec C7: dcv share writes definitions and counts, never the client.
    matched.name = 'Acme payroll'
    matched.signoff = { signatures: { preparedBy: { name: 'Anil Kapoor' } } }
    matched.spec.mapping.push({ source: 'Staff No', target: 'Employee Number', map: { E001: 'ZP-001' }, mapKind: 'keyMap' })
    file('pay-full.migration.json', JSON.stringify(matched))
    const sharedRun = dcv('share', 'pay-full.migration.json', '--out', 'pay.shared.json')
    expect(sharedRun.code).toBe(0)
    expect(sharedRun.err).toMatch(/Left out:.*is a key map: record identifiers never leave this device/s)
    const sharedText = readFileSync(join(dir, 'pay.shared.json'), 'utf8')
    expect(sharedText).not.toMatch(/Acme|Anil Kapoor|ZP-001/)
    expect(JSON.parse(sharedText).name).toBe('hr-payroll-zoho-payroll / prior-payroll')
    expect(dcv('share', 'legacy-pay.csv').code).toBe(2)

    // A reference name no rule uses is a typo: refused, like any unknown option.
    const typo = dcv('check', 'emp.migration.json', 'emp-load.csv', '--reference', 'location=locations.csv')
    expect(typo.code).toBe(2)
    expect(typo.err).toMatch(/--reference names "location", which no rule in the contract uses; the rules use "locations"/)
  })

  // v3 F7: Excel is read in the browser; the CLI reads CSV. A workbook handed
  // to it is refused as "could not complete", with the fix — never read as text.
  it('refuses an Excel workbook with exit 2 and says what to do', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)])
    writeFileSync(join(dir, 'load.xlsx'), zip)
    for (const run of [dcv('check', object, 'load.xlsx'), dcv('reconcile', object, 'load.xlsx', target)]) {
      expect(run.code).toBe(2)
      expect(`${run.err}${run.out}`).toMatch(/is an Excel workbook.*save the sheet as CSV/)
    }
  })

  // final-spec C8: the commit a record names must be THIS tool's. A copy
  // installed inside someone else's git project has no .git of its own, and
  // must not answer with their repository's commit.
  it('names its own commit: a release stamp, its own checkout — never the repository it happens to sit in', async () => {
    const { commitFor } = await import('./buildInfo.mjs')
    const installed = join(root, 'node_modules', '.dcv-commit-test')
    mkdirSync(join(installed, 'cli'), { recursive: true })
    try {
      expect(commitFor(installed, {})).toBeNull() // inside this checkout, but not it
      writeFileSync(join(installed, 'cli', 'commit.json'), JSON.stringify({ commit: '0123456789abcdef0123456789abcdef01234567' }))
      expect(commitFor(installed, {})).toBe('0123456789ab')
      writeFileSync(join(installed, 'cli', 'commit.json'), JSON.stringify({ commit: '<script>' }))
      expect(commitFor(installed, {})).toBeNull()
      expect(commitFor(installed, { DCV_COMMIT: 'abc1234' })).toBe('abc1234')
    } finally {
      rmSync(installed, { recursive: true, force: true })
    }
  })

  it('reports its version — the same one package.json declares', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(VERSION).toBe(pkg.version)
    expect(dcv('--version').out).toMatch(new RegExp(`^data-contract-validator ${VERSION.replace(/\./g, '\\.')}`))
  })

  it('refuses an option it does not know, with exit 2', () => {
    const r = dcv('reconcile', object, source, target, '--evidnce', 'x.html')
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/Unknown option '--evidnce'/)
  })
})

describe('dcv reconcile --json', () => {
  it('matches the published schema for a failing reconciliation', () => {
    const r = dcv('reconcile', object, source, target, '--json')
    expect(r.code).toBe(1)
    const report = JSON.parse(r.out)
    expect(errors(reconcileSchema, report)).toEqual([])
    expect(report.status).toBe('FAIL')
  })

  it('matches the schema when a file reconciles with itself (PASS) and when the spec cannot run (INVALID)', () => {
    const self = file('self.json', JSON.stringify({ key: 'PERNR', mapping: [{ source: 'NACHN' }] }))
    const pass = dcv('reconcile', self, source, source, '--json')
    expect(pass.code).toBe(0)
    expect(errors(reconcileSchema, JSON.parse(pass.out))).toEqual([])
    const bad = file('bad.json', JSON.stringify({ key: 'nope' }))
    const invalid = dcv('reconcile', bad, source, target, '--json')
    expect(invalid.code).toBe(2)
    expect(errors(reconcileSchema, JSON.parse(invalid.out))).toEqual([])
  })

  it('is caught by the schema when a field disappears', () => {
    const report = JSON.parse(dcv('reconcile', object, source, target, '--json').out)
    delete report.counts.rowsUnverified
    expect(errors(reconcileSchema, report)).not.toEqual([])
  })
})

describe('dcv check --json', () => {
  it.each([
    ['NOT_READY', load, 1],
    ['READY', clean, 0],
  ])('matches the published schema: %s', (status, csv, code) => {
    const r = dcv('check', object, csv, '--json')
    expect(r.code).toBe(code)
    const report = JSON.parse(r.out)
    expect(errors(readinessSchema, report)).toEqual([])
    expect(report.status).toBe(status)
  })

  it('matches the schema when a rule cannot be checked (UNVERIFIED) and when the key is wrong (INVALID)', () => {
    const contract = file('c.json', JSON.stringify({ rules: [{ kind: 'valueSet', column: 'no_such', op: 'in', target: ['x'], severity: 'warn' }] }))
    const unverified = dcv('check', contract, load, '--json')
    expect(unverified.code).toBe(2)
    expect(JSON.parse(unverified.out).status).toBe('UNVERIFIED')
    expect(errors(readinessSchema, JSON.parse(unverified.out))).toEqual([])
    const invalid = dcv('check', object, load, '--key', 'nope', '--json')
    expect(invalid.code).toBe(2)
    expect(errors(readinessSchema, JSON.parse(invalid.out))).toEqual([])
  })
})

describe('--junit', () => {
  it('writes one test case per step, failing the steps that failed, and quoting no record', () => {
    const out = join(dir, 'recon.xml')
    dcv('reconcile', object, source, target, '--junit', out)
    const xml = readFileSync(out, 'utf8')
    expect(xml).toMatch(/<testsuite name="reconcile: Employees" tests="5" failures="3" skipped="0"/)
    expect((xml.match(/<failure /g) ?? []).length).toBe(3)
    expect(xml).not.toMatch(/40117|40133/) // record keys stay out of CI logs
    expect(xml).toMatch(/<property name="version" value="2\.0\.0"\/>/)
  })

  it('fails rejecting rules and only reports warning-only ones', () => {
    const out = join(dir, 'ready.xml')
    dcv('check', object, load, '--junit', out)
    const xml = readFileSync(out, 'utf8')
    expect(xml).toMatch(/failures="1"/) // last_name blank: rejects
    expect(xml).toMatch(/<skipped message="1 of 46 records would load with a warning"\/>/)
  })
})

describe('dcv odcs', () => {
  it('exports a migration object’s contract and imports it back, rule for rule', () => {
    const yaml = join(dir, 'c.odcs.yaml')
    expect(dcv('odcs', 'export', object, '--out', yaml).code).toBe(0)
    const back = dcv('odcs', 'import', yaml)
    expect(back.code).toBe(0)
    const imported = JSON.parse(back.out)
    expect(imported.rules).toHaveLength(migrationSampleObject().contract.rules.length)
  })

  it('exits 2 and names what it left out when an ODCS file asks for more than it can check', () => {
    const r = dcv('odcs', 'import', join(root, 'src/lib/__fixtures__/odcs/column-validity.odcs.yaml'))
    expect(r.code).toBe(2)
    // v3: its uniqueness check now imports as a rule; the tolerance still cannot.
    expect(r.err).toMatch(/NOT imported — 1 item\(s\)/)
  })
})
