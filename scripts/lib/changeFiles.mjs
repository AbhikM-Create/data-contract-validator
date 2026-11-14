// A change check over two CSV files of any size, in bounded memory. The engine
// is createChangeCheck (src/lib/changeContract.js); this only feeds it, in the
// same two passes as reconcileFiles:
//
//   pass 1  stream each file once: the engine applies scope, adds to totals and
//           returns each record's key; the key and the columns the check needs
//           go to the partition their key hashes to
//   pass 2  judge one partition at a time — every copy of a key is in the same
//           partition in both files, so each partition's answer is exact
//
// The approved file and the change log are lists the signer and the mover
// provide; they are read whole, like reference files. checkChange() is the same
// engine run as one in-memory partition, and streaming.test.js holds the two to
// identical reports.

import { statSync } from 'node:fs'
import { createChangeCheck, normalizeContract } from '../../src/lib/changeContract.js'
import { readCsvHeader, streamCsv } from './csvStream.mjs'
import { createPartitions, makeScratchDir, partitionsFor } from './partitions.mjs'

const BYTES_PER_PARTITION = 32 << 20

async function readWhole(path, encoding) {
  const header = readCsvHeader(path, encoding)
  if (header.error) return { error: `${path}: ${header.error}` }
  const rows = []
  const result = await streamCsv(path, (row) => { rows.push(row) }, encoding)
  return result.error ? { error: `${path}: ${result.error}` } : { rows, columns: header.columns }
}

// -> { report, error, partitions, seconds }. error is a sentence about a file
// that could not be read; a contract that cannot run is an INVALID report.
//
//   options.approvedPath  the approved file (the signer's)
//   options.logPath       the change log (the mover's)
//   options.references    { name: [values] } for oneOf policies naming a reference
//   options.columnMap     { before, after }: each file's column matching
export async function changeFiles(contract, beforePath, afterPath, options = {}) {
  const started = Date.now()
  const done = (fields) => ({ seconds: (Date.now() - started) / 1000, ...fields })

  const formats = normalizeContract(contract).formats
  const encoding = { before: formats.before.encoding, after: formats.after.encoding }
  const maps = { before: options.columnMap?.before ?? null, after: options.columnMap?.after ?? null }
  const beforeHeader = readCsvHeader(beforePath, encoding.before, maps.before)
  if (beforeHeader.error) return done({ error: `${beforePath}: ${beforeHeader.error}` })
  const afterHeader = readCsvHeader(afterPath, encoding.after, maps.after)
  if (afterHeader.error) return done({ error: `${afterPath}: ${afterHeader.error}` })

  let approved = null
  let approvedColumns
  if (options.approvedPath) {
    const read = await readWhole(options.approvedPath, encoding.after)
    if (read.error) return done({ error: read.error })
    approved = read.rows
    approvedColumns = read.columns
  }
  let changeLog = null
  let logColumns
  if (options.logPath) {
    const read = await readWhole(options.logPath, encoding.after)
    if (read.error) return done({ error: read.error })
    changeLog = read.rows
    logColumns = read.columns
  }

  const run = createChangeCheck(contract, {
    exampleLimit: options.exampleLimit,
    beforeColumns: beforeHeader.columns,
    afterColumns: afterHeader.columns,
    approved,
    approvedColumns,
    changeLog,
    logColumns,
    references: options.references,
  })
  if (run.issues.length > 0) return done({ report: run.finish(), partitions: 0 })

  const bytes = statSync(beforePath).size + statSync(afterPath).size
  const count = options.partitions ?? partitionsFor(bytes, BYTES_PER_PARTITION)
  const scratch = count > 1 ? makeScratchDir(options.tmpDir) : null

  try {
    const spill = async (sideName, path) => {
      const needed = run.columnsNeeded[sideName]
      const partitions = createPartitions(count, { dir: scratch?.dir, name: sideName })
      const result = await streamCsv(path, (row, rowNo) => {
        const key = run.observe(sideName, row)
        if (key === null) return
        partitions.add(key, [rowNo, key, ...needed.map((column) => row[column])])
      }, encoding[sideName], maps[sideName])
      partitions.close()
      return { partitions, error: result.error ? `${path}: ${result.error}` : null }
    }

    const before = await spill('before', beforePath)
    if (before.error) return done({ error: before.error })
    const after = await spill('after', afterPath)
    if (after.error) return done({ error: after.error })

    const entries = (items, needed) => {
      const out = new Array(items.length)
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        const row = {}
        for (let c = 0; c < needed.length; c += 1) row[needed[c]] = item[c + 2]
        out[i] = { key: item[1], rowNo: Number(item[0]), row }
      }
      return out
    }

    for (let i = 0; i < count; i += 1) {
      run.joinPartition(
        entries(before.partitions.read(i), run.columnsNeeded.before),
        entries(after.partitions.read(i), run.columnsNeeded.after),
      )
    }
    return done({ report: run.finish(), partitions: count })
  } finally {
    scratch?.remove()
  }
}
