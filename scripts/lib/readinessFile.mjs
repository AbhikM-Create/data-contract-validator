// Load readiness over a CSV of any size, in bounded memory. The engine is
// createReadinessCheck (src/lib/readiness.js); this only feeds it.
//
//   pass 1  (only with a key) stream the keys to partitions on disk and count
//           each partition: the set of keys that appear more than once. A row
//           cannot know its key recurs ninety thousand rows later, so this has
//           to be known before any row is judged.
//   pass 2  stream the file through the check, writing each flagged record to
//           the fix list as it is found — the report never holds them.
//
// checkReadiness() is the same engine over an in-memory array, and a test holds
// the two to identical reports.

import { closeSync, openSync, statSync, writeSync } from 'node:fs'
import Papa from 'papaparse'
import { createReadinessCheck } from '../../src/lib/readiness.js'
import { readCsvHeader, streamCsv } from './csvStream.mjs'
import { createPartitions, makeScratchDir, partitionsFor } from './partitions.mjs'

// Pass 1 writes keys only, so a partition can cover far more of the file.
const BYTES_PER_KEY_PARTITION = 256 << 20
const REJECTS_BATCH = 10_000

// -> { report, error, partitions, seconds, rejectsWritten }
export async function checkReadinessFile(contract, path, options = {}) {
  const started = Date.now()
  const done = (fields) => ({ seconds: (Date.now() - started) / 1000, rejectsWritten: 0, ...fields })

  const header = readCsvHeader(path)
  if (header.error) return done({ error: `${path}: ${header.error}` })
  const columns = header.columns
  const key = options.key ?? []

  const duplicateKeys = new Set()
  const check = createReadinessCheck(contract, { columns, key, duplicateKeys })
  if (check.issues.length > 0) return done({ report: check.finish(0), partitions: 0 })

  let count = 0
  if (key.length > 0) {
    count = options.partitions ?? partitionsFor(statSync(path).size, BYTES_PER_KEY_PARTITION)
    const scratch = count > 1 ? makeScratchDir(options.tmpDir) : null
    try {
      const keys = createPartitions(count, { dir: scratch?.dir, name: 'keys' })
      const pass1 = await streamCsv(path, (row) => {
        const value = check.keyOf(row)
        if (value !== null) keys.add(value, [value])
      })
      keys.close()
      if (pass1.error) return done({ error: `${path}: ${pass1.error}` })
      for (let i = 0; i < count; i += 1) {
        const seen = new Set()
        for (const [value] of keys.read(i)) {
          if (seen.has(value)) duplicateKeys.add(value)
          else seen.add(value)
        }
      }
    } finally {
      scratch?.remove()
    }
  }

  // The fix list is opened on the first flagged record, so a clean file leaves
  // no empty file behind.
  let fd = null
  let batch = []
  let written = 0
  const flushRejects = () => {
    if (batch.length === 0) return
    writeSync(fd, `${Papa.unparse(batch, { header: false })}\n`)
    written += batch.length
    batch = []
  }

  try {
    const pass2 = await streamCsv(path, (row, rowNo) => {
      const flag = check.row(row, rowNo)
      if (!flag || !options.rejectsPath) return
      if (fd === null) {
        fd = openSync(options.rejectsPath, 'w', 0o600)
        writeSync(fd, `${Papa.unparse([[...columns, '_row', '_readiness', '_reasons']], { header: false })}\n`)
      }
      batch.push([
        ...columns.map((column) => row[column]),
        rowNo,
        flag.severity === 'reject' ? 'REJECT' : 'WARN',
        flag.reasons.join('; '),
      ])
      if (batch.length >= REJECTS_BATCH) flushRejects()
    })
    if (fd !== null) flushRejects()
    if (pass2.error) return done({ error: `${path}: ${pass2.error}` })
    return done({ report: check.finish(pass2.rows), partitions: count, rejectsWritten: written })
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
