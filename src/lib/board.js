// The readiness board: every migration object's latest cycle in one view, for
// the go/no-go meeting. Pure — migration objects (and, when there is an
// organisation, its sign-off submissions) in, a board out.
//
// It reads only what the objects already store: run summaries, which hold
// counts, rates and verdicts. So the board can be built from a folder of
// *.migration.json files by the CLI, or in the page, and says the same thing.
//
// The verdict is strict on purpose, like readiness:
//   GO             both checks ran in the cycle and passed, and — when sign-off
//                  is part of the board — the cycle was accepted after them
//   NO_GO          a check failed, or the cycle was rejected
//   NOT_CONFIRMED  anything else: a check that did not run, could not confirm,
//                  or a sign-off that is missing or older than the latest check.
//                  Never call that go.

import { RECON_STEPS } from './reconcile.js'

export const BOARD_VERSION = 1
export const VERDICTS = ['GO', 'NO_GO', 'NOT_CONFIRMED']
// The order the meeting reads them in: what failed, what is unconfirmed, what is ready.
const RANK = { NO_GO: 0, NOT_CONFIRMED: 1, GO: 2 }

const sameCycle = (run, wave, cycle) => (run.wave ?? null) === (wave ?? null) && (run.cycle ?? null) === (cycle ?? null)
const latest = (runs) => [...runs].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null
const label = (wave, cycle) => [wave, cycle].filter(Boolean).join(' ') || 'no cycle named'

// The latest run of a kind in an EARLIER cycle than `current` — the "is it
// getting better?" comparison the PMO asks for.
function previousOf(runs, current) {
  if (!current) return null
  return latest(runs.filter((r) => r.kind === current.kind && !sameCycle(r, current.wave, current.cycle) && String(r.at) < String(current.at)))
}

function readinessCell(run, previous) {
  if (!run) return { ran: false, status: 'NOT_RUN', verdict: 'NOT_CONFIRMED', reason: 'load readiness was not checked in this cycle' }
  const c = run.counts ?? {}
  const verdict = run.status === 'READY' ? 'GO' : run.status === 'NOT_READY' ? 'NO_GO' : 'NOT_CONFIRMED'
  return {
    ran: true,
    status: run.status,
    at: run.at,
    verdict,
    acceptance: run.acceptance ?? null,
    change: Number.isFinite(run.acceptance) && Number.isFinite(previous?.acceptance) ? run.acceptance - previous.acceptance : null,
    previousCycle: previous ? label(previous.wave, previous.cycle) : null,
    records: c.records ?? null,
    rejected: c.rejected ?? null,
    reason: verdict === 'GO' ? null
      : verdict === 'NO_GO' ? `${c.rejected ?? 'some'} of ${c.records ?? '?'} records would be rejected`
        : 'load readiness could not confirm every rule',
  }
}

function reconcileCell(run, previous) {
  if (!run) return { ran: false, status: 'NOT_RUN', verdict: 'NOT_CONFIRMED', reason: 'reconciliation was not run in this cycle' }
  const failing = RECON_STEPS.find((step) => run.steps?.[step.id] === 'FAIL') ?? null
  const verdict = run.status === 'PASS' ? 'GO' : run.status === 'FAIL' ? 'NO_GO' : 'NOT_CONFIRMED'
  return {
    ran: true,
    status: run.status,
    at: run.at,
    verdict,
    stoppedAt: failing?.id ?? null,
    completeness: run.completeness ?? null,
    accuracy: run.accuracy ?? null,
    change: Number.isFinite(run.completeness) && Number.isFinite(previous?.completeness) ? run.completeness - previous.completeness : null,
    previousCycle: previous ? label(previous.wave, previous.cycle) : null,
    reason: verdict === 'GO' ? null
      : verdict === 'NO_GO' ? `reconciliation stopped at ${failing?.label ?? 'a step'}`
        : 'reconciliation could not confirm every step',
  }
}

// The latest submission for this object and cycle, and whether it still
// covers the checks: a sign-off made before the latest check signed off
// something else.
function signoffCell(object, submissions, checks) {
  const own = submissions.filter((s) => s.subject && s.objectName === object.name && (s.wave ?? null) === (object.wave ?? null) && (s.cycle ?? null) === (object.cycle ?? null))
  const last = [...own].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0]
  if (!last) return { state: 'none', verdict: 'NOT_CONFIRMED', reason: 'nothing was submitted for sign-off in this cycle' }
  const newestCheck = checks.filter(Boolean).map((r) => String(r.at)).sort().pop()
  const covers = !newestCheck || String(last.subject.generatedAt ?? '') >= newestCheck
  const base = { state: last.state, reference: last.reference, submittedAt: last.submittedAt, decisions: last.decisions.length }
  if (last.state === 'rejected') return { ...base, verdict: 'NO_GO', reason: `sign-off ${last.reference} was rejected` }
  if (last.state === 'awaiting') return { ...base, verdict: 'NOT_CONFIRMED', reason: `sign-off ${last.reference} is awaiting a decision` }
  if (!covers) return { ...base, verdict: 'NOT_CONFIRMED', stale: true, reason: `a check ran after sign-off ${last.reference}` }
  return { ...base, verdict: 'GO', withExceptions: last.state === 'accepted-with-exceptions', reason: null }
}

const worst = (verdicts) => (verdicts.includes('NO_GO') ? 'NO_GO' : verdicts.every((v) => v === 'GO') ? 'GO' : 'NOT_CONFIRMED')

// boardRow(object, { submissions, withSignoff }) -> one object's line.
export function boardRow(object, { submissions = [], withSignoff = false } = {}) {
  const runs = Array.isArray(object.runs) ? object.runs : []
  const inCycle = runs.filter((r) => sameCycle(r, object.wave, object.cycle))
  const readinessRun = latest(inCycle.filter((r) => r.kind === 'readiness'))
  const reconcileRun = latest(inCycle.filter((r) => r.kind === 'reconcile'))
  const readiness = readinessCell(readinessRun, previousOf(runs, readinessRun))
  const reconciliation = reconcileCell(reconcileRun, previousOf(runs, reconcileRun))
  const signoff = withSignoff ? signoffCell(object, submissions, [readinessRun, reconcileRun]) : null
  const parts = [readiness, reconciliation, ...(signoff ? [signoff] : [])]
  const verdict = worst(parts.map((p) => p.verdict))
  // Failures first: the reason a NO_GO is a NO_GO is what the meeting needs.
  const reasons = [...parts.filter((p) => p.verdict === 'NO_GO'), ...parts.filter((p) => p.verdict === 'NOT_CONFIRMED')].map((p) => p.reason)
  return {
    name: object.name || 'Untitled object',
    wave: object.wave ?? null,
    cycle: object.cycle ?? null,
    verdict,
    reasons,
    readiness,
    reconciliation,
    signoff,
  }
}

// buildBoard(objects, { submissions }) -> the board.
//
// `submissions` (from the organisation, read by orgRecords.readSubmission)
// makes sign-off part of every verdict. Without it the board judges the checks
// alone, and says so — a board that passes without sign-off has not been
// signed off.
export function buildBoard(objects, { submissions = null } = {}) {
  const withSignoff = Array.isArray(submissions)
  const rows = (objects ?? []).map((o) => boardRow(o, { submissions: submissions ?? [], withSignoff }))
    .sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || a.name.localeCompare(b.name))
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => r.verdict === v).length]))
  const verdict = rows.length ? worst(rows.map((r) => r.verdict)) : 'NOT_CONFIRMED'
  return {
    version: BOARD_VERSION,
    verdict,
    withSignoff,
    counts,
    rows,
    headline: headline(verdict, rows, counts, withSignoff),
  }
}

function headline(verdict, rows, counts, withSignoff) {
  const n = rows.length
  if (!n) return 'No migration objects on the board.'
  const objects = `${n} object${n === 1 ? '' : 's'}`
  if (verdict === 'GO') {
    return withSignoff
      ? `Go: all ${objects} passed both checks in their current cycle and were signed off after them.`
      : `All ${objects} passed both checks in their current cycle. Sign-off is not part of this board, so this is not yet a go.`
  }
  if (verdict === 'NO_GO') {
    return `No-go: ${counts.NO_GO} of ${objects} failed${counts.NOT_CONFIRMED ? `, and ${counts.NOT_CONFIRMED} could not be confirmed` : ''}.`
  }
  return `Not confirmed: ${counts.NOT_CONFIRMED} of ${objects} could not be confirmed${counts.GO ? `; ${counts.GO} ${counts.GO === 1 ? 'is' : 'are'} ready` : ''}.`
}
