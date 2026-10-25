// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { WebsocketProvider } from 'y-websocket'
import type { MystEditableBlock } from '../lib/myst'
import { readVisualRecoveryDraft, visualObjectDraftKey, writeVisualRecoveryDraft } from '../lib/collaborationRecovery'
import * as visualModel from '../lib/visualDocument'
import { ContinuousVisualEditor, type ContinuousVisualEditorHandle } from './ContinuousVisualEditor'
import { CitationPicker } from './CitationPicker'
import { ReferenceManager } from './ReferenceManager'
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

describe('continuous Visual draft recovery', () => {
  it('keeps link, citation, reference and footnote editing unavailable in read-only mode', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const original = 'Read [site](https://example.org) and {cite:p}`smith2024`.\n\nNote[^note].\n\n[^note]: Body.'
    text.insert(0, original)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const onRequestCitation = vi.fn()
    const onEditReference = vi.fn()
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} bibliography={bibliography} editable={false}
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onRequestCitation={onRequestCitation} onEditReference={onEditReference}
        onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => { container.querySelector<HTMLElement>('[data-visual-citation]')!.click() })
      expect(container.querySelector<HTMLButtonElement>('[title="Link"]')?.disabled).toBe(true)
      expect(container.querySelector<HTMLButtonElement>('[title="Edit object source"]')?.disabled).toBe(true)
      expect(container.querySelector('[data-reference-key]')?.getAttribute('role')).not.toBe('button')
      expect(container.querySelector('[data-footnote-edit-key]')).toBeNull()
      expect(onRequestCitation).not.toHaveBeenCalled()
      expect(onEditReference).not.toHaveBeenCalled()
      expect(window.document.querySelector('.visual-link-popover')).toBeNull()
      expect(container.querySelector('.visual-object-editor')).toBeNull()
      expect(text.toString()).toBe(original)
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('rejects unsafe URLs and retains a link draft when concurrent edits invalidate its range', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const original = 'Read [site](https://example.org/prior).'
    text.insert(0, original)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => { container.querySelector('a')!.click() })
      const input = window.document.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!
      const update = async (value: string) => act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await update('javascript:alert(1)')
      await act(async () => { window.document.querySelector<HTMLButtonElement>('[title="Apply link"]')!.click() })
      expect(window.document.querySelector('.visual-link-popover [role="alert"]')?.textContent).toContain('not allowed')
      expect(text.toString()).toBe(original)
      await update('https://example.org/updated')
      await act(async () => { text.insert(0, 'Concurrent ') })
      await act(async () => { window.document.querySelector<HTMLButtonElement>('[title="Apply link"]')!.click() })
      expect(window.document.querySelector('.visual-link-popover [role="alert"]')?.textContent).toContain('document changed')
      expect(input.value).toBe('https://example.org/updated')
      expect(text.toString()).toBe(`Concurrent ${original}`)
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('edits rendered footnote definitions through the same protected object editor', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'A note[^note].\n\n[^note]: Footnote body.\n\nClosing paragraph.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => { container.querySelector<HTMLElement>('[data-footnote-edit-key="note"]')!.click() })
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="MyST object source"]')?.value).toBe('[^note]: Footnote body.')
      await changeObject(container, '[^note]: Updated footnote body.')
      await act(async () => { container.querySelector<HTMLButtonElement>('[title="Apply MyST object"]')!.click() })
      expect(text.toString()).toBe('A note[^note].\n\n[^note]: Updated footnote body.\n\nClosing paragraph.')
      expect(container.querySelector('[data-footnote-edit-key="note"]')?.textContent).toContain('Updated footnote body.')
      expect(container.textContent).toContain('Closing paragraph.')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('edits non-figure directive settings through the selected object action', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, ':::{admonition} Original title\n\nOriginal body.\n:::')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    let handle: ContinuousVisualEditorHandle | null = null
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={(next) => { handle = next }} onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => { handle!.revealRange(text.toString().indexOf('Original body'), text.toString().indexOf('Original body')) })
      const action = container.querySelector<HTMLButtonElement>('[title="Edit object source"]')!
      expect(action.disabled).toBe(false)
      await act(async () => { action.click() })
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="MyST object source"]')?.value).toBe(text.toString())
      await changeObject(container, text.toString().replace('Original title', 'Updated title'))
      await act(async () => { container.querySelector<HTMLButtonElement>('[title="Apply MyST object"]')!.click() })
      expect(text.toString()).toContain(':::{admonition} Updated title')
      expect(container.querySelector('.admonition-title')?.textContent).toBe('Updated title')
      expect(container.textContent).toContain('Original body.')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('opens generated bibliography entries in the reference manager', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Prior {cite:p}`smith2024`.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const onEditReference = vi.fn()
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} bibliography={bibliography} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onEditReference={onEditReference}
        onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => {
        container.querySelector<HTMLElement>('.visual-readonly-appendix [data-reference-key="smith2024"]')!.click()
      })
      expect(onEditReference).toHaveBeenCalledWith('smith2024')
      expect(text.toString()).toBe('Prior {cite:p}`smith2024`.')
      await act(async () => root.render(<ReferenceManager bibliography={bibliography}
        manuscript={text.toString()} readOnly={false} initialKey="smith2024"
        onClose={() => {}} onApply={() => 'applied'} />))
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('@article{smith2024')
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('Smith, Ada')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('opens cross-references in protected passages instead of navigating away', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, '(target)=\n\n# Target\n\nSee [target](#target) for $x$ details.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onProposeSourceEdit={() => ({ result: 'applied' })} />))
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      await act(async () => { container.querySelector('.visual-protected-block a')!.dispatchEvent(event) })
      expect(event.defaultPrevented).toBe(true)
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="MyST object source"]')?.value)
        .toBe('See [target](#target) for $x$ details.')
      expect(text.toString()).toContain('See [target](#target) for $x$ details.')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('reopens and replaces an existing citation rather than inserting a duplicate', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Prior {cite:p}`smith2024`.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const onRequestCitation = vi.fn()
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} bibliography={bibliography} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onRequestCitation={onRequestCitation}
        onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => {
        container.querySelector('[data-visual-citation]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(onRequestCitation).toHaveBeenCalledOnce()
      expect(onRequestCitation.mock.calls[0][1]).toEqual({
        keys: ['smith2024'], style: 'parenthetical', prefix: '', suffix: '',
      })
      await act(async () => { onRequestCitation.mock.calls[0][0](['smith2024'], 'narrative') })
      expect(text.toString()).toBe('Prior {cite:t}`smith2024`.')
      expect(container.querySelectorAll('[data-visual-citation]')).toHaveLength(1)
      expect(container.querySelector('[data-visual-citation]')?.textContent).toBe('Smith (2024)')
      await act(async () => { container.querySelector<HTMLElement>('[data-visual-citation]')!.click() })
      await act(async () => { text.insert(0, 'Concurrent ') })
      expect(() => onRequestCitation.mock.calls[1][0](['smith2024'], 'parenthetical')).toThrow('document changed')
      expect(text.toString()).toBe('Concurrent Prior {cite:t}`smith2024`.')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('refreshes the reference list when replacing a citation with another existing paper', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Prior {cite:p}`smith2024`.')
    const library = `${bibliography}\n@article{lee2025, title={Another paper}, author={Lee, Ada}, year={2025}}`
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const onRequestCitation = vi.fn()
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} bibliography={library} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onRequestCitation={onRequestCitation}
        onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => { container.querySelector<HTMLElement>('[data-visual-citation]')!.click() })
      await act(async () => { onRequestCitation.mock.calls[0][0](['lee2025'], 'parenthetical') })
      expect(text.toString()).toBe('Prior {cite:p}`lee2025`.')
      expect(container.querySelector('.visual-readonly-appendix')?.textContent).toContain('Another paper')
      expect(container.querySelector('.visual-readonly-appendix')?.textContent).not.toContain('A paper')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('prefills the citation picker with existing keys, style and locators', async () => {
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const onInsert = vi.fn()
    try {
      await act(async () => root.render(<CitationPicker roomName="local-citation-test"
        bibliography={bibliography} allowNewReferences={false}
        initial={{ keys: ['smith2024', 'unresolved'], style: 'narrative', prefix: 'see', suffix: 'p. 4' }}
        onClose={() => {}} onInsert={onInsert} />))
      expect(container.querySelector('h2')?.textContent).toBe('Edit citation')
      expect(container.querySelectorAll('.citation-result.selected')).toHaveLength(2)
      expect(container.querySelector<HTMLInputElement>('[aria-label="Citation prefix"]')?.value).toBe('see')
      expect(container.querySelector<HTMLInputElement>('[aria-label="Citation locator or suffix"]')?.value).toBe('p. 4')
      await act(async () => { container.querySelector<HTMLButtonElement>('.citation-picker-footer button')!.click() })
      expect(onInsert).toHaveBeenCalledWith([
        { kind: 'existing', key: 'smith2024' }, { kind: 'existing', key: 'unresolved' },
      ], 'narrative', { prefix: 'see', suffix: 'p. 4' })
    } finally { await act(async () => root.unmount()) }
  })

  it('opens an existing link destination for editing without changing its label', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Read the [project website](https://example.org/prior "Project home") for details.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])}
        content={text.toString()} sharedText={text} provider={provider} editable
        suggestionMode={false} comments={[]} suggestions={[]} onDraftChange={() => {}}
        onReady={() => {}} onProposeSourceEdit={() => ({ result: 'applied' })} />))
      await act(async () => {
        container.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      const input = window.document.querySelector<HTMLInputElement>('[aria-label="Link URL"]')
      expect(input?.value).toBe('https://example.org/prior')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://example.org/updated')
        input!.dispatchEvent(new Event('input', { bubbles: true }))
        input!.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => {
        window.document.querySelector('.visual-link-popover')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      expect(text.toString()).toBe('Read the [project website](https://example.org/updated "Project home") for details.')
      expect(container.querySelector('a')?.textContent).toBe('project website')
      await act(async () => { container.querySelector('a')!.click() })
      await act(async () => { window.document.querySelector<HTMLButtonElement>('[title="Cancel link edit"]')!.click() })
      expect(text.toString()).toContain('https://example.org/updated')
      await act(async () => { container.querySelector('a')!.click() })
      await act(async () => { window.document.querySelector<HTMLButtonElement>('[title="Remove link"]')!.click() })
      expect(text.toString()).toBe('Read the project website for details.')
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('coalesces Source typing without delaying shared edits or remote updates', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'A shared paragraph.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const input = window.document.createElement('div')
    input.className = 'cm-content'
    input.tabIndex = 0
    window.document.body.append(input)
    const root = createRoot(container)
    const render = vi.spyOn(visualModel, 'createVisualDocument')
    const configuration = {
      draftKey: JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md']),
      sharedText: text, provider, editable: true, suggestionMode: false,
      comments: [], suggestions: [], onDraftChange: () => {}, onReady: () => {},
      onProposeSourceEdit: () => ({ result: 'applied' as const }),
    }
    try {
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} content={text.toString()} />))
      render.mockClear()
      vi.useFakeTimers()
      input.focus()
      await act(async () => { text.insert(0, 'Updated ') })
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} content={text.toString()} />))
      expect(text.toString()).toBe('Updated A shared paragraph.')
      expect(container.textContent).not.toContain('Updated A shared paragraph.')
      expect(render).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(150) })
      expect(container.textContent).toContain(text.toString())
      expect(render).toHaveBeenCalledOnce()
      await act(async () => { text.insert(text.length, ' Locally updated.') })
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(document))
      peer.getText('content').insert(0, 'Remote ')
      await act(async () => { Y.applyUpdate(document, Y.encodeStateAsUpdate(peer)) })
      expect(container.textContent).toContain(text.toString())
      expect(render).toHaveBeenCalledTimes(2)
      await act(async () => { vi.advanceTimersByTime(150) })
      expect(render).toHaveBeenCalledTimes(2)
      await act(async () => { text.insert(text.length, ' Before Visual interaction.') })
      expect(render).toHaveBeenCalledTimes(2)
      await act(async () => {
        container.querySelector('[contenteditable]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      })
      expect(container.textContent).toContain(text.toString())
      expect(render).toHaveBeenCalledTimes(3)
      await act(async () => { vi.advanceTimersByTime(150) })
      expect(render).toHaveBeenCalledTimes(3)
      const modeButton = window.document.createElement('button')
      input.after(modeButton)
      try {
        await act(async () => { text.insert(text.length, ' Before changing views.') })
        expect(render).toHaveBeenCalledTimes(3)
        await act(async () => { modeButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
        expect(container.textContent).toContain(text.toString())
        expect(render).toHaveBeenCalledTimes(4)
      } finally { modeButton.remove() }
      peer.destroy()
    } finally {
      vi.useRealTimers()
      await act(async () => root.unmount())
      render.mockRestore()
      input.remove()
      document.destroy()
    }
  })

  it('refreshes source and included files on activation without rebuilding while hidden', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'A shared paragraph.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const render = vi.spyOn(visualModel, 'createVisualDocument')
    const configuration = {
      draftKey: JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md']),
      sharedText: text, provider, editable: true, suggestionMode: false,
      comments: [], suggestions: [], onDraftChange: () => {}, onReady: () => {},
      onProposeSourceEdit: () => ({ result: 'applied' as const }),
    }
    try {
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} active={false}
        content={text.toString()} projectFiles={{ 'included.md': 'Original included file.' }} />))
      render.mockClear()
      await act(async () => { text.insert(0, 'Updated ') })
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} active={false}
        content={text.toString()} projectFiles={{ 'included.md': 'Updated included file.' }} />))
      expect(render).not.toHaveBeenCalled()
      expect(container.textContent).not.toContain('Updated A shared paragraph.')
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} active
        content={text.toString()} projectFiles={{ 'included.md': 'Updated included file.' }} />))
      expect(render).toHaveBeenCalledOnce()
      expect(container.textContent).toContain('Updated A shared paragraph.')
      expect(render).toHaveBeenCalledWith(text.toString(), expect.objectContaining({
        projectFiles: { 'included.md': 'Updated included file.' },
      }))
    } finally {
      await act(async () => root.unmount())
      render.mockRestore()
      document.destroy()
    }
  })

  it('does not rebuild the document for unchanged project-file values', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'A shared paragraph.')
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const render = vi.spyOn(visualModel, 'createVisualDocument')
    const configuration = {
      draftKey: JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md']),
      content: text.toString(), sharedText: text, provider, editable: true,
      suggestionMode: false, comments: [], suggestions: [], onDraftChange: () => {},
      onReady: () => {}, onProposeSourceEdit: () => ({ result: 'applied' as const }),
    }
    try {
      await act(async () => root.render(<ContinuousVisualEditor {...configuration}
        projectFiles={{ 'included.md': 'Unchanged content.' }} />))
      render.mockClear()
      await act(async () => root.render(<ContinuousVisualEditor {...configuration}
        projectFiles={{ 'included.md': 'Unchanged content.' }} />))
      expect(render).not.toHaveBeenCalled()
      await act(async () => root.render(<ContinuousVisualEditor {...configuration}
        projectFiles={{ 'included.md': 'Changed content.' }} />))
      expect(render).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      render.mockRestore()
      document.destroy()
    }
  })

  const changeObject = async (container: HTMLElement, source: string) => {
    const input = container.querySelector<HTMLTextAreaElement>('.visual-object-editor textarea')
    expect(input).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, source)
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('keeps a figure mounted while editing and merges a remote caption change', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = 'Before.\n\n:::{figure} /image.png\n:name: fig-original\n\nOriginal caption.\n:::\n\nAfter.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable sharedText={text} provider={provider} suggestionMode={false} comments={[]} suggestions={[]}
        onProposeSourceEdit={() => ({ result: 'applied' })} onDraftChange={() => {}} onReady={() => {}} />))
      const figure = container.querySelector('figure')
      const caption = container.querySelector('figcaption')
      expect(figure).not.toBeNull()
      await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit figure"]')?.click())
      const original = container.querySelector<HTMLTextAreaElement>('[aria-label="MyST object source"]')?.value
      await changeObject(container, original!.replace('fig-original', 'discarded-figure'))
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Cancel object edit"]')?.click())
      expect(container.querySelector('figure')).toBe(figure)
      expect(container.querySelector('figcaption')).toBe(caption)
      expect(text.toString()).toBe(content)
      await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit figure"]')?.click())
      expect(container.querySelector('figure')).toBe(figure)
      expect(container.querySelector('figcaption')).toBe(caption)
      const input = container.querySelector<HTMLTextAreaElement>('[aria-label="MyST object source"]')
      expect(input?.value).toContain(':name: fig-original')
      await changeObject(container, input!.value.replace('fig-original', 'fig-updated'))
      expect(container.querySelector('figure')).toBe(figure)
      expect(text.toString()).toBe(content)
      await act(async () => document.transact(() => {
        const position = text.toString().indexOf('Original caption.')
        text.delete(position, 'Original caption.'.length)
        text.insert(position, 'Remote caption.')
      }, 'remote-caption-editor'))
      expect(container.querySelector('figure')).toBe(figure)
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Apply MyST object"]')?.click())
      expect(text.toString()).toBe(content.replace('fig-original', 'fig-updated').replace('Original caption.', 'Remote caption.'))
      expect(container.querySelector('[aria-label="MyST object source"]')).toBeNull()
      expect(readVisualRecoveryDraft(visualObjectDraftKey(draftKey))).toBeNull()
    } finally {
      await act(async () => root.unmount())
      writeVisualRecoveryDraft(visualObjectDraftKey(draftKey), null)
      document.destroy()
    }
  })

  it('applies an object on click-away and opens the next object without approval', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = 'Before.\n\n$$\nx^2\n$$\n\n$$\ny^2\n$$\n\nAfter.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    window.document.body.append(container)
    const root = createRoot(container)
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable sharedText={text} provider={provider} suggestionMode={false} comments={[]} suggestions={[]}
        onProposeSourceEdit={() => ({ result: 'applied' })} onDraftChange={() => {}} onReady={() => {}} />))
      const equations = container.querySelectorAll<HTMLElement>('.visual-protected-block')
      await act(async () => equations[0].click())
      await changeObject(container, 'x^3')
      await act(async () => {
        equations[1].click()
      })
      expect(text.toString()).toBe(content.replace('x^2', 'x^3'))
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="LaTeX equation"]')?.value).toBe('y^2')
      await act(async () => container.querySelector('p')?.click())
      expect(container.querySelector('[aria-label="LaTeX equation"]')).toBeNull()
      expect(text.toString()).toBe(content.replace('x^2', 'x^3'))
    } finally {
      await act(async () => root.unmount())
      container.remove()
      writeVisualRecoveryDraft(visualObjectDraftKey(draftKey), null)
      document.destroy()
    }
  })

  it('shows only editable source for protected caption content', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = ':::{figure} /image.png\n:name: fig-caption\n\nA long caption with $x^2$ and a [linked result](https://example.org).\n:::'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])} content={content}
        editable sharedText={text} provider={provider} suggestionMode={false} comments={[]} suggestions={[]}
        onProposeSourceEdit={() => ({ result: 'applied' })} onDraftChange={() => {}} onReady={() => {}} />))
      await act(async () => container.querySelector<HTMLElement>('figcaption .visual-protected-block')?.click())
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="MyST object source"]')?.value)
        .toContain('A long caption with $x^2$')
      expect(container.querySelector('.visual-object-preview')).toBeNull()
      expect(text.toString()).toBe(content)
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('never writes generated figure labels back into the shared source', async () => {
    vi.useFakeTimers()
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = '# Draft\n\n:::{figure} /image.png\n:name: fig-demo\n\nCaption text.\n:::\n\nAfter.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContinuousVisualEditor
        draftKey={JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])} content={content}
        editable sharedText={text} provider={provider} suggestionMode={false} comments={[]} suggestions={[]}
        onProposeSourceEdit={() => ({ result: 'applied' })} onDraftChange={() => {}} onReady={() => {}} />))
      const label = container.querySelector('.caption-number')
      expect(label).not.toBeNull()
      await act(async () => {
        label!.textContent = 'Figure 99'
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(label?.textContent).toBe('Figure 99')
      expect(text.toString()).toBe(content)
    } finally {
      await act(async () => root.unmount())
      document.destroy()
      vi.useRealTimers()
    }
  })

  it('recovers an unsubmitted object draft after reload and discards it only on cancel', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = 'Before.\n\n$$\nx^2\n$$\n\nAfter.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    let root = createRoot(container)
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    const onDraftChange = vi.fn()
    const configuration = { draftKey, content, sharedText: text, provider, editable: true,
      suggestionMode: false, comments: [], suggestions: [], onDraftChange,
      onReady: () => {}, onProposeSourceEdit: () => ({ result: 'applied' as const }) }
    try {
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} />))
      await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit equation"]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      await changeObject(container, 'x^3')
      expect(readVisualRecoveryDraft(visualObjectDraftKey(draftKey))?.source).toBe('$$\nx^3\n$$')
      expect(onDraftChange).toHaveBeenLastCalledWith('Before.\n\n$$\nx^3\n$$\n\nAfter.')
      expect(text.toString()).toBe(content)
      await act(async () => root.unmount())
      root = createRoot(container)
      await act(async () => root.render(<ContinuousVisualEditor {...configuration} />))
      expect(container.querySelector<HTMLTextAreaElement>('[aria-label="LaTeX equation"]')?.value).toBe('x^3')
      expect(text.toString()).toBe(content)
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Cancel object edit"]')?.click())
      expect(readVisualRecoveryDraft(visualObjectDraftKey(draftKey))).toBeNull()
      expect(text.toString()).toBe(content)
    } finally {
      await act(async () => root.unmount())
      writeVisualRecoveryDraft(visualObjectDraftKey(draftKey), null)
      document.destroy()
    }
  })

  it.each(['neighboring prose', 'overlapping equation', 'removed object', 'read-only'] as const)(
    'protects an object draft after %s changes', async (scenario) => {
      const document = new Y.Doc()
      const text = document.getText('content')
      const content = 'Before.\n\n$$\nx^2\n$$\n\nAfter.'
      text.insert(0, content)
      const provider = { awareness: new Awareness(document) } as WebsocketProvider
      const container = window.document.createElement('div')
      window.document.body.append(container)
      const root = createRoot(container)
      const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
      const configuration = { draftKey, content, sharedText: text, provider, editable: true,
        suggestionMode: false, comments: [], suggestions: [], onDraftChange: () => {},
        onReady: () => {}, onProposeSourceEdit: () => ({ result: 'applied' as const }) }
      try {
        await act(async () => root.render(<ContinuousVisualEditor {...configuration} />))
        await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit equation"]')
          ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
        await changeObject(container, 'x^3')
        await act(async () => {
          if (scenario === 'read-only') {
            root.render(<ContinuousVisualEditor {...configuration} editable={false} />)
          } else document.transact(() => {
            if (scenario === 'neighboring prose') text.insert(0, 'Remote opening.\n\n')
            else if (scenario === 'overlapping equation') {
              const position = text.toString().indexOf('x^2')
              text.delete(position, 3)
              text.insert(position, 'z^4')
            } else text.delete(text.toString().indexOf('$$'), '$$\nx^2\n$$\n\n'.length)
          }, 'remote-editor')
        })
        const shared = text.toString()
        const input = container.querySelector<HTMLTextAreaElement>('[aria-label="LaTeX equation"]')
        expect(input?.value).toBe('x^3')
        const apply = container.querySelector<HTMLButtonElement>('[title="Apply equation"]')
        if (scenario === 'read-only' || scenario === 'removed object') expect(apply?.disabled).toBe(true)
        await act(async () => container.querySelector('p')?.click())
        if (scenario === 'neighboring prose') {
          expect(text.toString()).toBe('Remote opening.\n\nBefore.\n\n$$\nx^3\n$$\n\nAfter.')
          expect(readVisualRecoveryDraft(visualObjectDraftKey(draftKey))).toBeNull()
        } else {
          expect(text.toString()).toBe(shared)
          expect(readVisualRecoveryDraft(visualObjectDraftKey(draftKey))?.source).toBe('$$\nx^3\n$$')
          if (scenario === 'overlapping equation') expect(container.querySelector('[role="alert"]')?.textContent).toContain('retained')
        }
      } finally {
        await act(async () => root.unmount())
        container.remove()
        writeVisualRecoveryDraft(visualObjectDraftKey(draftKey), null)
        document.destroy()
      }
    },
  )

  it('edits an equation in place without changing surrounding prose', async () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = 'Before.\n\n$$\nx^2\n$$\n\nAfter.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable sharedText={text} provider={provider} suggestionMode={false} comments={[]} suggestions={[]}
        onProposeSourceEdit={() => ({ result: 'applied' })} onDraftChange={() => {}} onReady={() => {}} />))
      await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit equation"]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      const input = container.querySelector<HTMLTextAreaElement>('[aria-label="LaTeX equation"]')
      expect(input?.value).toBe('x^2')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'x^3 + y')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(text.toString()).toBe(content)
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Apply equation"]')?.click())
      expect(text.toString()).toBe('Before.\n\n$$\nx^3 + y\n$$\n\nAfter.')
      expect(container.querySelector('[aria-label="LaTeX equation"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      document.destroy()
    }
  })

  it('submits object edits as suggestions without mutating accepted text', async () => {
    vi.useFakeTimers()
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = 'Before.\n\n$$\nx^2\n$$\n\nAfter.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    const propose = vi.fn(() => ({ result: 'applied' as const }))
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable sharedText={text} provider={provider} suggestionMode comments={[]} suggestions={[]}
        onProposeSourceEdit={propose} onDraftChange={() => {}} onReady={() => {}} />))
      await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit equation"]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      await changeObject(container, 'x^3')
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Apply equation"]')?.click())
      expect(text.toString()).toBe(content)
      expect(propose).not.toHaveBeenCalled()
      expect(readVisualRecoveryDraft(draftKey)?.source).toBe('Before.\n\n$$\nx^3\n$$\n\nAfter.')
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(propose).toHaveBeenCalledWith('Before.\n\n$$\nx^3\n$$\n\nAfter.')
      expect(text.toString()).toBe(content)
      expect(readVisualRecoveryDraft(draftKey)).toBeNull()
      expect(readVisualRecoveryDraft(visualObjectDraftKey(draftKey))).toBeNull()
    } finally {
      await act(async () => root.unmount())
      writeVisualRecoveryDraft(draftKey, null)
      writeVisualRecoveryDraft(visualObjectDraftKey(draftKey), null)
      document.destroy()
      vi.useRealTimers()
    }
  })

  it('restores a failed suggestion draft and removes its backup only after submission succeeds', async () => {
    vi.useFakeTimers()
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = '# Draft\n\nOriginal paragraph.'
    const draft = '# Draft\n\nUnsubmitted paragraph.'
    text.insert(0, content)
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    writeVisualRecoveryDraft(draftKey, { base: content, source: draft, suggestionMode: true })
    const container = window.document.createElement('div')
    let root = createRoot(container)
    const propose = vi.fn(() => ({ result: 'conflict' as const }))
    const onDraftChange = vi.fn()
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable sharedText={text} provider={provider} suggestionMode comments={[]} suggestions={[]}
        onProposeSourceEdit={propose} onDraftChange={onDraftChange} onReady={() => {}} />))
      expect(container.querySelector('.continuous-visual-document')?.textContent).toContain('Unsubmitted paragraph.')
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(propose).toHaveBeenCalledWith(draft)
      expect(readVisualRecoveryDraft(draftKey)?.source).toBe(draft)
      expect(text.toString()).toBe(content)
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('retained')
      await act(async () => root.unmount())
      root = createRoot(container)
      const succeed = vi.fn(() => ({ result: 'applied' as const }))
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable sharedText={text} provider={provider} suggestionMode comments={[]} suggestions={[]}
        onProposeSourceEdit={succeed} onDraftChange={onDraftChange} onReady={() => {}} />))
      expect(container.querySelector('.continuous-visual-document')?.textContent).toContain('Unsubmitted paragraph.')
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(succeed).toHaveBeenCalledWith(draft)
      expect(readVisualRecoveryDraft(draftKey)).toBeNull()
      expect(text.toString()).toBe(content)
    } finally {
      await act(async () => root.unmount())
      writeVisualRecoveryDraft(draftKey, null)
      document.destroy()
      vi.useRealTimers()
    }
  })

  it('retains but does not submit or edit a pending draft after access becomes read-only', async () => {
    vi.useFakeTimers()
    const document = new Y.Doc()
    const text = document.getText('content')
    const content = 'Original paragraph.'
    const draftKey = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
    text.insert(0, content)
    writeVisualRecoveryDraft(draftKey, { base: content, source: 'Private draft.', suggestionMode: true })
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const propose = vi.fn(() => ({ result: 'applied' as const }))
    let handle: ContinuousVisualEditorHandle | null = null
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={draftKey} content={content}
        editable={false} sharedText={text} provider={provider} suggestionMode comments={[]} suggestions={[]}
        onProposeSourceEdit={propose} onDraftChange={() => {}} onReady={(value) => { handle = value }} />))
      expect(container.querySelector('.continuous-visual-document')?.getAttribute('contenteditable')).toBe('false')
      await act(async () => {
        ;(handle as ContinuousVisualEditorHandle | null)?.insertText('Not allowed')
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(propose).not.toHaveBeenCalled()
      expect(text.toString()).toBe(content)
      expect(readVisualRecoveryDraft(draftKey)?.source).toBe('Private draft.')
    } finally {
      await act(async () => root.unmount())
      writeVisualRecoveryDraft(draftKey, null)
      document.destroy()
      vi.useRealTimers()
    }
  })

  it('never sends a previous file draft through the next file submission callback', async () => {
    vi.useFakeTimers()
    const document = new Y.Doc()
    const firstText = document.getText('content')
    const secondText = document.getText('secondary')
    firstText.insert(0, 'First file.')
    secondText.insert(0, 'Second file.')
    const room = crypto.randomUUID()
    const firstKey = JSON.stringify([room, 'actor', 'first.md'])
    const secondKey = JSON.stringify([room, 'actor', 'second.md'])
    writeVisualRecoveryDraft(firstKey, { base: 'First file.', source: 'Pending first file.', suggestionMode: true })
    const provider = { awareness: new Awareness(document) } as WebsocketProvider
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const firstSubmit = vi.fn(() => ({ result: 'conflict' as const }))
    const secondSubmit = vi.fn(() => ({ result: 'applied' as const }))
    try {
      await act(async () => root.render(<ContinuousVisualEditor draftKey={firstKey} content="First file."
        editable sharedText={firstText} provider={provider} suggestionMode comments={[]} suggestions={[]}
        onProposeSourceEdit={firstSubmit} onDraftChange={() => {}} onReady={() => {}} />))
      await act(async () => root.render(<ContinuousVisualEditor draftKey={secondKey} content="Second file."
        editable sharedText={secondText} provider={provider} suggestionMode comments={[]} suggestions={[]}
        onProposeSourceEdit={secondSubmit} onDraftChange={() => {}} onReady={() => {}} />))
      expect(firstSubmit).toHaveBeenCalledWith('Pending first file.')
      expect(secondSubmit).not.toHaveBeenCalled()
      expect(readVisualRecoveryDraft(firstKey)?.source).toBe('Pending first file.')
      expect(container.querySelector('.continuous-visual-document')?.textContent).toBe('Second file.')
    } finally {
      await act(async () => root.unmount())
      writeVisualRecoveryDraft(firstKey, null)
      writeVisualRecoveryDraft(secondKey, null)
      document.destroy()
      vi.useRealTimers()
    }
  })
})