import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { watchErrors } from './helpers.js'

// User state 5, as far as a browser without an account can see it: the
// Organisation screen says what an organisation shares and what it never
// shares, names the four roles, and offers nothing a signed-out person cannot
// do. The signed-in flows are held by the database's own isolation tests
// (supabase/tests/rls.sql), which run in CI against the real policies.

test('signed out, the Organisation screen explains itself, lists the roles and offers only sign-in', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/organisation')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organisation')
  await expect(page.getByText(/Files are never uploaded: members share definitions, results as counts, decisions and signatures/)).toBeVisible()
  await expect(page.getByText('Sign in to create or join an organisation')).toBeVisible()
  for (const role of ['Admin', 'Editor', 'Approver', 'Viewer']) await expect(page.getByRole('rowheader', { name: role })).toBeVisible()
  // No invitation form, no member list, no create button for a signed-out visitor.
  await expect(page.getByLabel('email to invite')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create organisation' })).toHaveCount(0)
  // It is in the nav, like any screen.
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Organisation' })).toHaveAttribute('aria-current', 'page')

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(errors).toEqual([])
})
