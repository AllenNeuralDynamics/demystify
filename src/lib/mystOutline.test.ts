import { describe, expect, it } from 'vitest'
import { getMystOutline } from './mystOutline'

describe('getMystOutline', () => {
  it('maps formatted headings to exact source ranges', () => {
    const source = '# Paper\n\n## **Methods**\n\n### [Results](results.md) ###\n'
    expect(getMystOutline(source)).toEqual([
      expect.objectContaining({ depth: 1, title: 'Paper', from: 2, to: 7 }),
      expect.objectContaining({ depth: 2, title: 'Methods', from: 12, to: 23 }),
      expect.objectContaining({ depth: 3, title: 'Results', from: 29, to: 54 }),
    ])
  })

  it('ignores headings inside code fences', () => {
    const source = '# Visible\n\n```md\n# Hidden\n```\n\n## Also visible\n'
    expect(getMystOutline(source).map((entry) => entry.title)).toEqual([
      'Visible',
      'Also visible',
    ])
  })
})