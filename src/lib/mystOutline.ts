export interface MystOutlineEntry {
  id: string
  depth: number
  title: string
  from: number
  to: number
}

const cleanHeadingTitle = (value: string) => value
  .replace(/[\t ]+#+[\t ]*$/, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .trim()

export const getMystOutline = (source: string): MystOutlineEntry[] => {
  const entries: MystOutlineEntry[] = []
  const lines = source.split('\n')
  let offset = 0
  let fence: '`' | '~' | null = null
  let fenceLength = 0
  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) {
        fence = marker
        fenceLength = fenceMatch[1].length
      } else if (marker === fence && fenceMatch[1].length >= fenceLength) {
        fence = null
        fenceLength = 0
      }
    } else if (!fence) {
      const heading = line.match(/^ {0,3}(#{1,6})[\t ]+(.+?)$/)
      if (heading) {
        const title = cleanHeadingTitle(heading[2])
        const prefixLength = line.indexOf(heading[1]) + heading[1].length
        const titleStart = line.slice(prefixLength).search(/\S/) + prefixLength
        if (title) {
          entries.push({
            id: `outline-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            depth: heading[1].length,
            title,
            from: offset + titleStart,
            to: offset + line.length,
          })
        }
      }
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0)
  })
  return entries
}