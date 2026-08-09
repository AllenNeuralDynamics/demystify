import DOMPurify from 'dompurify'
import type { DirectiveData, DirectiveSpec, GenericNode } from 'myst-common'
import { mystParser } from 'myst-parser'
import { State, formatHtml, mystToHast, transform } from 'myst-to-html'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'
import {
  loadAuthorshipMetadataSource,
  type AuthorshipContributorMetadata,
} from './authorshipMetadata'
import { tryParseBibliography, type PaperReference } from './references'

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
  inline: MystEditableInline[]
}

export type MystEditableInline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'emphasis'; children: MystEditableInline[] }
  | { type: 'inlineCode'; value: string }
  | { type: 'link'; url: string; title?: string; children: MystEditableInline[] }
  | { type: 'break' }
  | {
      type: 'citation'
      keys: string[]
      style: 'parenthetical' | 'narrative'
      prefix?: string
      suffix?: string
    }

interface MystRenderOptions {
  assetBaseUrl?: string
  bibliography?: string
  projectFiles?: Record<string, string>
  sourcePath?: string
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
  name?: string
  kind?: string
  value?: string
  title?: string
  label?: string
  identifier?: string
  prefix?: string
  suffix?: string
  partial?: string
  url?: string
  children?: PreviewTreeNode[]
  position?: {
    start?: { line?: number; column?: number }
    end?: { line?: number; column?: number }
  }
  data?: {
    hProperties?: Record<string, unknown>
  }
}

interface PreviewHtmlNode {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: PreviewHtmlNode[]
}

const citationAuthor = (reference: PaperReference) => {
  const names = reference.authors
    .map((author) => author.family || author.literal)
    .filter((name): name is string => Boolean(name))
  if (!names.length) return reference.key
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} et al.`
}

const citationLabel = (node: PreviewTreeNode, reference: PaperReference) => {
  if (node.partial === 'author') return citationAuthor(reference)
  if (node.partial === 'year') return String(reference.year ?? 'n.d.')
  return node.kind === 'narrative'
    ? `${citationAuthor(reference)} (${reference.year ?? 'n.d.'})`
    : `${citationAuthor(reference)}, ${reference.year ?? 'n.d.'}`
}

const citationLink = (node: PreviewTreeNode, reference: PaperReference): PreviewTreeNode => ({
  type: 'link',
  url: reference.doi ? `https://doi.org/${reference.doi}` : reference.url ?? '#references',
  children: [{ type: 'text', value: citationLabel(node, reference) }],
  data: {
    hProperties: {
      className: ['myst-citation'],
      'data-citation-key': reference.key,
    },
  },
})

const preparePreviewCitations = (
  bibliography: string,
) => (tree: PreviewTreeNode) => {
  const parsed = tryParseBibliography(bibliography)
  if (parsed.error) return
  const references = new Map<string, PaperReference>(
    parsed.references.map((reference): [string, PaperReference] => [
      reference.key.toLowerCase(),
      reference,
    ]),
  )
  const citedKeys: string[] = []

  const resolveCitation = (node: PreviewTreeNode) => {
    const key = node.identifier || node.label
    const lookupKey = key?.toLowerCase()
    const reference = lookupKey ? references.get(lookupKey) : undefined
    if (!reference || !lookupKey) {
      return [{ type: 'text', value: key ? `[missing: ${key}]` : '[missing citation]' }]
    }
    if (!citedKeys.includes(lookupKey)) citedKeys.push(lookupKey)
    const link = citationLink(node, reference)
    const children: PreviewTreeNode[] = []
    if (node.prefix) children.push({ type: 'text', value: `${node.prefix} ` })
    children.push(link)
    if (node.suffix) children.push({ type: 'text', value: `, ${node.suffix}` })
    return children
  }

  const visitNode = (node: PreviewTreeNode) => {
    if (!node.children) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'cite') return resolveCitation(child)
      if (child.type === 'citeGroup') {
        const children = (child.children ?? []).flatMap((citation, index) => [
          ...(index ? [{ type: 'text', value: '; ' } as PreviewTreeNode] : []),
          ...resolveCitation(citation),
        ])
        return child.kind === 'parenthetical'
          ? [{ type: 'text', value: '(' }, ...children, { type: 'text', value: ')' }]
          : children
      }
      visitNode(child)
      return [child]
    })
  }
  visitNode(tree)

  if (!citedKeys.length || !tree.children) return
  tree.children.push({
    type: 'heading',
    depth: 2,
    identifier: 'references',
    children: [{ type: 'text', value: 'References' }],
  } as PreviewTreeNode, {
    type: 'list',
    ordered: true,
    spread: false,
    children: citedKeys.flatMap((key) => {
      const reference = references.get(key)
      if (!reference) return []
      const author = reference.authors.map((name) => [name.family, name.given]
        .filter(Boolean).join(', ')).join('; ') || 'Unknown author'
      const details = [
        author,
        reference.year ? `(${reference.year})` : '(n.d.)',
        reference.title,
        reference.containerTitle,
      ].filter(Boolean).join('. ')
      const referenceContent: PreviewTreeNode = reference.doi || reference.url
        ? {
            type: 'link',
            url: reference.doi ? `https://doi.org/${reference.doi}` : reference.url ?? undefined,
            children: [{ type: 'text', value: details }],
            data: { hProperties: { className: ['myst-reference'] } },
          }
        : { type: 'text', value: details }
      return [{
        type: 'listItem',
        spread: false,
        children: [{
          type: 'paragraph',
          children: [referenceContent],
        }],
      } as PreviewTreeNode]
    }),
  } as PreviewTreeNode)
}

const getSourceLineStarts = (source: string) => {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

const getNodeLineRange = (node: PreviewTreeNode): { startLine: number; endLine: number } | null => {
  const startLine = node.position?.start?.line
  const endLine = node.position?.end?.line
  if (typeof startLine === 'number' && typeof endLine === 'number') {
    return { startLine, endLine }
  }
  const childRanges = (node.children ?? [])
    .map(getNodeLineRange)
    .filter((range): range is { startLine: number; endLine: number } => Boolean(range))
  if (!childRanges.length) return null
  return {
    startLine: Math.min(...childRanges.map((range) => range.startLine)),
    endLine: Math.max(...childRanges.map((range) => range.endLine)),
  }
}

const getNodeContentRange = (
  node: PreviewTreeNode,
  source: string,
  lineStarts: number[],
) => {
  const lineRange = getNodeLineRange(node)
  const startLine = lineRange?.startLine
  const endLine = lineRange?.endLine
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

  if (node.type === 'heading') {
    const closing = blockSource.match(/[\t ]+#+[\t ]*$/)?.[0] ?? ''
    const from = blockFrom + (headingPrefix?.length ?? 0)
    const to = blockFrom + blockSource.length - closing.length
    return to > from ? { from, to } : null
  }

  if (!/^ {0,3}\S/.test(blockSource)) return null
  const structuralPrefix = blockSource.match(
    /^(?: {0,3}>[\t ]?)*(?: {0,3}(?:[-+*]|\d{1,9}[.)])[\t ]+(?:\[[ xX]\][\t ]+)?)?/,
  )?.[0] ?? ''
  if (structuralPrefix && blockSource.includes('\n')) return null
  const indentation = structuralPrefix.length || (blockSource.match(/^ {0,3}/)?.[0].length ?? 0)
  return {
    from: blockFrom + indentation,
    to: blockFrom + blockSource.length,
  }
}

const parseEditableInline = (
  nodes: PreviewTreeNode[] | undefined,
): MystEditableInline[] | null => {
  if (!nodes) return null
  const parsed: MystEditableInline[] = []
  for (const node of nodes) {
    if (node.type === 'text' && typeof node.value === 'string') {
      parsed.push({ type: 'text', value: node.value })
      continue
    }
    if (node.type === 'strong' || node.type === 'emphasis') {
      const children = parseEditableInline(node.children)
      if (!children) return null
      parsed.push({ type: node.type, children })
      continue
    }
    if (node.type === 'inlineCode' && typeof node.value === 'string') {
      parsed.push({ type: 'inlineCode', value: node.value })
      continue
    }
    if (node.type === 'link' && typeof node.url === 'string') {
      const children = parseEditableInline(node.children)
      if (!children) return null
      parsed.push({
        type: 'link',
        url: node.url,
        ...(node.title ? { title: node.title } : {}),
        children,
      })
      continue
    }
    if (node.type === 'break') {
      parsed.push({ type: 'break' })
      continue
    }
    if (node.type === 'mystRole' && node.name?.startsWith('cite:')) {
      const children = parseEditableInline(node.children)
      const citation = children?.length === 1 && children[0].type === 'citation'
        ? children[0]
        : null
      const keys = node.value?.split(';').map((key) => key.trim()
        .replace(/^\{[^}]*\}/, '')
        .replace(/\{[^}]*\}$/, '')
        .trim()).filter(Boolean) ?? []
      if (!citation || keys.length !== citation.keys.length) return null
      parsed.push({ ...citation, keys })
      continue
    }
    if (node.type === 'cite' && !node.partial) {
      const key = node.identifier || node.label
      if (!key || (node.kind !== 'parenthetical' && node.kind !== 'narrative')) return null
      parsed.push({
        type: 'citation',
        keys: [key],
        style: node.kind,
        ...(node.prefix ? { prefix: node.prefix } : {}),
        ...(node.suffix ? { suffix: node.suffix } : {}),
      })
      continue
    }
    if (
      node.type === 'citeGroup' &&
      (node.kind === 'parenthetical' || node.kind === 'narrative')
    ) {
      const citations = node.children ?? []
      const keys = citations.map((citation, index) =>
        !citation.partial &&
        (!citation.prefix || index === 0) &&
        (!citation.suffix || index === citations.length - 1)
          ? citation.identifier || citation.label
          : undefined)
      if (!keys.length || keys.some((key) => !key)) return null
      parsed.push({
        type: 'citation',
        keys: keys as string[],
        style: node.kind,
        ...(citations[0]?.prefix ? { prefix: citations[0].prefix } : {}),
        ...(citations.at(-1)?.suffix ? { suffix: citations.at(-1)?.suffix } : {}),
      })
      continue
    }
    return null
  }
  return parsed
}

const prepareEditableBlocks = (
  source: string,
  editableBlocks: MystEditableBlock[],
  protectedTokens: Set<string>,
) => (tree: PreviewTreeNode) => {
  const lineStarts = getSourceLineStarts(source)
  const editableContainers = new Set([
    'root',
    'list',
    'listItem',
    'blockquote',
    'mystDirective',
    'mystDirectiveBody',
    'admonition',
    'caption',
    'container',
  ])
  const visitNode = (node: PreviewTreeNode, supportedContainer: boolean) => {
    if (supportedContainer && (node.type === 'heading' || node.type === 'paragraph')) {
      const range = getNodeContentRange(node, source, lineStarts)
      const inline = parseEditableInline(node.children)
      if (range && inline?.length) {
        const value = source.slice(range.from, range.to)
        if (!Array.from(protectedTokens).some((token) => value.includes(token))) {
          const block: MystEditableBlock = {
            id: `myst-editable-${editableBlocks.length}`,
            kind: node.type,
            from: range.from,
            to: range.to,
            value,
            inline,
          }
          editableBlocks.push(block)
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              'data-myst-edit-id': block.id,
            },
          }
        }
      }
    }
    const childContainerSupported = supportedContainer && editableContainers.has(node.type ?? '')
    node.children?.forEach((child) => visitNode(child, childContainerSupported))
  }
  visitNode(tree, true)
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

const getDirectiveOption = (
  data: DirectiveData,
  name: string,
  fallback: string,
) => {
  const value = data.options?.[name]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

const loadAuthorshipDataset = (
  pathValue: string,
  label: string,
  options: MystRenderOptions,
) => loadAuthorshipMetadataSource(
  pathValue,
  label,
  options.sourcePath ?? 'manuscript.md',
  options.projectFiles ?? {},
)

const contributorPreviewChildren = (contributor: AuthorshipContributorMetadata): GenericNode[] => {
  const extraRoles = Math.max(0, contributor.roles.length - 3)
  const roleSummary = contributor.roles.length
    ? `${contributor.roles.slice(0, 3).join(', ')}${extraRoles ? ` +${extraRoles} roles` : ''}`
    : ''
  const details = [
    roleSummary,
    contributor.affiliations.slice(0, 1).join(''),
  ].filter(Boolean)
  return [{
    type: 'strong',
    children: [{
      type: 'text',
      value: `${contributor.name}${contributor.corresponding ? ' (corresponding)' : ''}`,
    }],
  }, ...(details.length
    ? [{
        type: 'text',
        value: `: ${details.join(' | ')}`,
      } as GenericNode]
    : [])]
}

const authorshipPreviewNodes = (
  data: DirectiveData,
  options: MystRenderOptions,
): GenericNode[] => {
  const contributorCountLabel = (count: number) =>
    `${count} contributor${count === 1 ? '' : 's'}`
  const datasets = [loadAuthorshipDataset(
    getDirectiveOption(data, 'authors', './authors.yml'),
    'Contributors',
    options,
  )]
  const alternatePath = getDirectiveOption(data, 'authors-alt', '')
  if (alternatePath) {
    datasets.push(loadAuthorshipDataset(
      alternatePath,
      getDirectiveOption(data, 'alt-label', 'Real contributors'),
      options,
    ))
  }
  const secondAlternatePath = getDirectiveOption(data, 'authors-alt2', '')
  if (secondAlternatePath) {
    datasets.push(loadAuthorshipDataset(
      secondAlternatePath,
      getDirectiveOption(data, 'alt2-label', 'Large team'),
      options,
    ))
  }

  const primary = datasets[0]
  const roleCount = new Set(primary.contributors.flatMap((contributor) => contributor.roles)).size
  const affiliationCount = new Set(
    primary.contributors.flatMap((contributor) => contributor.affiliations),
  ).size
  const summary = [
    contributorCountLabel(primary.contributors.length),
    ...(roleCount ? [`${roleCount} CRediT role${roleCount === 1 ? '' : 's'}`] : []),
    ...(affiliationCount
      ? [`${affiliationCount} affiliation${affiliationCount === 1 ? '' : 's'}`]
      : []),
  ].join(' | ')
  const previewLimit = 12
  const visibleContributors = primary.contributors.slice(0, previewLimit)
  const hiddenCount = primary.contributors.length - visibleContributors.length
  const children: GenericNode[] = [{
    type: 'paragraph',
    children: [{
      type: 'strong',
      children: [{ type: 'text', value: 'Authorship roster' }],
    }, { type: 'break' }, {
      type: 'text',
      value: primary.error ?? summary,
    }],
  }]
  if (visibleContributors.length) {
    children.push({
      type: 'list',
      ordered: false,
      children: visibleContributors.map((contributor) => ({
        type: 'listItem',
        children: [{
          type: 'paragraph',
          children: contributorPreviewChildren(contributor),
        }],
      })),
    })
  }
  if (hiddenCount > 0) {
    children.push({
      type: 'paragraph',
      children: [{ type: 'text', value: `And ${hiddenCount} more contributors.` }],
    })
  }
  if (datasets.length > 1) {
    children.push({
      type: 'paragraph',
      children: [{
        type: 'text',
        value: datasets.slice(1).map((dataset) => dataset.error
          ? `${dataset.label}: ${dataset.error}`
          : `${dataset.label}: ${contributorCountLabel(dataset.contributors.length)}`).join(' | '),
      }],
    })
  }
  if (primary.path && !primary.error) {
    children.push({
      type: 'paragraph',
      children: [{
        type: 'text',
        value: `Source: ${primary.path}. Interactive views are available in the publication build.`,
      }],
    })
  }
  return [{
    type: 'blockquote',
    data: { hProperties: { className: ['authorship-preview'] } },
    children,
  }]
}

const createPreviewAuthorshipExplorerDirective = (
  options: MystRenderOptions,
): DirectiveSpec => ({
  name: 'authorship-explorer',
  options: {
    authors: { type: String },
    'authors-alt': { type: String },
    'alt-label': { type: String },
    'authors-alt2': { type: String },
    'alt2-label': { type: String },
    height: { type: String },
  },
  body: { type: 'myst' },
  run: (data) => authorshipPreviewNodes(data, options),
})

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

const prepareFigureCaptions = () => (tree: PreviewHtmlNode) => {
  const visitNode = (node: PreviewHtmlNode) => {
    if (node.type === 'element' && node.tagName === 'figure' && node.children) {
      const paragraphIndexes = node.children.flatMap((child, index) => {
        const className = child.properties?.className
        const classes = Array.isArray(className) ? className : [className]
        return child.type === 'element' &&
          child.tagName === 'p' &&
          !classes.includes('iframe-preview')
          ? [index]
          : []
      })
      const existingCaptionIndex = node.children.findIndex((child) =>
        child.type === 'element' && child.tagName === 'figcaption')
      if (paragraphIndexes.length && existingCaptionIndex >= 0) {
        const existingCaption = node.children[existingCaptionIndex]
        const captionParagraphs = paragraphIndexes.map((index) => node.children?.[index])
          .filter((child): child is PreviewHtmlNode => Boolean(child))
        existingCaption.children = [
          ...(existingCaption.children ?? []),
          ...captionParagraphs,
        ]
        const paragraphIndexSet = new Set(paragraphIndexes)
        node.children = node.children.filter((_child, index) => !paragraphIndexSet.has(index))
      } else if (paragraphIndexes.length === 1) {
        const caption = node.children[paragraphIndexes[0]]
        caption.tagName = 'figcaption'
      } else if (paragraphIndexes.length > 1) {
        const captions = paragraphIndexes.map((index) => node.children?.[index])
          .filter((child): child is PreviewHtmlNode => Boolean(child))
        const firstCaption = paragraphIndexes[0]
        const paragraphIndexSet = new Set(paragraphIndexes)
        node.children = node.children.flatMap((child, index) => {
          if (index === firstCaption) {
            return [{
              type: 'element',
              tagName: 'figcaption',
              properties: {},
              children: captions,
            }]
          }
          return paragraphIndexSet.has(index) ? [] : [child]
        })
      }
    }
    node.children?.forEach(visitNode)
  }
  visitNode(tree)
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
          createPreviewAuthorshipExplorerDirective(options),
        ],
      })
      .use(() => prepareEditableBlocks(
        protectedHtml.source,
        editableBlocks,
        new Set(protectedHtml.blocks.map((block) => block.token)),
      ))
      .use(() => preparePreviewCitations(options.bibliography ?? ''))
      .use(prepareLightweightPreview)
      .use(transform, new State())
      .use(mystToHast)
      .use(prepareFigureCaptions)
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