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

// --- freshness: a schedule versus a series of events -------------------------
// A median gap exists for both a daily feed and a column of hire dates, and
// only one of them says anything about when the next row should arrive.
describe('freshness only judges staleness when the dates have a rhythm', () => {
  // The exact gap distribution of the real HR snapshots this was verified
  // against: 17 to 472 days apart, scoring 0.69 scatter.
  const GAPS = [17, 28, 31, 45, 50, 61, 61, 61, 61, 70, 75, 78, 92, 92, 153, 257, 472]
  const eventGaps = GAPS.reduce((acc, gap) => [...acc, acc[acc.length - 1] + gap], [0])
  const SPAN = eventGaps[eventGaps.length - 1]
  const eventDates = (endOffsetDays) => eventGaps.map((gap, i) => ({
    effective_from: new Date(NOW - (endOffsetDays + SPAN - gap) * DAY).toISOString().slice(0, 10),
    person: `P-${i % 4}`,
    amount: String(100 + i),
  }))

  it('does not call a file late when the dates are events, not a schedule', () => {
    const contract = inferContract(eventDates(400))
    const result = validate(contract, eventDates(300), { now: NOW })

    expect(layer(result, 'freshness').status).toBe('SKIPPED')
    expect(layer(result, 'freshness').note).toMatch(/business dates arriving irregularly/)
    expect(codes(result)).not.toContain('stale')
  })

  it('still catches a file that went backwards, which needs no cadence', () => {
    const contract = inferContract(eventDates(300))
    const result = validate(contract, eventDates(600), { now: NOW })

    expect(codes(result)).toContain('went-backwards')
    expect(layer(result, 'freshness').status).toBe('FAIL')
  })

  it('still calls a scheduled feed late — the regular case is unchanged', () => {
    const contract = inferContract(feed())
    const stale = feed().map((row, i) => ({
      ...row,
      day: new Date(NOW - (60 - i) * DAY).toISOString().slice(0, 10),
    }))
    const result = validate(contract, stale, { now: NOW })

    expect(codes(result)).toContain('stale')
    expect(layer(result, 'freshness').status).toBe('FAIL')
  })

  it('measures a perfectly regular feed as having no scatter at all', () => {
    expect(inferContract(feed()).cadenceSpread).toBe(0)
  })
})

// --- null-rate: data that stopped arriving versus a conditional column --------
describe('a null-rate jump is read against the rest of the row', () => {
  const closed = (count = 20) => Array.from({ length: count }, (_, i) => ({
    day: new Date(NOW - (count - i) * DAY).toISOString().slice(0, 10),
    ended_on: new Date(NOW - (count - i) * DAY + DAY).toISOString().slice(0, 10),
    is_current: 'N',
    amount: String(100 + i),
  }))

  it('says nothing when the blanks belong to a kind of row the baseline never had', () => {
    // Every new row is current, and a current record has no end date. Semantics
    // reports the new "Y"; distribution must not report the same event again as
    // data that stopped arriving.
    const candidate = closed().map((row) => ({ ...row, ended_on: '', is_current: 'Y' }))
    const result = validate(inferContract(closed()), candidate, { now: NOW })

    expect(codes(result)).not.toContain('null-rate')
    expect(layer(result, 'distribution').status).toBe('PASS')
    expect(layer(result, 'semantics').status).toBe('FAIL')
  })

  it('names the condition when the blanks follow a value the baseline already had', () => {
    const baseline = closed().map((row, i) => ({ ...row, is_current: i % 2 ? 'Y' : 'N' }))
    const candidate = baseline.map((row) => (row.is_current === 'Y' ? { ...row, ended_on: '' } : row))
    const result = validate(inferContract(baseline), candidate, { now: NOW })

    const nullRate = result.violations.find((v) => v.code === 'null-rate')
    expect(nullRate.message).toMatch(/blank wherever "is_current" is "Y"/)
    expect(nullRate.evidence).toMatch(/blank where is_current = Y/)
  })

  it('still reports blanks that nothing in the row explains', () => {
    const baseline = closed()
    const candidate = closed().map((row, i) => (i % 2 ? { ...row, ended_on: '' } : row))
    const result = validate(inferContract(baseline), candidate, { now: NOW })

    const nullRate = result.violations.find((v) => v.code === 'null-rate')
    expect(nullRate.message).toMatch(/Something upstream has stopped populating it/)
  })

  // Without this guard, whichever value is most common would "explain" any
  // column that had gone mostly blank.
  it('does not accept a merely frequent value as an explanation', () => {
    const baseline = closed().map((row, i) => ({ ...row, region: i < 18 ? 'north' : 'south' }))
    const candidate = baseline.map((row, i) => (i % 2 ? { ...row, ended_on: '' } : row))
    const result = validate(inferContract(baseline), candidate, { now: NOW })

    const nullRate = result.violations.find((v) => v.code === 'null-rate')
    expect(nullRate.message).toMatch(/Something upstream has stopped populating it/)
  })
})
