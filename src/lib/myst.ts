import DOMPurify from 'dompurify'
import type { DirectiveData, DirectiveSpec, GenericNode } from 'myst-common'
import { mystParser } from 'myst-parser'
import { State, formatHtml, mystToHast, transform } from 'myst-to-html'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'

export interface MystRenderResult {
  html: string
  error: string | null
  editableBlocks: MystEditableBlock[]
}

export interface MystEditableBlock {
  id: string
  kind: 'heading' | 'paragraph'
  from: number
  to: number
  value: string
}

interface MystRenderOptions {
  assetBaseUrl?: string
}

interface ProtectedHtmlBlock {
  html: string
  token: string
}

const rawHtmlBlockStart = /^(?: {0,3})<(div|table|details|figure|section|aside|header|footer|nav)\b[^>]*>/gim

const showPreviewSourceContent = (html: string) => {
  if (!/^\s*<div\b[^>]*class=["'][^"']*\bpublication-data-source\b/i.test(html)) {
    return html
  }
  return html.replace(/^(\s*<div\b)([^>]*)(>)/i, (_match, start, attributes, end) => {
    const visibleAttributes = String(attributes)
      .replace(/\s+hidden(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')
      .replace(/\s+aria-hidden=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    return `${start}${visibleAttributes}${end}`
  })
}

const maskSourceCharacters = (source: string, token = '') => {
  let tokenIndex = 0
  return source.replace(/[^\r\n]/g, () => token[tokenIndex++] ?? ' ')
}

const createProtectedHtmlToken = (
  source: string,
  usedTokens: Set<string>,
  initialIndex: number,
) => {
  let index = initialIndex
  let token = `D${index.toString(36)}X`
  while (source.includes(token) || usedTokens.has(token)) {
    index += 1
    token = `D${index.toString(36)}X`
  }
  return token
}

const protectRawHtmlBlocks = (source: string) => {
  const blocks: ProtectedHtmlBlock[] = []
  const usedTokens = new Set<string>()
  let cursor = 0
  let protectedSource = ''
  rawHtmlBlockStart.lastIndex = 0

  for (let start = rawHtmlBlockStart.exec(source); start; start = rawHtmlBlockStart.exec(source)) {
    if (start.index < cursor) continue
    const tagName = start[1].toLowerCase()
    const matchingTag = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi')
    matchingTag.lastIndex = start.index
    let depth = 0
    let blockEnd = -1

    for (let tag = matchingTag.exec(source); tag; tag = matchingTag.exec(source)) {
      if (/^<\//.test(tag[0])) depth -= 1
      else if (!/\/>$/.test(tag[0])) depth += 1
      if (depth === 0) {
        blockEnd = matchingTag.lastIndex
        break
      }
    }
    if (blockEnd < 0) continue

    const token = createProtectedHtmlToken(source, usedTokens, blocks.length)
    usedTokens.add(token)
    const rawBlock = source.slice(start.index, blockEnd)
    protectedSource += source.slice(cursor, start.index) +
      maskSourceCharacters(rawBlock, token)
    blocks.push({
      token,
      html: showPreviewSourceContent(rawBlock),
    })
    cursor = blockEnd
    rawHtmlBlockStart.lastIndex = blockEnd
  }

  return {
    source: protectedSource + source.slice(cursor),
    blocks,
  }
}

const restoreRawHtmlBlocks = (html: string, blocks: ProtectedHtmlBlock[]) =>
  blocks.reduce(
    (current, block) => current
      .replace(new RegExp(`<p>\\s*${block.token}\\s*</p>`, 'g'), block.html)
      .replaceAll(block.token, block.html),
    html,
  )

const preparePreviewSource = (source: string) => source.replace(
  /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
  (frontmatter) => maskSourceCharacters(frontmatter),
)

interface PreviewTreeNode {
  type?: string
  value?: string
  title?: string
  children?: PreviewTreeNode[]
  position?: {
    start?: { line?: number; column?: number }
    end?: { line?: number; column?: number }
  }
  data?: {
    hProperties?: Record<string, unknown>
  }
}

const getSourceLineStarts = (source: string) => {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

const getNodeTextRange = (
  node: PreviewTreeNode,
  value: string,
  source: string,
  lineStarts: number[],
) => {
  const startLine = node.position?.start?.line
  const endLine = node.position?.end?.line
  if (
    typeof startLine !== 'number' ||
    typeof endLine !== 'number' ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > lineStarts.length
  ) return null

  const blockFrom = lineStarts[startLine - 1]
  const blockTo = endLine < lineStarts.length ? lineStarts[endLine] : source.length
  const blockSource = source.slice(blockFrom, blockTo).replace(/\r?\n$/, '')
  const headingPrefix = node.type === 'heading'
    ? blockSource.match(/^ {0,3}#{1,6}[\t ]+/)?.[0]
    : undefined
  if (node.type === 'heading' && !headingPrefix) return null

  const searchFrom = headingPrefix?.length ?? 0
  const valueFrom = blockSource.indexOf(value, searchFrom)
  if (valueFrom < 0) return null

  const before = blockSource.slice(0, valueFrom)
  const after = blockSource.slice(valueFrom + value.length)
  const hasValidSyntax = node.type === 'heading'
    ? before === headingPrefix && /^(?:[\t ]+#+[\t ]*)?$/.test(after)
    : /^ {0,3}$/.test(before) && /^[\t ]*$/.test(after)
  if (!hasValidSyntax) return null

  return {
    from: blockFrom + valueFrom,
    to: blockFrom + valueFrom + value.length,
  }
}

const prepareEditableBlocks = (
  source: string,
  editableBlocks: MystEditableBlock[],
) => (tree: PreviewTreeNode) => {
  const lineStarts = getSourceLineStarts(source)
  tree.children?.forEach((node) => {
    if (node.type !== 'heading' && node.type !== 'paragraph') return
    if (node.children?.length !== 1 || node.children[0].type !== 'text') return

    const text = node.children[0]
    const range = typeof text.value === 'string'
      ? getNodeTextRange(node, text.value, source, lineStarts)
      : null
    if (
      !range ||
      typeof text.value !== 'string' ||
      source.slice(range.from, range.to) !== text.value
    ) return

    const block: MystEditableBlock = {
      id: `myst-editable-${editableBlocks.length}`,
      kind: node.type,
      from: range.from,
      to: range.to,
      value: text.value,
    }
    editableBlocks.push(block)
    node.data = {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        'data-myst-edit-id': block.id,
      },
    }
  })
}

const directiveBody = (data: DirectiveData) =>
  Array.isArray(data.body) ? data.body as GenericNode[] : []

const previewTabSetDirective: DirectiveSpec = {
  name: 'tab-set',
  body: { type: 'myst' },
  run: (data) => directiveBody(data),
}

const previewTabItemDirective: DirectiveSpec = {
  name: 'tab-item',
  arg: { type: String, required: true },
  body: { type: 'myst' },
  run: (data) => [{
    type: 'heading',
    depth: 3,
    children: [{
      type: 'text',
      value: typeof data.arg === 'string' ? data.arg : 'Tab',
    }],
  }, ...directiveBody(data)],
}

const previewAuthorshipExplorerDirective: DirectiveSpec = {
  name: 'authorship-explorer',
  options: {
    authors: { type: String },
    height: { type: String },
  },
  body: { type: 'myst' },
  run: () => [{
    type: 'blockquote',
    children: [{
      type: 'paragraph',
      children: [{
        type: 'strong',
        children: [{ type: 'text', value: 'Authorship roster' }],
      }, {
        type: 'break',
      }, {
        type: 'text',
        value: 'Generated from the repository metadata in the publication build.',
      }],
    }],
  }],
}

const prepareLightweightPreview = () => (tree: PreviewTreeNode) => {
  const visitNode = (node: PreviewTreeNode) => {
    if (node.type === 'iframe') {
      const placeholder = node.children?.find((child) => child.type === 'image')
      node.type = 'paragraph'
      node.children = placeholder
        ? [placeholder]
        : [{
            type: 'text',
            value: node.title
              ? `${node.title} (interactive preview available in the publication build)`
              : 'Interactive preview available in the publication build',
          } as PreviewTreeNode]
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          className: ['iframe-preview'],
        },
      }
    }
    node.children?.forEach(visitNode)
  }
  visitNode(tree)
}

const resolvePreviewAssets = (html: string, assetBaseUrl?: string) => {
  if (!assetBaseUrl || typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const source = image.getAttribute('src')
    if (source && /^\.\.?\//.test(source)) {
      image.src = new URL(source, assetBaseUrl).toString()
    }
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
  })
  return template.innerHTML
}

export const renderMyst = (
  source: string,
  options: MystRenderOptions = {},
): MystRenderResult => {
  const editableBlocks: MystEditableBlock[] = []
  try {
    const protectedHtml = protectRawHtmlBlocks(preparePreviewSource(source))
    const pipeline = unified()
      .use(mystParser, {
        directives: [
          previewTabSetDirective,
          previewTabItemDirective,
          previewAuthorshipExplorerDirective,
        ],
      })
      .use(() => prepareEditableBlocks(protectedHtml.source, editableBlocks))
      .use(prepareLightweightPreview)
      .use(transform, new State())
      .use(mystToHast)
      .use(formatHtml)
      .use(rehypeStringify)
    const file = pipeline.processSync(protectedHtml.source)

    return {
      html: resolvePreviewAssets(
        DOMPurify.sanitize(restoreRawHtmlBlocks(String(file), protectedHtml.blocks)),
        options.assetBaseUrl,
      ),
      error: null,
      editableBlocks,
    }
  } catch (error) {
    return {
      html: '',
      error: error instanceof Error ? error.message : 'The preview could not be rendered.',
      editableBlocks: [],
    }
  }
}