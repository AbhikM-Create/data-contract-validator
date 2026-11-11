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

// The migration workspace's upload cards, by role. Each card's input names its
// role, so crosswalk inputs in the spec builder can't be picked by mistake.
const UPLOAD_TAG = { load: 'load file', source: 'source', target: 'target', baseline: 'baseline', candidate: 'new file' }
export async function uploadAs(page, role, path) {
  await page.locator(`input[data-upload="${UPLOAD_TAG[role] ?? role}"]`).setInputFiles(path)
}
