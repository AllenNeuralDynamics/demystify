// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readAuthorshipMetadataSources } from './authorshipMetadata'
import { renderMyst } from './myst'

describe('renderMyst', () => {
  it('loads contributor metadata from directive-relative AuthorshipExtractor YAML', () => {
    const sources = readAuthorshipMetadataSources(
      `:::{authorship-explorer}\n:authors: ../people/authors.yml\n:::`,
      'paper/index.md',
      {
        'people/authors.yml': `project:
  contributors:
    - id: ada
      name: Ada Researcher
      orcid: 0000-0002-1825-0097
      email: ada@example.org
      corresponding: true
      affiliations:
        - Allen Institute
      roles:
        - Software
        - Writing - original draft
`,
      },
    )

    expect(sources).toEqual([{
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
      path: 'people/authors.yml',
    }])
  })

  it('rejects AuthorshipExtractor YAML paths that escape the project root', () => {
    const sources = readAuthorshipMetadataSources(
      `:::{authorship-explorer}\n:authors: ../../authors.yml\n:::`,
      'paper/index.md',
      { 'authors.yml': 'contributors: []' },
    )

    expect(sources).toEqual([{
      contributors: [],
      error: 'The authorship data path is invalid.',
      label: 'Contributors',
      path: null,
    }])
  })

  it('resolves MyST citations against BibTeX and appends cited references', () => {
    const bibliography = `@article{stringer2019,
  title={Spontaneous behaviors drive multidimensional activity},
  author={Stringer, Carsen and Pachitariu, Marius and Reddy, Vivek},
  year={2019},
  journal={Science},
  doi={10.1126/science.aav7893}
}

@article{smith2024,
  title={A second paper},
  author={Smith, Ada},
  year={2024},
  journal={Nature}
}`
    const result = renderMyst(
      'Prior work {cite:p}`stringer2019; smith2024`. {cite:t}`smith2024` followed up.\n',
      { bibliography },
    )

    expect(result.error).toBeNull()
    expect(result.html).toContain('Stringer et al., 2019')
    expect(result.html).toContain('Smith, 2024')
    expect(result.html).toContain('Smith (2024)')
    expect(result.html).toContain('data-citation-key="stringer2019"')
    expect(result.html).toContain('href="https://doi.org/10.1126/science.aav7893"')
    expect(result.html).toContain('<h2 id="references">References</h2>')
    expect(result.html).toContain('Spontaneous behaviors drive multidimensional activity')
    expect(result.html.match(/Spontaneous behaviors drive/g)).toHaveLength(1)
  })

  it('shows unresolved citation keys without failing the preview', () => {
    const result = renderMyst('Missing {cite:p}`unknown-key`.\n', { bibliography: '' })
    expect(result.error).toBeNull()
    expect(result.html).toContain('[missing: unknown-key]')
  })

  it('resolves MyST-normalized identifiers against mixed-case BibTeX keys', () => {
    const bibliography = `@article{Stringer2019,
  title={A mixed-case reference},
  author={Stringer, Carsen},
  year={2019}
}`
    const result = renderMyst('Prior work {cite:p}`Stringer2019`.\n', { bibliography })

    expect(result.html).toContain('Stringer, 2019')
    expect(result.html).toContain('data-citation-key="Stringer2019"')
    expect(result.html).toContain('A mixed-case reference')
  })

  it('maps simple citation roles to editable atomic citations', () => {
    const source = 'Prior **work** {cite:p}`{see}Stringer2019; Smith2024{p. 22}`.\n'
    const result = renderMyst(source)

    expect(result.editableBlocks).toContainEqual(expect.objectContaining({
      kind: 'paragraph',
      value: source.trim(),
      inline: [
        { type: 'text', value: 'Prior ' },
        { type: 'strong', children: [{ type: 'text', value: 'work' }] },
        { type: 'text', value: ' ' },
        {
          type: 'citation',
          keys: ['Stringer2019', 'Smith2024'],
          style: 'parenthetical',
          prefix: 'see',
          suffix: 'p. 22',
        },
        { type: 'text', value: '.' },
      ],
    }))
  })

  it('maps supported rendered blocks and inline formatting to exact source text', () => {
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
        inline: [{ type: 'text', value: 'Results' }],
      },
      {
        id: 'myst-editable-1',
        kind: 'paragraph',
        from: source.indexOf('A plain finding.'),
        to: source.indexOf('A plain finding.') + 'A plain finding.'.length,
        value: 'A plain finding.',
        inline: [{ type: 'text', value: 'A plain finding.' }],
      },
      {
        id: 'myst-editable-2',
        kind: 'paragraph',
        from: source.indexOf('A *formatted* finding.'),
        to: source.indexOf('A *formatted* finding.') + 'A *formatted* finding.'.length,
        value: 'A *formatted* finding.',
        inline: [{ type: 'text', value: 'A ' }, {
          type: 'emphasis',
          children: [{ type: 'text', value: 'formatted' }],
        }, { type: 'text', value: ' finding.' }],
      },
    ])
    expect(result.html).toContain('<h1 data-myst-edit-id="myst-editable-0">Results</h1>')
    expect(result.html).toContain('<p data-myst-edit-id="myst-editable-1">A plain finding.</p>')
    expect(result.html).toContain(
      '<p data-myst-edit-id="myst-editable-2">A <em>formatted</em> finding.</p>',
    )
  })

  it('maps list items and blockquotes without including their structural markers', () => {
    const source = `- A *listed* result.

1. An ordered result.

> A quoted **result**.
`
    const result = renderMyst(source)

    expect(result.editableBlocks).toEqual([
      expect.objectContaining({
        kind: 'paragraph',
        from: source.indexOf('A *listed* result.'),
        to: source.indexOf('A *listed* result.') + 'A *listed* result.'.length,
        value: 'A *listed* result.',
      }),
      expect.objectContaining({
        kind: 'paragraph',
        from: source.indexOf('An ordered result.'),
        to: source.indexOf('An ordered result.') + 'An ordered result.'.length,
        value: 'An ordered result.',
      }),
      expect.objectContaining({
        kind: 'paragraph',
        from: source.indexOf('A quoted **result**.'),
        to: source.indexOf('A quoted **result**.') + 'A quoted **result**.'.length,
        value: 'A quoted **result**.',
      }),
    ])
  })

  it('maps directive body prose and figure captions', () => {
    const source = `:::{note}
Editable **note** body.
:::

:::{figure} ./figure.svg
:alt: Figure description

Editable *caption*.
:::
`
    const result = renderMyst(source)

    expect(result.editableBlocks).toEqual([
      expect.objectContaining({
        kind: 'paragraph',
        value: 'Editable **note** body.',
      }),
      expect.objectContaining({
        kind: 'paragraph',
        value: 'Editable *caption*.',
      }),
    ])
    expect(result.html).toContain(
      '<figcaption data-myst-edit-id="myst-editable-1"><span class="caption-number">Figure 1</span> Editable <em>caption</em>.</figcaption>',
    )
  })

  it('preserves dropdown titles and MyST body content', () => {
    const source = `::::{dropdown} Show complete Methods
:class: manuscript-methods-dropdown

## Experimental animals

All animal procedures were approved. **Critical methods detail.**
::::

:::{dropdown} Terms and abbreviations

**ROI**: Region of interest.
:::
`
    const result = renderMyst(source)
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    const dropdowns = Array.from(document.querySelectorAll('details'))

    expect(result.error).toBeNull()
    expect(dropdowns).toHaveLength(2)
    expect(dropdowns[0].classList).toContain('manuscript-methods-dropdown')
    expect(dropdowns[0].classList).toContain('myst-dropdown')
    expect(dropdowns[0].querySelector('summary')?.textContent).toBe('Show complete Methods')
    expect(dropdowns[0].querySelector('h2')?.textContent).toBe('Experimental animals')
    expect(dropdowns[0].textContent).toContain('Critical methods detail.')
    expect(dropdowns[1].querySelector('summary')?.textContent).toBe('Terms and abbreviations')
    expect(dropdowns[1].textContent).toContain('ROI: Region of interest.')
    expect(result.editableBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heading', value: 'Experimental animals' }),
      expect.objectContaining({
        kind: 'paragraph',
        value: 'All animal procedures were approved. **Critical methods detail.**',
      }),
      expect.objectContaining({ kind: 'paragraph', value: '**ROI**: Region of interest.' }),
    ]))
  })

  it('preserves dropdown open state', () => {
    const result = renderMyst(`:::{dropdown} Expanded details
:open:

Visible body.
:::`)
    const document = new DOMParser().parseFromString(result.html, 'text/html')

    expect(result.error).toBeNull()
    expect(document.querySelector('details')?.open).toBe(true)
    expect(document.querySelector('details')?.textContent).toContain('Visible body.')
  })

  it('renders the directive families used by the production manuscript', () => {
    const result = renderMyst(`:::{note} Note
Note body.
:::

:::{warning} Warning
Warning body.
:::

:::{table} Table title
| A | B |
| - | - |
| 1 | 2 |
:::

::::{tab-set}
:::{tab-item} First
Tab body.
:::
::::

:::{iframe} ./interactive/result.html
:title: Interactive result
:placeholder: ./images/result.svg

Iframe caption.
:::
`)

    expect(result.error).toBeNull()
    expect(result.html).toContain('Note body.')
    expect(result.html).toContain('Warning body.')
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('Tab body.')
    expect(result.html).toContain('Iframe caption.')
    expect(result.html).not.toContain('directive unhandled')
  })

  it('wraps multiple figure caption paragraphs in one semantic caption', () => {
    const result = renderMyst(`:::{figure} ./figure.svg

First caption paragraph.

Second **caption** paragraph.
:::
`)
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    const captions = document.querySelectorAll('figure > figcaption')

    expect(result.error).toBeNull()
    expect(captions).toHaveLength(1)
    expect(captions[0].querySelectorAll('[data-myst-edit-id]')).toHaveLength(2)
    expect(captions[0].textContent).toContain('First caption paragraph.')
    expect(captions[0].textContent).toContain('Second caption paragraph.')
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
    expect(result.editableBlocks).toContainEqual(expect.objectContaining({
      id: expect.any(String),
      kind: 'heading',
      from: source.indexOf('Editable ending'),
      to: source.indexOf('Editable ending') + 'Editable ending'.length,
      value: 'Editable ending',
    }))
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

  it('maps sandboxed iframe body captions to editable static preview text', () => {
    const source = `:::{iframe} ./interactive/result.html
:label: fig-result
:title: Interactive result
:placeholder: ./images/result.svg

Editable **interactive caption**.
:::
`
    const result = renderMyst(source)

    expect(result.error).toBeNull()
    expect(result.editableBlocks).toContainEqual(expect.objectContaining({
      kind: 'paragraph',
      value: 'Editable **interactive caption**.',
    }))
    expect(result.html).toContain('data-myst-edit-id="myst-editable-0"')
    expect(result.html).toContain('Editable <strong>interactive caption</strong>.')
    expect(result.html).not.toContain('interactive/result.html')
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    expect(document.querySelectorAll('figure > figcaption')).toHaveLength(1)
    expect(document.querySelector('figcaption [data-myst-edit-id]')).not.toBeNull()
    expect(document.querySelector('figcaption img')).toBeNull()
    expect(document.querySelector('figure > .iframe-preview img')).not.toBeNull()
  })

  it('numbers figure and iframe captions consistently with separating whitespace', () => {
    const result = renderMyst(`:::{figure} ./figure.svg
:label: fig-one

First figure legend.
:::

:::{iframe} ./interactive/result.html
:label: fig-two
:placeholder: ./figure.svg

Second figure legend.
:::
`)
    const document = new DOMParser().parseFromString(result.html, 'text/html')
    const captions = Array.from(document.querySelectorAll('figcaption'))

    expect(result.error).toBeNull()
    expect(captions).toHaveLength(2)
    expect(captions.map((caption) => caption.textContent)).toEqual([
      'Figure 1 First figure legend.',
      'Figure 2 Second figure legend.',
    ])
    expect(captions.map((caption) =>
      caption.querySelectorAll('.caption-number').length)).toEqual([1, 1])
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
    expect(result.editableBlocks).toContainEqual(expect.objectContaining({
      id: expect.any(String),
      kind: 'heading',
      from: source.indexOf('Abstract'),
      to: source.indexOf('Abstract') + 'Abstract'.length,
      value: 'Abstract',
    }))
  })

  it('renders repository-relative AuthorshipExtractor data without executing the plugin', () => {
    const source = `:::{authorship-explorer}
:authors: ./authors.yml
:authors-alt: ../review/authors.yml
:alt-label: Review roster
:height: 800px
:::
`
    const result = renderMyst(source, {
      sourcePath: 'paper/index.md',
      projectFiles: {
        'paper/authors.yml': `version: 1
project:
  contributors:
    - id: ada
      name: Ada Example
      corresponding: true
      roles: [Conceptualization, Software, Validation, Visualization]
      affiliations: [institute]
    - id: grace
      first_name: Grace
      last_name: Example
      roles: [Data curation]
  affiliations:
    - id: institute
      name: Example Institute
`,
        'review/authors.yml': `contributors:
  - name: Reviewer Example
`,
      },
    })

    expect(result.error).toBeNull()
    expect(result.html).toContain('class="authorship-preview"')
    expect(result.html).toContain('2 contributors | 5 CRediT roles | 1 affiliation')
    expect(result.html).toContain('Ada Example (corresponding)')
    expect(result.html).toContain('Conceptualization, Software, Validation +1 roles')
    expect(result.html).toContain('Example Institute')
    expect(result.html).toContain('Grace Example')
    expect(result.html).toContain('Review roster: 1 contributor')
    expect(result.html).toContain('Source: paper/authors.yml')
    expect(result.html).not.toContain('authorship-explorer')
    expect(result.html).not.toContain(':authors:')
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
    expect(result.html).toContain(
      '<p data-myst-edit-id="myst-editable-0">Shared metadata details.</p>',
    )
    expect(result.html).toContain('<h3>Mesoscope</h3>')
    expect(result.html).not.toContain('tab-set')
    expect(result.html).not.toContain('tab-item')
    expect(result.html).not.toContain('directive unhandled')
  })
})