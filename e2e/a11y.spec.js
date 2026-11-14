import { writeFileSync } from 'node:fs'
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
  ['change checks (empty)', '/#/change'],
]

// Every screen and both reports, in each theme: light (Direction C) and dark
// (Direction A, "Blueprint"), which follows the system setting by default.
for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme })

    for (const [name, url] of SCREENS) {
      test(`F8: no serious accessibility violation — ${name}, ${scheme}`, async ({ page }) => {
        await page.goto(url)
        await expect(page.locator('main')).toBeVisible()
        expect(await seriousViolations(page)).toEqual([])
      })
    }

    test(`F8: no serious accessibility violation — the migration example, checked and reconciled, ${scheme}`, async ({ page }) => {
      await page.goto('/#/migrations')
      await page.getByRole('button', { name: 'Try the example migration' }).click()
      await runReadiness(page)
      await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
      await runReconcile(page)
      await expect(page.getByText(/^Stopped at Mapping\./).first()).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })

    test(`F8: no serious accessibility violation — a change check report, ${scheme}`, async ({ page }, info) => {
      const file = (name, text) => { const p = info.outputPath(name); writeFileSync(p, text); return p }
      await page.goto('/#/change')
      await page.locator('input[data-upload="before"]').setInputFiles(file('before.csv', 'Emp Code,Name,Basic\nE1,Asha Rao,50000\nE2,Vikram Shah,61000\n'))
      await page.locator('input[data-upload="after"]').setInputFiles(file('after.csv', 'Emp Code,Name,Basic\nE1,Asha R.,50000\nE2,Vikram Shah,61000\n'))
      await page.getByLabel('Key column 1').selectOption('Emp Code')
      await page.getByRole('button', { name: 'Check the change' }).click()
      await expect(page.getByText('How far the change got')).toBeVisible()
      // The step that caught the change has its own edge in both themes. A
      // colour the theme cannot read — a hex suffix on a variable, `${tone}88`
      // — is invalid, and the edge falls back to the text colour.
      const look = (text) => page.locator('section', { hasText: text }).first().evaluate((el) => ({ edge: getComputedStyle(el).borderTopColor, text: getComputedStyle(el).color }))
      const lead = await look('Did anything change that the contract does not allow')
      expect(lead.edge).not.toBe(lead.text)
      expect(lead.edge).not.toBe((await look('Is every record identifiable')).edge)
      expect(await seriousViolations(page)).toEqual([])
    })

    test(`F8: no serious accessibility violation — a Validate report, ${scheme}`, async ({ page }) => {
      await page.goto('/')
      await page.getByRole('button', { name: 'Run this example' }).first().click()
      await expect(page.getByText('How far the file got')).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  })
}

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
