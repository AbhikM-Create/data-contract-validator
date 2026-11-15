import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PACKS } from '../src/packs/index.js'
import { NEVER_CLAIM } from '../src/lib/signoff.js'
import { describeRule } from '../src/lib/rules.js'
import { USAGE as CHECK_USAGE } from '../cli/check.mjs'
import { USAGE as RECONCILE_USAGE } from '../cli/reconcile.mjs'
import { createHash } from 'node:crypto'
import { buildSite, PAGES } from './build-site.mjs'
import { buildSamples, SAMPLES } from './site-samples.mjs'
import { ARTIFACT_TITLE, ENTRY, publishSite } from './publish-site.mjs'

// The marketing site (brand Phases B and C, the docs under docs/): every page builds, every link inside the
// site lands on a file that exists, no page runs a script or reaches another
// origin, and no page claims what the sign-off record may never claim.

let out
let html
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'plumbstep-site-'))
  buildSite({ out })
  await buildSamples(out)
  html = Object.fromEntries(PAGES.map((p) => [p.file, readFileSync(join(out, p.file), 'utf8')]))
})
afterAll(() => rmSync(out, { recursive: true, force: true }))

const text = (page) => page.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ')

describe('the marketing site', () => {
  it('builds every page with its title, one h1, its description and the security policy', () => {
    for (const page of PAGES) {
      const doc = html[page.file]
      expect(doc).toContain(`<title>${page.title.replace(/&/g, '&amp;')}</title>`)
      expect(doc.match(/<h1>/g)).toHaveLength(1)
      expect(doc).toContain('<meta name="description"')
      expect(doc).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'none'/)
    }
  })

  it('runs no script and asks nothing of another origin', () => {
    for (const doc of Object.values(html)) {
      expect(doc).not.toMatch(/<script|\son[a-z]+=|style="|javascript:/i)
      // Only links may point elsewhere — never a stylesheet, font, image or icon.
      expect(doc).not.toMatch(/<(link|img|source|iframe)[^>]+(href|src)="(https?:)?\/\//i)
    }
    expect(readFileSync(join(out, 'site.css'), 'utf8')).not.toMatch(/url\((['"]?)(https?:)?\/\//)
  })

  it('every link inside the site lands on a file that is there', () => {
    for (const [file, doc] of Object.entries(html)) {
      for (const [, href] of doc.matchAll(/href="([^"]+)"/g)) {
        if (/^https?:\/\//.test(href)) continue
        if (href.startsWith('#')) {
          expect(doc, `${file} → ${href}`).toContain(`id="${href.slice(1)}"`)
          continue
        }
        const target = normalize(join(dirname(file), href.split('#')[0]))
        if (target.split(/[\\/]/)[0] === 'app') continue // the app, copied in by the real build
        expect(existsSync(join(out, target)), `${file} → ${href}`).toBe(true)
        const anchor = href.split('#')[1]
        if (anchor) expect(readFileSync(join(out, target), 'utf8'), `${file} → ${href}`).toContain(`id="${anchor}"`)
      }
    }
    for (const font of ['Geist.woff2', 'GeistMono.woff2', 'OFL.txt']) expect(existsSync(join(out, 'assets', 'fonts', font))).toBe(true)
  })

  it('claims nothing the sign-off record may never claim', () => {
    for (const [file, doc] of Object.entries(html)) {
      const words = text(doc)
      expect(NEVER_CLAIM.filter((pattern) => pattern.test(words)).map(String), file).toEqual([])
      // It never claims more than a check proves, and never offers to upload.
      expect(words, file).not.toMatch(/\bguarantee|\bupload (your|a|the) /i)
    }
  })

  it('lists every pack and object from the pack files, and says a draft is a draft', () => {
    const packs = html['packs.html']
    for (const pack of PACKS) {
      expect(packs).toContain(`id="${pack.id}"`)
      for (const object of pack.objects) expect(packs).toContain(`<h3>${object.name}</h3>`)
      if (pack.status === 'draft') expect(packs).toMatch(new RegExp(`id="${pack.id}"[\\s\\S]*?Draft — not yet run on real exports`))
    }
  })

  it('a sample record says it is a sample before anything else, runs nothing, and names every file it ships by the SHA-256 of its bytes', () => {
    const sha = (file) => createHash('sha256').update(readFileSync(join(out, file))).digest('hex')
    for (const sample of SAMPLES) {
      const record = readFileSync(join(out, sample.record), 'utf8')
      const front = record.slice(0, record.indexOf('</header>'))
      expect(front.indexOf('A sample.'), sample.id).toBeGreaterThan(-1)
      expect(front.indexOf('A sample.'), sample.id).toBeLessThan(front.indexOf('<h1>'))
      expect(record).not.toMatch(/<script/i)
      expect(record).toMatch(/Content-Security-Policy" content="default-src 'none'/)
      // Re-checkable: every data file published beside it is the one it fingerprinted.
      for (const input of sample.inputs.filter((f) => f.endsWith('.csv'))) expect(record, `${sample.id}: ${input}`).toContain(sha(input))
      expect(text(record)).toMatch(/dcv (change|check|reconcile) /)
    }
  })

  it('the samples tell the story their examples pin: not allowed, not ready, did not reconcile', () => {
    const record = (id) => text(readFileSync(join(out, SAMPLES.find((s) => s.id === id).record), 'utf8'))
    expect(record('salary-revision')).toMatch(/Not allowed/)
    expect(record('salary-revision')).toMatch(/30%, above the allowed 20%/)
    expect(record('trial-balance')).toMatch(/Not ready[\s\S]*Did not reconcile/)
    // Pay and identifiers are tagged in the salary sample, so their values never appear.
    expect(readFileSync(join(out, SAMPLES[0].record), 'utf8')).not.toMatch(/67600|50100099999999/)
  })

  it('the home page carries the facts band, and How it works links every sample and answers its questions', () => {
    expect(html['index.html']).toMatch(/class="facts-band"/)
    expect(text(html['index.html'])).toMatch(/5 million rows\s+reconciled in about 2 minutes on the command line/)
    for (const sample of SAMPLES) for (const file of [sample.record, ...sample.inputs]) expect(html['how.html']).toContain(`href="${file}"`)
    expect(html['how.html'].match(/<details>/g).length).toBeGreaterThanOrEqual(5)
  })

  it('copies the app under app/ when one is given', () => {
    const site = mkdtempSync(join(tmpdir(), 'plumbstep-site-app-'))
    try {
      buildSite({ out: join(site, 'out'), app: join(process.cwd(), 'public') })
      expect(existsSync(join(site, 'out', 'app', 'favicon.svg'))).toBe(true)
    } finally {
      rmSync(site, { recursive: true, force: true })
    }
  })

  it('the pack reference states every rule, header and crosswalk entry the pack holds, in the engine’s words', () => {
    for (const pack of PACKS) {
      const page = text(html[`docs/pack-${pack.id}.html`])
      expect(page).toContain(pack.status === 'draft' ? 'Draft — not yet run on real exports' : 'Verified')
      for (const object of pack.objects) {
        for (const rule of object.contract?.rules ?? []) {
          // A rule whose target is a parameter reads as the parameter's name.
          const sentence = describeRule(rule).replace(/\{\{\w+\}\}.*$/, '')
          expect(page, `${pack.id}/${object.id}`).toContain(text(sentence.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])).trim())
        }
        for (const header of Object.values(object.columns ?? {}).flat()) expect(page).toContain(text(header.replace(/&/g, '&amp;').replace(/'/g, '&#39;')))
        for (const field of object.spec?.mapping ?? []) for (const [from, to] of Object.entries(field.map ?? {})) {
          expect(page).toContain(text(from.replace(/&/g, '&amp;').replace(/'/g, '&#39;')))
          expect(page).toContain(text(to.replace(/&/g, '&amp;').replace(/'/g, '&#39;')))
        }
      }
      expect(page).not.toContain('{{')
    }
  })

  it('the command-line page prints each command’s own usage line, and says the npm release is not out yet', () => {
    const page = html['docs/cli.html']
    for (const usage of [CHECK_USAGE, RECONCILE_USAGE]) expect(page).toContain(usage.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    expect(text(page)).toMatch(/first release to the public npm registry has not been made yet/)
  })

  it('the legal pages are shells that say so, and promise nothing', () => {
    const page = text(html['docs/legal.html'])
    expect(page.match(/Not yet written/g)).toHaveLength(3)
    expect(page).toMatch(/nothing on this site is a binding term/)
    expect(page).not.toMatch(/(we|you) (shall|agree|warrant)/i)
  })

  it('the Artifact publish: an entry of page content only, and every other file at its own path', () => {
    const site = mkdtempSync(join(tmpdir(), 'plumbstep-publish-'))
    try {
      buildSite({ out: site, app: join(process.cwd(), 'public') })
      const { entry, files } = publishSite(site)
      // The host supplies the document skeleton; the entry must not bring its own.
      expect(entry).not.toMatch(/<!doctype|<(html|head|body)[\s>]|<\/(html|head|body)>/i)
      expect(entry.startsWith(`<title>${ARTIFACT_TITLE}</title>`)).toBe(true)
      expect(entry).toContain(readFileSync(join(site, 'site.css'), 'utf8').trim())
      expect(entry).not.toContain('rel="stylesheet"')
      expect(entry).toContain('<h1>')
      // Every file but the home page (it IS the entry) is published, sources resolving to real files.
      const built = PAGES.map((p) => p.file).filter((f) => f !== 'index.html')
      for (const file of [...built, 'site.css', 'favicon.svg', 'assets/fonts/Geist.woff2', 'app/favicon.svg']) expect(Object.keys(files)).toContain(file)
      expect(Object.keys(files)).not.toContain('index.html')
      expect(Object.keys(files)).not.toContain(ENTRY)
      expect(files['assets/fonts/Geist.woff2'].contentType).toBe('font/woff2')
      // The workspace is linked by its page, which a host given a file list can serve.
      for (const doc of Object.values(html)) expect(doc).not.toMatch(/href="(\.\.\/)*app\/"/)
    } finally {
      rmSync(site, { recursive: true, force: true })
    }
  })
})
