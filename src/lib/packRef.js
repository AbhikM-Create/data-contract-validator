// The reference a migration object keeps to the pack it was built from (v3
// §6): id, version, status, object. Apart from packs.js so the object file can
// read it without importing the pack machinery. Pure.

export const PACK_STATUSES = ['draft', 'verified']

// The reference an object keeps to the pack it came from: ids, version, status.
export function packRef(pack, objectId) {
  return { id: pack.id, version: pack.version, status: pack.status, object: objectId }
}

export function cleanPackRef(ref) {
  if (!ref || typeof ref !== 'object') return null
  const ok = (v, re) => typeof v === 'string' && re.test(v)
  if (!ok(ref.id, /^[a-z0-9-]{1,80}$/) || !ok(ref.version, /^\d+\.\d+\.\d+$/) || !ok(ref.object, /^[a-z0-9-]{1,80}$/) || !PACK_STATUSES.includes(ref.status)) return null
  return { id: ref.id, version: ref.version, status: ref.status, object: ref.object }
}

// How the pack describes itself in a sentence, wherever it is shown.
export function packLabel(ref) {
  if (!ref) return null
  return ref.status === 'verified' ? `pack ${ref.id} v${ref.version} (verified)` : `pack ${ref.id} v${ref.version} — DRAFT: not yet run on real exports`
}
