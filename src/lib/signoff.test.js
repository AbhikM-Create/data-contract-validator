import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { createEvidencePack } from './evidencePack.js'
import { sha256Hex } from './hashing.js'
import { runnableSpec } from './migrationObject.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'
import { exceptionChoices, readDecision, readSubject, subjectMatches } from './signoff.js'

const texts = { load: migrationLoadFile(), source: migrationSource(), target: migrationTarget() }
const parsed = Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, parseCsv(t)]))
const info = async (name, text, rows) => ({ name, rows, bytes: new TextEncoder().encode(text).length, sha256: await sha256Hex(text) })

async function packFor(object, { target = texts.target } = {}) {
  const targetRows = parseCsv(target)
  const { flagged: _flagged, ...readiness } = checkReadiness(object.contract, parsed.load.rows, { columns: parsed.load.columns, key: ['employee_id'] })
  const recon = reconcile(runnableSpec(object), parsed.source.rows, targetRows.rows, { sourceColumns: parsed.source.columns, targetColumns: targetRows.columns, exampleLimit: 1000 })
  const pack = await createEvidencePack({
    object,
    readiness: { report: readiness, file: await info('load.csv', texts.load, parsed.load.rows.length) },
    reconciliation: { report: recon, source: await info('legacy.csv', texts.source, parsed.source.rows.length), target: await info('target.csv', target, targetRows.rows.length) },
    generatedAt: '2026-10-28T12:00:00.000Z',
    generatedBy: 'the workspace',
  })
  return { ...pack, recon, readiness }
}

describe('sign-off subject — what a decision is recorded against', () => {
  it('names the pack, the definitions, every file by its bytes, and each check’s counts', async () => {
    const { subject, reference } = await packFor(migrationSampleObject())
    expect(subject.reference).toBe(reference)
    expect(subject.object).toEqual({ name: 'Employees', wave: 'Wave 1', cycle: 'Mock 2' })
    expect(subject.files.map((f) => f.role)).toEqual(['load', 'source', 'target'])
    expect(subject.files[1].sha256).toBe(await sha256Hex(texts.source))
    expect(subject.definitions.contract).toMatch(/^[0-9a-f]{64}$/)
    expect(subject.checks.map((c) => [c.kind, c.status])).toEqual([['readiness', 'NOT_READY'], ['reconcile', 'FAIL']])
    expect(subject.checks[1].steps).toMatchObject({ keys: 'PASS', completeness: 'PASS', mapping: 'FAIL' })
  })

  it('holds no record value from either file — it is stored, the pack is not', async () => {
    const { subject, recon, readiness, html } = await packFor(migrationSampleObject())
    const stored = JSON.stringify(subject)
    const quoted = new Set()
    for (const finding of recon.findings) {
      for (const example of finding.examples) {
        for (const value of [example.key, example.value, example.source, example.target, example.expected]) {
          if (typeof value === 'string' && value.length > 2) quoted.add(value)
        }
      }
    }
    for (const check of readiness.checks) for (const example of check.examples) quoted.add(example.record)
    for (const total of recon.totals) for (const group of total.groups) quoted.add(group.group)
    for (const rows of [parsed.source.rows, parsed.load.rows]) {
      for (const row of rows) for (const value of Object.values(row)) if (String(value).length > 4) quoted.add(String(value))
    }
    // Negative control: the pack, which is never stored, does quote them.
    expect([...quoted].filter((v) => html.includes(v)).length).toBeGreaterThan(10)
    expect([...quoted].filter((v) => stored.includes(v))).toEqual([])
  })

  it('a hand-made subject cannot smuggle a value in', async () => {
    const { subject } = await packFor(migrationSampleObject())
    const tampered = JSON.parse(JSON.stringify(subject))
    tampered.files[0].examples = ['40117']
    tampered.checks[1].counts.note = 'Okafor'
    tampered.object.secret = 'Haddad'
    tampered.definitions.contract = 'not a hash'
    expect(readSubject(tampered)).toBeNull()
    tampered.definitions.contract = subject.definitions.contract
    expect(JSON.stringify(readSubject(tampered))).not.toMatch(/40117|Okafor|Haddad/)
    expect(readSubject(tampered)).toEqual(subject)
  })

  it('a decision applies only to the same bytes under the same definitions', async () => {
    const object = migrationSampleObject()
    const { subject } = await packFor(object)
    expect(subjectMatches(subject, (await packFor(object)).subject)).toEqual({ matches: true, changed: [] })

    const edited = texts.target.replace('\n', '\n').replace(/\n$/, '\n\n')
    const otherFile = (await packFor(object, { target: edited })).subject
    expect(subjectMatches(subject, otherFile)).toEqual({ matches: false, changed: ['the target extract'] })

    const stricter = migrationSampleObject()
    stricter.contract.rules = stricter.contract.rules.slice(1)
    expect(subjectMatches(subject, (await packFor(stricter)).subject).changed).toEqual(['the target rules'])
  })
})

describe('a decision', () => {
  it('offers as exceptions only what failed', async () => {
    const { subject } = await packFor(migrationSampleObject())
    expect(exceptionChoices(subject).map((c) => c.id)).toEqual([
      'readiness', 'reconcile:mapping', 'reconcile:accuracy', 'reconcile:totals',
    ])
  })

  it('accepting with exceptions needs each one named, justified and owned', async () => {
    const { subject } = await packFor(migrationSampleObject())
    expect(readDecision({ decision: 'accept-with-exceptions', exceptions: [] }, subject).issues)
      .toEqual(['Accepting with exceptions needs at least one exception.'])
    const half = readDecision({ decision: 'accept-with-exceptions', exceptions: [{ finding: 'reconcile:keys', reason: '' }] }, subject)
    expect(half.decision).toBeNull()
    expect(half.issues).toEqual([
      'Exception 1: choose which finding it accepts.',
      'Exception 1: say why it is acceptable.',
      'Exception 1: name who owns the fix.',
    ])
    const ok = readDecision({
      decision: 'accept-with-exceptions',
      exceptions: [{ finding: 'reconcile:mapping', reason: 'G4 retired before cutover', owner: 'HR functional lead', fixBy: '2026-11-15', extra: 'x' }],
    }, subject)
    expect(ok.issues).toEqual([])
    expect(ok.decision).toEqual({
      decision: 'accept-with-exceptions',
      exceptions: [{ finding: 'reconcile:mapping', reason: 'G4 retired before cutover', owner: 'HR functional lead', fixBy: '2026-11-15' }],
      comment: null,
    })
  })

  it('a rejection says why; nothing else is a decision', async () => {
    const { subject } = await packFor(migrationSampleObject())
    expect(readDecision({ decision: 'reject' }, subject).issues).toEqual(['Say why the cycle is rejected.'])
    expect(readDecision({ decision: 'approve' }, subject).issues).toEqual(['Choose accept, accept with exceptions, or reject.'])
    expect(readDecision({ decision: 'accept' }, subject).decision).toEqual({ decision: 'accept', exceptions: [], comment: null })
  })
})
