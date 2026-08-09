import DOMPurify from 'dompurify'
import type { DirectiveData, DirectiveSpec, GenericNode } from 'myst-common'
import { mystParser } from 'myst-parser'
import { State, formatHtml, mystToHast, transform } from 'myst-to-html'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'

export interface MystRenderResult {
  html: string
  error: string | null
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

const protectRawHtmlBlocks = (source: string) => {
  const blocks: ProtectedHtmlBlock[] = []
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

    const token = `DEMYSTIFYRAWHTMLBLOCK${blocks.length}TOKEN`
    protectedSource += `${source.slice(cursor, start.index)}\n\n${token}\n\n`
    blocks.push({
      token,
      html: showPreviewSourceContent(source.slice(start.index, blockEnd)),
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

const preparePreviewSource = (source: string) => source
  .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  .replace(
    /^:::\{authorship-explorer\}[^\n]*\n[\s\S]*?^:::\s*$/gm,
    '> **Authorship roster**  \n> Generated from the repository metadata in the publication build.',
  )

interface PreviewTreeNode {
  type?: string
  title?: string
  children?: PreviewTreeNode[]
  data?: {
    hProperties?: Record<string, unknown>
  }
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
  try {
    const protectedHtml = protectRawHtmlBlocks(preparePreviewSource(source))
    const pipeline = unified()
      .use(mystParser, {
        directives: [previewTabSetDirective, previewTabItemDirective],
      })
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
    }
  } catch (error) {
    return {
      html: '',
      error: error instanceof Error ? error.message : 'The preview could not be rendered.',
    }
  }
}