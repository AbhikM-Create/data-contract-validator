import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2019 from 'ajv/dist/2019.js'
import { describe, expect, it } from 'vitest'
import { migrationSampleObject } from '../samples/migrationSample.js'
import { exportOdcs, importOdcs, parseOdcs, toOdcsYaml } from './odcs.js'
import { ruleKey, ruleSeverity } from './rules.js'

const here = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(readFileSync(join(here, '../../schemas/vendor/odcs-json-schema-v3.2.0.json'), 'utf8'))
const validate = new Ajv2019({ strict: false, allErrors: true }).compile(schema)
const valid = (doc) => (validate(doc) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`))

// Every rule kind, with and without WHEN, with both severities.
const EVERY_RULE = [
  { kind: 'nullRule', column: 'last_name', op: 'notNull', target: null },
  { kind: 'nullRule', column: 'term_date', op: 'notNull', target: null, when: { column: 'status', op: '=', target: 'Terminated' } },
  { kind: 'nullRule', column: 'middle', op: 'nullable', target: null },
  { kind: 'type', column: 'hire_date', op: '=', target: 'date' },
  { kind: 'type', column: 'salary', op: '=', target: 'numeric', severity: 'warn' },
  { kind: 'type', column: 'note', op: '=', target: 'string' },
  { kind: 'valueSet', column: 'grade', op: 'in', target: ['Associate', 'Analyst', 'VP'] },
  { kind: 'valueSet', column: 'region', op: 'in', target: ['EU', 'US'], severity: 'warn' },
  { kind: 'range', column: 'salary', op: 'between', target: [20000, 400000], severity: 'warn' },
  { kind: 'comparison', column: 'salary', op: '>', target: '0' },
  { kind: 'crossColumn', column: 'term_date', op: '>', target: 'hire_date', targetIsColumn: true },
  { kind: 'valueSet', column: 'grade', op: 'in', target: ['VP'], when: { column: 'salary', op: '>', target: '300000' } },
]
const CONTRACT = { name: 'Employees (target)', rules: EVERY_RULE, format: { encoding: 'windows-1252', decimal: ',', date: 'DD.MM.YYYY' } }
const asSet = (rules) => rules.map((r) => `${ruleKey(r)}|${ruleSeverity(r)}`).sort()

describe('ODCS export', () => {
  it('is validated by a schema check that can fail', () => {
    expect(valid({ kind: 'DataContract' })).not.toEqual([]) // no apiVersion, id or version
    expect(valid({ ...exportOdcs(CONTRACT), status: 42 })).not.toEqual([])
  })

  it('is valid ODCS v3.2.0 against the standard’s own JSON Schema', () => {
    expect(valid(exportOdcs(CONTRACT))).toEqual([])
    const sample = migrationSampleObject()
    expect(valid(exportOdcs({ ...sample.contract, format: { decimal: ',' } }))).toEqual([])
    expect(valid(exportOdcs({ name: 'empty', rules: [] }))).toEqual([])
  })

  it('writes plain ODCS where an exact equivalent exists', () => {
    const props = Object.fromEntries(exportOdcs(CONTRACT).schema[0].properties.map((p) => [p.name, p]))
    expect(props.last_name.required).toBe(true)
    expect(props.hire_date.logicalType).toBe('date')
    expect(props.grade.quality[0]).toMatchObject({ metric: 'invalidValues', arguments: { validValues: ['Associate', 'Analyst', 'VP'] }, mustBe: 0, severity: 'error' })
    expect(props.region.quality[0]).toMatchObject({ metric: 'invalidValues', severity: 'warning' })
  })

  it('keeps what plain ODCS cannot say as an exact custom check for this engine', () => {
    const props = Object.fromEntries(exportOdcs(CONTRACT).schema[0].properties.map((p) => [p.name, p]))
    const custom = props.term_date.quality.filter((q) => q.type === 'custom')
    expect(custom.map((q) => q.implementation.kind)).toEqual(['nullRule', 'crossColumn'])
    expect(custom.every((q) => q.engine === 'data-contract-validator')).toBe(true)
  })

  it('round-trips every rule kind, condition, severity and the file format through YAML', () => {
    const { doc } = parseOdcs(toOdcsYaml(CONTRACT))
    const back = importOdcs(doc)
    expect(back.error).toBeNull()
    expect(back.notImported).toEqual([])
    expect(asSet(back.rules)).toEqual(asSet(EVERY_RULE))
    expect(back.format).toEqual(CONTRACT.format)
    expect(back.name).toBe('Employees (target)')
  })
})

describe('ODCS import — contracts written elsewhere', () => {
  const fixtures = join(here, '__fixtures__/odcs')
  const load = (name) => importOdcs(parseOdcs(readFileSync(join(fixtures, name), 'utf8')).doc)

  it('reads every example from the standard without throwing, and accounts for everything', () => {
    for (const file of readdirSync(fixtures).filter((f) => f.endsWith('.yaml'))) {
      const result = load(file)
      expect(result.error ?? 'ok', file).not.toMatch(/neither YAML/)
      if (!result.error) for (const skipped of result.notImported) expect(skipped.reason, file).toMatch(/\w/)
    }
  })

  it('refuses a tolerance it cannot honour, and says why', () => {
    const result = load('column-validity.odcs.yaml')
    expect(result.rules).toEqual([])
    expect(result.notImported.map((n) => n.reason)).toEqual(expect.arrayContaining([
      expect.stringMatching(/tolerates some failing records/),
      expect.stringMatching(/uniqueness is checked as the record key — run the check with --key air_quality_status/),
    ]))
  })

  it('names another engine’s custom check instead of pretending to run it', () => {
    const result = load('column-custom.odcs.yaml')
    expect(result.notImported.some((n) => /a check for soda, which this tool does not run/.test(n.reason))).toBe(true)
  })

  it('imports what maps exactly: required, types, bounds, zero-tolerance metrics', () => {
    const doc = {
      apiVersion: 'v3.1.0', kind: 'DataContract', id: 'x', version: '1', name: 'Orders',
      schema: [{ name: 'orders', properties: [
        { name: 'order_id', required: true, logicalType: 'integer' },
        { name: 'amount', logicalType: 'number', logicalTypeOptions: { minimum: 0, maximum: 10000 } },
        { name: 'status', quality: [{ metric: 'invalidValues', arguments: { validValues: ['open', 'closed'] }, mustBe: 0, severity: 'warning' }] },
        { name: 'email', quality: [{ metric: 'nullValues', mustBe: 0 }, { metric: 'invalidValues', arguments: { pattern: '^.+@.+$' }, mustBe: 0 }] },
      ] }],
    }
    const result = importOdcs(doc)
    expect(result.rules).toEqual([
      { kind: 'nullRule', column: 'order_id', op: 'notNull', target: null },
      { kind: 'type', column: 'order_id', op: '=', target: 'numeric' },
      { kind: 'type', column: 'amount', op: '=', target: 'numeric' },
      { kind: 'range', column: 'amount', op: 'between', target: [0, 10000] },
      { kind: 'valueSet', column: 'status', op: 'in', target: ['open', 'closed'], severity: 'warn' },
      { kind: 'nullRule', column: 'email', op: 'notNull', target: null },
    ])
    expect(result.notImported.map((n) => n.what)).toEqual(['logicalType: integer', expect.stringMatching(/^quality: invalidValues/)])
  })

  it('asks which object to check when a contract describes several', () => {
    const doc = { apiVersion: 'v3.2.0', kind: 'DataContract', id: 'x', version: '1', schema: [{ name: 'a', properties: [] }, { name: 'b', properties: [] }] }
    expect(importOdcs(doc).error).toMatch(/describes 2 schema objects \("a", "b"\); choose the one to check/)
    expect(importOdcs(doc, { object: 'b' }).error).toBeNull()
  })

  it('refuses what is not ODCS v3', () => {
    expect(importOdcs({ kind: 'DataContract', apiVersion: 'v2.2.2' }).error).toMatch(/this tool reads ODCS v3/)
    expect(importOdcs({ kind: 'Something' }).error).toMatch(/not an ODCS DataContract/)
    expect(parseOdcs(': : :\n  - [').error).toMatch(/neither YAML nor JSON/)
  })
})
