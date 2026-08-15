// @vitest-environment jsdom
import { Awareness } from 'y-protocols/awareness'
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  CollaborativeEditor,
  type CollaborativeEditorHandle,
} from './CollaborativeEditor'

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

  it('auto-saves a Source edit as a suggestion without mutating shared text', async () => {
    vi.useFakeTimers()
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
    const currentProposal = '# Draft\n\nCurrent proposed claim.'
    const yDocument = new Y.Doc()
    const acceptedText = yDocument.getText('content')
    acceptedText.insert(0, source)
    const sharedText = yDocument.getText('workingContent')
    sharedText.insert(0, currentProposal)
    const awareness = new Awareness(yDocument)
    const provider = { awareness } as unknown as WebsocketProvider
    const editorRef = createRef<CollaborativeEditorHandle>()
    const onProposeSourceEdit = vi.fn(() => ({
      result: 'applied' as const,
      suggestionId: 'source-suggestion',
    }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CollaborativeEditor
          ref={editorRef}
          sharedText={sharedText}
          provider={provider}
          suggestionMode
          suggestionBaseContent={currentProposal}
          onProposeSourceEdit={onProposeSourceEdit}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('.cm-content')
    expect(editor?.textContent).toContain('Current proposed claim.')
    expect(editor?.textContent).not.toContain('Original claim.')
    await act(async () => editorRef.current?.insertText('Live '))
    expect(sharedText.toString()).toBe(currentProposal)
    expect(acceptedText.toString()).toBe(source)
    expect(container.textContent).toContain('Saving suggestion...')
    await act(async () => vi.advanceTimersByTime(450))
    expect(onProposeSourceEdit).toHaveBeenCalledWith(`Live ${currentProposal}`)
    expect(sharedText.toString()).toBe(currentProposal)
    expect(container.textContent).toContain('Suggesting')

    const sharedFollowUp = `${currentProposal}\nRemote follow-up claim.`
    await act(async () => {
      root.render(
        <CollaborativeEditor
          ref={editorRef}
          sharedText={sharedText}
          provider={provider}
          suggestionMode
          suggestionBaseContent={sharedFollowUp}
          onProposeSourceEdit={onProposeSourceEdit}
        />,
      )
    })
    expect(container.querySelector<HTMLElement>('.cm-content')?.textContent)
      .toContain('Remote follow-up claim.')
    expect(acceptedText.toString()).toBe(source)

    await act(async () => root.unmount())
    awareness.destroy()
    yDocument.destroy()
    container.remove()
    vi.useRealTimers()
  })

  it('renders a live replacement inline without duplicating working text', async () => {
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
    const working = 'alpha INSERT omega'
    const yDocument = new Y.Doc()
    const sharedText = yDocument.getText('workingContent')
    sharedText.insert(0, working)
    const awareness = new Awareness(yDocument)
    const provider = { awareness } as unknown as WebsocketProvider
    const onCommentClick = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CollaborativeEditor
          sharedText={sharedText}
          provider={provider}
          onCommentClick={onCommentClick}
          suggestionHighlights={[{
            id: 'live-inline-6-11',
            from: 6,
            to: 12,
            before: 'gamma',
            after: 'INSERT',
            authorName: 'Ada Reviewer',
            authorColor: '#a64b36',
            active: true,
            projection: 'working',
          }]}
        />,
      )
    })

    expect(container.querySelector('.cm-suggestion-deleted-source')?.textContent)
      .toBe('gamma')
    expect(container.querySelector('.cm-suggestion-insertion')?.textContent)
      .toBe('INSERT')
    expect(container.textContent?.match(/INSERT/g)).toHaveLength(1)
    expect(sharedText.toString()).toBe(working)

    await act(async () => {
      container.querySelector<HTMLElement>('.cm-suggestion-insertion')?.click()
    })
    expect(onCommentClick).toHaveBeenCalledWith('live-inline-6-11')

    await act(async () => {
      container.querySelector<HTMLElement>('.cm-suggestion-insertion')
        ?.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Enter',
        }))
    })
    expect(onCommentClick).toHaveBeenCalledTimes(2)

    await act(async () => {
      container.querySelector<HTMLElement>('.cm-suggestion-deletion-widget')
        ?.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: ' ',
        }))
    })
    expect(onCommentClick).toHaveBeenCalledTimes(3)

    await act(async () => root.unmount())
    awareness.destroy()
    yDocument.destroy()
    container.remove()
  })
})