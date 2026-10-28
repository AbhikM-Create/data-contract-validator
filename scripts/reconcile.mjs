// Migration reconciliation from the command line.
//
//   node scripts/reconcile.mjs <spec.json> <source.csv> <target.csv>
//        [--json] [--evidence pack.html] [--tmp dir] [--partitions n]
//
// <spec.json> may be a reconciliation spec or a migration object saved from the
// workspace (*.migration.json), whose spec is used.
//
// --evidence writes the evidence pack for this run: the verdict, the records
// behind it, SHA-256 fingerprints of both files and of the spec, and a
// sign-off block. It quotes records, so it is written to local disk only.
//
// Exit codes are the contract with a pipeline: 0 reconciled, 1 a step failed,
// 2 the spec or a file could not be used. --json prints the full report for a
// downstream job; without it, a plain-language summary for a person.
//
// Files of any size: both are streamed, and records are split by a hash of
// their key into partitions on local disk and joined one partition at a time,
// so memory depends on the partition, not the file (scripts/lib/). Partitions
// go to the system temp directory, or --tmp, and are deleted when the run
// ends. --partitions forces a count; normally it is chosen from file size.

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createEvidencePack } from '../src/lib/evidencePack.js'
import { isMigrationObjectFile, readMigrationObject, runnableSpec } from '../src/lib/migrationObject.js'
import { fileInfo } from './lib/fileInfo.mjs'
import { reconcileFiles } from './lib/reconcileFiles.mjs'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  args.splice(i, 2)
  return value
}
const command = `node scripts/reconcile.mjs ${process.argv.slice(2).join(' ')}`
const tmpDir = option('--tmp')
const evidencePath = option('--evidence')
const partitionsArg = option('--partitions')
const asJson = args.includes('--json')
if (asJson) args.splice(args.indexOf('--json'), 1)
const [specPath, sourcePath, targetPath] = args

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (!specPath || !sourcePath || !targetPath || args.length > 3) {
  fail('Usage: node scripts/reconcile.mjs <spec.json> <source.csv> <target.csv> [--json] [--evidence pack.html] [--tmp dir] [--partitions n]')
}
const partitions = partitionsArg === undefined ? undefined : Number(partitionsArg)
if (partitions !== undefined && !(Number.isInteger(partitions) && partitions >= 1 && partitions <= 256)) {
  fail('--partitions must be a whole number from 1 to 256')
}

let spec
let object = null
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'))
} catch (error) {
  fail(`${specPath}: could not read the spec as JSON — ${error.message}`)
}
// A migration object saved from the workspace carries its spec; the pipeline
// and the screen then run from the same file.
if (isMigrationObjectFile(spec)) {
  const opened = readMigrationObject(spec)
  if (opened.error) fail(`${specPath}: ${opened.error}`)
  object = opened.object
  spec = runnableSpec(opened.object)
}

// An evidence pack quotes more records per finding than a terminal summary.
const outcome = await reconcileFiles(spec, sourcePath, targetPath, { tmpDir, partitions, exampleLimit: evidencePath ? 25 : undefined })
if (outcome.error) fail(outcome.error)
const report = outcome.report
const seconds = outcome.seconds.toFixed(2)

let evidenceNote = null
if (evidencePath && report.status !== 'INVALID') {
  const pack = await createEvidencePack({
    object: object ?? { name: spec.name ?? basename(specPath), contract: { rules: [] }, spec, runs: [] },
    reconciliation: {
      report,
      source: await fileInfo(sourcePath, report.counts.sourceRows),
      target: await fileInfo(targetPath, report.counts.targetRows),
    },
    generatedBy: 'the command line',
    reproduce: command,
  })
  writeFileSync(evidencePath, pack.html, { mode: 0o600 })
  evidenceNote = `Evidence pack ${pack.reference} written to ${evidencePath}`
}

if (asJson) {
  console.log(JSON.stringify({ ...report, files: { source: basename(sourcePath), target: basename(targetPath) }, partitions: outcome.partitions }, null, 2))
} else {
  const mark = { PASS: 'PASS   ', FAIL: 'FAIL   ', SKIPPED: 'SKIPPED' }
  console.log(`\n${report.name ?? 'Reconciliation'}: ${basename(sourcePath)} → ${basename(targetPath)}\n`)
  if (report.status === 'INVALID') {
    for (const issue of report.issues) console.log(`  • ${issue}`)
  } else {
    report.steps.forEach((s, i) => {
      console.log(`${'  '.repeat(i)}${i + 1} ${s.label.padEnd(13)} ${mark[s.status]}${s.reason ? `  ${s.reason}` : ''}`)
      for (const f of s.findings) {
        console.log(`${'  '.repeat(i)}    • ${f.message}`)
        for (const ex of f.examples.slice(0, 5)) {
          const label = ex.key ?? ex.value
          console.log(`${'  '.repeat(i)}        ${label}${ex.detail ? ` — ${ex.detail}` : ''}`)
        }
      }
    })
    const c = report.counts
    console.log(`\n  ${c.sourceRows.toLocaleString('en-US')} source rows (${c.sourceOutOfScope.toLocaleString('en-US')} out of scope), ${c.targetRows.toLocaleString('en-US')} target rows, ${seconds}s${outcome.partitions > 1 ? `, ${outcome.partitions} partitions` : ''}`)
  }
  if (evidenceNote) console.log(`  ${evidenceNote}`)
  console.log(`\n${report.headline}\n`)
}

process.exit(report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2)
