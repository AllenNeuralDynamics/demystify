import * as decoding from 'lib0/decoding'
import type { RawData, WebSocket } from 'ws'

const messageSync = 0
const messageAwareness = 1
const syncStep1 = 0

const toUint8Array = (data: RawData) => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  const buffer = Array.isArray(data) ? Buffer.concat(data) : data
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export const isReadOnlyWebSocketMessageAllowed = (data: RawData) => {
  try {
    const decoder = decoding.createDecoder(toUint8Array(data))
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageAwareness) return true
    return messageType === messageSync && decoding.readVarUint(decoder) === syncStep1
  } catch {
    return false
  }
}

export const setupReadOnlyAwareWebSocket = (
  socket: WebSocket,
  isReadOnly: () => boolean,
  setup: (socket: WebSocket) => void,
) => {
  const originalOn = socket.on
  socket.on = function guardedOn(
    this: WebSocket,
    event: string,
    listener: (...args: unknown[]) => void,
  ) {
    if (event !== 'message') {
      return originalOn.call(this, event, listener)
    }
    return originalOn.call(
      this,
      event,
      (data: RawData, ...args: unknown[]) => {
        if (!isReadOnly() || isReadOnlyWebSocketMessageAllowed(data)) {
          listener.call(this, data, ...args)
        }
      },
    )
  } as typeof socket.on
  try {
    setup(socket)
  } finally {
    socket.on = originalOn
  }
}