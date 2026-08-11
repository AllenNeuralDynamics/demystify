// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createCollaborativeTextEditAnchor } from '../lib/collaborativeTextEdit'
import { MystPreview } from './MystPreview'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const figure = `
:::{figure} ./images/result.svg
:alt: Result summary

A static result.
:::
`

const replaceEditableText = async (field: HTMLElement, value: string) => {
  field.textContent = value
  field.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    data: value,
    inputType: 'insertText',
  }))
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}

describe('MystPreview', () => {
  it('renders collaborative AuthorshipExtractor data relative to the active source', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={`:::{authorship-explorer}\n:authors: ./authors.yml\n:::\n`}
          projectFiles={{
            'paper/authors.yml': `project:\n  contributors:\n    - name: Ada Collaborator\n`,
          }}
          sourcePath="paper/index.md"
        />,
      )
    })

    expect(container.querySelector('.authorship-preview')).not.toBeNull()
    expect(container.textContent).toContain('1 contributor')
    expect(container.textContent).toContain('Ada Collaborator')
    expect(container.textContent).toContain('Source: paper/authors.yml')

    await act(async () => root.unmount())
  })

  it('edits plain blocks and preserves supported formatting in rich blocks', async () => {
    const content = '# Draft\n\nFirst paragraph.\n\nA *formatted* paragraph.'
    const yDocument = new Y.Doc()
    const text = yDocument.getText('content')
    text.insert(0, content)
    const onBeginEdit = vi.fn((block: {
      from: number
      to: number
      value: string
    }) => createCollaborativeTextEditAnchor(text, block.from, block.to, block.value))
    const onCommitEdit = vi.fn(() => 'applied' as const)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          editable
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
        />,
      )
    })

    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs[0].classList).toContain('myst-editable-block')
    expect(paragraphs[1].classList).toContain('myst-editable-block')

    await act(async () => paragraphs[1].click())
    expect(container.querySelector('[aria-label="Edit paragraph"] em')?.textContent).toBe('formatted')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })
    expect(onCommitEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedText: 'A *formatted* paragraph.' }),
      'A *formatted* paragraph.',
    )

    await act(async () => paragraphs[0].click())
    const field = container.querySelector<HTMLElement>('[aria-label="Edit paragraph"]')
    expect(field).not.toBeNull()
    await act(async () => {
      if (!field) return
      await replaceEditableText(field, 'Revised paragraph.')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })

    expect(onCommitEdit).toHaveBeenCalledWith(
      expect.objectContaining({ expectedText: 'First paragraph.' }),
      'Revised paragraph.',
    )

    await act(async () => root.unmount())
    yDocument.destroy()
  })

  it('preserves a rendered text selection before opening the visual editor', async () => {
    const content = 'Select these words.'
    const yDocument = new Y.Doc()
    const text = yDocument.getText('content')
    text.insert(0, content)
    const onBeginEdit = vi.fn((block: {
      from: number
      to: number
      value: string
    }) => createCollaborativeTextEditAnchor(text, block.from, block.to, block.value))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          editable
          onBeginEdit={onBeginEdit}
          onCommitEdit={() => 'applied'}
        />,
      )
    })

    const paragraph = container.querySelector<HTMLElement>('p')
    const textNode = paragraph?.firstChild
    expect(paragraph).not.toBeNull()
    expect(textNode).not.toBeNull()
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(textNode as Node, 0)
    range.setEnd(textNode as Node, 6)
    selection?.removeAllRanges()
    selection?.addRange(range)

    await act(async () => paragraph?.click())
    expect(selection?.toString()).toBe('Select')
    expect(onBeginEdit).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Edit paragraph"]')).toBeNull()

    selection?.removeAllRanges()
    await act(async () => paragraph?.click())
    expect(onBeginEdit).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="Edit paragraph"]')).not.toBeNull()

    await act(async () => root.unmount())
    container.remove()
    yDocument.destroy()
  })

  it('edits nested prose without consuming its structural markers', async () => {
    const content = `- Listed **result**.

> Quoted result.

:::{note}
Note body.
:::
${figure}`
    const yDocument = new Y.Doc()
    const text = yDocument.getText('content')
    text.insert(0, content)
    const onBeginEdit = (block: { from: number; to: number; value: string }) =>
      createCollaborativeTextEditAnchor(text, block.from, block.to, block.value)
    const onCommitEdit = vi.fn(() => 'applied' as const)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          editable
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
        />,
      )
    })

    const paragraphWithText = (value: string) => Array.from(container.querySelectorAll('p'))
      .find((paragraph) => paragraph.textContent === value)
    const listParagraph = paragraphWithText('Listed result.')
    expect(listParagraph?.classList).toContain('myst-editable-block')
    expect(paragraphWithText('Quoted result.')?.classList).toContain('myst-editable-block')
    expect(paragraphWithText('Note body.')?.classList).toContain('myst-editable-block')
    expect(container.querySelector('figcaption')?.textContent).toBe('Figure 1 A static result.')
    expect(container.querySelector('figcaption')?.classList).toContain('myst-editable-block')

    await act(async () => listParagraph?.click())
    const field = container.querySelector<HTMLElement>('[aria-label="Edit paragraph"]')
    expect(field?.querySelector('strong')?.textContent).toBe('result')
    await act(async () => {
      if (field) await replaceEditableText(field, 'Revised list result.')
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })

    expect(onCommitEdit).toHaveBeenCalledWith(
      expect.objectContaining({ expectedText: 'Listed **result**.' }),
      'Revised list result.',
    )

    await act(async () => container.querySelector('figcaption')?.click())
    expect(container.querySelector('[aria-label="Edit paragraph"]')?.textContent)
      .toBe('A static result.')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })
    expect(onCommitEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedText: 'A static result.' }),
      'A static result.',
    )

    await act(async () => root.unmount())
    yDocument.destroy()
  })

  it('keeps the visual draft open when the source changed concurrently', async () => {
    const content = '# Draft'
    const yDocument = new Y.Doc()
    const text = yDocument.getText('content')
    text.insert(0, content)
    const onBeginEdit = (block: { from: number; to: number; value: string }) =>
      createCollaborativeTextEditAnchor(text, block.from, block.to, block.value)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          editable
          onBeginEdit={onBeginEdit}
          onCommitEdit={() => 'conflict'}
        />,
      )
    })
    await act(async () => container.querySelector('h1')?.click())
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })

    expect(container.querySelector('[aria-label="Edit heading"]')).not.toBeNull()
    expect(container.textContent).toContain('This block changed elsewhere.')

    await act(async () => root.unmount())
    yDocument.destroy()
  })

  it('supports keyboard editing, rejects empty headings, and cancels safely', async () => {
    const content = '# Draft'
    const yDocument = new Y.Doc()
    const text = yDocument.getText('content')
    text.insert(0, content)
    const onBeginEdit = (block: { from: number; to: number; value: string }) =>
      createCollaborativeTextEditAnchor(text, block.from, block.to, block.value)
    const onCommitEdit = vi.fn(() => 'applied' as const)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          editable
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
        />,
      )
    })
    const heading = container.querySelector<HTMLElement>('h1')
    expect(heading?.tabIndex).toBe(0)
    await act(async () => {
      heading?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }))
    })
    const field = container.querySelector<HTMLElement>('[aria-label="Edit heading"]')
    await act(async () => {
      if (field) await replaceEditableText(field, '   ')
      container.querySelector<HTMLButtonElement>('[title="Save visual edit"]')?.click()
    })

    expect(onCommitEdit).not.toHaveBeenCalled()
    expect(container.textContent).toContain('A heading cannot be empty.')
    await act(async () => {
      field?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
      }))
    })
    expect(container.querySelector('[aria-label="Edit heading"]')).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Draft')

    await act(async () => root.unmount())
    yDocument.destroy()
  })

  it('keeps read-only previews inert and reports stale editable ranges', async () => {
    const content = '# Draft'
    const onBeginEdit = vi.fn(() => null)
    const onCommitEdit = vi.fn(() => 'applied' as const)
    const onEditError = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
        />,
      )
    })
    const heading = container.querySelector<HTMLElement>('h1')
    expect(heading?.classList).not.toContain('myst-editable-block')
    expect(heading?.tabIndex).toBe(-1)
    await act(async () => heading?.click())
    expect(onBeginEdit).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <MystPreview
          content={content}
          editable
          onBeginEdit={onBeginEdit}
          onCommitEdit={onCommitEdit}
          onEditError={onEditError}
        />,
      )
    })
    await act(async () => container.querySelector('h1')?.click())
    expect(onEditError).toHaveBeenCalledWith(
      'The preview changed before editing began. Try the block again.',
    )
    expect(container.querySelector('[aria-label="Edit heading"]')).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Draft')

    await act(async () => root.unmount())
  })

  it('preserves loaded images across debounced content updates', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<MystPreview content={`# Draft\n\nFirst paragraph.\n${figure}`} />)
    })
    const originalImage = container.querySelector('img')
    expect(originalImage).not.toBeNull()

    await act(async () => {
      root.render(<MystPreview content={`# Draft\n\nUpdated paragraph.\n${figure}`} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500))
    })

    expect(container.querySelector('img')).toBe(originalImage)
    expect(container.textContent).toContain('Updated paragraph.')

    await act(async () => root.unmount())
  })
})
