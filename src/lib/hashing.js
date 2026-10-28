// Fingerprints for the evidence pack. Pure: Web Crypto exists in every browser
// and in Node 20+, so this runs the same in the page, the worker and the CLIs.

const encoder = new TextEncoder()

// sha256Hex(text | bytes) -> lowercase hex, the form `sha256sum` prints.
//
// Hash the file's BYTES when there is a file: decoding to text first drops a
// byte-order mark and repairs invalid UTF-8, and the digest of the repaired
// text would not match what an auditor gets from the file on disk.
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// canonicalJson(value) -> the same text for the same content, whatever order
// its keys were written in, so a fingerprint changes only when the content
// does. Arrays keep their order: the order of rules and fields is content.
export function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sort(v[k])]))
    }
    return v
  }
  return JSON.stringify(sort(value), null, 2)
}
