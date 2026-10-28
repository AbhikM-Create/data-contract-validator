// Load readiness from the command line: will the target accept this load file?
//
//   node scripts/check.mjs <contract.json> <load.csv>
//        [--key col[,col]] [--json] [--rejects out.csv] [--tmp dir] [--partitions n]
//
// <contract.json> may be a contract or a migration object saved from the
// workspace (*.migration.json): its contract is used, and its spec's target
// key unless --key is given.
//
// Exit codes are the contract with a pipeline: 0 ready, 1 records would be
// rejected (or the file lacks a column the contract requires), 2 the check
// could not be completed — an unreadable contract or file, a key the file
// lacks, or a rule that could not be checked. A pipeline should stop on 2 as
// firmly as on 1: "could not confirm" is not "ready".
//
// --rejects writes every flagged record — the load file's own columns plus
// _row, _readiness and _reasons — as the fix list for the data owners. It is
// written to local disk only, like everything else this tool touches.
//
// Files of any size: the file is streamed, and flagged records are written as
// they are found. With --key, a first pass partitions keys on local disk to
// find duplicates (--tmp to choose where; deleted when the run ends).

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseContractFile } from '../src/lib/contractFile.js'
import { isMigrationObjectFile, readMigrationObject } from '../src/lib/migrationObject.js'
import { READINESS } from '../src/lib/readiness.js'
import { checkReadinessFile } from './lib/readinessFile.mjs'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  args.splice(i, 2)
  return value
}
const keyArg = option('--key')
const rejectsPath = option('--rejects')
const tmpDir = option('--tmp')
const partitionsArg = option('--partitions')
const asJson = args.includes('--json')
if (asJson) args.splice(args.indexOf('--json'), 1)
const [contractPath, loadPath] = args

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (!contractPath || !loadPath || args.length > 2) {
  fail('Usage: node scripts/check.mjs <contract.json> <load.csv> [--key col[,col]] [--json] [--rejects out.csv] [--tmp dir] [--partitions n]')
}
const partitions = partitionsArg === undefined ? undefined : Number(partitionsArg)
if (partitions !== undefined && !(Number.isInteger(partitions) && partitions >= 1 && partitions <= 256)) {
  fail('--partitions must be a whole number from 1 to 256')
}

let contractText
try {
  contractText = readFileSync(contractPath, 'utf8')
} catch (error) {
  fail(`${contractPath}: ${error.message}`)
}
// A migration object saved from the workspace carries its contract, and its
// spec names the target key, used when --key is not given.
let contract
let defaultKey = []
let parsedJson = null
try {
  parsedJson = JSON.parse(contractText)
} catch {
  // not JSON: parseContractFile below says so in its own words
}
if (isMigrationObjectFile(parsedJson)) {
  const opened = readMigrationObject(parsedJson)
  if (opened.error) fail(`${contractPath}: ${opened.error}`)
  contract = { name: opened.object.contract.name || opened.object.name, rules: opened.object.contract.rules, skipped: opened.skipped }
  defaultKey = opened.object.spec.key.target.filter(Boolean)
} else {
  contract = parseContractFile(contractText)
  if (contract.error) fail(`${contractPath}: ${contract.error}`)
}

const outcome = await checkReadinessFile(contract, loadPath, {
  key: keyArg ? keyArg.split(',').map((c) => c.trim()).filter(Boolean) : defaultKey,
  rejectsPath,
  tmpDir,
  partitions,
})
if (outcome.error) fail(outcome.error)
const report = outcome.report
const seconds = outcome.seconds.toFixed(2)

if (asJson) {
  // flagged is empty when streaming — the records went to --rejects instead.
  const { flagged: _flagged, ...summary } = report
  console.log(JSON.stringify({ ...summary, file: basename(loadPath) }, null, 2))
} else {
  const tone = { FAIL: 'FAIL     ', PASS: 'PASS     ', UNCHECKED: 'UNCHECKED' }
  console.log(`\n${report.name ?? 'Contract'}: ${basename(loadPath)}\n`)
  if (report.status === READINESS.INVALID) {
    for (const issue of report.issues) console.log(`  • ${issue}`)
  } else {
    for (const c of report.checks) {
      const sev = c.severity === 'warn' ? 'warn  ' : 'reject'
      const count = c.status === 'FAIL' ? `  ${c.failing.toLocaleString('en-US')} of ${c.applicable.toLocaleString('en-US')}` : ''
      console.log(`  ${tone[c.status]} ${sev}  ${c.description}${count}`)
      if (c.reason) console.log(`                      ${c.reason}`)
      for (const ex of c.examples) {
        console.log(`                      ${ex.record}${ex.record.startsWith('row ') ? '' : ` (row ${ex.row})`} — ${ex.value}`)
      }
    }
    const c = report.counts
    console.log(`\n  ${c.records.toLocaleString('en-US')} records: ${c.rejected.toLocaleString('en-US')} would be rejected, ${c.warned.toLocaleString('en-US')} would load with a warning, ${c.clean.toLocaleString('en-US')} clean. ${seconds}s`)
    if (contract.skipped.length > 0) {
      console.log(`  ${contract.skipped.length} rule(s) in the contract file could not be read and were NOT checked.`)
    }
    if (rejectsPath) {
      console.log(outcome.rejectsWritten > 0
        ? `  ${outcome.rejectsWritten.toLocaleString('en-US')} flagged records written to ${rejectsPath}`
        : `  No flagged records, so ${rejectsPath} was not written.`)
    }
  }
  console.log(`\n${report.headline}\n`)
}

process.exit(report.status === READINESS.READY ? 0 : report.status === READINESS.NOT_READY ? 1 : 2)
