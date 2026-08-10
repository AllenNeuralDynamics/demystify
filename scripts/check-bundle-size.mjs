import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const kibibyte = 1_024
const assetDirectory = new URL('../dist/assets/', import.meta.url)
const budgets = {
  largestJavaScriptChunk: 400 * kibibyte,
  totalJavaScript: 850 * kibibyte,
  totalCss: 24 * kibibyte,
}

const formatSize = (bytes) => `${(bytes / kibibyte).toFixed(1)} KiB gzip`

const assetNames = await readdir(assetDirectory)
const measuredAssets = await Promise.all(
  assetNames
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map(async (name) => ({
      name,
      type: name.endsWith('.js') ? 'JavaScript' : 'CSS',
      gzipBytes: gzipSync(await readFile(new URL(name, assetDirectory))).byteLength,
    })),
)

const javaScriptAssets = measuredAssets.filter((asset) => asset.type === 'JavaScript')
const cssAssets = measuredAssets.filter((asset) => asset.type === 'CSS')
const largestJavaScript = javaScriptAssets.reduce(
  (largest, asset) => asset.gzipBytes > largest.gzipBytes ? asset : largest,
  { name: 'none', gzipBytes: 0 },
)
const totalJavaScript = javaScriptAssets.reduce((total, asset) => total + asset.gzipBytes, 0)
const totalCss = cssAssets.reduce((total, asset) => total + asset.gzipBytes, 0)

const measurements = [{
  label: `Largest JavaScript chunk (${largestJavaScript.name})`,
  actual: largestJavaScript.gzipBytes,
  budget: budgets.largestJavaScriptChunk,
}, {
  label: 'Total JavaScript',
  actual: totalJavaScript,
  budget: budgets.totalJavaScript,
}, {
  label: 'Total CSS',
  actual: totalCss,
  budget: budgets.totalCss,
}]

for (const measurement of measurements) {
  console.log(
    `${measurement.label}: ${formatSize(measurement.actual)} / ${formatSize(measurement.budget)}`,
  )
}

const exceeded = measurements.filter((measurement) => measurement.actual > measurement.budget)
if (exceeded.length > 0) {
  throw new Error(`Bundle budget exceeded: ${exceeded.map((item) => item.label).join(', ')}`)
}
