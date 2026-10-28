// --notify and --ticket: tell a channel how a check came out, and open (or add
// to) a ticket for each thing that failed, routed to the team that fixes it.
//
//   --notify teams,slack     DCV_TEAMS_WEBHOOK, DCV_SLACK_WEBHOOK
//   --ticket jira            JIRA_URL, JIRA_PROJECT, and JIRA_EMAIL + JIRA_API_TOKEN
//                            (Cloud) or JIRA_TOKEN (Data Center personal token);
//                            JIRA_ISSUE_TYPE (default Task)
//   --ticket servicenow      SERVICENOW_URL, and SERVICENOW_USER + SERVICENOW_PASSWORD
//                            or SERVICENOW_TOKEN
//
// Everything is checked BEFORE the check runs, so a misconfigured pipeline
// fails at once rather than after an hour's reconciliation. What is sent is
// built from the run summary — counts, never records (src/lib/notify.js).
// A delivery that fails is reported on stderr and does not change the check's
// exit code: the check itself completed, and its verdict stands.

import { boardMessage, runFindings, runMessage } from '../src/lib/notify.js'
import { DeliveryError, fileJira, fileServiceNow, sendChat } from '../scripts/lib/deliver.mjs'
import { UsageError } from './args.mjs'

export const INTEGRATION_OPTIONS = { notify: { type: 'string' }, ticket: { type: 'string' } }

// A webhook or API base must be https; plain http only to this machine, for
// testing against a local stub.
function endpoint(name, value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new UsageError(`${name} is not a URL.`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new UsageError(`${name} must be an https:// URL.`)
  return value.replace(/\/+$/, '')
}

function required(env, names) {
  const missing = names.filter((n) => !env[n])
  if (missing.length) throw new UsageError(`Set ${missing.join(' and ')} in the environment (credentials are never taken from arguments).`)
}

// readIntegrations(values, env) -> { chat: [{ kind, url }], tickets: [{ kind, ...config }] }
export function readIntegrations(values, env = process.env, { tickets: allowTickets = true } = {}) {
  const list = (text) => String(text ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const chat = list(values.notify).map((kind) => {
    if (kind === 'teams') { required(env, ['DCV_TEAMS_WEBHOOK']); return { kind, url: endpoint('DCV_TEAMS_WEBHOOK', env.DCV_TEAMS_WEBHOOK) } }
    if (kind === 'slack') { required(env, ['DCV_SLACK_WEBHOOK']); return { kind, url: endpoint('DCV_SLACK_WEBHOOK', env.DCV_SLACK_WEBHOOK) } }
    throw new UsageError(`--notify ${kind}: this version can notify teams or slack.`)
  })
  const tickets = list(values.ticket).map((kind) => {
    if (!allowTickets) throw new UsageError('--ticket is for a check; a board is a summary, so it only notifies.')
    if (kind === 'jira') {
      required(env, ['JIRA_URL', 'JIRA_PROJECT'])
      if (!env.JIRA_TOKEN) required(env, ['JIRA_EMAIL', 'JIRA_API_TOKEN'])
      return { kind, url: endpoint('JIRA_URL', env.JIRA_URL), project: env.JIRA_PROJECT, issueType: env.JIRA_ISSUE_TYPE || 'Task', token: env.JIRA_TOKEN, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN }
    }
    if (kind === 'servicenow') {
      required(env, ['SERVICENOW_URL'])
      if (!env.SERVICENOW_TOKEN) required(env, ['SERVICENOW_USER', 'SERVICENOW_PASSWORD'])
      return { kind, url: endpoint('SERVICENOW_URL', env.SERVICENOW_URL), token: env.SERVICENOW_TOKEN, user: env.SERVICENOW_USER, password: env.SERVICENOW_PASSWORD }
    }
    throw new UsageError(`--ticket ${kind}: this version can open tickets in jira or servicenow.`)
  })
  return { chat, tickets }
}

export const hasIntegrations = (config) => config.chat.length > 0 || config.tickets.length > 0

// deliver(config, message, { findings, object }) -> { notes, failures }
async function deliver(config, message, { object } = {}) {
  const notes = []
  const failures = []
  const attempt = async (work) => {
    try {
      notes.push(await work())
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error
      failures.push(error.message)
    }
  }
  for (const target of config.chat) await attempt(() => sendChat(target.kind, target.url, message))
  for (const target of config.tickets) {
    for (const finding of message.findings) {
      await attempt(() => (target.kind === 'jira' ? fileJira : fileServiceNow)(target, finding, message, object))
    }
  }
  return { notes, failures }
}

export function deliverRun(config, run, { object, routing, reference }) {
  if (!run) return { notes: [], failures: [] }
  const message = runMessage(run, { object, routing, reference })
  return deliver(config, { ...message, findings: runFindings(run, routing) }, { object })
}

export function deliverBoard(config, board) {
  return deliver(config, boardMessage(board))
}

// Failures go to stderr whatever the output format, so --json stays parseable.
export function reportDelivery({ notes, failures }, into) {
  into.push(...notes)
  for (const failure of failures) console.error(`Not delivered — ${failure}`)
}
