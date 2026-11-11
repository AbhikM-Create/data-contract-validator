import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

// final-spec §4.1: the home page leads with the cutover job, and its first
// example is a finance cutover built from the pack. Every amount is invented.

test('home leads with the cutover; the finance example opens ready to run and tells its story', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prove every load before anyone signs it off.')
  // The drift check is still on the page, as the after-go-live job.
  await expect(page.getByRole('heading', { name: /After go-live: the columns match/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run this example' }).first()).toBeVisible()

  // Finance comes first.
  const examples = page.getByRole('button', { name: /^Open the example:/ })
  await expect(examples).toHaveCount(2)
  await expect(examples.first()).toHaveAccessibleName('Open the example: Finance — an opening trial balance')
  await examples.first().click()

  await expect(page).toHaveURL(/#\/migrations$/)
  await expect(page.getByLabel('object name')).toHaveValue('Opening trial balance')
  await expect(page.getByText(/DRAFT — this pack has not yet run on real exports/)).toBeVisible()
  // Its reference file is opened with it: nothing is left for the visitor to find.
  await expect(page.getByText('zoho_chart_of_accounts.csv').first()).toBeVisible()

  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('FILE TOTAL', { exact: true })).toBeVisible()
  await expect(page.getByText(/2,280,500\.5 against 2,280,000\.5 \(difference 500\)/).first()).toBeVisible()

  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByText(/Stopped at Completeness\. 9 of 10 in-scope records matched one to one/).first()).toBeVisible()

  // Switching to the other example closes the finance example's reference file.
  await page.goto('/')
  await page.getByRole('button', { name: 'Open the example: HR — an employee master' }).click()
  await expect(page.getByLabel('object name')).toHaveValue('Employees')
  await expect(page.getByText('zoho_chart_of_accounts.csv')).toHaveCount(0)
  await expect(page.getByText(/the load file is the one prepared for the next load, Mock 3/)).toBeVisible()
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText(/2 of 46 records/).first()).toBeVisible()

  await page.goto('/')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})
