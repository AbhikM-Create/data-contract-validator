// CSV reading. The only module that knows about papaparse or about File
// objects; the engine takes plain arrays of row objects and nothing else.
//
// Everything happens in the page: the File is read with the browser's own
// FileReader and handed straight to the parser. There is no upload, no fetch,
// no storage.

import Papa from 'papaparse'

const EXPECTATION = 'Expected: a CSV with a header row and at least one data row.'

function readError(reason) {
  return `Couldn’t read this file — ${reason}. ${EXPECTATION}`
}

// parseCsv(csvText) -> { rows, columns, errors }
//
// Returns rows: [] together with a reader-facing sentence whenever the file
// can't be used, so the caller always has something to show. Never throws.
export function parseCsv(csvText) {
  const text = String(csvText ?? '').replace(/^﻿/, '').trim()
  if (text === '') return { rows: [], columns: [], errors: [readError('the file is empty')] }

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', dynamicTyping: false })

  // "day, amount" is a perfectly ordinary header, and its second column is
  // keyed as " amount " in every parsed row. Column names are reported trimmed,
  // but each row must still be read by the raw key it was stored under —
  // reading by the trimmed name returns undefined for every cell, which would
  // look like a column that has silently gone blank.
  const fields = (parsed.meta.fields ?? [])
    .map((field) => ({ raw: field, name: String(field ?? '').trim() }))
    .filter((field) => field.name !== '')
  const columns = fields.map((field) => field.name)

  if (columns.length === 0) {
    return { rows: [], columns: [], errors: [readError('it has no header row')] }
  }

  const collision = columns.find((name, i) => columns.indexOf(name) !== i)
  if (collision) {
    return {
      rows: [], columns,
      errors: [readError(`the header uses the name "${collision}" more than once, so those columns can’t be told apart`)],
    }
  }

  // Papa does not hand back a repeated header name twice — it silently renames
  // the second one ("revenue" -> "revenue_1") and records that in
  // meta.renamedHeaders. Left alone, the rename would sail through as a normal
  // column and surface later as a baffling "extra column" violation, so the
  // real problem is reported here instead.
  const renamed = Object.values(parsed.meta.renamedHeaders ?? {})
  if (renamed.length > 0) {
    return {
      rows: [], columns,
      errors: [readError(`the header uses the name "${renamed[0]}" more than once, so those columns can’t be told apart`)],
    }
  }

  // Papa reports a delimiter/field-count problem per offending row; one sentence
  // naming the first bad line is more use to a reader than fifty.
  const structural = parsed.errors.filter((error) => error.type === 'Delimiter' || error.code === 'TooManyFields' || error.code === 'TooFewFields')
  if (structural.length > 0) {
    const line = (structural[0].row ?? 0) + 2
    return {
      rows: [], columns,
      errors: [readError(`row ${line} doesn’t line up with the header — check for an extra or missing comma`)],
    }
  }

  const rows = parsed.data
    .map((row) => {
      const clean = {}
      for (const field of fields) {
        const value = row[field.raw]
        clean[field.name] = value === null || value === undefined ? '' : String(value).trim()
      }
      return clean
    })
    .filter((row) => columns.some((name) => row[name] !== ''))

  if (rows.length === 0) {
    return { rows: [], columns, errors: [readError('it has a header row but no data rows')] }
  }

  return { rows, columns, errors: [] }
}

// Reads a File/Blob from an <input type="file"> or a drop, entirely in-browser.
export async function parseCsvFile(file) {
  if (!file) return { rows: [], columns: [], errors: [readError('no file was given')], name: null }
  const name = file.name ?? 'file.csv'
  try {
    const text = await file.text()
    return { ...parseCsv(text), name }
  } catch {
    return { rows: [], columns: [], errors: [readError(`the browser could not read "${name}"`)], name }
  }
}
