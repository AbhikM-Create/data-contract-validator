import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATES, accountNotice, accountState, headerAccount } from './accounts.js'

const SURFACES = ['contracts', 'history', 'signoff']

describe('the account state', () => {
  it('is a property of the deployment first, then of the person', () => {
    expect(accountState({ configured: false, user: { email: 'a@b.c' } })).toBe('unavailable')
    expect(accountState({ configured: true, loading: true })).toBe('loading')
    expect(accountState({ configured: true, user: null })).toBe('signed-out')
    expect(accountState({ configured: true, user: { email: 'a@b.c' } })).toBe('signed-in')
    expect(accountState()).toBe('unavailable')
  })
})

describe('the header control', () => {
  it('is never empty — a control that disappears teaches nothing', () => {
    for (const state of ACCOUNT_STATES) {
      const control = headerAccount(state, 'ana@northwind.example')
      expect(control).toBeTruthy()
      expect(control.label).toBeTruthy()
    }
  })

  it('offers an explanation where it cannot offer a sign-in', () => {
    expect(headerAccount('signed-out')).toMatchObject({ kind: 'action', label: 'Sign in', to: 'signin' })
    expect(headerAccount('unavailable')).toMatchObject({ kind: 'action', label: 'Accounts off', to: 'signin' })
    expect(headerAccount('unavailable').title).toMatch(/no account service configured/)
    expect(headerAccount('signed-in', 'ana@northwind.example')).toEqual({ kind: 'account', label: 'ana@northwind.example', action: 'Sign out' })
    expect(headerAccount('loading').kind).toBe('waiting')
  })
})

describe('what each screen says instead', () => {
  it('says nothing once there is content to show', () => {
    for (const surface of SURFACES) {
      expect(accountNotice('signed-in', surface)).toBeNull()
      expect(accountNotice('loading', surface)).toBeNull()
    }
  })

  it('asks for a sign-in only when signing in is possible', () => {
    for (const surface of SURFACES) {
      expect(accountNotice('signed-out', surface).cta.label).toBe('Sign in')
      // The header and the screen agree: neither claims a sign-in this
      // deployment cannot do.
      expect(accountNotice('unavailable', surface).cta.label).toBe('What an account adds')
      expect(accountNotice('unavailable', surface).title).toBe('Accounts are not set up in this copy')
    }
  })

  it('always names what an account adds AND what works without one', () => {
    for (const state of ['signed-out', 'unavailable']) {
      for (const surface of SURFACES) {
        expect(accountNotice(state, surface).body).toMatch(/Without one/)
      }
    }
    expect(accountNotice('unavailable', 'signoff').body).toMatch(/sign it on paper/)
    expect(accountNotice('unavailable', 'contracts').body).toMatch(/keep them as a file/)
  })
})
