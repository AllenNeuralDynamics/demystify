// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCollaboration } from './useCollaboration'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const providerInstances = vi.hoisted(() => [] as Array<{
  connect: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
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

    connect = vi.fn(() => this.emit('status', { status: 'connected' }))
    destroy = vi.fn()
    disconnect = vi.fn(() => this.emit('status', { status: 'disconnected' }))

    constructor() {
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

    private emit(event: string, value: unknown) {
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

const CollaborationHarness = () => {
  useCollaboration('visibility-test-room', profile, '# Draft')
  return null
}

describe('useCollaboration visibility lifecycle', () => {
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

  it('disconnects hidden tabs and reconnects them when visible', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<CollaborationHarness />))
    await act(async () => vi.runOnlyPendingTimers())
    const provider = providerInstances[0]
    expect(provider.connect).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(provider.disconnect).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(provider.connect).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    expect(provider.destroy).toHaveBeenCalledTimes(1)
  })
})