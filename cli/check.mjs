// dcv check — will the target accept this load file?
//
//   dcv check <contract.json|object.migration.json> <load.csv> [--key col[,col]]
//       [--json] [--junit out.xml] [--rejects fixes.csv] [--evidence pack.html]
//       [--tmp dir] [--partitions n]
//
// Exit 0 ready, 1 records would be rejected (or the file lacks a column the
// contract requires), 2 could not be completed — including a rule that could
// not be checked: "could not confirm" is not "ready".

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseContractFile } from '../src/lib/contractFile.js'
import { createEvidencePack } from '../src/lib/evidencePack.js'
import { isMigrationObjectFile, readMigrationObject, runnableContract, summariseReadiness } from '../src/lib/migrationObject.js'
import { READINESS } from '../src/lib/readiness.js'
import { REPORT_SCHEMAS } from '../src/lib/version.js'
import { fileInfo } from '../scripts/lib/fileInfo.mjs'
import { checkReadinessFile } from '../scripts/lib/readinessFile.mjs'
import { EXIT, parse, UsageError } from './args.mjs'
import { buildInfo, describeBuild } from './buildInfo.mjs'
import { readinessJunit } from './junit.mjs'
import { assertRecordable, recordRun } from './record.mjs'

export const USAGE = 'dcv check <contract.json> <load.csv> [--key col[,col]] [--json] [--junit out.xml] [--rejects fixes.csv] [--evidence pack.html] [--record] [--tmp dir] [--partitions n]'

export async function run(argv) {
  const parsed = parse(argv, {
    usage: USAGE,
    positionals: 2,
    options: {
      key: { type: 'string' }, json: { type: 'boolean' }, junit: { type: 'string' }, rejects: { type: 'string' },
      evidence: { type: 'string' }, record: { type: 'boolean' }, tmp: { type: 'string' }, partitions: { type: 'string' },
    },
  })
  if (parsed.help) {
    console.log(`Usage: ${USAGE}\n\n<contract.json> may be a contract, an ODCS contract imported with "dcv odcs import", or a migration object saved from the workspace.`)
    return EXIT.OK
  }
  const [contractPath, loadPath] = parsed.args
  const { key: keyArg, json, junit, rejects, evidence, record, tmp, partitions } = parsed.values

  let text
  try {
    text = readFileSync(contractPath, 'utf8')
  } catch (error) {
    throw new UsageError(`${contractPath}: ${error.message}`)
  }
  // A migration object carries its contract, its load file's format, and its
  // spec's target key, used when --key is not given.
  let contract
  let object = null
  let skipped = []
  let defaultKey = []
  let json0 = null
  try {
    json0 = JSON.parse(text)
  } catch {
    // not JSON: parseContractFile says so in its own words
  }
  if (isMigrationObjectFile(json0)) {
    const opened = readMigrationObject(json0)
    if (opened.error) throw new UsageError(`${contractPath}: ${opened.error}`)
    object = opened.object
    skipped = opened.skipped
    contract = { ...runnableContract(opened.object), skipped: opened.skipped }
    defaultKey = opened.object.spec.key.target.filter(Boolean)
  } else {
    contract = parseContractFile(text)
    if (contract.error) throw new UsageError(`${contractPath}: ${contract.error}`)
  }

  if (record) assertRecordable(contractPath, object, skipped)

  const key = keyArg ? keyArg.split(',').map((c) => c.trim()).filter(Boolean) : defaultKey
  const outcome = await checkReadinessFile(contract, loadPath, { key, rejectsPath: rejects, tmpDir: tmp, partitions })
  if (outcome.error) throw new UsageError(outcome.error)
  const report = outcome.report
  const build = buildInfo()
  const file = basename(loadPath)

  const notes = []
  if (evidence && report.status !== READINESS.INVALID) {
    const pack = await createEvidencePack({
      object: object ?? {
        name: contract.name, contract: { name: contract.name, rules: contract.rules },
        formats: contract.format ? { load: contract.format } : undefined,
        spec: { key: { source: [], target: key }, mapping: [], totals: [] }, runs: [],
      },
      readiness: { report, flaggedCount: report.counts.rejected + report.counts.warned, file: await fileInfo(loadPath, report.counts.records) },
      generatedBy: describeBuild(),
      reproduce: `dcv ${['check', ...argv].join(' ')}`,
    })
    writeFileSync(evidence, pack.html, { mode: 0o600 })
    notes.push(`Evidence pack ${pack.reference} written to ${evidence}`)
  }
  if (record) {
    const note = recordRun(contractPath, object, summariseReadiness(report, { wave: object.wave, cycle: object.cycle, fileName: file }))
    if (note) notes.push(note)
  }
  if (junit) {
    writeFileSync(junit, readinessJunit(report, { seconds: outcome.seconds, build, file }))
    notes.push(`JUnit results written to ${junit}`)
  }

  if (json) {
    // flagged is empty when streaming — the records went to --rejects instead.
    const { flagged: _flagged, ...summary } = report
    console.log(JSON.stringify({ $schema: REPORT_SCHEMAS.readiness, tool: build, generatedAt: new Date().toISOString(), file, ...summary }, null, 2))
  } else {
    printSummary(report, outcome, contract, file, rejects, notes)
  }
  return report.status === READINESS.READY ? EXIT.OK : report.status === READINESS.NOT_READY ? EXIT.FOUND : EXIT.UNUSABLE
}

function printSummary(report, outcome, contract, file, rejects, notes) {
  const tone = { FAIL: 'FAIL     ', PASS: 'PASS     ', UNCHECKED: 'UNCHECKED' }
  console.log(`\n${report.name ?? 'Contract'}: ${file}\n`)
  if (report.status === READINESS.INVALID) {
    for (const issue of report.issues) console.log(`  • ${issue}`)
  } else {
    for (const c of report.checks) {
      const count = c.status === 'FAIL' ? `  ${c.failing.toLocaleString('en-US')} of ${c.applicable.toLocaleString('en-US')}` : ''
      console.log(`  ${tone[c.status]} ${c.severity === 'warn' ? 'warn  ' : 'reject'}  ${c.description}${count}`)
      if (c.reason) console.log(`                      ${c.reason}`)
      for (const ex of c.examples) {
        console.log(`                      ${ex.record}${ex.record.startsWith('row ') ? '' : ` (row ${ex.row})`} — ${ex.value}`)
      }
    }
    const c = report.counts
    console.log(`\n  ${c.records.toLocaleString('en-US')} records: ${c.rejected.toLocaleString('en-US')} would be rejected, ${c.warned.toLocaleString('en-US')} would load with a warning, ${c.clean.toLocaleString('en-US')} clean. ${outcome.seconds.toFixed(2)}s`)
    if (contract.skipped?.length > 0) console.log(`  ${contract.skipped.length} rule(s) in the contract file could not be read and were NOT checked.`)
    if (rejects) {
      console.log(outcome.rejectsWritten > 0
        ? `  ${outcome.rejectsWritten.toLocaleString('en-US')} flagged records written to ${rejects}`
        : `  No flagged records, so ${rejects} was not written.`)
    }
    for (const note of notes) console.log(`  ${note}`)
  }
  console.log(`\n${report.headline}\n`)
}
