import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { createEvidencePack } from '../src/lib/evidencePack.js'
import { reconcile } from '../src/lib/reconcile.js'
import { write } from './helpers.js'

// An evidence pack quotes records from files, and a cell is free to hold
// markup. Opened by an auditor, the pack must show it as text and run nothing.
test('a pack built from script-laden data runs nothing when opened', async ({ page }) => {
  const evil = ['<script>alert(1)</script>', '"><img src=x onerror=alert(2)>', '<svg onload=alert(3)>']
  const object = {
    name: '<img src=x onerror=alert(9)>', contract: { rules: [] },
    spec: { key: { source: ['id'], target: ['id'] }, mapping: [{ source: 'name', target: 'name' }], totals: [] }, runs: [],
  }
  const report = reconcile(object.spec, evil.map((v, i) => ({ id: v + i, name: v })), evil.map((v, i) => ({ id: v + i, name: `${v}!` })))
  const pack = await createEvidencePack({
    object,
    reconciliation: { report, source: { name: '<b>s</b>.csv', rows: 3, bytes: 1, sha256: 'x' }, target: { name: 't.csv', rows: 3, bytes: 1, sha256: 'y' } },
    generatedBy: 'e2e',
  })
  const path = write(test.info().outputPath(), 'hostile-pack.html', pack.html)

  const dialogs = []
  const requests = []
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss() })
  page.on('request', (r) => { if (!r.url().startsWith('file:')) requests.push(r.url()) })
  await page.goto(pathToFileURL(path).href)
  await page.waitForTimeout(300)

  expect(dialogs).toEqual([])
  expect(requests).toEqual([])
  await expect(page).toHaveTitle('Evidence pack — <img src=x onerror=alert(9)>')
  await expect(page.locator('img, svg, iframe, script')).toHaveCount(0)
  await expect(page.getByText('<script>alert(1)</script>').first()).toBeVisible()
})
