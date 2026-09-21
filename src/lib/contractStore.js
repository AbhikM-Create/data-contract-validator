import { CONTRACT_FILE_VERSION, readRules, serializeContract } from './contractFile.js'
import { isConfigured, supabase } from './supabase.js'

// Saved contracts, in the account they belong to.
//
// Every write goes through serializeContract(), the same function the JSON
// download uses. That is deliberate: it is the single place that decides what a
// saved contract contains, and what it leaves out — the inferred baseline
// profile (value domains, ranges, timestamps) is made of real values from the
// file and must never reach the database. One serializer, one guarantee.
//
// Reads go through readRules(), so a row written by a future version with a
// rule this build cannot understand is reported rather than silently ignored.

const NOT_SIGNED_IN = 'Sign in to save contracts to your account.'
const NOT_CONFIGURED = 'This copy of the app has no Supabase project configured, so contracts can only be saved as files.'

function guard() {
  if (!isConfigured) return NOT_CONFIGURED
  return null
}

// Postgres speaks in codes; a person needs to know what to do next.
function readable(error) {
  if (!error) return null
  if (error.code === '23505') return 'You already have a contract with that name. Open it and save over it, or pick another name.'
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) return NOT_SIGNED_IN
  if (/jwt|not authenticated|session/i.test(error.message ?? '')) return 'Your session has expired. Sign in again to save.'
  if (/fetch|network/i.test(error.message ?? '')) return 'Could not reach the server. Your work is still here — try saving again.'
  return `Something went wrong saving: ${error.message}`
}

// listContracts() -> { contracts, error }
//
// The list view needs a name, a date and a size — never the rules themselves,
// which can be large and are not read until a contract is opened.
export async function listContracts() {
  const blocked = guard()
  if (blocked) return { contracts: [], error: blocked }

  const { data, error } = await supabase
    .from('contracts')
    .select('id, name, rules, updated_at')
    .order('updated_at', { ascending: false })

  if (error) return { contracts: [], error: readable(error) }

  return {
    contracts: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      ruleCount: Array.isArray(row.rules) ? row.rules.length : 0,
    })),
    error: null,
  }
}

// loadContract(id) -> { contract, skipped, error }
export async function loadContract(id) {
  const blocked = guard()
  if (blocked) return { contract: null, skipped: [], error: blocked }

  const { data, error } = await supabase
    .from('contracts')
    .select('id, name, rules, format_version, updated_at')
    .eq('id', id)
    .single()

  if (error) return { contract: null, skipped: [], error: readable(error) }

  if (Number(data.format_version) > CONTRACT_FILE_VERSION) {
    return {
      contract: null,
      skipped: [],
      error: `"${data.name}" was saved in format version ${data.format_version}, which is newer than this app understands (version ${CONTRACT_FILE_VERSION}). Update the app before opening it.`,
    }
  }

  const { rules, skipped } = readRules(data.rules)
  return {
    contract: { id: data.id, name: data.name, rules, updatedAt: data.updated_at },
    skipped,
    error: null,
  }
}

// saveContract({ id, name, rules }) -> { contract, error }
//
// With an id this updates that row; without one it inserts. It deliberately
// does NOT upsert on the name: silently merging into a contract that happens to
// share a name is how someone loses rules they meant to keep.
export async function saveContract({ id, name, rules }) {
  const blocked = guard()
  if (blocked) return { contract: null, error: blocked }

  const spec = serializeContract({ name, rules })
  if (!spec.rules.length) return { contract: null, error: 'There are no rules to save yet.' }

  const row = { name: spec.name, rules: spec.rules, format_version: spec.formatVersion }

  const query = id
    ? supabase.from('contracts').update(row).eq('id', id).select('id, name, updated_at').single()
    : supabase.from('contracts').insert(row).select('id, name, updated_at').single()

  const { data, error } = await query
  if (error) return { contract: null, error: readable(error) }

  // An update that matched no row means it is not this account's to change.
  if (!data) return { contract: null, error: 'That contract could not be found in your account.' }

  return { contract: { id: data.id, name: data.name, updatedAt: data.updated_at }, error: null }
}

export async function deleteContract(id) {
  const blocked = guard()
  if (blocked) return { error: blocked }
  const { error } = await supabase.from('contracts').delete().eq('id', id)
  return { error: readable(error) }
}
