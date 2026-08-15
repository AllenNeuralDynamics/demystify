// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchPapers } from '../lib/github'
import { CitationPicker } from './CitationPicker'

vi.mock('../lib/github', () => ({
  searchPapers: vi.fn(),
}))

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const bibliography = `@article{local2024,
  title={A local manuscript reference},
  author={Lovelace, Ada},
  year={2024},
  journal={Science},
  doi={10.1000/local}
}`

const setInputValue = (field: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  vi.mocked(searchPapers).mockReset()
})

describe('CitationPicker', () => {
  it('selects an existing reference and inserts it as a narrative citation', async () => {
    const onInsert = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CitationPicker
          allowNewReferences={false}
          bibliography={bibliography}
          roomName="citation-picker-room"
          onClose={() => undefined}
          onInsert={onInsert}
        />,
      )
    })

    const localResult = Array.from(container.querySelectorAll<HTMLButtonElement>('.citation-result'))
      .find((button) => button.textContent?.includes('A local manuscript reference'))
    expect(localResult).toBeDefined()
    await act(async () => localResult?.click())
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('.citation-style button'))
        .find((button) => button.textContent === 'Narrative')?.click()
    })
    const prefix = container.querySelector<HTMLInputElement>('[aria-label="Citation prefix"]')
    const suffix = container.querySelector<HTMLInputElement>(
      '[aria-label="Citation locator or suffix"]',
    )
    await act(async () => {
      if (prefix) setInputValue(prefix, 'see')
      if (suffix) setInputValue(suffix, 'p. 22')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.citation-picker-footer .primary-button')?.click()
    })

    expect(onInsert).toHaveBeenCalledWith(
      [{ kind: 'existing', key: 'local2024' }],
      'narrative',
      { prefix: 'see', suffix: 'p. 22' },
    )
    expect(searchPapers).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "Choose from this manuscript's library. New papers can be added after proposed changes are resolved.",
    )

    await act(async () => root.unmount())
  })

  it('searches Crossref after a debounce and selects a remote paper', async () => {
    vi.mocked(searchPapers).mockResolvedValue([{
      id: 'doi:10.1000/remote',
      title: 'A remote neural paper',
      authors: [{ family: 'Hopper', given: 'Grace' }],
      year: 2023,
      containerTitle: 'Nature',
      doi: '10.1000/remote',
      url: 'https://doi.org/10.1000/remote',
      type: 'article-journal',
    }])
    const onInsert = vi.fn()
    const onClose = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CitationPicker
          bibliography=""
          roomName="citation-picker-room"
          onClose={onClose}
          onInsert={onInsert}
        />,
      )
    })
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search papers"]')
    await act(async () => {
      if (search) setInputValue(search, 'remote neural')
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    })

    expect(searchPapers).toHaveBeenCalledWith('citation-picker-room', 'remote neural')
    expect(container.textContent).toContain('A remote neural paper')
    const remoteResult = Array.from(container.querySelectorAll<HTMLButtonElement>('.citation-result'))
      .find((button) => button.textContent?.includes('A remote neural paper'))
    await act(async () => remoteResult?.click())
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.citation-picker-footer .primary-button')?.click()
    })
    expect(onInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'paper',
        paper: expect.objectContaining({ doi: '10.1000/remote' }),
      }),
    ], 'parenthetical', {})

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalled()

    await act(async () => root.unmount())
  })

  it('keeps library-only searches local', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CitationPicker
          allowNewReferences={false}
          bibliography={bibliography}
          roomName="citation-picker-room"
          onClose={() => undefined}
          onInsert={() => undefined}
        />,
      )
    })
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search papers"]')
    expect(search?.placeholder).toBe('Search this manuscript library')
    await act(async () => {
      if (search) setInputValue(search, 'remote neural')
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    })

    expect(searchPapers).not.toHaveBeenCalled()
    expect(container.textContent).toContain('No matching references in this manuscript.')

    await act(async () => root.unmount())
  })

  it('drops a selected remote paper when review mode becomes library-only', async () => {
    vi.mocked(searchPapers).mockResolvedValue([{
      id: 'doi:10.1000/remote',
      title: 'A remote neural paper',
      authors: [{ family: 'Hopper', given: 'Grace' }],
      year: 2023,
      containerTitle: 'Nature',
      doi: '10.1000/remote',
      url: 'https://doi.org/10.1000/remote',
      type: 'article-journal',
    }])
    const container = document.createElement('div')
    const root = createRoot(container)
    const renderPicker = (allowNewReferences: boolean) => (
      <CitationPicker
        allowNewReferences={allowNewReferences}
        bibliography={bibliography}
        key={allowNewReferences ? 'full' : 'library-only'}
        roomName="citation-picker-room"
        onClose={() => undefined}
        onInsert={() => undefined}
      />
    )

    await act(async () => root.render(renderPicker(true)))
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search papers"]')
    await act(async () => {
      if (search) setInputValue(search, 'remote neural')
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    })
    const remoteResult = Array.from(container.querySelectorAll<HTMLButtonElement>('.citation-result'))
      .find((button) => button.textContent?.includes('A remote neural paper'))
    await act(async () => remoteResult?.click())
    expect(container.textContent).toContain('1 selected')

    await act(async () => root.render(renderPicker(false)))
    expect(container.textContent).not.toContain('A remote neural paper')
    expect(container.textContent).toContain('Select references')

    await act(async () => root.unmount())
  })
})