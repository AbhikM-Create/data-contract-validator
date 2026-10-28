import { execFileSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The commit this bundle was built from, stamped into evidence packs so a
// verdict can be traced to the code that produced it. Null outside a git
// checkout — never invented.
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

// A Content-Security-Policy for the built app. The page renders values out of
// files people upload, so even though React escapes them, the page is not
// allowed to run any script it did not ship with, load anything from
// elsewhere, or send data anywhere but the Supabase project it is configured
// for. Build only: the dev server injects inline scripts for hot reload, and a
// policy that has to be switched off in development is one nobody tests.
//
// frame-ancestors cannot be set from a <meta>; set it as an HTTP header where
// the app is hosted (see README, "Hosting").
function contentSecurityPolicy(supabaseUrl) {
  let supabase = ''
  try {
    if (supabaseUrl) {
      const origin = new URL(supabaseUrl).origin
      supabase = ` ${origin} ${origin.replace(/^http/, 'ws')}`
    }
  } catch {
    supabase = ''
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self'",
    // React sets style attributes; no style sheet is loaded from elsewhere.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${supabase}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    // Relative base so the built bundle works wherever it is served from —
    // a static host, a subpath, or an Artifact page next to its own assets.
    base: './',
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL)],
    define: { __DCV_COMMIT__: JSON.stringify(gitCommit()) },
    server: { port: 5174, strictPort: true },
    // Stable output names instead of content hashes: the published wrapper in
    // publish/ references app.js by name, so a rebuild never invalidates it.
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'app.js',
          chunkFileNames: 'app-[name].js',
          assetFileNames: 'app[extname]',
        },
      },
    },
    test: { exclude: ['e2e/**', 'node_modules/**'] },
  }
})
