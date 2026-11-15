import { describe, expect, it } from 'vitest'
import { checkChange } from '../lib/changeContract.js'
import { selfChecked, missingForFinal } from '../lib/changeCustody.js'
import { parseCsv } from '../lib/parseCsv.js'
import { changeAfter, changeApproved, changeBefore, changeContract, changeCustody } from './changeSample.js'

// The salary-revision sample's story, pinned step by step like the other
// examples: the bureau changed a bank account it was never allowed to touch,
// and raised one approved Basic past the cap. Everything else is as approved.

const rows = (text) => parseCsv(text).rows
const run = (approved = rows(changeApproved)) => checkChange(changeContract, rows(changeBefore), rows(changeAfter), { approved })
const step = (report, id) => report.steps.find((s) => s.id === id)

describe('the salary revision sample', () => {
  it('is not allowed, and stops at permitted fields', () => {
    const r = run()
    expect(r.status).toBe('NOT_ALLOWED')
    expect(r.steps.map((s) => `${s.id}:${s.status}`)).toEqual(['keys:PASS', 'coverage:PASS', 'permitted:FAIL', 'limits:FAIL', 'approvals:PASS', 'totals:SKIPPED'])
  })

  it('catches the bank account nobody allowed to change, at permitted fields', () => {
    const f = step(run(), 'permitted').findings
    expect(f.map((x) => `${x.code}:${x.column}`)).toEqual(['changed-not-allowed:Bank Account'])
    expect(f[0].examples.map((e) => e.key)).toEqual(['E103'])
  })

  it('catches the 30% rise against a 20% cap, at limits', () => {
    const f = step(run(), 'limits').findings
    expect(f.map((x) => `${x.code}:${x.column}`)).toEqual(['out-of-limits:Basic'])
    expect(f[0].examples[0]).toMatchObject({ key: 'E106', reason: expect.stringMatching(/30%, above the allowed 20%/) })
  })

  it('every approved revision arrived as approved; without the list it is not confirmed', () => {
    expect(step(run(), 'approvals').findings).toEqual([])
    expect(run(null).status).not.toBe('ALLOWED')
  })

  it('is independent as stated: the bureau neither wrote the contract nor exported the files', () => {
    expect(selfChecked(changeCustody)).toEqual([])
    expect(missingForFinal(changeCustody)).toEqual([])
  })
})
