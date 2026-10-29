import { describe, expect, it } from 'vitest'
import { verifyDefinition } from '../lib/orgRecords.js'
import { readSubject, subjectMatches } from '../lib/signoff.js'
import { signoffSample } from './signoffSample.js'

// The example exists to show the real thing. If it stops being the real
// thing — a subject this version cannot read, a fingerprint that no longer
// verifies — it has become a picture of a feature, which is what it replaced.
describe('the example sign-off', () => {
  it('carries a subject this version reads, from the example migration’s own checks', async () => {
    const { submissions } = await signoffSample()
    const [submission] = submissions
    expect(submission.subject).not.toBeNull()
    expect(readSubject(submission.subject)).toEqual(submission.subject)
    expect(submission.subject.files.map((f) => f.role)).toEqual(['load', 'source', 'target'])
    for (const file of submission.subject.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(submission.subject.checks.map((c) => [c.kind, c.status])).toEqual([['readiness', 'NOT_READY'], ['reconcile', 'FAIL']])
    expect(subjectMatches(submission.subject, submission.subject).matches).toBe(true)
  })

  it('shows a decision, with its exception, that the engine would accept', async () => {
    const { submissions } = await signoffSample()
    const [submission] = submissions
    expect(submission.state).toBe('accepted-with-exceptions')
    expect(submission.decisions[0].exceptions[0].finding).toBe('reconcile:mapping')
    // The exception names a step that actually failed in the example.
    expect(submission.subject.checks[1].steps.mapping).toBe('FAIL')
  })

  it('its recorded definitions verify against their fingerprints', async () => {
    const { definitions, submissions } = await signoffSample()
    for (const definition of Object.values(definitions)) {
      expect((await verifyDefinition(definition)).verified).toBe(true)
    }
    expect(definitions['example-contract-def'].sha256).toBe(submissions[0].subject.definitions.contract)
    expect(definitions['example-spec-def'].sha256).toBe(submissions[0].subject.definitions.spec)
  })

  it('holds no record from the example files — it is the stored shape, not the pack', async () => {
    const sample = await signoffSample()
    expect(JSON.stringify(sample)).not.toMatch(/Okafor|OKAFOR|40117|8125050/)
  })

  it('the audit log reads as a programme: organisation, roles, definitions, submission, decision', async () => {
    const { audit } = await signoffSample()
    expect(audit.map((e) => e.entity)).toEqual(['decisions', 'submissions', 'definitions', 'definitions', 'memberships', 'organizations'])
    expect(audit.every((e, i) => i === 0 || e.at <= audit[i - 1].at)).toBe(true)
  })
})
