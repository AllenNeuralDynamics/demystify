export type SourceLineEnding = 'lf' | 'crlf' | 'cr'

export interface NormalizedSourceText {
  content: string
  lineEnding: SourceLineEnding
}

export const normalizeSourceText = (source: string): NormalizedSourceText => {
  const firstLineEnding = source.match(/\r\n|\r|\n/)?.[0]
  const lineEnding: SourceLineEnding =
    firstLineEnding === '\r\n' ? 'crlf' : firstLineEnding === '\r' ? 'cr' : 'lf'

  return {
    content: source.replace(/\r\n?|\n/g, '\n'),
    lineEnding,
  }
}

export const serializeSourceText = (
  content: string,
  lineEnding: SourceLineEnding,
) => {
  if (lineEnding === 'crlf') return content.replace(/\n/g, '\r\n')
  if (lineEnding === 'cr') return content.replace(/\n/g, '\r')
  return content
}