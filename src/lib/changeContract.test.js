import { describe, expect, it } from 'vitest'
import { checkChange, contractIssues, normalizeContract, outsideBounds, toChangeContract } from './changeContract.js'
import { runnableSpec } from './migrationObject.js'
import { parseCsv } from './parseCsv.js'
import { reconcile } from './reconcile.js'
import { migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { financeSampleObject, financeSource, financeTarget } from '../samples/financeSample.js'

// Change contracts: every class of finding is planted and caught, and each test
// also runs the clean case, so a check is trusted only once it has been seen to
// fail on the thing it guards against. Every transaction, person and amount is
// invented.

const step = (report, id) => report.steps.find((s) => s.id === id)
const codes = (report, id) => step(report, id).findings.map((f) => `${f.code}${f.column ? `:${f.column}` : ''}`)

// --- an AI categorisation run ------------------------------------------------------

const TXNS = [
  { 'Txn ID': 'T1', Date: '2026-10-02', Party: 'Asha Traders', Amount: '1200.00', Category: 'Suspense', 'Tax Code': 'GST18' },
  { 'Txn ID': 'T2', Date: '2026-10-03', Party: 'Kiran Stores', Amount: '560.50', Category: 'Suspense', 'Tax Code': 'GST18' },
  { 'Txn ID': 'T3', Date: '2026-10-04', Party: 'Ravi & Co', Amount: '89.00', Category: 'Office Supplies', 'Tax Code': 'GST12' },
]
const AI_RUN = {
  name: 'AI categorisation — October',
  key: { before: ['Txn ID'], after: ['Txn ID'] },
  fields: {
    Category: { policy: 'oneOf', values: ['Office Supplies', 'Travel', 'Rent', 'Suspense'] },
    'Tax Code': { policy: 'oneOf', values: ['GST18', 'GST12', 'GST5', 'GST0'] },
  },
  totals: [{ column: 'Amount', compare: 'equal' }],
}
const after = (patch) => TXNS.map((t) => ({ ...t, ...(patch[t['Txn ID']] ?? {}) }))

describe('an AI categorisation run — everything not named is preserved', () => {
  it('allowed changes only: ALLOWED, with the changes counted', () => {
    const r = checkChange(AI_RUN, TXNS, after({ T1: { Category: 'Rent' }, T2: { Category: 'Travel', 'Tax Code': 'GST5' } }))
    expect(r.status).toBe('ALLOWED')
    expect(r.counts.changed).toBe(2)
    expect(r.counts.allowedOnly).toBe(2)
    expect(r.counts.unchanged).toBe(1)
  })

  it('an amount the contract never named changed: NOT_ALLOWED at "Permitted fields", and the total says so too', () => {
    const r = checkChange(AI_RUN, TXNS, after({ T1: { Category: 'Rent', Amount: '1250.00' } }))
    expect(r.status).toBe('NOT_ALLOWED')
    expect(codes(r, 'permitted')).toEqual(['changed-not-allowed:Amount'])
    expect(step(r, 'permitted').findings[0].examples[0]).toMatchObject({ key: 'T1', before: '1200.00', after: '1250.00' })
    expect(step(r, 'totals').status).toBe('FAIL')
    expect(r.fields.find((f) => f.before === 'Amount')).toMatchObject({ implicit: true, notAllowed: 1 })
  })

  it('negative control: with others "ignore", the same amount change passes unseen — which is why "preserve" is the default', () => {
    const r = checkChange({ ...AI_RUN, others: 'ignore', totals: [] }, TXNS, after({ T1: { Amount: '1250.00' } }))
    expect(r.status).toBe('ALLOWED')
  })

  it('a category outside the list: out of limits', () => {
    const r = checkChange(AI_RUN, TXNS, after({ T2: { Category: 'Entertainment' } }))
    expect(r.status).toBe('NOT_ALLOWED')
    expect(codes(r, 'limits')).toEqual(['out-of-limits:Category'])
  })

  it('a category checked against a reference file; without the file it is unverified, never passed', () => {
    const contract = { ...AI_RUN, fields: { ...AI_RUN.fields, Category: { policy: 'oneOf', reference: 'chart' } } }
    const patched = after({ T1: { Category: 'Rent' } })
    expect(checkChange(contract, TXNS, patched, { references: { chart: ['Rent', 'Suspense', 'Office Supplies'] } }).status).toBe('ALLOWED')
    expect(checkChange(contract, TXNS, patched, { references: { chart: ['Suspense'] } }).status).toBe('NOT_ALLOWED')
    const without = checkChange(contract, TXNS, patched)
    expect(without.status).toBe('UNVERIFIED')
    expect(codes(without, 'limits')).toEqual(['missing-reference:Category'])
  })

  it('the change log: an unlogged change and a logged non-change are both reported; no log at all is UNVERIFIED', () => {
    const contract = { ...AI_RUN, changeLog: { key: ['Txn ID'] } }
    const patched = after({ T1: { Category: 'Rent' }, T2: { Category: 'Travel' } })
    const ok = checkChange(contract, TXNS, patched, { changeLog: [{ 'Txn ID': 'T1' }, { 'Txn ID': 'T2' }] })
    expect(ok.status).toBe('ALLOWED')
    const r = checkChange(contract, TXNS, patched, { changeLog: [{ 'Txn ID': 'T1' }, { 'Txn ID': 'T3' }] })
    expect(r.status).toBe('NOT_ALLOWED')
    expect(codes(r, 'permitted').sort()).toEqual(['logged-unchanged', 'unlogged'])
    const none = checkChange(contract, TXNS, patched)
    expect(none.status).toBe('UNVERIFIED')
    expect(step(none, 'permitted').status).toBe('UNCHECKED')
  })
})

// --- records added and removed ------------------------------------------------------

describe('coverage — no additions or removals unless declared', () => {
  const fewer = TXNS.slice(0, 2)
  const more = [...TXNS, { 'Txn ID': 'T4', Date: '2026-10-05', Party: 'New', Amount: '10.00', Category: 'Rent', 'Tax Code': 'GST0' }]

  it('a removal and an addition are not allowed by default', () => {
    expect(codes(checkChange({ ...AI_RUN, totals: [] }, TXNS, fewer), 'coverage')).toEqual(['removed-not-allowed'])
    expect(codes(checkChange({ ...AI_RUN, totals: [] }, TXNS, more), 'coverage')).toEqual(['added-not-allowed'])
  })

  it('"any" allows them; "listed" allows only keys on the approved list', () => {
    expect(checkChange({ ...AI_RUN, totals: [], added: 'any', removed: 'any' }, TXNS, fewer).status).toBe('ALLOWED')
    const listed = { ...AI_RUN, totals: [], added: 'listed', approved: { key: ['Txn ID'] } }
    expect(checkChange(listed, TXNS, more, { approved: [{ 'Txn ID': 'T4' }] }).status).toBe('ALLOWED')
    expect(checkChange(listed, TXNS, more, { approved: [{ 'Txn ID': 'T9' }] }).status).toBe('NOT_ALLOWED')
  })
})

// --- a salary revision -----------------------------------------------------------------

const STAFF = [
  { 'Emp Code': 'E1', Basic: '50000', HRA: '20000', CTC: '900000', Grade: 'M1' },
  { 'Emp Code': 'E2', Basic: '40000', HRA: '16000', CTC: '720000', Grade: 'M2' },
  { 'Emp Code': 'E3', Basic: '30000', HRA: '12000', CTC: '540000', Grade: 'M2' },
]
const REVISION = {
  name: 'FY27 revision — wave 1',
  key: ['Emp Code'],
  approved: { key: ['Emp Code'] },
  fields: {
    Basic: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved' },
    HRA: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved' },
    CTC: { policy: 'asApproved' },
  },
}
const revised = (patch) => STAFF.map((s) => ({ ...s, ...(patch[s['Emp Code']] ?? {}) }))
const APPROVED = [{ 'Emp Code': 'E1', CTC: '990000' }, { 'Emp Code': 'E2', CTC: '792000' }]
const GOOD = { E1: { Basic: '55000', HRA: '22000', CTC: '990000' }, E2: { Basic: '44000', HRA: '17600', CTC: '792000' } }

describe('a salary revision — approved list, up only, at most +20%', () => {
  it('as approved: ALLOWED', () => {
    expect(checkChange(REVISION, STAFF, revised(GOOD), { approved: APPROVED }).status).toBe('ALLOWED')
  })

  it('+25% on an approved employee: out of limits, with the reason', () => {
    const r = checkChange(REVISION, STAFF, revised({ ...GOOD, E1: { ...GOOD.E1, Basic: '62500' } }), { approved: APPROVED })
    expect(codes(r, 'limits')).toEqual(['out-of-limits:Basic'])
    expect(step(r, 'limits').findings[0].examples[0].reason).toMatch(/25%, above the allowed 20%/)
  })

  it('a cut: out of limits (up only)', () => {
    const r = checkChange(REVISION, STAFF, revised({ ...GOOD, E2: { ...GOOD.E2, HRA: '15000' } }), { approved: APPROVED })
    expect(step(r, 'limits').findings[0].examples[0].reason).toMatch(/went down/)
  })

  it('a revision for someone not on the list: not allowed', () => {
    const r = checkChange(REVISION, STAFF, revised({ ...GOOD, E3: { Basic: '33000' } }), { approved: APPROVED })
    expect(codes(r, 'permitted')).toEqual(['not-on-approved-list:Basic'])
  })

  it('an approved revision that did not happen, and one that came out different', () => {
    const r = checkChange(REVISION, STAFF, revised({ E1: GOOD.E1, E2: { ...GOOD.E2, CTC: '780000' } }), { approved: APPROVED })
    expect(codes(r, 'approvals')).toEqual(['approved-different:CTC'])
    // E2's revision did not happen: reported once, at the field — not again as
    // "approved, nothing changed" (one fault, one finding).
    const missing = checkChange(REVISION, STAFF, revised({ E1: GOOD.E1 }), { approved: APPROVED })
    expect(codes(missing, 'approvals')).toEqual(['approved-missing:CTC'])
  })

  it('with no approved value to compare, an approved record that did not change is reported as a whole', () => {
    const capOnly = { key: ['Emp Code'], approved: { key: ['Emp Code'] }, fields: { Basic: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved' } } }
    const r = checkChange(capOnly, STAFF, revised({ E1: { Basic: '55000' } }), { approved: [{ 'Emp Code': 'E1' }, { 'Emp Code': 'E2' }] })
    expect(codes(r, 'approvals')).toEqual(['approved-missing'])
    expect(step(r, 'approvals').findings[0].examples[0].key).toBe('E2')
    // Control: both revised — nothing missing.
    expect(checkChange(capOnly, STAFF, revised({ E1: { Basic: '55000' }, E2: { Basic: '44000' } }), { approved: [{ 'Emp Code': 'E1' }, { 'Emp Code': 'E2' }] }).status).toBe('ALLOWED')
  })

  it('an approved employee in neither file is reported', () => {
    const r = checkChange(REVISION, STAFF, revised(GOOD), { approved: [...APPROVED, { 'Emp Code': 'E9', CTC: '1' }] })
    expect(codes(r, 'approvals')).toEqual(['approved-not-found'])
  })

  it('without the approved file, approvals are UNCHECKED and the result is UNVERIFIED — never passed', () => {
    const r = checkChange(REVISION, STAFF, revised(GOOD))
    expect(r.status).toBe('UNVERIFIED')
    expect(step(r, 'approvals').status).toBe('UNCHECKED')
  })

  it('a salary that cannot be read as a number is unverified, never within limits', () => {
    const r = checkChange(REVISION, STAFF, revised({ ...GOOD, E1: { ...GOOD.E1, Basic: 'fifty-five thousand' } }), { approved: APPROVED })
    expect(codes(r, 'limits')).toEqual(['unreadable:Basic'])
    expect(r.status).not.toBe('ALLOWED')
  })

  it('a condition: the policy applies only where it holds, elsewhere the field is preserved', () => {
    const contract = { key: ['Emp Code'], fields: { Basic: { policy: 'free', when: { column: 'Grade', op: '=', target: 'M1' } } } }
    expect(checkChange(contract, STAFF, revised({ E1: { Basic: '99999' } })).status).toBe('ALLOWED')
    expect(codes(checkChange(contract, STAFF, revised({ E2: { Basic: '99999' } })), 'permitted')).toEqual(['changed-not-allowed:Basic'])
  })

  it('a total bounded by budget', () => {
    const budget = { ...REVISION, totals: [{ column: 'CTC', compare: 'delta', max: 200000 }] }
    expect(step(checkChange(budget, STAFF, revised(GOOD), { approved: APPROVED }), 'totals').status).toBe('PASS')
    const tight = { ...REVISION, totals: [{ column: 'CTC', compare: 'delta', max: 100000 }] }
    expect(codes(checkChange(tight, STAFF, revised(GOOD), { approved: APPROVED }), 'totals')).toEqual(['total-out-of-limits:CTC'])
  })
})

// --- keys, formats, crosswalks ----------------------------------------------------------

describe('keys, formats and crosswalks', () => {
  it('a duplicate key is set aside, not guessed at; a blank key is counted', () => {
    const dup = [...TXNS, { ...TXNS[0], Amount: '1.00' }, { ...TXNS[1], 'Txn ID': '' }]
    const r = checkChange({ ...AI_RUN, totals: [] }, dup, TXNS)
    expect(codes(r, 'keys').sort()).toEqual(['blank-key', 'duplicate-key'])
    expect(r.counts.duplicateKeys.before).toBe(1)
    expect(r.counts.blankKeys.before).toBe(1)
  })

  it('each side read in its own declared format: 1.200,00 and 1200.00 are the same amount, not a change', () => {
    const european = TXNS.map((t) => ({ ...t, Amount: t.Amount.replace('.', ',') }))
    const contract = { ...AI_RUN, totals: [], formats: { before: { decimal: ',' }, after: {} } }
    expect(checkChange(contract, european, TXNS).status).toBe('ALLOWED')
    // Control: undeclared, "1200,00" is not read as 1200 and the field is reported changed.
    expect(checkChange({ ...AI_RUN, totals: [] }, european, TXNS).status).toBe('NOT_ALLOWED')
  })

  it('map: the crosswalked value is allowed; a wrong one is out of limits; an unmapped one is unverified', () => {
    const before = [{ id: '1', grade: 'G5' }, { id: '2', grade: 'G6' }, { id: '3', grade: 'G9' }]
    const contract = { key: ['id'], fields: { grade: { policy: 'map', map: { G5: 'Senior', G6: 'Lead' } } } }
    const r = checkChange(contract, before, [{ id: '1', grade: 'Senior' }, { id: '2', grade: 'Senior' }, { id: '3', grade: 'Lead' }])
    expect(codes(r, 'limits').sort()).toEqual(['out-of-limits:grade', 'unmapped:grade'])
    expect(r.fields[0]).toMatchObject({ allowed: 1, outOfLimits: 1, unmapped: 1 })
  })
})

// --- the contract itself ------------------------------------------------------------------

describe('the contract', () => {
  it('is refused, with every reason, when it cannot run as written — never half-run', () => {
    const issues = contractIssues({ fields: { A: { policy: 'guess' }, B: { policy: 'oneOf' }, C: { policy: 'asApproved' } }, added: 'some' })
    expect(issues.join('\n')).toMatch(/names no key/)
    expect(issues.join('\n')).toMatch(/"guess" is not a policy/)
    expect(issues.join('\n')).toMatch(/"oneOf" needs a list/)
    expect(issues.join('\n')).toMatch(/depends on the approved file/)
    expect(issues.join('\n')).toMatch(/"added" must be one of/)
    const r = checkChange({ key: ['Missing'] }, TXNS, TXNS)
    expect(r.status).toBe('INVALID')
    expect(r.issues[0]).toMatch(/no key column "Missing"/)
  })

  it('normalising twice changes nothing — a crosswalk survives as a Map', () => {
    const once = normalizeContract({ key: ['id'], fields: { g: { policy: 'map', map: { a: 'b' } } } })
    const twice = normalizeContract({ ...once, fields: Object.fromEntries(once.fields.map((f) => [f.before, f])) })
    expect(twice.fields[0].map.get('a')).toBe('b')
  })

  it('bounds: absolute and percentage limits, and a change from zero is not judged by percentage', () => {
    const f = { direction: 'either', min: null, max: 100, minPercent: null, maxPercent: null }
    expect(outsideBounds(f, 1000, 1100)).toBeNull()
    expect(outsideBounds(f, 1000, 1101)).toMatch(/above the allowed 100/)
    expect(outsideBounds({ ...f, max: null, maxPercent: 10 }, 0, 5)).toMatch(/from zero/)
  })
})

// --- a reconciliation IS a change contract -------------------------------------------------
// Before reconciliation may ever become a view over change checks, the two must
// agree. Here every reconciliation sample runs both ways, and the counts that
// mean the same thing must be equal, field by field.

const SAMPLES = [
  ['the employee migration', migrationSampleObject, migrationSource, migrationTarget],
  ['the opening trial balance', financeSampleObject, financeSource, financeTarget],
]

describe('a reconciliation, run as a change contract, finds exactly what reconcile() finds', () => {
  for (const [name, object, source, target] of SAMPLES) {
    it(name, () => {
      const spec = runnableSpec(object())
      const s = parseCsv(source())
      const t = parseCsv(target())
      const recon = reconcile(spec, s.rows, t.rows, { sourceColumns: s.columns, targetColumns: t.columns })
      const change = checkChange(toChangeContract(spec), s.rows, t.rows, { beforeColumns: s.columns, afterColumns: t.columns })
      expect(change.issues).toEqual([])

      const accuracy = recon.steps.find((st) => st.id === 'accuracy')
      expect(recon.fields.length).toBeGreaterThan(0)
      recon.fields.forEach((rf, i) => {
        const cf = change.fields[i]
        expect(cf.before).toBe(rf.source)
        // agreed = unchanged or allowed (a crosswalked value that arrived as mapped)
        expect(cf.unchanged + cf.allowed).toBe(rf.agreed)
        expect(cf.notAllowed + cf.outOfLimits).toBe(rf.mismatched)
        expect(cf.unmapped).toBe(rf.unmapped)
      })
      expect(change.counts.matched).toBe(recon.counts.matched)
      expect(change.counts.removed).toBe(recon.counts.missing)
      expect(change.counts.added).toBe(recon.counts.extra)
      expect(change.counts.duplicateKeys.before).toBe(recon.counts.duplicateKeys?.source ?? recon.counts.duplicateKeysSource ?? change.counts.duplicateKeys.before)
      expect(accuracy).toBeTruthy()
    })
  }
})
