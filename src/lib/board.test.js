import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { buildBoard } from './board.js'
import { runnableSpec, summariseReadiness, summariseReconciliation } from './migrationObject.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

const readiness = (status, at, { wave = 'Wave 1', cycle = 'Mock 3', records = 100, rejected = 0 } = {}) => ({
  kind: 'readiness', at, wave, cycle, status, files: { load: 'load.csv' },
  counts: { records, rejected, warned: 0, clean: records - rejected, checksFailing: rejected ? 1 : 0, checksUnchecked: 0 },
  acceptance: (records - rejected) / records,
})
const steps = (failAt) => {
  const ids = ['keys', 'completeness', 'mapping', 'accuracy', 'totals']
  const i = failAt ? ids.indexOf(failAt) : ids.length
  return Object.fromEntries(ids.map((id, j) => [id, j < i ? 'PASS' : 'FAIL']))
}
const reconciled = (status, at, { wave = 'Wave 1', cycle = 'Mock 3', failAt = null, completeness = 1 } = {}) => ({
  kind: 'reconcile', at, wave, cycle, status, files: { source: 's.csv', target: 't.csv' },
  steps: steps(failAt), counts: {}, completeness, accuracy: 1,
})
const object = (name, runs, cycle = 'Mock 3') => ({ name, wave: 'Wave 1', cycle, runs })
const submission = (objectName, state, { submittedAt = '2026-10-20T10:00:00Z', generatedAt = submittedAt, cycle = 'Mock 3' } = {}) => ({
  objectName, wave: 'Wave 1', cycle, reference: 'EV-AAAA-0000-0001', submittedAt, state, decisions: state === 'awaiting' ? [] : [{}],
  subject: { generatedAt },
})

describe('readiness board — checks only', () => {
  it('both checks passed in the current cycle: ready, and it says sign-off was not part of it', () => {
    const board = buildBoard([object('Employees', [readiness('READY', '2026-10-20T09:00:00Z'), reconciled('PASS', '2026-10-20T09:30:00Z')])])
    expect(board.verdict).toBe('GO')
    expect(board.withSignoff).toBe(false)
    expect(board.headline).toBe('All 1 object passed both checks in their current cycle. Sign-off is not part of this board, so this is not yet a go.')
  })

  it('a check that did not run in this cycle is not confirmed — an earlier cycle’s pass does not count', () => {
    const runs = [readiness('READY', '2026-10-01T09:00:00Z', { cycle: 'Mock 2' }), reconciled('PASS', '2026-10-20T09:30:00Z')]
    const [row] = buildBoard([object('Employees', runs)]).rows
    expect(row.verdict).toBe('NOT_CONFIRMED')
    expect(row.reasons).toEqual(['load readiness was not checked in this cycle'])
  })

  it('a failed step is a no-go, named, and listed before anything merely unconfirmed', () => {
    const board = buildBoard([
      object('Cost centres', [readiness('UNVERIFIED', '2026-10-20T09:00:00Z'), reconciled('PASS', '2026-10-20T09:30:00Z')]),
      object('Employees', [readiness('NOT_READY', '2026-10-20T09:00:00Z', { rejected: 2 }), reconciled('FAIL', '2026-10-20T09:30:00Z', { failAt: 'mapping' })]),
      object('Assets', [readiness('READY', '2026-10-20T09:00:00Z'), reconciled('PASS', '2026-10-20T09:30:00Z')]),
    ])
    expect(board.verdict).toBe('NO_GO')
    expect(board.rows.map((r) => [r.name, r.verdict])).toEqual([['Employees', 'NO_GO'], ['Cost centres', 'NOT_CONFIRMED'], ['Assets', 'GO']])
    expect(board.rows[0].reasons).toEqual(['2 of 100 records would be rejected', 'reconciliation stopped at Mapping'])
    expect(board.rows[1].reasons).toEqual(['load readiness could not confirm every rule'])
    expect(board.counts).toEqual({ GO: 1, NO_GO: 1, NOT_CONFIRMED: 1 })
    expect(board.headline).toBe('No-go: 1 of 3 objects failed, and 1 could not be confirmed.')
  })

  it('uses the latest run in the cycle, and compares it with the previous cycle', () => {
    const runs = [
      reconciled('FAIL', '2026-10-01T09:00:00Z', { cycle: 'Mock 2', failAt: 'completeness', completeness: 0.9 }),
      reconciled('FAIL', '2026-10-20T08:00:00Z', { failAt: 'completeness', completeness: 0.95 }),
      reconciled('PASS', '2026-10-20T09:30:00Z', { completeness: 1 }),
      readiness('READY', '2026-10-20T09:00:00Z'),
    ]
    const [row] = buildBoard([object('Employees', runs)]).rows
    expect(row.reconciliation).toMatchObject({ status: 'PASS', completeness: 1, previousCycle: 'Wave 1 Mock 2' })
    expect(row.reconciliation.change).toBeCloseTo(0.1)
  })

  it('reads the summaries a real migration object stores', () => {
    const o = migrationSampleObject()
    const src = parseCsv(migrationSource())
    const tgt = parseCsv(migrationTarget())
    const load = parseCsv(migrationLoadFile())
    const where = { wave: o.wave, cycle: o.cycle }
    o.runs = [
      summariseReadiness(checkReadiness(o.contract, load.rows, { columns: load.columns, key: ['employee_id'] }), { ...where, at: '2026-10-20T09:00:00Z' }),
      summariseReconciliation(reconcile(runnableSpec(o), src.rows, tgt.rows, { sourceColumns: src.columns, targetColumns: tgt.columns }), { ...where, at: '2026-10-20T09:30:00Z' }),
    ]
    const [row] = buildBoard([o]).rows
    expect(row.verdict).toBe('NO_GO')
    expect(row.reasons).toEqual(['2 of 46 records would be rejected', 'reconciliation stopped at Mapping'])
  })

  it('an empty board is not a go', () => {
    expect(buildBoard([])).toMatchObject({ verdict: 'NOT_CONFIRMED', headline: 'No migration objects on the board.' })
  })
})

describe('readiness board — with sign-off', () => {
  const passing = () => object('Employees', [readiness('READY', '2026-10-20T09:00:00Z'), reconciled('PASS', '2026-10-20T09:30:00Z')])

  it('go only when the cycle was accepted after its checks', () => {
    const board = buildBoard([passing()], { submissions: [submission('Employees', 'accepted')] })
    expect(board.verdict).toBe('GO')
    expect(board.headline).toBe('Go: all 1 object passed both checks in their current cycle and were signed off after them.')
  })

  it('awaiting, missing, rejected, or older than the latest check', () => {
    const verdict = (submissions) => buildBoard([passing()], { submissions }).rows[0]
    expect(verdict([])).toMatchObject({ verdict: 'NOT_CONFIRMED', reasons: ['nothing was submitted for sign-off in this cycle'] })
    expect(verdict([submission('Employees', 'awaiting')]).reasons).toEqual(['sign-off EV-AAAA-0000-0001 is awaiting a decision'])
    expect(verdict([submission('Employees', 'rejected')]).verdict).toBe('NO_GO')
    expect(verdict([submission('Employees', 'accepted', { submittedAt: '2026-10-20T09:10:00Z' })]).reasons).toEqual(['a check ran after sign-off EV-AAAA-0000-0001'])
    expect(verdict([submission('Employees', 'accepted', { cycle: 'Mock 2' })]).reasons).toEqual(['nothing was submitted for sign-off in this cycle'])
    expect(verdict([submission('Payroll', 'accepted')]).verdict).toBe('NOT_CONFIRMED')
  })

  it('accepting with exceptions is a go that says so', () => {
    const [row] = buildBoard([passing()], { submissions: [submission('Employees', 'accepted-with-exceptions')] }).rows
    expect(row.verdict).toBe('GO')
    expect(row.signoff.withExceptions).toBe(true)
  })
})
