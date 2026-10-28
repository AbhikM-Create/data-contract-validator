import { describe, expect, it } from 'vitest'
import { migrationSampleObject } from '../samples/migrationSample.js'
import { buildEvidencePack, evidenceFingerprints } from './evidencePack.js'
import { definitionRows, describeAudit, mayDecide, packReference, readSubmission, signoffState, verifyDefinition } from './orgRecords.js'

// jsonb keeps neither key order nor whitespace; this is what a row looks like
// after a round trip through the database.
const throughJsonb = (row) => {
  const shuffle = (v) => (Array.isArray(v) ? v.map(shuffle) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffle(x)])) : v)
  return { ...row, body: shuffle(JSON.parse(JSON.stringify(row.body))) }
}

describe('recorded definitions', () => {
  it('a recorded definition verifies against its fingerprint after a database round trip', async () => {
    const fingerprints = await evidenceFingerprints(migrationSampleObject())
    const rows = definitionRows('org-1', fingerprints, 'Employees')
    expect(rows.map((r) => [r.kind, r.sha256])).toEqual([['contract', fingerprints.contract.sha256], ['spec', fingerprints.spec.sha256]])
    for (const row of rows) {
      const check = await verifyDefinition(throughJsonb(row))
      expect(check.verified).toBe(true)
      expect(check.json).toBe(fingerprints[row.kind].json)
    }
  })

  it('a body that was changed no longer verifies', async () => {
    const fingerprints = await evidenceFingerprints(migrationSampleObject())
    const [contract] = definitionRows('org-1', fingerprints, 'Employees')
    contract.body.rules[0].column = 'first_name'
    expect((await verifyDefinition(contract)).verified).toBe(false)
    expect((await verifyDefinition({ sha256: contract.sha256, body: null })).verified).toBe(false)
  })
})

describe('a submission and its decisions', () => {
  const decision = (decided_by, d) => ({ id: `d-${decided_by}`, submission_id: 's1', decided_by, decided_at: '2026-10-28T13:00:00Z', exceptions: [], ...d })
  const row = { id: 's1', reference: 'EV-AAAA-0000-0001', submitted_by: 'alice', subject: { version: 1 } }

  it('one rejection outweighs any number of acceptances', () => {
    expect(signoffState([])).toBe('awaiting')
    expect(signoffState([{ decision: 'accept' }])).toBe('accepted')
    expect(signoffState([{ decision: 'accept' }, { decision: 'accept-with-exceptions' }])).toBe('accepted-with-exceptions')
    expect(signoffState([{ decision: 'accept' }, { decision: 'reject' }])).toBe('rejected')
  })

  it('a subject that does not read is shown as unreadable, not trusted', () => {
    expect(readSubmission(row).subject).toBeNull()
  })

  it('offers the decision only to someone the database will accept it from', () => {
    const fresh = readSubmission(row, [])
    expect(mayDecide(fresh, 'bob', ['data_owner']).allowed).toBe(true)
    expect(mayDecide(fresh, 'bob', ['engineer']).reason).toBe('Only a business data owner can decide.')
    expect(mayDecide(fresh, 'alice', ['data_owner', 'engineer']).reason).toMatch(/^You submitted this check/)
    expect(mayDecide(fresh, 'bob', ['data_owner'], ['bob']).reason).toMatch(/^You recorded the rules/)
    const decided = readSubmission(row, [decision('bob', { decision: 'accept' })])
    expect(mayDecide(decided, 'bob', ['data_owner']).reason).toBe('You have already decided on this submission.')
    expect(mayDecide(decided, 'carol', ['data_owner']).allowed).toBe(true)
  })
})

describe('the audit log, in sentences', () => {
  const names = { a: 'alice@northwind.example', b: 'bob@northwind.example' }
  const nameOf = (id) => names[id] ?? 'someone no longer in the organisation'
  it.each([
    [{ entity: 'organizations', action: 'insert', actor: 'a', detail: { name: 'Northwind' } }, 'alice@northwind.example created the organisation “Northwind”.'],
    [{ entity: 'memberships', action: 'insert', actor: 'b', detail: { user_id: 'b', role: 'data_owner' } }, 'bob@northwind.example became business data owner.'],
    [{ entity: 'memberships', action: 'delete', actor: 'a', detail: { user_id: 'b', role: 'engineer' } }, 'alice@northwind.example removed bob@northwind.example as migration engineer.'],
    [{ entity: 'invitations', action: 'insert', actor: 'a', detail: { email: 'erin@northwind.example', role: 'auditor' } }, 'alice@northwind.example invited erin@northwind.example as auditor.'],
    [{ entity: 'submissions', action: 'insert', actor: 'a', detail: { reference: 'EV-AAAA-0000-0001', object: 'Employees', cycle: 'Mock 2' } }, 'alice@northwind.example submitted EV-AAAA-0000-0001 — Employees, Mock 2 — for sign-off.'],
    [{ entity: 'decisions', action: 'insert', actor: 'b', detail: { decision: 'accept-with-exceptions', exceptions: 2 } }, 'bob@northwind.example decided “accept with exceptions” with 2 exceptions.'],
    [{ entity: 'decisions', action: 'insert', actor: 'x', detail: { decision: 'reject', exceptions: 0 } }, 'someone no longer in the organisation decided “reject”.'],
  ])('%#', (entry, sentence) => {
    expect(describeAudit(entry, nameOf)).toBe(sentence)
  })
})

describe('the pack a data owner was sent', () => {
  it('declares its reference where the sign-off screen can read it locally', async () => {
    const object = migrationSampleObject()
    const html = buildEvidencePack({ object, fingerprints: await evidenceFingerprints(object), reference: 'EV-1A2B-3C4D-5E6F', generatedAt: '2026-10-28T12:00:00Z', generatedBy: 'test' })
    expect(packReference(html)).toBe('EV-1A2B-3C4D-5E6F')
    expect(packReference('<html><meta name="dcv-evidence-reference" content="EV-NOPE">')).toBeNull()
    expect(packReference(null)).toBeNull()
  })
})
