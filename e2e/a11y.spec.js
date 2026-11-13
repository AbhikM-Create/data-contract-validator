import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openStep, runReadiness, runReconcile, watchErrors } from './helpers.js'

// v3 F8. Accessibility basics, held by axe on every screen in the states people
// actually see: empty, mid-work, and with a report on screen. A serious or
// critical violation fails the build.

async function seriousViolations(page) {
  // From the top: a control scrolled half under the sticky bar reads to the checker as an undersized target.
  await page.evaluate(() => window.scrollTo(0, 0))
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  // A contrast failure is reported as its colour pairs, so the failure message
  // names the token to change, not just a CSS path.
  const pairs = (v) => [...new Set(v.nodes.map((n) => {
    const d = n.any?.[0]?.data
    return d?.fgColor ? `${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1 (${d.fontSize})` : n.target.join(' ')
  }))]
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.id === 'color-contrast' ? pairs(v) : v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
}

const SCREENS = [
  ['home', '/#/'],
  ['contracts', '/#/contracts'],
  ['validate (empty)', '/#/validate'],
  ['history', '/#/history'],
  ['sign in', '/#/signin'],
  ['organisation', '/#/organisation'],
  ['migrations (empty)', '/#/migrations'],
]

for (const [name, url] of SCREENS) {
  test(`F8: no serious accessibility violation — ${name}`, async ({ page }) => {
    await page.goto(url)
    await expect(page.locator('main')).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
  })
}

test('F8: no serious accessibility violation — the migration example, checked and reconciled', async ({ page }) => {
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await runReadiness(page)
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  await runReconcile(page)
  await expect(page.getByText(/^Stopped at Mapping\./).first()).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

test('F8: no serious accessibility violation — a Validate report', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Run this example' }).first().click()
  await expect(page.getByText('How far the file got')).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

test('F8: the first Tab reaches a skip link that moves focus to the screen', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to the main content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
  expect(errors).toEqual([])
})

test('F8: progress, notices and errors are announced, and a disabled button says why', async ({ page }) => {
  await page.goto('/#/migrations')
  // Always present, so its first message is read.
  await expect(page.locator('[role=status][aria-live=polite]').first()).toBeAttached()
  await openStep(page, 'before')
  await expect(page.getByText('Needs the target rules and a load file.')).toBeVisible()
  await openStep(page, 'signoff')
  await expect(page.getByText('Run a check first: only results that match the files on screen go in.')).toBeVisible()
  await openStep(page, 'setup')

  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Example opened/ })).toBeVisible()
})
