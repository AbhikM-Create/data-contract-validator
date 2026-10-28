// The large-file path must report exactly what the in-memory engine reports.
// Every finding type is planted, each more than five times so the "first five
// examples in the file" survive being joined partition by partition, and both
// paths are compared field for field.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseCsv } from '../../src/lib/parseCsv.js'
import { checkReadiness } from '../../src/lib/readiness.js'
import { reconcile } from '../../src/lib/reconcile.js'
import { readCsvHeader, streamCsv } from './csvStream.mjs'
import { decodeFields, encodeFields } from './partitions.mjs'
import { checkReadinessFile } from './readinessFile.mjs'
import { reconcileFiles } from './reconcileFiles.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dcv-test-'))
const scratchParent = join(dir, 'scratch')
mkdirSync(scratchParent)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const write = (name, lines) => {
  const path = join(dir, name)
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

// --- a reconciliation with every break planted -------------------------------
const N = 3000
const GRADES = { G5: 'Associate', G6: 'Analyst', G7: 'Senior Analyst', G8: 'Lead', G9: 'VP' }
const legacy = ['PERNR,NACHN,TRFGR,ANSAL,BUKRS,STAT2']
const target = ['employee_id,last_name,grade,annual_salary,company_code']
for (let i = 0; i < N; i += 1) {
  const id = String(10000 + i)
  const grade = `G${5 + (i % 5)}`
  const salary = 40000 + ((i * 37) % 90000)
  const bukrs = i % 3 ? '1000' : '2000'
  const status = i % 41 === 0 ? '0' : '3'
  const name = i % 500 === 1 ? `"Name${i}\t\\ Jr\nII"` : `Name${i}`
  legacy.push(`${i % 211 === 9 ? '' : id},${name},${i % 97 === 5 ? 'G4' : grade},"${salary.toLocaleString('en-US')}.00",${bukrs},${status}`)
  if (i % 400 === 17) legacy.push(`${id},Dup${i},${grade},1.00,${bukrs},3`) // duplicate source key
  if (status !== '3' || i % 89 === 11) continue // out of scope, or missing from target
  const loaded = i % 113 === 7 ? salary * 10 : salary // wrong in flight
  target.push(`${i % 307 === 3 ? '' : id},${name.toUpperCase()},${GRADES[grade]},${loaded},${bukrs === '1000' ? 'US01' : 'DE01'}`)
  if (i % 350 === 23) target.push(target.at(-1)) // fanned-out duplicate
}
for (let i = 0; i < 8; i += 1) target.push(`9${i}000,Ghost,VP,1,US01`) // nobody sent these

const SPEC = {
  name: 'Employees — streaming parity',
  key: { source: 'PERNR', target: 'employee_id' },
  scope: { source: { column: 'STAT2', op: '=', target: '3' } },
  mapping: [
    { source: 'NACHN', target: 'last_name', ignoreCase: true },
    { source: 'TRFGR', target: 'grade', map: GRADES },
    { source: 'ANSAL', target: 'annual_salary', tolerance: 0.01 },
  ],
  totals: [{ source: 'ANSAL', target: 'annual_salary', groupBy: { source: 'BUKRS', target: 'company_code', map: { 1000: 'US01', 2000: 'DE01' } } }],
}

const sourcePath = write('legacy.csv', legacy)
const targetPath = write('target.csv', target)

describe('streamed reconciliation matches the in-memory engine', () => {
  const source = parseCsv(readFileSync(sourcePath, 'utf8'))
  const tgt = parseCsv(readFileSync(targetPath, 'utf8'))
  const inMemory = reconcile(SPEC, source.rows, tgt.rows, { sourceColumns: source.columns, targetColumns: tgt.columns })

  it('carries cells holding tabs, newlines and backslashes through unchanged', () => {
    const awkward = source.rows.filter((row) => row.NACHN.includes('\n'))
    expect(awkward.length).toBeGreaterThan(3)
    expect(awkward[0].NACHN).toBe('Name1\t\\ Jr\nII')
    expect(inMemory.fields[0].mismatched).toBe(0) // last_name matches on every one
  })

  it('the planted data really does break every step', () => {
    expect(inMemory.steps.map((s) => s.status)).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL'])
    const codes = inMemory.findings.map((f) => f.code)
    for (const code of ['blank-key-source', 'blank-key-target', 'duplicate-key-source', 'duplicate-key-target',
      'missing-in-target', 'extra-in-target', 'unmapped-value', 'field-mismatch', 'total-mismatch']) {
      expect(codes).toContain(code)
    }
    // More than five of each, so example ORDER is under test, not just presence.
    expect(inMemory.counts.missing).toBeGreaterThan(5)
    expect(inMemory.counts.extra).toBeGreaterThan(5)
  })

  for (const partitions of [1, 7, 64]) {
    it(`gives the identical report across ${partitions} partition(s)`, async () => {
      const outcome = await reconcileFiles(SPEC, sourcePath, targetPath, { partitions, tmpDir: scratchParent })
      expect(outcome.error).toBeUndefined()
      expect(outcome.partitions).toBe(partitions)
      expect(outcome.report).toEqual(inMemory)
    })
  }

  it('leaves nothing on disk once the run ends', async () => {
    await reconcileFiles(SPEC, sourcePath, targetPath, { partitions: 7, tmpDir: scratchParent })
    expect(readdirSync(scratchParent)).toEqual([])
  })

  it('refuses a spec naming a missing column before streaming anything', async () => {
    const outcome = await reconcileFiles({ ...SPEC, key: { source: 'PERNR', target: 'emp_no' } }, sourcePath, targetPath)
    expect(outcome.report.status).toBe('INVALID')
    expect(outcome.report.issues).toEqual(['The target file has no column "emp_no" (named as a key).'])
  })
})

// --- readiness with every break planted --------------------------------------
const load = ['employee_id,last_name,grade,status,term_date,annual_salary']
for (let i = 0; i < N; i += 1) {
  const terminated = i % 10 === 0
  const row = [
    i % 250 === 4 ? '' : String(10000 + i),
    i % 133 === 2 ? '' : `Name${i}`,
    i % 71 === 1 ? 'G7' : 'Analyst',
    terminated ? 'Terminated' : 'Active',
    terminated && i % 70 !== 0 ? '2024-05-31' : '',
    i % 157 === 6 ? '9900000' : '55000',
  ]
  load.push(row.join(','))
  if (i % 300 === 8) load.push(row.join(',')) // duplicate key
}
const CONTRACT = {
  name: 'Employees (target)',
  rules: [
    { kind: 'nullRule', column: 'last_name', op: 'notNull' },
    { kind: 'valueSet', column: 'grade', op: 'in', target: ['Associate', 'Analyst', 'Senior Analyst', 'Lead', 'VP'] },
    { kind: 'nullRule', column: 'term_date', op: 'notNull', when: { column: 'status', op: '=', target: 'Terminated' } },
    { kind: 'range', column: 'annual_salary', op: 'between', target: [20000, 400000], severity: 'warn' },
  ],
  skipped: [],
}
const loadPath = write('load.csv', load)

describe('streamed load readiness matches the in-memory engine', () => {
  const parsed = parseCsv(readFileSync(loadPath, 'utf8'))
  const inMemory = checkReadiness(CONTRACT, parsed.rows, { columns: parsed.columns, key: ['employee_id'] })

  it('the planted load really does break every check', () => {
    expect(inMemory.checks.every((c) => c.status === 'FAIL')).toBe(true)
    expect(inMemory.checks.every((c) => c.failing > 5)).toBe(true)
  })

  for (const partitions of [1, 7]) {
    it(`gives the identical report, and the identical fix list, across ${partitions} partition(s)`, async () => {
      const rejectsPath = join(dir, `rejects-${partitions}.csv`)
      const outcome = await checkReadinessFile(CONTRACT, loadPath, { key: ['employee_id'], partitions, rejectsPath, tmpDir: scratchParent })
      expect(outcome.error).toBeUndefined()
      const { flagged, ...expected } = inMemory
      expect(outcome.report).toEqual({ ...expected, flagged: [] })

      // The fix list holds exactly the flagged records, in order, with reasons.
      const fixes = parseCsv(readFileSync(rejectsPath, 'utf8'))
      expect(outcome.rejectsWritten).toBe(flagged.length)
      expect(fixes.rows.map((r) => [Number(r._row), r._readiness, r._reasons])).toEqual(
        flagged.map((f) => [f.row, f.severity === 'reject' ? 'REJECT' : 'WARN', f.reasons.join('; ')]),
      )
      expect(readdirSync(scratchParent)).toEqual([])
    })
  }

  it('without a key, makes one pass and still matches', async () => {
    const outcome = await checkReadinessFile(CONTRACT, loadPath, {})
    const { flagged: _f, ...expected } = checkReadiness(CONTRACT, parsed.rows, { columns: parsed.columns })
    expect(outcome.report).toEqual({ ...expected, flagged: [] })
    expect(outcome.partitions).toBe(0)
  })
})

// --- the streamed reader reads files exactly as parseCsv does ----------------
describe('streamCsv reads by parseCsv rules', () => {
  const read = async (name, text) => {
    const path = join(dir, name)
    writeFileSync(path, text)
    const rows = []
    const result = await streamCsv(path, (row, rowNo) => rows.push([rowNo, row]))
    return { result, rows, header: readCsvHeader(path), expected: parseCsv(text) }
  }

  it('trims headers and values, strips a BOM, skips empty rows, numbers like parseCsv', async () => {
    const { result, rows, header, expected } = await read('ok.csv', '﻿id, amount \n1, 5 \n\n,\n2,6\n')
    expect(header.columns).toEqual(expected.columns)
    expect(rows.map(([, row]) => row)).toEqual(expected.rows)
    expect(rows.map(([n]) => n)).toEqual([1, 2])
    expect(result).toEqual({ rows: 2, error: null })
  })

  for (const [name, text] of [
    ['misaligned', 'a,b\n1,2\n3\n'],
    ['repeated header', 'a,b,a\n1,2,3\n'],
    ['header only', 'a,b\n'],
  ]) {
    it(`gives parseCsv's sentence for a ${name} file`, async () => {
      const { result, header, expected } = await read(`${name}.csv`, text)
      expect(header.error ?? result.error).toBe(expected.errors[0])
    })
  }
})

describe('partition records survive the trip to disk', () => {
  it('round-trips tabs, newlines, carriage returns and backslashes', () => {
    const fields = ['plain', 'tab\there', 'new\nline', 'cr\r\nlf', 'back\\slash', '\\t literal', '', 'end\\', 'é—€', '\\\\n']
    const line = encodeFields(fields)
    expect(/[\n\r]/.test(line)).toBe(false)
    expect(line.split('\t')).toHaveLength(fields.length)
    expect(decodeFields(line)).toEqual(fields)
  })
})
