import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget, MIGRATION_SAMPLE } from '../samples/migrationSample.js'
import { migrationObjectToJson, parseMigrationObjectFile, runnableContract, runnableSpec, summariseReadiness, summariseReconciliation } from './migrationObject.js'
import { objectRow } from './objectStore.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

// The data boundary of a saved object (user state 4): what reaches the account
// is exactly what reaches the object file — rules, mapping, formats, column
// matching, tags, owners, the sign-off record as typed, and each run's COUNTS.
// Never a record from a file. The row is built by one function; this plants
// every cell of real files and asserts none is in it.

describe('a migration object saved to an account', () => {
  const sample = migrationSampleObject()
  const spec = runnableSpec(sample)
  const load = parseCsv(migrationLoadFile())
  const source = parseCsv(migrationSource())
  const target = parseCsv(migrationTarget())
  const readiness = checkReadiness(runnableContract(sample), load.rows, { columns: load.columns, key: spec.key.target })
  const recon = reconcile(spec, source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns, exampleLimit: 1000 })
  const object = {
    ...sample,
    columnMap: { source: { PERNR: 'Staff Number' } },
    tags: { NACHN: 'personal', ANSAL: 'pay' },
    signoff: { identity: { entity: 'Invented Pvt Ltd' }, signatures: { preparedBy: { name: 'A. Rao', date: '2027-04-02' } } },
    runs: [
      summariseReadiness(readiness, { wave: 'Wave 1', cycle: 'Mock 2', fileName: MIGRATION_SAMPLE.loadName }),
      summariseReconciliation(recon, { wave: 'Wave 1', cycle: 'Mock 2', sourceName: MIGRATION_SAMPLE.sourceName, targetName: MIGRATION_SAMPLE.targetName }),
    ],
  }

  // Every cell that is not also authored text (a value set, a crosswalk entry).
  const authored = JSON.stringify([sample.contract, sample.spec])
  const cells = new Set()
  for (const { rows } of [load, source, target]) for (const row of rows) for (const value of Object.values(row)) if (String(value).length > 3 && !authored.includes(String(value))) cells.add(String(value))
  const leaked = (text) => [...cells].filter((v) => text.includes(v))

  it('the reports really quote cells before they are summarised (negative control)', () => {
    expect(leaked(JSON.stringify([readiness, recon])).length).toBeGreaterThan(2)
  })

  it('the row holds no cell of any file', () => {
    const row = objectRow(object)
    expect(leaked(JSON.stringify(row))).toEqual([])
    expect(row.object.runs).toHaveLength(2)
    expect(row.format_version).toBe(row.object.formatVersion)
  })

  it('the row is the object file: what one holds, the other holds, and it opens the same', () => {
    const row = objectRow(object)
    const { savedAt: _a, ...fromRow } = row.object
    const { savedAt: _b, ...fromFile } = JSON.parse(migrationObjectToJson(object))
    expect(fromRow).toEqual(fromFile)
    const reopened = parseMigrationObjectFile(JSON.stringify(row.object))
    expect(reopened.error).toBeNull()
    expect(reopened.object.columnMap).toEqual({ source: { PERNR: 'Staff Number' } })
    expect(reopened.object.signoff.signatures.preparedBy.name).toBe('A. Rao')
    expect(reopened.object.runs.map((r) => r.kind)).toEqual(['readiness', 'reconcile'])
  })

  it('a value planted in a run does not survive the trip', () => {
    const planted = { ...object, runs: [{ ...object.runs[0], evidence: 'row 21: 1250000.00', counts: { ...object.runs[0].counts, note: 'OKAFOR' } }] }
    const text = JSON.stringify(objectRow(planted))
    expect(text).not.toContain('1250000.00')
    expect(text).not.toContain('OKAFOR')
  })
})
