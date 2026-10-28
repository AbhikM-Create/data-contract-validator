import { describe, expect, it } from 'vitest'
import { isBlank, parseNumber } from './contract.js'

// The original parseNumber, verbatim, before its fast paths were added. The
// fast paths are a performance change only; this holds them to that.
function reference(raw) {
  if (isBlank(raw)) return null
  const cleaned = String(raw).trim().replace(/\p{Sc}/gu, '').replace(/%/g, '').replace(/,/g, '').trim()
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

// Every character class the cleaning or the final pattern treats specially,
// plus the ones the fast paths reason about: ASCII and non-ASCII digits,
// letters either side of e/E, currency symbols, unicode spaces.
const ALPHABET = ['0', '7', '-', '+', '.', 'e', 'E', ',', '%', ' ', ' ', '\t', '$', '€', 'a', 'Z', '/', ':', '٣', '_']

const same = (input) => {
  const got = parseNumber(input)
  const want = reference(input)
  return Object.is(got, want) ? null : { input, got, want }
}

describe('parseNumber fast paths change nothing', () => {
  it('agrees with the original on every string up to length 4 over the alphabet', () => {
    const mismatches = []
    const walk = (prefix, depth) => {
      const m = same(prefix)
      if (m && mismatches.length < 10) mismatches.push(m)
      if (depth === 0) return
      for (const ch of ALPHABET) walk(prefix + ch, depth - 1)
    }
    walk('', 4)
    expect(mismatches).toEqual([])
  })

  it('agrees on 200,000 random longer strings', () => {
    let seed = 12345
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
    const mismatches = []
    for (let i = 0; i < 200_000; i += 1) {
      let s = ''
      const length = 5 + Math.floor(next() * 12)
      for (let j = 0; j < length; j += 1) s += ALPHABET[Math.floor(next() * ALPHABET.length)]
      const m = same(s)
      if (m && mismatches.length < 10) mismatches.push(m)
    }
    expect(mismatches).toEqual([])
  })

  it('agrees on the forms real files hold', () => {
    const forms = [
      '186000', '186,000.00', '"186,000.00"', '$1,200', '€ 99.50', '12%', '-0', '+5', '007', '1e5', '1E-3', '.5', '5.',
      '2024-03-01', '01/03/2024', '2024-03-01T00:00:00Z', 'Okafor', 'Senior Analyst', 'G7', 'N/A', '', '  ', null, undefined,
      0, 42, -3.5, Number.NaN, Infinity, '9'.repeat(400), '1,2,3', '1 000', '- 5', '٣',
    ]
    expect(forms.map(same).filter(Boolean)).toEqual([])
  })
})
