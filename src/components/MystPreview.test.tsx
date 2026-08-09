// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { MystPreview } from './MystPreview'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const figure = `
:::{figure} ./images/result.svg
:alt: Result summary

A static result.
:::
`

describe('MystPreview', () => {
  it('preserves loaded images across debounced content updates', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<MystPreview content={`# Draft\n\nFirst paragraph.\n${figure}`} />)
    })
    const originalImage = container.querySelector('img')
    expect(originalImage).not.toBeNull()

    await act(async () => {
      root.render(<MystPreview content={`# Draft\n\nUpdated paragraph.\n${figure}`} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500))
    })

    expect(container.querySelector('img')).toBe(originalImage)
    expect(container.textContent).toContain('Updated paragraph.')

    await act(async () => root.unmount())
  })
})
