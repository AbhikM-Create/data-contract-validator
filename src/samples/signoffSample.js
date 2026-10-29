// A worked sign-off, for a reader who has no account — and for a deployment
// with no account service at all. Demo data: the engine never imports this.
//
// Sign-off is the part of this tool an enterprise is buying, and until now it
// was the one screen that showed NOTHING without a Supabase project. A
// screenshot in a README is not the same as the real screen, so this builds
// the real thing: the example migration's own checks, through
// createEvidencePack, into the same subject a real submission carries. The
// fingerprints and file hashes below are therefore genuine — "Show exactly
// what was signed off" verifies against them like any other submission.
//
// Invented: the organisation, the three people and their decision. Every
// person in every sample in this app is made up.

import { createEvidencePack } from '../lib/evidencePack.js'
import { sha256Hex } from '../lib/hashing.js'
import { runnableSpec } from '../lib/migrationObject.js'
import { readSubmission } from '../lib/orgRecords.js'
import { parseCsv } from '../lib/parseCsv.js'
import { checkReadiness } from '../lib/readiness.js'
import { reconcile } from '../lib/reconcile.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from './migrationSample.js'

const ENGINEER = { id: 'example-engineer', email: 'priya@northwind.example', role: 'engineer' }
const OWNER = { id: 'example-owner', email: 'tomas@northwind.example', role: 'data_owner' }
const AUDITOR = { id: 'example-auditor', email: 'internal.audit@northwind.example', role: 'auditor' }
const AT = { submitted: '2026-10-14T11:02:00.000Z', decided: '2026-10-15T09:20:00.000Z' }

// A pack for the example migration, exactly as the workspace would build it.
async function examplePack() {
  const object = migrationSampleObject()
  const texts = { load: migrationLoadFile(), source: migrationSource(), target: migrationTarget() }
  const [load, source, target] = [texts.load, texts.source, texts.target].map(parseCsv)
  const info = async (name, text, rows) => ({ name, rows, bytes: new TextEncoder().encode(text).length, sha256: await sha256Hex(text) })
  const { flagged: _flagged, ...readiness } = checkReadiness(object.contract, load.rows, { columns: load.columns, key: ['employee_id'] })
  return createEvidencePack({
    object,
    readiness: { report: readiness, file: await info('load_file_mock3.csv', texts.load, load.rows.length) },
    reconciliation: {
      report: reconcile(runnableSpec(object), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns, exampleLimit: 1000 }),
      source: await info('legacy_hr_extract.csv', texts.source, source.rows.length),
      target: await info('target_after_mock2.csv', texts.target, target.rows.length),
    },
    generatedAt: AT.submitted,
    generatedBy: 'the workspace',
  })
}

// signoffSample() -> what the Sign-off screen renders, in the shape its own
// store returns: an organisation, its people, one submission with its
// decision, the definitions behind it, and the audit log.
export async function signoffSample() {
  const pack = await examplePack()
  const row = {
    id: 'example-submission',
    reference: pack.reference,
    object_name: 'Employees',
    wave: 'Wave 1',
    cycle: 'Mock 2',
    contract_def: 'example-contract-def',
    spec_def: 'example-spec-def',
    subject: pack.subject,
    submitted_by: ENGINEER.id,
    submitted_at: AT.submitted,
  }
  const decision = {
    id: 'example-decision',
    submission_id: row.id,
    decision: 'accept-with-exceptions',
    exceptions: [{
      finding: 'reconcile:mapping',
      reason: 'Grade G4 was retired in the legacy system last quarter; the three people on it move to Associate at cutover, agreed with HR.',
      owner: 'HR functional lead',
      fixBy: '2026-11-15',
    }],
    comment: 'Accepted for Mock 2 so the cycle can close. The crosswalk gap must be shut before the dress rehearsal.',
    decided_by: OWNER.id,
    decided_at: AT.decided,
  }
  const definitions = {
    'example-contract-def': { id: 'example-contract-def', kind: 'contract', sha256: pack.fingerprints.contract.sha256, body: JSON.parse(pack.fingerprints.contract.json), recorded_by: ENGINEER.id, recorded_at: AT.submitted },
    'example-spec-def': { id: 'example-spec-def', kind: 'spec', sha256: pack.fingerprints.spec.sha256, body: JSON.parse(pack.fingerprints.spec.json), recorded_by: ENGINEER.id, recorded_at: AT.submitted },
  }
  const submission = {
    ...readSubmission(row, [decision]),
    definitionsRecordedBy: [ENGINEER.id],
  }
  return {
    organization: { id: 'example-org', name: 'Northwind (example)', roles: ['auditor'] },
    members: [ENGINEER, OWNER, AUDITOR].map((p) => ({ user_id: p.id, email: p.email, role: p.role, added_at: '2026-10-01T09:00:00.000Z' })),
    submissions: [submission],
    definitions,
    audit: [
      { id: 6, at: AT.decided, actor: OWNER.id, action: 'insert', entity: 'decisions', entity_id: decision.id, detail: { submission_id: row.id, decision: decision.decision, exceptions: 1 } },
      { id: 5, at: AT.submitted, actor: ENGINEER.id, action: 'insert', entity: 'submissions', entity_id: row.id, detail: { reference: pack.reference, object: 'Employees', cycle: 'Mock 2' } },
      { id: 4, at: AT.submitted, actor: ENGINEER.id, action: 'insert', entity: 'definitions', entity_id: 'example-spec-def', detail: { kind: 'spec', sha256: pack.fingerprints.spec.sha256, object: 'Employees' } },
      { id: 3, at: AT.submitted, actor: ENGINEER.id, action: 'insert', entity: 'definitions', entity_id: 'example-contract-def', detail: { kind: 'contract', sha256: pack.fingerprints.contract.sha256, object: 'Employees' } },
      { id: 2, at: '2026-10-01T09:00:00.000Z', actor: ENGINEER.id, action: 'insert', entity: 'memberships', entity_id: `${OWNER.id}:data_owner`, detail: { user_id: OWNER.id, role: 'data_owner' } },
      { id: 1, at: '2026-10-01T08:55:00.000Z', actor: ENGINEER.id, action: 'insert', entity: 'organizations', entity_id: 'example-org', detail: { name: 'Northwind (example)' } },
    ],
  }
}
