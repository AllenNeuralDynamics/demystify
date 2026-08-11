import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { describe, expect, it } from 'vitest'
import {
  describeCollaborationClient,
  describeHttpRequestCategory,
} from './collaboration-observability.js'

describe('describeCollaborationClient', () => {
  it('summarizes VS Code clients without retaining identifying headers', () => {
    const metadata = describeCollaborationClient({
      forwardedFor: '203.0.113.4, 10.0.0.1',
      remoteAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Electron/35.0 Code/1.99',
      fingerprintSalt: 'test-secret',
    })

    expect(metadata).toEqual({
      family: 'vscode',
      platform: 'macos',
      fingerprint: expect.stringMatching(/^[0-9a-f]{12}$/),
    })
    expect(JSON.stringify(metadata)).not.toContain('203.0.113.4')
    expect(JSON.stringify(metadata)).not.toContain('Electron')
  })

  it('uses the first forwarded address for a stable salted fingerprint', () => {
    const first = describeCollaborationClient({
      forwardedFor: ['not-an-address, 198.51.100.8, 10.0.0.2'],
      remoteAddress: undefined,
      userAgent: 'Mozilla/5.0 (iPhone) Version/18.0 Mobile/15E148 Safari/604.1',
      fingerprintSalt: 'test-secret',
    })
    const second = describeCollaborationClient({
      forwardedFor: '198.51.100.8',
      remoteAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (iPhone) Version/18.0 Mobile/15E148 Safari/604.1',
      fingerprintSalt: 'test-secret',
    })

    expect(first).toEqual(second)
    expect(first).toMatchObject({ family: 'safari', platform: 'ios' })
  })

  it('rejects malformed address hints and falls back to non-identifying metadata', () => {
    const metadata = describeCollaborationClient({
      forwardedFor: 'spoofed.example',
      remoteAddress: 'not-an-address',
      userAgent: undefined,
      fingerprintSalt: 'test-secret',
    })

    expect(metadata).toMatchObject({ family: 'unknown', platform: 'unknown' })
    expect(JSON.stringify(metadata)).not.toContain('spoofed.example')
  })

  it('reports tracked clients after open and remaining clients after close', async () => {
    const server = createServer()
    const webSocketServer = new WebSocketServer({ noServer: true })
    const activeConnectionCounts: number[] = []
    let resolveServerClose: () => void = () => undefined
    const serverSocketClosed = new Promise<void>((resolve) => {
      resolveServerClose = resolve
    })

    server.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        activeConnectionCounts.push(webSocketServer.clients.size)
        webSocket.once('close', () => {
          activeConnectionCounts.push(webSocketServer.clients.size)
          resolveServerClose()
        })
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address() as AddressInfo
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`)
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
    client.close()
    await serverSocketClosed

    expect(activeConnectionCounts).toEqual([1, 0])

    await new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => error ? reject(error) : resolve())
    })
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  })
})

describe('describeHttpRequestCategory', () => {
  it.each([
    ['/api/health', 'health'],
    ['/api/config', 'configuration'],
    ['/api/auth/session', 'authentication'],
    ['/api/rooms/private-room/claim', 'room'],
    ['/api/github/repositories', 'github'],
    ['/assets/index.js', 'application'],
  ] as const)('classifies %s without retaining path parameters', (path, category) => {
    expect(describeHttpRequestCategory(path)).toBe(category)
  })
})