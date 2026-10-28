// The CLI as a pipeline sees it: the installed command, real files, its exit
// code, its --json against the published schema, its JUnit file.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterAll, describe, expect, it } from 'vitest'
import { migrationObjectToJson } from '../src/lib/migrationObject.js'
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
const boardSchema = schema('board-report.schema.json')
const errors = (validate, doc) => (validate(doc) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`))

describe('dcv', () => {
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

describe('--record and dcv board', () => {
  const copy = (name) => file(name, migrationObjectToJson(migrationSampleObject()))

  it('records each pipeline run in the object, with counts and no record from the files', () => {
    const rec = copy('recorded.migration.json')
    expect(dcv('check', rec, load, '--record').code).toBe(1)
    expect(dcv('reconcile', rec, source, target, '--record').code).toBe(1)
    const saved = readFileSync(rec, 'utf8')
    const runs = JSON.parse(saved).runs
    expect(runs.map((r) => [r.kind, r.status, r.cycle])).toEqual([['readiness', 'NOT_READY', 'Mock 2'], ['reconcile', 'FAIL', 'Mock 2']])
    expect(saved).not.toMatch(/40117|40133|Okafor|OKAFOR/)
  })

  it('the board reads them: a no-go, named, matching the published schema, exit 1', () => {
    const rec = copy('board-nogo.migration.json')
    dcv('check', rec, load, '--record')
    dcv('reconcile', rec, source, target, '--record')
    const r = dcv('board', rec, '--json')
    expect(r.code).toBe(1)
    const report = JSON.parse(r.out)
    expect(errors(boardSchema, report)).toEqual([])
    expect(report.verdict).toBe('NO_GO')
    expect(report.withSignoff).toBe(false)
    expect(report.rows[0].reasons).toEqual(['2 of 46 records would be rejected', 'reconciliation stopped at Mapping'])
    // Negative control: the schema notices a field that disappears.
    delete report.rows[0].reasons
    expect(errors(boardSchema, report)).toEqual(["/rows/0 must have required property 'reasons'"])
  })

  it('an object with no checks in its cycle is not confirmed: exit 2', () => {
    const r = dcv('board', copy('fresh.migration.json'), '--json')
    expect(r.code).toBe(2)
    const report = JSON.parse(r.out)
    expect(errors(boardSchema, report)).toEqual([])
    expect(report.rows[0].reasons).toEqual(['load readiness was not checked in this cycle', 'reconciliation was not run in this cycle'])
  })

  it('passes, exit 0, only when every object passed both checks in its cycle — and says sign-off was not judged', () => {
    const passing = JSON.parse(migrationObjectToJson(migrationSampleObject()))
    passing.name = 'Cost centres'
    passing.runs = [
      { kind: 'readiness', at: '2026-10-20T09:00:00Z', wave: 'Wave 1', cycle: 'Mock 2', status: 'READY', files: { load: 'l.csv' }, counts: { records: 10, rejected: 0, warned: 0, clean: 10, checksFailing: 0, checksUnchecked: 0 }, acceptance: 1 },
      { kind: 'reconcile', at: '2026-10-20T09:30:00Z', wave: 'Wave 1', cycle: 'Mock 2', status: 'PASS', files: { source: 's.csv', target: 't.csv' }, steps: { keys: 'PASS', completeness: 'PASS', mapping: 'PASS', accuracy: 'PASS', totals: 'PASS' }, counts: {}, completeness: 1, accuracy: 1 },
    ]
    const path = file('passing.migration.json', JSON.stringify(passing))
    const r = dcv('board', path)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/Sign-off is not part of this board, so this is not yet a go\./)
    const xml = join(dir, 'board.xml')
    expect(dcv('board', path, copy('fresh2.migration.json'), '--junit', xml).code).toBe(2)
    expect(readFileSync(xml, 'utf8')).toMatch(/tests="2" failures="1"/)
  })

  it('refuses --record where there is nowhere to record, before running anything', () => {
    const plain = file('plain.contract.json', JSON.stringify({ name: 'c', rules: [{ kind: 'nullRule', column: 'employee_id', op: 'notNull' }] }))
    const r = dcv('check', plain, load, '--record')
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/--record needs a migration object/)
  })

  it('refuses a board file that is not a migration object, and the same object twice', () => {
    expect(dcv('board', load).code).toBe(2)
    const twice = dcv('board', object, object)
    expect(twice.code).toBe(2)
    expect(twice.err).toMatch(/Two files describe the object "Employees"/)
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
    expect(r.err).toMatch(/NOT imported — 2 item\(s\)/)
  })
})

describe('dcv template import', () => {
  const cockpit = join(root, 'src/lib/__fixtures__/templates/cockpit-constructed.xml')

  it('writes the template’s rules, and exits 2 naming what it could not import', () => {
    const r = dcv('template', 'import', cockpit)
    expect(r.code).toBe(2)
    expect(JSON.parse(r.out).rules.map((rule) => [rule.kind, rule.column])).toEqual([['nullRule', 'KUNNR'], ['nullRule', 'NAME1'], ['type', 'ERDAT'], ['type', 'UMSAT']])
    expect(r.err).toMatch(/NOT imported — \d+ item\(s\)/)
    expect(r.err).toMatch(/LAND1: importance “Mandatory if address is given”/)
  })

  it('the contract it writes checks a load file', () => {
    const contract = join(dir, 'from-template.contract.json')
    dcv('template', 'import', cockpit, '--out', contract)
    const loadFile = file('customers.csv', 'KUNNR,NAME1,LAND1,ERDAT,UMSAT\n1,Northwind,US,2026-01-15,10\n2,,DE,2026-01-16,20\n')
    const r = dcv('check', contract, loadFile, '--key', 'KUNNR', '--json')
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out).counts).toMatchObject({ records: 2, rejected: 1 })
  })

  it('a CSV field list with nothing left over exits 0; an unknown sheet is refused', () => {
    const fields = file('fields.csv', 'Field name,Required,Type\nemployee_id,Yes,Text\nhire_date,Yes,Date\n')
    expect(dcv('template', 'import', fields).code).toBe(0)
    const r = dcv('template', 'import', cockpit, '--sheet', 'Bank Details')
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/no sheet "Bank Details"\. Sheets with fields: "General Data"/)
  })
})
