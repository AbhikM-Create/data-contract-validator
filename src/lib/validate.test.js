import { describe, expect, it } from 'vitest'
import { inferContract } from './contract.js'
import { validate } from './validate.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-09-13T12:00:00Z')

// 30 daily rows ending the day before NOW.
function feed(overrides = {}, count = 30) {
  return Array.from({ length: count }, (_, i) => {
    const stamp = NOW - (count - i) * DAY
    const row = {
      day: new Date(stamp).toISOString().slice(0, 10),
      region: ['north', 'south', 'east'][i % 3],
      revenue: String(1000 + (i % 7) * 50),
      orders: String(100 + (i % 5)),
    }
    return typeof overrides === 'function' ? overrides(row, i) : { ...row, ...overrides }
  })
}

const layer = (result, id) => result.layers.find((l) => l.id === id)
const codes = (result) => result.violations.map((v) => v.code)

describe('validate', () => {
  const contract = inferContract(feed())

  it('passes a candidate that matches the contract', () => {
    const result = validate(contract, feed(), { now: NOW })
    expect(result.status).toBe('PASS')
    expect(result.layers.every((l) => l.status === 'PASS')).toBe(true)
    expect(result.headline.text).toBe('All four layers pass')
  })

  it('catches missing, extra and retyped columns in the schema layer', () => {
    const candidate = feed().map(({ revenue, ...rest }) => ({ ...rest, revenue_usd: revenue, orders: 'many' }))
    const result = validate(contract, candidate, { now: NOW })
    expect(layer(result, 'schema').status).toBe('FAIL')
    expect(codes(result)).toEqual(expect.arrayContaining(['missing-column', 'extra-column', 'type-change']))
    expect(result.headline.layerLabel).toBe('Schema')
    expect(result.headline.passedAbove).toEqual([])
  })

  it('catches an unseen category in the semantics layer', () => {
    const candidate = feed((row, i) => ({ ...row, region: i % 3 === 0 ? 'central' : row.region }))
    const result = validate(contract, candidate, { now: NOW })
    expect(layer(result, 'schema').status).toBe('PASS')
    expect(layer(result, 'semantics').status).toBe('FAIL')
    expect(codes(result)).toContain('new-category')
  })

  it('reads a clean x100 rescale as a unit change, not a distribution anomaly', () => {
    const candidate = feed((row) => ({ ...row, revenue: String(Number(row.revenue) * 100) }))
    const result = validate(contract, candidate, { now: NOW })
    expect(codes(result)).toContain('unit-shift')
    expect(layer(result, 'semantics').status).toBe('FAIL')
  })

  it('reads an arbitrary 83x jump as a distribution break that the layers above pass', () => {
    const candidate = feed((row, i) => ({ ...row, revenue: String(Number(row.revenue) * 83.4 * (1 + (i % 5) / 200)) }))
    const result = validate(contract, candidate, { now: NOW })

    expect(layer(result, 'schema').status).toBe('PASS')
    expect(layer(result, 'semantics').status).toBe('PASS')
    expect(layer(result, 'freshness').status).toBe('PASS')
    expect(layer(result, 'distribution').status).toBe('FAIL')
    expect(codes(result)).toEqual(expect.arrayContaining(['central-shift', 'out-of-range']))
    expect(result.headline.text).toBe('Distribution caught what Schema, Semantics and Freshness let through')
  })

  it('flags a stale candidate against the baseline cadence', () => {
    const stale = validate(contract, feed(), { now: NOW + 10 * DAY })
    expect(layer(stale, 'freshness').status).toBe('FAIL')
    expect(codes(stale)).toContain('stale')
  })

  it('flags a candidate whose newest row predates the baseline', () => {
    const older = feed().map((row) => ({ ...row, day: new Date(Date.parse(`${row.day}T00:00:00Z`) - 60 * DAY).toISOString().slice(0, 10) }))
    const result = validate(contract, older, { now: NOW })
    expect(codes(result)).toContain('went-backwards')
  })

  it('skips freshness when the baseline has no date column', () => {
    const dropDay = (rows) => rows.map(({ day: _day, ...rest }) => rest)
    const undated = inferContract(dropDay(feed()))
    const result = validate(undated, dropDay(feed()), { now: NOW })
    expect(layer(result, 'freshness').status).toBe('SKIPPED')
    expect(result.status).toBe('PASS')
  })

  it('flags row-count collapse and null-rate jumps', () => {
    const candidate = feed({}, 10).map((row, i) => (i < 5 ? { ...row, revenue: '' } : row))
    const result = validate(contract, candidate, { now: NOW })
    expect(codes(result)).toEqual(expect.arrayContaining(['row-count', 'null-rate']))
  })

  it('honours tuned thresholds', () => {
    const candidate = feed((row) => ({ ...row, revenue: String(Number(row.revenue) * 4) }))
    expect(layer(validate(contract, candidate, { now: NOW }), 'distribution').status).toBe('FAIL')
    const lenient = validate(contract, candidate, { now: NOW, thresholds: { centralShiftFactor: 10, outOfRangeShare: 1 } })
    expect(layer(lenient, 'distribution').status).toBe('PASS')
  })

  it('reports INSUFFICIENT rather than a verdict when there is nothing to judge', () => {
    expect(validate(contract, [], { now: NOW }).status).toBe('INSUFFICIENT')
    expect(validate(inferContract([]), feed(), { now: NOW }).status).toBe('INSUFFICIENT')
    expect(validate(null, feed(), { now: NOW }).status).toBe('INSUFFICIENT')
  })

  it('skips distribution when the candidate is too small to have a shape', () => {
    const result = validate(contract, feed({}, 3), { now: NOW })
    expect(layer(result, 'distribution').status).toBe('SKIPPED')
  })

  it('gives every violation a plain-language sentence', () => {
    const candidate = feed((row, i) => ({ ...row, revenue: String(Number(row.revenue) * 83), region: i === 0 ? 'central' : row.region }))
    const result = validate(contract, candidate, { now: NOW })
    expect(result.violations.length).toBeGreaterThan(0)
    for (const v of result.violations) {
      expect(v.message.length).toBeGreaterThan(40)
      expect(v.message.trim()).toMatch(/\.$/)
    }
  })
})
