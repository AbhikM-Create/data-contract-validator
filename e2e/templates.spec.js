import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

test('a contract from the target’s template: proposals with their source, added on acceptance, and what was not imported', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/contracts')
  const input = page.locator('label', { hasText: 'Read a template' }).locator('input[type=file]')

  // The constructed Migration Cockpit template (see the fixture's own comment).
  await input.setInputFiles('src/lib/__fixtures__/templates/cockpit-constructed.xml')
  await expect(page.getByText('cockpit-constructed.xml')).toBeVisible()
  const kunnr = page.getByRole('button', { name: '+ KUNNR — Required' })
  await expect(kunnr).toHaveAttribute('title', 'sheet “General Data”, KUNNR (Customer Number) is marked mandatory (Mandatory for sheet)')
  await expect(page.getByText(/LAND1: importance “Mandatory if address is given” — it depends on other fields or sheets/)).toBeVisible()
  await page.getByRole('button', { name: 'Add all 4' }).click()
  await expect(page.getByText('All proposed rules are already in the contract.')).toBeVisible()
  await expect(page.getByText(/KUNNR/).first()).toBeVisible()

  // Named by description instead: new proposals for the same fields.
  await page.getByLabel('description').check()
  await expect(page.getByRole('button', { name: '+ Customer Number — Required' })).toBeVisible()

  // A field list as CSV; something that is neither is refused with the reason.
  await input.setInputFiles({ name: 'fields.csv', mimeType: 'text/csv', buffer: Buffer.from('Field name,Required,Allowed values\ngrade,Yes,Associate;Analyst\n') })
  await expect(page.getByRole('button', { name: '+ grade — Only these 2 values' })).toBeVisible()
  await input.setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') })
  await expect(page.getByText(/^notes\.csv: no column names the fields/)).toBeVisible()
  expect(errors).toEqual([])
})
