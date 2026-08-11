// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageActivity } from './usePageActivity'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const ActivityHarness = () => {
  const active = usePageActivity(1_000)
  return <span data-active={active} />
}

describe('usePageActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('suspends idle and hidden pages and resumes after activity', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const active = () => container.querySelector('span')?.dataset.active

    await act(async () => root.render(<ActivityHarness />))
    expect(active()).toBe('true')

    await act(async () => vi.advanceTimersByTime(1_000))
    expect(active()).toBe('false')

    await act(async () => document.dispatchEvent(new Event('pointerdown')))
    expect(active()).toBe('true')

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(active()).toBe('false')

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))
    expect(active()).toBe('false')

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(active()).toBe('true')

    await act(async () => vi.advanceTimersByTime(750))
    await act(async () => document.dispatchEvent(new Event('scroll')))
    await act(async () => vi.advanceTimersByTime(750))
    expect(active()).toBe('true')

    await act(async () => vi.advanceTimersByTime(250))
    expect(active()).toBe('false')

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(active()).toBe('true')

    await act(async () => root.unmount())
  })
})