import { describe, expect, it } from 'vitest'
import { normalizeSourceText, serializeSourceText } from './sourceText'

describe('source text line endings', () => {
  it('keeps LF source unchanged', () => {
    const normalized = normalizeSourceText('alpha\nbeta\n')

    expect(normalized).toEqual({ content: 'alpha\nbeta\n', lineEnding: 'lf' })
    expect(serializeSourceText(normalized.content, normalized.lineEnding)).toBe(
      'alpha\nbeta\n',
    )
  })

  it('uses LF offsets while preserving CRLF snapshots', () => {
    const normalized = normalizeSourceText('alpha\r\nbeta\r\n')
    const edited = normalized.content.replace('beta', 'Xbeta')

    expect(normalized).toEqual({
      content: 'alpha\nbeta\n',
      lineEnding: 'crlf',
    })
    expect(serializeSourceText(edited, normalized.lineEnding)).toBe(
      'alpha\r\nXbeta\r\n',
    )
  })

  it('preserves legacy CR source style', () => {
    const normalized = normalizeSourceText('alpha\rbeta\r')

    expect(serializeSourceText(normalized.content, normalized.lineEnding)).toBe(
      'alpha\rbeta\r',
    )
  })
})