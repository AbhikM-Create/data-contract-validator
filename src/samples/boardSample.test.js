import { describe, expect, it } from 'vitest'
import { buildBoard } from '../lib/board.js'
import { runnableSpec, summariseReadiness, summariseReconciliation } from '../lib/migrationObject.js'
import { parseCsv } from '../lib/parseCsv.js'
import { checkReadiness } from '../lib/readiness.js'
import { reconcile } from '../lib/reconcile.js'
import { boardSampleObjects } from './boardSample.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from './migrationSample.js'

describe('the example programme', () => {
  it('Employees carries exactly the runs the engine produces on the example files', () => {
    const o = migrationSampleObject()
    const [s, t, l] = [migrationSource(), migrationTarget(), migrationLoadFile()].map(parseCsv)
    const [employees] = boardSampleObjects()
    const strip = ({ at: _at, files: _files, ...run }) => run
    const where = { wave: o.wave, cycle: o.cycle }
    expect(strip(employees.runs[0])).toEqual(strip(summariseReadiness(checkReadiness(o.contract, l.rows, { columns: l.columns, key: ['employee_id'] }), where)))
    expect(strip(employees.runs[1])).toEqual(strip(summariseReconciliation(reconcile(runnableSpec(o), s.rows, t.rows, { sourceColumns: s.columns, targetColumns: t.columns }), where)))
  })

  it('shows one object of each verdict, failures first', () => {
    const board = buildBoard(boardSampleObjects())
    expect(board.rows.map((r) => [r.name, r.verdict])).toEqual([['Employees', 'NO_GO'], ['Positions', 'NOT_CONFIRMED'], ['Cost centres', 'GO']])
    expect(board.rows[2].reconciliation.previousCycle).toBe('Wave 1 Mock 1')
    expect(board.rows[2].reconciliation.change).toBeCloseTo(138 / 1840)
  })
})
