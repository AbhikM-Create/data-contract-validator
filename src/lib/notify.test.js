import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { buildBoard } from './board.js'
import { runnableSpec, summariseReadiness, summariseReconciliation } from './migrationObject.js'
import {
  boardMessage, cleanRouting, jiraIssue, runFindings, runMessage, serviceNowIncident, slackPayload, teamsPayload, ticketKey,
} from './notify.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

const object = { ...migrationSampleObject(), routing: { mapping: 'HR functional team', readiness: 'HR data stewards' } }
const [src, tgt, load] = [migrationSource(), migrationTarget(), migrationLoadFile()].map(parseCsv)
const recon = reconcile(runnableSpec(object), src.rows, tgt.rows, { sourceColumns: src.columns, targetColumns: tgt.columns, exampleLimit: 1000 })
const ready = checkReadiness(object.contract, load.rows, { columns: load.columns, key: ['employee_id'] })
const reconRun = summariseReconciliation(recon, { wave: object.wave, cycle: object.cycle, sourceName: 'legacy.csv', targetName: 'target.csv' })
const readyRun = summariseReadiness(ready, { wave: object.wave, cycle: object.cycle, fileName: 'load.csv' })

describe('what a failed check says, and to whom', () => {
  it('one finding per failed step, routed to the team the object names, or to the usual owner', () => {
    expect(runFindings(reconRun, object.routing).map((f) => [f.id, f.owner, f.team])).toEqual([
      ['mapping', 'HR functional team', 'HR functional team'],
      ['accuracy', 'The migration team (transformation)', null],
      ['totals', 'The migration team, with the business data owner', null],
    ])
    expect(runFindings(reconRun, object.routing)[0].detail).toBe('3 records carry a legacy value with no target value defined')
    expect(runFindings(readyRun, object.routing)).toEqual([{ id: 'readiness', title: 'Load file not ready', detail: '2 of 46 records would be rejected by the target', owner: 'HR data stewards', team: 'HR data stewards' }])
  })

  it('a passing run has nothing to ticket', () => {
    expect(runFindings({ ...readyRun, status: 'READY' })).toEqual([])
    expect(runMessage({ ...readyRun, status: 'READY' }, { object }).summary).toBe('Every check passed.')
  })

  it('routing keeps only known steps and short text', () => {
    expect(cleanRouting({ mapping: '  HR  ', bogus: 'x', keys: 7, totals: '' })).toEqual({ mapping: 'HR' })
  })
})

describe('the data boundary — channels and tickets carry counts, never records', () => {
  it('no value from the files reaches any payload, though the report quotes them', () => {
    const quoted = new Set()
    for (const finding of recon.findings) {
      for (const example of finding.examples) {
        for (const value of [example.key, example.value, example.source, example.target, example.expected]) {
          if (typeof value === 'string' && value.length > 1) quoted.add(value)
        }
      }
    }
    for (const check of ready.checks) for (const example of check.examples) quoted.add(example.record)
    for (const total of recon.totals) for (const group of total.groups) quoted.add(group.group)
    for (const row of [...src.rows, ...load.rows]) for (const v of Object.values(row)) if (String(v).length > 4) quoted.add(String(v))
    // Negative control: the report itself carries them, in its examples.
    expect(JSON.stringify(recon.findings.map((f) => f.examples))).toMatch(/G4/)

    const message = runMessage(reconRun, { object, routing: object.routing, reference: 'EV-AAAA-0000-0001' })
    const readyMessage = runMessage(readyRun, { object, routing: object.routing })
    const payloads = JSON.stringify([
      teamsPayload(message), slackPayload(message), teamsPayload(readyMessage), slackPayload(readyMessage),
      ...message.findings.map((f) => jiraIssue(f, message, { object, project: 'MIG', key: 'dcv-x' })),
      ...message.findings.map((f) => serviceNowIncident(f, message, { object, key: 'dcv-x' })),
      ...readyMessage.findings.map((f) => serviceNowIncident(f, readyMessage, { object, key: 'dcv-x' })),
    ])
    const authored = new Set(['Associate', 'Analyst', 'Senior Analyst', 'Lead', 'US01', 'DE01'])
    expect(quoted.size).toBeGreaterThan(40)
    expect([...quoted].filter((v) => !authored.has(v) && payloads.includes(v))).toEqual([])
    expect(payloads).not.toMatch(/\bG4\b/)
  })
})

describe('payloads', () => {
  const message = runMessage(reconRun, { object, routing: object.routing })

  it('Teams: an Adaptive Card in a Workflows message envelope', () => {
    const p = teamsPayload(message)
    expect(p.type).toBe('message')
    expect(p.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(p.attachments[0].content).toMatchObject({ type: 'AdaptiveCard', version: '1.4' })
    expect(p.attachments[0].content.body[0]).toMatchObject({ text: 'Reconciliation: Did not reconcile — Employees · Wave 1 · Mock 2', color: 'Attention' })
  })

  it('Slack: escapes the three characters Slack reads as markup', () => {
    const p = slackPayload({ ...message, title: 'A <b> & c' })
    expect(p.blocks[0].text.text).toContain('A &lt;b&gt; &amp; c')
  })

  it('Jira and ServiceNow: the key is how a later run finds the open ticket; a group only when one is named', async () => {
    const key = await ticketKey('Employees', 'mapping')
    expect(key).toMatch(/^dcv-[0-9a-f]{12}$/)
    expect(await ticketKey('Employees', 'mapping')).toBe(key)
    expect(await ticketKey('Employees', 'accuracy')).not.toBe(key)
    const [mapping, accuracy] = message.findings
    expect(jiraIssue(mapping, message, { object, project: 'MIG', key }).fields).toMatchObject({ project: { key: 'MIG' }, issuetype: { name: 'Task' }, labels: [key, 'data-contract-validator'] })
    expect(serviceNowIncident(mapping, message, { object, key })).toMatchObject({ correlation_id: key, assignment_group: 'HR functional team' })
    expect(serviceNowIncident(accuracy, message, { object, key })).not.toHaveProperty('assignment_group')
  })

  it('the board message names each object’s state', () => {
    const board = buildBoard([{ ...object, runs: [readyRun, reconRun].map((r) => ({ ...r, at: '2026-10-20T09:00:00Z' })) }])
    const m = boardMessage(board)
    expect(m.title).toBe('Readiness board: No-go')
    expect(m.facts).toEqual([['Employees (Wave 1 Mock 2)', '2 of 46 records would be rejected; reconciliation stopped at Mapping']])
  })
})
