import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { createEvidencePack, escapeHtml, evidenceFingerprints } from './evidencePack.js'
import { sha256Hex } from './hashing.js'
import { runnableSpec } from './migrationObject.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

const object = migrationSampleObject()
const texts = { load: migrationLoadFile(), source: migrationSource(), target: migrationTarget() }
const parsed = Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, parseCsv(t)]))
const info = async (name, text, rows) => ({ name, rows, bytes: new TextEncoder().encode(text).length, sha256: await sha256Hex(text) })

async function packFor(o, { withReadiness = true, withRecon = true, source = parsed.source, target = parsed.target } = {}) {
  const readiness = withReadiness
    ? (() => { const { flagged, ...report } = checkReadiness(o.contract, parsed.load.rows, { columns: parsed.load.columns, key: ['employee_id'] }); return { report, flaggedCount: flagged.length } })()
    : null
  const recon = withRecon ? reconcile(runnableSpec(o), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns, exampleLimit: 1000 }) : null
  return createEvidencePack({
    object: o,
    readiness: readiness && { ...readiness, file: await info('load.csv', texts.load, parsed.load.rows.length) },
    reconciliation: recon && { report: recon, source: await info('legacy.csv', texts.source, source.rows.length), target: await info('target.csv', texts.target, target.rows.length) },
    generatedAt: '2026-10-28T12:00:00.000Z',
    generatedBy: 'the workspace',
    reproduce: 'dcv reconcile employees.migration.json legacy.csv target.csv',
  })
}

describe('evidence pack — what it attests to', () => {
  // v3 F7 / F6: a workbook is named with the sheet and header row it was read
  // from, and a declared Indian grouping is said in words.
  it('names the workbook sheet that was read and the declared digit grouping', async () => {
    const { html } = await createEvidencePack({
      object: { ...object, formats: { ...object.formats, load: { grouping: 'indian' } } },
      readiness: {
        report: checkReadiness(object.contract, parsed.load.rows, { columns: parsed.load.columns }),
        flaggedCount: 0,
        file: { ...(await info('load.xlsx', texts.load, parsed.load.rows.length)), sheet: 'Employees', headerRow: 2 },
      },
      generatedAt: '2026-10-28T12:00:00.000Z',
      generatedBy: 'the workspace',
    })
    expect(html).toContain('sheet “Employees”, header row 2')
    expect(html).toContain('12,34,567.89 (Indian grouping)')
  })

  it('names the object, cycle, verdicts, files and fingerprints', async () => {
    const { html, reference, fileName } = await packFor(object)
    expect(html).toContain('<title>Cutover sign-off record — Employees · Wave 1 · Mock 2</title>')
    expect(html).toContain('Not ready')
    expect(html).toContain('Did not reconcile')
    expect(html).toContain('Stopped at Mapping.')
    expect(html).toContain(await sha256Hex(texts.source))
    expect(html).toContain(await sha256Hex(texts.target))
    expect(html).toContain(await sha256Hex(texts.load))
    expect(html).toContain('CAUGHT HERE')
    expect(html).toContain('Whose fix: Functional team (mapping spec and crosswalks).')
    for (const role of ['Prepared by', 'Reviewed by', 'Approved by', 'Received by the auditor (not a certification)']) expect(html).toContain(role)
    expect(reference).toMatch(/^EV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
    expect(fileName).toBe(`employees-wave-1-mock-2-evidence-${reference.toLowerCase()}.html`)
  })

  it('quotes the records behind each finding — that is what evidence is', async () => {
    const { html } = await packFor(object)
    expect(html).toContain('G4') // the unmapped legacy grade
    expect(html).toContain('40117') // a salary that lost its decimal point
  })

  it('says plainly when a check did not run, and attests nothing for it', async () => {
    const { html } = await packFor(object, { withRecon: false })
    expect(html).toContain('<div class="vt">After the load</div><div class="vw">Not run</div>')
    expect(html).not.toContain('Reconciliation — did the load arrive whole?')
  })

  it('is the same document for the same inputs, with the same reference', async () => {
    const a = await packFor(object)
    const b = await packFor(object)
    expect(a.html).toBe(b.html)
    expect(a.reference).toBe(b.reference)
  })
})

describe('evidence pack — fingerprints', () => {
  it('do not move when only key order or UI state differs', async () => {
    const reverseKeys = (v) => (Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys(v[k])]))
      : v)
    const reordered = { ...object, spec: reverseKeys(object.spec) }
    expect(JSON.stringify(reordered.spec)).not.toBe(JSON.stringify(object.spec)) // really reordered
    const withUiState = { ...object, contract: { ...object.contract, rules: object.contract.rules.map((r) => ({ ...r, editing: true })) } }
    const base = await evidenceFingerprints(object)
    expect((await evidenceFingerprints(reordered)).spec.sha256).toBe(base.spec.sha256)
    expect((await evidenceFingerprints(withUiState)).contract.sha256).toBe(base.contract.sha256)
  })

  it('move when a rule or a mapping changes', async () => {
    const base = await evidenceFingerprints(object)
    const looser = { ...object, contract: { ...object.contract, rules: object.contract.rules.slice(1) } }
    const remapped = { ...object, spec: { ...object.spec, mapping: object.spec.mapping.slice(1) } }
    expect((await evidenceFingerprints(looser)).contract.sha256).not.toBe(base.contract.sha256)
    expect((await evidenceFingerprints(remapped)).spec.sha256).not.toBe(base.spec.sha256)
  })
})

describe('evidence pack — safe to open', () => {
  // Values come from files. A cell is free to contain markup; the pack must
  // show it as text and never run it.
  const HOSTILE = ['<script>alert(1)</script>', '"><img src=x onerror=alert(2)>', "' onmouseover='alert(3)", '</pre><iframe src=//evil.example>']

  async function hostilePack() {
    const source = { columns: ['id', 'name'], rows: HOSTILE.map((v, i) => ({ id: `${v}#${i}`, name: v })) }
    const target = { columns: ['id', 'name'], rows: HOSTILE.map((v, i) => ({ id: `${v}#${i}`, name: `${v}!` })) }
    target.rows.push({ id: '<b>ghost</b>', name: 'x' })
    const o = {
      name: '<img src=x onerror=alert(4)>',
      wave: '"><script>',
      cycle: 'Mock 1',
      contract: { name: '<svg onload=alert(5)>', rules: [{ kind: 'valueSet', column: 'name', op: 'in', target: ['<script>x</script>'] }] },
      spec: { key: { source: ['id'], target: ['id'] }, mapping: [{ source: 'name', target: 'name' }], totals: [] },
      runs: [],
    }
    const recon = reconcile(runnableSpec(o), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns })
    const ready = checkReadiness(o.contract, target.rows, { columns: target.columns, key: ['id'] })
    const { flagged: _f, ...report } = ready
    return createEvidencePack({
      object: o,
      readiness: { report, flaggedCount: 1, file: { name: '<script>.csv', rows: 5, bytes: 1, sha256: 'x' } },
      reconciliation: { report: recon, source: { name: 's.csv', rows: 4, bytes: 1, sha256: 'y' }, target: { name: 't.csv', rows: 5, bytes: 1, sha256: 'z' } },
      generatedBy: 'the workspace',
    })
  }

  it('escapes every value — no markup from a file survives as markup', async () => {
    const { html } = await hostilePack()
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img|<iframe|<svg|<b>/i)
    // No real tag carries an event handler. Text may still READ " onerror=" —
    // escaped, it is only text — so the check is on tags, not on characters.
    expect(html).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;')
  })

  it('forbids scripts and network requests even if escaping ever failed', async () => {
    const { html } = await hostilePack()
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">`)
  })

  it('loads nothing from anywhere: no scripts, links, sources or URLs', async () => {
    const { html } = await packFor(object)
    expect(html).not.toMatch(/<script|<link|\ssrc=|\shref=|https?:\/\//i)
  })

  it('escapeHtml covers all five characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
})

// v3 §5.3 / §5.4: the pack is the cutover sign-off record.
describe('the cutover sign-off record', () => {
  const recorded = {
    ...object,
    owners: { mapping: 'HR functional lead (Priya)' },
    signoff: {
      identity: { entity: 'Invented Pvt Ltd', financialYear: '2026-27', legacySystem: 'Legacy HR v4', newSystem: 'Target HCM', cutoverDate: '2027-04-01' },
      custody: { source: { exportedBy: 'A. Rao', exportedAt: '2027-03-31 18:00' } },
      exceptions: {},
      scope: 'History migrated as balances only.',
      signatures: { preparedBy: { name: 'A. Rao', date: '2027-04-02' }, auditorReceived: { name: 'Audit firm (invented)' } },
    },
  }

  it('carries identity, custody, exceptions with owners, scope, the claim and the typed signatures', async () => {
    const { html } = await packFor(recorded)
    for (const text of ['Invented Pvt Ltd', '2026-27', 'Legacy HR v4', 'Target HCM', '2027-04-01', 'A. Rao, 2027-03-31 18:00', 'History migrated as balances only.', 'Audit firm (invented)']) expect(html).toContain(text)
    expect(html).toContain('Cutover sign-off record')
    expect(html).toContain('These checks ran on these fingerprinted files with these results.')
    expect(html).toContain('they are not verified identities')
    expect(html).toContain('HR functional lead (Priya)') // the object's own owner for Mapping
    expect(html).toMatch(/\d+ differences?, \d+ not yet decided/)
  })

  it('records a decision on a difference by its id, and the decision appears', async () => {
    const { exceptionsFor } = await import('./signoff.js')
    const { reconcile } = await import('./reconcile.js')
    const report = reconcile(runnableSpec(object), parsed.source.rows, parsed.target.rows, { sourceColumns: parsed.source.columns, targetColumns: parsed.target.columns })
    const [first] = exceptionsFor(null, report)
    const decided = { ...recorded, signoff: { ...recorded.signoff, exceptions: { [first.id]: { disposition: 'accepted', reason: 'Grade G4 retired; agreed with HR', owner: 'HR head' } } } }
    const { html } = await packFor(decided, { withReadiness: false })
    expect(html).toContain('Accepted, with a reason')
    expect(html).toContain('Grade G4 retired; agreed with HR')
  })

  it('says what was not checked, by itself', async () => {
    const { html } = await packFor(recorded, { withRecon: false })
    expect(html).toContain('Reconciliation was not run for this record')
  })

  it('never makes a claim it must not make', async () => {
    const { NEVER_CLAIM } = await import('./signoff.js')
    const { html } = await packFor(recorded)
    // Strip the one place the word appears to say it is NOT one.
    const text = html.replace('(not a certification)', '').replace(/<[^>]+>/g, ' ')
    expect(NEVER_CLAIM.filter((pattern) => pattern.test(text)).map(String)).toEqual([])
  })
})

// final-spec C1: the record says which file column each definition read.
describe('the evidence pack and column matching', () => {
  it('prints and fingerprints the matching; without one, the fingerprints are what they always were', async () => {
    const { evidenceFingerprints, createEvidencePack } = await import('./evidencePack.js')
    const { newMigrationObject } = await import('./migrationObject.js')
    const object = { ...newMigrationObject('Chart'), contract: { name: 'c', rules: [{ kind: 'nullRule', column: 'Name', op: 'notNull', target: null }] } }
    const plain = await evidenceFingerprints(object)
    expect(plain.columns).toBeNull()

    const matched = { ...object, columnMap: { load: { Name: '<b>Ledger</b> Name' }, 'reference:accounts': { 'Account Name': 'Acct' } } }
    const prints = await evidenceFingerprints(matched)
    expect(prints.contract.sha256).toBe(plain.contract.sha256)
    expect(prints.columns.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await evidenceFingerprints({ ...object, columnMap: { load: { Name: 'Ledger' } } })).columns.sha256).not.toBe(prints.columns.sha256)

    const report = { status: 'READY', headline: 'Ready to load.', counts: { records: 1, rejected: 0, warned: 0, clean: 1 }, checks: [], missingColumns: [], flagged: [], issues: [] }
    const { html } = await createEvidencePack({ object: matched, readiness: { report, flaggedCount: 0, file: { name: 'l.csv', rows: 1, bytes: 1, sha256: 'a' } }, generatedAt: '2026-11-11T10:00:00Z', generatedBy: 'test' })
    expect(html).toContain('Column matching')
    expect(html).toContain('&lt;b&gt;Ledger&lt;/b&gt; Name') // a hostile header is text, never markup
    expect(html).not.toContain('<b>Ledger</b>')
    expect(html).toContain('Reference file “accounts”')
    expect(html).toContain(prints.columns.sha256)
  })
})
