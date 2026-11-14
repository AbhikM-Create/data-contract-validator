import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

// Two themes: light (Direction C) and dark (Direction A, "Blueprint"). Dark
// follows the system setting unless the person picks one in the bar; the pick
// is kept on this device and survives a reload.

const ground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const LIGHT = 'rgb(238, 243, 246)'
const DARK = 'rgb(10, 17, 23)'

test.describe('with a dark system setting', () => {
  test.use({ colorScheme: 'dark' })

  test('the page is dark by default; picking light wins, survives a reload, and "system" hands back', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/#/')
    await expect(page.locator('main')).toBeVisible()
    expect(await ground(page)).toBe(DARK)

    const picker = page.getByLabel('Colour theme')
    await picker.selectOption('light')
    expect(await ground(page)).toBe(LIGHT)
    await page.reload()
    await expect(page.getByLabel('Colour theme')).toHaveValue('light')
    expect(await ground(page)).toBe(LIGHT)

    await page.getByLabel('Colour theme').selectOption('system')
    expect(await ground(page)).toBe(DARK)
    expect(errors).toEqual([])
  })
})

test.describe('with a light system setting', () => {
  test.use({ colorScheme: 'light' })

  test('the page is light by default, and dark when picked', async ({ page }) => {
    await page.goto('/#/')
    await expect(page.locator('main')).toBeVisible()
    expect(await ground(page)).toBe(LIGHT)
    await page.getByLabel('Colour theme').selectOption('dark')
    expect(await ground(page)).toBe(DARK)
  })
})
