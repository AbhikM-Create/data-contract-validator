import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

// The first three user states, end to end, with no account:
//   1. a first-time visitor reads what this is and starts the tour;
//   2. the tour walks the real workspace — nothing is simulated;
//   3. signed out, the page says where the work lives and what an account adds.
// Every amount in the example is invented.

test('a first-time visitor: what it is, the guided first run, one step on screen at a time', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')

  // State 1: what it is, in three beats, and that no account is needed.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prove every load before anyone signs it off.')
  for (const beat of ['Before the load', 'After the load', 'Sign-off']) await expect(page.getByText(beat, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('No account needed. Your files stay on this device.')).toBeVisible()
  await expect(page.getByText('This device only')).toBeVisible()

  // State 2: the tour opens the finance example in the real workspace.
  await page.getByRole('button', { name: 'See it work in 2 minutes' }).click()
  const tour = page.getByRole('complementary', { name: 'Your first cutover' })
  await expect(tour).toBeVisible()
  await expect(page.getByLabel('object name')).toHaveValue('Opening trial balance')
  await expect(tour.getByText('1 of 5')).toBeVisible()

  // One step on screen: Set up shows the files, not a verdict or the sign-off form.
  const rail = page.getByRole('navigation', { name: 'Steps' })
  await expect(rail.getByRole('button', { name: /Set up/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('button', { name: 'Check load readiness' })).toHaveCount(0)
  await expect(page.getByLabel('Legal entity')).toHaveCount(0)

  // The tour's own buttons do the real thing.
  await tour.getByRole('button', { name: 'Go to Before the load' }).click()
  await expect(page).toHaveURL(/#\/migrations\/before$/)
  await tour.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  await expect(rail.getByRole('button', { name: /Before the load/ })).toContainText('Not ready')
  await expect(tour.getByText('2 of 5')).toBeVisible()

  await tour.getByRole('button', { name: 'Go to After the load' }).click()
  await tour.getByRole('button', { name: 'Reconcile' }).click()
  await expect(page.getByText(/Stopped at Completeness\./).first()).toBeVisible()
  await expect(rail.getByRole('button', { name: /After the load/ })).toContainText('Stopped at completeness')

  await tour.getByRole('button', { name: 'Go to Sign-off' }).click()
  await expect(page.getByLabel('Legal entity')).toBeVisible()
  await expect(tour.getByText('4 of 5')).toBeVisible()
  // The step is in the link: a reload comes back to it (the files do not, by design).
  await expect(page).toHaveURL(/#\/migrations\/signoff$/)

  // The last item hands over to the person's own files.
  await tour.getByRole('button', { name: 'Start with my files' }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByLabel('object name')).toHaveValue('')
  await expect(rail.getByRole('button', { name: /Set up/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByLabel('pack object to start from')).toBeVisible()

  // From the top: a control scrolled half under the sticky bar reads to the checker as an undersized target.
  await page.evaluate(() => window.scrollTo(0, 0))
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})

test('the tour can be left at any point, and never blocks the workspace', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'See it work in 2 minutes' }).click()
  const tour = page.getByRole('complementary', { name: 'Your first cutover' })
  await expect(tour).toBeVisible()
  // The workspace's own controls work with the tour open.
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: /Before the load/ }).click()
  await page.getByRole('button', { name: 'Check load readiness' }).first().click()
  await expect(page.getByText('FILE TOTAL', { exact: true })).toBeVisible()
  await tour.getByRole('button', { name: 'Exit tour' }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByText('FILE TOTAL', { exact: true })).toBeVisible() // the work stays
})

test('signed out: the page says where the work lives and what an account adds — and promises nothing it does not keep', async ({ page }) => {
  await page.goto('/#/signin')
  await expect(page.getByText('This device only')).toBeVisible()
  for (const title of ['Without an account', 'An account also keeps', 'An account never keeps']) await expect(page.getByText(title, { exact: true })).toBeVisible()
  await expect(page.getByText('Your files, or any record in them')).toBeVisible()
  await expect(page.getByText(/The files an object was checked against: open them again on each device/)).toBeVisible()
  // The trust line, on every screen, word for word.
  await expect(page.getByText(/Files stay on this device\. Nothing is uploaded/)).toBeVisible()
  // Organisations exist now (state 5); signed out, their screen offers only sign-in (organisation.spec.js).
  // Signed out, the workspace offers no account save — and says where the work is.
  await page.goto('/#/migrations')
  await expect(page.getByRole('button', { name: 'Save to account' })).toHaveCount(0)
  await expect(page.getByText(/kept in this browser, and in the file you download\. Sign in to keep it in your account as well/)).toBeVisible()
})
