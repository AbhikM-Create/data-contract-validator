// A ready-made programme for the readiness board: three migration objects in
// the same cycle, one of each verdict. Demo data — the engine never imports it.
//
// Employees is the workspace's example migration, and its two runs are exactly
// what the engine reports on the example files (boardSample.test.js pins that).
// The other two objects carry invented run summaries: counts and rates only —
// a run summary holds no record, so there are no people in them to invent.

import { migrationSampleObject } from './migrationSample.js'

const AT = (day, time) => `2026-10-${String(day).padStart(2, '0')}T${time}:00.000Z`
const ALL_PASS = { keys: 'PASS', completeness: 'PASS', mapping: 'PASS', accuracy: 'PASS', totals: 'PASS' }

const readiness = (cycle, at, records, rejected, warned = 0) => ({
  kind: 'readiness', at, wave: 'Wave 1', cycle, status: rejected ? 'NOT_READY' : 'READY',
  files: { load: `load_${cycle.toLowerCase().replace(' ', '')}.csv` },
  counts: { records, rejected, warned, clean: records - rejected - warned, checksFailing: rejected ? 1 : 0, checksUnchecked: 0 },
  acceptance: (records - rejected) / records,
})

const reconciliation = (cycle, at, expected, matched, steps = ALL_PASS) => ({
  kind: 'reconcile', at, wave: 'Wave 1', cycle, status: Object.values(steps).includes('FAIL') ? 'FAIL' : 'PASS',
  files: { source: 'legacy_extract.csv', target: 'target_extract.csv' },
  steps,
  counts: { sourceRows: expected, targetRows: matched, outOfScope: 0, expected, matched, missing: expected - matched, extra: 0, duplicateKeys: 0, blankKeys: 0, withDifferences: 0, unverified: 0, unmappedRecords: 0, totalsBroken: 0 },
  completeness: matched / expected,
  accuracy: 1,
})

export function boardSampleObjects() {
  const employees = {
    ...migrationSampleObject(),
    runs: [
      {
        kind: 'readiness', at: AT(14, '09:12'), wave: 'Wave 1', cycle: 'Mock 2', files: { load: 'load_file_mock3.csv' }, status: 'NOT_READY',
        counts: { records: 46, rejected: 2, warned: 1, clean: 43, checksFailing: 2, checksUnchecked: 0 }, acceptance: 44 / 46,
      },
      {
        kind: 'reconcile', at: AT(14, '10:40'), wave: 'Wave 1', cycle: 'Mock 2', files: { source: 'legacy_hr_extract.csv', target: 'target_after_mock2.csv' }, status: 'FAIL',
        steps: { keys: 'PASS', completeness: 'PASS', mapping: 'FAIL', accuracy: 'FAIL', totals: 'FAIL' },
        counts: { sourceRows: 48, targetRows: 46, outOfScope: 2, expected: 46, matched: 46, missing: 0, extra: 0, duplicateKeys: 0, blankKeys: 0, withDifferences: 2, unverified: 3, unmappedRecords: 3, totalsBroken: 2 },
        completeness: 1, accuracy: 41 / 46,
      },
    ],
  }
  const costCentres = {
    ...migrationSampleObject(),
    name: 'Cost centres',
    runs: [
      reconciliation('Mock 1', AT(2, '14:05'), 1840, 1702, { keys: 'PASS', completeness: 'FAIL', mapping: 'PASS', accuracy: 'PASS', totals: 'FAIL' }),
      readiness('Mock 2', AT(13, '16:20'), 1840, 0),
      reconciliation('Mock 2', AT(14, '08:55'), 1840, 1840),
    ],
  }
  const positions = {
    ...migrationSampleObject(),
    name: 'Positions',
    runs: [readiness('Mock 2', AT(14, '11:30'), 3215, 0, 12)],
  }
  return [employees, costCentres, positions]
}
