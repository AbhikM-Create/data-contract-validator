import { cleanColumnMap } from './columnMap.js'
import { runnableContract, runnableSpec } from './migrationObject.js'

// What a result was run against, so the page — and the evidence pack — can tell
// whether it still describes what is on screen.
//
// A file is identified by the SHA-256 of its BYTES, never by its name or row
// count: a corrected re-extract usually keeps both, and a pack that matched on
// them would attest one file's result next to another file's fingerprint.
// The definitions are compared as run (rules, spec, formats), and the wave and
// cycle are included because the pack is titled with them. The object's display
// name is not: renaming changes no result.
//
// A file without a fingerprint can never be current. Every file the workspace
// reads is hashed, so this only refuses what cannot be proved.

// A workbook's bytes hold several sheets; which one was read, from which header
// row, is part of what the result describes.
const fingerprint = (file) => {
  if (!file?.sha256) return null
  return file.sheet ? `${file.sha256}#${file.sheet}@${file.headerRow ?? 1}` : file.sha256
}

const withoutName = ({ name: _name, ...rest }) => rest

// Reference files (roles "reference:<name>") are inputs of readiness too: a
// different vendor master is a different check.
const referenceFingerprints = (files) => Object.keys(files ?? {})
  .filter((role) => role.startsWith('reference:') && files[role])
  .sort()
  .map((role) => [role, fingerprint(files[role])])

// Column matching is part of what was checked: the same file read under a
// different match is a different check.
const matching = (object, roles) => {
  const map = cleanColumnMap(object?.columnMap)
  return roles.filter((role) => map[role]).sort().map((role) => [role, Object.entries(map[role]).sort()])
}

export function readinessStamp(object, files) {
  const load = fingerprint(files?.load)
  if (!load) return null
  const roles = ['load', ...Object.keys(cleanColumnMap(object?.columnMap)).filter((role) => role.startsWith('reference:'))]
  return JSON.stringify([withoutName(runnableContract(object)), object?.spec?.key?.target ?? [], object?.wave ?? '', object?.cycle ?? '', load, referenceFingerprints(files), matching(object, roles)])
}

export function reconciliationStamp(object, files) {
  const source = fingerprint(files?.source)
  const target = fingerprint(files?.target)
  if (!source || !target) return null
  return JSON.stringify([withoutName(runnableSpec(object)), object?.wave ?? '', object?.cycle ?? '', source, target, matching(object, ['source', 'target'])])
}

// isCurrent(saved, now) -> boolean. A missing stamp on either side is never current.
export const isCurrent = (saved, now) => saved != null && now != null && saved === now
