// Reading CSV files too large to hold, in Node. Not part of the engine: it
// touches the file system, and src/lib stays pure.
//
// A file is read by exactly the rules parseCsv applies to an upload — the same
// header checks, the same trimming, the same skipping of empty rows, the same
// sentence for a row that does not line up — because both call the helpers
// parseCsv exports. Row numbers count data rows from 1, as parseCsv's do, so a
// record is "row 4,812" whichever way the file was read.

import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs'
import { Transform } from 'node:stream'
import Papa from 'papaparse'
import { decodeBytes } from '../../src/lib/formats.js'
import { cleanRow, isMisaligned, misalignedRowError, readErrorFor, readHeader } from '../../src/lib/parseCsv.js'

// The same refusal decodeBytes gives a page upload, so a file is refused in
// the same words however it is read.
const NOT_UTF8 = decodeBytes(new Uint8Array([0xff])).error

// Bytes to text in the declared encoding, strictly for UTF-8. A multi-byte
// character split across two read chunks is held over, not broken.
function decoding(encoding) {
  const id = encoding || 'utf-8'
  const decoder = new TextDecoder(id, { fatal: id === 'utf-8' })
  const fail = (callback) => {
    const error = new Error(NOT_UTF8)
    error.decoding = true
    callback(error)
  }
  return new Transform({
    readableObjectMode: true,
    transform(chunk, _encoding, callback) {
      try {
        callback(null, decoder.decode(chunk, { stream: true }))
      } catch {
        fail(callback)
      }
    },
    flush(callback) {
      try {
        const rest = decoder.decode()
        callback(null, rest || undefined)
      } catch {
        fail(callback)
      }
    },
  })
}

const HEADER_PROBE_BYTES = 1 << 20

// readCsvHeader(path, encoding) -> { columns, error }
//
// The header alone, before any row is streamed: both engines need every column
// name up front, to refuse a spec or contract that names a column the file does
// not have before spending a pass over twenty million rows.
export function readCsvHeader(path, encoding = 'utf-8') {
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
  // stream: true, because the probe may end part-way through a character.
  let text
  try {
    text = new TextDecoder(encoding || 'utf-8', { fatal: (encoding || 'utf-8') === 'utf-8' })
      .decode(buffer, { stream: true }).replace(/^\uFEFF/, '')
  } catch {
    return { columns: [], error: readErrorFor(NOT_UTF8) }
  }
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

// streamCsv(path, onRow, encoding) -> Promise<{ rows, error }>
//
// Calls onRow(row, rowNumber) for every data row, in file order, holding one
// row at a time. Resolves with the row count, or with the same reader-facing
// sentence parseCsv would give, never by throwing on a bad file. If onRow
// throws, the read stops and the promise rejects with that error.
export function streamCsv(path, onRow, encoding = 'utf-8') {
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

    const source = createReadStream(path).pipe(decoding(encoding))
    Papa.parse(source, {
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
        settle(resolve, { rows, error: readErrorFor(error.decoding ? NOT_UTF8 : error.message) })
      },
    })
  })
}
