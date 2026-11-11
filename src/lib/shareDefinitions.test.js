import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget, MIGRATION_SAMPLE } from '../samples/migrationSample.js'
import { evidenceFingerprints } from './evidencePack.js'
import {
  cleanSpec, migrationObjectToJson, parseMigrationObjectFile, readCrosswalk, runnableContract, runnableSpec, summariseReadiness, summariseReconciliation,
} from './migrationObject.js'
import { objectFromPack } from './packs.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'
import { CROSSWALK_KINDS, SHARE_CROSSWALK_LIMIT, shareDefinitions } from './shareDefinitions.js'
import { reconciliationStamp } from './stamp.js'
import FINANCE from '../packs/finance-tally-zoho-books.js'

// Safe sharing for pilots (final-spec C7): the one file a pilot may send us.

describe('a crosswalk says what it is', () => {
  it('there are two kinds, and the kind is saved with the crosswalk it describes', () => {
    expect(CROSSWALK_KINDS.map((k) => k.id)).toEqual(['codeList', 'keyMap'])
    const spec = cleanSpec({
      key: { source: ['a'], target: ['a'] },
      mapping: [
        { source: 'grade', target: 'grade', map: { G7: 'Lead' }, mapKind: 'codeList' },
        { source: 'old_id', target: 'new_id', map: { 1001: 'E-1' }, mapKind: 'keyMap' },
        { source: 'x', target: 'x', map: { a: 'b' }, mapKind: 'something else' },
        { source: 'y', target: 'y', mapKind: 'codeList' }, // no crosswalk: nothing to describe
      ],
      totals: [{ source: 'amt', target: 'amt', groupBy: { source: 'co', target: 'co', map: { 1000: 'US01' }, mapKind: 'codeList' } }],
    })
    expect(spec.mapping.map((f) => f.mapKind)).toEqual(['codeList', 'keyMap', undefined, undefined])
    expect(spec.totals[0].groupBy.mapKind).toBe('codeList')
  })

  it('declaring a kind changes no check: not the spec the engine runs, its fingerprint or its stamp', async () => {
    const object = migrationSampleObject()
    const declared = { ...object, spec: { ...object.spec, mapping: object.spec.mapping.map((f) => (f.map ? { ...f, mapKind: 'codeList' } : f)) } }
    expect(declared.spec.mapping.some((f) => f.mapKind)).toBe(true)
    expect(runnableSpec(declared)).toEqual(runnableSpec(object))
    expect((await evidenceFingerprints(declared)).spec.sha256).toBe((await evidenceFingerprints(object)).spec.sha256)
    const files = { source: { sha256: 'a' }, target: { sha256: 'b' } }
    expect(reconciliationStamp(declared, files)).toBe(reconciliationStamp(object, files))
    // …and it survives saving and reopening.
    expect(parseMigrationObjectFile(migrationObjectToJson(declared)).object.spec.mapping.filter((f) => f.mapKind === 'codeList').length).toBeGreaterThan(0)
  })

  it('a pack’s crosswalks are standard codes, and say so', () => {
    const object = objectFromPack(FINANCE, 'chart-of-accounts')
    expect(object.spec.mapping.filter((f) => f.map).map((f) => f.mapKind)).toEqual(['codeList'])
    expect(objectFromPack(FINANCE, 'customers-and-vendors').spec.totals[0].groupBy.mapKind).toBe('codeList')
  })

  it('a data file offered as a crosswalk is refused, not read by its first two columns', () => {
    const load = parseCsv(migrationLoadFile())
    const read = readCrosswalk(load)
    expect(read.map).toBeNull()
    expect(read.issues[0]).toMatch(/has \d+ columns.*A crosswalk has exactly two/)
    expect(readCrosswalk(parseCsv('legacy,new\nG7,Lead\n')).map).toEqual({ G7: 'Lead' })
  })
})

describe('share definitions — nothing but definitions and counts leaves', () => {
  // A real object after a real cycle: reports summarised into runs, a sign-off
  // record typed in, a key map built from real record keys, a declared code
  // list, an undeclared crosswalk, and a code list too large to send.
  const sample = migrationSampleObject()
  const spec = runnableSpec(sample)
  const load = parseCsv(migrationLoadFile())
  const source = parseCsv(migrationSource())
  const target = parseCsv(migrationTarget())
  const readiness = checkReadiness(runnableContract(sample), load.rows, { columns: load.columns, key: spec.key.target })
  const recon = reconcile(spec, source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns })

  const keyColumn = spec.key.source[0]
  const keyMap = Object.fromEntries(source.rows.slice(0, 20).map((row) => [row[keyColumn], `NEW-${row[keyColumn]}`]))
  const surname = source.columns.find((c) => /NACHN/i.test(c))
  const undeclared = Object.fromEntries(source.rows.slice(0, 5).map((row) => [row[surname], row[surname].toUpperCase()]))
  const huge = Object.fromEntries(Array.from({ length: SHARE_CROSSWALK_LIMIT + 1 }, (_, i) => [`CODE-${i}`, `TARGET-${i}`]))
  const object = {
    ...sample,
    name: 'Acme Retail Pvt Ltd — employees',
    wave: 'Wave 1 (Acme Pune)',
    contract: { ...sample.contract, name: 'Acme employees target' },
    spec: {
      ...sample.spec,
      mapping: [
        ...sample.spec.mapping.map((f) => (f.map ? { ...f, mapKind: 'codeList' } : f)),
        { source: keyColumn, target: spec.key.target[0], map: keyMap, mapKind: 'keyMap' },
        { source: surname, target: 'last_name', map: undeclared },
        { source: 'TRFGR', target: 'grade', map: huge, mapKind: 'codeList' },
      ],
      // The company-code crosswalk on the control total is standard codes too.
      totals: sample.spec.totals.map((t) => (t.groupBy?.map ? { ...t, groupBy: { ...t.groupBy, mapKind: 'codeList' } } : t)),
    },
    columnMap: { source: { [keyColumn]: 'Staff Number' } },
    owners: { mapping: 'Priya Raman (Acme HR)' },
    signoff: {
      identity: { entity: 'Acme Retail Pvt Ltd', financialYear: '2026-27' },
      custody: { load: { exportedBy: 'Vikram Shah', exportedAt: '2026-11-01' } },
      exceptions: { 'reconcile|accuracy|field-mismatch|annual_salary': { disposition: 'accepted', reason: 'Agreed with Meera Iyer on call' } },
      scope: 'Acme Pune entity only',
      signatures: { preparedBy: { name: 'Anil Kapoor', date: '2026-11-02' } },
    },
    runs: [
      summariseReadiness(readiness, { wave: 'Wave 1 (Acme Pune)', cycle: 'Mock 2', fileName: MIGRATION_SAMPLE.loadName }),
      summariseReconciliation(recon, { wave: 'Wave 1 (Acme Pune)', cycle: 'Mock 2', sourceName: MIGRATION_SAMPLE.sourceName, targetName: MIGRATION_SAMPLE.targetName }),
    ],
  }

  // Everything that must not leave: every cell of every file that is not also
  // an authored definition, file names, and everything typed about the client.
  const authored = JSON.stringify([sample.contract, sample.spec])
  const cells = new Set()
  for (const { rows } of [load, source, target]) for (const row of rows) for (const value of Object.values(row)) if (String(value).length > 3 && !authored.includes(String(value))) cells.add(String(value))
  const typed = ['Acme', 'Priya Raman', 'Vikram Shah', 'Meera Iyer', 'Anil Kapoor', 'Pune', MIGRATION_SAMPLE.loadName, MIGRATION_SAMPLE.sourceName, MIGRATION_SAMPLE.targetName, 'NEW-', 'CODE-7', 'TARGET-7']
  const leaks = (text) => [...[...cells].filter((v) => text.includes(v)), ...typed.filter((v) => text.includes(v))]

  const shared = shareDefinitions(object, { at: '2026-11-11T10:00:00Z' })

  it('the object file itself really holds what must not be shared (negative control)', () => {
    const full = migrationObjectToJson(object)
    expect(leaks(full)).toEqual(expect.arrayContaining(['Acme', 'Vikram Shah', MIGRATION_SAMPLE.loadName, 'NEW-', 'CODE-7']))
    expect([...cells].some((v) => full.includes(v))).toBe(true) // the key map's keys, the undeclared crosswalk's surnames
  })

  it('the shared file holds none of it', () => {
    expect(leaks(shared.json)).toEqual([])
  })

  it('it keeps what a pack needs to learn: rules, mapping, formats, tags, column matching, counts and verdicts', () => {
    const file = JSON.parse(shared.json)
    expect(file.contract.rules).toEqual(JSON.parse(migrationObjectToJson(object)).contract.rules)
    expect(file.spec.mapping.map((f) => [f.source, f.target])).toEqual(JSON.parse(migrationObjectToJson(object)).spec.mapping.map((f) => [f.source, f.target]))
    expect(file.columnMap).toEqual({ source: { [keyColumn]: 'Staff Number' } })
    expect(file.runs.map((r) => [r.kind, r.status, r.cycle])).toEqual([['readiness', 'NOT_READY', 'Mock 2'], ['reconcile', 'FAIL', 'Mock 2']])
    expect(file.runs[0].counts).toEqual(object.runs[0].counts)
    expect(file.runs.every((r) => r.wave === null && Object.values(r.files).every((name) => name === null))).toBe(true)
    expect(file.signoff).toBeUndefined()
    expect(file.owners).toBeUndefined()
  })

  it('keeps a declared code list, and drops a key map, an undeclared crosswalk and one too large — saying each', () => {
    const file = JSON.parse(shared.json)
    const maps = file.spec.mapping.filter((f) => f.map)
    expect(maps).toHaveLength(sample.spec.mapping.filter((f) => f.map).length)
    expect(maps.every((f) => f.mapKind === 'codeList')).toBe(true)
    expect(shared.dropped).toEqual([
      `The crosswalk on "${keyColumn}" → "${spec.key.target[0]}" (20 entries) is a key map: record identifiers never leave this device.`,
      `The crosswalk on "${surname}" → "last_name" (5 entries) was not declared a code list, so it is treated as record values.`,
      `The crosswalk on "TRFGR" → "grade" (${SHARE_CROSSWALK_LIMIT + 1} entries) is over the ${SHARE_CROSSWALK_LIMIT}-entry limit for sharing.`,
      'The sign-off record, the owners’ names, the object’s name, its wave and every file name.',
    ])
    expect(file.shared).toEqual({ at: '2026-11-11T10:00:00Z', dropped: shared.dropped })
  })

  it('opens in the workspace and the CLI like any object file', () => {
    const opened = parseMigrationObjectFile(shared.json)
    expect(opened.error).toBeNull()
    expect(opened.object.name).toBe('Shared definitions')
    expect(opened.object.contract.rules).toHaveLength(sample.contract.rules.length)
  })

  it('an object built from a pack is named for the pack object, never for the client', () => {
    const fromPack = { ...objectFromPack(FINANCE, 'opening-trial-balance'), name: 'Acme opening TB' }
    const out = JSON.parse(shareDefinitions(fromPack).json)
    expect(out.name).toBe('finance-tally-zoho-books / opening-trial-balance')
    expect(out.pack).toMatchObject({ id: 'finance-tally-zoho-books', object: 'opening-trial-balance' })
  })
})
