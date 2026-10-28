// Reconciling two CSV files of any size, in bounded memory. The engine is
// createReconciliation (src/lib/reconcile.js); this only feeds it.
//
//   pass 1  stream each file once: the engine applies scope, adds to control
//           totals and returns each record's key; the key and the mapped
//           columns go to the partition their key hashes to
//   pass 2  join one partition at a time — every copy of a key is in the same
//           partition on both sides, so each partition's answer is exact
//
// reconcile() is the same engine run as a single in-memory partition, and a
// test holds the two to identical reports.

import { statSync } from 'node:fs'
import { createReconciliation, normalizeSpec } from '../../src/lib/reconcile.js'
import { readCsvHeader, streamCsv } from './csvStream.mjs'
import { createPartitions, makeScratchDir, partitionsFor } from './partitions.mjs'

// ~32 MB of CSV per partition. Measured: at 64 MB a five-million-row run did
// not fit a 512 MB heap; at 32 MB it does. Memory is set by this number, not by
// the size of the files — a bigger file only means more partitions.
const BYTES_PER_PARTITION = 32 << 20

// -> { report, error, partitions, seconds }. error is a sentence about a file
// that could not be read; a spec that cannot run is an INVALID report instead.
export async function reconcileFiles(spec, sourcePath, targetPath, options = {}) {
  const started = Date.now()
  const done = (fields) => ({ seconds: (Date.now() - started) / 1000, ...fields })

  // Each file is decoded in its declared encoding; undeclared means UTF-8, read
  // strictly.
  const formats = normalizeSpec(spec).formats
  const encoding = { source: formats.source.encoding, target: formats.target.encoding }
  const sourceHeader = readCsvHeader(sourcePath, encoding.source)
  if (sourceHeader.error) return done({ error: `${sourcePath}: ${sourceHeader.error}` })
  const targetHeader = readCsvHeader(targetPath, encoding.target)
  if (targetHeader.error) return done({ error: `${targetPath}: ${targetHeader.error}` })

  const run = createReconciliation(spec, {
    thresholds: options.thresholds,
    exampleLimit: options.exampleLimit,
    sourceColumns: sourceHeader.columns,
    targetColumns: targetHeader.columns,
  })
  if (run.issues.length > 0) return done({ report: run.finish(), partitions: 0 })

  const bytes = statSync(sourcePath).size + statSync(targetPath).size
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
      }, encoding[sideName])
      partitions.close()
      return { partitions, error: result.error ? `${path}: ${result.error}` : null }
    }

    const source = await spill('source', sourcePath)
    if (source.error) return done({ error: source.error })
    const target = await spill('target', targetPath)
    if (target.error) return done({ error: target.error })

    // A plain loop, not destructuring and Object.fromEntries: this runs once per
    // record, and the allocations those make were a tenth of a large run.
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
        entries(source.partitions.read(i), run.columnsNeeded.source),
        entries(target.partitions.read(i), run.columnsNeeded.target),
      )
    }
    return done({ report: run.finish(), partitions: count })
  } finally {
    scratch?.remove()
  }
}
