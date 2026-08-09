import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  applyCollaborativeTextEdit,
  createCollaborativeTextEditAnchor,
} from './collaborativeTextEdit'

const createDocument = (source: string) => {
  const document = new Y.Doc()
  const text = document.getText('content')
  text.insert(0, source)
  return { document, text }
}

describe('collaborative text edits', () => {
  it('tracks an editable range when text changes before and after it', () => {
    const { document, text } = createDocument('Before\nEditable\nAfter')
    const from = text.toString().indexOf('Editable')
    const anchor = createCollaborativeTextEditAnchor(
      text,
      from,
      from + 'Editable'.length,
      'Editable',
    )

    expect(anchor).not.toBeNull()
    text.insert(0, 'New\n')
    text.insert(text.toString().indexOf('\nAfter'), ' nearby')

    expect(applyCollaborativeTextEdit(document, text, anchor!, 'Revised')).toBe('applied')
    expect(text.toString()).toBe('New\nBefore\nRevised nearby\nAfter')
  })

  it('rejects an edit when the anchored text changed', () => {
    const { document, text } = createDocument('Before\nEditable\nAfter')
    const from = text.toString().indexOf('Editable')
    const anchor = createCollaborativeTextEditAnchor(
      text,
      from,
      from + 'Editable'.length,
      'Editable',
    )
    text.insert(from + 4, ' remotely')

    expect(applyCollaborativeTextEdit(document, text, anchor!, 'Revised')).toBe('conflict')
    expect(text.toString()).toContain('Edit remotelyable')
  })

  it('does not create anchors for stale or invalid source ranges', () => {
    const { text } = createDocument('Editable')

    expect(createCollaborativeTextEditAnchor(text, 0, 8, 'Outdated')).toBeNull()
    expect(createCollaborativeTextEditAnchor(text, -1, 8, 'Editable')).toBeNull()
    expect(createCollaborativeTextEditAnchor(text, 0, 0, '')).toBeNull()
  })
})