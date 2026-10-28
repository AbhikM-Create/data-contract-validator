import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Every page error and console error, CSP violations included — a test that
// passes while the page logs errors has not looked.
export function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  return errors
}

export async function download(page, click, dir) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()])
  const path = join(dir, file.suggestedFilename())
  await file.saveAs(path)
  return path
}

export function write(dir, name, content) {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

// The migration workspace's three upload cards are its last three file inputs,
// in the order load, source, target.
export async function uploadAs(page, role, path) {
  const inputs = page.locator('input[type=file]')
  const count = await inputs.count()
  await inputs.nth(count - 3 + ['load', 'source', 'target'].indexOf(role)).setInputFiles(path)
}
