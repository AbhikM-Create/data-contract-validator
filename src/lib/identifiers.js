// Named identifier formats for the `identifier` rule kind (v3 §5.1). A closed
// list, never a free pattern: an author picks "GSTIN", not a regular
// expression, so there is no expression language by another name, and the check
// character is verified where the format has one — a pattern alone would accept
// a GSTIN with one digit mistyped.
//
// Adding a format is an engine change: a reason, reference vectors and a
// mutation test (identifiers.test.js).
//
// Values are compared as written, after trimming: letters must be capitals, as
// the issuing authorities write them. A lowercase PAN is reported, not fixed.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Luhn mod N over ALPHABET (N = 36), the check-character scheme GSTIN uses.
// Valid when the weighted sum over the whole string, check character included,
// is a multiple of N.
function luhnMod36(text) {
  const n = ALPHABET.length
  let sum = 0
  let factor = 1
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const point = ALPHABET.indexOf(text[i])
    if (point < 0) return false
    let addend = factor * point
    addend = Math.floor(addend / n) + (addend % n)
    sum += addend
    factor = factor === 1 ? 2 : 1
  }
  return sum % n === 0
}

// PAN: five letters, four digits, a letter. The fourth letter is the holder's
// status (P person, C company, H HUF, F firm, A AOP, T trust, B BOI, L local
// authority, J artificial juridical person, G government).
const PAN = /^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$/

export const IDENTIFIERS = {
  pan: {
    label: 'PAN',
    describe: 'a valid PAN (e.g. ABCPE1234F)',
    test: (v) => PAN.test(v),
  },
  gstin: {
    label: 'GSTIN',
    describe: 'a valid GSTIN, check character included',
    // Two-digit state code, the holder's PAN, an entity number, the letter Z,
    // and a Luhn mod-36 check character.
    test: (v) => /^[0-9]{2}[A-Z0-9]{10}[1-9A-Z]Z[0-9A-Z]$/.test(v)
      && v.slice(0, 2) !== '00'
      && PAN.test(v.slice(2, 12))
      && luhnMod36(v),
  },
  ifsc: {
    label: 'IFSC',
    describe: 'a valid IFSC (four letters, 0, then six letters or digits)',
    test: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v),
  },
  uan: {
    label: 'UAN',
    describe: 'a valid UAN (12 digits)',
    test: (v) => /^[0-9]{12}$/.test(v),
  },
  pin: {
    label: 'PIN code',
    describe: 'a valid Indian PIN code (6 digits, not starting with 0)',
    test: (v) => /^[1-9][0-9]{5}$/.test(v),
  },
}

export const IDENTIFIER_NAMES = Object.keys(IDENTIFIERS)

// isIdentifier(name, value) -> true / false, or null for an unknown format.
export function isIdentifier(name, value) {
  const format = IDENTIFIERS[name]
  if (!format) return null
  return format.test(String(value ?? '').trim())
}
