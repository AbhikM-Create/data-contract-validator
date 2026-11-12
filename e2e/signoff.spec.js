import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { parseCsv } from '../src/lib/parseCsv.js'
import { clickEvidencePack, download, openStep, runReadiness, runReconcile, watchErrors } from './helpers.js'

// v3 §5.3 / §5.4 in the browser: the record is filled in beside the checks,
// printed at the front of the pack, kept across a reload, and every failing
// step and fix list names whose fix it is.

test('the cutover sign-off record is filled in, printed in the pack and kept', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()
  await runReadiness(page)
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  await runReconcile(page)
  await expect(page.getByText(/^Stopped at Mapping\./).first()).toBeVisible()

  // Whose fix: on the failing step and the readiness rejections.
  await expect(page.getByText('Whose fix:').first()).toBeVisible()
  await expect(page.getByText('Functional team (mapping spec and crosswalks)').first()).toBeVisible()

  await openStep(page, 'signoff')
  await page.getByLabel('Legal entity').fill('Invented Pvt Ltd')
  await page.getByLabel('Cutover date').fill('2027-04-01')
  const decision = page.getByLabel(/^decision — .*no entry in the crosswalk/)
  await decision.selectOption('accepted')
  await page.getByLabel(/^reason — .*no entry in the crosswalk/).fill('Grade G4 retired; agreed with HR')
  await page.getByLabel('Prepared by — name').fill('A. Rao')
  await page.getByLabel('Prepared by — date').fill('2027-04-02')

  const pack = readFileSync(await download(page, () => clickEvidencePack(page), dir), 'utf8')
  for (const text of ['Cutover sign-off record', 'Invented Pvt Ltd', '2027-04-01', 'Accepted, with a reason', 'Grade G4 retired; agreed with HR', 'A. Rao', 'Statement of claim', 'not verified identities', 'Whose fix: Functional team']) {
    expect(pack, text).toContain(text)
  }

  await openStep(page, 'before')
  const fixes = parseCsv(readFileSync(await download(page, () => page.getByRole('button', { name: /Download the fix list/ }).click(), dir), 'utf8'))
  expect(fixes.columns.at(-1)).toBe('_owner')
  expect(new Set(fixes.rows.map((r) => r._owner))).toEqual(new Set(['Data owner of the source records']))

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])

  // Typed into the object, so it autosaves with it.
  await page.waitForTimeout(800)
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await openStep(page, 'signoff')
  await expect(page.getByLabel('Legal entity')).toHaveValue('Invented Pvt Ltd')
  await expect(page.getByLabel('Prepared by — name')).toHaveValue('A. Rao')
  expect(errors).toEqual([])
})
