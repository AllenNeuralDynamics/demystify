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