// @vitest-environment jsdom
import { act, createRef, forwardRef, useImperativeHandle } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'
import { useCollaboration } from './useCollaboration'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const providerInstances = vi.hoisted(() => [] as Array<{
  connect: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  emit: (event: string, value: unknown) => void
  shouldConnect: boolean
}>)

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    private listeners = new Map<string, Set<(value: unknown) => void>>()

    awareness = {
      getStates: () => new Map(),
      off: vi.fn(),
      on: vi.fn(),
      setLocalStateField: vi.fn(),
    }

    shouldConnect = true
    wsconnected = false
    synced = false
    ws = { readyState: 1, send: vi.fn() } as unknown as WebSocket
    messageHandlers: WebsocketProvider['messageHandlers'] = []
    readonly doc: Y.Doc

    connect = vi.fn(() => this.emit('status', { status: 'connected' }))
    destroy = vi.fn()
    disconnect = vi.fn(() => this.emit('status', { status: 'disconnected' }))

    constructor(_url: string, _room: string, doc: Y.Doc) {
      this.doc = doc
      providerInstances.push(this)
    }

    off(event: string, listener: (value: unknown) => void) {
      this.listeners.get(event)?.delete(listener)
    }

    on(event: string, listener: (value: unknown) => void) {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
    }

    emit(event: string, value: unknown) {
      if (event === 'status') this.wsconnected = (value as { status: string }).status === 'connected'
      if (event === 'sync') this.synced = value === true
      this.listeners.get(event)?.forEach((listener) => listener(value))
    }
  },
}))

const profile = {
  id: 'visibility-test',
  name: 'Visibility Test',
  color: '#16705d',
  colorLight: '#dcefe9',
}

const CollaborationHarness = forwardRef<ReturnType<typeof useCollaboration>, {
  active?: boolean
  actorId?: string
}>(function CollaborationHarness({
  active = true,
  actorId = profile.id,
}, ref) {
  const collaboration = useCollaboration(
    'visibility-test-room',
    { ...profile, id: actorId },
    '# Draft',
    true,
    false,
    active,
  )
  useImperativeHandle(ref, () => collaboration, [collaboration])
  return null
})

describe('useCollaboration connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    providerInstances.length = 0
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not initialize or report synchronization for sync(false)', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))
    await act(async () => {
      providerInstances[0].emit('sync', false)
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(collaborationRef.current?.isSynced).toBe(false)
    expect(collaborationRef.current?.sharedText?.toString()).toBe('')
    await act(async () => root.unmount())
  })

  it('clears synchronization on disconnect without discarding local comments', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))
    await act(async () => {
      providerInstances[0].emit('sync', true)
      await vi.advanceTimersByTimeAsync(300)
      collaborationRef.current?.addComment('Keep this local comment')
    })
    expect(collaborationRef.current?.isSynced).toBe(true)
    await act(async () => providerInstances[0].emit('status', { status: 'disconnected' }))
    expect(collaborationRef.current?.isSynced).toBe(false)
    expect(collaborationRef.current?.comments[0]?.body).toBe('Keep this local comment')
    await act(async () => root.unmount())
  })

  it('disconnects inactive pages and reconnects them after activity', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<CollaborationHarness />))
    const provider = providerInstances[0]
    expect(provider.connect).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<CollaborationHarness active={false} />))
    expect(provider.disconnect).toHaveBeenCalledTimes(1)
    expect(provider.destroy).not.toHaveBeenCalled()

    await act(async () => root.render(<CollaborationHarness active />))
    expect(provider.connect).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    expect(provider.destroy).toHaveBeenCalledTimes(1)
  })

  it('edits only an existing ordinary comment body without blocking', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))

    let commentId: string | undefined
    await act(async () => {
      commentId = collaborationRef.current?.addComment('Original comment')
    })
    expect(commentId).toBeTruthy()
    await act(async () => {
      expect(collaborationRef.current?.editComment(commentId ?? '', 'Edited comment')).toBe(true)
    })
    expect(collaborationRef.current?.comments).toEqual([
      expect.objectContaining({ id: commentId, body: 'Edited comment' }),
    ])

    await act(async () => root.unmount())
  })

  it('keeps a composed comment attached to its captured passage after text is inserted above it', async () => {
    const root = createRoot(document.createElement('div'))
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))
    const source = 'A selected phrase.'
    const phrase = 'selected phrase'
    const from = source.indexOf(phrase)
    await act(async () => collaborationRef.current?.sharedText?.insert(0, source))
    const anchor = collaborationRef.current?.captureCommentAnchor({ from, to: from + phrase.length })
    const prefix = 'A collaborator added this.\n\n'
    await act(async () => collaborationRef.current?.sharedText?.insert(0, prefix))
    await act(async () => collaborationRef.current?.addComment('Discuss this phrase', undefined, anchor))
    const comment = collaborationRef.current?.comments[0]
    expect(comment?.anchor?.quote).toBe(phrase)
    expect(comment && collaborationRef.current?.resolveAnchor(comment))
      .toMatchObject({ from: prefix.length + from, to: prefix.length + from + phrase.length })
    await act(async () => root.unmount())
  })

  it('does not post a composed comment on a deleted captured passage', async () => {
    const root = createRoot(document.createElement('div'))
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))
    await act(async () => collaborationRef.current?.sharedText?.insert(0, 'Selected passage'))
    const anchor = collaborationRef.current?.captureCommentAnchor({ from: 0, to: 16 })
    await act(async () => collaborationRef.current?.sharedText?.delete(0, 16))
    await act(async () => {
      expect(collaborationRef.current?.addComment('Keep the draft', undefined, anchor)).toBeUndefined()
    })
    expect(collaborationRef.current?.comments).toHaveLength(0)
    await act(async () => root.unmount())
  })

  it('reconnects with a new provider when the authorized actor changes', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<CollaborationHarness actorId="share:guest" />))
    const guestProvider = providerInstances[0]

    await act(async () => root.render(<CollaborationHarness actorId="github:42" />))
    expect(guestProvider.destroy).toHaveBeenCalledOnce()
    expect(providerInstances).toHaveLength(2)
    expect(providerInstances[1].connect).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })

  it('retains rejected changes and requests recovery instead of silently reconnecting', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))
    await act(async () => collaborationRef.current?.addComment('Rejected but recoverable'))
    await act(async () => providerInstances[0].emit('connection-close', {
      code: 1008,
      reason: 'Collaboration update rejected',
    }))
    expect(providerInstances[0].shouldConnect).toBe(false)
    expect(collaborationRef.current?.accessError).toContain('Download a recovery file')
    expect(collaborationRef.current?.comments[0]?.body).toBe('Rejected but recoverable')
    await act(async () => root.unmount())
  })

  it('stops reconnecting when share access is revoked', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const collaborationRef = createRef<ReturnType<typeof useCollaboration>>()
    await act(async () => root.render(<CollaborationHarness ref={collaborationRef} />))
    const provider = providerInstances[0]

    await act(async () => {
      provider.emit('connection-close', {
        code: 1008,
        reason: 'collaborator access was revoked',
      })
      provider.emit('status', { status: 'disconnected' })
    })

    expect(provider.shouldConnect).toBe(false)
    expect(collaborationRef.current?.status).toBe('disconnected')
    expect(collaborationRef.current?.accessError).toBe(
      'Suggestion access was revoked. Open a current sharing link to continue.',
    )

    await act(async () => root.unmount())
  })
})