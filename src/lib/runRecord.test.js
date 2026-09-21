import { describe, expect, it } from 'vitest'
import { defineContract, withRules } from './authoredContract.js'
import { inferContract } from './contract.js'
import { leadFailingLayer, summariseRun } from './runRecord.js'
import { LAYERS, validate } from './validate.js'

const ORDER = LAYERS.map((layer) => layer.id)

// A baseline and a candidate that between them produce every kind of finding:
// a new category, a blank column, numbers an order of magnitude out, and a
// broken authored rule — so the leak test below has real values to hunt for.
const baseline = Array.from({ length: 12 }, (_, i) => ({
  day: `2026-01-${String(i + 1).padStart(2, '0')}`,
  grade: ['Analyst', 'VP'][i % 2],
  revenue: String(100 + i),
  email: `person${i}@example.com`,
}))

const candidate = Array.from({ length: 12 }, (_, i) => ({
  day: `2026-02-${String(i + 1).padStart(2, '0')}`,
  grade: i === 3 ? 'Consumer' : ['Analyst', 'VP'][i % 2],
  revenue: String((100 + i) * 83),
  email: i === 5 ? '' : `person${i}@example.com`,
}))

const contract = withRules(inferContract(baseline), [
  { kind: 'valueSet', column: 'grade', op: 'in', target: ['Analyst', 'VP'] },
])

const result = validate(contract, candidate, { now: Date.parse('2026-02-13T00:00:00Z') })
const record = summariseRun({
  result,
  contractId: 'c-1',
  contractName: 'Orders contract',
  baselineName: 'jan.csv',
  candidateName: 'feb.csv',
  baselineRows: 12,
  candidateRows: 12,
})

describe('summariseRun', () => {
  it('captures the verdict and per-layer status', () => {
    expect(record.status).toBe('FAIL')
    expect(Object.keys(record.layers).sort()).toEqual([...ORDER].sort())
    expect(record.layers.semantics.status).toBe('FAIL')
    expect(record.layers.semantics.violations).toBeGreaterThan(0)
  })

  it('counts the authored rules and the broken ones', () => {
    expect(record.rules_total).toBe(1)
    expect(record.rules_broken).toBe(1)
  })

  it('keeps the shape of each finding — layer, source, code, column', () => {
    const rule = record.findings.find((f) => f.source === 'rule')
    expect(rule).toMatchObject({ layer: 'semantics', code: 'rule:valueSet', column: 'grade' })
    expect(record.findings.every((f) => f.source === 'rule' || f.source === 'baseline')).toBe(true)
  })

  // The one that matters. The live report says «row 4: Consumer» and quotes
  // medians and email addresses; none of that may reach the database.
  it('carries no value out of the file being checked', () => {
    const stored = JSON.stringify(record)

    expect(result.violations.length).toBeGreaterThan(2) // the report really does have findings
    for (const leak of ['Consumer', 'person5@example.com', '8300', 'row 4', '83']) {
      expect(stored).not.toContain(leak)
    }
    for (const violation of result.violations) {
      expect(stored).not.toContain(violation.message)
      if (violation.evidence) expect(stored).not.toContain(violation.evidence)
    }
  })

  it('stores only the fields the table expects', () => {
    expect(Object.keys(record).sort()).toEqual([
      'baseline_name', 'baseline_rows', 'candidate_name', 'candidate_rows',
      'contract_id', 'contract_name', 'findings', 'layers',
      'rules_broken', 'rules_total', 'status',
    ])
    for (const finding of record.findings) {
      expect(Object.keys(finding).sort()).toEqual(['code', 'column', 'layer', 'source'])
    }
  })

  it('handles a run with no baseline and no saved contract', () => {
    const rulesOnly = validate(defineContract({ rules: [{ kind: 'nullRule', column: 'email', op: 'notNull' }] }), candidate)
    const bare = summariseRun({ result: rulesOnly, candidateName: 'feb.csv' })
    expect(bare.contract_id).toBeNull()
    expect(bare.contract_name).toBeNull()
    expect(bare.baseline_name).toBeNull()
    expect(bare.status).toBe('FAIL')
  })

  it('returns null when there is no result to summarise', () => {
    expect(summariseRun({ result: null, candidateName: 'x.csv' })).toBeNull()
  })
})

describe('leadFailingLayer', () => {
  it('names the first failing layer in engine order', () => {
    expect(leadFailingLayer(record, ORDER)).toBe('semantics')
  })

  it('is null when nothing failed', () => {
    const clean = summariseRun({ result: validate(contract, baseline, { now: Date.parse('2026-01-13T00:00:00Z') }), candidateName: 'jan.csv' })
    expect(leadFailingLayer(clean, ORDER)).toBeNull()
  })
})
