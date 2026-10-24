import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NodeWebSocket from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  durabilityMessageType,
  durabilityReceiptTimeoutMs,
  encodeDurabilityMessage,
  trackServerDurability,
} from './collaborationDurability'

const openClient = () => {
  const document = new Y.Doc()
  const provider = new WebsocketProvider('ws://127.0.0.1:1', 'receipt-test', document, {
    connect: false,
    disableBc: true,
    WebSocketPolyfill: NodeWebSocket as unknown as typeof WebSocket,
  })
  const send = vi.fn()
  provider.ws = { readyState: 1, send, close: vi.fn() } as unknown as WebSocket
  provider.wsconnected = true
  provider.wsLastMessageReceived = Date.now()
  const changed = vi.fn()
  const stop = trackServerDurability(provider, changed)
  const receive = (id: number, stored: boolean) => {
    const decoder = decoding.createDecoder(encodeDurabilityMessage(id, stored))
    decoding.readVarUint(decoder)
    provider.messageHandlers[durabilityMessageType](encoding.createEncoder(), decoder, provider, true, durabilityMessageType)
  }
  const requestId = (index = send.mock.calls.length - 1) => {
    const decoder = decoding.createDecoder(send.mock.calls[index][0])
    decoding.readVarUint(decoder)
    return decoding.readVarUint(decoder)
  }
  const destroy = () => {
    stop()
    provider.destroy()
    document.destroy()
  }
  return { document, provider, send, changed, receive, requestId, destroy }
}

describe('server durability tracking', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never treats a sync handshake alone as a durable save', async () => {
    const client = openClient()
    try {
      client.provider.synced = true
      await vi.advanceTimersByTimeAsync(300)
      expect(client.send).toHaveBeenCalledOnce()
      expect(client.changed).not.toHaveBeenCalledWith('saved', expect.anything())
      client.receive(client.requestId(), true)
      expect(client.changed).toHaveBeenLastCalledWith('saved', false)
    } finally {
      client.destroy()
    }
  })

  it('does not acknowledge changes newer than the receipt, including deletions', async () => {
    const client = openClient()
    try {
      client.document.getText('content').insert(0, 'Delete this')
      client.provider.synced = true
      await vi.advanceTimersByTimeAsync(300)
      const first = client.requestId()
      client.document.getText('content').delete(0, 6)
      client.receive(first, true)
      expect(client.changed).toHaveBeenLastCalledWith('unconfirmed', true)
      await vi.advanceTimersByTimeAsync(300)
      client.receive(client.requestId(), true)
      expect(client.changed).toHaveBeenLastCalledWith('saved', false)
    } finally {
      client.destroy()
    }
  })

  it('keeps a failed or lost receipt unconfirmed and retries without another edit', async () => {
    const client = openClient()
    try {
      client.provider.synced = true
      await vi.advanceTimersByTimeAsync(300)
      client.receive(client.requestId(), false)
      expect(client.changed).toHaveBeenLastCalledWith('error', true)
      await vi.advanceTimersByTimeAsync(2_000)
      const lostRequest = client.requestId()
      await vi.advanceTimersByTimeAsync(durabilityReceiptTimeoutMs)
      expect(client.changed).toHaveBeenLastCalledWith('error', true)
      await vi.advanceTimersByTimeAsync(2_000)
      client.receive(lostRequest, true)
      expect(client.changed).toHaveBeenLastCalledWith('error', true)
      client.receive(client.requestId(), true)
      expect(client.changed).toHaveBeenLastCalledWith('saved', false)
    } finally {
      client.destroy()
    }
  })

  it('ignores a receipt from a prior connection and stops sending while offline', async () => {
    const client = openClient()
    try {
      client.provider.synced = true
      await vi.advanceTimersByTimeAsync(300)
      const oldRequest = client.requestId()
      client.provider.wsconnected = false
      client.provider.synced = false
      client.provider.emit('status', [{ status: 'disconnected' }])
      client.document.getMap('comments').set('offline', { body: 'Unconfirmed comment' })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(client.send).toHaveBeenCalledOnce()
      client.provider.wsconnected = true
      client.provider.synced = true
      await vi.advanceTimersByTimeAsync(300)
      client.receive(oldRequest, true)
      expect(client.changed).toHaveBeenLastCalledWith('unconfirmed', true)
      client.receive(client.requestId(), true)
      expect(client.changed).toHaveBeenLastCalledWith('saved', false)
    } finally {
      client.destroy()
    }
  })
})