// A stand-in for a Supabase project, answered inside the browser with
// page.route, for the build configured to use one (playwright.config.js).
// Auth runs the real PKCE flow; REST answers come from the test's `rest`
// function ({ method, path, query, body, single }) -> { status?, data } | null.

export const SUPABASE = 'http://127.0.0.1:54399'
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)
export const user = { id: 'a0000000-0000-4000-8000-00000000000a', aud: 'authenticated', role: 'authenticated', email: 'ana@northwind.example', app_metadata: { provider: 'sso:northwind' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' }
const session = () => ({
  access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now() + 3600, iat: now() })}.sig`,
  token_type: 'bearer', expires_in: 3600, expires_at: now() + 3600, refresh_token: 'refresh-1', user,
})

// The stand-in project. Returns what the client sent, for the test to check.
export async function project(page, { ssoStatus = 200, rest = () => null } = {}) {
  const sent = []
  await page.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postData() ? JSON.parse(request.postData()) : null
    sent.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/auth/v1/sso') {
      if (ssoStatus !== 200) return json(ssoStatus, { code: 'sso_provider_not_found', msg: 'No SSO provider assigned for this domain' })
      // The identity provider would sign the person in, then send them back
      // to redirect_to with a one-time code.
      const back = new URL(body.redirect_to)
      back.searchParams.set('code', 'one-time-code')
      return json(200, { url: back.toString() })
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') return json(200, session())
    if (url.pathname === '/auth/v1/user') return json(200, user)
    if (url.pathname.startsWith('/rest/v1/')) {
      const answer = rest({ method: request.method(), path: url.pathname.slice('/rest/v1/'.length), query: url.searchParams, body, single: /pgrst\.object/.test(request.headers().accept ?? '') })
      return json(answer?.status ?? 200, answer ? answer.data : [])
    }
    return json(404, {})
  })
  return sent
}


// Signs in through SAML, the way a person would.
export async function signIn(page) {
  await page.goto('/#/signin')
  await page.getByLabel('Work email').fill(user.email)
  await page.getByRole('button', { name: 'Continue with SSO' }).click()
  await page.getByText(user.email).first().waitFor()
}
