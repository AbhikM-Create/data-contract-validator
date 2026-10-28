#!/usr/bin/env node
// dcv — Data Contract Validator from the command line.
//
//   dcv check <contract> <load.csv> [...]           will the target accept this load file?
//   dcv reconcile <spec> <source.csv> <target.csv>   did the load arrive whole and correct?
//   dcv board <object.migration.json>...             is the programme ready to go live?
//   dcv odcs export|import <file>                    Open Data Contract Standard in and out
//   dcv --version
//
// Exit codes, the same for every command: 0 passed, 1 a check found something,
// 2 the check could not be completed. "dcv <command> --help" for options.

import { UsageError } from '../cli/args.mjs'
import { describeBuild } from '../cli/buildInfo.mjs'

const COMMANDS = {
  check: () => import('../cli/check.mjs'),
  reconcile: () => import('../cli/reconcile.mjs'),
  board: () => import('../cli/board.mjs'),
  odcs: () => import('../cli/odcs.mjs'),
}

const HELP = `${describeBuild()}

Usage:
  dcv check <contract.json> <load.csv> [--key col] [--json] [--junit out.xml] [--rejects fixes.csv] [--evidence pack.html] [--record]
  dcv reconcile <spec.json> <source.csv> <target.csv> [--json] [--junit out.xml] [--evidence pack.html] [--record]
  dcv board <object.migration.json>... [--json] [--junit out.xml]
  dcv odcs export <contract.json> [--out contract.odcs.yaml]
  dcv odcs import <contract.odcs.yaml> [--out contract.json] [--object name]
  dcv --version

A contract or spec may also be a migration object saved from the workspace.
Exit codes: 0 passed, 1 a check found something, 2 could not be completed.
Files are read on this machine and never sent anywhere.`

export async function main(argv) {
  const [command, ...rest] = argv
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(describeBuild())
    return 0
  }
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP)
    return command ? 0 : 2
  }
  const load = COMMANDS[command]
  if (!load) {
    console.error(`Unknown command "${command}".\n\n${HELP}`)
    return 2
  }
  try {
    return await (await load()).run(rest)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      return 2
    }
    throw error
  }
}

const isEntry = import.meta.url === new URL(`file://${process.argv[1]}`).href || process.argv[1]?.endsWith('/dcv') || process.argv[1]?.endsWith('dcv.mjs')
if (isEntry) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error?.stack ?? String(error))
    process.exit(2)
  })
}
