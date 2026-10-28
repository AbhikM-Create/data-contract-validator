// dcv odcs — Open Data Contract Standard in and out.
//
//   dcv odcs export <contract.json|object.migration.json> [--out contract.odcs.yaml] [--id id] [--version v]
//   dcv odcs import <contract.odcs.yaml> [--out contract.json] [--object name]
//
// Export writes ODCS v3.2.0 YAML a catalog can register. Import writes this
// tool's contract JSON and lists, on stderr, everything in the ODCS file that it
// could not turn into a rule — and why. Exit 2 when anything was left out, so a
// pipeline cannot import half a contract without noticing.

import { readFileSync, writeFileSync } from 'node:fs'
import { contractToJson, parseContractFile } from '../src/lib/contractFile.js'
import { isMigrationObjectFile, readMigrationObject, runnableContract } from '../src/lib/migrationObject.js'
import { importOdcs, parseOdcs, toOdcsYaml } from '../src/lib/odcs.js'
import { EXIT, parse, UsageError } from './args.mjs'

export const USAGE = 'dcv odcs export <contract.json> [--out file] [--id id] [--version v]\n       dcv odcs import <contract.odcs.yaml> [--out contract.json] [--object name]'

export async function run(argv) {
  const [direction, ...rest] = argv
  if (direction === 'export') return exportCommand(rest)
  if (direction === 'import') return importCommand(rest)
  if (direction === '--help' || direction === '-h' || direction === undefined) {
    console.log(`Usage: ${USAGE}`)
    return direction === undefined ? EXIT.UNUSABLE : EXIT.OK
  }
  throw new UsageError(`Unknown odcs command "${direction}".\n\nUsage: ${USAGE}`)
}

function read(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new UsageError(`${path}: ${error.message}`)
  }
}

function exportCommand(argv) {
  const parsed = parse(argv, { usage: USAGE, positionals: 1, options: { out: { type: 'string' }, id: { type: 'string' }, version: { type: 'string' } } })
  if (parsed.help) return console.log(`Usage: ${USAGE}`), EXIT.OK
  const [path] = parsed.args
  const text = read(path)
  let contract
  let json = null
  try { json = JSON.parse(text) } catch { /* parseContractFile explains */ }
  if (isMigrationObjectFile(json)) {
    const opened = readMigrationObject(json)
    if (opened.error) throw new UsageError(`${path}: ${opened.error}`)
    contract = runnableContract(opened.object)
    if (opened.skipped.length) throw new UsageError(`${path}: ${opened.skipped.length} rule(s) could not be read; fix them before exporting, so the ODCS file does not claim less than the contract.`)
  } else {
    contract = parseContractFile(text)
    if (contract.error) throw new UsageError(`${path}: ${contract.error}`)
    if (contract.skipped.length) throw new UsageError(`${path}: ${contract.skipped.length} rule(s) could not be read; fix them before exporting, so the ODCS file does not claim less than the contract.`)
  }
  const yaml = toOdcsYaml(contract, { id: parsed.values.id, version: parsed.values.version })
  if (parsed.values.out) {
    writeFileSync(parsed.values.out, yaml)
    console.error(`ODCS v3.2.0 contract with ${contract.rules.length} rule(s) written to ${parsed.values.out}`)
  } else {
    process.stdout.write(yaml)
  }
  return EXIT.OK
}

function importCommand(argv) {
  const parsed = parse(argv, { usage: USAGE, positionals: 1, options: { out: { type: 'string' }, object: { type: 'string' } } })
  if (parsed.help) return console.log(`Usage: ${USAGE}`), EXIT.OK
  const [path] = parsed.args
  const { doc, error } = parseOdcs(read(path))
  if (error) throw new UsageError(`${path}: Couldn’t import this ODCS contract — ${error}.`)
  const result = importOdcs(doc, { object: parsed.values.object })
  if (result.error) throw new UsageError(`${path}: ${result.error}`)

  const json = contractToJson({ name: result.name, rules: result.rules, format: result.format })
  if (parsed.values.out) writeFileSync(parsed.values.out, json)
  else process.stdout.write(json)

  console.error(`Imported ${result.rules.length} rule(s) from "${result.name}".`)
  if (result.notImported.length > 0) {
    console.error(`NOT imported — ${result.notImported.length} item(s) this tool cannot check exactly; the contract enforces less than the ODCS file describes:`)
    for (const n of result.notImported) console.error(`  • ${n.where}: ${n.what}\n      ${n.reason}`)
    return EXIT.UNUSABLE
  }
  return EXIT.OK
}
