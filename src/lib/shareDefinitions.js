// Share definitions (final-spec C7). Pure.
//
// The one file a pilot may send to us or to a colleague: an object's
// definitions and its run counts, and nothing that names the client or quotes a
// record. Built from the object as saved (migrationObject.js already keeps
// values out of runs), then narrowed:
//
//   - a crosswalk leaves only if it was DECLARED a code list and is small;
//     a key map (record identifiers) never leaves, and an undeclared crosswalk
//     is treated as record values;
//   - the sign-off record, the owners' names, the object's name, its wave and
//     every file name are left out — they are about the client;
//   - rules, the mapping's columns, formats, tags, column matching, the pack
//     reference, and each run's counts and verdicts stay.
//
// The result opens like any object file, and says what it left out.

import { serializeMigrationObject } from './migrationObject.js'

export const CROSSWALK_KINDS = [
  { id: 'codeList', label: 'Code list — standard codes (grades, account types); may be shared' },
  { id: 'keyMap', label: 'Key map — record identifiers (old ID to new ID); never leaves this device' },
]
export const CROSSWALK_KIND_IDS = CROSSWALK_KINDS.map((kind) => kind.id)

// A code list is a handful of standard codes. Past this, it is data.
export const SHARE_CROSSWALK_LIMIT = 500

function shareable(holder, what, dropped) {
  if (!holder?.map) return holder
  const entries = Object.keys(holder.map).length
  const { map: _map, mapKind: _kind, ...rest } = holder
  const said = `The crosswalk on ${what} (${entries} entr${entries === 1 ? 'y' : 'ies'})`
  if (holder.mapKind === 'keyMap') dropped.push(`${said} is a key map: record identifiers never leave this device.`)
  else if (holder.mapKind !== 'codeList') dropped.push(`${said} was not declared a code list, so it is treated as record values.`)
  else if (entries > SHARE_CROSSWALK_LIMIT) dropped.push(`${said} is over the ${SHARE_CROSSWALK_LIMIT}-entry limit for sharing.`)
  else return holder
  return rest
}

// shareDefinitions(object, { at }) -> { json, dropped }
export function shareDefinitions(object, { at } = {}) {
  const saved = serializeMigrationObject(object, { savedAt: at })
  const dropped = []
  const { signoff: _signoff, owners: _owners, ...kept } = saved
  const spec = {
    ...saved.spec,
    mapping: saved.spec.mapping.map((field) => shareable(field, `"${field.source}" → "${field.target}"`, dropped)),
    totals: saved.spec.totals.map((total) => (total.groupBy
      ? { ...total, groupBy: shareable(total.groupBy, `the grouping "${total.groupBy.source}" → "${total.groupBy.target}"`, dropped) }
      : total)),
  }
  dropped.push('The sign-off record, the owners’ names, the object’s name, its wave and every file name.')
  const name = saved.pack ? `${saved.pack.id} / ${saved.pack.object}` : 'Shared definitions'
  const shared = {
    ...kept,
    name,
    wave: null,
    contract: { ...saved.contract, name: 'Rules' },
    spec,
    runs: saved.runs.map((run) => ({ ...run, wave: null, files: Object.fromEntries(Object.keys(run.files ?? {}).map((role) => [role, null])) })),
    shared: { at: saved.savedAt, dropped },
  }
  return { json: `${JSON.stringify(shared, null, 2)}\n`, dropped }
}
