import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { download, uploadAs, watchErrors, write } from './helpers.js'

// final-spec C1 in the browser: a pack object meets a client's file whose
// headers differ. The person matches the columns from dropdowns — one proposal
// accepted, one chosen — and the checks then run as on the pack's own headers.
// The record says which column was read as which. Every amount is invented.

test('the Finance pack on a file with the client’s own headers: match columns, then check and reconcile', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByLabel('pack object to start from').selectOption('finance-tally-zoho-books/opening-trial-balance')
  await page.getByRole('button', { name: 'Start “Opening trial balance”' }).click()

  // The load file says "account name", "Dr" and "Cr" where the pack says
  // "Account Name", "Debit" and "Credit". Debits do not equal credits.
  await uploadAs(page, 'load', write(dir, 'opening.csv', 'account name,Dr,Cr\nCash,25000,0\nCapital,0,20000\n'))
  const load = page.locator('[data-column-matcher="load file"]')
  await expect(load.getByText(/3 columns the definitions read are not in this file under that name/)).toBeVisible()

  // Nothing is matched until a person says so: unmatched, the file is not judged.
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('This readiness check cannot run as set up.').first()).toBeVisible()

  // One proposal (same name apart from case), accepted; two chosen by hand.
  await load.getByRole('button', { name: /Use “account name”/ }).click()
  await load.getByLabel('load file: file column for Debit').selectOption('Dr')
  await load.getByLabel('load file: file column for Credit').selectOption('Cr')
  await expect(load.getByText('Every column the definitions read is matched to a column of this file.')).toBeVisible()
  // The earlier result was run under no matching: it says it is out of date.
  await expect(page.getByText(/The rules, the key or the file have changed/)).toBeVisible()

  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText(/The rules, the key or the file have changed/)).toHaveCount(0)
  await expect(page.getByText('FILE TOTAL', { exact: true })).toBeVisible()
  await expect(page.getByText(/the sum of "Debit" must be equal to the sum of "Credit"/).first()).toBeVisible()

  // Tally's export says "Ledger" for the pack's "Particulars".
  await uploadAs(page, 'source', write(dir, 'tally_tb.csv', 'Ledger,Debit,Credit\nCash,"25,000.00",\nCapital,,"25,000.00"\n'))
  await uploadAs(page, 'target', write(dir, 'zoho_tb.csv', 'Account Name,Debit,Credit\nCash,25000.00,\nCapital,,25000.00\n'))
  const source = page.locator('[data-column-matcher="source extract"]')
  await source.getByLabel('source extract: file column for Particulars').selectOption('Ledger')
  await expect(page.locator('[data-column-matcher="target extract"]')).toHaveCount(0) // nothing to match there
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByText('RECONCILED', { exact: true }).first()).toBeVisible()

  // Changing a match makes the result stale, on the result itself.
  // (A file column already standing for one name is not offered for another.)
  await expect(load.getByLabel('load file: file column for Debit').locator('option', { hasText: /^Cr$/ })).toHaveCount(0)
  await load.getByLabel('load file: file column for Debit').selectOption('')
  await expect(page.getByText(/The rules, the key or the file have changed/)).toBeVisible()
  await load.getByLabel('load file: file column for Debit').selectOption('Dr')
  await expect(page.getByText(/The rules, the key or the file have changed/)).toHaveCount(0)

  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  expect(pack).toContain('Column matching')
  expect(pack).toMatch(/Load file<\/td><td class="mono">Debit<\/td><td class="mono">Dr</)
  expect(pack).toMatch(/Source extract<\/td><td class="mono">Particulars<\/td><td class="mono">Ledger</)

  // The matching is saved with the object: column names, no values.
  const saved = readFileSync(await download(page, () => page.getByRole('button', { name: /^Download/ }).first().click(), dir), 'utf8')
  expect(JSON.parse(saved).columnMap).toEqual({ load: { 'Account Name': 'account name', Debit: 'Dr', Credit: 'Cr' }, source: { Particulars: 'Ledger' } })
  expect(saved).not.toContain('25000')

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})
