import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

test('the board: the example programme, then the object just checked on Migrations', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/board')
  await expect(page.getByText('No objects on the board yet')).toBeVisible()

  await page.getByRole('button', { name: 'Show an example programme' }).click()
  await expect(page.getByText('1 of 3 objects failed, and 1 could not be confirmed.')).toBeVisible()
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Employees')
  await expect(rows.nth(0)).toContainText('Stopped at Mapping')
  await expect(rows.nth(1)).toContainText('reconciliation was not run in this cycle')
  await expect(rows.nth(2)).toContainText('+7.5 pts on Wave 1 Mock 1')
  await page.screenshot({ path: test.info().outputPath('board-example.png'), fullPage: true })

  // Checks run in the workspace put the object on the board.
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.getByText('1 of 1 object failed.')).toBeVisible()
  await expect(page.locator('tbody tr').first()).toContainText('2 of 46 records would be rejected')
  expect(errors).toEqual([])
})
