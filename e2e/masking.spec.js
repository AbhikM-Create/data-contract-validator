import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { parseCsv } from '../src/lib/parseCsv.js'
import { clickEvidencePack, download, openStep, runReadiness, watchErrors } from './helpers.js'

// v3 §5.2 in the browser: a field tagged on screen is masked in the fix list
// and the evidence pack, the pack says what it hid, and unmasking is a visible,
// per-output choice the pack and the file name both admit to.

test('tagged fields are masked in the fix list and the pack; unmasking says so', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()

  // Proposed from the names; the person accepts.
  await expect(page.getByText(/Suggested from the column names: .*annual_salary \(pay\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Tag these' }).click()
  await expect(page.getByLabel('sensitivity of annual_salary')).toHaveValue('pay')
  await expect(page.getByLabel('sensitivity of last_name')).toHaveValue('personal')

  await runReadiness(page)
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  // On screen the values stay visible: these are the person's own files.
  await expect(page.getByText(/1250000\.00/).first()).toBeVisible()

  const fixPath = await download(page, () => page.getByRole('button', { name: /Download the fix list/ }).click(), dir)
  const fixes = parseCsv(readFileSync(fixPath, 'utf8'))
  expect(fixes.rows.length).toBeGreaterThan(0)
  expect(fixes.rows.every((r) => r.annual_salary === '[masked]' || r.annual_salary === '')).toBe(true)
  expect(fixes.rows.every((r) => r.employee_id !== '[masked]')).toBe(true) // the key stays, so the record can be found

  const pack = readFileSync(await download(page, () => clickEvidencePack(page), dir), 'utf8')
  expect(pack).toContain('Masked in this pack')
  expect(pack).not.toContain('1250000.00')

  await page.getByLabel(/Show tagged values unmasked/).check()
  await expect(page.getByText(/the fix list is named …-UNMASKED/)).toBeVisible()
  const open = readFileSync(await download(page, () => clickEvidencePack(page), dir), 'utf8')
  expect(open).toContain('This pack contains unmasked personal data.')
  expect(open).toContain('1250000.00')
  await openStep(page, 'before')
  const openFixes = await download(page, () => page.getByRole('button', { name: /Download the fix list/ }).click(), dir)
  expect(basename(openFixes)).toMatch(/-fix-list-UNMASKED\.csv$/)

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})
