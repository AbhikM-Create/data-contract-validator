import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { parseCsv, toCsv } from '../src/lib/parseCsv.js'
import { MIGRATION_SAMPLE, migrationLoadFile, migrationSource, migrationTarget } from '../src/samples/migrationSample.js'
import { download, uploadAs, watchErrors, write } from './helpers.js'

const sha = (text) => createHash('sha256').update(text).digest('hex')
const headline = (page) => page.locator('h3').filter({ hasText: /^(Stopped at|Reconciled)/ }).first()

test('the example migration: readiness, reconciliation, a crosswalk that closes the gap, save, reopen, evidence', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()

  // Before the load: two rejections, one warning — and the fix list holds exactly those three.
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  const fixList = parseCsv(readFileSync(await download(page, () => page.getByRole('button', { name: /Download the fix list/ }).click(), dir), 'utf8'))
  expect(fixList.rows.map((r) => r._readiness).sort()).toEqual(['REJECT', 'REJECT', 'WARN'])

  // After the load: caught at Mapping, with Keys and Completeness passed above it.
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(headline(page)).toHaveText('Stopped at Mapping. 46 of 46 in-scope records matched one to one. Keys and Completeness passed above it.')

  // A grade crosswalk that covers G4 moves the load down to Accuracy.
  const crosswalk = write(dir, 'grades.csv', 'legacy,new\nG4,Associate\nG5,Associate\nG6,Analyst\nG7,Senior Analyst\nG8,Lead\nG9,VP\n')
  const gradeIndex = await page.locator('select').evaluateAll((els) => els.findIndex((el) => el.value === 'TRFGR'))
  await page.locator('select').nth(gradeIndex).locator('xpath=..').locator('input[type=file]').setInputFiles(crosswalk)
  await expect(page.getByText('The spec or the files have changed since this ran')).toBeVisible()
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(headline(page)).toHaveText(/^Stopped at Accuracy\. .* Keys, Completeness and Mapping passed above it\.$/)

  // A conflicting crosswalk is refused whole.
  const conflict = write(dir, 'conflict.csv', 'legacy,new\nG7,Lead\nG7,VP\n')
  await page.locator('select').nth(gradeIndex).locator('xpath=..').locator('input[type=file]').setInputFiles(conflict)
  await expect(page.getByText('"G7" is listed twice, becoming "Lead" and "VP". Keep one.')).toBeVisible()

  // The evidence pack names every file by the SHA-256 of its bytes.
  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  for (const text of [migrationSource(), migrationTarget(), migrationLoadFile()]) expect(pack).toContain(sha(text))
  expect(pack).toMatch(/data-contract-validator \d+\.\d+\.\d+/)

  // Saved: three checks, and no record from the files.
  const saved = await download(page, () => page.getByRole('button', { name: /^Download/ }).first().click(), dir)
  const json = readFileSync(saved, 'utf8')
  expect(JSON.parse(json).runs).toHaveLength(3)
  expect(json).not.toMatch(/OKAFOR|Okafor|40117/)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('button', { name: 'Start a new object' }).click()
  await page.locator('input[type=file]').first().setInputFiles(saved)
  await expect(page.getByText(/^Opened "Employees" — 5 rules, 5 mapped fields, 3 earlier checks\.$/)).toBeVisible()
  expect(errors).toEqual([])
})

// v3 F1. A corrected re-extract usually keeps its file name and its row count.
// A result is current only while the file's bytes are the ones it ran on, so the
// pack must leave out a check whose file was swapped — whatever it is called.
test('a file swapped for one with the same name and row count is not attested with the old result', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()

  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByText(/^Stopped at Mapping\./).first()).toBeVisible()

  // The same name and the same 46 records; the blank surnames filled in.
  const original = parseCsv(migrationLoadFile())
  const fixed = original.rows.map((row) => ({ ...row, last_name: row.last_name || 'FILLEDIN' }))
  const swapped = toCsv(original.columns, fixed)
  expect(fixed).toHaveLength(original.rows.length)
  await uploadAs(page, 'load', write(dir, MIGRATION_SAMPLE.loadName, swapped))

  await expect(page.getByText(/left out — something changed since it ran/)).toBeVisible()
  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  await expect(page.getByText(/It leaves out load readiness/)).toBeVisible()
  expect(pack).not.toContain(sha(migrationLoadFile()))
  expect(pack).not.toContain(sha(swapped))
  expect(pack).not.toContain('Load readiness — will the target accept the load file?')
  expect(pack).toContain(sha(migrationSource()))
  expect(errors).toEqual([])
})
