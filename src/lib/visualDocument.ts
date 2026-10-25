import { diffChars } from 'diff'
import { Fragment, Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { mystParser } from 'myst-parser'
import { unified } from 'unified'
import { getTextReplacement, type TextReplacement } from './collaborativeTextEdit'
import { renderMyst, type MystEditableBlock } from './myst'
import { detectCitationSyntax, type CitationSyntax } from './references'
import {
  createVisualInlineDocument,
  serializeVisualInlineDocument,
  visualInlineSchema,
} from './visualInline'

const sourceAttributes = {
  before: { default: '\n\n' },
  prefix: { default: '' },
  suffix: { default: '' },
  original: { default: null },
  originalContent: { default: null },
}

const isTargetLabel = (source: string) => /^\([^\r\n)]+\)=\s*$/.test(source.trim())

const renderedBlockIdentity = (element: Element) => {
  const content = element.cloneNode(true) as Element
  content.querySelectorAll('.caption-number, .myst-reference, .myst-citation, [data-footnote-ref]')
    .forEach((generated) => generated.remove())
  return JSON.stringify({ tag: element.tagName,
    text: content.textContent?.replace(/\s+/g, ' ').trim(),
    math: Array.from(element.querySelectorAll('.math-display, .math-inline'), (math) => math.textContent),
    images: Array.from(element.querySelectorAll('img'), (image) => image.getAttribute('src')),
  })
}

export const visualDocumentSchema = new Schema({
  nodes: visualInlineSchema.spec.nodes
    .update('doc', { content: 'block+', attrs: { trailing: { default: '' }, appendixHtml: { default: '' } } })
    .addBefore('text', 'paragraph', {
      group: 'block',
      content: 'inline*',
      attrs: sourceAttributes,
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    })
    .addBefore('text', 'heading', {
      group: 'block',
      content: 'inline*',
      defining: true,
      attrs: { ...sourceAttributes, level: { default: 2 } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    })
    .addBefore('text', 'myst_container', {
      group: 'block', content: 'block+', isolating: true,
      attrs: { ...sourceAttributes, html: { default: '' } },
      toDOM: () => ['div', { class: 'visual-myst-container' }, 0],
    })
    .addBefore('text', 'bullet_list', {
      group: 'block', content: 'list_item+',
      attrs: sourceAttributes, toDOM: () => ['ul', 0],
    })
    .addBefore('text', 'ordered_list', {
      group: 'block', content: 'list_item+',
      attrs: { ...sourceAttributes, order: { default: 1 } },
      toDOM: (node) => ['ol', { start: node.attrs.order }, 0],
    })
    .addBefore('text', 'list_item', {
      content: 'paragraph block*', defining: true,
      attrs: { ...sourceAttributes, before: { default: '\n' }, marker: { default: '- ' } },
      toDOM: () => ['li', 0],
    })
    .addBefore('text', 'blockquote', {
      group: 'block', content: 'block+', defining: true,
      attrs: sourceAttributes, toDOM: () => ['blockquote', 0],
    })
    .addBefore('text', 'protected_block', {
      group: 'block',
      atom: true,
      isolating: true,
      attrs: {
        before: { default: '' },
        source: { default: '' },
        html: { default: '' },
      },
      toDOM: () => ['div', { class: 'visual-protected-block', contenteditable: 'false' }],
    }),
  marks: visualInlineSchema.spec.marks,
})

interface SourceNode {
  type?: string
  depth?: number
  ordered?: boolean
  start?: number
  position?: {
    start?: { line?: number }
    end?: { line?: number }
  }
  children?: SourceNode[]
}

export interface VisualDocumentOptions {
  assetBaseUrl?: string
  bibliography?: string
  citationSyntax?: CitationSyntax
  projectFiles?: Record<string, string>
  sourcePath?: string
}

const blockContent = (block: MystEditableBlock, options: VisualDocumentOptions) => {
  const inline = createVisualInlineDocument(
    block.inline,
    options.bibliography ?? '',
    detectCitationSyntax(block.value, options.citationSyntax),
  )
  return Fragment.fromJSON(visualDocumentSchema, inline.content.toJSON())
}

export const createVisualDocument = (source: string, options: VisualDocumentOptions = {}) => {
  const rendered = renderMyst(source, options)
  if (rendered.error) throw new Error(rendered.error)
  const htmlTemplate = document.createElement('template')
  htmlTemplate.innerHTML = rendered.html
  const htmlRoots = Array.from(htmlTemplate.content.children)
  const rootIndexes = new Map(htmlRoots.map((element, index) => [element, index]))
  const renderedElements = new Map(Array.from(htmlTemplate.content.querySelectorAll<HTMLElement>(
    '[data-myst-edit-id]',
  )).map((element) => [element.dataset.mystEditId, element]))
  const globalHtml = new WeakMap<SourceNode, string>()
  const standaloneHtml = new WeakMap<SourceNode, string>()
  let htmlCursor = 0
  const tree = unified().use(mystParser).parse(source) as SourceNode
  const lineStarts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1)
  }
  const getLines = (child: SourceNode): { first: number; last: number } | null => {
    if (child.position?.start?.line && child.position?.end?.line) {
      return { first: child.position.start.line, last: child.position.end.line }
    }
    const children = (child.children ?? []).map(getLines)
      .filter((range): range is { first: number; last: number } => range !== null)
    return children.length ? { first: children[0].first, last: children.at(-1)!.last } : null
  }
  const getRange = (child: SourceNode) => {
    const lines = getLines(child)
    if (!lines) return null
    const { first: firstLine, last: lastLine } = lines
    const from = lineStarts[firstLine - 1]
    const lineEnd = lineStarts[lastLine] ?? source.length
    if (from === undefined) return null
    const raw = source.slice(from, lineEnd).replace(/\r?\n$/, '')
    return { from, to: from + raw.length, raw }
  }
  const editable = new Map(rendered.editableBlocks.map((block) => {
    const lineStart = source.lastIndexOf('\n', block.from - 1) + 1
    return [`${block.kind}:${lineStart}`, block]
  }))
  const htmlFor = (child: SourceNode, from: number, to: number) => {
    if (isTargetLabel(source.slice(from, to))) return ''
    const cached = globalHtml.get(child)
    if (cached !== undefined) return cached
    let local = standaloneHtml.get(child)
    if (local === undefined) {
      local = renderMyst(source.slice(from, to), options).html
      standaloneHtml.set(child, local)
    }
    const fragment = document.createElement('template')
    fragment.innerHTML = local
    const first = fragment.content.firstElementChild
    const firstEditable = rendered.editableBlocks.find((block) => block.from >= from && block.to <= to)
    const element = firstEditable ? renderedElements.get(firstEditable.id) : undefined
    const shell = first ? element?.closest(first.tagName.toLowerCase()) : null
    return shell?.outerHTML ?? first?.outerHTML ?? ''
  }
  for (const child of tree.children ?? []) {
    const range = getRange(child)
    if (!range || isTargetLabel(range.raw)) continue
    const firstEditable = rendered.editableBlocks.find((block) =>
      block.from >= range.from && block.to <= range.to)
    let root = firstEditable ? renderedElements.get(firstEditable.id) : undefined
    while (root?.parentElement) root = root.parentElement
    let index = root ? rootIndexes.get(root) : undefined
    if (index === undefined) {
      const fragment = document.createElement('template')
      const local = renderMyst(range.raw, options).html
      standaloneHtml.set(child, local)
      fragment.innerHTML = local
      const element = fragment.content.firstElementChild
      const identity = element ? renderedBlockIdentity(element) : null
      const found = identity ? htmlRoots.findIndex((candidate, position) =>
        position >= htmlCursor && renderedBlockIdentity(candidate) === identity) : -1
      if (found >= 0) index = found
    }
    if (index !== undefined && index >= htmlCursor) {
      globalHtml.set(child, htmlRoots[index].outerHTML)
      htmlCursor = index + 1
    }
  }
  const childTypes = new Set(['heading', 'paragraph', 'list', 'listItem', 'blockquote',
    'mystDirective', 'math', 'code', 'table', 'thematicBreak', 'html'])
  const childrenFor = (child: SourceNode): SourceNode[] => (child.children ?? [])
    .flatMap((nested) => childTypes.has(nested.type ?? '') ? [nested] : childrenFor(nested))
  const build = (child: SourceNode, before: string): ProseMirrorNode | null => {
    const range = getRange(child)
    if (!range) return null
    const { from, to, raw } = range
    const block = editable.get(`${child.type}:${from}`)
    if ((child.type === 'paragraph' || child.type === 'heading') && block) {
      const content = blockContent(block, options)
      return visualDocumentSchema.nodes[child.type].create({
        before,
        prefix: source.slice(from, block.from),
        suffix: source.slice(block.to, to),
        original: block.value,
        originalContent: JSON.stringify(content.toJSON()),
        ...(child.type === 'heading' ? { level: child.depth ?? 2 } : {}),
      }, content)
    }
    const nested = childrenFor(child).map((node) => ({ node, range: getRange(node) }))
      .filter((item): item is { node: SourceNode; range: { from: number; to: number; raw: string } } =>
        item.range !== null && item.range.from >= from && item.range.to <= to)
    if (nested.length && ['mystDirective', 'list', 'listItem', 'blockquote'].includes(child.type ?? '')) {
      const children: ProseMirrorNode[] = []
      let cursor = nested[0].range.from
      for (const item of nested) {
        if (item.range.from < cursor) continue
        const node = build(item.node, source.slice(cursor, item.range.from))
        if (node) children.push(node)
        cursor = item.range.to
      }
      const type = child.type === 'list'
        ? child.ordered ? 'ordered_list' : 'bullet_list'
        : child.type === 'listItem' ? 'list_item'
          : child.type === 'blockquote' ? 'blockquote' : 'myst_container'
      if (children.length && visualDocumentSchema.nodes[type].validContent(Fragment.from(children))) {
        return visualDocumentSchema.nodes[type].create({
          before, prefix: source.slice(from, nested[0].range.from), suffix: source.slice(cursor, to),
          original: raw, html: type === 'myst_container' ? htmlFor(child, from, to) : '',
          ...(type === 'ordered_list' ? { order: child.start ?? 1 } : {}),
          ...(type === 'list_item' ? { marker: raw.match(/^\s*(?:[-+*]|\d+[.)])\s+/)?.[0] ?? '- ' } : {}),
        }, children)
      }
    }
    return visualDocumentSchema.nodes.protected_block.create({ before, source: raw,
      html: htmlFor(child, from, to) })
  }
  const nodes: ProseMirrorNode[] = []
  let cursor = 0
  for (const child of tree.children ?? []) {
    const range = getRange(child)
    if (!range || range.from < cursor) continue
    const node = build(child, source.slice(cursor, range.from))
    if (node) nodes.push(node)
    const { to } = range
    cursor = to
  }
  if (!nodes.length) {
    nodes.push(visualDocumentSchema.nodes.paragraph.create({ before: '', original: source,
      originalContent: JSON.stringify(null) }))
    cursor = source.length
  }
  return visualDocumentSchema.nodes.doc.create({ trailing: source.slice(cursor),
    appendixHtml: htmlRoots.slice(htmlCursor).map((element) => element.outerHTML).join('') }, nodes)
}

const serializedBlocks = new WeakMap<ProseMirrorNode, string>()
export const serializeVisualBlock = (node: ProseMirrorNode): string => {
  const cached = serializedBlocks.get(node)
  if (cached !== undefined) return cached
  const source = serializeBlock(node)
  serializedBlocks.set(node, source)
  return source
}

const serializeBlock = (node: ProseMirrorNode): string => {
  if (node.type.name === 'protected_block') return String(node.attrs.source)
  if (!node.isTextblock) {
    let source = ''
    node.forEach((child) => { source += `${child.attrs.before}${serializeVisualBlock(child)}` })
    if (node.type.name === 'list_item' && node.attrs.original === null) {
      source = `${node.attrs.marker}${source.replace(/^\n+/, '')}`
    }
    return `${node.attrs.prefix}${source}${node.attrs.suffix}`
  }
  const unchanged = node.attrs.original !== null &&
    node.attrs.originalContent === JSON.stringify(node.content.toJSON())
  const body = unchanged ? String(node.attrs.original) : serializeVisualInlineDocument(node)
  const prefix = node.type.name === 'heading' && node.attrs.original === null
    ? `${'#'.repeat(node.attrs.level)} `
    : String(node.attrs.prefix)
  return `${prefix}${body}${node.attrs.suffix}`
}

export const serializeVisualDocument = (document: ProseMirrorNode) => {
  let source = ''
  document.forEach((node) => {
    source += `${node.attrs.before}${serializeVisualBlock(node)}`
  })
  return source + document.attrs.trailing
}

export const visualNodeSourceRange = (document: ProseMirrorNode, position: number) => {
  const node = document.nodeAt(position)
  if (!node) return null
  const resolved = document.resolve(position)
  let offset = 0
  for (let depth = 0; depth <= resolved.depth; depth += 1) {
    const parent = resolved.node(depth)
    if (depth > 0) {
      offset += String(parent.attrs.before).length + String(parent.attrs.prefix).length
      if (parent.type.name === 'list_item' && parent.attrs.original === null) {
        offset += String(parent.attrs.marker).length
      }
    }
    for (let index = 0; index < resolved.index(depth); index += 1) {
      const sibling = parent.child(index)
      offset += String(sibling.attrs.before).length + serializeVisualBlock(sibling).length
    }
  }
  const from = offset + String(node.attrs.before).length
  return { from, to: from + serializeVisualBlock(node).length }
}

export const getVisualDocumentChanges = (before: string, after: string): TextReplacement[] => {
  const replacement = getTextReplacement(before, after)
  if (!replacement) return []
  if (!replacement.before || !replacement.after) return [replacement]
  const changes: TextReplacement[] = []
  let position = 0
  let pending: TextReplacement | null = null
  for (const part of diffChars(before, after)) {
    if (!part.added && !part.removed) {
      if (pending) changes.push(pending)
      pending = null
      position += part.value.length
      continue
    }
    pending ??= { from: position, to: position, before: '', after: '' }
    if (part.removed) {
      pending.before += part.value
      position += part.value.length
      pending.to = position
    } else pending.after += part.value
  }
  if (pending) changes.push(pending)
  return changes
}

interface TextOffsetDiffs {
  toSource?: ReturnType<typeof diffChars>
  toVisual?: ReturnType<typeof diffChars>
}

const textOffsetDiffs = new WeakMap<ProseMirrorNode, TextOffsetDiffs>()

const mapTextOffset = (source: string, target: string, offset: number, association: number,
  node: ProseMirrorNode, direction: keyof TextOffsetDiffs) => {
  if (source === target) return Math.max(0, Math.min(source.length, offset))
  let cached = textOffsetDiffs.get(node)
  if (!cached) {
    cached = {}
    textOffsetDiffs.set(node, cached)
  }
  const parts = cached[direction] ??= diffChars(source, target)
  let sourceOffset = 0
  let targetOffset = 0
  for (const part of parts) {
    if (part.added) {
      targetOffset += part.value.length
    } else if (part.removed) {
      if (offset < sourceOffset + part.value.length ||
        (offset === sourceOffset && association < 0)) return targetOffset
      sourceOffset += part.value.length
    } else {
      if (offset < sourceOffset + part.value.length ||
        (offset === sourceOffset + part.value.length && association < 0)) {
        return targetOffset + Math.max(0, offset - sourceOffset)
      }
      sourceOffset += part.value.length
      targetOffset += part.value.length
    }
  }
  return targetOffset
}

interface VisualSourceBlock {
  node: ProseMirrorNode
  position: number
  from: number
  to: number
  body: string
  visible: string
}

const sourceBlocksCache = new WeakMap<ProseMirrorNode, VisualSourceBlock[]>()
const sourceBlocks = (document: ProseMirrorNode) => {
  const cached = sourceBlocksCache.get(document)
  if (cached) return cached
  const blocks: VisualSourceBlock[] = []
  let sourceOffset = 0
  const visit = (node: ProseMirrorNode, position: number) => {
    sourceOffset += String(node.attrs.before).length
    if (!node.isTextblock && !node.isAtom) {
      sourceOffset += String(node.attrs.prefix).length
      if (node.type.name === 'list_item' && node.attrs.original === null) sourceOffset += String(node.attrs.marker).length
      node.forEach((child, offset) => visit(child, position + 1 + offset))
      sourceOffset += String(node.attrs.suffix).length
      return
    }
    const source = serializeVisualBlock(node)
    const prefix = node.isAtom ? '' : node.type.name === 'heading' && node.attrs.original === null
      ? `${'#'.repeat(node.attrs.level)} ` : String(node.attrs.prefix)
    const suffix = node.isAtom ? '' : String(node.attrs.suffix)
    const body = source.slice(prefix.length, source.length - suffix.length)
    blocks.push({ node, position, from: sourceOffset + prefix.length,
      to: sourceOffset + source.length - suffix.length, body,
      visible: node.isAtom ? '' : node.textBetween(0, node.content.size, '', '\ufffc') })
    sourceOffset += source.length
  }
  document.forEach((node, position) => visit(node, position))
  sourceBlocksCache.set(document, blocks)
  return blocks
}

export const visualPositionToSource = (document: ProseMirrorNode, position: number) => {
  const blocks = sourceBlocks(document)
  const block = blocks.find((item) => position <= item.position + item.node.nodeSize) ?? blocks.at(-1)
  if (!block) return 0
  if (block.node.isAtom) return position > block.position ? block.to : block.from
  const local = Math.max(0, Math.min(block.node.content.size, position - block.position - 1))
  return block.from + mapTextOffset(block.visible, block.body, local, 1, block.node, 'toSource')
}

export const sourcePositionToVisual = (document: ProseMirrorNode, position: number, association = 1) => {
  const blocks = sourceBlocks(document)
  const block = blocks.find((item) => position <= item.to) ?? blocks.at(-1)
  if (!block) return 0
  if (block.node.isAtom) return block.position + (association > 0 ? block.node.nodeSize : 0)
  const local = Math.max(0, Math.min(block.body.length, position - block.from))
  return block.position + 1 + mapTextOffset(block.body, block.visible, local, association, block.node, 'toVisual')
}