// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { MentionCandidate } from '../lib/mentions'
import { MentionInput } from './MentionInput'

const candidates: MentionCandidate[] = [{
  actorId: 'reviewer-a',
  name: 'reviewer-a',
  displayName: 'Reviewer A',
  color: '#16705d',
  colorLight: '#e4f0eb',
}, {
  actorId: 'reviewer-b',
  name: 'reviewer-b',
  displayName: 'Reviewer B',
  color: '#a64b36',
  colorLight: '#f8e5df',
}]

const setInputValue = (field: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const dispatchKey = (field: HTMLInputElement, key: string, metaKey = false) => {
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, metaKey }))
}

describe('MentionInput', () => {
  it('navigates, selects, and dismisses mention options from the keyboard', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    const Harness = () => {
      const [value, setValue] = useState('')
      return (
        <MentionInput
          ariaLabel="Reply"
          candidates={candidates}
          placeholder="Reply with @"
          value={value}
          onChange={setValue}
          onSubmit={() => undefined}
        />
      )
    }

    await act(async () => root.render(<Harness />))
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')
    expect(input).not.toBeNull()
    if (!input) return

    await act(async () => setInputValue(input, '@reviewer'))
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent)
      .toContain('Reviewer A')

    await act(async () => dispatchKey(input, 'ArrowDown'))
    expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent)
      .toContain('Reviewer B')
    await act(async () => dispatchKey(input, 'Enter'))
    expect(input.value).toBe('@reviewer-b ')
    expect(container.querySelector('[role="listbox"]')).toBeNull()

    await act(async () => setInputValue(input, '@'))
    expect(container.querySelector('[role="listbox"]')).not.toBeNull()
    await act(async () => dispatchKey(input, 'Escape'))
    expect(container.querySelector('[role="listbox"]')).toBeNull()

    await act(async () => root.unmount())
  })

  it('submits with Command-Enter when the option list is closed', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSubmit = vi.fn()

    await act(async () => root.render(
      <MentionInput
        ariaLabel="Reply"
        candidates={candidates}
        placeholder="Reply with @"
        value="Ready for review"
        onChange={() => undefined}
        onSubmit={onSubmit}
      />,
    ))
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')
    expect(input).not.toBeNull()
    if (!input) return

    await act(async () => dispatchKey(input, 'Enter', true))
    expect(onSubmit).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
  })
})