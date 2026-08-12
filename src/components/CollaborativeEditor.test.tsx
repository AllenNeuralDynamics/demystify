// @vitest-environment jsdom
import { Awareness } from 'y-protocols/awareness'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { CollaborativeEditor } from './CollaborativeEditor'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

describe('CollaborativeEditor', () => {
  it('shows an attributed proposal without changing canonical source', async () => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const source = '# Draft\n\nOriginal claim.'
    const yDocument = new Y.Doc()
    const sharedText = yDocument.getText('content')
    sharedText.insert(0, source)
    const awareness = new Awareness(yDocument)
    const provider = { awareness } as unknown as WebsocketProvider
    const onCommentClick = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const from = source.indexOf('Original')

    await act(async () => {
      root.render(
        <CollaborativeEditor
          sharedText={sharedText}
          provider={provider}
          onCommentClick={onCommentClick}
          suggestionHighlights={[{
            id: 'suggestion-1',
            from,
            to: source.length,
            after: 'Revised **claim**.',
            authorName: 'Ada Reviewer',
            authorColor: '#a64b36',
            active: false,
          }]}
        />,
      )
    })

    const deletion = container.querySelector<HTMLElement>('.cm-suggestion-deletion')
    const proposal = container.querySelector<HTMLElement>('.cm-suggestion-proposal')
    expect(sharedText.toString()).toBe(source)
    expect(deletion?.textContent).toBe('Original claim.')
    expect(proposal?.querySelector('.cm-suggestion-source')?.textContent)
      .toBe('Revised **claim**.')
    expect(proposal?.querySelector('.cm-suggestion-author')?.textContent)
      .toBe('Ada Reviewer')
    expect(proposal?.getAttribute('aria-label')).toContain('Ada Reviewer')

    await act(async () => proposal?.click())
    expect(onCommentClick).toHaveBeenCalledWith('suggestion-1')
    const currentProposal = container.querySelector<HTMLElement>('.cm-suggestion-proposal')
    await act(async () => {
      currentProposal?.focus()
      currentProposal?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }))
    })
    expect(onCommentClick).toHaveBeenCalledTimes(2)
    expect(sharedText.toString()).toBe(source)

    await act(async () => root.unmount())
    awareness.destroy()
    yDocument.destroy()
    container.remove()
  })

  it('submits a local source draft without mutating canonical Y.Text', async () => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const source = '# Draft\n\nOriginal claim.'
    const yDocument = new Y.Doc()
    const sharedText = yDocument.getText('content')
    sharedText.insert(0, source)
    const awareness = new Awareness(yDocument)
    const provider = { awareness } as unknown as WebsocketProvider
    const onProposeSourceEdit = vi.fn(() => ({
      result: 'applied' as const,
      suggestionId: 'source-suggestion',
    }))
    const onSourceDraftChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CollaborativeEditor
          sharedText={sharedText}
          provider={provider}
          suggestionMode
          onProposeSourceEdit={onProposeSourceEdit}
          onSourceDraftChange={onSourceDraftChange}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('.cm-content')
    await act(async () => {
      if (!editor) return
      editor.textContent = '# Draft\n\nRevised claim.'
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    })
    expect(sharedText.toString()).toBe(source)
    expect(container.textContent).toContain('Drafting a source proposal')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.source-suggestion-draft-actions .primary')
        ?.click()
    })
    expect(onProposeSourceEdit).toHaveBeenCalled()
    expect(sharedText.toString()).toBe(source)

    await act(async () => root.unmount())
    awareness.destroy()
    yDocument.destroy()
    container.remove()
  })
})