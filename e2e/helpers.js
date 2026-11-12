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
  const input = page.locator(`input[data-upload="${UPLOAD_TAG[role] ?? role}"]`)
  // The migration workspace shows one step at a time; files are opened on Set up.
  if ((await input.count()) === 0) await openStep(page, 'setup')
  await input.setInputFiles(path)
}

// The workspace's steps: setup, before, after, signoff. The step is in the link.
export async function openStep(page, step) {
  await page.evaluate((hash) => { window.location.hash = hash }, step === 'setup' ? '/migrations' : `/migrations/${step}`)
  await page.locator(`.step-rail button[aria-current="step"]`).waitFor()
}

export async function runReadiness(page) {
  await openStep(page, 'before')
  await page.getByRole('button', { name: 'Check load readiness' }).click()
}

export async function runReconcile(page) {
  await openStep(page, 'after')
  await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
}

// Click "Download the evidence pack" on the Sign-off step.
export async function clickEvidencePack(page) {
  await openStep(page, 'signoff')
  await page.getByRole('button', { name: 'Download the evidence pack' }).click()
}

// The mapping is a one-line summary on Set up when it is complete; this opens
// the builder if it is folded.
export async function openMapping(page) {
  await openStep(page, 'setup')
  const edit = page.getByRole('button', { name: 'Edit mapping' })
  if (await edit.count()) await edit.click()
}
