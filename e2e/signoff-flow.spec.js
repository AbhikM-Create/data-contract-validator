import { expect, test } from '@playwright/test'
import { createEvidencePack } from '../src/lib/evidencePack.js'
import { sha256Hex } from '../src/lib/hashing.js'
import { runnableSpec } from '../src/lib/migrationObject.js'
import { parseCsv } from '../src/lib/parseCsv.js'
import { checkReadiness } from '../src/lib/readiness.js'
import { reconcile } from '../src/lib/reconcile.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../src/samples/migrationSample.js'
import { watchErrors } from './helpers.js'
import { project, signIn, user } from './standin.js'

// A business data owner decides on a submitted check, in the build configured
// for a Supabase project (playwright.config.js). The stand-in answers as
// PostgREST would; what this proves is the screen's side: what it reads, what
// it offers, and exactly what it sends.

const ENGINEER = 'e0000000-0000-4000-8000-0000000000e1'
const ORG = '0f000000-0000-4000-8000-000000000001'

async function pack() {
  const object = migrationSampleObject()
  const texts = { load: migrationLoadFile(), source: migrationSource(), target: migrationTarget() }
  const [l, s, t] = [texts.load, texts.source, texts.target].map(parseCsv)
  const info = async (name, text, rows) => ({ name, rows, bytes: Buffer.byteLength(text), sha256: await sha256Hex(text) })
  const { flagged: _f, ...readiness } = checkReadiness(object.contract, l.rows, { columns: l.columns, key: ['employee_id'] })
  return createEvidencePack({
    object,
    readiness: { report: readiness, file: await info('load.csv', texts.load, l.rows.length) },
    reconciliation: { report: reconcile(runnableSpec(object), s.rows, t.rows, { sourceColumns: s.columns, targetColumns: t.columns }), source: await info('legacy.csv', texts.source, s.rows.length), target: await info('target.csv', texts.target, t.rows.length) },
    generatedAt: '2026-10-20T10:00:00Z',
    generatedBy: 'the workspace',
  })
}

test('a data owner opens the pack they were sent and records a decision against it', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  const p = await pack()
  const submission = {
    id: 's1', reference: p.reference, object_name: 'Employees', wave: 'Wave 1', cycle: 'Mock 2', contract_def: 'd1', spec_def: 'd2',
    subject: p.subject, submitted_by: ENGINEER, submitted_at: '2026-10-20T10:05:00Z',
  }
  const decisions = []
  await project(page, {
    rest: ({ method, path, query, body, single }) => {
      if (path === 'memberships') return { data: [{ role: 'data_owner', organizations: { id: ORG, name: 'Northwind' } }] }
      if (path === 'rpc/organization_members') return { data: [{ user_id: user.id, email: user.email, role: 'data_owner' }, { user_id: ENGINEER, email: 'eng@northwind.example', role: 'engineer' }] }
      if (path === 'submissions') return { data: [submission] }
      if (path === 'decisions' && method === 'POST') { decisions.push(body); return { status: 201, data: [] } }
      if (path === 'decisions') return { data: [] }
      if (path === 'definitions' && single) return { data: { id: 'd1', kind: 'contract', sha256: p.fingerprints.contract.sha256, body: JSON.parse(p.fingerprints.contract.json), recorded_by: ENGINEER } }
      if (path === 'definitions') return { data: [{ id: 'd1', recorded_by: ENGINEER }, { id: 'd2', recorded_by: ENGINEER }] }
      if (path === 'audit_log') return { data: [{ id: 1, at: '2026-10-20T10:05:00Z', actor: ENGINEER, action: 'insert', entity: 'submissions', detail: { reference: p.reference, object: 'Employees', cycle: 'Mock 2' } }] }
      return null
    },
  })
  await signIn(page)
  await page.goto('/#/signoff')
  await expect(page.getByText(`eng@northwind.example submitted ${p.reference} — Employees, Mock 2 — for sign-off.`)).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`Employees · Wave 1 · Mock 2 ${p.reference}`) }).click()
  await expect(page.getByText('2 of 46 records would be rejected')).toBeVisible()

  // The recorded rules, re-verified against their fingerprint in the page.
  await page.getByRole('button', { name: 'Show exactly what was signed off' }).first().click()
  await expect(page.getByText('Verified: this text hashes to the fingerprint above.')).toBeVisible()

  // The wrong pack is refused; the right one opens the decision.
  await page.locator('input[type=file]').setInputFiles({ name: 'other.html', mimeType: 'text/html', buffer: Buffer.from('<html><meta name="dcv-evidence-reference" content="EV-0000-0000-0000"></html>') })
  await expect(page.getByText(`That pack is EV-0000-0000-0000, not ${p.reference}.`, { exact: false })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: p.fileName, mimeType: 'text/html', buffer: Buffer.from(p.html) })
  await expect(page.getByText(`This is pack ${p.reference}.`)).toBeVisible()

  await page.getByLabel('Accept with exceptions').check()
  await page.getByLabel('Finding accepted').selectOption('reconcile:mapping')
  await page.getByLabel('Why it is acceptable').fill('G4 is retired before cutover')
  await page.getByLabel('Owner of the fix').fill('HR functional lead')
  await page.getByLabel('Fix by').fill('2026-11-15')
  await page.screenshot({ path: `${dir}/decision.png`, fullPage: true })
  await page.getByRole('button', { name: 'Record my decision' }).click()

  await expect(page.getByText(`Your decision on ${p.reference} is recorded.`)).toBeVisible()
  expect(decisions).toEqual([{
    org_id: ORG,
    submission_id: 's1',
    decision: 'accept-with-exceptions',
    exceptions: [{ finding: 'reconcile:mapping', reason: 'G4 is retired before cutover', owner: 'HR functional lead', fixBy: '2026-11-15' }],
    comment: null,
  }])
  expect(errors).toEqual([])
})

test('the engineer who submitted a check is not offered the decision', async ({ page }) => {
  const p = await pack()
  await project(page, {
    rest: ({ path }) => {
      if (path === 'memberships') return { data: [{ role: 'data_owner', organizations: { id: ORG, name: 'Northwind' } }, { role: 'engineer', organizations: { id: ORG, name: 'Northwind' } }] }
      if (path === 'submissions') return { data: [{ id: 's1', reference: p.reference, object_name: 'Employees', wave: 'Wave 1', cycle: 'Mock 2', contract_def: 'd1', spec_def: 'd2', subject: p.subject, submitted_by: user.id, submitted_at: '2026-10-20T10:05:00Z' }] }
      return null
    },
  })
  await signIn(page)
  await page.goto('/#/signoff')
  await page.getByRole('button', { name: new RegExp(p.reference) }).click()
  await expect(page.getByText('You submitted this check, so someone else must decide on it.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record my decision' })).toHaveCount(0)
})
