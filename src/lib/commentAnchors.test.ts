import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  createCommentAnchor,
  getCommentRange,
  resolveCommentAnchor,
} from './commentAnchors'

describe('comment anchors', () => {
  it('expands a cursor to its surrounding Markdown paragraph', () => {
    const source = '# Heading\n\nFirst paragraph.\n\nSecond paragraph.'
    const cursor = source.indexOf('paragraph.')

    expect(getCommentRange(source, cursor, cursor)).toEqual({
      from: source.indexOf('First'),
      to: source.indexOf('First') + 'First paragraph.'.length,
      quote: 'First paragraph.',
    })
  })

  it('keeps the anchored paragraph attached when text is inserted before it', () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, '# Heading\n\nTarget paragraph.\n')
    const from = text.toString().indexOf('Target')
    const to = from + 'Target paragraph.'.length
    const anchor = createCommentAnchor(text, from, to)

    text.insert(0, 'Preface\n\n')

    expect(resolveCommentAnchor(document, text, anchor)).toMatchObject({
      quote: 'Target paragraph.',
      startLine: 5,
      endLine: 5,
      orphaned: false,
    })
  })

  it('marks an anchor orphaned when its selected text is deleted', () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Target paragraph.')
    const anchor = createCommentAnchor(text, 0, text.length)

    text.delete(0, text.length)

    expect(resolveCommentAnchor(document, text, anchor)).toMatchObject({
      quote: '',
      orphaned: true,
    })
  })

  it('reattaches when the exact deleted paragraph uniquely reappears', () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Target paragraph.')
    const anchor = createCommentAnchor(text, 0, text.length)

    text.delete(0, text.length)
    text.insert(0, 'Preface\n\nTarget paragraph.')

    expect(resolveCommentAnchor(document, text, anchor)).toMatchObject({
      quote: 'Target paragraph.',
      startLine: 3,
      endLine: 3,
      orphaned: false,
    })
  })
})