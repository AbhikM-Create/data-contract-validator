import { describe, expect, it } from 'vitest'
import { emailDomain, readSsoConfig, rememberRoute, returnUrl, ssoProblem, takeRoute } from './sso.js'

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }

describe('single sign-on', () => {
  it('reads which company sign-in a build offers', () => {
    expect(readSsoConfig('')).toEqual({ saml: false, microsoft: false, any: false, passwordForm: true })
    expect(readSsoConfig('saml, Microsoft')).toEqual({ saml: true, microsoft: true, any: true, passwordForm: true })
    expect(readSsoConfig('entra', 'true')).toMatchObject({ microsoft: true, passwordForm: false })
    // Hiding the password form with no SSO configured would lock everyone out.
    expect(readSsoConfig('', 'true').passwordForm).toBe(true)
  })

  it('finds the identity provider by the email’s domain', () => {
    expect(emailDomain(' Ana@Northwind.Example ')).toBe('northwind.example')
    expect(emailDomain('ana@localhost')).toBeNull()
    expect(emailDomain('not an email')).toBeNull()
  })

  it('comes back to this page without its route, then restores the route once', () => {
    expect(returnUrl({ origin: 'https://dcv.example.com', pathname: '/app/', hash: '#/signoff' })).toBe('https://dcv.example.com/app/')
    const storage = memory()
    rememberRoute(storage, '#/signoff')
    expect(takeRoute(storage)).toBe('#/signoff')
    expect(takeRoute(storage)).toBeNull()
    rememberRoute(storage, '#/signin')
    expect(takeRoute(storage)).toBeNull()
    rememberRoute(storage, 'javascript:alert(1)')
    expect(takeRoute(storage)).toBeNull()
  })

  it('says what to do when sign-on cannot start', () => {
    expect(ssoProblem('No SSO provider assigned for this domain', 'contoso.example')).toMatch(/^Single sign-on is not set up for contoso\.example\./)
    expect(ssoProblem('Unsupported provider: provider is not enabled')).toMatch(/Microsoft is not switched on/)
  })
})
