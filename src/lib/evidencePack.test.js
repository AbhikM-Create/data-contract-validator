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
    reproduce: 'node scripts/reconcile.mjs employees.migration.json legacy.csv target.csv',
  })
}

describe('evidence pack — what it attests to', () => {
  it('names the object, cycle, verdicts, files and fingerprints', async () => {
    const { html, reference, fileName } = await packFor(object)
    expect(html).toContain('<title>Evidence pack — Employees · Wave 1 · Mock 2</title>')
    expect(html).toContain('Not ready')
    expect(html).toContain('Did not reconcile')
    expect(html).toContain('Stopped at Mapping.')
    expect(html).toContain(await sha256Hex(texts.source))
    expect(html).toContain(await sha256Hex(texts.target))
    expect(html).toContain(await sha256Hex(texts.load))
    expect(html).toContain('CAUGHT HERE')
    expect(html).toContain('Usually fixed in the mapping specification (functional team).')
    for (const role of ['Data migration lead', 'Business data owner', 'Internal audit / quality']) expect(html).toContain(role)
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
