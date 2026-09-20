// Building and normalising an AUTHORED contract. Pure.
//
// The contract object is the interface between authoring and validation. An
// authored contract and an inferred one are the same shape, so validate() never
// asks which produced it — that is what keeps authoring out of the engine.
//
// A contract has two independent halves, and either may be empty:
//   columns[] — the baseline profile, what the data WAS (produced by inference)
//   rules[]   — the authored requirements, what the data MUST BE
// Inference fills the first. A human fills the second. A contract with only
// rules validates a file against those rules and nothing else; a contract with
// only a profile behaves exactly as it did in v1.

const emptyContract = {
  rowCount: 0,
  columns: [],
  columnNames: [],
  dateColumn: null,
  cadenceMs: null,
  newest: null,
  oldest: null,
}

// defineContract({ rules, columns }) -> contract
//
// Writes a contract by hand, with no baseline file involved.
export function defineContract({ rules = [], columns = [], rowCount = 0, name = null } = {}) {
  return {
    ...emptyContract,
    name,
    rowCount,
    columns,
    columnNames: columns.map((column) => column.name),
    byName: new Map(columns.map((column) => [column.name, column])),
    rules,
    sufficient: true,
    insufficientReason: null,
  }
}

// withRules(draft, rules) -> contract
//
// The v2 authoring flow in one call: infer a draft from a baseline, then promote
// it by attaching the rules a human decided on. The baseline profile is kept, so
// drift checks and authored rules both run.
export function withRules(contract, rules) {
  return { ...contract, rules: Array.isArray(rules) ? rules : [] }
}

// Accepts anything contract-shaped — an inferred contract, a defineContract
// result, or a bare object literal such as { rules: [...] } — and fills in what
// validate() needs. Hand-writing a contract should not require knowing which
// internal fields the engine reads.
export function normalizeContract(contract) {
  if (!contract || typeof contract !== 'object') return null

  const columns = Array.isArray(contract.columns) ? contract.columns : []
  const rules = Array.isArray(contract.rules) ? contract.rules : []
  const hasBaseline = columns.length > 0

  return {
    ...emptyContract,
    ...contract,
    columns,
    rules,
    columnNames: contract.columnNames ?? columns.map((column) => column.name),
    byName: contract.byName instanceof Map ? contract.byName : new Map(columns.map((column) => [column.name, column])),
    hasBaseline,
    // A contract is usable if it can check something: a baseline to compare
    // against, or rules to enforce. Only an empty contract is insufficient.
    sufficient: hasBaseline ? contract.sufficient !== false : rules.length > 0,
    insufficientReason: contract.insufficientReason
      ?? (hasBaseline || rules.length > 0 ? null : 'the contract has neither a baseline profile nor any authored rules, so there is nothing to check'),
  }
}
