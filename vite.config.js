import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built bundle works wherever it is served from —
  // a static host, a subpath, or an Artifact page next to its own assets.
  base: './',
  plugins: [react()],
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
})
