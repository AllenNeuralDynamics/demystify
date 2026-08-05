import { describe, expect, it } from 'vitest'
import { escapeHtml } from './markdownItUtils'

describe('escapeHtml', () => {
  it('escapes characters that could create HTML from math source', () => {
    expect(escapeHtml('x < y && y > "z"')).toBe(
      'x &lt; y &amp;&amp; y &gt; &quot;z&quot;',
    )
  })

  it('leaves ordinary TeX unchanged', () => {
    expect(escapeHtml('\\frac{a}{b}')).toBe('\\frac{a}{b}')
  })
})