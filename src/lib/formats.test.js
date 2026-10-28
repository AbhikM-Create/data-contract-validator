import { describe, expect, it } from 'vitest'
import { createReader, decodeBytes, formatIssue, readNumberFully } from './formats.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'
import { checkRules } from './rules.js'
import { validate } from './validate.js'

// Every row of the probe that found these failures, as a pinned test: each of
// these used to give a wrong answer without a word.

const day = (ms) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10))

describe('readers — numbers', () => {
  const eu = createReader({ decimal: ',' })
  const point = createReader({})
  it.each([
    [eu, '1.234,56', 1234.56], [eu, '1,5', 1.5], [eu, '1 234,56', 1234.56], [eu, ' 1.234,56 €', 1234.56],
    [eu, '1.5', null], [eu, '12.34.567,8', null],
    [point, '1,234.56', 1234.56], [point, '1,5', null], [point, "1'234.5", 1234.5],
    [point, '1200-', -1200], [point, '(1,200.00)', -1200], [eu, '(1.200,00)', -1200], [point, '1,2,3', null],
  ])('reads %#: %s', (reader, input, want) => {
    expect(reader.number(input)).toBe(want)
  })
})

describe('readers — dates', () => {
  it.each([
    [{ date: 'DD.MM.YYYY' }, '01.03.2024', '2024-03-01'],
    [{ date: 'DD/MM/YYYY' }, '01/03/2024', '2024-03-01'],
    [{ date: 'MM/DD/YYYY' }, '01/03/2024', '2024-01-03'],
    [{ date: 'YYYYMMDD' }, '20240301', '2024-03-01'],
    [{ date: 'DD-MM-YYYY' }, '01-03-2024', '2024-03-01'],
    [{ date: 'DD.MM.YYYY' }, '2024-03-01', '2024-03-01'], // ISO is always read
    [{ date: 'DD.MM.YYYY' }, '31.02.2024', null], // not a day that exists
    [{}, '01/03/2024', null], // undeclared and ambiguous: not guessed
    [{}, '20240301', null],
  ])('%j reads %s as %s', (format, input, want) => {
    expect(day(createReader(format).date(input))).toBe(want)
  })
})

describe('decoding', () => {
  const latin = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]) // "Müller" in Windows-1252
  it('refuses invalid UTF-8 rather than replacing characters', () => {
    const result = decodeBytes(latin)
    expect(result.text).toBeNull()
    expect(result.error).toMatch(/not valid UTF-8 — most likely it was saved as Windows-1252/)
  })
  it('reads it correctly once the encoding is declared', () => {
    expect(decodeBytes(latin, 'windows-1252')).toEqual({ text: 'Müller', error: null })
  })
  it('strips a UTF-8 byte-order mark', () => {
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).text).toBe('a')
  })
})

describe('formatIssue', () => {
  it('names an unknown part or value', () => {
    expect(formatIssue({ decimal: ';' })).toMatch(/";" is not a known decimal/)
    expect(formatIssue({ thousands: '.' })).toMatch(/"thousands" is not part of a file format/)
    expect(formatIssue({ encoding: 'windows-1252', decimal: ',', date: 'DD.MM.YYYY' })).toBeNull()
  })
})

// --- reconciliation on a German SAP extract against an ISO target -------------

const SAP = [
  { PERNR: '00012345', NACHN: 'Müller', BEGDA: '01.03.2024', ANSAL: '1.234,56' },
  { PERNR: '00012346', NACHN: 'Weiß', BEGDA: '15.11.2019', ANSAL: '98.000,00' },
  { PERNR: '00012347', NACHN: 'Ølund', BEGDA: '02.01.2020', ANSAL: '1200-' },
]
const TARGET = [
  { id: '12345', last: 'MÜLLER', hire: '2024-03-01', pay: '1234.56' },
  { id: '12346', last: 'WEISS', hire: '2019-11-15', pay: '98000' },
  { id: '12347', last: 'ØLUND', hire: '2020-01-02', pay: '-1200' },
]
const SPEC = {
  key: { source: 'PERNR', target: 'id', normalize: ['stripLeadingZeros'] },
  mapping: [{ source: 'BEGDA', target: 'hire' }, { source: 'ANSAL', target: 'pay' }, { source: 'NACHN', target: 'last', ignoreCase: true }],
  totals: [{ source: 'ANSAL', target: 'pay' }],
  formats: { source: { decimal: ',', date: 'DD.MM.YYYY' } },
}

describe('reconciliation reads each side in its own declared format', () => {
  it('matches a zero-padded SAP key, a German date and a German amount to an ISO target', () => {
    const report = reconcile(SPEC, SAP, TARGET)
    expect(report.counts).toMatchObject({ matched: 3, missing: 0, extra: 0, rowsWithDifference: 0 })
    expect(report.status).toBe('PASS')
  })

  it('without the declarations, says the values disagree — it never guesses them equal', () => {
    const report = reconcile({ ...SPEC, key: { source: 'PERNR', target: 'id' }, formats: undefined }, SAP, TARGET)
    expect(report.counts.matched).toBe(0) // keys only match once leading zeros are declared away
    const undeclared = reconcile({ ...SPEC, formats: undefined }, SAP, TARGET)
    expect(undeclared.fields.map((f) => f.mismatched)).toEqual([3, 2, 0]) // every date; both European amounts
  })

  it('catches a day/month swap in flight once the source order is declared', () => {
    const swapped = TARGET.map((row, i) => (i === 2 ? { ...row, hire: '2020-02-01' } : row))
    const report = reconcile(SPEC, SAP, swapped)
    expect(report.findings.find((f) => f.code === 'field-mismatch').examples.map((e) => e.key)).toEqual(['12347'])
  })

  it('does not hide a swap behind a guess when the order is NOT declared', () => {
    // A US-order source: 02/01/2020 is 1 February. The target holds 2 January —
    // swapped in flight. Read month-first by default, the swap would be called
    // correct; read day-first by default, a correct load would be called wrong.
    const src = [{ k: '1', d: '02/01/2020' }]
    const swapped = [{ k: '1', d: '2020-01-02' }]
    const mismatches = (format) => reconcile({ key: 'k', mapping: [{ source: 'd' }], formats: { source: format } }, src, swapped).fields[0].mismatched
    expect(mismatches({})).toBe(1) // undeclared: compared as text, so it is reported, not decided
    expect(mismatches({ date: 'MM/DD/YYYY' })).toBe(1) // declared month-first: the swap is caught
    expect(mismatches({ date: 'DD/MM/YYYY' })).toBe(0) // declared day-first: 2 January really is a match
  })

  it('ties control totals read in each side’s notation, trailing minus included', () => {
    const report = reconcile(SPEC, SAP, TARGET)
    expect(report.totals[0].groups[0]).toMatchObject({ source: 98034.56, target: 98034.56, ties: true })
  })

  it('reports an unknown format or key option instead of ignoring it', () => {
    const bad = reconcile({ ...SPEC, key: { ...SPEC.key, normalize: ['stripLeadingZero'] }, formats: { source: { decimal: ';' } } }, SAP, TARGET)
    expect(bad.status).toBe('INVALID')
    expect(bad.issues).toEqual([
      'The source file format cannot be used: ";" is not a known decimal — use one of ., ,.',
      '"stripLeadingZero" is not a key option — use stripLeadingZeros or ignoreCase.',
    ])
  })

  it('ignores case in keys only when asked', () => {
    const src = [{ k: 'emp-7' }]
    const tgt = [{ k: 'EMP-7' }]
    expect(reconcile({ key: 'k' }, src, tgt).counts.matched).toBe(0)
    expect(reconcile({ key: { source: 'k', target: 'k', normalize: ['ignoreCase'] } }, src, tgt).counts.matched).toBe(1)
  })

  it('leaves a non-numeric key’s leading zero alone', () => {
    expect(reconcile({ key: { source: 'k', target: 'k', normalize: ['stripLeadingZeros'] } }, [{ k: '0A12' }], [{ k: 'A12' }]).counts.matched).toBe(0)
  })
})

describe('load readiness reads the load file in the contract’s format', () => {
  const load = [{ amount: '250.000,00' }, { amount: '1.234,56' }]
  const rule = { kind: 'range', column: 'amount', op: 'between', target: [100, 400000] }
  it('reads 250.000,00 as two hundred and fifty thousand when declared', () => {
    expect(checkReadiness({ rules: [rule], format: { decimal: ',' } }, load).counts.rejected).toBe(0)
  })
  it('without the declaration, refuses to read it rather than calling it 250', () => {
    // Undeclared, "250.000,00" is not a number at all, so the range rule cannot
    // pass it — the record is reported, not silently read as 250.
    expect(checkReadiness({ rules: [rule] }, load).counts.rejected).toBe(2)
  })
})

describe('validate — a rule on a column the file does not have', () => {
  it('is UNCHECKED with the reason, never PASS (rules-only, no schema layer to catch it)', () => {
    const result = validate({ rules: [{ kind: 'valueSet', column: 'grade_code', op: 'in', target: ['A', 'B'] }] }, [{ id: '1', grade: 'A' }, { id: '2', grade: 'Z' }])
    expect(result.rules[0].status).toBe('UNCHECKED')
    expect(result.rules[0].violation.code).toBe('rule:missing-column')
    expect(result.rules[0].violation.message).toMatch(/because the file has no column "grade_code"/)
    expect(result.status).toBe('FAIL')
  })

  it('catches a missing column read only by the WHEN condition too', () => {
    const [outcome] = checkRules([{ kind: 'nullRule', column: 'a', op: 'notNull', when: { column: 'b', op: '=', target: 'x' } }], [{ a: '1' }], { columns: ['a'] })
    expect(outcome.status).toBe('UNCHECKED')
  })
})

describe('rules — a number that cannot be read is not compared as text', () => {
  const rows = [{ v: '250.000,00' }, { v: '120' }, { v: 'n/a' }]
  it('fails a numeric range instead of passing alphabetically', () => {
    const [outcome] = checkRules([{ kind: 'range', column: 'v', op: 'between', target: [100, 400000] }], rows)
    expect(outcome.failures.map((f) => f.value)).toEqual(['250.000,00', 'n/a'])
  })
  it('fails an ordering against a number the same way', () => {
    const [outcome] = checkRules([{ kind: 'comparison', column: 'v', op: '>', target: '0' }], rows)
    expect(outcome.failures.map((f) => f.value)).toEqual(['250.000,00', 'n/a'])
  })
  it('keeps text ranges and text inequality working', () => {
    expect(checkRules([{ kind: 'range', column: 'v', op: 'between', target: ['A', 'Z'] }], [{ v: 'M' }, { v: 'm' }])[0].failures.map((f) => f.value)).toEqual(['m'])
    expect(checkRules([{ kind: 'comparison', column: 'v', op: '!=', target: '5' }], [{ v: 'closed' }])[0].status).toBe('PASS')
  })
})

describe('ignoring case, the Unicode way', () => {
  it('treats Weiß and WEISS as the same name', () => {
    const r = reconcile({ key: 'k', mapping: [{ source: 'n', ignoreCase: true }] }, [{ k: '1', n: 'Weiß' }], [{ k: '1', n: 'WEISS' }])
    expect(r.fields[0].mismatched).toBe(0)
  })
  it('still tells different names apart', () => {
    const r = reconcile({ key: 'k', mapping: [{ source: 'n', ignoreCase: true }] }, [{ k: '1', n: 'Weiß' }], [{ k: '1', n: 'WEIS' }])
    expect(r.fields[0].mismatched).toBe(1)
  })
})

describe('readers — the fast paths change nothing', () => {
  // Every string up to length 4 over an alphabet of the characters the full
  // path treats specially, plus random longer ones: fast and full must agree.
  const ALPHABET = ['0', '7', '-', '+', '.', ',', 'e', 'E', '%', ' ', '\u00A0', '(', ')', "'", '€', 'a', '/', ':']
  it.each(['.', ','])('decimal %s', (decimal) => {
    const reader = createReader({ decimal })
    const mismatches = []
    const walk = (prefix, depth) => {
      const fast = reader.number(prefix)
      const full = readNumberFully(prefix, decimal)
      if (!Object.is(fast, full) && mismatches.length < 10) mismatches.push({ input: prefix, fast, full })
      if (depth > 0) for (const ch of ALPHABET) walk(prefix + ch, depth - 1)
    }
    walk('', 4)
    let seed = 7
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
    for (let i = 0; i < 100_000; i += 1) {
      let text = ''
      for (let j = 0, n = 5 + Math.floor(next() * 10); j < n; j += 1) text += ALPHABET[Math.floor(next() * ALPHABET.length)]
      const fast = reader.number(text)
      const full = readNumberFully(text, decimal)
      if (!Object.is(fast, full) && mismatches.length < 10) mismatches.push({ input: text, fast, full })
    }
    expect(mismatches).toEqual([])
  })
})
