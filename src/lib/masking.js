// Sensitivity tags and masking (v3-spec §5.2). Pure.
//
// A field is tagged once, as a definition saved with the migration object:
//   personal    a name, phone, address
//   identifier  PAN, bank account, UAN — shows only its last 4 characters
//   pay         salary, components, deductions
//   aadhaar     an Aadhaar number — always masked (last 4), even when the rest
//               of a pack is unmasked on request
// Tags hold column names and these words only: never a value.
//
// Masking applies where a report LEAVES the screen — the evidence pack, the fix
// list, a finding exported as CSV, the CLI's --json. On screen the person is
// looking at their own files and sees them as they are. Counts and totals are
// never masked, and neither are record keys (the key is how a fix finds its
// record) unless the key itself is an Aadhaar column — with one exception: a
// total of a tagged amount grouped by the record key or by a tagged column is
// one person's figure (year-to-date pay per employee), and its amounts are
// masked like the values they add up.
//
// The tool supports the masking safeguard; it does not make anyone "DPDP
// compliant" — the client remains the data fiduciary.

export const SENSITIVITIES = [
  { id: 'personal', label: 'Personal — name, phone, address', masked: 'shown as [masked]' },
  { id: 'identifier', label: 'Identifier — PAN, bank account, UAN', masked: 'only the last 4 characters shown' },
  { id: 'pay', label: 'Pay — salary, components, deductions', masked: 'shown as [masked]' },
  { id: 'aadhaar', label: 'Aadhaar — always masked', masked: 'only the last 4 digits shown, always' },
]
const KNOWN = new Set(SENSITIVITIES.map((s) => s.id))
const STRENGTH = { personal: 1, pay: 2, identifier: 3, aadhaar: 4 }

// Only known tags on non-empty column names — what is saved.
export function cleanTags(tags) {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return {}
  const out = {}
  for (const [column, tag] of Object.entries(tags)) {
    if (typeof column === 'string' && column.trim() !== '' && KNOWN.has(tag)) out[column] = tag
  }
  return out
}

const isBlankValue = (value) => value === null || value === undefined || String(value).trim() === ''

export function maskValue(value, tag) {
  if (isBlankValue(value) || !KNOWN.has(tag)) return value
  if (tag === 'personal' || tag === 'pay') return '[masked]'
  const text = String(value).trim()
  if (text.length <= 4) return '•'.repeat(text.length)
  return `${'•'.repeat(Math.min(text.length - 4, 8))}${text.slice(-4)}`
}

// The strongest tag among some columns (a mapped pair: legacy and target name).
function strongest(tags, columns) {
  let best = null
  for (const column of columns) {
    const tag = tags[column]
    if (tag && (!best || STRENGTH[tag] > STRENGTH[best])) best = tag
  }
  return best
}

// createMasker(tags, { unmask, keys }) -> (columns, value) => value as it may leave
//   columns  one column name or several (the value belongs to all of them)
//   unmask   the person asked for this output unmasked — except Aadhaar
//   keys     the record-key columns, whose values are never masked (but Aadhaar)
export function createMasker(tags, { unmask = false, keys = [] } = {}) {
  const clean = cleanTags(tags)
  const keySet = new Set(keys)
  const masker = (columns, value) => {
    const list = (Array.isArray(columns) ? columns : [columns]).filter(Boolean)
    const tag = strongest(clean, list)
    if (!tag) return value
    if (tag === 'aadhaar') return maskValue(value, tag)
    if (unmask) return value
    if (list.length > 0 && list.every((c) => keySet.has(c))) return value
    return maskValue(value, tag)
  }
  masker.active = Object.keys(clean).length > 0
  masker.unmask = unmask
  masker.tags = clean
  masker.keys = keySet
  return masker
}

// Is a total of these amount columns, grouped by these columns, one person's
// figure? Only when the amount is tagged and each group is a record (a key
// column) or a tagged value (a name). A total per company stays a total.
function perPerson(masker, amountColumns, groupColumns) {
  if (masker.unmask) return false
  const amounts = amountColumns.filter(Boolean)
  const groups = groupColumns.filter(Boolean)
  if (amounts.length === 0 || groups.length === 0 || !strongest(masker.tags, amounts)) return false
  return groups.some((c) => masker.keys.has(c) || masker.tags[c])
}

// The readiness report as it may leave the screen.
//   key: the record-key columns (their values label each example)
export function maskReadiness(report, masker, key = []) {
  if (!report?.checks || !masker?.active) return report
  const label = (record) => (/^row \d+$/.test(record) ? record : masker(key, record))
  const keyed = { ...masker, keys: new Set([...(masker.keys ?? []), ...key]) }
  const checks = report.checks.map((check) => {
    const column = check.kind === 'key' ? key : check.rule?.column
    const rule = check.rule ?? {}
    const hideAmounts = check.groups && perPerson(keyed, [rule.column, rule.targetIsColumn ? rule.target : null], [rule.groupBy])
    return {
      ...check,
      examples: (check.examples ?? []).map((e) => ({ ...e, record: label(e.record), value: masker(column, e.value) })),
      ...(check.groups ? {
        groups: check.groups.map((g) => {
          const group = g.group === null ? null : masker(rule.groupBy, g.group)
          return { ...g, group, value: hideAmounts ? `${rule.groupBy} ${group}: [masked]` : maskGroupValue(g, check, masker) }
        }),
      } : {}),
    }
  })
  // The headline quotes the first failing total's first group as written: it
  // leaves masked like the group itself.
  let headline = report.headline
  report.checks.forEach((check, i) => {
    const original = check.groups?.[0]?.value
    if (original && headline?.includes(original)) headline = headline.replace(original, checks[i].groups[0].value)
  })
  return {
    ...report,
    headline,
    checks,
    ...(report.flagged ? { flagged: report.flagged.map((f) => ({ ...f, record: label(f.record) })) } : {}),
  }
}

// A total's sentence names its group; the amounts are totals and stay.
function maskGroupValue(group, check, masker) {
  if (!group.group || !check.rule?.groupBy) return group.value
  const masked = masker(check.rule.groupBy, group.group)
  return masked === group.group ? group.value : String(group.value).replace(group.group, masked)
}

// The reconciliation report as it may leave the screen. A mapped value belongs to
// both its legacy and its target column, so the stronger tag of the pair wins.
export function maskReconciliation(report, spec, masker) {
  if (!report?.steps || !masker?.active) return report
  const keyColumns = [...(spec?.key?.source ?? []), ...(spec?.key?.target ?? [])].filter(Boolean)
  const pairOf = (target) => {
    const field = (spec?.mapping ?? []).find((m) => (m.target || m.source) === target)
    return field ? [field.source, field.target ?? field.source] : [target]
  }
  // A total is named by its amount column — or, for a count, by its grouping.
  const totalNamed = (column) => (spec?.totals ?? []).find((t) => (t.fn === 'count' ? t.groupBy?.target || t.groupBy?.source : t.target || t.source) === column)
  const groupColumns = (total) => (total?.groupBy ? [total.groupBy.source, total.groupBy.target ?? total.groupBy.source] : [])
  const amountColumns = (total) => (total?.fn === 'count' ? [] : [total?.source, total?.target ?? total?.source])
  const hidesAmounts = (total) => !!total && perPerson(masker, amountColumns(total), groupColumns(total))
  const HIDDEN = { source: null, target: null, difference: null, masked: true }
  const key = (value) => (value === undefined ? value : masker(keyColumns, value))

  const maskExample = (finding, e) => {
    switch (finding.code) {
      case 'unmapped-value':
        return { ...e, value: masker(pairOf(finding.column), e.value) }
      case 'field-mismatch': {
        const pair = pairOf(finding.column)
        const masked = { ...e, key: key(e.key), source: masker(pair, e.source), expected: masker(pair, e.expected), target: masker(pair, e.target) }
        if (masked.source !== e.source || masked.target !== e.target) masked.detail = 'values masked in this output'
        return masked
      }
      case 'total-mismatch': {
        const total = totalNamed(finding.column)
        const group = groupColumns(total)
        const masked = group.length ? { ...e, key: masker(group, e.key) } : e
        return hidesAmounts(total) ? { ...masked, detail: 'amounts masked in this output', ...HIDDEN } : masked
      }
      default:
        return { ...e, key: key(e.key) }
    }
  }

  const maskFinding = (finding) => ({ ...finding, examples: (finding.examples ?? []).map((e) => maskExample(finding, e)) })
  return {
    ...report,
    steps: report.steps.map((step) => ({ ...step, findings: (step.findings ?? []).map(maskFinding) })),
    ...(report.findings ? { findings: report.findings.map(maskFinding) } : {}),
    ...(report.fields ? { fields: report.fields.map((f) => ({ ...f, examples: (f.examples ?? []).map((e) => maskExample({ code: 'field-mismatch', column: f.target }, e)) })) } : {}),
    // report.totals follows spec.totals one for one.
    ...(report.totals ? {
      totals: report.totals.map((t, i) => {
        const total = spec?.totals?.[i]
        const group = groupColumns(total)
        const hide = hidesAmounts(total)
        if (!group.length) return t
        return { ...t, groups: t.groups.map((g) => ({ ...g, group: masker(group, g.group), ...(hide ? HIDDEN : {}) })) }
      }),
    } : {}),
  }
}

// What the output says about itself: which columns were masked, and how — or
// that it carries personal data unmasked.
export function maskingSummary(masker) {
  if (!masker?.active) return null
  const columns = Object.entries(masker.tags).map(([column, tag]) => ({ column, tag, how: SENSITIVITIES.find((s) => s.id === tag).masked }))
  return { unmasked: masker.unmask, columns }
}

// suggestTag(column) -> a tag to PROPOSE for a column, from its name alone, or
// null. Never applied by itself: the person accepts or ignores it, the way
// inferred rules are proposed (suggestions.js). Names only — no value is read.
const SUGGEST = [
  ['aadhaar', /aadh?aar|\buid\b/i],
  ['identifier', /(^|_)(pan|gstin|ifsc|uan|iban|passport)($|_)|bank.?(ac|acc|account)|account.?(no|num)|acct/i],
  ['pay', /salary|gross|net.?pay|basic|\bhra\b|ctc|deduction|wage|ansal|(^|_)pay($|_)|bonus|\btds\b|\bpf\b/i],
  ['personal', /(first|last|full|middle|sur|given|family|emp(loyee)?).?name|^name$|nachn|vorna|phone|mobile|e.?mail|address|\bdob\b|birth/i],
]
export function suggestTag(column) {
  const text = String(column ?? '')
  for (const [tag, pattern] of SUGGEST) if (pattern.test(text)) return tag
  return null
}
