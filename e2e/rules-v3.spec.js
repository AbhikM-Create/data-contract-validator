import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { contractToJson } from '../src/lib/contractFile.js'
import { clickEvidencePack, download, runReadiness, uploadAs, watchErrors, write } from './helpers.js'

// v3 §5.1 in the browser: reference, unique and aggregate rules on the example
// load file. The reference file is opened beside the load file, never stored,
// and attested in the evidence pack by its SHA-256.

const sha = (text) => createHash('sha256').update(text).digest('hex')
const COMPANIES = 'code,name\nDE01,Germany\nDE02,Germany (second)\nUS01,United States\n'

test('reference, unique and aggregate rules run on the load file, with the reference file opened beside it', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()

  const contract = write(dir, 'v3.contract.json', contractToJson({
    name: 'Employees (target, v3)',
    rules: [
      { kind: 'reference', column: 'company_code', op: 'in', target: { file: 'companies', column: 'code' } },
      { kind: 'unique', column: 'employee_id', op: 'unique' },
      { kind: 'aggregate', column: 'annual_salary', fn: 'sum', op: '>', target: '0', groupBy: 'company_code' },
    ],
  }))
  await page.locator('input[type=file][accept*="json"]').nth(1).setInputFiles(contract)
  await expect(page.getByText(/Loaded 3 rules from "Employees \(target, v3\)"/)).toBeVisible()

  // The rules name a reference file, so its card is there — and without it the
  // file is not called ready.
  await expect(page.getByText('Reference file “companies”')).toBeVisible()
  await runReadiness(page)
  await expect(page.getByText('NOT CONFIRMED', { exact: true }).first()).toBeVisible() // UNVERIFIED, in the report's words
  await expect(page.getByText(/reference file "companies" was not provided/)).toBeVisible()

  await uploadAs(page, 'reference: companies', write(dir, 'companies.csv', COMPANIES))
  await runReadiness(page)
  await expect(page.getByText('"company_code" must exist in "code" of the reference file "companies"')).toBeVisible()
  await expect(page.getByText(/The rules, the key or the file have changed/)).toHaveCount(0)
  await expect(page.getByText('FILE TOTAL', { exact: true })).toBeVisible()

  const pack = readFileSync(await download(page, () => clickEvidencePack(page), dir), 'utf8')
  expect(pack).toContain(sha(COMPANIES))
  expect(pack).toContain('Reference file “companies”')
  expect(pack).toContain('--reference companies=companies.csv')
  expect(errors).toEqual([])
})

test('the rule builder authors a GSTIN identifier rule from dropdowns', async ({ page }) => {
  const dir = test.info().outputPath()
  await page.goto('/#/contracts')
  await page.locator('input[data-upload="draft source"]').setInputFiles(write(dir, 'vendors.csv', 'vendor,gstin\nA,27AAPFU0939F1ZV\nB,27AAPFU0939F1ZO\n'))
  await page.getByRole('button', { name: /write a rule|add a rule|new rule/i }).first().click()
  await page.getByLabel('rule column').selectOption('gstin')
  await page.getByLabel('rule kind').selectOption('identifier')
  await page.getByLabel('identifier').selectOption('gstin')
  await expect(page.getByText('"gstin" must hold a valid GSTIN, check character included')).toBeVisible()
})
