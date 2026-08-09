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

export type CitationStyle = 'parenthetical' | 'narrative'

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

export const formatCitation = (keys: string[], style: CitationStyle) => {
  const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)))
  if (!uniqueKeys.length) throw new Error('Select at least one reference.')
  return `{cite:${style === 'parenthetical' ? 'p' : 't'}}\`${uniqueKeys.join('; ')}\``
}