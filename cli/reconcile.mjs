// dcv reconcile — did a migrated dataset arrive whole and correct?
//
//   dcv reconcile <spec.json|object.migration.json> <source.csv> <target.csv>
//       [--json] [--junit out.xml] [--evidence pack.html] [--tmp dir] [--partitions n]
//
// Exit 0 reconciled, 1 a step failed, 2 the spec or a file could not be used.
// Files of any size: streamed, partitioned by key on local disk (--tmp), joined
// one partition at a time; partitions are deleted when the run ends.

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createEvidencePack } from '../src/lib/evidencePack.js'
import { isMigrationObjectFile, readMigrationObject, runnableSpec, summariseReconciliation } from '../src/lib/migrationObject.js'
import { REPORT_SCHEMAS } from '../src/lib/version.js'
import { fileInfo } from '../scripts/lib/fileInfo.mjs'
import { reconcileFiles } from '../scripts/lib/reconcileFiles.mjs'
import { EXIT, parse, UsageError } from './args.mjs'
import { buildInfo, describeBuild } from './buildInfo.mjs'
import { reconcileJunit } from './junit.mjs'
import { deliverRun, hasIntegrations, INTEGRATION_OPTIONS, readIntegrations, reportDelivery } from './integrations.mjs'
import { assertRecordable, recordRun } from './record.mjs'

export const USAGE = 'dcv reconcile <spec.json> <source.csv> <target.csv> [--json] [--junit out.xml] [--evidence pack.html] [--record] [--notify teams,slack] [--ticket jira|servicenow] [--tmp dir] [--partitions n]'

export async function run(argv) {
  const parsed = parse(argv, {
    usage: USAGE,
    positionals: 3,
    options: { json: { type: 'boolean' }, junit: { type: 'string' }, evidence: { type: 'string' }, record: { type: 'boolean' }, tmp: { type: 'string' }, partitions: { type: 'string' }, ...INTEGRATION_OPTIONS },
  })
  if (parsed.help) {
    console.log(`Usage: ${USAGE}\n\n<spec.json> may be a reconciliation spec or a migration object saved from the workspace.`)
    return EXIT.OK
  }
  const [specPath, sourcePath, targetPath] = parsed.args
  const { json, junit, evidence, record, tmp, partitions } = parsed.values

  let spec
  let object = null
  let skipped = []
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch (error) {
    throw new UsageError(`${specPath}: could not read the spec as JSON — ${error.message}`)
  }
  // A migration object saved from the workspace carries its spec; the pipeline
  // and the screen then run from the same file.
  if (isMigrationObjectFile(spec)) {
    const opened = readMigrationObject(spec)
    if (opened.error) throw new UsageError(`${specPath}: ${opened.error}`)
    object = opened.object
    skipped = opened.skipped
    spec = runnableSpec(opened.object)
  }
  if (record) assertRecordable(specPath, object, skipped)
  const integrations = readIntegrations(parsed.values)

  // An evidence pack quotes more records per finding than a terminal summary.
  const outcome = await reconcileFiles(spec, sourcePath, targetPath, { tmpDir: tmp, partitions, exampleLimit: evidence ? 25 : undefined })
  if (outcome.error) throw new UsageError(outcome.error)
  const report = outcome.report
  const build = buildInfo()
  const files = { source: basename(sourcePath), target: basename(targetPath) }

  const notes = []
  let reference = null
  if (evidence && report.status !== 'INVALID') {
    const pack = await createEvidencePack({
      object: object ?? { name: spec.name ?? basename(specPath), contract: { rules: [] }, spec, runs: [] },
      reconciliation: {
        report,
        source: await fileInfo(sourcePath, report.counts.sourceRows),
        target: await fileInfo(targetPath, report.counts.targetRows),
      },
      generatedBy: describeBuild(),
      reproduce: `dcv ${['reconcile', ...argv].join(' ')}`,
    })
    writeFileSync(evidence, pack.html, { mode: 0o600 })
    reference = pack.reference
    notes.push(`Evidence pack ${pack.reference} written to ${evidence}`)
  }
  const summary = summariseReconciliation(report, { wave: object?.wave, cycle: object?.cycle, sourceName: files.source, targetName: files.target })
  if (record) {
    const note = recordRun(specPath, object, summary)
    if (note) notes.push(note)
  }
  if (hasIntegrations(integrations)) {
    reportDelivery(await deliverRun(integrations, summary, { object: object ?? { name: spec.name ?? basename(specPath) }, routing: object?.routing, reference }), notes)
  }
  if (junit) {
    writeFileSync(junit, reconcileJunit(report, { seconds: outcome.seconds, build, files }))
    notes.push(`JUnit results written to ${junit}`)
  }

  if (json) {
    console.log(JSON.stringify({ $schema: REPORT_SCHEMAS.reconcile, tool: build, generatedAt: new Date().toISOString(), files, partitions: outcome.partitions, ...report }, null, 2))
  } else {
    printSummary(report, outcome, files, notes)
  }
  return report.status === 'PASS' ? EXIT.OK : report.status === 'FAIL' ? EXIT.FOUND : EXIT.UNUSABLE
}

function printSummary(report, outcome, files, notes) {
  const mark = { PASS: 'PASS   ', FAIL: 'FAIL   ', SKIPPED: 'SKIPPED' }
  console.log(`\n${report.name ?? 'Reconciliation'}: ${files.source} → ${files.target}\n`)
  if (report.status === 'INVALID') {
    for (const issue of report.issues) console.log(`  • ${issue}`)
  } else {
    report.steps.forEach((s, i) => {
      console.log(`${'  '.repeat(i)}${i + 1} ${s.label.padEnd(13)} ${mark[s.status]}${s.reason ? `  ${s.reason}` : ''}`)
      for (const f of s.findings) {
        console.log(`${'  '.repeat(i)}    • ${f.message}`)
        for (const ex of f.examples.slice(0, 5)) {
          console.log(`${'  '.repeat(i)}        ${ex.key ?? ex.value}${ex.detail ? ` — ${ex.detail}` : ''}`)
        }
      }
    })
    const c = report.counts
    console.log(`\n  ${c.sourceRows.toLocaleString('en-US')} source rows (${c.sourceOutOfScope.toLocaleString('en-US')} out of scope), ${c.targetRows.toLocaleString('en-US')} target rows, ${outcome.seconds.toFixed(2)}s${outcome.partitions > 1 ? `, ${outcome.partitions} partitions` : ''}`)
    for (const note of notes) console.log(`  ${note}`)
  }
  console.log(`\n${report.headline}\n`)
}
