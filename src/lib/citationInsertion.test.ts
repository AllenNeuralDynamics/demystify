import { describe, expect, it } from 'vitest'
import { getCitationInsertion } from './citationInsertion'

const citation = '{cite:p}`paper2024`'

describe('getCitationInsertion', () => {
  it('keeps a citation at the default selection separate from a heading', () => {
    expect(getCitationInsertion('# Title\n', 0, 0, citation)).toEqual({
      text: `${citation}\n\n`,
      cursorOffset: citation.length + 2,
    })
  })

  it('adds spaces when inserting between prose characters', () => {
    expect(getCitationInsertion('beforeafter', 6, 6, citation)).toEqual({
      text: ` ${citation} `,
      cursorOffset: citation.length + 2,
    })
  })

  it('preserves adjacent whitespace and punctuation', () => {
    expect(getCitationInsertion('Before .', 7, 7, citation)).toEqual({
      text: citation,
      cursorOffset: citation.length,
    })
  })
})