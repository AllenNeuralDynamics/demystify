import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'markdown-it/lib/common/utils.js': fileURLToPath(
        new URL('./src/shims/markdownItUtils.ts', import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/collaboration': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
  },
})
