// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMyst } from './myst'

describe('renderMyst', () => {
  it('maps plain rendered blocks to their exact source text', () => {
    const source = '# Results\n\nA plain finding.\n\nA *formatted* finding.\n'
    const result = renderMyst(source)

    expect(result.error).toBeNull()
    expect(result.editableBlocks).toEqual([
      {
        id: 'myst-editable-0',
        kind: 'heading',
        from: source.indexOf('Results'),
        to: source.indexOf('Results') + 'Results'.length,
        value: 'Results',
      },
      {
        id: 'myst-editable-1',
        kind: 'paragraph',
        from: source.indexOf('A plain finding.'),
        to: source.indexOf('A plain finding.') + 'A plain finding.'.length,
        value: 'A plain finding.',
      },
    ])
    expect(result.html).toContain('<h1 data-myst-edit-id="myst-editable-0">Results</h1>')
    expect(result.html).toContain('<p data-myst-edit-id="myst-editable-1">A plain finding.</p>')
    expect(result.html).toContain('<p>A <em>formatted</em> finding.</p>')
  })

  it('renders raw HTML tables used by scientific manuscripts', () => {
    const result = renderMyst(`
<div class="publication-data-source" hidden aria-hidden="true">
<table>
  <tbody>
    <tr><td><details><summary>2 sessions</summary><div>A, B</div></details></td></tr>
  </tbody>
</table>
</div>
`)

    expect(result.error).toBeNull()
    expect(result.html).toContain('<div class="publication-data-source">')
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('<details>')
    expect(result.html).not.toContain('&lt;table')
    expect(result.html).not.toContain('aria-hidden')
    expect(result.html).not.toContain(' hidden')
  })

  it('restores multiple raw HTML blocks when placeholder text collides', () => {
    const source = `D0X is manuscript text.

<div class="first-raw"><p>First raw block</p></div>

<section class="second-raw"><p>Second raw block</p></section>

# Editable ending
`
    const result = renderMyst(source)

    expect(result.error).toBeNull()
    expect(result.html).toContain('<div class="first-raw"><p>First raw block</p></div>')
    expect(result.html).toContain('<section class="second-raw"><p>Second raw block</p></section>')
    expect(result.editableBlocks).toContainEqual({
      id: expect.any(String),
      kind: 'heading',
      from: source.indexOf('Editable ending'),
      to: source.indexOf('Editable ending') + 'Editable ending'.length,
      value: 'Editable ending',
    })
  })

  it('sanitizes executable raw HTML', () => {
    const result = renderMyst('<div><img src="figure.svg" onerror="alert(1)"><script>alert(1)</script></div>')

    expect(result.error).toBeNull()
    expect(result.html).toContain('<img src="figure.svg">')
    expect(result.html).not.toContain('onerror')
    expect(result.html).not.toContain('<script')
  })

  it('uses repository assets and static iframe placeholders', () => {
    const result = renderMyst(`
:::{figure} ./images/result.svg
:alt: Result summary

A static result.
:::

:::{iframe} ./interactive/result.html
:title: Interactive result
:placeholder: ./images/result-placeholder.svg

An interactive result.
:::
`, {
      assetBaseUrl: 'https://raw.githubusercontent.com/example/paper/refs/heads/main/',
    })

    expect(result.error).toBeNull()
    expect(result.html).toContain(
      'src="https://raw.githubusercontent.com/example/paper/refs/heads/main/images/result.svg"',
    )
    expect(result.html).toContain(
      'src="https://raw.githubusercontent.com/example/paper/refs/heads/main/images/result-placeholder.svg"',
    )
    expect(result.html).toContain('class="iframe-preview"')
    expect(result.html).toContain('loading="lazy"')
    expect(result.html).not.toContain('interactive/result.html')
  })

  it('omits page frontmatter and summarizes repository-only plugins', () => {
    const source = `---
title: A scientific manuscript
---

  <div class="publication-data-source" hidden>
  <p>Repository data</p>
  </div>

:::{authorship-explorer}
:authors: ./authors.yml
:height: 800px
:::

# Abstract
  `
    const result = renderMyst(source)

    expect(result.error).toBeNull()
    expect(result.html).not.toContain('title: A scientific manuscript')
    expect(result.html).not.toContain('authorship-explorer')
    expect(result.html).not.toContain(':authors:')
    expect(result.html).toContain('Authorship roster')
    expect(result.html).toContain('Repository data')
    expect(result.html).toContain('>Abstract</h1>')
    expect(result.editableBlocks).toContainEqual({
      id: expect.any(String),
      kind: 'heading',
      from: source.indexOf('Abstract'),
      to: source.indexOf('Abstract') + 'Abstract'.length,
      value: 'Abstract',
    })
  })

  it('flattens tab sets into readable sections', () => {
    const result = renderMyst(`
::::{tab-set}
:::{tab-item} Shared
Shared metadata details.
:::
:::{tab-item} Mesoscope
Mesoscope details.
:::
::::
`)

    expect(result.error).toBeNull()
    expect(result.html).toContain('<h3>Shared</h3>')
    expect(result.html).toContain('<p>Shared metadata details.</p>')
    expect(result.html).toContain('<h3>Mesoscope</h3>')
    expect(result.html).not.toContain('tab-set')
    expect(result.html).not.toContain('tab-item')
    expect(result.html).not.toContain('directive unhandled')
  })
})