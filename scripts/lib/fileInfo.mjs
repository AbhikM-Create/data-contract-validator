// A file as the evidence pack names it: its name, size, record count and the
// SHA-256 of its exact bytes, streamed so a multi-gigabyte extract is
// fingerprinted in constant memory. The digest is the one `sha256sum` prints.

import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'

export function fileInfo(path, rows) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve({ name: basename(path), rows, bytes: statSync(path).size, sha256: hash.digest('hex') }))
  })
}
