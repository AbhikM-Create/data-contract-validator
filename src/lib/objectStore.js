import { MIGRATION_OBJECT_VERSION, readMigrationObject, serializeMigrationObject } from './migrationObject.js'
import { isConfigured, supabase } from './supabase.js'

// Migration objects saved to the account they belong to (user state 4: the
// same object on any device the person signs in from).
//
// Every write goes through serializeMigrationObject(), the same function the
// file download uses. That is deliberate: it is the single place that decides
// what a saved object contains — rules, mapping, formats, column matching, tags,
// owners, the sign-off record as typed, and each run's COUNTS — and what it
// never contains: a record from any file. One serializer, one guarantee; the
// test beside this module plants real values and asserts none reaches a row.
//
// Reads go through readMigrationObject(), which rebuilds every run field by
// field, so a row written by a future version, or edited by hand, cannot
// smuggle a value in or a rule this build cannot read go unnoticed.

const NOT_SIGNED_IN = 'Sign in to save this object to your account.'
const NOT_CONFIGURED = 'This copy of the app has no Supabase project configured, so objects can only be saved as files.'

const guard = () => (isConfigured ? null : NOT_CONFIGURED)

function readable(error) {
  if (!error) return null
  if (error.code === '42P01') return 'The migration_objects table does not exist yet — run the latest supabase/schema.sql in your project.'
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) return NOT_SIGNED_IN
  if (/jwt|not authenticated|session/i.test(error.message ?? '')) return 'Your session has expired. Sign in again to save.'
  if (/fetch|network/i.test(error.message ?? '')) return 'Could not reach the server. Your work is still here — try saving again.'
  return `Something went wrong saving: ${error.message}`
}

// objectRow(object) -> the row as written. Pure, so the boundary can be tested
// without a database: whatever is not in this row is not in the account.
export function objectRow(object) {
  const saved = serializeMigrationObject(object)
  return { name: saved.name, object: saved, format_version: saved.formatVersion }
}

// What the list shows, from the saved object: never the object itself, which
// can be large and is not read until it is opened.
function summary(row) {
  const saved = row.object ?? {}
  return {
    id: row.id,
    name: row.name,
    wave: saved.wave ?? null,
    cycle: saved.cycle ?? null,
    pack: saved.pack?.id ? `${saved.pack.id} v${saved.pack.version}` : null,
    runs: Array.isArray(saved.runs) ? saved.runs.length : 0,
    updatedAt: row.updated_at,
  }
}

// listObjects() -> { objects, error }
export async function listObjects() {
  const blocked = guard()
  if (blocked) return { objects: [], error: blocked }
  const { data, error } = await supabase
    .from('migration_objects')
    .select('id, name, object, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return { objects: [], error: readable(error) }
  return { objects: (data ?? []).map(summary), error: null }
}

// loadObject(id) -> { id, object, skipped, error }
export async function loadObject(id) {
  const blocked = guard()
  if (blocked) return { id: null, object: null, skipped: [], error: blocked }
  const { data, error } = await supabase
    .from('migration_objects')
    .select('id, name, object, format_version, updated_at')
    .eq('id', id)
    .single()
  if (error) return { id: null, object: null, skipped: [], error: readable(error) }
  if (Number(data.format_version) > MIGRATION_OBJECT_VERSION) {
    return { id: null, object: null, skipped: [], error: `"${data.name}" was saved in format version ${data.format_version}, which is newer than this app understands (version ${MIGRATION_OBJECT_VERSION}). Update the app before opening it.` }
  }
  const opened = readMigrationObject(data.object)
  if (opened.error) return { id: null, object: null, skipped: [], error: `"${data.name}" could not be read: ${opened.error}` }
  return { id: data.id, object: opened.object, skipped: opened.skipped, error: null }
}

// saveObject({ id, object }) -> { saved: { id, name, updatedAt }, error }
//
// With an id this updates that row; without one it inserts. Never an upsert on
// the name: two clients may each have an "Employees" object, and silently
// saving one over the other is how a partner loses a client's definitions.
export async function saveObject({ id, object }) {
  const blocked = guard()
  if (blocked) return { saved: null, error: blocked }
  const row = objectRow(object)
  const query = id
    ? supabase.from('migration_objects').update(row).eq('id', id).select('id, name, updated_at').single()
    : supabase.from('migration_objects').insert(row).select('id, name, updated_at').single()
  const { data, error } = await query
  if (error) return { saved: null, error: readable(error) }
  if (!data) return { saved: null, error: 'That object could not be found in your account.' }
  return { saved: { id: data.id, name: data.name, updatedAt: data.updated_at }, error: null }
}

export async function deleteObject(id) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  const { error } = await supabase.from('migration_objects').delete().eq('id', id)
  return { error: readable(error) }
}
