// A ready-made migration for the workspace. Demo data — the engine never
// imports this.
//
// EVERY ROW IS INVENTED: fabricated people with fabricated pay. No real record
// is shipped in this app, and none should ever be added.
//
// The story it tells, pinned by migrationSample.test.js:
//
//   Reconciliation (after the load): Keys and Completeness pass — every
//   employee arrived, once. Mapping is where it stops: legacy grade G4 has no
//   entry in the grade crosswalk, so nobody decided what it becomes. Below it,
//   two salaries lost their decimal point in flight, and the company totals no
//   longer tie.
//
//   Load readiness (before the load): two records have no surname, which the
//   target refuses, and one salary is far outside the usual band, which it
//   accepts with a warning.
//
// Unlike the drift samples, nothing here is measured against today's date, so
// the files can be built once rather than regenerated.

import { newMigrationObject } from '../lib/migrationObject.js'

const FIRST = ['Ada', 'Bruno', 'Chen', 'Dilara', 'Emil', 'Farida', 'Goran', 'Hana', 'Ivo', 'Jun', 'Kemal', 'Lena']
const LAST = ['Okafor', 'Salas', 'Wei', 'Kaya', 'Novak', 'Haddad', 'Petrov', 'Sato', 'Ilves', 'Moreau', 'Adeyemi']
const GRADES = { G5: 'Associate', G6: 'Analyst', G7: 'Senior Analyst', G8: 'Lead', G9: 'VP' }
const CODES = ['G5', 'G6', 'G7', 'G8', 'G6', 'G5', 'G7']
const COMPANY = { 1000: 'US01', 2000: 'DE01' }

const COUNT = 48
const WITHDRAWN = new Set([6, 29]) // left before the migration: out of scope
const UNMAPPED = new Set([11, 23, 40]) // legacy grade G4, which the crosswalk does not cover
const DECIMAL_LOST = new Set([17, 33]) // 81,250.50 arrived as 8125050

function person(i) {
  const first = FIRST[i % FIRST.length]
  const last = LAST[(i * 5) % LAST.length]
  const code = UNMAPPED.has(i) ? 'G4' : CODES[i % CODES.length]
  const salary = 52000 + ((i * 7919) % 120000) + (i % 2 ? 0.5 : 0)
  const hired = new Date(Date.UTC(2012, 0, 9) + i * 61 * 86_400_000).toISOString().slice(0, 10)
  return { id: String(40100 + i), first, last, code, salary, hired, company: i % 3 === 0 ? '2000' : '1000' }
}

const people = Array.from({ length: COUNT }, (_, i) => person(i))
const money = (value) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const csv = (header, rows) => `${[header, ...rows].join('\n')}\n`

// The legacy HR extract: SAP-style column names, amounts with separators.
export function migrationSource() {
  return csv(
    'PERNR,VORNA,NACHN,TRFGR,ANSAL,BEGDA,BUKRS,STAT2',
    people.map((p, i) => `${p.id},${p.first},${p.last},${p.code},"${money(p.salary)}",${p.hired},${p.company},${WITHDRAWN.has(i) ? 0 : 3}`),
  )
}

// What the new system holds after the load: new names, grades crosswalked,
// company codes translated — and the planted breaks.
export function migrationTarget() {
  return csv(
    'employee_id,first_name,last_name,grade,annual_salary,hire_date,company_code',
    people
      .filter((_, i) => !WITHDRAWN.has(i))
      .map((p) => {
        const i = Number(p.id) - 40100
        const grade = UNMAPPED.has(i) ? 'Associate' : GRADES[p.code] // the loader's default for an unknown code
        const salary = DECIMAL_LOST.has(i) ? String(Math.round(p.salary * 100)) : p.salary.toFixed(2)
        return `${p.id},${p.first},${p.last.toUpperCase()},${grade},${salary},${p.hired},${COMPANY[p.company]}`
      }),
  )
}

// The transformed load file prepared for the next cycle, before it is loaded.
export function migrationLoadFile() {
  return csv(
    'employee_id,first_name,last_name,grade,annual_salary,hire_date,company_code',
    people
      .filter((_, i) => !WITHDRAWN.has(i))
      .map((p) => {
        const i = Number(p.id) - 40100
        const last = i === 8 || i === 36 ? '' : p.last.toUpperCase()
        const salary = i === 21 ? '1250000.00' : p.salary.toFixed(2)
        return `${p.id},${p.first},${last},${UNMAPPED.has(i) ? 'Associate' : GRADES[p.code]},${salary},${p.hired},${COMPANY[p.company]}`
      }),
  )
}

export function migrationSampleObject() {
  return {
    ...newMigrationObject('Employees'),
    wave: 'Wave 1',
    cycle: 'Mock 2',
    contract: {
      name: 'Employees (target)',
      rules: [
        { kind: 'nullRule', column: 'last_name', op: 'notNull' },
        { kind: 'valueSet', column: 'grade', op: 'in', target: Object.values(GRADES) },
        { kind: 'type', column: 'hire_date', op: '=', target: 'date' },
        { kind: 'valueSet', column: 'company_code', op: 'in', target: Object.values(COMPANY) },
        { kind: 'range', column: 'annual_salary', op: 'between', target: [20000, 400000], severity: 'warn' },
      ],
    },
    spec: {
      key: { source: ['PERNR'], target: ['employee_id'] },
      scope: { source: { column: 'STAT2', op: '=', target: '3' } },
      mapping: [
        { source: 'VORNA', target: 'first_name' },
        { source: 'NACHN', target: 'last_name', ignoreCase: true },
        { source: 'TRFGR', target: 'grade', map: { ...GRADES } },
        { source: 'ANSAL', target: 'annual_salary', tolerance: 0.01 },
        { source: 'BEGDA', target: 'hire_date' },
      ],
      totals: [
        { source: 'ANSAL', target: 'annual_salary', groupBy: { source: 'BUKRS', target: 'company_code', map: { ...COMPANY } } },
      ],
    },
    runs: [],
  }
}

export const MIGRATION_SAMPLE = {
  sourceName: 'legacy_hr_extract.csv',
  targetName: 'target_after_mock2.csv',
  loadName: 'load_file_mock3.csv',
}
