// Browser tests against the PRODUCTION build (`vite build` + `vite preview`),
// so they exercise what users get — including the Content-Security-Policy,
// which only the build carries.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4174 --strictPort',
      url: 'http://localhost:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // A second build, configured for a Supabase project and single sign-on.
    // The project does not exist: e2e/sso.spec.js answers its requests in the
    // browser, so the real Supabase client runs the real redirect flow.
    {
      command: 'npx vite build --outDir dist-sso && npx vite preview --outDir dist-sso --port 4175 --strictPort',
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_ANON_KEY: 'e2e-anon-key', VITE_SSO: 'saml,microsoft' },
      url: 'http://localhost:4175',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', testIgnore: /(sso|signoff-flow)\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'configured', testMatch: /(sso|signoff-flow)\.spec\.js/, use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4175' } },
  ],
})
