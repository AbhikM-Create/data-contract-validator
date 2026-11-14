import { looksLikeWorkbook } from './fileKind.js'
import { decodeBytes } from './formats.js'

// Talking to the engine worker.
//
// One worker for the session, one promise per message. Vite's `new Worker(new
// URL(...), { type: 'module' })` form is what lets the worker be a real module
// and get bundled for production rather than only working in dev.

let worker = null
let nextId = 1
const pending = new Map()

function ensureWorker() {
  if (worker) return worker

  worker = new Worker(new URL('./engineWorker.js', import.meta.url), { type: 'module' })

  worker.onmessage = (event) => {
    const { id, ok, error, ...payload } = event.data
    const settle = pending.get(id)
    if (!settle) return
    pending.delete(id)
    if (ok) settle.resolve(payload)
    else settle.reject(new Error(error))
  }

  // If the worker itself dies — out of memory on a file too large for the tab
  // — every caller waiting on it must be told, or the UI waits for ever.
  worker.onerror = (event) => {
    const reason = new Error(event.message || 'The engine stopped unexpectedly, which usually means the file was too large for this browser tab.')
    for (const { reject } of pending.values()) reject(reason)
    pending.clear()
    worker.terminate()
    worker = null
  }

  return worker
}

function send(message) {
  const id = nextId
  nextId += 1
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ensureWorker().postMessage({ id, ...message })
  })
}

// Hands the file's TEXT across, not the File object: the worker reads it once
// and keeps the parsed rows, so nothing large is ever sent back.
//
// Decoded here in the declared encoding — strictly, for UTF-8. file.text()
// would quietly turn every accented letter of a Windows-1252 export into "�".
export async function parseFileInWorker(which, file, encoding = 'utf-8', workbook = {}) {
  return parseBytesInWorker(which, await file.arrayBuffer(), file.name, encoding, workbook)
}

// A workbook (.xlsx) is recognised by its bytes and read in the worker; the
// sheet, header row and declared decimal mark say how. Encoding does not apply.
export function parseBytesInWorker(which, bytes, name, encoding = 'utf-8', { sheet = null, headerRow = 1, decimal = '.' } = {}) {
  if (looksLikeWorkbook(bytes)) return send({ type: 'parseXlsx', which, bytes, name, sheet, headerRow, decimal })
  const { text, error } = decodeBytes(bytes, encoding)
  if (error) return Promise.reject(new Error(`Couldn’t read "${name}" — ${error}.`))
  return send({ type: 'parse', which, text, name })
}

export function parseTextInWorker(which, text, name) {
  return send({ type: 'parse', which, text, name })
}

export function clearFileInWorker(which) {
  return send({ type: 'clear', which })
}

export function validateInWorker({ rules, thresholds }) {
  return send({ type: 'validate', rules, thresholds })
}

// columnMap: the object's column matching (columnMap.js). The worker applies it
// to the files a check reads, and refuses the check if it does not fit them.
export function reconcileInWorker(spec, columnMap = {}) {
  return send({ type: 'reconcile', spec, columnMap })
}

// The change check over the before/after files the worker holds, with the
// approved list and change log when they were opened.
export function changeInWorker(contract) {
  return send({ type: 'change', contract })
}

export function readinessInWorker({ contract, key, columnMap = {} }) {
  return send({ type: 'readiness', contract, key, columnMap })
}

// Applies one file's column matching now -> { file, issues }: the file as the
// engine reads it, or why the map cannot be applied (the file is then left as
// it was).
export function columnMapInWorker(which, map = {}) {
  return send({ type: 'columnMap', which, map })
}

// tags/unmask/key: how the fix list is masked as it leaves the page (masking.js).
// owner: whose fix a rejected record is (signoff.js), named on every row.
export function fixListInWorker({ tags = {}, unmask = false, key = [], owner = '' } = {}) {
  return send({ type: 'fixList', tags, unmask, key, owner })
}
