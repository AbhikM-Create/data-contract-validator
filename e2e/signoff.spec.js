import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { download, watchErrors } from './helpers.js'

// This build has no account service configured. Nothing may claim otherwise,
// and nothing may offer a sign-in it cannot perform — the header included.
test('accounts off: the header says so, and every screen agrees', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const control = page.getByRole('button', { name: 'Accounts off' })
  await expect(control).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)

  // The control explains rather than dead-ending in a disabled form.
  await control.click()
  await expect(page.getByRole('heading', { name: 'Accounts are not set up in this copy' })).toBeVisible()
  await expect(page.getByText(/Saved contracts — the rules you write/)).toBeVisible()
  await expect(page.getByText(/copy \.env\.example to \.env\.local/)).toBeVisible()
  await expect(page.locator('input[type=password]')).toHaveCount(0)

  for (const [route, says] of [['#/contracts', /keep them as a file/], ['#/history', /the result lives as long as the page is open/], ['#/signoff', /sign it on paper/]]) {
    await page.goto(`/${route}`)
    await expect(page.getByText('Accounts are not set up in this copy').first()).toBeVisible()
    await expect(page.getByText(says)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

// The screen a programme buys this for must show itself without an account.
test('the example sign-off is the real thing: verdicts, hashes, a decision, a verified definition', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/signoff')
  await page.getByRole('button', { name: 'Show an example sign-off' }).click()

  const submission = page.locator('button', { hasText: /Employees · Wave 1 · Mock 2/ })
  await expect(submission).toBeVisible()
  await expect(page.getByText('Accepted with exceptions')).toBeVisible()
  await submission.click()

  await expect(page.getByText('2 of 46 records would be rejected')).toBeVisible()
  await expect(page.getByText('46 of 46 expected records arrived; 0 missing, 2 with differences')).toBeVisible()
  await expect(page.locator('td', { hasText: /^[0-9a-f]{64}$/ }).first()).toBeVisible()

  // The fingerprint is checked in the page, exactly as against the database.
  await page.getByRole('button', { name: 'Show exactly what was signed off' }).first().click()
  await expect(page.getByText('Verified: this text hashes to the fingerprint above.')).toBeVisible()
  await expect(page.getByText(/does NOT match its fingerprint/)).toHaveCount(0)

  await expect(page.getByText(/Grade G4 was retired in the legacy system/)).toBeVisible()
  await expect(page.getByText(/priya@northwind\.example submitted EV-[0-9A-F-]+ — Employees, Mock 2 — for sign-off\./)).toBeVisible()
  // An example must never be mistakable for a real programme's record.
  await expect(page.getByText('An example — nobody here is real')).toBeVisible()
  expect(errors).toEqual([])
})

test('the workspace still makes the pack, and says who there is to submit it to', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Download and submit for sign-off/ })).toBeDisabled()
  await expect(page.getByText(/Accounts are not set up in this copy, so there is nobody to submit it to/)).toBeVisible()

  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  expect(pack).toMatch(/<meta name="dcv-evidence-reference" content="EV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}">/)
  expect(errors).toEqual([])
})
