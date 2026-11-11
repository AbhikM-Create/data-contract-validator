import { expect, test } from '@playwright/test'
import { contractToJson } from '../src/lib/contractFile.js'
import { watchErrors, write } from './helpers.js'

// v3 §4 Foundation. Each test names the item it holds and failed on the v2 code.

const RULES = [
  { kind: 'nullRule', column: 'last_name', op: 'notNull' },
  { kind: 'valueSet', column: 'company_code', op: 'in', target: ['DE01', 'DE02'] },
  { kind: 'range', column: 'annual_salary', op: 'between', target: [20000, 400000] },
]

async function openValidateExample(page) {
  await page.goto('/')
  await page.locator('button', { hasText: /example|open|run|try/i }).first().click()
  await expect(page.getByText('How far the file got')).toBeVisible()
}

// F2. Both ways out of a Validate report used to crash the page (the report drew
// with its file already cleared), and the crash took the whole session with it.
test('F2: leaving a Validate report by either button works and loses nothing else', async ({ page }) => {
  const errors = watchErrors(page)

  await openValidateExample(page)
  await page.getByRole('button', { name: 'check another file' }).click()
  await expect(page.getByRole('heading', { name: 'Validate a file' })).toBeVisible()
  await expect(page.getByText('This screen stopped working')).toHaveCount(0)

  await openValidateExample(page)
  await page.getByRole('button', { name: 'start over' }).click()
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Validate a file' })).toBeVisible()
  await expect(page.getByText('This screen stopped working')).toHaveCount(0)
  expect(errors).toEqual([])
})

// F4. Throwing work away asks first, where the click happened; "Keep" keeps it.
test('F4: start over, remove all and New ask before discarding work', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)

  // Validate — start over.
  await openValidateExample(page)
  await page.getByRole('button', { name: 'start over' }).click()
  await expect(page.getByText('Start over? Both files are cleared from this page.')).toBeVisible()
  await page.getByRole('button', { name: 'Keep' }).click()
  await expect(page.getByText('How far the file got')).toBeVisible()

  // Contracts — remove all.
  await page.goto('/#/contracts')
  await page.locator('input[type=file][accept*="json"]').first().setInputFiles(write(dir, 'rules.contract.json', contractToJson({ name: 'Employees (target)', rules: RULES })))
  await expect(page.getByText(/Loaded "Employees \(target\)" — 3 rules/)).toBeVisible()
  await page.getByRole('button', { name: 'remove all' }).click()
  await expect(page.getByText('Remove all 3 rules?')).toBeVisible()
  await page.getByRole('button', { name: 'Keep' }).click()
  await expect(page.getByText('No rules yet')).toHaveCount(0)
  await page.getByRole('button', { name: 'remove all' }).click()
  await page.getByRole('button', { name: 'Remove all', exact: true }).click()
  await expect(page.getByText('No rules yet')).toBeVisible()

  // Migrations — New on an object with work in it.
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByLabel('object name')).toHaveValue('Employees')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByText(/^Start a new object\? “Employees”/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep' }).click()
  await expect(page.getByLabel('object name')).toHaveValue('Employees')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('button', { name: 'Start a new object' }).click()
  await expect(page.getByLabel('object name')).toHaveValue('')
  expect(errors).toEqual([])
})

// F3. Definitions autosave to this browser; a reload restores them with a
// sentence saying so. Files are never stored, so they are read again.
test('F3: a reload restores the migration object, and never the files', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()
  await page.getByLabel('object name').fill('Employees — autosave check')
  await page.waitForTimeout(800) // autosave runs a moment after the last change

  // Nothing from the files is in what was stored.
  const stored = await page.evaluate(() => Object.values(localStorage).join('\n'))
  expect(stored).toContain('Employees — autosave check')
  expect(stored).not.toMatch(/OKAFOR|Okafor|40117/)

  // The object has changes that were never downloaded, so leaving asks; say yes.
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByText(/^Restored your work from /)).toBeVisible()
  await expect(page.getByLabel('object name')).toHaveValue('Employees — autosave check')
  await expect(page.locator('input[data-upload="load file"]').locator('xpath=..').getByText('load_file_mock3.csv')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('F3: closing the tab with changes that were never downloaded asks first', async ({ page }) => {
  await page.goto('/#/migrations')
  await page.getByLabel('object name').fill('Unsaved object')
  const dialog = page.waitForEvent('dialog')
  await page.close({ runBeforeUnload: true })
  expect((await dialog).type()).toBe('beforeunload')
})
