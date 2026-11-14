import { describe, expect, it } from 'vitest'
import { checkChange } from './changeContract.js'
import { changeContractToJson, cleanChangeContract, parseChangeContractFile, readChangeContract } from './changeContractFile.js'

const REVISION = {
  name: 'Salary revision',
  key: ['Emp Code'],
  approved: { key: ['Emp Code'] },
  changeLog: { key: ['Emp Code'] },
  added: 'none',
  removed: 'any',
  scope: { before: { column: 'Status', op: '=', target: 'Active' } },
  fields: {
    Basic: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved', when: { column: 'Grade', op: '!=', target: 'Grade', targetIsColumn: true } },
    Grade: { policy: 'map', map: { G5: 'Senior' } },
    Category: { policy: 'oneOf', values: ['Travel', 'Meals'], ignoreCase: true },
    'Tax Code': { policy: 'oneOf', reference: 'codes:Code' },
    'New Basic': { policy: 'asApproved', approvedColumn: 'New Basic' },
  },
  totals: [{ column: 'Basic', compare: 'delta', max: 100000 }],
  formats: { before: { decimal: ',' }, after: { decimal: '.' } },
}

describe('change contract files', () => {
  it('round-trips every field a contract has, exactly', () => {
    const opened = parseChangeContractFile(changeContractToJson(REVISION))
    expect(opened.error).toBeUndefined()
    expect(opened.contract).toEqual(REVISION)
  })

  it('drops what a contract does not hold — a hand-edited file cannot smuggle values in', () => {
    const planted = {
      ...REVISION,
      approvedRows: [{ 'Emp Code': 'E1', Basic: '987654' }],
      notes: 'Asha Rao 987654',
      fields: { Basic: { policy: 'free', example: '987654' } },
      totals: [{ column: 'Basic', before: 987654 }],
    }
    const json = changeContractToJson(planted)
    expect(json).not.toMatch(/987654|Asha/)
  })

  it('reads a bare contract (what a person writes for dcv change) the same as the file form', () => {
    expect(readChangeContract(REVISION).contract).toEqual(readChangeContract(JSON.parse(changeContractToJson(REVISION))).contract)
  })

  it('refuses another format, another version, and text that is not JSON — with the reason', () => {
    expect(readChangeContract({ format: 'data-contract-validator/migration-object', contract: {} }).error).toMatch(/not a change contract file/)
    expect(readChangeContract({ format: 'data-contract-validator/change-contract', version: 9, contract: {} }).error).toMatch(/version 9/)
    expect(parseChangeContractFile('{ nope').error).toMatch(/could not be read as JSON/)
  })

  it('keeps an unknown policy as preserve, the safe reading, and an unknown operator for the engine to refuse', () => {
    const c = cleanChangeContract({ key: 'id', fields: { a: { policy: 'whatever' }, b: { policy: 'free', when: { column: 'x', op: '~', target: '1' } } } })
    expect(c.fields.a.policy).toBe('preserve')
    expect(c.fields.b.when.op).toBe('~')
  })

  it('checks the same after a save and an open', () => {
    const before = [{ 'Emp Code': 'E1', Basic: '50000' }, { 'Emp Code': 'E2', Basic: '61000' }]
    const after = [{ 'Emp Code': 'E1', Basic: '65000' }, { 'Emp Code': 'E2', Basic: '61000' }]
    const contract = { key: ['Emp Code'], fields: { Basic: { policy: 'bounded', direction: 'up', maxPercent: 20 } } }
    const reopened = parseChangeContractFile(changeContractToJson(contract)).contract
    expect(checkChange(reopened, before, after)).toEqual(checkChange(contract, before, after))
  })
})
