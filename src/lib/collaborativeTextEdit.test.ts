import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  applyCollaborativeTextEdit,
  createCollaborativeTextEditAnchor,
  getTextReplacement,
  rebaseTextDraft,
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
    expect(createCollaborativeTextEditAnchor(text, 1, 0, '')).toBeNull()
  })

  it('applies an insertion anchored between existing characters', () => {
    const { document, text } = createDocument('Before after')
    const anchor = createCollaborativeTextEditAnchor(text, 7, 7, '')

    expect(anchor).not.toBeNull()
    expect(applyCollaborativeTextEdit(document, text, anchor!, 'and ')).toBe('applied')
    expect(text.toString()).toBe('Before and after')
  })

  it('extracts the minimal replacement from a source draft', () => {
    expect(getTextReplacement(
      'First paragraph.\n\nSecond paragraph.',
      'First revised paragraph.\n\nSecond paragraph.',
    )).toEqual({
      from: 6,
      to: 6,
      before: '',
      after: 'revised ',
    })
    expect(getTextReplacement('ABC', 'AC')).toEqual({
      from: 1,
      to: 2,
      before: 'B',
      after: '',
    })
    expect(getTextReplacement('Same', 'Same')).toBeNull()
  })

  it('rebases a local draft over a non-overlapping canonical edit', () => {
    const base = 'First paragraph.\n\nSecond paragraph.'
    const draft = 'First revised paragraph.\n\nSecond paragraph.'
    const canonical = 'Preface.\n\nFirst paragraph.\n\nSecond paragraph.'

    expect(rebaseTextDraft(base, draft, canonical)).toBe(
      'Preface.\n\nFirst revised paragraph.\n\nSecond paragraph.',
    )
  })

  it('rejects a local draft that overlaps a canonical edit', () => {
    expect(rebaseTextDraft(
      'Original claim.',
      'Local claim.',
      'Remote claim.',
    )).toBeNull()
  })
})