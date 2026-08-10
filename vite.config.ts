/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const apiTarget = process.env.DEMYSTIFY_API_TARGET ?? 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{
      find: 'markdown-it/lib/common/utils.js',
      replacement: fileURLToPath(
        new URL('./src/shims/markdownItUtils.ts', import.meta.url),
      ),
    }, {
      find: /^@citation-js\/core$/,
      replacement: fileURLToPath(
        new URL('./src/shims/citationJsCore.ts', import.meta.url),
      ),
    }],
  },
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    proxy: {
      '/api': apiTarget,
      '/collaboration': {
        target: apiTarget.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
  test: {
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'server/**/*.{test,spec}.{ts,tsx}',
    ],
    server: {
      deps: {
        inline: [/myst-/, /markdown-it/],
      },
    },
  },
})
