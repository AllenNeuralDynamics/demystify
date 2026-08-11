import { parse as parseBibtexFile } from '@citation-js/plugin-bibtex/lib/input/file.js'
import { parse as parseBibtexEntries } from '@citation-js/plugin-bibtex/lib/input/entries.js'
import { formatBibtex as mapBibtexEntries } from '@citation-js/plugin-bibtex/lib/output/entries.js'
import { format as formatBibtex } from '@citation-js/plugin-bibtex/lib/output/bibtex.js'

export interface CitationName {
  family?: string
  given?: string
  literal?: string
}

interface CitationData {
  id?: string
  'citation-key'?: string
  type?: string
  title?: string
  author?: CitationName[]
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string
  volume?: string | number
  issue?: string | number
  page?: string
  publisher?: string
  DOI?: string
  URL?: string
  ISBN?: string
  PMID?: string
  abstract?: string
}

export interface PaperReference {
  key: string
  title: string
  authors: CitationName[]
  year: number | null
  containerTitle: string | null
  doi: string | null
  url: string | null
  type: string
}

export interface PaperSearchResult {
  id: string
  title: string
  authors: CitationName[]
  year: number | null
  containerTitle: string | null
  doi: string | null
  url: string | null
  type: string
  volume?: string
  issue?: string
  page?: string
  publisher?: string
}

export interface AddReferenceResult {
  bibliography: string
  key: string
  added: boolean
}

export interface BibliographySourceEntry {
  key: string
  type: string
  raw: string
  from: number
  to: number
  reference: PaperReference | null
  doi: string | null
}

export interface BibliographyImportResult {
  bibliography: string
  importedKeys: string[]
  skippedKeys: string[]
  renamedKeys: Array<{ from: string; to: string }>
}

export type BibliographyEditResult = 'applied' | 'conflict' | 'unavailable'

export type CitationStyle = 'parenthetical' | 'narrative'
export type CitationSyntax = 'markdown' | 'role'

export interface CitationDetails {
  prefix?: string
  suffix?: string
}

export interface GeneratedReferenceEntry {
  id: string
  key: string
  doi: string | null
  bibtex: string
}

const normalizeDoi = (value: string | null | undefined) => value
  ?.trim()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  .replace(/^doi:\s*/i, '')
  .toLowerCase() || null

const parseCitationData = (source: string): CitationData[] => source.trim()
  ? parseBibtexEntries(parseBibtexFile(source)) as CitationData[]
  : []

interface BibtexSourceSpan {
  key: string
  type: string
  from: number
  to: number
}

const skipBibtexTrivia = (source: string, start: number) => {
  let index = start
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    if (source[index] !== '%') break
    const lineEnd = source.indexOf('\n', index)
    index = lineEnd === -1 ? source.length : lineEnd + 1
  }
  return index
}

const scanBibtexSource = (source: string): BibtexSourceSpan[] => {
  const spans: BibtexSourceSpan[] = []
  let index = 0
  while (index < source.length) {
    if (source[index] === '%') {
      index = skipBibtexTrivia(source, index)
      continue
    }
    if (source[index] !== '@') {
      index += 1
      continue
    }

    const from = index
    index = skipBibtexTrivia(source, index + 1)
    const typeStart = index
    while (/[A-Za-z0-9_:+-]/.test(source[index] ?? '')) index += 1
    const type = source.slice(typeStart, index).toLowerCase()
    index = skipBibtexTrivia(source, index)
    const open = source[index]
    if (open !== '{' && open !== '(') {
      const lineEnd = source.indexOf('\n', index)
      index = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }

    const closers = [open === '{' ? '}' : ')']
    index += 1
    const keyStart = skipBibtexTrivia(source, index)
    const comma = source.indexOf(',', keyStart)
    const key = comma === -1 ? '' : source.slice(keyStart, comma).trim()
    let inQuote = false
    let quoteBraceDepth = 0
    let escaped = false
    let inComment = false
    while (index < source.length && closers.length) {
      const character = source[index]
      if (escaped) {
        escaped = false
        index += 1
        continue
      }
      if (character === '\\') {
        escaped = true
        index += 1
        continue
      }
      if (inComment) {
        if (character === '\n') inComment = false
        index += 1
        continue
      }
      if (character === '%' && !inQuote) {
        inComment = true
        index += 1
        continue
      }
      if (inQuote) {
        if (character === '{') quoteBraceDepth += 1
        else if (character === '}' && quoteBraceDepth > 0) quoteBraceDepth -= 1
        else if (character === '"' && quoteBraceDepth === 0) inQuote = false
        index += 1
        continue
      }
      if (character === '"') {
        inQuote = true
        index += 1
        continue
      }
      if (character === '{') closers.push('}')
      else if (character === '(') closers.push(')')
      else if (character === closers.at(-1)) closers.pop()
      index += 1
    }
    if (closers.length) throw new Error('The bibliography contains an unclosed entry.')
    if (!['comment', 'preamble', 'string'].includes(type)) {
      if (!key) throw new Error('A bibliography entry has no citation key.')
      spans.push({ key, type, from, to: index })
    }
  }
  return spans
}

const bibtexDictionary = {
  bibliographyContainer: ['', '\n'],
  entry: ['', '\n'],
  list: ['\n', ''],
  listItem: ['\t', '\n'],
}

const formatCitationData = (data: CitationData[]) => formatBibtex(
  mapBibtexEntries(data),
  bibtexDictionary,
)

const referenceYear = (data: CitationData) => {
  const year = data.issued?.['date-parts']?.[0]?.[0]
  return typeof year === 'number' && Number.isInteger(year) ? year : null
}

const referenceKey = (data: CitationData) =>
  data['citation-key']?.trim() || data.id?.trim() || ''

const toReference = (data: CitationData): PaperReference | null => {
  const key = referenceKey(data)
  const title = data.title?.trim()
  if (!key || !title) return null
  return {
    key,
    title,
    authors: data.author ?? [],
    year: referenceYear(data),
    containerTitle: data['container-title']?.trim() || null,
    doi: normalizeDoi(data.DOI),
    url: data.URL?.trim() || null,
    type: data.type?.trim() || 'article-journal',
  }
}

export const parseBibliography = (source: string): PaperReference[] => {
  if (!source.trim()) return []
  const parsed = parseCitationData(source)
    .map(toReference)
    .filter((reference): reference is PaperReference => Boolean(reference))
  return parsed.sort((first, second) => first.key.localeCompare(second.key))
}

export const tryParseBibliography = (source: string) => {
  try {
    return { references: parseBibliography(source), error: null }
  } catch (error) {
    return {
      references: [],
      error: error instanceof Error ? error.message : 'The bibliography could not be parsed.',
    }
  }
}

const parseBibliographySourceData = (source: string) => {
  const parsed = parseCitationData(source)
  const spans = scanBibtexSource(source)
  const byKey = new Map<string, CitationData[]>()
  parsed.forEach((data) => {
    const key = referenceKey(data).toLowerCase()
    if (!key) return
    const entries = byKey.get(key) ?? []
    entries.push(data)
    byKey.set(key, entries)
  })
  return spans.map((span) => {
    const matches = byKey.get(span.key.toLowerCase()) ?? []
    const data = matches.shift()
    if (!data) throw new Error(`Could not locate bibliography entry "${span.key}".`)
    return { span, data }
  })
}

export const parseBibliographySourceEntries = (source: string): BibliographySourceEntry[] =>
  parseBibliographySourceData(source).map(({ span, data }) => ({
    ...span,
    raw: source.slice(span.from, span.to),
    reference: toReference(data),
    doi: normalizeDoi(data.DOI),
  }))

const findSourceEntry = (source: string, key: string) => {
  const normalizedKey = key.trim().toLowerCase()
  const entry = parseBibliographySourceEntries(source)
    .find((candidate) => candidate.key.toLowerCase() === normalizedKey)
  if (!entry) throw new Error(`Reference "${key}" was not found.`)
  return entry
}

export const replaceBibliographyEntry = (
  source: string,
  key: string,
  replacement: string,
) => {
  const current = findSourceEntry(source, key)
  const nextEntries = parseBibliographySourceEntries(replacement.trim())
  if (nextEntries.length !== 1) throw new Error('Provide exactly one BibTeX entry.')
  if (nextEntries[0].key.toLowerCase() !== current.key.toLowerCase()) {
    throw new Error('Citation keys cannot be changed because existing citations use them.')
  }
  return `${source.slice(0, current.from)}${replacement.trim()}${source.slice(current.to)}`
}

const escapeRegularExpression = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const countCitationKeyUsages = (source: string, key: string) => {
  const normalizedKey = key.trim().toLowerCase()
  if (!normalizedKey) return 0
  let count = 0
  const rolePattern = /\{cite(?::[a-z]+)?\}`([^`]*)`/gi
  for (const match of source.matchAll(rolePattern)) {
    const keys = match[1].split(';').map((part) => part.trim()
      .replace(/^\{[^}]*\}/, '')
      .replace(/\{[^}]*\}$/, '')
      .trim()
      .toLowerCase())
    count += keys.filter((candidate) => candidate === normalizedKey).length
  }
  const pandocPattern = new RegExp(
    `(?:^|[\\s[(;])(-?)@(${escapeRegularExpression(key)})(?![\\w:.#$%&+?~/-])`,
    'gim',
  )
  count += Array.from(source.matchAll(pandocPattern)).length
  return count
}

export const deleteBibliographyEntry = (
  source: string,
  key: string,
  manuscript: string,
) => {
  const usageCount = countCitationKeyUsages(manuscript, key)
  if (usageCount) {
    throw new Error(`Reference "${key}" is used by ${usageCount} citation${usageCount === 1 ? '' : 's'}.`)
  }
  const entry = findSourceEntry(source, key)
  return `${source.slice(0, entry.from)}${source.slice(entry.to)}`
}

export const mergeDuplicateReferences = (
  source: string,
  targetKey: string,
  manuscript: string,
) => {
  const entries = parseBibliographySourceEntries(source)
  const target = entries.find((entry) => entry.key.toLowerCase() === targetKey.toLowerCase())
  if (!target) throw new Error(`Reference "${targetKey}" was not found.`)
  if (!target.doi) throw new Error('Only references sharing a DOI can be merged safely.')
  const duplicates = entries.filter((entry) => entry.doi === target.doi)
  if (duplicates.length < 2) throw new Error('No DOI duplicate was found for this reference.')
  const removed = duplicates.filter((entry) => entry !== target)
  const cited = removed.filter((entry) => countCitationKeyUsages(manuscript, entry.key) > 0)
  if (cited.length) {
    throw new Error(`Cannot merge cited key${cited.length === 1 ? '' : 's'}: ${cited.map((entry) => entry.key).join(', ')}.`)
  }
  return removed.sort((first, second) => second.from - first.from).reduce(
    (bibliography, entry) => `${bibliography.slice(0, entry.from)}${bibliography.slice(entry.to)}`,
    source,
  )
}

export const importBibliography = (
  source: string,
  importedSource: string,
): BibliographyImportResult => {
  const existing = parseBibliographySourceData(source)
  const imported = parseBibliographySourceData(importedSource)
  if (!imported.length) throw new Error('The imported file contains no BibTeX entries.')
  const usedKeys = new Set(existing.map(({ span }) => span.key.toLowerCase()))
  const usedDois = new Set(existing
    .map(({ data }) => normalizeDoi(data.DOI))
    .filter((doi): doi is string => Boolean(doi)))
  const existingByKey = new Map(existing.map(({ span, data }) => [span.key.toLowerCase(), data]))
  const result: BibliographyImportResult = {
    bibliography: source,
    importedKeys: [],
    skippedKeys: [],
    renamedKeys: [],
  }

  imported.forEach(({ span, data }) => {
    const doi = normalizeDoi(data.DOI)
    const existingKeyData = existingByKey.get(span.key.toLowerCase())
    if (
      (doi && usedDois.has(doi)) ||
      (existingKeyData && existingKeyData.title === data.title && referenceYear(existingKeyData) === referenceYear(data))
    ) {
      result.skippedKeys.push(span.key)
      return
    }

    let key = span.key
    if (usedKeys.has(key.toLowerCase())) {
      key = uniqueCitationKey(key, usedKeys)
      result.renamedKeys.push({ from: span.key, to: key })
    }
    const nextData = { ...data, id: key, 'citation-key': key }
    result.bibliography = appendBibtexEntry(result.bibliography, formatCitationData([nextData]))
    result.importedKeys.push(key)
    usedKeys.add(key.toLowerCase())
    if (doi) usedDois.add(doi)
  })
  return result
}

const asciiWords = (value: string): string[] => Array.from(value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .match(/[A-Za-z0-9]+/g) ?? [])

const keyPart = (value: string) => asciiWords(value)
  .map((word) => word.toLowerCase())
  .map((word) => word[0]?.toUpperCase() + word.slice(1))
  .join('')

const titleKeyWord = (title: string) => {
  const ignored = new Set([
    'a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'using', 'with',
  ])
  return asciiWords(title).find((word) => !ignored.has(word.toLowerCase())) ?? 'Work'
}

const baseCitationKey = (paper: PaperSearchResult) => {
  const firstAuthor = paper.authors[0]
  const author = firstAuthor?.family || firstAuthor?.literal || 'Reference'
  return `${keyPart(author) || 'Reference'}${paper.year ?? 'Nd'}${keyPart(titleKeyWord(paper.title))}`
}

const stableHash = (value: string) => {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 6)
}

export const canonicalReferenceId = (paper: PaperSearchResult) =>
  normalizeDoi(paper.doi)
    ? `doi:${normalizeDoi(paper.doi)}`
    : paper.id.trim() || `work:${stableHash(`${paper.title}:${paper.year ?? ''}`)}`

const stableCitationKey = (paper: PaperSearchResult) =>
  `${baseCitationKey(paper)}${stableHash(canonicalReferenceId(paper))}`

const uniqueCitationKey = (base: string, usedKeys: Set<string>) => {
  if (!usedKeys.has(base.toLowerCase())) return base
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${base}${suffix}`
    if (!usedKeys.has(candidate.toLowerCase())) return candidate
  }
  throw new Error('Could not create a unique citation key.')
}

const toCitationData = (paper: PaperSearchResult, key: string): CitationData => ({
  id: key,
  'citation-key': key,
  type: paper.type || 'article-journal',
  title: paper.title,
  author: paper.authors,
  ...(paper.year ? { issued: { 'date-parts': [[paper.year]] } } : {}),
  ...(paper.containerTitle ? { 'container-title': paper.containerTitle } : {}),
  ...(paper.doi ? { DOI: normalizeDoi(paper.doi) ?? undefined } : {}),
  ...(paper.url ? { URL: paper.url } : {}),
  ...(paper.volume ? { volume: paper.volume } : {}),
  ...(paper.issue ? { issue: paper.issue } : {}),
  ...(paper.page ? { page: paper.page } : {}),
  ...(paper.publisher ? { publisher: paper.publisher } : {}),
})

const appendBibtexEntry = (source: string, entry: string) => {
  const trimmedSource = source.trimEnd()
  const trimmedEntry = entry.trim()
  return trimmedSource ? `${trimmedSource}\n\n${trimmedEntry}\n` : `${trimmedEntry}\n`
}

export const createGeneratedReference = (
  source: string,
  paper: PaperSearchResult,
): GeneratedReferenceEntry | null => {
  const parsed = parseCitationData(source)
  const doi = normalizeDoi(paper.doi)
  if (doi && parsed.some((entry) => normalizeDoi(entry.DOI) === doi)) return null

  const id = canonicalReferenceId(paper)
  const usedKeys = new Set(parsed.map(referenceKey).filter(Boolean).map((key) => key.toLowerCase()))
  const key = uniqueCitationKey(stableCitationKey(paper), usedKeys)
  return {
    id,
    key,
    doi,
    bibtex: formatCitationData([toCitationData(paper, key)]).trim(),
  }
}

export const materializeBibliography = (
  source: string,
  generated: Iterable<GeneratedReferenceEntry>,
) => {
  const importedDois = new Set(
    parseCitationData(source)
      .map((entry) => normalizeDoi(entry.DOI))
      .filter((doi): doi is string => Boolean(doi)),
  )
  const entries = Array.from(generated)
    .filter((entry) => !entry.doi || !importedDois.has(entry.doi))
    .sort((first, second) => first.key.localeCompare(second.key))
  return entries.reduce(
    (bibliography, entry) => appendBibtexEntry(bibliography, entry.bibtex),
    source,
  )
}

export const addReference = (
  source: string,
  paper: PaperSearchResult,
): AddReferenceResult => {
  const parsed = parseCitationData(source)
  const doi = normalizeDoi(paper.doi)
  const duplicate = doi
    ? parsed.find((entry) => normalizeDoi(entry.DOI) === doi)
    : undefined
  if (duplicate) {
    const key = referenceKey(duplicate)
    if (!key) throw new Error('The matching bibliography entry has no citation key.')
    return { bibliography: source, key, added: false }
  }

  const generated = createGeneratedReference(source, paper)
  if (!generated) throw new Error('Could not create the bibliography entry.')
  return {
    bibliography: materializeBibliography(source, [generated]),
    key: generated.key,
    added: true,
  }
}

export const getBibliographyPath = (manuscriptPath: string) => {
  const segments = manuscriptPath.split('/')
  segments[segments.length - 1] = 'references.bib'
  return segments.join('/')
}

const normalizeCitationDetail = (value: string | undefined, label: string) => {
  const normalized = value?.trim() ?? ''
  if (/[{}`]/.test(normalized)) {
    throw new Error(`${label} cannot contain braces or backticks.`)
  }
  return normalized
}

export const detectCitationSyntax = (
  source: string,
  fallback: CitationSyntax = 'role',
): CitationSyntax => {
  const roleCount = Array.from(
    source.matchAll(/\{cite(?::[a-z]+)?\}`([^`]*)`/gi),
    (match) => match[1].split(';').filter((part) => part.trim()).length,
  ).reduce((total, count) => total + count, 0)
  const markdownCount = Array.from(source.matchAll(
    /(?:^|[\s[(;])-?@[A-Za-z0-9][\w:.#$%&+?~/-]*(?![\w:.#$%&+?~/-])/gim,
  )).length
  if (markdownCount === roleCount) return fallback
  return markdownCount > roleCount ? 'markdown' : 'role'
}

export const formatCitation = (
  keys: string[],
  style: CitationStyle,
  details: CitationDetails = {},
  syntax: CitationSyntax = 'role',
) => {
  const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)))
  if (!uniqueKeys.length) throw new Error('Select at least one reference.')
  const prefix = normalizeCitationDetail(details.prefix, 'Citation prefix')
  const suffix = normalizeCitationDetail(details.suffix, 'Citation locator or suffix')
  if (syntax === 'markdown') {
    if (style === 'parenthetical') {
      const entries = uniqueKeys.map((key) => `@${key}`)
      if (prefix) entries[0] = `${prefix} ${entries[0]}`
      if (suffix) entries[entries.length - 1] += `, ${suffix}`
      return `[${entries.join('; ')}]`
    }
    if (uniqueKeys.length === 1 && !prefix) {
      return `@${uniqueKeys[0]}${suffix ? ` [${suffix}]` : ''}`
    }
  }
  const roleEntries = uniqueKeys.map((key, index) => [
    index === 0 && prefix ? `{${prefix}}` : '',
    key,
    index === uniqueKeys.length - 1 && suffix ? `{${suffix}}` : '',
  ].join(''))
  return `{cite:${style === 'parenthetical' ? 'p' : 't'}}\`${roleEntries.join('; ')}\``
}