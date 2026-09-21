// Each sample exists to demonstrate one specific verdict. If a sample ever
// stops demonstrating it — because a threshold default moved, or because the
// generator drifted — the demo quietly starts teaching the wrong thing, so the
// promised verdict is pinned here.

import { describe, expect, it } from 'vitest'
import { inferContract } from '../lib/contract.js'
import { parseCsv } from '../lib/parseCsv.js'
import { validate } from '../lib/validate.js'
import { SAMPLE_PAIRS } from './samples.js'

const pair = (id) => SAMPLE_PAIRS.find((sample) => sample.id === id)

function run(id) {
  const sample = pair(id)
  const baseline = parseCsv(sample.baseline())
  const candidate = parseCsv(sample.candidate())
  expect(baseline.errors).toEqual([])
  expect(candidate.errors).toEqual([])
  const result = validate(inferContract(baseline.rows), candidate.rows)
  return {
    ...Object.fromEntries(result.layers.map((layer) => [layer.id, layer.status])),
    status: result.status,
    result,
  }
}

const layers = ({ schema, semantics, freshness, distribution }) => ({ schema, semantics, freshness, distribution })

describe('sample pairs', () => {
  it('clean: every layer passes', () => {
    const outcome = run('clean')
    expect(layers(outcome)).toEqual({ schema: 'PASS', semantics: 'PASS', freshness: 'PASS', distribution: 'PASS' })
    expect(outcome.status).toBe('PASS')
  })

  it('unknown grade: semantics catches it, and schema does not', () => {
    const outcome = run('valueset')
    expect(layers(outcome)).toEqual({ schema: 'PASS', semantics: 'FAIL', freshness: 'PASS', distribution: 'PASS' })
    expect(outcome.result.headline.layerLabel).toBe('Semantics')
    const violation = outcome.result.violations.find((v) => v.column === 'grade')
    expect(violation.code).toBe('new-category')
    expect(violation.message).toContain('Consumer')
  })

  it('feed stopped: freshness catches it, and the checks above pass', () => {
    const outcome = run('freshness')
    expect(layers(outcome)).toEqual({ schema: 'PASS', semantics: 'PASS', freshness: 'FAIL', distribution: 'PASS' })
    expect(outcome.result.headline.layerLabel).toBe('Freshness')
    expect(outcome.result.violations.map((v) => v.code)).toContain('stale')
  })

  it('salaries 83x: only the bottom layer objects, and it names the salary column', () => {
    const outcome = run('distribution')
    expect(layers(outcome)).toEqual({ schema: 'PASS', semantics: 'PASS', freshness: 'PASS', distribution: 'FAIL' })
    expect(outcome.result.headline.layerLabel).toBe('Distribution')
    expect(outcome.result.violations.every((v) => v.column === 'annual_salary_usd')).toBe(true)
    expect(outcome.result.violations.map((v) => v.code)).toContain('central-shift')
  })

  it('columns changed: caught at the first gate', () => {
    const outcome = run('schema')
    expect(outcome.schema).toBe('FAIL')
    expect(outcome.result.headline.layerLabel).toBe('Schema')
    const byCode = outcome.result.violations.filter((v) => v.layer === 'schema').map((v) => `${v.code}:${v.column}`)
    expect(byCode).toEqual(expect.arrayContaining([
      'missing-column:manager_email',
      'missing-column:annual_salary_usd',
      'type-change:employment_status',
      'extra-column:salary',
      'extra-column:cost_centre',
    ]))
  })
})

// The shipped demo data must stay invented. A real employee record reaching
// this file would be shipped to everyone who opens the app.
describe('sample data is synthetic', () => {
  const everyCsv = SAMPLE_PAIRS.flatMap((sample) => [sample.baseline(), sample.candidate()]).join('\n')

  it('uses only the reserved .example domain for addresses', () => {
    const domains = [...everyCsv.matchAll(/@([\w.-]+)/g)].map((m) => m[1])
    expect(domains.length).toBeGreaterThan(0)
    expect([...new Set(domains)]).toEqual(['meridian.example'])
  })

  it('carries no trace of the real data this was developed against', () => {
    for (const forbidden of ['tresvista', 'hrdl', 'EMP0', 'srijit', 'minali', 'arnab']) {
      expect(everyCsv.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
