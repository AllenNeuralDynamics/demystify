/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const apiTarget = process.env.DEMYSTIFY_API_TARGET ?? 'http://127.0.0.1:8787'
const packageMetadata = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string
  dependencies: Record<string, string>
}
const dependencyVersion = (name: string) =>
  packageMetadata.dependencies[name]?.replace(/^[^\d]*/, '') ?? 'unknown'
const buildRevision = (
  process.env.VITE_GIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.REPLIT_GIT_COMMIT_SHA ??
  'local'
).slice(0, 7)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_REVISION__: JSON.stringify(buildRevision),
    __DEMYSTIFY_VERSION__: JSON.stringify(packageMetadata.version),
    __MYST_PARSER_VERSION__: JSON.stringify(dependencyVersion('myst-parser')),
    __REACT_VERSION__: JSON.stringify(dependencyVersion('react')),
    __YJS_VERSION__: JSON.stringify(dependencyVersion('yjs')),
  },
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
