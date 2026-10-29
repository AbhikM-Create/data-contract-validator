import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'
import { project, SUPABASE } from './standin.js'

// Runs against the second build (playwright.config.js), configured for a
// Supabase project at 127.0.0.1:54399 with SAML and Microsoft sign-in. Nothing
// listens there: this file answers the project's requests in the browser, so
// the real Supabase client runs the real PKCE redirect flow end to end — only
// the identity provider's own login page is skipped.

test('SAML: the email’s domain picks the identity provider, and the person lands back where they were, signed in', async ({ page }) => {
  const errors = watchErrors(page)
  const sent = await project(page)
  await page.goto('/#/signoff')
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click()
  await expect(page.getByText('Sign in with your company account')).toBeVisible()
  await page.getByLabel('Work email').fill('Ana@Northwind.example')
  await page.getByRole('button', { name: 'Continue with SSO' }).click()

  await expect(page.getByText('ana@northwind.example').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign-off', exact: true })).toBeVisible()
  expect(new URL(page.url()).search).toBe('') // the one-time code is gone from the address bar
  expect(new URL(page.url()).hash).toBe('#/signoff')

  const start = sent.find((r) => r.path === '/auth/v1/sso').body
  expect(start.domain).toBe('northwind.example')
  expect(start.code_challenge_method).toBe('s256')
  expect(start.code_challenge).toMatch(/^[\w-]{43}$/)
  expect(start.redirect_to).toMatch(/^http:\/\/localhost:4175\/(\?|$)/) // no #/route for the code to land behind
  const exchange = sent.find((r) => r.path === '/auth/v1/token')
  expect(exchange.body).toMatchObject({ auth_code: 'one-time-code' })
  expect(exchange.body.code_verifier).toMatch(/^[\w-]{43,128}$/)
  expect(errors).toEqual([])
})

test('Microsoft: Entra ID through Supabase’s Azure provider, with a PKCE challenge', async ({ page }) => {
  await project(page)
  let authorize = null
  await page.route(`${SUPABASE}/auth/v1/authorize**`, (route) => {
    authorize = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>identity provider</p>' })
  })
  await page.goto('/#/signin')
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click()
  await expect(page.getByText('identity provider')).toBeVisible()
  expect(authorize.searchParams.get('provider')).toBe('azure')
  expect(authorize.searchParams.get('scopes')).toBe('email')
  expect(authorize.searchParams.get('code_challenge_method')).toBe('s256')
  expect(authorize.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
})

test('a domain with no identity provider gets a sentence, not a dead end', async ({ page }) => {
  await project(page, { ssoStatus: 404 })
  await page.goto('/#/signin')
  await page.getByLabel('Work email').fill('sam@contoso.example')
  await page.getByRole('button', { name: 'Continue with SSO' }).click()
  await expect(page.getByText(/^Single sign-on is not set up for contoso\.example\./)).toBeVisible()
  // The password form is still offered: VITE_SSO_ONLY is not set in this build.
  await expect(page.getByText('Or with an email and password:')).toBeVisible()
})

// With an account service, the same control offers the real thing.
test('accounts on: the header offers a sign-in, and the screens ask for one', async ({ page }) => {
  await project(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Accounts off' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByLabel('Work email')).toBeVisible()

  await page.goto('/#/signoff')
  await expect(page.getByText('Sign in to work with your organisation')).toBeVisible()
  await expect(page.getByText('Accounts are not set up in this copy')).toHaveCount(0)
})
