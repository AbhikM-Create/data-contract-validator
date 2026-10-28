import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { download, watchErrors } from './helpers.js'

// Without an account the sign-off screen says what it needs, and the
// workspace still makes the pack — submitting is offered only when it can work.
test('sign-off without an account: a sentence, not a dead end, and the pack still works', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/signoff')
  await expect(page.getByRole('heading', { name: 'Sign-off', exact: true })).toBeVisible()
  await expect(page.getByText('Sign-off needs an account')).toBeVisible()
  await expect(page.getByText(/print its sign-off sheet and sign it on paper/)).toBeVisible()

  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  const submit = page.getByRole('button', { name: /^Download and submit for sign-off/ })
  await expect(submit).toBeDisabled()
  await expect(page.getByText('Sign in to submit it for sign-off in your organisation.')).toBeVisible()

  // The pack declares its reference, so a data owner's screen can match it.
  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  expect(pack).toMatch(/<meta name="dcv-evidence-reference" content="EV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}">/)
  expect(errors).toEqual([])
})
