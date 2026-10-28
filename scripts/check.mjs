// Load readiness from the command line: will the target accept this load file?
//
//   node scripts/check.mjs <contract.json> <load.csv> [--key col[,col]] [--json] [--rejects out.csv]
//
// Exit codes are the contract with a pipeline: 0 ready, 1 records would be
// rejected (or the file lacks a column the contract requires), 2 the check
// could not be completed — an unreadable contract or file, a key the file
// lacks, or a rule that could not be checked. A pipeline should stop on 2 as
// firmly as on 1: "could not confirm" is not "ready".
//
// --rejects writes every flagged record — the load file's own columns plus a
// _readiness and a _reasons column — as the fix list for the data owners. It
// is written to local disk only, like everything else this tool touches.
//
// Reads each file whole; streaming for multi-million-row files is the next
// increment (docs/v2-spec.md).

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import Papa from 'papaparse'
import { parseContractFile } from '../src/lib/contractFile.js'
import { parseCsv } from '../src/lib/parseCsv.js'
import { READINESS, checkReadiness } from '../src/lib/readiness.js'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  args.splice(i, 2)
  return value
}
const asJson = args.includes('--json')
if (asJson) args.splice(args.indexOf('--json'), 1)
const keyArg = flag('--key')
const rejectsPath = flag('--rejects')
const [contractPath, loadPath] = args

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (!contractPath || !loadPath || args.length > 2) {
  fail('Usage: node scripts/check.mjs <contract.json> <load.csv> [--key col[,col]] [--json] [--rejects out.csv]')
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    return fail(`${path}: ${error.message}`)
  }
}

const contract = parseContractFile(readText(contractPath))
if (contract.error) fail(`${contractPath}: ${contract.error}`)

const load = parseCsv(readText(loadPath))
if (load.errors.length > 0) fail(`${loadPath}: ${load.errors[0]}`)

const started = Date.now()
const report = checkReadiness(contract, load.rows, {
  columns: load.columns,
  key: keyArg ? keyArg.split(',') : [],
})
const seconds = ((Date.now() - started) / 1000).toFixed(2)

if (rejectsPath && report.flagged.length > 0) {
  const rows = report.flagged.map((f) => ({
    ...Object.fromEntries(load.columns.map((column) => [column, load.rows[f.row - 1][column]])),
    _row: f.row,
    _readiness: f.severity === 'reject' ? 'REJECT' : 'WARN',
    _reasons: f.reasons.join('; '),
  }))
  writeFileSync(rejectsPath, `${Papa.unparse(rows)}\n`)
}

if (asJson) {
  console.log(JSON.stringify({ ...report, file: basename(loadPath) }, null, 2))
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
      console.log(report.flagged.length > 0
        ? `  Flagged records written to ${rejectsPath}`
        : `  No flagged records, so ${rejectsPath} was not written.`)
    }
  }
  console.log(`\n${report.headline}\n`)
}

process.exit(report.status === READINESS.READY ? 0 : report.status === READINESS.NOT_READY ? 1 : 2)
