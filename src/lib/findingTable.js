// A reconciliation finding as a table: the drill-down on screen and the CSV a
// data owner downloads are built from this one function, so they cannot
// disagree about what a column means. Pure.

const TABLES = {
  'missing-in-target': { columns: ['Key'], row: (e) => [e.key] },
  'extra-in-target': { columns: ['Key'], row: (e) => [e.key] },
  'duplicate-key-source': { columns: ['Key', 'Records'], row: (e) => [e.key, e.count] },
  'duplicate-key-target': { columns: ['Key', 'Records'], row: (e) => [e.key, e.count] },
  'unmapped-value': { columns: ['Legacy value', 'Records'], row: (e) => [e.value, e.count] },
  'field-mismatch': { columns: ['Key', 'Source', 'Expected in target', 'Target has'], row: (e) => [e.key, e.source, e.expected, e.target] },
  'total-mismatch': { columns: ['Group', 'Source total', 'Target total', 'Difference'], row: (e) => [e.key, e.source, e.target, e.difference] },
}

// How many records (or values, or groups) the finding is about — the examples
// may be fewer, and the table says so rather than passing a sample off as all.
function totalFor(finding, report) {
  const c = report?.counts ?? {}
  switch (finding.code) {
    case 'missing-in-target': return c.missing
    case 'extra-in-target': return c.extra
    case 'duplicate-key-source': return c.sourceDuplicateKeys
    case 'duplicate-key-target': return c.targetDuplicateKeys
    case 'field-mismatch': return report?.fields?.find((f) => f.target === finding.column)?.mismatched
    case 'total-mismatch': {
      const total = report?.totals?.find((t) => t.target === finding.column)
      return total ? total.groups.filter((g) => !g.ties).length : undefined
    }
    default: return finding.examples.length
  }
}

// findingTable(finding, report) -> { columns, rows, shown, total } | null
// null for a finding with nothing to tabulate (blank keys, unreadable amounts).
export function findingTable(finding, report) {
  const table = TABLES[finding?.code]
  if (!table || !finding.examples?.length) return null
  const rows = finding.examples.map(table.row)
  const total = totalFor(finding, report)
  return { columns: table.columns, rows, shown: rows.length, total: Number.isFinite(total) ? total : rows.length }
}
