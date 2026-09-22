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
export async function parseFileInWorker(which, file) {
  return send({ type: 'parse', which, text: await file.text(), name: file.name })
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
