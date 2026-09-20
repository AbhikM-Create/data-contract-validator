import { describe, expect, it } from 'vitest'
import { MIN_BASELINE_ROWS, TYPES, inferContract, parseDate, parseNumber, profileColumn } from './contract.js'

const rows = (n, make) => Array.from({ length: n }, (_, i) => make(i))

describe('parseNumber', () => {
  it('accepts plain, signed, decimal and formatted numbers', () => {
    expect(parseNumber('42')).toBe(42)
    expect(parseNumber('-3.5')).toBe(-3.5)
    expect(parseNumber('$1,204.50')).toBe(1204.5)
    expect(parseNumber('12%')).toBe(12)
  })

  it('rejects text, blanks and half-numeric strings', () => {
    expect(parseNumber('high')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber('12 orders')).toBeNull()
  })
})

describe('parseDate', () => {
  it('reads the common written date forms', () => {
    expect(parseDate('2026-09-13')).toBe(Date.parse('2026-09-13T00:00:00Z'))
    expect(parseDate('2026-09-13T06:30:00Z')).toBe(Date.parse('2026-09-13T06:30:00Z'))
    expect(parseDate('2026/09/13')).not.toBeNull()
  })

  it('does not read bare integers as dates', () => {
    expect(parseDate('20260913')).toBeNull()
    expect(parseDate('1204')).toBeNull()
  })
})

describe('profileColumn', () => {
  it('classifies a repeated small vocabulary as categorical', () => {
    const column = profileColumn('region', rows(40, (i) => ['north', 'south', 'east'][i % 3]))
    expect(column.type).toBe(TYPES.CATEGORICAL)
    expect(column.domain).toEqual(['east', 'north', 'south'])
  })

  it('classifies mostly-unique free text as text, not categorical', () => {
    const column = profileColumn('note', rows(40, (i) => `note number ${i}`))
    expect(column.type).toBe(TYPES.TEXT)
  })

  it('reports null rate and numeric statistics', () => {
    const column = profileColumn('n', ['1', '2', '3', '', '4'])
    expect(column.type).toBe(TYPES.NUMERIC)
    expect(column.nullRate).toBeCloseTo(0.2)
    expect(column.min).toBe(1)
    expect(column.max).toBe(4)
    expect(column.median).toBe(2.5)
  })

  it('tolerates one stray value without changing the column type', () => {
    const values = rows(40, (i) => String(i))
    values[7] = 'N/A'
    expect(profileColumn('n', values).type).toBe(TYPES.NUMERIC)
  })
})

describe('inferContract', () => {
  const daily = rows(20, (i) => ({
    day: `2026-0${i < 9 ? '8' : '9'}-${String((i % 28) + 1).padStart(2, '0')}`,
    amount: String(100 + i),
  }))

  it('picks the date column and its cadence', () => {
    const contract = inferContract(daily)
    expect(contract.dateColumn).toBe('day')
    expect(contract.cadenceMs).toBe(86_400_000)
    expect(contract.sufficient).toBe(true)
  })

  it('reports insufficiency instead of inventing a contract from a handful of rows', () => {
    const contract = inferContract(daily.slice(0, MIN_BASELINE_ROWS - 1))
    expect(contract.sufficient).toBe(false)
    expect(contract.insufficientReason).toMatch(/at least/)
  })

  it('survives an empty baseline', () => {
    const contract = inferContract([])
    expect(contract.sufficient).toBe(false)
    expect(contract.columns).toEqual([])
  })
})
