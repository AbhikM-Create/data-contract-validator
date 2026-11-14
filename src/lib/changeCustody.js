// Custody of a change check (final-spec C11, design note §6): who did what. A
// check is only as independent as the hands its inputs passed through, so the
// record states, as typed and unverified:
//   - who made the change (the mover);
//   - who exported the before and after files, and when;
//   - who wrote the contract, and who provided the approved list;
//   - who ran the check.
// A check whose contract, exports or run came from the mover is SELF-CHECKED,
// and says so on screen and on the record's first page. Without the export
// fields the record is a draft, never a final record.
//
// What people type here is identity, not record values; it is bounded and
// cleaned field by field on the way in, like the sign-off record.

export const PARTIES = [
  { id: 'mover', label: 'Whoever made the change' },
  { id: 'business', label: 'The business that owns the records' },
  { id: 'adviser', label: 'The business’s CA or auditor' },
  { id: 'pack', label: 'A ready-made pack' },
]

// What each custody line is about, and which parties can stand in it: only a
// contract can come from a pack.
export const CUSTODY_FIELDS = [
  { id: 'contract', label: 'Contract written by', parties: ['business', 'adviser', 'mover', 'pack'] },
  { id: 'before', label: 'Before file exported by', parties: ['business', 'adviser', 'mover'], when: true },
  { id: 'after', label: 'After file exported by', parties: ['business', 'adviser', 'mover'], when: true },
  { id: 'approved', label: 'Approved list provided by', parties: ['business', 'adviser', 'mover'] },
  { id: 'ran', label: 'Check run by', parties: ['business', 'adviser', 'mover'] },
]

const MAX = 120
const bounded = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX) : '')
const DATE = /^\d{4}-\d{2}-\d{2}$/

// cleanCustody(raw) -> { mover, [field]: { by, name, at } } with only known
// parties, bounded strings and ISO dates.
export function cleanCustody(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const out = { mover: bounded(c.mover) }
  for (const field of CUSTODY_FIELDS) {
    const entry = c[field.id] && typeof c[field.id] === 'object' ? c[field.id] : {}
    const by = field.parties.includes(entry.by) ? entry.by : ''
    const line = { by, name: bounded(entry.name) }
    if (field.when) line.at = DATE.test(entry.at ?? '') ? entry.at : ''
    out[field.id] = line
  }
  return out
}

const SELF = {
  contract: 'The contract was written by whoever made the change.',
  before: 'The before file was exported by whoever made the change.',
  after: 'The after file was exported by whoever made the change.',
  approved: 'The approved list came from whoever made the change.',
  ran: 'The check was run by whoever made the change.',
}

// selfChecked(custody) -> [sentence]: every way the check is not independent
// of the change it judges. Empty means nothing typed says it is self-checked —
// not that independence was verified.
export function selfChecked(raw) {
  const custody = cleanCustody(raw)
  return CUSTODY_FIELDS.filter((f) => custody[f.id].by === 'mover').map((f) => SELF[f.id])
}

// missingForFinal(custody) -> [sentence]: what a final record needs and this
// one lacks. Who made the change, and who exported each file and when.
export function missingForFinal(raw) {
  const custody = cleanCustody(raw)
  const missing = []
  if (!custody.mover) missing.push('who made the change')
  for (const side of ['before', 'after']) {
    if (!custody[side].by) missing.push(`who exported the ${side} file`)
    if (!custody[side].at) missing.push(`when the ${side} file was exported`)
  }
  return missing
}

export const partyLabel = (id) => PARTIES.find((p) => p.id === id)?.label ?? ''
