import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { utils, write } from 'xlsx'
import { parseCsv } from '../src/lib/parseCsv.js'
import { migrationLoadFile } from '../src/samples/migrationSample.js'
import { download, uploadAs, watchErrors } from './helpers.js'

// v3 F7. An Excel workbook is read in the page like a CSV: the Excel and CSV
// versions of the same data give the same report, the sheet and header row are
// chosen from dropdowns, and nothing leaves the browser (the CSP holds).

const LOAD = parseCsv(migrationLoadFile())

// The sample load file as Excel holds it: digits stored as numbers, with an
// optional title row above the header and a notes sheet in front.
function workbookBytes({ titleRow = false, notesFirst = false } = {}) {
  const typed = (v) => (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v) ? Number(v) : v)
  const aoa = [LOAD.columns, ...LOAD.rows.map((row) => LOAD.columns.map((c) => typed(row[c])))]
  const wb = utils.book_new()
  if (notesFirst) utils.book_append_sheet(wb, utils.aoa_to_sheet([['Exported for Mock 3']]), 'Notes')
  utils.book_append_sheet(wb, utils.aoa_to_sheet(titleRow ? [['Load file — Mock 3'], ...aoa] : aoa), 'Employees')
  return Buffer.from(write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

const headline = (page) => page.locator('h3').filter({ hasText: /record/ }).first()
const figures = async (page) => {
  const out = {}
  for (const name of ['Records', 'Would be rejected', 'Load with a warning', 'Clean']) {
    out[name] = await page.getByText(name, { exact: true }).locator('xpath=..').innerText()
  }
  return out
}

test('F7: the Excel and CSV versions of the load file give the same readiness report', async ({ page }) => {
  const dir = test.info().outputPath()
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await page.getByRole('button', { name: 'Try the example migration' }).click()
  await expect(page.getByText(/Example opened/)).toBeVisible()

  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('NOT READY', { exact: true }).first()).toBeVisible()
  const fromCsv = { headline: await headline(page).innerText(), figures: await figures(page) }
  const csvFixes = parseCsv(readFileSync(await download(page, () => page.getByRole('button', { name: /Download the fix list/ }).click(), dir), 'utf8'))

  await uploadAs(page, 'load', { name: 'load_file_mock3.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbookBytes() })
  await expect(page.getByText('sheet “Employees”, header row 1', { exact: false })).toBeVisible()
  // The CSV's report is now stale (different bytes); only a re-check clears it,
  // so what is compared below is the workbook's own report.
  await expect(page.getByText('The rules, the key or the file have changed since this ran')).toBeVisible()
  await page.getByRole('button', { name: 'Check load readiness' }).click()
  await expect(page.getByText('The rules, the key or the file have changed since this ran')).toHaveCount(0)

  expect({ headline: await headline(page).innerText(), figures: await figures(page) }).toEqual(fromCsv)
  const xlsxFixes = parseCsv(readFileSync(await download(page, () => page.getByRole('button', { name: /Download the fix list/ }).click(), dir), 'utf8'))
  expect(xlsxFixes.rows.map((r) => [r.employee_id, r._readiness, r._reasons])).toEqual(csvFixes.rows.map((r) => [r.employee_id, r._readiness, r._reasons]))

  // The pack names the workbook by the SHA-256 of its bytes and the sheet read.
  const pack = readFileSync(await download(page, () => page.getByRole('button', { name: 'Download the evidence pack' }).click(), dir), 'utf8')
  expect(pack).toContain('sheet “Employees”, header row 1')
  expect(errors).toEqual([])
})

test('F7: a title row and a notes sheet are handled by choosing the sheet and header row', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/migrations')
  await uploadAs(page, 'load', { name: 'tally_export.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbookBytes({ titleRow: true, notesFirst: true }) })

  // The first sheet is a note with no data rows: refused with a sentence, and
  // the choice of sheet is right there.
  await expect(page.getByText(/the sheet "Notes" has a header row but no data rows/)).toBeVisible()
  await page.getByLabel('sheet to read — load file').selectOption('Employees')
  // Row 1 is a title: refused, not guessed past.
  await expect(page.getByText(/has values but no name in row 1/)).toBeVisible()
  await page.getByLabel('header row — load file').selectOption('2')
  await expect(page.getByText(/46 rows · 7 columns · sheet “Employees”, header row 2/)).toBeVisible()
  expect(errors).toEqual([])
})
