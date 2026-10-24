import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { WebsocketProvider } from 'y-websocket'

export const durabilityMessageType = 4
export const durabilityReceiptTimeoutMs = 10_000
export type ServerSaveStatus = 'unconfirmed' | 'saved' | 'error'

export const encodeDurabilityMessage = (requestId: number, stored?: boolean) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, durabilityMessageType)
  encoding.writeVarUint(encoder, requestId)
  if (stored !== undefined) encoding.writeVarUint(encoder, stored ? 1 : 0)
  return encoding.toUint8Array(encoder)
}

export const trackServerDurability = (
  provider: WebsocketProvider,
  onChange: (status: ServerSaveStatus, hasUnconfirmedChanges: boolean) => void,
) => {
  let version = 0
  let confirmedVersion = -1
  let requestSequence = 0
  let inFlight: { id: number; version: number; socket: WebSocket } | null = null
  let requestTimer: ReturnType<typeof setTimeout> | undefined
  let receiptTimer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  const previousHandler = provider.messageHandlers[durabilityMessageType]
  const report = (status: ServerSaveStatus) => onChange(status, confirmedVersion !== version)

  const schedule = (delay = 250) => {
    clearTimeout(requestTimer)
    if (destroyed || !provider.wsconnected || !provider.synced) return
    requestTimer = setTimeout(() => {
      const socket = provider.ws
      if (destroyed || inFlight || !provider.wsconnected || !provider.synced ||
        !socket || socket.readyState !== 1 || confirmedVersion === version) return
      const request = { id: ++requestSequence, version, socket }
      inFlight = request
      receiptTimer = setTimeout(() => {
        if (inFlight !== request) return
        inFlight = null
        report('error')
        schedule(2_000)
      }, durabilityReceiptTimeoutMs)
      try {
        socket.send(encodeDurabilityMessage(request.id))
      } catch {
        clearTimeout(receiptTimer)
        inFlight = null
        report('error')
        schedule(2_000)
      }
    }, delay)
  }

  provider.messageHandlers[durabilityMessageType] = (_encoder, decoder, _provider, fromServer) => {
    if (!fromServer || destroyed) return
    try {
      const requestId = decoding.readVarUint(decoder)
      const stored = decoding.readVarUint(decoder)
      if (!inFlight || requestId !== inFlight.id || inFlight.socket !== provider.ws ||
        !provider.wsconnected || stored > 1 || decoding.hasContent(decoder)) return
      clearTimeout(receiptTimer)
      const request = inFlight
      inFlight = null
      if (stored === 1) {
        confirmedVersion = request.version
        report(confirmedVersion === version ? 'saved' : 'unconfirmed')
        if (confirmedVersion !== version) schedule()
      } else {
        report('error')
        schedule(2_000)
      }
    } catch {
      report('error')
    }
  }

  const changed = () => {
    version += 1
    report('unconfirmed')
    schedule()
  }
  const disconnected = ({ status }: { status: string }) => {
    if (status === 'connected') return
    clearTimeout(requestTimer)
    clearTimeout(receiptTimer)
    inFlight = null
    report('unconfirmed')
  }
  const synchronized = (synced: boolean) => {
    clearTimeout(requestTimer)
    clearTimeout(receiptTimer)
    inFlight = null
    if (synced) {
      confirmedVersion = -1
      report('unconfirmed')
      schedule()
    } else report('unconfirmed')
  }
  provider.doc.on('update', changed)
  provider.on('status', disconnected)
  provider.on('sync', synchronized)
  schedule()

  return () => {
    destroyed = true
    clearTimeout(requestTimer)
    clearTimeout(receiptTimer)
    provider.doc.off('update', changed)
    provider.off('status', disconnected)
    provider.off('sync', synchronized)
    provider.messageHandlers[durabilityMessageType] = previousHandler
  }
}