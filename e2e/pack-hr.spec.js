import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { download, uploadAs, watchErrors, write } from './helpers.js'

// v3 §6.2 in the browser: the HR pack's employee master asks for the cutover
// date before it can start, judges joining dates by it, counts headcount by
// location, and masks the identifiers it tagged in the evidence pack. Every
// person, PAN, UAN and account here is invented.

const HEADER = 'Employee Number,First Name,Last Name,Date of Birth,Date of Joining,Work Location Name,Department,Designation,PAN Number,UAN Number,PF Account Number,Bank Name,Account Number,IFSC Code'

test('the HR pack’s employee master: ask for the cutover date, check, reconcile headcount, mask identifiers', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')

  await page.getByLabel('pack object to start from').selectOption('hr-payroll-zoho-payroll/employee-master')
  // No cutover date, no start: the pack never guesses one.
  await expect(page.getByRole('button', { name: 'Start “Employee master”' })).toHaveCount(0)
  await page.getByLabel('Cutover date — the first day Zoho Payroll pays for').fill('2026-10-01')
  await page.getByRole('button', { name: 'Start “Employee master”' }).click()
  await expect(page.getByLabel('object name')).toHaveValue('Employee master')
  await expect(page.getByText(/DRAFT — this pack has not yet run on real exports/)).toBeVisible()

  // One employee joined after the cutover; the work locations file is opened beside the load file.
  await uploadAs(page, 'load', write(dir, 'employees.csv', [
    HEADER,
    'E001,Asha,Kulkarni,14/02/1990,01/04/2019,Pune,Finance,Analyst,ABCPK1234F,100200300400,,HDFC Bank,50100012345678,HDFC0001234',
    'E002,Ravi,Shetty,30/11/1987,15/10/2026,Bengaluru,Sales,Manager,AQWPS5678K,,,,,',
    '',
  ].join('\n')))
  await uploadAs(page, 'reference: locations', write(dir, 'locations.csv', 'Work Location Name\nPune\nBengaluru\n'))
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText(/"Date of Joining" must be on or before 2026-10-01|"Date of Joining" must be .*2026-10-01/).first()).toBeVisible()

  // The legacy list against Zoho's: one employee loaded under the wrong location.
  await uploadAs(page, 'source', write(dir, 'legacy.csv', 'Emp Code,Employee Name,Date of Joining,Location,PAN,UAN,Bank A/c No,IFSC\nE001,Asha Kulkarni,01/04/2019,Pune,ABCPK1234F,100200300400,50100012345678,HDFC0001234\nE002,Ravi Shetty,15/06/2021,Bengaluru,AQWPS5678K,,,\n'))
  await uploadAs(page, 'target', write(dir, 'zoho.csv', 'Employee Number,First Name,Last Name,Date of Joining,Work Location Name,PAN Number,UAN Number,Account Number,IFSC Code\nE001,Asha,Kulkarni,01/04/2019,Pune,ABCPK1234F,100200300400,50100012345678,HDFC0001234\nE002,Ravi,Shetty,15/06/2021,Pune,AQWPS5867K,,,\n'))
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
  await expect(page.getByText('The number of records does not tie in 2 groups of 2 by "Work Location Name".').first()).toBeVisible()

  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  expect(pack).toContain('pack hr-payroll-zoho-payroll v0.1.0 — DRAFT: not yet run on real exports')
  expect(pack).toContain('Masked in this pack:')
  expect(pack).not.toContain('AQWPS5867K') // the PAN changed in flight, tagged as an identifier
  expect(pack).not.toContain('AQWPS5678K')

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})
