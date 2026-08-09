import { ApiError } from './github.js'

interface CrossrefAuthor {
  family?: string
  given?: string
  name?: string
}

interface CrossrefDate {
  'date-parts'?: number[][]
}

interface CrossrefWork {
  DOI?: string
  title?: string[]
  author?: CrossrefAuthor[]
  issued?: CrossrefDate
  published?: CrossrefDate
  'published-print'?: CrossrefDate
  'published-online'?: CrossrefDate
  'container-title'?: string[]
  URL?: string
  type?: string
  volume?: string
  issue?: string
  page?: string
  publisher?: string
}

interface CrossrefSearchResponse {
  message?: {
    items?: CrossrefWork[]
  }
}

interface CrossrefWorkResponse {
  message?: CrossrefWork
}

const doiPattern = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i

const normalizeDoi = (value: string | undefined) => value
  ?.trim()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  .toLowerCase() || null

const readYear = (date: CrossrefDate | undefined) => {
  const year = date?.['date-parts']?.[0]?.[0]
  return typeof year === 'number' && Number.isInteger(year) ? year : null
}

const toCslType = (type: string | undefined) => {
  switch (type) {
    case 'book': return 'book'
    case 'book-chapter': return 'chapter'
    case 'dissertation': return 'thesis'
    case 'proceedings-article': return 'paper-conference'
    case 'report': return 'report'
    case 'posted-content': return 'article'
    default: return 'article-journal'
  }
}

const normalizeWork = (work: CrossrefWork) => {
  const title = work.title?.find((value) => value.trim())?.trim()
  if (!title) return null
  const doi = normalizeDoi(work.DOI)
  const url = work.URL?.trim() || (doi ? `https://doi.org/${doi}` : null)
  return {
    id: doi ? `doi:${doi}` : `crossref:${url ?? title}`,
    title,
    authors: (work.author ?? []).flatMap((author) => {
      const family = author.family?.trim()
      const given = author.given?.trim()
      const literal = author.name?.trim()
      return family || given || literal ? [{ family, given, literal }] : []
    }),
    year:
      readYear(work['published-print']) ??
      readYear(work['published-online']) ??
      readYear(work.issued) ??
      readYear(work.published),
    containerTitle: work['container-title']?.find((value) => value.trim())?.trim() || null,
    doi,
    url,
    type: toCslType(work.type),
    ...(work.volume?.trim() ? { volume: work.volume.trim() } : {}),
    ...(work.issue?.trim() ? { issue: work.issue.trim() } : {}),
    ...(work.page?.trim() ? { page: work.page.trim() } : {}),
    ...(work.publisher?.trim() ? { publisher: work.publisher.trim() } : {}),
  }
}

const crossrefHeaders = () => ({
  Accept: 'application/json',
  'User-Agent': [
    'DeMystify/1.0 (https://github.com/AllenNeuralDynamics/demystify',
    process.env.CROSSREF_MAILTO ? `; mailto:${process.env.CROSSREF_MAILTO})` : ')',
  ].join(''),
})

const fetchCrossref = async <Result>(url: URL): Promise<Result> => {
  let response: Response
  try {
    response = await fetch(url, {
      headers: crossrefHeaders(),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (error) {
    throw new ApiError(
      504,
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Paper search timed out. Try again.'
        : 'Paper search is temporarily unavailable.',
    )
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 429 ? 429 : 502,
      response.status === 429
        ? 'Paper search is busy. Wait a moment and try again.'
        : 'Crossref could not complete the paper search.',
    )
  }
  return response.json() as Promise<Result>
}

export const searchCrossrefWorks = async (rawQuery: string) => {
  const query = rawQuery.trim()
  if (query.length < 2) throw new ApiError(400, 'Search for at least two characters.')
  if (query.length > 240) throw new ApiError(400, 'Paper searches must be 240 characters or fewer.')

  const doi = query.match(doiPattern)?.[1]
  let works: CrossrefWork[]
  if (doi) {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
    const result = await fetchCrossref<CrossrefWorkResponse>(url)
    works = result.message ? [result.message] : []
  } else {
    const url = new URL('https://api.crossref.org/works')
    url.searchParams.set('query.bibliographic', query)
    url.searchParams.set('rows', '12')
    url.searchParams.set(
      'select',
      'DOI,title,author,issued,published,published-print,published-online,container-title,URL,type,volume,issue,page,publisher',
    )
    if (process.env.CROSSREF_MAILTO) {
      url.searchParams.set('mailto', process.env.CROSSREF_MAILTO)
    }
    const result = await fetchCrossref<CrossrefSearchResponse>(url)
    works = result.message?.items ?? []
  }

  const seen = new Set<string>()
  return works.flatMap((work) => {
    const normalized = normalizeWork(work)
    if (!normalized || seen.has(normalized.id)) return []
    seen.add(normalized.id)
    return [normalized]
  })
}