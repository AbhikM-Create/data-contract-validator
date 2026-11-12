import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { download, openMapping, openStep, runReconcile, watchErrors, write } from './helpers.js'

// final-spec C7 in the browser: a crosswalk says what it is; a data file offered
// as a crosswalk is refused; "Share definitions" writes a copy with no file
// names, no undeclared crosswalk and no sign-off. Every person is invented.

test('share definitions: declare a code list, refuse a data file as a crosswalk, and leave the client out', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByLabel('object name')).not.toHaveValue('')
  await page.getByLabel('object name').fill('Acme Retail employees')
  await runReconcile(page)
  await expect(page.getByText(/Stopped at Mapping/).first()).toBeVisible()

  await openStep(page, 'setup')
  await openMapping(page)
  const grade = page.getByLabel('what the crosswalk for TRFGR to grade holds')
  await expect(grade).toHaveValue('') // nobody has said what it is yet

  // A data file (three columns) is not a crosswalk.
  await grade.locator('xpath=..').locator('input[type=file]').setInputFiles(write(dir, 'people.csv', 'id,name,grade\n1,Asha Kulkarni,G7\n'))
  await expect(page.getByText('Couldn’t use people.csv as a crosswalk.')).toBeVisible()
  await expect(page.getByText(/has 3 columns, so it looks like a data file/)).toBeVisible()

  // Undeclared, the grade crosswalk stays behind.
  const first = JSON.parse(readFileSync(await download(page, () => page.getByRole('button', { name: 'Share definitions' }).click(), dir), 'utf8'))
  await expect(page.getByText(/"TRFGR" → "grade" \(\d+ entries\) was not declared a code list/)).toBeVisible()
  expect(first.spec.mapping.find((f) => f.source === 'TRFGR').map).toBeUndefined()

  // Declared a code list, it goes; declaring it leaves the result current.
  await grade.selectOption('codeList')
  await expect(page.getByText(/The spec or the files have changed|have changed since this ran/)).toHaveCount(0)
  const text = readFileSync(await download(page, () => page.getByRole('button', { name: 'Share definitions' }).click(), dir), 'utf8')
  const shared = JSON.parse(text)
  expect(shared.spec.mapping.find((f) => f.source === 'TRFGR')).toMatchObject({ mapKind: 'codeList' })
  expect(Object.keys(shared.spec.mapping.find((f) => f.source === 'TRFGR').map).length).toBeGreaterThan(2)
  expect(shared.name).toBe('Shared definitions')
  expect(shared.runs.length).toBeGreaterThan(0)
  expect(text).not.toMatch(/Acme|legacy_hr_extract|target_after_mock|load_file/)
  await expect(page.getByText('The sign-off record, the owners’ names, the object’s name, its wave and every file name.')).toBeVisible()
  expect(errors).toEqual([])
})
