// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ReferenceManager } from './ReferenceManager'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const bibliography = `@article{Keep,
  title={Primary paper},
  author={Lovelace, Ada},
  year={2024},
  doi={10.1000/shared}
}

@article{Duplicate,
  title={Duplicate paper},
  year={2024},
  doi={10.1000/shared}
}

@article{Unused,
  title={Unused paper},
  year={2022}
}
`

const setTextareaValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
    field,
    value,
  )
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const createApplySpy = () => vi.fn((expected: string, replacement: string) => {
  void expected
  void replacement
  return 'applied' as const
})

describe('ReferenceManager', () => {
  it('protects cited entries and merges unused DOI duplicates into an explicit key', async () => {
    const onApply = createApplySpy()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ReferenceManager
          bibliography={bibliography}
          manuscript="Prior {cite:p}`Keep`."
          readOnly={false}
          onApply={onApply}
          onClose={() => undefined}
        />,
      )
    })

    const citedDelete = container.querySelector<HTMLButtonElement>('[title="Used by 1 citation"]')
    expect(citedDelete?.disabled).toBe(true)
    expect(container.textContent).toContain('DOI duplicate')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Keep Keep and merge DOI duplicates"]')
        ?.click()
    })
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][0]).toBe(bibliography)
    expect(onApply.mock.calls[0][1]).toContain('@article{Keep')
    expect(onApply.mock.calls[0][1]).not.toContain('@article{Duplicate')

    await act(async () => root.unmount())
  })

  it('edits one raw BibTeX entry without allowing citation-key changes', async () => {
    const onApply = createApplySpy()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ReferenceManager
          bibliography={bibliography}
          manuscript=""
          readOnly={false}
          onApply={onApply}
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Edit Keep"]')?.click()
    })
    const field = container.querySelector<HTMLTextAreaElement>('[aria-label="BibTeX entry"]')
    await act(async () => {
      if (field) setTextareaValue(field, field.value.replace('Primary paper', 'Revised paper'))
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Save entry')?.click()
    })

    expect(onApply).toHaveBeenCalledWith(
      bibliography,
      expect.stringContaining('title={Revised paper}'),
    )
    expect(onApply.mock.calls[0][1]).toContain('@article{Keep')

    await act(async () => root.unmount())
  })

  it('imports standard BibTeX and surfaces deterministic key renames', async () => {
    const onApply = createApplySpy()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ReferenceManager
          bibliography={bibliography}
          manuscript=""
          readOnly={false}
          onApply={onApply}
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Import'))?.click()
    })
    const field = container.querySelector<HTMLTextAreaElement>('[aria-label="BibTeX to import"]')
    await act(async () => {
      if (field) setTextareaValue(field, '@article{Keep, title={New work}, year={2025}}')
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Import references')?.click()
    })

    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][1]).toContain('@article{Keep2')

    await act(async () => root.unmount())
  })
})