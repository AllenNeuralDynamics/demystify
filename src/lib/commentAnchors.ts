import * as Y from 'yjs'

export interface CommentAnchor {
  version: 1
  start: string
  end: string
  quote: string
}

export interface CommentSourceRange {
  from: number
  to: number
  quote: string
  startLine: number
  endLine: number
  orphaned: boolean
}

const encodeBytes = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const decodeBytes = (value: string) => {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const clamp = (value: number, maximum: number) =>
  Math.max(0, Math.min(value, maximum))

export const getCommentRange = (
  source: string,
  selectionFrom: number,
  selectionTo: number,
) => {
  let from = clamp(Math.min(selectionFrom, selectionTo), source.length)
  let to = clamp(Math.max(selectionFrom, selectionTo), source.length)

  if (from === to) {
    const before = source.slice(0, from)
    const precedingBreaks = Array.from(before.matchAll(/\n[\t ]*\n/g))
    const precedingBreak = precedingBreaks.at(-1)
    const followingBreak = source.slice(to).match(/\n[\t ]*\n/)
    from = precedingBreak?.index === undefined
      ? 0
      : precedingBreak.index + precedingBreak[0].length
    to = followingBreak?.index === undefined
      ? source.length
      : to + followingBreak.index
  }

  while (from < to && /\s/.test(source[from])) from += 1
  while (to > from && /\s/.test(source[to - 1])) to -= 1

  return { from, to, quote: source.slice(from, to) }
}

export const createCommentAnchor = (
  text: Y.Text,
  from: number,
  to: number,
): CommentAnchor => ({
  version: 1,
  start: encodeBytes(Y.encodeRelativePosition(
    Y.createRelativePositionFromTypeIndex(text, from, 0),
  )),
  end: encodeBytes(Y.encodeRelativePosition(
    Y.createRelativePositionFromTypeIndex(text, to, -1),
  )),
  quote: text.toString().slice(from, to),
})

const getLineNumber = (source: string, offset: number) =>
  source.slice(0, offset).split('\n').length

export const resolveCommentAnchor = (
  document: Y.Doc,
  text: Y.Text,
  anchor: CommentAnchor,
  options: { recoverQuote?: boolean } = {},
): CommentSourceRange | null => {
  try {
    const start = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(decodeBytes(anchor.start)),
      document,
    )
    const end = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(decodeBytes(anchor.end)),
      document,
    )
    if (!start || !end || start.type !== text || end.type !== text) return null

    const source = text.toString()
    const from = Math.min(start.index, end.index)
    const to = Math.max(start.index, end.index)
    const quote = source.slice(from, to)
    if ((from === to || !quote.trim()) && options.recoverQuote !== false) {
      const restoredFrom = anchor.quote ? source.indexOf(anchor.quote) : -1
      const quoteIsUnique = restoredFrom >= 0 &&
        source.indexOf(anchor.quote, restoredFrom + 1) === -1
      if (quoteIsUnique) {
        const restoredTo = restoredFrom + anchor.quote.length
        return {
          from: restoredFrom,
          to: restoredTo,
          quote: anchor.quote,
          startLine: getLineNumber(source, restoredFrom),
          endLine: getLineNumber(source, Math.max(restoredFrom, restoredTo - 1)),
          orphaned: false,
        }
      }
    }
    return {
      from,
      to,
      quote,
      startLine: getLineNumber(source, from),
      endLine: getLineNumber(source, Math.max(from, to - 1)),
      orphaned: from === to || !quote.trim(),
    }
  } catch {
    return null
  }
}