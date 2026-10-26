export type SourceLineEnding = 'lf' | 'crlf' | 'cr'

export const normalizeRoomTitle = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const title = value.trim()
  if (!title || title.length > 180) return null
  for (const character of title) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return null
  }
  return title
}

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