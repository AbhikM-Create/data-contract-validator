// Which build produced a result: the package version, and the git commit when
// it can be known. Never guessed: unknown is reported as unknown.
//
// In order:
//   1. DCV_COMMIT — set by the container build;
//   2. cli/commit.json — written by the release workflow just before
//      `npm publish`, so a copy installed from npm knows what it was built from;
//   3. git — ONLY when this package is itself the checkout (its own .git).
//      Installed into someone's project, `git rev-parse` from here would answer
//      with THEIR repository's commit, and every sign-off record would name a
//      commit of the wrong codebase.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from '../src/lib/version.js'

let cached = null

const COMMIT = /^[0-9a-f]{7,40}$/

// commitFor(root, env) -> the commit of the package at `root`, or null.
export function commitFor(root, env = process.env) {
  if (env.DCV_COMMIT) return env.DCV_COMMIT
  try {
    const stamped = JSON.parse(readFileSync(join(root, 'cli', 'commit.json'), 'utf8')).commit
    if (typeof stamped === 'string' && COMMIT.test(stamped)) return stamped.slice(0, 12)
  } catch {
    // no stamp: not installed from a release
  }
  if (!existsSync(join(root, '.git'))) return null
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--short=12', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

export function buildInfo() {
  if (cached) return cached
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  cached = { name: 'data-contract-validator', version: VERSION, commit: commitFor(root) }
  return cached
}

export function describeBuild() {
  const { version, commit } = buildInfo()
  return `data-contract-validator ${version}${commit ? ` (${commit})` : ''}`
}
