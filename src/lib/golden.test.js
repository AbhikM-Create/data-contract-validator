// A golden master for the engine.
//
// The engine is verified against real files, which makes it something you
// optimise at your peril: a performance change that alters one verdict has
// broken the product while every other test still passes. This pins the FULL
// output — every layer status, every violation code, column, message and
// evidence string, and the inferred profile of every column — across a corpus
// chosen to exercise each type and each check.
//
// If a refactor is behaviour-preserving, this file does not change. If this
// file has to change, the change was not a refactor, and the diff is the thing
// to review.

import { describe, expect, it } from 'vitest'
import { inferContract } from './contract.js'
import { validate } from './validate.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-09-22T12:00:00Z')

const GRADES = ['Analyst', 'Senior Analyst', 'Associate', 'Team Lead', 'VP']
const DEPARTMENTS = ['Engineering', 'Analytics', 'Finance', 'Operations']

// A register with a date, categoricals, a boolean, a numeric, free text, and a
// column that is blank for part of the file.
function rows(count, { endDaysAgo = 0, salaryFactor = 1, gradeFor, blankEndedOn = true } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    record_date: new Date(NOW - (endDaysAgo + (count - i)) * DAY).toISOString().slice(0, 10),
    employee_id: `E-${1000 + i}`,
    employee_name: `Person ${i} of ${count}`,
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    grade: gradeFor ? gradeFor(i) : GRADES[i % GRADES.length],
    annual_salary_usd: String(Math.round((80000 + (i % 40) * 1500) * salaryFactor)),
    ended_on: blankEndedOn && i % 3 !== 0 ? '' : new Date(NOW - i * DAY).toISOString().slice(0, 10),
    is_current: i % 3 === 0 ? 'N' : 'Y',
    notes: i % 5 === 0 ? '' : `free text ${i}`,
  }))
}

const CASES = {
  clean: { baseline: rows(40, { endDaysAgo: 40 }), candidate: rows(40) },
  unknownGrade: {
    baseline: rows(40, { endDaysAgo: 40 }),
    candidate: rows(40, { gradeFor: (i) => (i % 9 === 0 ? 'Consumer' : GRADES[i % GRADES.length]) }),
  },
  salaries83x: { baseline: rows(40, { endDaysAgo: 40 }), candidate: rows(40, { salaryFactor: 83 }) },
  unitShift: { baseline: rows(40, { endDaysAgo: 40 }), candidate: rows(40, { salaryFactor: 100 }) },
  stale: { baseline: rows(40, { endDaysAgo: 40 }), candidate: rows(40, { endDaysAgo: 30 }) },
  rowCountCollapse: { baseline: rows(40, { endDaysAgo: 40 }), candidate: rows(12) },
  thinBaseline: { baseline: rows(5, { endDaysAgo: 40 }), candidate: rows(40) },
  tinyCandidate: { baseline: rows(40, { endDaysAgo: 40 }), candidate: rows(3) },
}

// The parts of a profile that any downstream claim depends on.
const profileShape = (column) => ({
  name: column.name,
  type: column.type,
  nullRate: Number(column.nullRate.toFixed(6)),
  presentCount: column.presentCount,
  min: column.min ?? null,
  max: column.max ?? null,
  mean: column.mean === null || column.mean === undefined ? null : Number(column.mean.toFixed(6)),
  median: column.median ?? null,
  domain: column.domain ?? null,
  oldest: column.oldest ?? null,
  newest: column.newest ?? null,
  cadenceMs: column.cadenceMs ?? null,
  cadenceSpread: column.cadenceSpread === null || column.cadenceSpread === undefined
    ? null
    : Number(column.cadenceSpread.toFixed(6)),
})

function snapshot(name) {
  const { baseline, candidate } = CASES[name]
  const contract = inferContract(baseline)
  const result = validate(contract, candidate, { now: NOW })

  return {
    contract: {
      sufficient: contract.sufficient,
      rowCount: contract.rowCount,
      dateColumn: contract.dateColumn,
      cadenceMs: contract.cadenceMs,
      columns: contract.columns.map(profileShape),
    },
    result: {
      status: result.status,
      headline: result.headline.text,
      detail: result.headline.detail,
      layers: result.layers.map((layer) => ({ id: layer.id, status: layer.status, note: layer.note })),
      violations: result.violations.map((v) => ({
        layer: v.layer, source: v.source, code: v.code, column: v.column,
        message: v.message, evidence: v.evidence,
      })),
    },
  }
}

describe('engine golden master', () => {
  for (const name of Object.keys(CASES)) {
    it(`${name} is unchanged`, () => {
      expect(snapshot(name)).toMatchSnapshot()
    })
  }
})
