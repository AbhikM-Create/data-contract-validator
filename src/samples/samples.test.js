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
  return Object.fromEntries(result.layers.map((layer) => [layer.id, layer.status]).concat([['status', result.status], ['result', result]]))
}

describe('sample pairs', () => {
  it('clean: every layer passes', () => {
    const { status, schema, semantics, freshness, distribution } = run('clean')
    expect({ schema, semantics, freshness, distribution }).toEqual({
      schema: 'PASS', semantics: 'PASS', freshness: 'PASS', distribution: 'PASS',
    })
    expect(status).toBe('PASS')
  })

  it('distribution break: only the bottom layer objects, and it names revenue_usd', () => {
    const { schema, semantics, freshness, distribution, result } = run('distribution')
    expect({ schema, semantics, freshness, distribution }).toEqual({
      schema: 'PASS', semantics: 'PASS', freshness: 'PASS', distribution: 'FAIL',
    })
    expect(result.headline.layerLabel).toBe('Distribution')
    expect(result.violations.every((v) => v.column === 'revenue_usd')).toBe(true)
    expect(result.violations.map((v) => v.code)).toContain('central-shift')
  })

  it('schema break: caught at the first gate', () => {
    const { schema, result } = run('schema')
    expect(schema).toBe('FAIL')
    expect(result.headline.layerLabel).toBe('Schema')
    const byCode = result.violations.filter((v) => v.layer === 'schema').map((v) => `${v.code}:${v.column}`)
    expect(byCode).toEqual(expect.arrayContaining([
      'missing-column:revenue_usd',
      'missing-column:avg_basket_usd',
      'type-change:order_count',
      'extra-column:revenue',
      'extra-column:currency',
    ]))
  })
})
