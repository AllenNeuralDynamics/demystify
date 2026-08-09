import { describe, expect, it } from 'vitest'
import type { MystEditableInline } from './myst'
import {
  createVisualInlineDocument,
  serializeVisualInlineDocument,
  visualCitationLabel,
  visualInlineSchema,
} from './visualInline'

const bibliography = `@article{smith2024,
  title={A paper},
  author={Smith, Ada and Hopper, Grace and Lovelace, Ada},
  year={2024}
}`

describe('visual inline document', () => {
  it('serializes supported nested formatting, links, breaks, and citations to MyST', () => {
    const inline: MystEditableInline[] = [
      { type: 'text', value: 'See ' },
      { type: 'strong', children: [
        { type: 'text', value: 'bold ' },
        { type: 'emphasis', children: [{ type: 'text', value: 'and italic' }] },
      ] },
      { type: 'text', value: ', ' },
      { type: 'link', url: 'https://example.org/a)', children: [{ type: 'text', value: 'a link' }] },
      { type: 'break' },
      {
        type: 'citation',
        keys: ['smith2024'],
        style: 'parenthetical',
        prefix: 'see',
        suffix: 'p. 22',
      },
    ]
    const document = createVisualInlineDocument(inline, bibliography)

    expect(serializeVisualInlineDocument(document)).toBe(
      'See **bold *and italic***, [a link](https://example.org/a%29)  \n' +
      '{cite:p}`{see}smith2024{p. 22}`',
    )
    expect(document.textBetween(0, document.content.size, '')).toContain('See bold and italic')
    expect(document.lastChild?.attrs.label).toBe('(see Smith et al., 2024, p. 22)')
  })

  it('escapes literal MyST punctuation and chooses safe code fences', () => {
    const document = visualInlineSchema.nodes.doc.create(null, [
      visualInlineSchema.text('email@example.org * literal'),
      visualInlineSchema.text('a `tick`', [visualInlineSchema.marks.code.create()]),
    ])
    expect(serializeVisualInlineDocument(document)).toBe(
      'email\\@example.org \\* literal``a `tick```',
    )
  })

  it('formats missing and known citation labels without altering keys', () => {
    expect(visualCitationLabel(['smith2024', 'missing'], 'narrative', bibliography))
      .toBe('Smith et al. (2024); missing')
  })

  it('matches MyST-normalized keys to mixed-case BibTeX keys', () => {
    expect(visualCitationLabel(
      ['smith2024'],
      'parenthetical',
      bibliography.replace('smith2024', 'Smith2024'),
    )).toBe('(Smith et al., 2024)')
  })
})