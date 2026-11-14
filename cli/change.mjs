// dcv change — was this bulk change allowed?
//
//   dcv change <contract.json|object.migration.json> <before.csv> <after.csv>
//       [--approved approved.csv] [--log change_log.csv] [--reference name=file]...
//       [--json] [--junit out.xml] [--evidence record.html] [--custody custody.json]
//       [--tags tags.json] [--unmask] [--tmp dir] [--partitions n]
//
// Exit 0 allowed, 1 something broke the contract, 2 could not be completed —
// including "could not confirm" (UNVERIFIED): a pipeline stops on it. Files of
// any size: streamed and partitioned by key on local disk, as dcv reconcile.

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { normalizeContract } from '../src/lib/changeContract.js'
import { readChangeContract } from '../src/lib/changeContractFile.js'
import { createChangeRecord } from '../src/lib/changeRecord.js'
import { dcvCommand } from '../src/lib/reproduce.js'
import { fileInfo } from '../scripts/lib/fileInfo.mjs'
import { cleanTags, createMasker, maskChange } from '../src/lib/masking.js'
import { REPORT_SCHEMAS } from '../src/lib/version.js'
import { changeFiles } from '../scripts/lib/changeFiles.mjs'
import { parseReferenceArgs } from '../scripts/lib/referenceFiles.mjs'
import { readCsvHeader, streamCsv } from '../scripts/lib/csvStream.mjs'
import { EXIT, parse, UsageError } from './args.mjs'
import { buildInfo, describeBuild } from './buildInfo.mjs'
import { changeJunit } from './junit.mjs'

export const USAGE = 'dcv change <contract.json> <before.csv> <after.csv> [--approved file.csv] [--log file.csv] [--reference name=file.csv]... [--json] [--junit out.xml] [--evidence record.html] [--custody custody.json] [--tags tags.json] [--unmask] [--tmp dir] [--partitions n]'

// A reference file for a oneOf policy: the values of one column.
async function referenceColumn(path, column) {
  const header = readCsvHeader(path)
  if (header.error) throw new UsageError(`${path}: ${header.error}`)
  if (!header.columns.includes(column)) throw new UsageError(`${path} has no column "${column}" (it has ${header.columns.map((c) => `"${c}"`).join(', ')}).`)
  const values = []
  const read = await streamCsv(path, (row) => { values.push(row[column]) })
  if (read.error) throw new UsageError(`${path}: ${read.error}`)
  return values
}

export async function run(argv) {
  const parsed = parse(argv, {
    usage: USAGE,
    positionals: 3,
    options: {
      approved: { type: 'string' },
      log: { type: 'string' },
      reference: { type: 'string', multiple: true },
      json: { type: 'boolean' },
      junit: { type: 'string' },
      tags: { type: 'string' },
      evidence: { type: 'string' },
      custody: { type: 'string' },
      unmask: { type: 'boolean' },
      tmp: { type: 'string' },
      partitions: { type: 'string' },
    },
  })
  if (parsed.help) {
    console.log(`Usage: ${USAGE}\n\n<contract.json> is a change contract: a file saved from the workspace, or one written by hand.
--evidence writes the change record (HTML); --custody is a JSON file of who did what (see the help centre), which the record states as typed.
--tags is a JSON map of column → personal | identifier | pay | aadhaar; tagged values are masked in what is printed.\n--approved is the signer's approved list; --log is the change log of whoever made the change.\nA oneOf policy naming a reference "chart:Account Name" reads column "Account Name" of --reference chart=file.csv.`)
    return EXIT.OK
  }
  const [contractPath, beforePath, afterPath] = parsed.args
  const { approved, log, reference, json, junit, tags: tagsPath, unmask, tmp, partitions, evidence, custody: custodyPath } = parsed.values

  const readJson = (path, what) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new UsageError(`${path}: could not read the ${what} as JSON — ${error.message}`)
    }
  }
  const opened = readChangeContract(readJson(contractPath, 'contract'))
  if (opened.error) throw new UsageError(`${contractPath}: ${opened.error}`)
  const contract = opened.contract
  const tags = tagsPath ? cleanTags(readJson(tagsPath, 'tags')) : {}
  if (custodyPath && !evidence) throw new UsageError('--custody is stated in the change record: give --evidence too.')
  const custody = custodyPath ? readJson(custodyPath, 'custody') : {}

  // --reference name=file: every name must be one a oneOf policy uses — a typo
  // is refused, never skipped.
  const refArgs = parseReferenceArgs(reference ?? [])
  if (refArgs.error) throw new UsageError(refArgs.error)
  const wanted = new Map()
  for (const f of normalizeContract(contract).fields) {
    if (f.policy === 'oneOf' && f.reference) {
      const [name, column] = f.reference.split(':')
      wanted.set(name, column ?? name)
    }
  }
  const references = {}
  for (const [name, path] of Object.entries(refArgs.files ?? {})) {
    if (!wanted.has(name)) throw new UsageError(`--reference names "${name}", which no policy in the contract uses; ${wanted.size ? `it uses ${[...wanted.keys()].map((n) => `"${n}"`).join(', ')}` : 'it uses no reference'}.`)
    const column = wanted.get(name)
    references[`${name}:${column}`] = await referenceColumn(path, column)
    references[name] = references[`${name}:${column}`]
  }

  const outcome = await changeFiles(contract, beforePath, afterPath, {
    approvedPath: approved, logPath: log, references, tmpDir: tmp, partitions, exampleLimit: evidence ? 25 : undefined,
  })
  if (outcome.error) throw new UsageError(outcome.error)
  const report = outcome.report
  const normal = normalizeContract(contract)
  const keys = [...normal.key.before, ...normal.key.after]
  const shown = maskChange(report, normal, createMasker(tags, { unmask: unmask === true, keys }))
  const build = buildInfo()
  const files = { before: basename(beforePath), after: basename(afterPath), ...(approved ? { approved: basename(approved) } : {}), ...(log ? { log: basename(log) } : {}) }

  const notes = []
  if (evidence && report.status !== 'INVALID') {
    const record = await createChangeRecord({
      report,
      contract,
      files: {
        before: await fileInfo(beforePath, report.counts.beforeRows),
        after: await fileInfo(afterPath, report.counts.afterRows),
        ...(approved ? { approved: await fileInfo(approved) } : {}),
        ...(log ? { log: await fileInfo(log) } : {}),
      },
      custody,
      tags,
      unmask: unmask === true,
      generatedBy: describeBuild(),
      reproduce: dcvCommand('change', argv),
    })
    writeFileSync(evidence, record.html, { mode: 0o600 })
    notes.push(`Change record ${record.reference} written to ${evidence}`)
  }
  if (junit) {
    writeFileSync(junit, changeJunit(report, { seconds: outcome.seconds, build, files }))
    notes.push(`JUnit results written to ${junit}`)
  }

  if (json) {
    console.log(JSON.stringify({ $schema: REPORT_SCHEMAS.change, tool: build, generatedAt: new Date().toISOString(), files, partitions: outcome.partitions, ...shown }, null, 2))
  } else {
    printSummary(shown, outcome, files, notes)
  }
  return report.status === 'ALLOWED' ? EXIT.OK : report.status === 'NOT_ALLOWED' ? EXIT.FOUND : EXIT.UNUSABLE
}

function printSummary(report, outcome, files, notes) {
  const mark = { PASS: 'PASS     ', FAIL: 'FAIL     ', SKIPPED: 'SKIPPED  ', UNCHECKED: 'UNCHECKED' }
  console.log(`\n${report.name ?? 'Change check'}: ${files.before} → ${files.after}\n`)
  if (report.status === 'INVALID') {
    for (const issue of report.issues) console.log(`  • ${issue}`)
  } else {
    report.steps.forEach((s, i) => {
      console.log(`${'  '.repeat(i)}${i + 1} ${s.label.padEnd(17)} ${mark[s.status]}${s.reason ? `  ${s.reason}` : ''}`)
      for (const f of s.findings) {
        console.log(`${'  '.repeat(i)}    • ${f.message}`)
        for (const ex of f.examples.slice(0, 5)) {
          const values = ex.before !== undefined ? ` — ${ex.before} → ${ex.after}${ex.approved !== undefined ? ` (approved ${ex.approved})` : ''}${ex.reason ? `: ${ex.reason}` : ''}` : ''
          console.log(`${'  '.repeat(i)}        ${ex.key}${values}`)
        }
      }
    })
    const c = report.counts
    console.log(`\n  ${c.beforeRows.toLocaleString('en-US')} records before, ${c.afterRows.toLocaleString('en-US')} after, ${outcome.seconds.toFixed(2)}s${outcome.partitions > 1 ? `, ${outcome.partitions} partitions` : ''}`)
    for (const note of notes) console.log(`  ${note}`)
  }
  console.log(`\n${report.headline}\n`)
}
