import { describe, expect, it } from 'vitest'
import { DRAFT_KEY, draftToJson, loadDraft, readDraft, saveDraft } from './autosave.js'
import { newMigrationObject, runnableSpec, summariseReadiness, summariseReconciliation } from './migrationObject.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'
import { DEFAULT_THRESHOLDS } from './validate.js'

// Distinctive invented values, so "is this string in the stored draft?" cannot
// be answered yes by accident.
const SOURCE = Array.from({ length: 30 }, (_, i) => ({
  PERNR: `EMPX-${8000 + i}`, NACHN: `Wrzbonik${i}`, TRFGR: i === 4 ? 'GRADEQQ' : 'G7', ANSAL: String(81234 + i), BUKRS: 'BUKXQ1',
}))
const TARGET = SOURCE.filter((_, i) => i !== 9).map((row, i) => ({
  employee_id: row.PERNR, last_name: row.NACHN.toUpperCase(), grade: 'Senior Analyst', annual_salary: i === 2 ? '99999992' : row.ANSAL, company_code: 'CCXQ01',
}))
TARGET.push({ employee_id: 'EMPX-PHANTOM', last_name: 'Phantomq', grade: 'Lead', annual_salary: '2', company_code: 'CCXQ01' })

const OBJECT = {
  ...newMigrationObject('Employees'),
  wave: 'Wave 2',
  cycle: 'Mock 3',
  contract: { name: 'Employees (target)', rules: [{ kind: 'valueSet', column: 'grade', op: 'in', target: ['Senior Analyst'] }] },
  spec: {
    key: { source: ['PERNR'], target: ['employee_id'] },
    mapping: [{ source: 'NACHN', target: 'last_name', ignoreCase: true }, { source: 'TRFGR', target: 'grade', map: { G7: 'Senior Analyst' } }],
    totals: [{ source: 'ANSAL', target: 'annual_salary', groupBy: { source: 'BUKRS', target: 'company_code', map: { BUKXQ1: 'CCXQ01' } } }],
  },
  runs: [],
}
const RULES = [{ kind: 'nullRule', column: 'last_name', op: 'notNull' }]

const fakeStorage = () => {
  const map = new Map()
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }
}

describe('autosave — round trip', () => {
  it('restores the object, the rules open on Contracts, their name and the thresholds', () => {
    const storage = fakeStorage()
    const thresholds = { ...DEFAULT_THRESHOLDS, centralShiftFactor: 5 }
    expect(saveDraft(storage, { migration: OBJECT, migrationDirty: true, contractName: 'Employees (target)', rules: RULES, thresholds }, new Date('2026-11-03T09:15:00Z'))).toBeNull()
    const back = loadDraft(storage)
    expect(back.migration.name).toBe('Employees')
    expect(back.migration.cycle).toBe('Mock 3')
    expect(back.migration.spec.mapping).toEqual(OBJECT.spec.mapping)
    expect(back.migration.contract.rules).toEqual(OBJECT.contract.rules)
    expect(back.migrationDirty).toBe(true)
    expect(back.contractName).toBe('Employees (target)')
    expect(back.rules).toEqual(RULES)
    expect(back.thresholds.centralShiftFactor).toBe(5)
    expect(back.savedAt).toBe('2026-11-03T09:15:00.000Z')
  })

  it('an empty contract name stays empty (not "Untitled contract")', () => {
    const storage = fakeStorage()
    saveDraft(storage, { migration: OBJECT, contractName: '', rules: RULES })
    expect(loadDraft(storage).contractName).toBe('')
  })

  it('nothing worth keeping removes the draft instead of storing an empty one', () => {
    const storage = fakeStorage()
    saveDraft(storage, { migration: OBJECT, rules: RULES })
    expect(storage.map.has(DRAFT_KEY)).toBe(true)
    saveDraft(storage, { migration: newMigrationObject(''), rules: [] })
    expect(storage.map.has(DRAFT_KEY)).toBe(false)
  })

  it('anything that is not a draft of this version is ignored, never half-read', () => {
    expect(readDraft('not json')).toBeNull()
    expect(readDraft('{"kind":"data-contract-validator/draft","version":2}')).toBeNull()
    expect(readDraft(JSON.stringify({ kind: 'data-contract-validator/draft', version: 1, migration: { kind: 'other' } }))).toBeNull()
  })

  it('a full or refusing storage is reported in a sentence, not thrown', () => {
    const full = { setItem: () => { const e = new Error('exceeded'); e.name = 'QuotaExceededError'; throw e }, removeItem: () => {} }
    expect(saveDraft(full, { migration: OBJECT, rules: RULES })).toMatch(/too large/)
    const blocked = { setItem: () => { throw new Error('SecurityError') }, removeItem: () => {} }
    expect(saveDraft(blocked, { migration: OBJECT, rules: RULES })).toMatch(/would not let/)
    expect(loadDraft({ getItem: () => { throw new Error('SecurityError') } })).toBeNull()
  })
})

describe('autosave — the data boundary', () => {
  const recon = reconcile(runnableSpec(OBJECT), SOURCE, TARGET, { exampleLimit: 1000 })
  const ready = checkReadiness(OBJECT.contract, TARGET, { key: ['employee_id'] })

  it('the checks really found things, so there were values to leak', () => {
    expect(recon.status).toBe('FAIL')
    expect(ready.status).toBe('NOT_READY')
  })

  it('a stored draft holds no record value from any file or report — only what the person authored', () => {
    const migration = {
      ...OBJECT,
      runs: [
        summariseReconciliation(recon, { wave: 'Wave 2', cycle: 'Mock 3', sourceName: 'legacy.csv', targetName: 'target.csv' }),
        summariseReadiness(ready, { wave: 'Wave 2', cycle: 'Mock 3', fileName: 'load.csv' }),
      ],
    }
    // A careless caller hands over more than definitions: report objects, rows.
    const careless = { ...migration, report: recon, rows: SOURCE, examples: ready.checks }
    const stored = draftToJson({ migration: careless, contractName: 'Employees (target)', rules: RULES, thresholds: DEFAULT_THRESHOLDS })

    const values = new Set()
    for (const row of [...SOURCE, ...TARGET]) for (const v of Object.values(row)) if (String(v).length > 4) values.add(String(v))
    for (const finding of recon.findings) for (const e of finding.examples) for (const v of [e.key, e.value, e.source, e.target]) if (typeof v === 'string' && v.length > 3) values.add(v)
    for (const check of ready.checks) for (const e of check.examples) values.add(e.record)
    const authored = new Set(['Senior Analyst', 'BUKXQ1', 'CCXQ01'])
    const leaked = [...values].filter((v) => !authored.has(v) && stored.includes(v))
    expect(values.size).toBeGreaterThan(50)
    expect(leaked).toEqual([])
  })
})
