// Notifications and tickets: what a check tells Teams, Slack, Jira and
// ServiceNow. Pure — payloads in, payloads out; the Node layer sends them
// (scripts/lib/deliver.mjs).
//
// Everything here is built from a RUN SUMMARY (migrationObject.js), which
// holds counts, rates and verdicts — never from a report's findings, which
// carry example records (the key, the legacy value G4, the salary). A chat
// channel or a ticket queue is read by far more people than the data. So a
// message says which step failed, how many records, and whose fix it is; the
// evidence pack and the fix list say which records.
//
// Whose fix it is comes from the staircase: each failing step is routed to
// the team the object names for it (`routing`), or to the usual owner.

import { RECON_STEPS } from './reconcile.js'
import { sha256Hex } from './hashing.js'

export const ROUTABLE = [
  { id: 'readiness', label: 'Load readiness', owner: 'The data owners of the load file' },
  ...RECON_STEPS.map((step) => ({
    id: step.id,
    label: `Reconciliation — ${step.label}`,
    owner: {
      keys: 'The migration team (load or extract)',
      completeness: 'The migration team (load or extract)',
      mapping: 'The functional team (mapping specification)',
      accuracy: 'The migration team (transformation)',
      totals: 'The migration team, with the business data owner',
    }[step.id],
  })),
]

// cleanRouting(raw) -> { stepId: team } holding only known steps and short
// text. Saved in the migration object; authored, like the rules.
export function cleanRouting(raw) {
  const out = {}
  for (const { id } of ROUTABLE) {
    const team = typeof raw?.[id] === 'string' ? raw[id].trim().slice(0, 200) : ''
    if (team) out[id] = team
  }
  return out
}

// `team` is the team the object names for this step, or null; `owner` is that
// team or, failing it, the usual owner in words — guidance, not a queue name.
const teamOf = (id, routing) => cleanRouting(routing)[id] ?? null
const ownerOf = (id, routing) => teamOf(id, routing) ?? ROUTABLE.find((r) => r.id === id)?.owner
const n = (value) => (Number.isFinite(value) ? value.toLocaleString('en-US') : '?')
const pct = (share) => (Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : '—')
const where = (object) => [object?.name || 'Untitled object', object?.wave, object?.cycle].filter(Boolean).join(' · ')

// What a failed step means, in counts.
function stepDetail(id, c) {
  switch (id) {
    case 'keys': return `${n(c.duplicateKeys)} duplicate and ${n(c.blankKeys)} blank keys set aside`
    case 'completeness': return `${n(c.missing)} expected records missing, ${n(c.extra)} unexpected in the target`
    case 'mapping': return `${n(c.unmappedRecords)} records carry a legacy value with no target value defined`
    case 'accuracy': return `${n(c.withDifferences)} matched records differ in a mapped field`
    case 'totals': return `${n(c.totalsBroken)} control-total groups no longer tie`
    default: return ''
  }
}

// runFindings(run, routing) -> one entry per thing that failed: a failed
// reconciliation step, or a load file the target would not accept.
export function runFindings(run, routing = {}) {
  if (!run) return []
  if (run.kind === 'readiness') {
    if (run.status === 'READY') return []
    const c = run.counts ?? {}
    return [{
      id: 'readiness',
      title: run.status === 'NOT_READY' ? 'Load file not ready' : 'Load readiness not confirmed',
      detail: run.status === 'NOT_READY'
        ? `${n(c.rejected)} of ${n(c.records)} records would be rejected by the target`
        : `${n(c.checksUnchecked)} rule(s) could not be checked`,
      owner: ownerOf('readiness', routing),
      team: teamOf('readiness', routing),
    }]
  }
  return RECON_STEPS.filter((step) => run.steps?.[step.id] === 'FAIL').map((step) => ({
    id: step.id,
    title: `Reconciliation failed at ${step.label}`,
    detail: stepDetail(step.id, run.counts ?? {}),
    owner: ownerOf(step.id, routing),
    team: teamOf(step.id, routing),
  }))
}

const VERDICT = {
  READY: 'Ready to load', NOT_READY: 'Not ready', UNVERIFIED: 'Not confirmed',
  PASS: 'Reconciled', FAIL: 'Did not reconcile',
}

// runMessage(run, { object, routing, reference }) -> the message for one run.
export function runMessage(run, { object, routing = {}, reference = null } = {}) {
  const ok = run.status === 'READY' || run.status === 'PASS'
  const findings = runFindings(run, routing)
  const c = run.counts ?? {}
  const facts = run.kind === 'readiness'
    ? [['Records', n(c.records)], ['Would be rejected', n(c.rejected)], ['Load with a warning', n(c.warned)], ['Accepted', pct(run.acceptance)]]
    : [['Expected', n(c.expected)], ['Arrived', `${n(c.matched)} (${pct(run.completeness)})`], ['Fully verified', pct(run.accuracy)], ['Out of scope', n(c.outOfScope)]]
  return {
    title: `${run.kind === 'readiness' ? 'Load readiness' : 'Reconciliation'}: ${VERDICT[run.status] ?? run.status} — ${where(object)}`,
    tone: ok ? 'good' : run.status === 'UNVERIFIED' ? 'warning' : 'attention',
    summary: ok
      ? 'Every check passed.'
      : findings.map((f) => `${f.title}: ${f.detail}. Owner: ${f.owner}.`).join(' '),
    facts: [...facts, ...(reference ? [['Evidence', reference]] : [])],
    findings,
    footer: 'Counts only — the records are in the evidence pack and the fix list, which stay with the team.',
  }
}

// boardMessage(board) -> the go/no-go message.
export function boardMessage(board) {
  return {
    title: `Readiness board: ${board.verdict === 'GO' ? (board.withSignoff ? 'Go' : 'Ready') : board.verdict === 'NO_GO' ? 'No-go' : 'Not confirmed'}`,
    tone: board.verdict === 'GO' ? 'good' : board.verdict === 'NO_GO' ? 'attention' : 'warning',
    summary: board.headline,
    facts: board.rows.map((row) => [`${row.name} (${[row.wave, row.cycle].filter(Boolean).join(' ')})`, row.verdict === 'GO' ? 'ready' : row.reasons.join('; ')]),
    findings: [],
    footer: board.withSignoff ? 'Sign-off included.' : 'Sign-off is not part of this board.',
  }
}

// --- chat ------------------------------------------------------------------------

// Microsoft Teams, through a Workflows webhook ("Post to a channel when a
// webhook request is received"): an Adaptive Card in a message envelope.
// The retired Office 365 connectors took another format; this is the current one.
export function teamsPayload(message) {
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: message.title, weight: 'Bolder', size: 'Medium', wrap: true, color: message.tone === 'good' ? 'Good' : message.tone === 'attention' ? 'Attention' : 'Warning' },
          { type: 'TextBlock', text: message.summary, wrap: true },
          ...(message.facts.length ? [{ type: 'FactSet', facts: message.facts.map(([title, value]) => ({ title, value: String(value) })) }] : []),
          { type: 'TextBlock', text: message.footer, wrap: true, isSubtle: true, size: 'Small' },
        ],
      },
    }],
  }
}

// Slack, through an incoming webhook.
export function slackPayload(message) {
  const mark = { good: ':white_check_mark:', attention: ':x:', warning: ':warning:' }[message.tone]
  return {
    text: `${message.title} — ${message.summary}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `${mark} *${slackEscape(message.title)}*\n${slackEscape(message.summary)}` } },
      ...(message.facts.length ? [{ type: 'section', fields: message.facts.slice(0, 10).map(([k, v]) => ({ type: 'mrkdwn', text: `*${slackEscape(k)}*\n${slackEscape(String(v))}` })) }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: slackEscape(message.footer) }] },
    ],
  }
}

// Slack reads &, < and > as markup; everything else is plain.
const slackEscape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// --- tickets -----------------------------------------------------------------------

// ticketKey(objectName, findingId) -> a stable key for one kind of fault on
// one object. The next run that finds the same fault adds to the open ticket
// instead of opening another; once that ticket is closed, a new one opens.
export async function ticketKey(objectName, findingId) {
  return `dcv-${(await sha256Hex(`${objectName ?? ''}\u0000${findingId}`)).slice(0, 12)}`
}

function ticketText(finding, message, object) {
  return [
    `${finding.title} — ${where(object)}.`,
    `${finding.detail}.`,
    `Usual owner: ${finding.owner}.`,
    '',
    ...message.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    message.footer,
    'Raised by data-contract-validator. A later run that finds the same fault adds a comment here.',
  ].join('\n')
}

// Jira: REST API v2 issue creation, which Cloud and Data Center both accept
// with a plain-text description. The key is a label, so a JQL search finds it.
export function jiraIssue(finding, message, { object, project, issueType = 'Task', key }) {
  return {
    fields: {
      project: { key: project },
      issuetype: { name: issueType },
      summary: `${finding.title} — ${where(object)}`.slice(0, 250),
      description: ticketText(finding, message, object),
      labels: [key, 'data-contract-validator'],
    },
  }
}

export function jiraOpenIssueQuery(project, key) {
  return `project = "${project.replace(/"/g, '')}" AND labels = "${key}" AND statusCategory != Done ORDER BY created DESC`
}

// ServiceNow: an incident through the Table API, with the key as its
// correlation_id. The assignment group is set only when the object names a
// team for the step (by name, which sysparm_input_display_value=true lets the
// API resolve); the usual-owner wording is guidance, not a group.
export function serviceNowIncident(finding, message, { object, key }) {
  return {
    short_description: `${finding.title} — ${where(object)}`.slice(0, 160),
    description: ticketText(finding, message, object),
    correlation_id: key,
    correlation_display: 'data-contract-validator',
    ...(finding.team ? { assignment_group: finding.team } : {}),
  }
}

export function repeatNote(finding, message) {
  return `Found again: ${finding.detail}. ${message.facts.map(([k, v]) => `${k}: ${v}`).join(', ')}.`
}
