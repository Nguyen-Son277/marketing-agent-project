import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Vite config for the web client.
 *
 * The dev server proxies `/api`, `/healthz` and `/readyz` to the Node server so the
 * browser sees one origin. That matters because the session cookie is HttpOnly and
 * SameSite=Lax: with two origins the browser would refuse to send it on fetch.
 */
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Trỏ vào entry dành cho trình duyệt: `index.ts` re-export `node:crypto`,
      // thứ không tồn tại trong trình duyệt và sẽ làm hỏng build.
      '@marketing-agent/shared': fileURLToPath(
        new URL('../../packages/shared/src/browser.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/healthz': { target: backend, changeOrigin: false },
      '/readyz': { target: backend, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // A single chunk keeps the self-hosted deployment simple; the app is small.
    chunkSizeWarningLimit: 1_200,
  },
})
