declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http'
  import type { WebSocket } from 'ws'
  import type * as Y from 'yjs'

  interface ConnectionOptions {
    docName?: string
    gc?: boolean
  }

  export const docs: Map<string, Y.Doc>

  export function getYDoc(documentName: string, gc?: boolean): Y.Doc

  export function setupWSConnection(
    connection: WebSocket,
    request: IncomingMessage,
    options?: ConnectionOptions,
  ): void

  interface Persistence {
    provider: unknown
    bindState(documentName: string, document: Y.Doc): void
    writeState(documentName: string, document: Y.Doc): Promise<unknown>
  }

  export function setPersistence(persistence: Persistence | null): void
}