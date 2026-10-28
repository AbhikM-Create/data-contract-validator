// --record: append a check's run summary to the migration object it ran from,
// as the workspace does, so a pipeline's checks reach the readiness board.
//
// A run summary holds counts, rates and verdicts (migrationObject.js), never a
// record, so the object file stays safe to keep in git. The file is rewritten
// through the same serializer the workspace uses, by writing a sibling file
// and renaming it over the original: a crash mid-write leaves the old file,
// never half a new one.

import { renameSync, writeFileSync } from 'node:fs'
import { migrationObjectToJson } from '../src/lib/migrationObject.js'
import { UsageError } from './args.mjs'

// Refused before the check runs, so a run that cannot be recorded is not
// half-done: only a migration object has somewhere to record to, and one
// holding a rule this version cannot read would lose that rule on rewrite.
export function assertRecordable(path, object, skipped) {
  if (!object) throw new UsageError(`--record needs a migration object (*.migration.json); ${path} is not one, so there is nowhere to record the run.`)
  if (skipped?.length) {
    throw new UsageError(`--record would rewrite ${path}, which holds ${skipped.length} rule(s) this version cannot read and would drop. Update dcv, or run without --record.`)
  }
}

export function recordRun(path, object, run) {
  if (!run) return null
  const temporary = `${path}.dcv-${process.pid}.tmp`
  writeFileSync(temporary, migrationObjectToJson({ ...object, runs: [...object.runs, run] }))
  renameSync(temporary, path)
  return `Recorded this run in ${path} (${[object.wave, object.cycle].filter(Boolean).join(' ')})`
}
