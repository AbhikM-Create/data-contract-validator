import { leadFailingLayer } from './runRecord.js'

// Counting up a person's own saved runs. Pure: no network, no DOM.
//
// This aggregates records the user created by running validations here. It is
// not monitoring: nothing polls, schedules, or watches a data source. The only
// thing it knows about is what someone chose to check.

// A file that fails schema AND distribution is remembered by schema — the step
// it stopped on, which is what the staircase points at. Counting every failing
// layer instead would let one bad file vote four times and make "where do files
// usually stop" unanswerable.
export function summariseRuns(runs, layerOrder) {
  const list = Array.isArray(runs) ? runs : []

  const failingLayerCounts = {}
  let passed = 0
  let failed = 0
  let insufficient = 0

  for (const run of list) {
    if (run.status === 'PASS') passed += 1
    else if (run.status === 'INSUFFICIENT') insufficient += 1
    else failed += 1

    const lead = leadFailingLayer(run, layerOrder)
    if (lead) failingLayerCounts[lead] = (failingLayerCounts[lead] ?? 0) + 1
  }

  const ranked = Object.entries(failingLayerCounts).sort((a, b) => b[1] - a[1])

  return {
    total: list.length,
    passed,
    failed,
    insufficient,
    failingLayerCounts,
    // Null rather than a guess when nothing has failed, or when two layers are
    // tied: "most common" is not a fact you can report about a tie.
    mostCommonFailingLayer: ranked.length === 0 || (ranked[1] && ranked[1][1] === ranked[0][1]) ? null : ranked[0][0],
    tiedFailingLayers: ranked.length > 1 && ranked[1][1] === ranked[0][1]
      ? ranked.filter(([, count]) => count === ranked[0][1]).map(([id]) => id)
      : [],
  }
}

// The contracts these runs were checked against, for the filter. Runs made
// without a saved contract are grouped under a null id.
export function contractsInRuns(runs) {
  const seen = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    const key = run.contract_id ?? '__none__'
    if (!seen.has(key)) {
      seen.set(key, { key, name: run.contract_name ?? 'No saved contract', count: 0 })
    }
    seen.get(key).count += 1
  }
  return [...seen.values()].sort((a, b) => b.count - a.count)
}
