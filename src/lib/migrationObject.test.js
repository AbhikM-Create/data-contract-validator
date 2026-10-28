import { describe, expect, it } from 'vitest'
import {
  cycleHistory,
  migrationObjectToJson,
  newMigrationObject,
  parseMigrationObjectFile,
  readCrosswalk,
  runnableSpec,
  suggestFieldPairs,
  summariseReadiness,
  summariseReconciliation,
} from './migrationObject.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

// Distinctive invented values, so "does this string appear in the saved file?"
// cannot be answered yes by accident.
const SOURCE = Array.from({ length: 30 }, (_, i) => ({
  PERNR: `EMPX-${7000 + i}`,
  NACHN: `Qzvorak${i}`,
  TRFGR: i === 4 ? 'GRADEZZ' : 'G7',
  ANSAL: String(71234 + i),
  BUKRS: 'BUKXQ1',
}))
const TARGET = SOURCE.filter((_, i) => i !== 9).map((row, i) => ({
  employee_id: row.PERNR,
  last_name: row.NACHN.toUpperCase(),
  grade: 'Senior Analyst',
  annual_salary: i === 2 ? '99999991' : row.ANSAL,
  company_code: 'CCXQ01',
}))
TARGET.push({ employee_id: 'EMPX-GHOST', last_name: 'Ghostlyq', grade: 'Lead', annual_salary: '1', company_code: 'CCXQ01' })

const OBJECT = {
  ...newMigrationObject('Employees'),
  wave: 'Wave 2',
  cycle: 'Mock 3',
  contract: { name: 'Employees (target)', rules: [{ kind: 'valueSet', column: 'grade', op: 'in', target: ['Senior Analyst'] }] },
  spec: {
    key: { source: ['PERNR'], target: ['employee_id'] },
    scope: { source: null },
    mapping: [
      { source: 'NACHN', target: 'last_name', ignoreCase: true },
      { source: 'TRFGR', target: 'grade', map: { G7: 'Senior Analyst' } },
      { source: 'ANSAL', target: 'annual_salary' },
    ],
    totals: [{ source: 'ANSAL', target: 'annual_salary', groupBy: { source: 'BUKRS', target: 'company_code', map: { BUKXQ1: 'CCXQ01' } } }],
  },
  runs: [],
}

describe('migration object file', () => {
  it('round-trips everything a person authored', () => {
    const back = parseMigrationObjectFile(migrationObjectToJson(OBJECT))
    expect(back.error).toBeNull()
    expect(back.skipped).toEqual([])
    expect(back.object.name).toBe('Employees')
    expect(back.object.wave).toBe('Wave 2')
    expect(back.object.cycle).toBe('Mock 3')
    expect(back.object.contract.rules).toEqual(OBJECT.contract.rules)
    expect(back.object.spec.mapping).toEqual(OBJECT.spec.mapping)
    expect(back.object.spec.totals).toEqual(OBJECT.spec.totals)
    expect(back.object.spec.key).toEqual({ source: ['PERNR'], target: ['employee_id'], normalize: [] })
  })

  it('runs the same reconciliation after a save and reload', () => {
    const back = parseMigrationObjectFile(migrationObjectToJson(OBJECT)).object
    expect(reconcile(runnableSpec(back), SOURCE, TARGET)).toEqual(reconcile(runnableSpec(OBJECT), SOURCE, TARGET))
  })

  it('reports a rule it cannot read instead of dropping it', () => {
    const json = JSON.parse(migrationObjectToJson(OBJECT))
    json.contract.rules.push({ kind: 'regex', column: 'last_name' })
    const back = parseMigrationObjectFile(JSON.stringify(json))
    expect(back.object.contract.rules).toHaveLength(1)
    expect(back.skipped).toHaveLength(1)
    expect(back.skipped[0].reason).toMatch(/not a known rule kind/)
  })

  it('refuses something that is not a migration object, with a reason', () => {
    expect(parseMigrationObjectFile('{"kind":"data-contract-validator/contract","rules":[]}').error).toMatch(/something else/)
    expect(parseMigrationObjectFile('not json').error).toMatch(/not valid JSON/)
  })
})

describe('run history — the data boundary', () => {
  const recon = reconcile(runnableSpec(OBJECT), SOURCE, TARGET, { exampleLimit: 1000 })
  const ready = checkReadiness(OBJECT.contract, TARGET, { key: ['employee_id'] })

  it('the run really found things, so there were values to leak', () => {
    expect(recon.status).toBe('FAIL')
    expect(recon.counts.missing).toBe(1)
    expect(recon.counts.extra).toBe(1)
    expect(ready.status).toBe('NOT_READY')
  })

  it('a saved object holds no key, value, example or group label from any run', () => {
    const object = {
      ...OBJECT,
      runs: [
        summariseReconciliation(recon, { wave: 'Wave 2', cycle: 'Mock 3', sourceName: 'legacy.csv', targetName: 'target.csv' }),
        summariseReadiness(ready, { wave: 'Wave 2', cycle: 'Mock 3', fileName: 'load.csv' }),
      ],
    }
    const saved = migrationObjectToJson(object)
    // Everything quoted anywhere in either report's findings and examples.
    const quoted = new Set()
    for (const finding of recon.findings) {
      for (const example of finding.examples) {
        for (const value of [example.key, example.value, example.source, example.target, example.expected]) {
          if (typeof value === 'string' && value.length > 3) quoted.add(value)
        }
      }
    }
    for (const check of ready.checks) for (const example of check.examples) quoted.add(example.record)
    for (const total of recon.totals) for (const group of total.groups) quoted.add(group.group)
    for (const row of [...SOURCE, ...TARGET]) for (const value of Object.values(row)) if (value.length > 4) quoted.add(value)
    // Values the author typed into the spec and contract are theirs to save;
    // everything else must be absent.
    const authored = new Set(['Senior Analyst', 'BUKXQ1', 'CCXQ01'])
    const leaked = [...quoted].filter((value) => !authored.has(value) && saved.includes(value))
    expect(quoted.size).toBeGreaterThan(50)
    expect(leaked).toEqual([])
  })

  it('a hand-edited run cannot smuggle a value back in', () => {
    const json = JSON.parse(migrationObjectToJson({ ...OBJECT, runs: [summariseReconciliation(recon, {})] }))
    json.runs[0].examples = [{ key: 'EMPX-7009' }]
    json.runs[0].counts.secret = 'Qzvorak9'
    const resaved = migrationObjectToJson(parseMigrationObjectFile(JSON.stringify(json)).object)
    expect(resaved).not.toMatch(/EMPX-7009|Qzvorak9/)
  })

  it('records the counts a cycle is judged by', () => {
    const run = summariseReconciliation(recon, {})
    expect(run.counts).toMatchObject({ expected: 30, matched: 29, missing: 1, extra: 1, unmappedRecords: 1, totalsBroken: 1 })
    expect(run.completeness).toBeCloseTo(29 / 30)
    expect(run.steps).toEqual({ keys: 'PASS', completeness: 'FAIL', mapping: 'FAIL', accuracy: 'FAIL', totals: 'FAIL' })
  })
})

describe('cycle history', () => {
  it('shows each run against the previous run of the same kind', () => {
    const rows = cycleHistory([
      { kind: 'reconcile', at: '2026-01-01', wave: 'Wave 1', cycle: 'Mock 1', completeness: 0.9 },
      { kind: 'readiness', at: '2026-01-02', wave: 'Wave 1', cycle: 'Mock 1', acceptance: 0.8 },
      { kind: 'reconcile', at: '2026-02-01', wave: 'Wave 1', cycle: 'Mock 2', completeness: 0.99 },
    ])
    expect(rows.map((r) => r.run.cycle)).toEqual(['Mock 2', 'Mock 1', 'Mock 1'])
    expect(rows[0].change).toBeCloseTo(0.09)
    expect(rows[0].previousCycle).toBe('Wave 1 Mock 1')
    expect(rows[1].change).toBeNull() // the first readiness run has nothing to compare with
  })
})

describe('spec builder helpers', () => {
  it('pairs columns only when the names are the same but for case and punctuation', () => {
    expect(suggestFieldPairs(['Hire Date', 'PERNR', 'grade'], ['hire_date', 'employee_id', 'GRADE'])).toEqual([
      { source: 'Hire Date', target: 'hire_date' },
      { source: 'grade', target: 'GRADE' },
    ])
    expect(suggestFieldPairs(['grade'], ['grade'], [{ source: 'grade', target: 'grade' }])).toEqual([])
  })

  it('reads a crosswalk from its first two columns', () => {
    const result = readCrosswalk({ columns: ['legacy', 'new'], rows: [{ legacy: 'G7', new: 'Senior Analyst' }, { legacy: ' G8 ', new: 'Lead' }] })
    expect(result).toEqual({ map: { G7: 'Senior Analyst', G8: 'Lead' }, entries: 2, issues: [] })
  })

  it('refuses a crosswalk that maps one value two ways', () => {
    const result = readCrosswalk({ columns: ['a', 'b'], rows: [{ a: 'G7', b: 'Lead' }, { a: 'G7', b: 'VP' }] })
    expect(result.map).toBeNull()
    expect(result.issues[0]).toBe('"G7" is listed twice, becoming "Lead" and "VP". Keep one.')
  })

  it('needs two columns', () => {
    expect(readCrosswalk({ columns: ['only'], rows: [] }).issues[0]).toMatch(/two columns/)
  })
})

describe('migration object — formats and key options survive a save', () => {
  const declared = {
    ...OBJECT,
    spec: { ...OBJECT.spec, key: { ...OBJECT.spec.key, normalize: ['stripLeadingZeros'] } },
    formats: { load: { decimal: ',' }, source: { encoding: 'windows-1252', decimal: ',', date: 'DD.MM.YYYY' }, target: {} },
  }

  it('round-trips them', () => {
    const back = parseMigrationObjectFile(migrationObjectToJson(declared)).object
    expect(back.formats).toEqual({ load: { decimal: ',' }, source: { encoding: 'windows-1252', decimal: ',', date: 'DD.MM.YYYY' }, target: {} })
    expect(back.spec.key.normalize).toEqual(['stripLeadingZeros'])
  })

  it('hands them to the engine: the spec runs with them, the contract reads the load file with them', async () => {
    const { runnableContract } = await import('./migrationObject.js')
    expect(runnableSpec(declared)).toMatchObject({ key: { normalize: ['stripLeadingZeros'] }, formats: { source: { date: 'DD.MM.YYYY' } } })
    expect(runnableContract(declared).format).toEqual({ decimal: ',' })
  })

  it('refuses a file with a format this version cannot read', () => {
    const json = JSON.parse(migrationObjectToJson(declared))
    json.formats.source.date = 'D.M.YY'
    expect(parseMigrationObjectFile(JSON.stringify(json)).error).toMatch(/the source file format cannot be used: "D\.M\.YY" is not a known date/)
  })
})
