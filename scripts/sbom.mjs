// A CycloneDX 1.5 SBOM of what the CLI package ships with: its production
// dependencies, each with its licence and the lockfile's SHA-512.
//
//   node scripts/sbom.mjs > sbom.cdx.json      (npm run sbom)
//
// Why not `npm sbom --omit dev`: it drops a production dependency that a dev
// tool also uses (yaml, shared with Vite) — an SBOM missing a runtime
// dependency is worse than none, because it is believed. `npm ls --omit=dev`
// classifies correctly, so the component list is built from it.

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }))

const purl = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`
const hex = (integrity) => {
  const match = /^sha512-(.+)$/.exec(integrity ?? '')
  return match ? Buffer.from(match[1], 'base64').toString('hex') : null
}
const lockEntry = (name, version) =>
  Object.entries(lock.packages).find(([path, entry]) => path.endsWith(`node_modules/${name}`) && entry.version === version)?.[1] ?? {}

const components = new Map()
const dependencies = new Map()
function walk(name, node, parentRef) {
  const ref = purl(name, node.version)
  if (parentRef) dependencies.get(parentRef).add(ref)
  if (components.has(ref)) return
  const entry = lockEntry(name, node.version)
  const sha = hex(entry.integrity)
  components.set(ref, {
    type: 'library',
    'bom-ref': ref,
    name,
    version: node.version,
    purl: ref,
    ...(entry.license ? { licenses: [/[ ()]/.test(entry.license) ? { expression: entry.license } : { license: { id: entry.license } }] } : {}),
    ...(sha ? { hashes: [{ alg: 'SHA-512', content: sha }] } : {}),
  })
  dependencies.set(ref, new Set())
  for (const [childName, child] of Object.entries(node.dependencies ?? {})) walk(childName, child, ref)
}

const self = purl(pkg.name, pkg.version)
dependencies.set(self, new Set())
for (const [name, node] of Object.entries(tree.dependencies ?? {})) walk(name, node, self)

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'scripts/sbom.mjs' }] },
    component: { type: 'application', 'bom-ref': self, name: pkg.name, version: pkg.version, purl: self },
  },
  components: [...components.values()],
  dependencies: [...dependencies].map(([ref, on]) => ({ ref, dependsOn: [...on] })),
}
process.stdout.write(`${JSON.stringify(bom, null, 2)}\n`)
