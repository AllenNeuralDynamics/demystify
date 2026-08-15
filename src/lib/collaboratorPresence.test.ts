import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { resolveCollaboratorCursor } from './collaboratorPresence'

const createCursor = (text: Y.Text, anchor: number, head: number) => ({
  anchor: Y.createRelativePositionFromTypeIndex(text, anchor),
  head: Y.createRelativePositionFromTypeIndex(text, head),
})

describe('resolveCollaboratorCursor', () => {
  it('resolves and orders a cursor on the active shared text', () => {
    const document = new Y.Doc()
    const text = document.getText('content')
    text.insert(0, 'Collaborative text')

    expect(resolveCollaboratorCursor(
      document,
      createCursor(text, 13, 2),
      text,
    )).toEqual({ from: 2, to: 13 })
  })

  it('maps a cursor from an identical accepted or working mirror', () => {
    const document = new Y.Doc()
    const accepted = document.getText('content')
    const working = document.getText('workingContent')
    accepted.insert(0, 'Shared draft')
    working.insert(0, 'Shared draft')

    expect(resolveCollaboratorCursor(
      document,
      createCursor(working, 7, 7),
      accepted,
      [working],
    )).toEqual({ from: 7, to: 7 })
  })

  it('does not map cursors from divergent or unrelated text', () => {
    const document = new Y.Doc()
    const accepted = document.getText('content')
    const working = document.getText('workingContent')
    accepted.insert(0, 'Accepted')
    working.insert(0, 'Working')

    expect(resolveCollaboratorCursor(
      document,
      createCursor(working, 2, 2),
      accepted,
      [working],
    )).toBeNull()
    expect(resolveCollaboratorCursor(document, null, accepted)).toBeNull()
  })
})
