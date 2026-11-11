import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { download, uploadAs, watchErrors, write } from './helpers.js'

// v3 §6.1 in the browser: an object started from the Finance pack, run on
// invented Tally and Zoho files, with the pack's draft status said wherever the
// result goes. Every company and amount is invented.

test('the Finance pack’s opening trial balance: start, check, reconcile, and say it is a draft', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')

  await page.getByLabel('pack object to start from').selectOption('finance-tally-zoho-books/opening-trial-balance')
  await page.getByRole('button', { name: 'Start “Opening trial balance”' }).click()
  await expect(page.getByLabel('object name')).toHaveValue('Opening trial balance')
  await expect(page.getByText(/DRAFT — this pack has not yet run on real exports/)).toBeVisible()
  await expect(page.getByText('Account Name · Debit · Credit').first()).toBeVisible()

  // A load file whose debits do not equal its credits: a file total, not a record.
  await uploadAs(page, 'load', write(dir, 'opening.csv', 'Account Name,Debit,Credit\nCash,25000,0\nCapital,0,20000\n'))
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('FILE TOTAL', { exact: true })).toBeVisible()
  await expect(page.getByText(/the sum of "Debit" must be equal to the sum of "Credit"/).first()).toBeVisible()

  // Tally's closing trial balance in lakh and crore, against Zoho's opening one.
  await uploadAs(page, 'source', write(dir, 'tally_tb.csv', 'Particulars,Debit,Credit\nCash,"25,000.00",\nHDFC Current,"12,25,000.50",\nCapital,,"12,50,000.50"\n'))
  await uploadAs(page, 'target', write(dir, 'zoho_tb.csv', 'Account Name,Debit,Credit\nCash,25000.00,\nHDFC Current,1225000.50,\nCapital,,1250000.50\n'))
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByText('RECONCILED', { exact: true }).first()).toBeVisible()

  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  expect(pack).toContain('pack finance-tally-zoho-books v0.1.0 — DRAFT: not yet run on real exports')
  expect(pack).toContain('Balances as at the cutover date only; transaction history is not compared.')

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})
