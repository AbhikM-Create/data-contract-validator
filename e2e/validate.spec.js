import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

test('an example runs and the staircase says where the file stopped', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.locator('button', { hasText: /example|open|run|try/i }).nth(3).click() // "Salaries 83x"
  await expect(page.getByText('How far the file got')).toBeVisible()
  await expect(page.getByText(/Schema, Semantics and Freshness all passed, and Distribution is where the file stopped/)).toBeVisible()
  await expect(page.locator('.staircase-step')).toHaveCount(4)
  expect(errors).toEqual([])
})

test('the production page carries its Content-Security-Policy and violates none of it', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain("object-src 'none'")
  // The worker, the router and an example all run under it.
  await page.locator('button', { hasText: /example|open|run|try/i }).first().click()
  await expect(page.getByText('How far the file got')).toBeVisible()
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()
  expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([])
  expect(errors).toEqual([])
})
