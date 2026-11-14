import AxeBuilder from '@axe-core/playwright'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { download, watchErrors, write } from './helpers.js'

// The change check, end to end in the real page: open the before and after
// files and the approved list, build the contract from dropdowns, check, and
// read the answer off the staircase. Invented people and amounts.

const BEFORE = 'Emp Code,Name,Basic\nE1,Asha Rao,50000\nE2,Vikram Shah,61000\nE3,Meera Iyer,47000\n'
const AFTER = 'Emp Code,Name,Basic\nE1,Asha R.,65000\nE2,Vikram Shah,64000\nE3,Meera Iyer,47000\n'
const APPROVED = 'Emp Code\nE1\n'

let dir
test.beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'dcv-e2e-change-')) })
test.afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function openFiles(page) {
  await page.goto('/#/change')
  await page.locator('input[data-upload="before"]').setInputFiles(write(dir, 'before.csv', BEFORE))
  await page.locator('input[data-upload="after"]').setInputFiles(write(dir, 'after.csv', AFTER))
  await page.locator('input[data-upload="approved"]').setInputFiles(write(dir, 'approved.csv', APPROVED))
  await expect(page.getByLabel('Key column 1')).toBeVisible()
}

async function salaryRevision(page) {
  await page.getByLabel('Contract name').fill('Salary revision')
  await page.getByLabel('Key column 1').selectOption('Emp Code')
  await page.getByRole('button', { name: '+ Allow a column to change' }).click()
  await page.getByLabel('Changing column 1').selectOption('Basic')
  await page.getByLabel('What may happen to Basic').selectOption('bounded')
  await page.getByLabel('Direction Basic may move').selectOption('up')
  await page.getByLabel('Most Basic may change, in percent').fill('20')
  await page.getByText('only for records on the approved list').click()
}

test('a salary revision that broke its contract is caught at each step, with whose fix', async ({ page }) => {
  const errors = watchErrors(page)
  await openFiles(page)
  // Nothing named yet: the contract still has no key, and says so.
  await expect(page.getByText(/names no key/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check the change' })).toBeDisabled()
  await expect(page.getByText('Every column not listed here must stay exactly as it was.')).toBeVisible()

  await salaryRevision(page)
  await page.getByRole('button', { name: 'Check the change' }).click()

  await expect(page.getByText('NOT ALLOWED', { exact: true })).toBeVisible()
  await expect(page.getByText('How far the change got')).toBeVisible()
  await expect(page.getByText(/"Name" changed in 1 record; the contract says it must stay the same/)).toBeVisible()
  await expect(page.getByText(/"Basic" changed in 1 record that is not on the approved list/)).toBeVisible()
  await expect(page.getByText(/changed by 30%, above the allowed 20%/)).toBeVisible()
  await expect(page.getByText('Whose fix:').first()).toBeVisible()
  expect(errors).toEqual([])

  // A change to the contract makes the answer out of date until it is run again.
  await page.getByLabel('Most Basic may change, in percent').fill('35')
  await expect(page.getByText(/Out of date/).first()).toBeVisible()

  // No serious accessibility violation with a report on screen.
  await page.evaluate(() => window.scrollTo(0, 0))
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
})

test('without the approved list a contract that needs it is not confirmed — never allowed', async ({ page }) => {
  await openFiles(page)
  await salaryRevision(page)
  await page.locator('input[data-upload="approved"]').locator('xpath=..').getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Check the change' }).click()
  await expect(page.getByText(/approvals could not be checked/)).toBeVisible()
})

test('the contract saves as a file holding no record value, and opens again', async ({ page }) => {
  await openFiles(page)
  await salaryRevision(page)
  const saved = await download(page, () => page.getByRole('button', { name: 'Save the contract' }).click(), dir)
  const text = readFileSync(saved, 'utf8')
  expect(text).toMatch(/"maxPercent": 20/)
  expect(text).not.toMatch(/Asha|Vikram|65000|61000|E1/)

  await page.getByRole('button', { name: 'New change check' }).click()
  await page.locator('input[aria-label="Open a change contract file"]').setInputFiles(saved)
  await expect(page.getByText(/Opened the contract from/)).toBeVisible()
  await openFilesKeep(page)
  await expect(page.getByLabel('Contract name')).toHaveValue('Salary revision')
  await expect(page.getByLabel('Most Basic may change, in percent')).toHaveValue('20')
})

async function openFilesKeep(page) {
  await page.locator('input[data-upload="before"]').setInputFiles(write(dir, 'before.csv', BEFORE))
  await page.locator('input[data-upload="after"]').setInputFiles(write(dir, 'after.csv', AFTER))
  await expect(page.getByLabel('Key column 1')).toBeVisible()
}

test('the change record: custody as typed, self-checked when the mover wrote the contract, and only for a current result', async ({ page }) => {
  const errors = watchErrors(page)
  await openFiles(page)
  await salaryRevision(page)
  await page.getByRole('button', { name: 'Check the change' }).click()
  await expect(page.getByText('NOT ALLOWED', { exact: true })).toBeVisible()

  // No custody stated yet: a draft.
  await expect(page.getByRole('button', { name: 'Download the change record (draft)' })).toBeVisible()
  await page.getByPlaceholder('the payroll bureau, the AI run, the vendor').fill('Payroll bureau')
  await page.getByLabel('Contract written by', { exact: true }).selectOption('mover')
  await expect(page.getByText(/Self-checked\./).first()).toBeVisible()
  for (const side of ['Before', 'After']) {
    await page.getByLabel(`${side} file exported by`, { exact: true }).selectOption('business')
    await page.getByLabel(`${side} file exported by — date`).fill('2026-11-12')
  }
  const saved = await download(page, () => page.getByRole('button', { name: 'Download the change record', exact: true }).click(), dir)
  const html = readFileSync(saved, 'utf8')
  expect(html).toMatch(/<strong>Self-checked\.<\/strong>/)
  expect(html).not.toMatch(/DRAFT/)
  expect(html).toMatch(/[0-9a-f]{64}/) // the files by the SHA-256 of their bytes
  expect(html).not.toMatch(/<script/i)

  // A changed contract makes the result out of date: no record until it runs again.
  await page.getByLabel('Most Basic may change, in percent').fill('35')
  await expect(page.getByRole('button', { name: 'Download the change record', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})
