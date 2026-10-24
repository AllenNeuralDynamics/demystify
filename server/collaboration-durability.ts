import * as decoding from 'lib0/decoding'
import type { RawData, WebSocket } from 'ws'
import { durabilityMessageType, encodeDurabilityMessage } from '../src/lib/collaborationDurability.js'

export const createDurabilityHandler = (socket: WebSocket, flush: () => Promise<void>) => {
  let queuedRequest: number | null = null
  let running = false

  const respond = async () => {
    running = true
    try {
      while (queuedRequest !== null && socket.readyState === 1) {
        const request = queuedRequest
        queuedRequest = null
        let stored = false
        try {
          await flush()
          stored = true
        } catch {
          stored = false
        }
        if (socket.readyState === 1) {
          socket.send(encodeDurabilityMessage(request, stored), (error) => {
            if (error) socket.close(1011, 'Save receipt delivery failed')
          })
        }
      }
    } finally {
      running = false
    }
  }

  return (data: RawData): boolean => {
    const bytes = Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data)
    const decoder = decoding.createDecoder(bytes)
    try {
      if (decoding.readVarUint(decoder) !== durabilityMessageType) return false
      const request = decoding.readVarUint(decoder)
      if (bytes.length > 16 || !Number.isSafeInteger(request) || decoding.hasContent(decoder)) {
        socket.close(1008, 'Invalid save receipt request')
        return true
      }
      queuedRequest = request
      if (!running) {
        void respond().catch(() => socket.close(1011, 'Save receipt unavailable'))
      }
      return true
    } catch {
      return false
    }
  }
}