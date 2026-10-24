import * as decoding from 'lib0/decoding'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { encodeDurabilityMessage } from '../src/lib/collaborationDurability.js'
import { createDurabilityHandler } from './collaboration-durability.js'

const makeSocket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() })
const receipt = (bytes: Uint8Array) => {
  const decoder = decoding.createDecoder(bytes)
  return [decoding.readVarUint(decoder), decoding.readVarUint(decoder), decoding.readVarUint(decoder)]
}

describe('durable save receipts', () => {
  it('does not confirm a save until the persistence barrier completes', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const socket = makeSocket()
    const handler = createDurabilityHandler(socket as unknown as WebSocket, () => pending)
    expect(handler(Buffer.from(encodeDurabilityMessage(7)))).toBe(true)
    expect(socket.send).not.toHaveBeenCalled()
    finish()
    await pending
    expect(receipt(socket.send.mock.calls[0][0])).toEqual([4, 7, 1])
  })

  it('reports database failure without a success receipt and accepts a retry', async () => {
    const socket = makeSocket()
    const flush = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined)
    const handler = createDurabilityHandler(socket as unknown as WebSocket, flush)
    handler(Buffer.from(encodeDurabilityMessage(1)))
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1))
    expect(receipt(socket.send.mock.calls[0][0])).toEqual([4, 1, 0])
    handler(Buffer.from(encodeDurabilityMessage(2)))
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2))
    expect(receipt(socket.send.mock.calls[1][0])).toEqual([4, 2, 1])
  })

  it('runs a new barrier for requests arriving while a previous save is pending', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const socket = makeSocket()
    const flush = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined)
    const handler = createDurabilityHandler(socket as unknown as WebSocket, flush)
    handler(Buffer.from(encodeDurabilityMessage(1)))
    handler(Buffer.from(encodeDurabilityMessage(2)))
    handler(Buffer.from(encodeDurabilityMessage(3)))
    expect(flush).toHaveBeenCalledOnce()
    finish()
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2))
    expect(flush).toHaveBeenCalledTimes(2)
    expect(socket.send.mock.calls.map(([bytes]) => receipt(bytes))).toEqual([[4, 1, 1], [4, 3, 1]])
  })

  it('leaves standard Yjs frames to the existing authorization path', () => {
    const socket = makeSocket()
    const flush = vi.fn()
    const handler = createDurabilityHandler(socket as unknown as WebSocket, flush)
    expect(handler(Buffer.from([0, 2, 0]))).toBe(false)
    expect(flush).not.toHaveBeenCalled()
    handler(Buffer.from([4, 1, 0]))
    expect(socket.close).toHaveBeenCalledWith(1008, 'Invalid save receipt request')
  })
})