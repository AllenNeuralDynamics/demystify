// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMyst } from './myst'

describe('renderMyst', () => {
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
    const result = renderMyst(`---
title: A scientific manuscript
---

:::{authorship-explorer}
:authors: ./authors.yml
:height: 800px
:::

# Abstract
`)

    expect(result.error).toBeNull()
    expect(result.html).not.toContain('title: A scientific manuscript')
    expect(result.html).not.toContain('authorship-explorer')
    expect(result.html).not.toContain(':authors:')
    expect(result.html).toContain('Authorship roster')
    expect(result.html).toContain('<h1>Abstract</h1>')
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