import { Schema, type Mark, type Node as ProseMirrorNode } from 'prosemirror-model'
import type { MystEditableInline } from './myst'
import { tryParseBibliography, type CitationStyle, type PaperReference } from './references'

export const visualInlineSchema = new Schema({
  nodes: {
    doc: { content: 'inline*' },
    text: { group: 'inline' },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    citation: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        keys: { default: [] },
        style: { default: 'parenthetical' },
        label: { default: '' },
      },
      parseDOM: [{
        tag: 'span[data-visual-citation]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          return {
            keys: element.dataset.citationKeys?.split(';').filter(Boolean) ?? [],
            style: element.dataset.citationStyle ?? 'parenthetical',
            label: element.textContent ?? '',
          }
        },
      }],
      toDOM: (node) => ['span', {
        class: 'visual-citation-chip',
        'data-visual-citation': 'true',
        'data-citation-keys': (node.attrs.keys as string[]).join(';'),
        'data-citation-style': node.attrs.style,
        contenteditable: 'false',
        title: `Citation: ${(node.attrs.keys as string[]).join('; ')}`,
      }, node.attrs.label],
    },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM: () => ['strong', 0],
    },
    emphasis: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
      toDOM: () => ['em', 0],
    },
    code: {
      code: true,
      excludes: '_',
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
    link: {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [{
        tag: 'a[href]',
        getAttrs: (element) => element instanceof HTMLElement
          ? { href: element.getAttribute('href'), title: element.getAttribute('title') }
          : false,
      }],
      toDOM: (mark) => ['a', {
        href: mark.attrs.href,
        title: mark.attrs.title,
        rel: 'noreferrer',
      }, 0],
    },
  },
})

const authorYear = (reference: PaperReference, style: CitationStyle) => {
  const names = reference.authors
    .map((author) => author.family || author.literal)
    .filter((name): name is string => Boolean(name))
  const author = !names.length
    ? reference.key
    : names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} & ${names[1]}`
        : `${names[0]} et al.`
  const year = reference.year ?? 'n.d.'
  return style === 'narrative' ? `${author} (${year})` : `${author}, ${year}`
}

export const visualCitationLabel = (
  keys: string[],
  style: CitationStyle,
  bibliography: string,
) => {
  const references = new Map<string, PaperReference>(
    tryParseBibliography(bibliography).references
      .map((reference): [string, PaperReference] => [reference.key.toLowerCase(), reference]),
  )
  const labels = keys.map((key) => {
    const reference = references.get(key.toLowerCase())
    return reference ? authorYear(reference, style) : key
  })
  const joined = labels.join('; ')
  return style === 'parenthetical' ? `(${joined})` : joined
}

const toProseMirrorNodes = (
  inline: MystEditableInline[],
  bibliography: string,
  marks: Mark[] = [],
): ProseMirrorNode[] => inline.flatMap((node) => {
  if (node.type === 'text') {
    return node.value ? [visualInlineSchema.text(node.value, marks)] : []
  }
  if (node.type === 'strong' || node.type === 'emphasis') {
    const mark = visualInlineSchema.marks[node.type].create()
    return toProseMirrorNodes(node.children, bibliography, [...marks, mark])
  }
  if (node.type === 'inlineCode') {
    return node.value
      ? [visualInlineSchema.text(node.value, [visualInlineSchema.marks.code.create()])]
      : []
  }
  if (node.type === 'link') {
    const mark = visualInlineSchema.marks.link.create({ href: node.url, title: node.title ?? null })
    return toProseMirrorNodes(node.children, bibliography, [...marks, mark])
  }
  if (node.type === 'break') return [visualInlineSchema.nodes.hard_break.create()]
  if (node.type === 'citation') {
    return [visualInlineSchema.nodes.citation.create({
      keys: node.keys,
      style: node.style,
      label: visualCitationLabel(node.keys, node.style, bibliography),
    })]
  }
  return []
})

export const createVisualInlineDocument = (
  inline: MystEditableInline[],
  bibliography: string,
) => visualInlineSchema.nodes.doc.create(
  null,
  toProseMirrorNodes(inline, bibliography),
)

const escapeMystText = (value: string) => value.replace(/[\\`*_[\]{}@]/g, '\\$&')

const inlineCode = (value: string) => {
  const longestFence = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestFence + 1)
  return `${fence}${value}${fence}`
}

const openMark = (mark: Mark) => {
  if (mark.type === visualInlineSchema.marks.strong) return '**'
  if (mark.type === visualInlineSchema.marks.emphasis) return '*'
  if (mark.type === visualInlineSchema.marks.link) return '['
  return ''
}

const closeMark = (mark: Mark) => {
  if (mark.type === visualInlineSchema.marks.strong) return '**'
  if (mark.type === visualInlineSchema.marks.emphasis) return '*'
  if (mark.type === visualInlineSchema.marks.link) {
    const href = String(mark.attrs.href).replace(/\)/g, '%29')
    const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : ''
    return `](${href}${title})`
  }
  return ''
}

export const serializeVisualInlineDocument = (document: ProseMirrorNode) => {
  let source = ''
  let activeMarks: readonly Mark[] = []
  const closeTo = (count: number) => {
    for (let index = activeMarks.length - 1; index >= count; index -= 1) {
      source += closeMark(activeMarks[index])
    }
    activeMarks = activeMarks.slice(0, count)
  }
  document.forEach((node) => {
    if (node.isText) {
      const code = node.marks.find((mark) => mark.type === visualInlineSchema.marks.code)
      if (code) {
        closeTo(0)
        source += inlineCode(node.text ?? '')
        return
      }
      const desiredMarks = node.marks.filter((mark) => mark.type !== visualInlineSchema.marks.code)
      let shared = 0
      while (
        shared < activeMarks.length &&
        shared < desiredMarks.length &&
        activeMarks[shared].eq(desiredMarks[shared])
      ) shared += 1
      closeTo(shared)
      for (let index = shared; index < desiredMarks.length; index += 1) {
        source += openMark(desiredMarks[index])
      }
      activeMarks = desiredMarks
      source += escapeMystText(node.text ?? '')
    } else if (node.type === visualInlineSchema.nodes.hard_break) {
      closeTo(0)
      source += '  \n'
    } else if (node.type === visualInlineSchema.nodes.citation) {
      closeTo(0)
      const keys = node.attrs.keys as string[]
      const style = node.attrs.style === 'narrative' ? 't' : 'p'
      source += `{cite:${style}}\`${keys.join('; ')}\``
    }
  })
  closeTo(0)
  return source
}