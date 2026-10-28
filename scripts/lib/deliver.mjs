// Sending what notify.js builds: chat webhooks, Jira issues, ServiceNow
// incidents. Node only (fetch is built into Node 20+).
//
// Credentials come from the environment, never from arguments: arguments are
// printed in CI logs and in an evidence pack's "how to re-run" line. Nothing
// here prints a URL with its token, a password or a response body — a failed
// call is reported by its HTTP status.

import {
  jiraIssue, jiraOpenIssueQuery, repeatNote, serviceNowIncident, slackPayload, teamsPayload, ticketKey,
} from '../../src/lib/notify.js'

const TIMEOUT_MS = 20_000

export class DeliveryError extends Error {}

async function call(url, { method = 'GET', headers = {}, body } = {}, what) {
  let response
  try {
    response = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new DeliveryError(`${what}: could not reach ${new URL(url).host} (${error.name === 'TimeoutError' ? 'timed out' : error.cause?.code ?? error.message})`)
  }
  return response
}

async function expectOk(response, what) {
  if (response.ok) return response.status === 204 ? null : response.json().catch(() => null)
  const hint = { 401: 'check the credentials', 403: 'the account lacks permission', 404: 'check the URL or project', 400: 'the server refused the content' }[response.status]
  throw new DeliveryError(`${what}: HTTP ${response.status}${hint ? ` — ${hint}` : ''}`)
}

// --- chat ------------------------------------------------------------------------

export async function sendChat(kind, url, message) {
  const payload = kind === 'teams' ? teamsPayload(message) : slackPayload(message)
  const what = kind === 'teams' ? 'Teams' : 'Slack'
  await expectOk(await call(url, { method: 'POST', body: payload }, what), what)
  return `${what}: posted “${message.title}”`
}

// --- Jira --------------------------------------------------------------------------

const jiraAuth = (c) => (c.token
  ? { authorization: `Bearer ${c.token}` }
  : { authorization: `Basic ${Buffer.from(`${c.email}:${c.apiToken}`).toString('base64')}` })

// The open issue for this key, if any. Jira Cloud retired /rest/api/2/search
// for /rest/api/3/search/jql; Data Center still has only the former. Try the
// current endpoint, and fall back when the server does not know it.
async function findJiraIssue(c, key) {
  const jql = encodeURIComponent(jiraOpenIssueQuery(c.project, key))
  const headers = jiraAuth(c)
  let response = await call(`${c.url}/rest/api/3/search/jql?jql=${jql}&fields=key&maxResults=1`, { headers }, 'Jira search')
  if (response.status === 404) response = await call(`${c.url}/rest/api/2/search?jql=${jql}&fields=key&maxResults=1`, { headers }, 'Jira search')
  const found = await expectOk(response, 'Jira search')
  return found?.issues?.[0]?.key ?? null
}

export async function fileJira(c, finding, message, object) {
  const key = await ticketKey(object?.name, finding.id)
  const headers = jiraAuth(c)
  const open = await findJiraIssue(c, key)
  if (open) {
    await expectOk(await call(`${c.url}/rest/api/2/issue/${encodeURIComponent(open)}/comment`, { method: 'POST', headers, body: { body: repeatNote(finding, message) } }, 'Jira comment'), 'Jira comment')
    return `Jira: added to ${open} (${finding.title})`
  }
  const created = await expectOk(await call(`${c.url}/rest/api/2/issue`, { method: 'POST', headers, body: jiraIssue(finding, message, { object, project: c.project, issueType: c.issueType, key }) }, 'Jira'), 'Jira')
  return `Jira: opened ${created?.key ?? 'an issue'} (${finding.title})`
}

// --- ServiceNow ------------------------------------------------------------------------

const serviceNowAuth = (c) => (c.token
  ? { authorization: `Bearer ${c.token}` }
  : { authorization: `Basic ${Buffer.from(`${c.user}:${c.password}`).toString('base64')}` })

export async function fileServiceNow(c, finding, message, object) {
  const key = await ticketKey(object?.name, finding.id)
  const headers = serviceNowAuth(c)
  const query = encodeURIComponent(`correlation_id=${key}^active=true`)
  const found = await expectOk(await call(`${c.url}/api/now/table/incident?sysparm_query=${query}&sysparm_fields=sys_id,number&sysparm_limit=1`, { headers }, 'ServiceNow search'), 'ServiceNow search')
  const open = found?.result?.[0]
  if (open) {
    await expectOk(await call(`${c.url}/api/now/table/incident/${encodeURIComponent(open.sys_id)}`, { method: 'PATCH', headers, body: { work_notes: repeatNote(finding, message) } }, 'ServiceNow update'), 'ServiceNow update')
    return `ServiceNow: added to ${open.number} (${finding.title})`
  }
  const created = await expectOk(await call(`${c.url}/api/now/table/incident?sysparm_input_display_value=true`, { method: 'POST', headers, body: serviceNowIncident(finding, message, { object, key }) }, 'ServiceNow'), 'ServiceNow')
  return `ServiceNow: opened ${created?.result?.number ?? 'an incident'} (${finding.title})`
}
