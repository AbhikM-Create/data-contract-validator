import { describe, expect, it } from 'vitest'
import { contractsInRuns, summariseRuns } from './runSummary.js'
import { LAYERS } from './validate.js'

const ORDER = LAYERS.map((layer) => layer.id)

const run = (status, failing = [], extra = {}) => ({
  status,
  layers: Object.fromEntries(ORDER.map((id) => [id, { status: failing.includes(id) ? 'FAIL' : 'PASS', violations: failing.includes(id) ? 1 : 0 }])),
  ...extra,
})

describe('summariseRuns', () => {
  it('counts passes and failures', () => {
    const s = summariseRuns([run('PASS'), run('FAIL', ['schema']), run('FAIL', ['distribution'])], ORDER)
    expect(s.total).toBe(3)
    expect(s.passed).toBe(1)
    expect(s.failed).toBe(2)
  })

  it('counts INSUFFICIENT separately from a failure', () => {
    const s = summariseRuns([run('INSUFFICIENT'), run('PASS')], ORDER)
    expect(s.insufficient).toBe(1)
    expect(s.failed).toBe(0)
  })

  // A file that breaks schema and distribution is remembered by schema, the
  // step it stopped on. Otherwise one bad file votes in several columns.
  it('remembers a run by the first layer that failed', () => {
    const s = summariseRuns([run('FAIL', ['schema', 'distribution'])], ORDER)
    expect(s.failingLayerCounts).toEqual({ schema: 1 })
  })

  it('names the layer that stops files most often', () => {
    const s = summariseRuns([
      run('FAIL', ['distribution']),
      run('FAIL', ['distribution']),
      run('FAIL', ['schema']),
      run('PASS'),
    ], ORDER)
    expect(s.mostCommonFailingLayer).toBe('distribution')
    expect(s.tiedFailingLayers).toEqual([])
  })

  it('reports a tie rather than picking a winner', () => {
    const s = summariseRuns([run('FAIL', ['schema']), run('FAIL', ['freshness'])], ORDER)
    expect(s.mostCommonFailingLayer).toBeNull()
    expect(s.tiedFailingLayers.sort()).toEqual(['freshness', 'schema'])
  })

  it('has no most-common layer when nothing has failed', () => {
    const s = summariseRuns([run('PASS'), run('PASS')], ORDER)
    expect(s.mostCommonFailingLayer).toBeNull()
    expect(s.failingLayerCounts).toEqual({})
  })

  it('survives an empty or missing list', () => {
    expect(summariseRuns([], ORDER).total).toBe(0)
    expect(summariseRuns(null, ORDER).total).toBe(0)
  })
})

describe('contractsInRuns', () => {
  it('groups by contract, most used first', () => {
    const groups = contractsInRuns([
      run('PASS', [], { contract_id: 'a', contract_name: 'Orders' }),
      run('FAIL', ['schema'], { contract_id: 'a', contract_name: 'Orders' }),
      run('PASS', [], { contract_id: 'b', contract_name: 'People' }),
    ])
    expect(groups.map((g) => [g.name, g.count])).toEqual([['Orders', 2], ['People', 1]])
  })

  it('gathers runs made without a saved contract', () => {
    const groups = contractsInRuns([run('PASS'), run('PASS')])
    expect(groups).toEqual([{ key: '__none__', name: 'No saved contract', count: 2 }])
  })
})
