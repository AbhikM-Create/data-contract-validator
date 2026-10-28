// dcv template — a contract from the target system's own load template.
//
//   dcv template import <template.xml|fields.csv> [--out contract.json] [--sheet name] [--naming technical|description]
//
// An SAP Migration Cockpit file template (XML Spreadsheet 2003) or a field list
// as CSV (src/lib/templates.js). Every rule it can propose is written — in the
// workspace a person accepts them one by one; a pipeline takes them all, so
// what could NOT be imported is listed on stderr with the reason, and the exit
// code is 2 when anything was left out, as with "dcv odcs import".

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { contractToJson } from '../src/lib/contractFile.js'
import { parseCsv } from '../src/lib/parseCsv.js'
import { cockpitProposals, fieldListProposals, isSpreadsheetXml, readMigrationCockpitTemplate } from '../src/lib/templates.js'
import { EXIT, parse, UsageError } from './args.mjs'

export const USAGE = 'dcv template import <template.xml|fields.csv> [--out contract.json] [--sheet name] [--naming technical|description]'

export async function run(argv) {
  const [direction, ...rest] = argv
  if (direction === '--help' || direction === '-h' || direction === undefined) {
    console.log(`Usage: ${USAGE}`)
    return direction === undefined ? EXIT.UNUSABLE : EXIT.OK
  }
  if (direction !== 'import') throw new UsageError(`Unknown template command "${direction}".\n\nUsage: ${USAGE}`)
  const parsed = parse(rest, { usage: USAGE, positionals: 1, options: { out: { type: 'string' }, sheet: { type: 'string' }, naming: { type: 'string' } } })
  if (parsed.help) return console.log(`Usage: ${USAGE}`), EXIT.OK
  const [path] = parsed.args
  const { out, sheet, naming = 'technical' } = parsed.values
  if (!['technical', 'description'].includes(naming)) throw new UsageError('--naming must be technical or description')

  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new UsageError(`${path}: ${error.message}`)
  }

  let result
  let name = basename(path).replace(/\.(xml|csv)$/i, '')
  if (isSpreadsheetXml(text)) {
    const read = readMigrationCockpitTemplate(text)
    if (read.error) throw new UsageError(`${path}: ${read.error}.`)
    const structure = sheet ? read.structures.find((s) => s.sheet === sheet) : read.structures[0]
    if (!structure) throw new UsageError(`${path}: no sheet "${sheet}". Sheets with fields: ${read.structures.map((s) => `"${s.sheet}"`).join(', ')}.`)
    if (!sheet && read.structures.length > 1) {
      throw new UsageError(`${path}: one load file is one sheet's rows — choose with --sheet: ${read.structures.map((s) => `"${s.sheet}"`).join(', ')}.`)
    }
    result = cockpitProposals(structure, { naming })
    name = `${name} — ${structure.sheet}`
  } else {
    if (sheet) throw new UsageError('--sheet is for a Migration Cockpit template; a CSV field list has one sheet.')
    const csv = parseCsv(text)
    if (csv.error) throw new UsageError(`${path}: ${csv.error}`)
    result = fieldListProposals(csv.rows, csv.columns)
    if (result.error) throw new UsageError(`${path}: ${result.error}.`)
  }

  const json = contractToJson({ name, rules: result.proposals.map((p) => p.rule) })
  if (out) writeFileSync(out, json)
  else process.stdout.write(json)
  console.error(`Imported ${result.proposals.length} rule(s) from ${basename(path)}.`)
  if (result.notImported.length) {
    console.error(`NOT imported — ${result.notImported.length} item(s) this tool cannot check exactly; the contract enforces less than the template describes:`)
    for (const n of result.notImported) console.error(`  • ${n.column}: ${n.what} — ${n.reason}`)
    return EXIT.UNUSABLE
  }
  return EXIT.OK
}
