import { describe, expect, it } from 'vitest'
import { runnableSpec } from '../lib/migrationObject.js'
import { parseCsv } from '../lib/parseCsv.js'
import { checkReadiness } from '../lib/readiness.js'
import { reconcile } from '../lib/reconcile.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from './migrationSample.js'

// The example exists to demonstrate one story. If a threshold or a rule change
// stops it demonstrating that story, the example has become a lie — so it is
// pinned here, step by step.

const object = migrationSampleObject()
const source = parseCsv(migrationSource())
const target = parseCsv(migrationTarget())
const load = parseCsv(migrationLoadFile())

describe('the example migration', () => {
  it('parses cleanly', () => {
    for (const file of [source, target, load]) expect(file.errors).toEqual([])
  })

  const report = reconcile(runnableSpec(object), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns })

  it('passes Keys and Completeness, and stops at Mapping', () => {
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ['keys', 'PASS'], ['completeness', 'PASS'], ['mapping', 'FAIL'], ['accuracy', 'FAIL'], ['totals', 'FAIL'],
    ])
    expect(report.headline).toBe('Stopped at Mapping. 46 of 46 in-scope records matched one to one. Keys and Completeness passed above it.')
  })

  it('does not count the G4 records as verified: their grade was never compared', () => {
    expect(report.counts).toMatchObject({ matched: 46, rowsWithDifference: 2, rowsUnverified: 3, rowsFullyMatched: 41 })
  })

  it('counts the two withdrawn employees as out of scope', () => {
    expect(report.counts.sourceOutOfScope).toBe(2)
  })

  it('names G4 as the mapping gap, on three records', () => {
    const gap = report.findings.find((f) => f.code === 'unmapped-value')
    expect(gap.examples).toEqual([{ value: 'G4', detail: '3 records', count: 3 }])
  })

  it('finds the two salaries that lost their decimal point, and nothing else wrong', () => {
    const wrong = report.findings.filter((f) => f.code === 'field-mismatch')
    expect(wrong).toHaveLength(1)
    expect(wrong[0].column).toBe('annual_salary')
    expect(wrong[0].examples.map((e) => e.key)).toEqual(['40117', '40133'])
  })

  it('predicts two rejections and one warning for the next load file', () => {
    const ready = checkReadiness(object.contract, load.rows, { columns: load.columns, key: ['employee_id'] })
    expect(ready.status).toBe('NOT_READY')
    expect(ready.counts).toEqual({ records: 46, rejected: 2, warned: 1, clean: 43 })
  })
})
