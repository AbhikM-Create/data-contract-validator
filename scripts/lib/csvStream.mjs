// Reading CSV files too large to hold, in Node. Not part of the engine: it
// touches the file system, and src/lib stays pure.
//
// A file is read by exactly the rules parseCsv applies to an upload — the same
// header checks, the same trimming, the same skipping of empty rows, the same
// sentence for a row that does not line up — because both call the helpers
// parseCsv exports. Row numbers count data rows from 1, as parseCsv's do, so a
// record is "row 4,812" whichever way the file was read.

import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs'
import Papa from 'papaparse'
import { cleanRow, isMisaligned, misalignedRowError, readErrorFor, readHeader } from '../../src/lib/parseCsv.js'

const HEADER_PROBE_BYTES = 1 << 20

// readCsvHeader(path) -> { columns, error }
//
// The header alone, before any row is streamed: both engines need every column
// name up front, to refuse a spec or contract that names a column the file does
// not have before spending a pass over twenty million rows.
export function readCsvHeader(path) {
  let size
  try {
    size = statSync(path).size
  } catch (error) {
    return { columns: [], error: `${path}: ${error.message}` }
  }
  if (size === 0) return { columns: [], error: readErrorFor('the file is empty') }

  const fd = openSync(path, 'r')
  const buffer = Buffer.alloc(Math.min(size, HEADER_PROBE_BYTES))
  try {
    readSync(fd, buffer, 0, buffer.length, 0)
  } finally {
    closeSync(fd)
  }
  const text = buffer.toString('utf8').replace(/^﻿/, '')
  if (text.trim() === '') return { columns: [], error: readErrorFor('the file is empty') }
  if (size > HEADER_PROBE_BYTES && !/[\r\n]/.test(text)) {
    return { columns: [], error: readErrorFor('its first line is over a megabyte long, so no header row could be found') }
  }

  // header: false, so a repeated name comes back twice and readHeader's
  // collision check names it — rather than Papa renaming it out of sight.
  const first = Papa.parse(text, { preview: 1, header: false, skipEmptyLines: 'greedy' }).data[0] ?? []
  const header = readHeader(first, null)
  return { columns: header.columns, error: header.error }
}

// streamCsv(path, onRow) -> Promise<{ rows, error }>
//
// Calls onRow(row, rowNumber) for every data row, in file order, holding one
// row at a time. Resolves with the row count, or with the same reader-facing
// sentence parseCsv would give, never by throwing on a bad file. If onRow
// throws, the read stops and the promise rejects with that error.
export function streamCsv(path, onRow) {
  return new Promise((resolve, reject) => {
    let fields = null
    let rows = 0
    let seen = 0 // rows Papa emitted, blank ones included, for error line numbers
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    Papa.parse(createReadStream(path), {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      step(results, parser) {
        if (settled) return
        seen += 1
        if (fields === null) {
          const header = readHeader(results.meta.fields, results.meta.renamedHeaders)
          if (header.error) {
            settle(resolve, { rows: 0, error: header.error })
            parser.abort()
            return
          }
          fields = header.fields
        }
        if (results.errors.some(isMisaligned)) {
          settle(resolve, { rows, error: misalignedRowError(seen + 1) })
          parser.abort()
          return
        }
        const row = cleanRow(results.data, fields)
        if (!row) return
        rows += 1
        try {
          onRow(row, rows)
        } catch (error) {
          settle(reject, error)
          parser.abort()
        }
      },
      complete() {
        settle(resolve, rows === 0
          ? { rows: 0, error: readErrorFor('it has a header row but no data rows') }
          : { rows, error: null })
      },
      error(error) {
        settle(resolve, { rows, error: readErrorFor(error.message) })
      },
    })
  })
}
