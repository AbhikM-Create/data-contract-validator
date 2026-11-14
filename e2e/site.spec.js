import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { buildSite, PAGES } from '../scripts/build-site.mjs'
import { buildSamples } from '../scripts/site-samples.mjs'
import { watchErrors } from './helpers.js'

// The marketing site in a browser: every page passes the accessibility sweep at
// desktop and phone width, nothing scrolls sideways, and the page's own
// security policy refuses nothing it needs (no console error). The pages are
// served from a fresh build through a route, on an origin of their own.

const ORIGIN = 'http://plumbstep.test'
const TYPES = { '.html': 'text/html', '.csv': 'text/csv', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' }

let out
test.beforeAll(async () => {
  out = test.info().outputPath('site')
  buildSite({ out })
  await buildSamples(out)
})

async function serve(page) {
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(1) || 'index.html'
    try {
      route.fulfill({ body: readFileSync(join(out, path)), contentType: TYPES[extname(path)] ?? 'application/octet-stream' })
    } catch {
      route.fulfill({ status: 404, body: 'not found' })
    }
  })
}

// Light is Direction C; dark is Blueprint, chosen by the system setting alone
// (the site runs no script), so each width is swept in both.
for (const [width, scheme] of [[1280, 'light'], [375, 'light'], [1280, 'dark'], [375, 'dark']]) {
  test(`every page at ${width} px, ${scheme}: accessible, no sideways scroll, nothing refused`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width, height: 900 })
    await serve(page)
    const errors = watchErrors(page)
    for (const { file } of PAGES) {
      await page.goto(`${ORIGIN}/${file}`)
      await expect(page.locator('h1')).toBeVisible()
      expect(await page.evaluate(() => document.fonts.check('16px Geist'))).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), file).toBe(true)
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
      expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${file}: ${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message ?? '')).join(' | ')}`)).toEqual([])
    }
    expect(errors).toEqual([])
  })
}

test('the bar marks the page you are on, and the home link goes home', async ({ page }) => {
  await serve(page)
  await page.goto(`${ORIGIN}/packs.html`)
  await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Packs' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('banner').getByRole('link', { name: 'Plumbstep home' }).click()
  await expect(page).toHaveURL(`${ORIGIN}/index.html`)
  await expect(page.getByRole('link', { name: 'Open the workspace' }).first()).toHaveAttribute('href', 'app/index.html')
})

test('dark follows the system setting: the page ground and the mark change with it', async ({ page }) => {
  await serve(page)
  const look = async (scheme) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto(`${ORIGIN}/index.html`)
    return page.evaluate(() => ({
      ground: getComputedStyle(document.body).backgroundColor,
      mark: getComputedStyle(document.querySelector('.brand .ink')).stroke,
    }))
  }
  const light = await look('light')
  const dark = await look('dark')
  expect(dark.ground).not.toBe(light.ground)
  expect(dark.mark).not.toBe(light.mark)
})
