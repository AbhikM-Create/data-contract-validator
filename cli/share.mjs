// dcv share — the one file a pilot may send (final-spec C7).
//
//   dcv share <object.migration.json> [--out shared.migration.json]
//
// Writes the object's definitions and run counts, and nothing that names the
// client or quotes a record: no sign-off record, no owners' names, no file
// names, no key maps, no crosswalk that was not declared a code list
// (src/lib/shareDefinitions.js). What was left out is listed on stderr.

import { readFileSync, writeFileSync } from 'node:fs'
import { parseMigrationObjectFile } from '../src/lib/migrationObject.js'
import { shareDefinitions } from '../src/lib/shareDefinitions.js'
import { EXIT, parse, UsageError } from './args.mjs'

export const USAGE = 'dcv share <object.migration.json> [--out shared.migration.json]'

export async function run(argv) {
  const parsed = parse(argv, { usage: USAGE, positionals: 1, options: { out: { type: 'string' } } })
  if (parsed.help) return console.log(`Usage: ${USAGE}`), EXIT.OK
  const [path] = parsed.args
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new UsageError(`${path}: ${error.message}`)
  }
  const opened = parseMigrationObjectFile(text)
  if (opened.error) throw new UsageError(`${path}: ${opened.error}`)
  const shared = shareDefinitions(opened.object)
  if (parsed.values.out) writeFileSync(parsed.values.out, shared.json)
  else process.stdout.write(shared.json)
  console.error(`Left out:\n  ${shared.dropped.join('\n  ')}`)
  return EXIT.OK
}
