// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { PublicationMetadata } from './PublicationMetadata'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const pageSource = `# Manuscript

Body.
`

const projectSource = `version: 1
project:
  # Preserve project comment
  title: Project title
  description: Shared description
  bibliography:
    - refs/library.bib
site:
  options:
    numbered_references: true
`

const setInputValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

const applySpy = () => vi.fn((input: {
  expectedPage: string
  expectedProject: string
  replacementPage: string
  replacementProject: string
}) => {
  void input
  return 'applied' as const
})

describe('PublicationMetadata', () => {
  it('shows inherited project values and writes canonical page authorship', async () => {
    const onApply = applySpy()
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <PublicationMetadata
          pageSource={pageSource}
          projectSource={projectSource}
          projectPath="myst.yml"
          readOnly={false}
          onApply={onApply}
          onClose={() => undefined}
        />,
      )
    })

    expect(container.querySelector<HTMLInputElement>('[aria-label="page title"]')?.placeholder)
      .toBe('Inherited: Project title')
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Add author'))?.click()
    })
    const name = container.querySelector<HTMLInputElement>('[aria-label="Author 1 name"]')
    const orcid = container.querySelector<HTMLInputElement>('[aria-label="Author 1 ORCID"]')
    const email = container.querySelector<HTMLInputElement>('[aria-label="Author 1 email"]')
    await act(async () => {
      if (name) setInputValue(name, 'Ada Lovelace')
      if (orcid) setInputValue(orcid, '0000-0002-1825-0097')
      if (email) setInputValue(email, 'ada@example.org')
      const corresponding = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .find((input) => input.parentElement?.textContent?.includes('Corresponding author'))
      corresponding?.click()
      container.querySelector<HTMLDetailsElement>('.credit-role-picker')?.setAttribute('open', '')
      const software = Array.from(container.querySelectorAll<HTMLInputElement>('.credit-role-picker input'))
        .find((input) => input.parentElement?.textContent?.trim() === 'Software')
      software?.click()
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Save metadata')?.click()
    })

    expect(onApply).toHaveBeenCalledOnce()
    const result = onApply.mock.calls[0][0]
    expect(result.expectedPage).toBe(pageSource)
    expect(result.replacementProject).toBe(projectSource)
    expect(result.replacementPage).toContain('authors:')
    expect(result.replacementPage).toContain('name: Ada Lovelace')
    expect(result.replacementPage).toContain('orcid: 0000-0002-1825-0097')
    expect(result.replacementPage).toContain('corresponding: true')
    expect(result.replacementPage).toContain('- Software')
    expect(result.replacementPage).toContain('# Manuscript')

    await act(async () => root.unmount())
  })

  it('writes project affiliations under project while preserving unrelated config', async () => {
    const onApply = applySpy()
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <PublicationMetadata
          pageSource={pageSource}
          projectSource={projectSource}
          projectPath="myst.yml"
          readOnly={false}
          onApply={onApply}
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('.metadata-scope button'))
        .find((button) => button.textContent?.includes('Whole project'))?.click()
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Add affiliation'))?.click()
    })
    const institution = container.querySelector<HTMLInputElement>(
      '[aria-label="Affiliation 1 institution"]',
    )
    const ror = container.querySelector<HTMLInputElement>('[aria-label="Affiliation 1 ror"]')
    await act(async () => {
      if (institution) setInputValue(institution, 'Allen Institute')
      if (ror) setInputValue(ror, 'https://ror.org/03cpe7c52')
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Save metadata')?.click()
    })

    expect(onApply).toHaveBeenCalledOnce()
    const result = onApply.mock.calls[0][0]
    expect(result.replacementPage).toBe(pageSource)
    expect(result.replacementProject).toContain('# Preserve project comment')
    expect(result.replacementProject).toContain('bibliography:')
    expect(result.replacementProject).toContain('numbered_references: true')
    expect(result.replacementProject).toContain('institution: Allen Institute')
    expect(result.replacementProject).toContain('ror: https://ror.org/03cpe7c52')

    await act(async () => root.unmount())
  })

  it('blocks invalid canonical author metadata', async () => {
    const onApply = applySpy()
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <PublicationMetadata
          pageSource={pageSource}
          projectSource=""
          projectPath="myst.yml"
          readOnly={false}
          onApply={onApply}
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Add author'))?.click()
    })
    const name = container.querySelector<HTMLInputElement>('[aria-label="Author 1 name"]')
    const invalidOrcid = container.querySelector<HTMLInputElement>('[aria-label="Author 1 ORCID"]')
    await act(async () => {
      if (name) setInputValue(name, 'Ada Lovelace')
      if (invalidOrcid) setInputValue(invalidOrcid, 'invalid')
      const corresponding = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .find((input) => input.parentElement?.textContent?.includes('Corresponding author'))
      corresponding?.click()
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Save metadata')?.click()
    })

    expect(onApply).not.toHaveBeenCalled()
    expect(container.textContent).toContain('ORCID is not valid')
    expect(container.textContent).toContain('corresponding author requires an email')

    await act(async () => root.unmount())
  })

  it('shows AuthorshipExtractor YAML contributors without making them editable', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <PublicationMetadata
          authorshipSources={[{
            contributors: [{
              affiliations: ['Allen Institute'],
              corresponding: true,
              email: 'ada@example.org',
              id: 'ada',
              name: 'Ada Researcher',
              orcid: '0000-0002-1825-0097',
              roles: ['Software', 'Writing - original draft'],
            }],
            error: null,
            label: 'Contributors',
            path: 'authors.yml',
          }]}
          pageSource={pageSource}
          projectSource={projectSource}
          projectPath="myst.yml"
          readOnly={false}
          onApply={applySpy()}
          onClose={() => undefined}
        />,
      )
    })

    expect(container.textContent).toContain('Authorship YAML')
    expect(container.textContent).toContain('authors.yml')
    expect(container.textContent).toContain('1 contributor')
    expect(container.textContent).toContain('Ada Researcher (corresponding)')
    expect(container.textContent).toContain('ORCID 0000-0002-1825-0097')
    expect(container.textContent).toContain('Software, Writing - original draft')
    expect(container.textContent).toContain('No canonical MyST authors set in this scope.')
    expect(container.querySelector<HTMLInputElement>('input[value="Ada Researcher"]')).toBeNull()

    await act(async () => root.unmount())
  })
})