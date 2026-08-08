import * as encoding from 'lib0/encoding'
import { describe, expect, it } from 'vitest'
import { isReadOnlyWebSocketMessageAllowed } from './read-only-websocket.js'

const message = (type: number, subtype?: number) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  if (subtype !== undefined) encoding.writeVarUint(encoder, subtype)
  return Buffer.from(encoding.toUint8Array(encoder))
}

describe('read-only Yjs messages', () => {
  it('allows presence and sync requests needed to load the room', () => {
    expect(isReadOnlyWebSocketMessageAllowed(message(1))).toBe(true)
    expect(isReadOnlyWebSocketMessageAllowed(message(0, 0))).toBe(true)
  })

  it('blocks sync responses, document updates, and unknown messages', () => {
    expect(isReadOnlyWebSocketMessageAllowed(message(0, 1))).toBe(false)
    expect(isReadOnlyWebSocketMessageAllowed(message(0, 2))).toBe(false)
    expect(isReadOnlyWebSocketMessageAllowed(message(9))).toBe(false)
  })
})