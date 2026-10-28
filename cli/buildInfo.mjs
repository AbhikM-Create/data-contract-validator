// Which build produced a result: the package version, and the git commit when
// it can be known — from DCV_COMMIT (set by the container build), else from the
// repository the CLI is running out of. Never guessed: unknown is reported as
// unknown.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from '../src/lib/version.js'

let cached = null

export function buildInfo() {
  if (cached) return cached
  let commit = process.env.DCV_COMMIT || null
  if (!commit) {
    try {
      const root = join(dirname(fileURLToPath(import.meta.url)), '..')
      commit = execFileSync('git', ['-C', root, 'rev-parse', '--short=12', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
    } catch {
      commit = null
    }
  }
  cached = { name: 'data-contract-validator', version: VERSION, commit }
  return cached
}

export function describeBuild() {
  const { version, commit } = buildInfo()
  return `data-contract-validator ${version}${commit ? ` (${commit})` : ''}`
}
