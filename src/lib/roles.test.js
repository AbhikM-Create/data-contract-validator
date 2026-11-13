import { describe, expect, it } from 'vitest'
import { can, cleanEmail, looksLikeEmail, ROLE_IDS, ROLES, roleLabel } from './roles.js'

// What each role may do on screen must match what the policies allow
// (supabase/tests/rls.sql exercises the same matrix against the database).
describe('roles', () => {
  it('four roles, each with a label and a sentence', () => {
    expect(ROLE_IDS).toEqual(['admin', 'editor', 'approver', 'viewer'])
    for (const role of ROLES) expect(role.can.length).toBeGreaterThan(10)
    expect(roleLabel('approver')).toBe('Approver')
    expect(roleLabel('owner')).toBe('owner')
  })

  it('the rights matrix', () => {
    const matrix = Object.fromEntries(ROLE_IDS.map((role) => [role, ['read', 'save', 'delete', 'manageMembers'].filter((action) => can(role, action))]))
    expect(matrix).toEqual({
      admin: ['read', 'save', 'delete', 'manageMembers'],
      editor: ['read', 'save'],
      approver: ['read', 'save'],
      viewer: ['read'],
    })
    expect(can('owner', 'read')).toBe(false)
    expect(can('admin', 'fly')).toBe(false)
    expect(can(null, 'read')).toBe(false)
  })

  it('emails are compared trimmed and lower-cased, and must look like one', () => {
    expect(cleanEmail('  Bob@Example.com ')).toBe('bob@example.com')
    expect(looksLikeEmail('bob@example.com')).toBe(true)
    expect(looksLikeEmail('bob@example')).toBe(false)
    expect(looksLikeEmail('')).toBe(false)
  })
})
