// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { MystEditableBlock } from '../lib/myst'
import { VisualInlineEditor } from './VisualInlineEditor'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const bibliography = `@article{smith2024,
  title={A paper},
  author={Smith, Ada},
  year={2024}
}`

const block: MystEditableBlock = {
  id: 'visual-block',
  kind: 'paragraph',
  from: 0,
  to: 5,
  value: 'Prior',
  inline: [{ type: 'text', value: 'Prior' }],
}

describe('VisualInlineEditor', () => {
  it('inserts an atomic citation from the picker callback and serializes it to MyST', async () => {
    const onSave = vi.fn()
    const onRequestCitation = vi.fn((insert: (keys: string[], style: 'parenthetical') => void) => {
      insert(['smith2024'], 'parenthetical')
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <VisualInlineEditor
          bibliography={bibliography}
          block={block}
          onCancel={() => undefined}
          onRequestCitation={onRequestCitation}
          onSave={onSave}
        />,
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Cite a paper"]')?.click()
    })

    const chip = container.querySelector<HTMLElement>('[data-visual-citation]')
    expect(chip?.textContent).toBe('(Smith, 2024)')
    expect(chip?.getAttribute('contenteditable')).toBe('false')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]).toContain('{cite:p}`smith2024`')

    await act(async () => root.unmount())
  })

  it('serializes inserted citations in the manuscript citation syntax', async () => {
    const onSave = vi.fn()
    const onRequestCitation = vi.fn((insert: (keys: string[], style: 'parenthetical') => void) => {
      insert(['smith2024'], 'parenthetical')
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <VisualInlineEditor
          bibliography={bibliography}
          block={block}
          citationSyntax="markdown"
          onCancel={() => undefined}
          onRequestCitation={onRequestCitation}
          onSave={onSave}
        />,
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Cite a paper"]')?.click()
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })

    expect(onSave.mock.calls[0][0]).toContain('[@smith2024]')

    await act(async () => root.unmount())
  })
})