// --notify and --ticket against a local stand-in for Teams, Slack, Jira (Cloud
// and Data Center) and ServiceNow: what is sent, to which endpoint, with which
// credentials — and that a second run adds to the open ticket instead of
// opening another, and no record from the files is ever on the wire.

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrationObjectToJson } from '../src/lib/migrationObject.js'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../src/samples/migrationSample.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'dcv-notify-'))
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p }
const object = file('employees.migration.json', migrationObjectToJson({ ...migrationSampleObject(), routing: { mapping: 'HR functional team' } }))
const source = file('legacy.csv', migrationSource())
const target = file('target.csv', migrationTarget())
const load = file('load.csv', migrationLoadFile())

// --- the stand-in ------------------------------------------------------------------
let requests = []
let jira = new Map() // label -> key
let incidents = new Map() // correlation_id -> { sys_id, number }
let refuse = null

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const url = new URL(req.url, 'http://x')
    const json = body ? JSON.parse(body) : null
    requests.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization ?? null, body: json })
    const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(payload === undefined ? '' : JSON.stringify(payload)) }
    if (refuse && url.pathname.startsWith(refuse.prefix)) return send(refuse.status, { errorMessages: ['nope'] })
    const label = /labels = "(dcv-[0-9a-f]{12})"/.exec(decodeURIComponent(url.search))?.[1]
    const p = url.pathname
    if (p === '/teams') return send(202)
    if (p === '/slack') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok') }
    // Jira Cloud has only the new search; the /dc prefix plays Data Center, which has only the old one.
    if (p === '/rest/api/3/search/jql' || p === '/dc/rest/api/2/search') return send(200, { issues: jira.has(label) ? [{ key: jira.get(label) }] : [] })
    if (p === '/dc/rest/api/3/search/jql') return send(404, { errorMessages: ['not found'] })
    if (p.endsWith('/rest/api/2/issue') && req.method === 'POST') {
      const key = `MIG-${jira.size + 1}`
      jira.set(json.fields.labels[0], key)
      return send(201, { key })
    }
    if (/\/rest\/api\/2\/issue\/MIG-\d+\/comment$/.test(p)) return send(201, { id: '1' })
    if (p === '/api/now/table/incident' && req.method === 'GET') {
      const id = /correlation_id=(dcv-[0-9a-f]{12})/.exec(decodeURIComponent(url.search))?.[1]
      return send(200, { result: incidents.has(id) ? [incidents.get(id)] : [] })
    }
    if (p === '/api/now/table/incident' && req.method === 'POST') {
      const created = { sys_id: `s${incidents.size + 1}`, number: `INC00${incidents.size + 1}` }
      incidents.set(json.correlation_id, created)
      return send(201, { result: created })
    }
    if (p.startsWith('/api/now/table/incident/') && req.method === 'PATCH') return send(200, { result: {} })
    return send(404, {})
  })
})
let base
beforeAll(() => new Promise((resolve) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve() })))
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })
beforeEach(() => { requests = []; jira = new Map(); incidents = new Map(); refuse = null })

// Asynchronous, so the stand-in can answer while the command runs.
const dcv = (args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [join(root, 'bin/dcv.mjs'), ...args], { cwd: dir, env: { PATH: process.env.PATH, ...env } }, (error, out, err) => {
    resolve({ code: error ? error.code : 0, out, err })
  })
})
const jiraCloud = () => ({ JIRA_URL: base, JIRA_PROJECT: 'MIG', JIRA_EMAIL: 'ci@example.com', JIRA_API_TOKEN: 'secret-token' })

describe('--notify and --ticket', () => {
  it('posts to Teams and Slack, opens one Jira issue per failed step, and keeps the check’s exit code', async () => {
    const r = await dcv(['reconcile', object, source, target, '--notify', 'teams,slack', '--ticket', 'jira'], { DCV_TEAMS_WEBHOOK: `${base}/teams`, DCV_SLACK_WEBHOOK: `${base}/slack`, ...jiraCloud() })
    expect(r.code).toBe(1)
    expect(r.err).toBe('')
    const teams = requests.find((q) => q.path === '/teams').body
    expect(teams.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(requests.find((q) => q.path === '/slack').body.text).toMatch(/^Reconciliation: Did not reconcile — Employees/)
    const created = requests.filter((q) => q.path === '/rest/api/2/issue')
    expect(created.map((q) => q.body.fields.summary)).toEqual([
      'Reconciliation failed at Mapping — Employees · Wave 1 · Mock 2',
      'Reconciliation failed at Accuracy — Employees · Wave 1 · Mock 2',
      'Reconciliation failed at Totals — Employees · Wave 1 · Mock 2',
    ])
    expect(created[0].body.fields.description).toMatch(/Usual owner: HR functional team\./)
    expect(created[0].auth).toBe(`Basic ${Buffer.from('ci@example.com:secret-token').toString('base64')}`)
    expect(r.out).toMatch(/Jira: opened MIG-1 \(Reconciliation failed at Mapping\)/)
    expect(r.out + r.err).not.toMatch(/secret-token/)
  })

  it('a second run that finds the same faults adds to the open issues instead of opening more', async () => {
    const env = jiraCloud()
    await dcv(['reconcile', object, source, target, '--ticket', 'jira'], env)
    requests = []
    const r = await dcv(['reconcile', object, source, target, '--ticket', 'jira'], env)
    expect(requests.filter((q) => q.path === '/rest/api/2/issue')).toHaveLength(0)
    expect(requests.filter((q) => q.path.endsWith('/comment')).map((q) => q.path)).toEqual([
      '/rest/api/2/issue/MIG-1/comment', '/rest/api/2/issue/MIG-2/comment', '/rest/api/2/issue/MIG-3/comment',
    ])
    expect(r.out).toMatch(/Jira: added to MIG-1/)
  })

  it('Jira Data Center: a personal token, and the older search endpoint when the new one is not there', async () => {
    const r = await dcv(['check', object, load, '--ticket', 'jira'], { JIRA_URL: `${base}/dc`, JIRA_PROJECT: 'MIG', JIRA_TOKEN: 'pat-123' })
    expect(r.code).toBe(1)
    expect(requests.map((q) => q.path)).toEqual(['/dc/rest/api/3/search/jql', '/dc/rest/api/2/search', '/dc/rest/api/2/issue'])
    expect(requests.every((q) => q.auth === 'Bearer pat-123')).toBe(true)
    expect(requests[2].body.fields.summary).toBe('Load file not ready — Employees · Wave 1 · Mock 2')
  })

  it('ServiceNow: an incident per failed step, assigned only where the object names a team, then work notes', async () => {
    const env = { SERVICENOW_URL: base, SERVICENOW_USER: 'svc', SERVICENOW_PASSWORD: 'pw' }
    await dcv(['reconcile', object, source, target, '--ticket', 'servicenow'], env)
    const created = requests.filter((q) => q.path === '/api/now/table/incident' && q.method === 'POST')
    expect(created).toHaveLength(3)
    expect(created[0].query).toBe('?sysparm_input_display_value=true')
    expect(created[0].body.assignment_group).toBe('HR functional team')
    expect(created[1].body).not.toHaveProperty('assignment_group')
    requests = []
    const again = await dcv(['reconcile', object, source, target, '--ticket', 'servicenow'], env)
    expect(requests.filter((q) => q.method === 'PATCH').map((q) => Object.keys(q.body))).toEqual([['work_notes'], ['work_notes'], ['work_notes']])
    expect(again.out).toMatch(/ServiceNow: added to INC001/)
  })

  it('nothing from the files is on the wire — only counts', async () => {
    await dcv(['reconcile', object, source, target, '--notify', 'teams,slack', '--ticket', 'jira'], { DCV_TEAMS_WEBHOOK: `${base}/teams`, DCV_SLACK_WEBHOOK: `${base}/slack`, ...jiraCloud() })
    await dcv(['check', object, load, '--ticket', 'servicenow'], { SERVICENOW_URL: base, SERVICENOW_TOKEN: 't' })
    const wire = JSON.stringify(requests.map((q) => [q.query, q.body]))
    expect(requests.length).toBeGreaterThan(8)
    expect(wire).not.toMatch(/4011[0-9]|4013[0-9]|Okafor|OKAFOR|Haddad|G4\b|8125050|81,250/)
  })

  it('a delivery that fails is reported on stderr, with no secret, and the verdict stands', async () => {
    refuse = { prefix: '/rest/api', status: 401 }
    const r = await dcv(['reconcile', object, source, target, '--ticket', 'jira'], jiraCloud())
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/Not delivered — Jira search: HTTP 401 — check the credentials/)
    expect(r.err).not.toMatch(/secret-token/)
  })

  it('refuses a missing credential or a plain-http remote endpoint before running anything', async () => {
    const missing = await dcv(['reconcile', object, source, target, '--ticket', 'jira'], { JIRA_URL: base, JIRA_PROJECT: 'MIG' })
    expect(missing.code).toBe(2)
    expect(missing.err).toMatch(/Set JIRA_EMAIL and JIRA_API_TOKEN in the environment/)
    const plain = await dcv(['check', object, load, '--notify', 'teams'], { DCV_TEAMS_WEBHOOK: 'http://hooks.example.com/x' })
    expect(plain.code).toBe(2)
    expect(plain.err).toMatch(/DCV_TEAMS_WEBHOOK must be an https:\/\/ URL/)
    expect((await dcv(['check', object, load, '--notify', 'email'], {})).err).toMatch(/can notify teams or slack/)
    expect(requests).toHaveLength(0)
  })

  it('the board notifies, and does not open tickets', async () => {
    const r = await dcv(['board', object, '--notify', 'teams'], { DCV_TEAMS_WEBHOOK: `${base}/teams` })
    expect(r.code).toBe(2)
    expect(requests[0].body.attachments[0].content.body[0].text).toBe('Readiness board: Not confirmed')
    expect((await dcv(['board', object, '--ticket', 'jira'], jiraCloud())).err).toMatch(/a board is a summary, so it only notifies/)
  })
})
