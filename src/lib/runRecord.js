// Turning a validation result into a record safe to store. Pure: no network.
//
// THIS IS THE DATA BOUNDARY. A violation's message and evidence quote real
// values out of the file being checked —
//
//   "…and 1 row of 22 breaks that."   evidence: row 21: Consumer
//   "The typical value in "revenue_usd" is 86.3× larger… median 9,608,791.1"
//
// — so storing them would put HR records and revenue figures in Postgres while
// the page still promises the data never leaves the browser. This module keeps
// the shape of a finding (which layer, which check, which column, how many rows)
// and drops every string that could carry a value.
//
// Column names are kept deliberately: a column name is schema, not data, and
// the saved contract already contains them.

// Fields copied from a violation. Note what is absent: message, evidence, rule
// targets. If a field is added to violations later it is NOT stored unless it
// is added here on purpose.
function safeFinding(violation) {
  return {
    layer: violation.layer,
    source: violation.source === 'rule' ? 'rule' : 'baseline',
    code: violation.code,
    column: violation.column ?? null,
  }
}

// summariseRun({ result, ... }) -> a plain object matching the runs table.
export function summariseRun({ result, contractId = null, contractName = null, baselineName = null, candidateName, baselineRows = null, candidateRows = null }) {
  if (!result) return null

  const layers = {}
  for (const layer of result.layers ?? []) {
    layers[layer.id] = {
      status: layer.status,
      violations: layer.violations.length,
    }
  }

  const ruleOutcomes = result.rules ?? []

  return {
    contract_id: contractId,
    contract_name: contractName?.trim() || null,
    baseline_name: baselineName ?? null,
    candidate_name: candidateName,
    status: result.status,
    layers,
    findings: (result.violations ?? []).map(safeFinding),
    rules_total: ruleOutcomes.length,
    rules_broken: ruleOutcomes.filter((outcome) => outcome.status === 'FAIL').length,
    baseline_rows: baselineRows,
    candidate_rows: candidateRows,
  }
}

// The layer a run is remembered by: the first one that failed, in engine order,
// which is the same thing the staircase points at.
export function leadFailingLayer(record, order) {
  if (!record?.layers) return null
  return order.find((id) => record.layers[id]?.status === 'FAIL') ?? null
}
