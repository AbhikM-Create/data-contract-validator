// Migration reconciliation from the command line.
//
//   node scripts/reconcile.mjs <spec.json> <source.csv> <target.csv> [--json]
//
// Exit codes are the contract with a pipeline: 0 reconciled, 1 a step failed,
// 2 the spec or a file could not be used. --json prints the full report for a
// downstream job; without it, a plain-language summary for a person.
//
// Reads each file whole. Streaming for multi-million-row loads is the next
// increment (docs/v2-spec.md); until then the limit is memory, ~2 KB a row.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseCsv } from '../src/lib/parseCsv.js'
import { reconcile } from '../src/lib/reconcile.js'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const [specPath, sourcePath, targetPath] = args.filter((a) => a !== '--json')

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (!specPath || !sourcePath || !targetPath) {
  fail('Usage: node scripts/reconcile.mjs <spec.json> <source.csv> <target.csv> [--json]')
}

let spec
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'))
} catch (error) {
  fail(`${specPath}: could not read the spec as JSON — ${error.message}`)
}

function read(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    fail(`${path}: ${error.message}`)
  }
  const parsed = parseCsv(text)
  if (parsed.errors.length > 0) fail(`${path}: ${parsed.errors[0]}`)
  return parsed
}

const source = read(sourcePath)
const target = read(targetPath)
const started = Date.now()
const report = reconcile(spec, source.rows, target.rows, {
  sourceColumns: source.columns,
  targetColumns: target.columns,
})
const seconds = ((Date.now() - started) / 1000).toFixed(2)

if (asJson) {
  console.log(JSON.stringify({ ...report, files: { source: basename(sourcePath), target: basename(targetPath) } }, null, 2))
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
        for (const ex of f.examples) {
          const label = ex.key ?? ex.value
          console.log(`${'  '.repeat(i)}        ${label}${ex.detail ? ` — ${ex.detail}` : ''}`)
        }
      }
    })
    const c = report.counts
    console.log(`\n  ${c.sourceRows.toLocaleString('en-US')} source rows (${c.sourceOutOfScope.toLocaleString('en-US')} out of scope), ${c.targetRows.toLocaleString('en-US')} target rows, ${seconds}s`)
  }
  console.log(`\n${report.headline}\n`)
}

process.exit(report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2)
