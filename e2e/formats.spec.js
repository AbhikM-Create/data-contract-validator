import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { download, uploadAs, watchErrors, write } from './helpers.js'

// A German SAP extract saved as Windows-1252, against an ISO UTF-8 target. One
// planted difference: a salary of 1200- arrived as -1300.
const latin1 = (text) => Buffer.from([...text].map((c) => c.charCodeAt(0)))
const SAP = 'PERNR;NACHN;BEGDA;ANSAL\n00012345;Müller;01.03.2024;1.234,56\n00012346;Weiß;15.11.2019;98.000,00\n00012347;Ølund;02.01.2020;1200-\n'
const TARGET = 'id,last,hire,pay\n12345,MÜLLER,2024-03-01,1234.56\n12346,WEISS,2019-11-15,98000\n12347,ØLUND,2020-01-02,-1300\n'

test('a Windows-1252, decimal-comma, day-first extract: refused until declared, then read exactly', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  const sap = write(dir, 'sap.csv', latin1(SAP))
  const target = write(dir, 'target.csv', TARGET)
  await page.goto('/#/migrations')

  await uploadAs(page, 'source', sap)
  await expect(page.getByText(/not valid UTF-8 — most likely it was saved as Windows-1252/)).toBeVisible()
  await page.getByLabel('encoding').nth(1).selectOption('windows-1252')
  await expect(page.getByText('3 rows')).toBeVisible()
  await uploadAs(page, 'target', target)
  await expect(page.getByText('target.csv')).toBeVisible()

  const pick = (placeholder, nth, value) => page.locator('select', { has: page.locator(`option:text-is("${placeholder}")`) }).nth(nth).selectOption(value)
  await pick('source column', 0, 'PERNR')
  await pick('target column', 0, 'id')
  await page.getByText(/Ignore leading zeros in numeric keys/).click()
  for (const [i, [a, b]] of [['NACHN', 'last'], ['BEGDA', 'hire'], ['ANSAL', 'pay']].entries()) {
    await page.getByRole('button', { name: '+ Map a field' }).click()
    await pick('source field', i, a)
    await pick('target field', i, b)
  }
  await page.getByText('ignore case').first().click()

  const disagreements = () => page.locator('p', { hasText: /disagrees with/ }).allInnerTexts()
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByText('How far the load got')).toBeVisible()
  expect((await disagreements()).length).toBe(2) // undeclared: every date and both European amounts disagree

  await page.getByLabel('number notation').nth(1).selectOption(',')
  await page.getByLabel('date format').nth(1).selectOption('DD.MM.YYYY')
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.locator('p', { hasText: /disagrees with/ })).toHaveCount(1)
  await expect(page.locator('p', { hasText: /disagrees with/ })).toHaveText(/"pay" disagrees with "ANSAL" on 1 record of 3 compared/)

  const saved = JSON.parse(readFileSync(await download(page, () => page.getByRole('button', { name: /^Download/ }).first().click(), dir), 'utf8'))
  expect(saved.formats.source).toEqual({ encoding: 'windows-1252', decimal: ',', date: 'DD.MM.YYYY' })
  expect(saved.spec.key.normalize).toEqual(['stripLeadingZeros'])

  // The Validate page refuses the same bytes rather than showing "M�ller".
  await page.goto('/#/validate')
  await page.locator('input[type=file]').first().setInputFiles(sap)
  await expect(page.getByText(/not valid UTF-8/)).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain('�')
  expect(errors).toEqual([])
})
