import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchCrossrefWorks } from './citations.js'

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
)

afterEach(() => vi.unstubAllGlobals())

describe('searchCrossrefWorks', () => {
  it('normalizes bibliographic search results and removes duplicate DOIs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      message: {
        items: [{
          DOI: '10.1126/SCIENCE.AAV7893',
          title: ['Spontaneous behaviors drive multidimensional activity'],
          author: [{ family: 'Stringer', given: 'Carsen' }, {}],
          'published-print': { 'date-parts': [[2019, 4, 19]] },
          'container-title': ['Science'],
          URL: 'https://doi.org/10.1126/science.aav7893',
          type: 'journal-article',
          volume: '364',
          issue: '6437',
          page: '255-255',
          publisher: 'AAAS',
        }, {
          DOI: '10.1126/science.aav7893',
          title: ['Duplicate'],
        }, {
          DOI: '10.1000/missing-title',
        }],
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchCrossrefWorks('Stringer activity')).resolves.toEqual([{
      id: 'doi:10.1126/science.aav7893',
      title: 'Spontaneous behaviors drive multidimensional activity',
      authors: [{ family: 'Stringer', given: 'Carsen', literal: undefined }],
      year: 2019,
      containerTitle: 'Science',
      doi: '10.1126/science.aav7893',
      url: 'https://doi.org/10.1126/science.aav7893',
      type: 'article-journal',
      volume: '364',
      issue: '6437',
      page: '255-255',
      publisher: 'AAAS',
    }])
    const requested = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requested.searchParams.get('query.bibliographic')).toBe('Stringer activity')
    expect(requested.searchParams.get('rows')).toBe('12')
  })

  it('uses the singleton endpoint for a DOI and maps conference papers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      message: {
        DOI: '10.1000/example',
        title: ['A conference paper'],
        issued: { 'date-parts': [[2023]] },
        type: 'proceedings-article',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchCrossrefWorks('https://doi.org/10.1000/example')).resolves.toEqual([
      expect.objectContaining({
        id: 'doi:10.1000/example',
        type: 'paper-conference',
        year: 2023,
      }),
    ])
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.crossref.org/works/10.1000%2Fexample',
    )
  })

  it('validates queries and translates upstream failures', async () => {
    await expect(searchCrossrefWorks('x')).rejects.toMatchObject({ status: 400 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)))
    await expect(searchCrossrefWorks('neural activity')).rejects.toMatchObject({
      status: 429,
    })
  })
})