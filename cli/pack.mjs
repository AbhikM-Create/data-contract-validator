// dcv pack — start from a pack (v3-spec §6).
//
//   dcv pack list
//   dcv pack <pack-id> <object-id> [--param name=value]... [--out object.migration.json]
//
// An object that needs a value only the client knows — the cutover date —
// declares it, and is refused without it: a pack never guesses one.
//
// Writes a migration object built from the pack: the target's rules, the mapping
// spec, declared formats, sensitivity tags and the record's scope — the same
// object the workspace builds — for `dcv check` and `dcv reconcile` to read. A
// draft pack says so on stderr every time: it has not yet run on real exports.

import { writeFileSync } from 'node:fs'
import { migrationObjectToJson } from '../src/lib/migrationObject.js'
import { objectFromPack, packIssues, packLabel, packParams, packRef, paramIssues } from '../src/lib/packs.js'
import { findPack, PACKS } from '../src/packs/index.js'
import { EXIT, parse, UsageError } from './args.mjs'

export const USAGE = 'dcv pack list\n       dcv pack <pack-id> <object-id> [--param name=value]... [--out object.migration.json]'

export async function run(argv) {
  if (argv[0] === 'list') return list()
  const parsed = parse(argv, { usage: USAGE, positionals: 2, options: { out: { type: 'string' }, param: { type: 'string', multiple: true } } })
  if (parsed.help) return console.log(`Usage: ${USAGE}`), EXIT.OK
  const [packId, objectId] = parsed.args
  const pack = findPack(packId)
  if (!pack) throw new UsageError(`There is no pack "${packId}". "dcv pack list" lists them.`)
  const issues = packIssues(pack)
  if (issues.length) throw new UsageError(`The pack "${packId}" cannot be used:\n  ${issues.join('\n  ')}`)
  if (!pack.objects.some((o) => o.id === objectId)) throw new UsageError(`The pack "${packId}" has no object "${objectId}": ${pack.objects.map((o) => o.id).join(', ')}.`)
  const params = {}
  for (const arg of parsed.values.param ?? []) {
    const at = arg.indexOf('=')
    if (at < 1) throw new UsageError(`--param takes name=value, not "${arg}".`)
    params[arg.slice(0, at).trim()] = arg.slice(at + 1).trim()
  }
  const declared = packParams(pack, objectId).map((p) => p.id)
  const unknown = Object.keys(params).filter((name) => !declared.includes(name))
  if (unknown.length) throw new UsageError(`"${objectId}" takes no parameter ${unknown.map((n) => `"${n}"`).join(', ')}${declared.length ? `; it takes ${declared.join(', ')}` : ''}.`)
  const problems = paramIssues(pack, objectId, params)
  if (problems.length) throw new UsageError(`${problems.join('\n  ')}\n  Give it as ${declared.map((id) => `--param ${id}=YYYY-MM-DD`).join(' ')}.`)
  const object = objectFromPack(pack, objectId, params)

  const json = migrationObjectToJson(object)
  if (parsed.values.out) writeFileSync(parsed.values.out, json)
  else process.stdout.write(json)
  if (pack.status !== 'verified') console.error(`Note: ${packLabel(packRef(pack, objectId))}. Check its columns against your exports first.`)
  if (parsed.values.out) console.error(`Wrote "${object.name}" from ${pack.name} to ${parsed.values.out}.`)
  return EXIT.OK
}

function list() {
  for (const pack of PACKS) {
    console.log(`${pack.id}  v${pack.version}  ${pack.status.toUpperCase()}  ${pack.name}`)
    for (const object of pack.objects) {
      const needs = (object.params ?? []).map((p) => `--param ${p.id}=YYYY-MM-DD`).join(' ')
      console.log(`  ${object.id.padEnd(24)} ${object.name}${needs ? `  (needs ${needs})` : ''}`)
    }
  }
  return EXIT.OK
}
