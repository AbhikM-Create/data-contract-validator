import { describe, expect, it } from 'vitest'
import { IDENTIFIER_NAMES, isIdentifier } from './identifiers.js'

// Reference vectors for GSTIN are python-stdnum's documented examples
// (stdnum.in_.gstin, read 2026-11-03): one valid number and one of each failure.
describe('identifiers — GSTIN', () => {
  it.each([
    ['27AAPFU0939F1ZV', true], // valid
    ['27AAPFU0939F1Z', false], // too short
    ['369296450896540', false], // not the format
    ['27AAPFU0939F1AA', false], // 14th character is not Z
    ['27AAPFU0939F1ZO', false], // wrong check character
  ])('%s -> %s', (value, want) => {
    expect(isIdentifier('gstin', value)).toBe(want)
  })

  // The point of a check character: any single mistyped character is caught.
  it('every single-character change to a valid GSTIN is refused', () => {
    const valid = '27AAPFU0939F1ZV'
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const accepted = []
    for (let i = 0; i < valid.length; i += 1) {
      for (const ch of alphabet) {
        if (ch === valid[i]) continue
        const mutated = valid.slice(0, i) + ch + valid.slice(i + 1)
        if (isIdentifier('gstin', mutated)) accepted.push(mutated)
      }
    }
    expect(accepted).toEqual([])
  })

  it('is case- and space-strict the way the portal writes it, after trimming', () => {
    expect(isIdentifier('gstin', ' 27AAPFU0939F1ZV ')).toBe(true)
    expect(isIdentifier('gstin', '27aapfu0939f1zv')).toBe(false)
    expect(isIdentifier('gstin', '00AAPFU0939F1ZV')).toBe(false)
  })
})

describe('identifiers — PAN, IFSC, UAN, PIN code', () => {
  it.each([
    ['pan', 'ABCPE1234F', true], ['pan', 'AAPFU0939F', true], ['pan', 'ABCXE1234F', false], ['pan', 'ABCPE1234', false], ['pan', 'abcpe1234f', false],
    ['ifsc', 'HDFC0001234', true], ['ifsc', 'SBIN0ABC123', true], ['ifsc', 'HDFC1001234', false], ['ifsc', 'HDF00001234', false],
    ['uan', '100123456789', true], ['uan', '10012345678', false], ['uan', '10012345678A', false],
    ['pin', '560001', true], ['pin', '060001', false], ['pin', '56000', false],
  ])('%s %s -> %s', (name, value, want) => {
    expect(isIdentifier(name, value)).toBe(want)
  })

  it('the list is closed: an unknown name is not a check that passes', () => {
    expect(IDENTIFIER_NAMES).toEqual(['pan', 'gstin', 'ifsc', 'uan', 'pin'])
    expect(isIdentifier('aadhaar', '123412341234')).toBeNull()
  })
})
