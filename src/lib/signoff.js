// The cutover sign-off record (v3-spec §5.3) and whose fix each step is (§5.4).
// Pure.
//
// The evidence pack becomes the record a finance controller, HR head or data
// owner signs: who the migration is for, which files by their SHA-256 and who
// exported them, the results, every difference with what was decided about it
// and whose it is, what was NOT checked, and the signatures. It is never called
// a certificate: a CA's certificate is a regulated document (ICAI's UDIN rules),
// and this is the record the people who ran the migration sign.
//
// Everything here is a DEFINITION a person typed — names, dates, decisions,
// reasons. No record value is ever copied in by the tool; `cleanSignoff` keeps
// only strings of bounded length in known fields, so a hand-edited object file
// cannot smuggle a report into it.

// --- owners (§5.4) ----------------------------------------------------------------

export const OWNER_STEPS = [
  { id: 'keys', label: 'Keys' },
  { id: 'completeness', label: 'Completeness' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'totals', label: 'Totals' },
  { id: 'readiness', label: 'Load readiness rejections' },
]

export const DEFAULT_OWNERS = {
  keys: 'Load team',
  completeness: 'Load team',
  mapping: 'Functional team (mapping spec and crosswalks)',
  accuracy: 'Transformation team',
  totals: 'Transformation team',
  readiness: 'Data owner of the source records',
}

const MAX = 300
const text = (value, max = MAX) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

// The object's owners, with the defaults where none is set.
export function ownersOf(object) {
  const out = { ...DEFAULT_OWNERS }
  for (const step of OWNER_STEPS) {
    const owner = text(object?.owners?.[step.id], 120)
    if (owner) out[step.id] = owner
  }
  return out
}

// Only owners that differ from the default are saved.
export function cleanOwners(owners) {
  const out = {}
  for (const step of OWNER_STEPS) {
    const owner = text(owners?.[step.id], 120)
    if (owner && owner !== DEFAULT_OWNERS[step.id]) out[step.id] = owner
  }
  return out
}

// --- the record -------------------------------------------------------------------

export const DISPOSITIONS = [
  { id: 'corrected', label: 'Corrected — fixed and re-run' },
  { id: 'accepted', label: 'Accepted, with a reason' },
  { id: 'carried', label: 'Carried forward — to fix after cutover' },
]
const DISPOSITION_IDS = new Set(DISPOSITIONS.map((d) => d.id))

export const SIGNATORIES = [
  { id: 'preparedBy', label: 'Prepared by' },
  { id: 'reviewedBy', label: 'Reviewed by' },
  { id: 'approvedBy', label: 'Approved by' },
  // Not a certification: the auditor acknowledges having received the record.
  { id: 'auditorReceived', label: 'Received by the auditor (not a certification)' },
]

export const IDENTITY_FIELDS = [
  { id: 'entity', label: 'Legal entity' },
  { id: 'financialYear', label: 'Financial year' },
  { id: 'legacySystem', label: 'Legacy system' },
  { id: 'newSystem', label: 'New system' },
  { id: 'cutoverDate', label: 'Cutover date' },
]

// The one claim the record makes, and the ones it must never make.
export const STATEMENT_OF_CLAIM = 'These checks ran on these fingerprinted files with these results. Nothing more is claimed: not that the data is correct beyond the checks listed, not that any other file or period was checked, and not any audit opinion.'

export const NEVER_CLAIM = [/\bcertif(y|ies|ied|icate)\b/i, /true and (fair|correct)/i, /error[- ]free/i, /100\s?% accurate/i, /DPDP[- ]compliant/i, /audit trail compliance/i]

export const emptySignoff = () => ({
  identity: {},
  custody: {},
  exceptions: {},
  scope: '',
  signatures: {},
})

// cleanSignoff(raw) -> the record as saved: typed strings in known fields only.
export function cleanSignoff(raw) {
  const out = emptySignoff()
  if (!raw || typeof raw !== 'object') return out
  for (const field of IDENTITY_FIELDS) {
    const value = text(raw.identity?.[field.id], 160)
    if (value) out.identity[field.id] = value
  }
  for (const [role, entry] of Object.entries(raw.custody ?? {})) {
    if (!/^(load|source|target|reference:[\w .-]{1,60})$/.test(role)) continue
    const by = text(entry?.exportedBy, 120)
    const at = text(entry?.exportedAt, 40)
    if (by || at) out.custody[role] = { ...(by ? { exportedBy: by } : {}), ...(at ? { exportedAt: at } : {}) }
  }
  for (const [id, entry] of Object.entries(raw.exceptions ?? {})) {
    if (typeof id !== 'string' || id.length > 400) continue
    const disposition = DISPOSITION_IDS.has(entry?.disposition) ? entry.disposition : null
    const reason = text(entry?.reason, 500)
    const owner = text(entry?.owner, 120)
    if (disposition || reason || owner) out.exceptions[id] = { ...(disposition ? { disposition } : {}), ...(reason ? { reason } : {}), ...(owner ? { owner } : {}) }
  }
  out.scope = text(raw.scope, 2000)
  for (const signer of SIGNATORIES) {
    const name = text(raw.signatures?.[signer.id]?.name, 120)
    const date = text(raw.signatures?.[signer.id]?.date, 40)
    if (name || date) out.signatures[signer.id] = { ...(name ? { name } : {}), ...(date ? { date } : {}) }
  }
  return out
}

export const signoffIsEmpty = (record) => {
  const r = cleanSignoff(record)
  return !Object.keys(r.identity).length && !Object.keys(r.custody).length && !Object.keys(r.exceptions).length && !r.scope && !Object.keys(r.signatures).length
}

// A short, stable id for a text of any length: cyrb53, a 53-bit string hash.
// Not a security measure — a key under which a typed decision is saved, so a
// rule described in 2,000 characters still fits the saved record's bound.
function shortHash(text) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// decisionFor(record, exception) -> what the person decided about it, or {}.
// Read under its id, or under the id records saved before ids were hashed.
export function decisionFor(record, exception) {
  return record?.exceptions?.[exception.id] ?? (exception.legacyId ? record?.exceptions?.[exception.legacyId] : undefined) ?? {}
}

// exceptionsFor(readinessReport, reconReport, owners) -> every difference the
// record must account for, each with a stable id (from rule descriptions, step
// ids, finding codes and column names — never a value), the step that caught
// it, and whose it is by default.
export function exceptionsFor(readiness, recon, owners = DEFAULT_OWNERS) {
  const list = []
  for (const check of readiness?.checks ?? []) {
    if (check.status !== 'FAIL' && check.status !== 'UNCHECKED') continue
    list.push({
      // Hashed: a description can outgrow what a saved id may hold.
      id: `readiness|${shortHash(check.description)}`,
      legacyId: `readiness|${check.description}`,
      step: check.fileLevel ? 'Load readiness (file total)' : 'Load readiness',
      what: check.status === 'UNCHECKED'
        ? `Not checked: ${check.description}`
        : `${check.description} — ${check.fileLevel ? `${check.failing} of ${check.applicable} total${check.applicable === 1 ? '' : 's'} do not tie` : `${check.failing} record${check.failing === 1 ? '' : 's'}`}`,
      owner: owners.readiness,
      severity: check.severity,
    })
  }
  for (const step of recon?.steps ?? []) {
    if (step.status !== 'FAIL') continue
    for (const finding of step.findings ?? []) {
      list.push({
        id: `reconcile|${step.id}|${finding.code}|${finding.column ?? ''}`,
        step: step.label,
        what: finding.message,
        owner: owners[step.id] ?? DEFAULT_OWNERS[step.id],
      })
    }
  }
  return list
}

// What was NOT checked, said by the tool itself — the typed scope adds to it.
export function notChecked(readiness, recon) {
  const out = []
  if (!readiness) out.push('Load readiness was not run for this record, or its result no longer matches the files.')
  if (!recon) out.push('Reconciliation was not run for this record, or its result no longer matches the files.')
  for (const step of recon?.steps ?? []) {
    if (step.status === 'SKIPPED') out.push(`Reconciliation step “${step.label}” was not judged: ${step.reason ?? 'not configured'}.`)
  }
  return out
}
