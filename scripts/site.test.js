import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PACKS } from '../src/packs/index.js'
import { NEVER_CLAIM } from '../src/lib/signoff.js'
import { buildSite, PAGES } from './build-site.mjs'

// The marketing site (brand Phase B): every page builds, every link inside the
// site lands on a file that exists, no page runs a script or reaches another
// origin, and no page claims what the sign-off record may never claim.

let out
let html
beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'plumbstep-site-'))
  buildSite({ out })
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
        if (href.startsWith('app/')) continue // the app, copied in by the real build
        expect(existsSync(join(out, href.split('#')[0])), `${file} → ${href}`).toBe(true)
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

  it('copies the app under app/ when one is given', () => {
    const site = mkdtempSync(join(tmpdir(), 'plumbstep-site-app-'))
    try {
      buildSite({ out: join(site, 'out'), app: join(process.cwd(), 'public') })
      expect(existsSync(join(site, 'out', 'app', 'favicon.svg'))).toBe(true)
    } finally {
      rmSync(site, { recursive: true, force: true })
    }
  })
})
