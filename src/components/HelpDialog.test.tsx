// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { HelpDialog } from './HelpDialog'

describe('HelpDialog', () => {
  it('switches topics, shows build versions, and closes with Escape', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onClose = vi.fn()

    await act(async () => root.render(<HelpDialog open onClose={onClose} />))
    expect(container.textContent).toContain('Write together, publish deliberately')

    const review = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'))
      .find((button) => button.textContent === 'Review')
    await act(async () => review?.click())
    expect(container.textContent).toContain('Keep discussion attached to the work')

    const about = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'))
      .find((button) => button.textContent === 'About')
    await act(async () => about?.click())
    expect(container.textContent).toContain(`MyST parser${__MYST_PARSER_VERSION__}`)
    expect(container.textContent).toContain(`Build revision${__BUILD_REVISION__}`)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })
})