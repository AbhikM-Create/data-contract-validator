import { describe, expect, it } from 'vitest'
import { cleanOwners, cleanSignoff, DEFAULT_OWNERS, ownersOf, signoffIsEmpty } from './signoff.js'
import { migrationObjectToJson, newMigrationObject, parseMigrationObjectFile } from './migrationObject.js'

describe('owners', () => {
  it('default per step; only overrides are saved', () => {
    expect(ownersOf({}).mapping).toBe(DEFAULT_OWNERS.mapping)
    expect(ownersOf({ owners: { mapping: 'Priya' } }).mapping).toBe('Priya')
    expect(cleanOwners({ mapping: 'Priya', keys: DEFAULT_OWNERS.keys, bogus: 'x' })).toEqual({ mapping: 'Priya' })
  })
})

describe('the sign-off record as saved', () => {
  it('keeps typed strings in known fields only, bounded', () => {
    const clean = cleanSignoff({
      identity: { entity: 'Invented Pvt Ltd', secret: 'x' },
      custody: { load: { exportedBy: 'A. Rao' }, '../../etc': { exportedBy: 'x' } },
      exceptions: { 'reconcile|mapping|unmapped-value|grade': { disposition: 'accepted', reason: 'ok', rows: [{ name: 'OKAFOR' }] }, x: { disposition: 'nonsense' } },
      signatures: { preparedBy: { name: 'A. Rao', date: '2027-04-02', extra: 'x' }, ceo: { name: 'x' } },
      scope: 'y'.repeat(5000),
      report: { findings: [] },
    })
    expect(clean.identity).toEqual({ entity: 'Invented Pvt Ltd' })
    expect(clean.custody).toEqual({ load: { exportedBy: 'A. Rao' } })
    expect(clean.exceptions).toEqual({ 'reconcile|mapping|unmapped-value|grade': { disposition: 'accepted', reason: 'ok' } })
    expect(clean.signatures).toEqual({ preparedBy: { name: 'A. Rao', date: '2027-04-02' } })
    expect(clean.scope).toHaveLength(2000)
    expect(JSON.stringify(clean)).not.toMatch(/OKAFOR|findings/)
  })

  it('round-trips with the object file; an empty record is not written', () => {
    const object = { ...newMigrationObject('Employees'), owners: { mapping: 'Priya' }, signoff: { identity: { entity: 'Invented Pvt Ltd' }, custody: {}, exceptions: {}, scope: '', signatures: {} } }
    const json = JSON.parse(migrationObjectToJson(object))
    expect(json.owners).toEqual({ mapping: 'Priya' })
    expect(json.signoff.identity).toEqual({ entity: 'Invented Pvt Ltd' })
    const back = parseMigrationObjectFile(JSON.stringify(json)).object
    expect(back.signoff.identity.entity).toBe('Invented Pvt Ltd')
    expect(JSON.parse(migrationObjectToJson(newMigrationObject('x'))).signoff).toBeUndefined()
    expect(signoffIsEmpty(undefined)).toBe(true)
  })
})
