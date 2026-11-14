import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

// The descent (components/descent.js): the one animation that explains a
// result. It plays once, ends exactly on the drawing's static final state, and
// never runs when the person has asked for reduced motion.

const running = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
const bobAt = (page, scope) => page.locator(`${scope} [data-descent="bob"]`).first().evaluate((el) => el.getBoundingClientRect().top)

async function validateReport(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Run this example' }).first().click()
  await expect(page.getByText('How far the file got')).toBeVisible()
  return '.iso-drawing'
}

test('a report: the bob descends once, and comes to rest exactly where the static drawing has it', async ({ page }) => {
  const errors = watchErrors(page)
  const scope = await validateReport(page)
  await page.locator(scope).scrollIntoViewIfNeeded()
  await expect.poll(() => running(page)).toBeGreaterThan(0)
  const during = await bobAt(page, scope)
  await expect.poll(() => running(page), { timeout: 5000 }).toBe(0)
  const after = await bobAt(page, scope)
  expect(after).toBeGreaterThan(during) // it was higher up the stairs while moving

  // The finished frame is the static drawing: with motion reduced, the bob is
  // drawn in the same place from the start.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await validateReport(page)
  await page.locator(scope).scrollIntoViewIfNeeded()
  expect(Math.abs((await bobAt(page, scope)) - after)).toBeLessThan(2)
  expect(errors).toEqual([])
})

test('reduced motion: nothing moves, on the home hero or on a report', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.hero-art')).toBeVisible()
  expect(await running(page)).toBe(0)
  await validateReport(page)
  await page.locator('.iso-drawing').scrollIntoViewIfNeeded()
  expect(await running(page)).toBe(0)
})

test('the same result shown again does not dance again', async ({ page }) => {
  await validateReport(page)
  await page.locator('.iso-drawing').scrollIntoViewIfNeeded()
  await expect.poll(() => running(page), { timeout: 5000 }).toBe(0)
  await page.evaluate(() => { window.location.hash = '/contracts' })
  await page.evaluate(() => { window.location.hash = '/validate' })
  await page.locator('.iso-drawing').scrollIntoViewIfNeeded()
  expect(await running(page)).toBe(0)
})

test('the home hero walks down every step and rests on the last', async ({ page }) => {
  await page.goto('/')
  await expect.poll(() => running(page)).toBeGreaterThan(0)
  await expect.poll(() => running(page), { timeout: 5000 }).toBe(0)
  const hero = page.locator('.hero-art')
  const last = await hero.locator('[data-descent-step="4"] polygon').last().boundingBox()
  const bob = await hero.locator('[data-descent="bob"] polygon').boundingBox()
  expect(bob.x).toBeGreaterThan(last.x)
  expect(bob.x).toBeLessThan(last.x + last.width)
})
