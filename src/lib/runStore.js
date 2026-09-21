import { isConfigured, supabase } from './supabase.js'

// Reading and writing validation runs.
//
// Rows are built by summariseRun() in runRecord.js and nowhere else — that is
// the single place deciding what a stored run contains, and the place a test
// guards against values from the checked file leaking into the database.

export async function saveRun(record) {
  if (!isConfigured || !record) return { run: null, error: null }

  const { data, error } = await supabase
    .from('validation_runs')
    .insert(record)
    .select('id, ran_at')
    .single()

  if (error) {
    // A run that fails to save must never interrupt the person reading their
    // result: the validation itself already happened, in their browser, and is
    // on screen. This is a note, not a failure.
    return { run: null, error: readable(error) }
  }
  return { run: data, error: null }
}

export async function listRuns({ limit = 200 } = {}) {
  if (!isConfigured) return { runs: [], error: null }

  const { data, error } = await supabase
    .from('validation_runs')
    .select('id, contract_id, contract_name, baseline_name, candidate_name, status, layers, findings, rules_total, rules_broken, baseline_rows, candidate_rows, ran_at')
    .order('ran_at', { ascending: false })
    .limit(limit)

  if (error) return { runs: [], error: readable(error) }
  return { runs: data ?? [], error: null }
}

export async function deleteRun(id) {
  if (!isConfigured) return { error: null }
  const { error } = await supabase.from('validation_runs').delete().eq('id', id)
  return { error: readable(error) }
}

function readable(error) {
  if (!error) return null
  if (error.code === '42P01') return 'The validation_runs table does not exist yet — run the latest supabase/schema.sql.'
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) return 'Sign in to keep a history of your runs.'
  if (/fetch|network/i.test(error.message ?? '')) return 'Could not reach the server, so this run was not recorded.'
  return `Could not record this run: ${error.message}`
}
