declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http'
  import type { WebSocket } from 'ws'

  interface ConnectionOptions {
    docName?: string
    gc?: boolean
  }

  export function setupWSConnection(
    connection: WebSocket,
    request: IncomingMessage,
    options?: ConnectionOptions,
  ): void
}