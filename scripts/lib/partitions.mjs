// Splitting records across temporary files by a hash of their key, so a join or
// a duplicate count over files too large to hold can be done one partition at a
// time. Every record with the same key lands in the same partition, which is
// what makes a per-partition answer exact for the whole file.
//
// THIS WRITES COMPANY DATA TO LOCAL DISK: keys, and for a reconciliation the
// mapped field values. Only to a directory made for the run (mkdtemp, owner
// only, files 0600), and makeScratchDir's remove() deletes it when the run ends
// — on success, failure or Ctrl-C. Nothing leaves the machine.
//
// A run that dies too hard for any handler — out of memory, kill -9, a power
// cut — cannot clean up after itself. So each run's directory carries its
// process id, and every run starts by deleting directories whose process is
// gone: a crash's leftovers last until the next run, not forever.

import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FLUSH_BYTES = 8 << 20

// A record on disk is one line of tab-separated fields. Measured on a real
// partition this reads back four to five times faster than JSON, which made it
// the difference on a five-million-row run. A CSV cell can hold a tab, a
// newline or a backslash (inside quotes), so those — and \r — are escaped;
// everything else is written as it is.
const NEEDS_ESCAPE = /[\\\t\n\r]/
const ESCAPED = /\\(.)/g
const UNESCAPE = { t: '\t', n: '\n', r: '\r' }

export function encodeFields(fields) {
  let line = ''
  for (let i = 0; i < fields.length; i += 1) {
    const text = String(fields[i] ?? '')
    if (i > 0) line += '\t'
    line += NEEDS_ESCAPE.test(text)
      ? text.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
      : text
  }
  return line
}

export function decodeFields(line) {
  const fields = line.split('\t')
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].indexOf('\\') !== -1) fields[i] = fields[i].replace(ESCAPED, (_, c) => UNESCAPE[c] ?? c)
  }
  return fields
}

// FNV-1a, 32 bit: fast, spreads short numeric keys evenly, and stable across
// runs. Collisions only put two keys in one partition; they are never merged.
export function hashKey(key) {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// How many partitions for this much input: enough that one partition, parsed,
// sits comfortably in memory. Bounded so a huge file cannot open thousands of
// files at once.
export function partitionsFor(bytes, bytesPerPartition) {
  return Math.min(256, Math.max(1, Math.ceil(bytes / bytesPerPartition)))
}

const SCRATCH = /^dcv-(\d+)-/

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists, it just isn't ours to signal. Only ESRCH means gone.
    return error.code !== 'ESRCH'
  }
}

// Deletes scratch directories in `parent` left by runs that no longer exist.
// Returns the names removed. A directory whose process is alive — another run
// in progress — is never touched; a reused pid only means one survives longer.
export function sweepAbandoned(parent = tmpdir()) {
  const removed = []
  let names = []
  try {
    names = readdirSync(parent)
  } catch {
    return removed
  }
  for (const name of names) {
    const match = SCRATCH.exec(name)
    if (!match || Number(match[1]) === process.pid || alive(Number(match[1]))) continue
    rmSync(join(parent, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

export function makeScratchDir(parent = tmpdir()) {
  const abandoned = sweepAbandoned(parent)
  if (abandoned.length > 0) {
    console.error(`Removed ${abandoned.length} temporary folder(s) left in ${parent} by an earlier run that did not finish.`)
  }
  const dir = mkdtempSync(join(parent, `dcv-${process.pid}-`))
  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    rmSync(dir, { recursive: true, force: true })
  }
  const onSignal = () => {
    remove()
    process.exit(130)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  return {
    dir,
    remove() {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      remove()
    },
  }
}

// createPartitions(count, { dir, name }) -> { add, read, close }
//
// add(key, fields) files a record — an array of strings — under its key's
// partition; read(i) returns partition i's records as arrays of strings, in the
// order they were added (file order, since rows are added as they are read).
//
// One partition is kept in memory as it is — the small-file case pays nothing
// for the large-file machinery. More than one spills to `${dir}/${name}-${i}.tsv`,
// buffered and flushed in large writes.
export function createPartitions(count, { dir, name } = {}) {
  if (count === 1) {
    const items = []
    return {
      count,
      add: (_key, fields) => items.push(fields.map((value) => String(value ?? ''))),
      read: () => items,
      close() {},
    }
  }

  const paths = Array.from({ length: count }, (_, i) => join(dir, `${name}-${i}.tsv`))
  const fds = paths.map((path) => openSync(path, 'w', 0o600))
  const buffers = paths.map(() => [])
  let buffered = 0

  const flush = () => {
    buffers.forEach((lines, i) => {
      if (lines.length === 0) return
      writeSync(fds[i], `${lines.join('\n')}\n`)
      buffers[i] = []
    })
    buffered = 0
  }

  return {
    count,
    add(key, fields) {
      const line = encodeFields(fields)
      buffers[hashKey(key) % count].push(line)
      buffered += line.length
      if (buffered >= FLUSH_BYTES) flush()
    },
    read(i) {
      const text = readFileSync(paths[i], 'utf8')
      if (text === '') return []
      const lines = text.split('\n')
      lines.pop() // the file ends in a newline
      return lines.map(decodeFields)
    },
    close() {
      flush()
      fds.forEach((fd) => closeSync(fd))
    },
  }
}
