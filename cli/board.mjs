// dcv board — is the programme ready to go live?
//
//   dcv board <object.migration.json>... [--json] [--junit out.xml]
//
// Every object's latest checks in its current cycle, one verdict each, and one
// for the programme. Reads only the run summaries the objects store — from the
// workspace, or from `dcv check --record` and `dcv reconcile --record` in a
// pipeline — so it needs no data files at all.
//
// Exit 0 every object passed both checks, 1 one failed, 2 something could not
// be confirmed (a check that did not run in the cycle, could not confirm, or a
// file that is not a migration object). Sign-off lives in the organisation's
// database, not in files, so this board judges the checks alone and says so.

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { buildBoard } from '../src/lib/board.js'
import { readMigrationObject } from '../src/lib/migrationObject.js'
import { REPORT_SCHEMAS } from '../src/lib/version.js'
import { EXIT, parse, UsageError } from './args.mjs'
import { buildInfo } from './buildInfo.mjs'
import { deliverBoard, hasIntegrations, INTEGRATION_OPTIONS, readIntegrations, reportDelivery } from './integrations.mjs'
import { boardJunit } from './junit.mjs'

export const USAGE = 'dcv board <object.migration.json>... [--json] [--junit out.xml] [--notify teams,slack]'

export async function run(argv) {
  const parsed = parse(argv, { usage: USAGE, positionals: { min: 1 }, options: { json: { type: 'boolean' }, junit: { type: 'string' }, ...INTEGRATION_OPTIONS } })
  if (parsed.help) {
    console.log(`Usage: ${USAGE}\n\nRecord pipeline runs into the objects with "dcv check --record" and "dcv reconcile --record".`)
    return EXIT.OK
  }
  const { json, junit } = parsed.values
  const integrations = readIntegrations(parsed.values, process.env, { tickets: false })

  const objects = parsed.args.map((path) => {
    let opened
    try {
      opened = readMigrationObject(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      throw new UsageError(`${path}: could not read it as JSON — ${error.message}`)
    }
    if (opened.error) throw new UsageError(`${path}: ${opened.error}`)
    return opened.object
  })
  const names = objects.map((o) => o.name)
  const twice = names.filter((n, i) => names.indexOf(n) !== i)
  if (twice.length) throw new UsageError(`Two files describe the object "${twice[0]}". Pass each object once.`)

  const board = buildBoard(objects)
  const build = buildInfo()
  const files = parsed.args.map((p) => basename(p))

  const notes = []
  if (junit) {
    writeFileSync(junit, boardJunit(board, { build }))
    notes.push(`JUnit results written to ${junit}`)
  }
  if (hasIntegrations(integrations)) reportDelivery(await deliverBoard(integrations, board), notes)
  if (json) {
    console.log(JSON.stringify({ $schema: REPORT_SCHEMAS.board, tool: build, generatedAt: new Date().toISOString(), files, ...board }, null, 2))
  } else {
    printBoard(board, notes)
  }
  return board.verdict === 'GO' ? EXIT.OK : board.verdict === 'NO_GO' ? EXIT.FOUND : EXIT.UNUSABLE
}

const WORD = { GO: 'READY        ', NO_GO: 'NO-GO        ', NOT_CONFIRMED: 'NOT CONFIRMED' }
const pct = (share) => (Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : '—')

function printBoard(board, notes) {
  console.log('')
  for (const row of board.rows) {
    const r = row.readiness
    const c = row.reconciliation
    console.log(`  ${WORD[row.verdict]}  ${row.name} — ${[row.wave, row.cycle].filter(Boolean).join(' ')}`)
    console.log(`                 before the load: ${r.ran ? `${r.status}, ${pct(r.acceptance)} accepted` : 'not run'}   after the load: ${c.ran ? `${c.status}, ${pct(c.completeness)} arrived` : 'not run'}`)
    for (const reason of row.reasons) console.log(`                 • ${reason}`)
  }
  if (notes.length) console.log('')
  for (const note of notes) console.log(`  ${note}`)
  console.log(`\n${board.headline}\n`)
}
