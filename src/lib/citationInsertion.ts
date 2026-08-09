export const getCitationInsertion = (
  source: string,
  from: number,
  to: number,
  citation: string,
) => {
  const before = source[from - 1] ?? ''
  const after = source[to] ?? ''
  const atLineStart = from === 0 || before === '\n'
  const nextLine = source.slice(to).match(/^([^\n]*)/)?.[1] ?? ''
  const prefix = before && !/\s|[([{]/.test(before) ? ' ' : ''
  const suffix = atLineStart && /^ {0,3}#{1,6}[\t ]/.test(nextLine)
    ? '\n\n'
    : after && !/\s|[.,;:!?)}\]]/.test(after)
      ? ' '
      : ''

  return {
    text: `${prefix}${citation}${suffix}`,
    cursorOffset: prefix.length + citation.length + suffix.length,
  }
}