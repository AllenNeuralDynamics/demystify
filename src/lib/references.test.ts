import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  addReference,
  createGeneratedReference,
  formatCitation,
  getBibliographyPath,
  materializeBibliography,
  parseBibliography,
  tryParseBibliography,
  type PaperSearchResult,
} from './references'

const paper = (overrides: Partial<PaperSearchResult> = {}): PaperSearchResult => ({
  id: 'doi:10.1126/science.aav7893',
  title: 'Spontaneous behaviors drive multidimensional, brainwide activity',
  authors: [{ family: 'Stringer', given: 'Carsen' }],
  year: 2019,
  containerTitle: 'Science',
  doi: '10.1126/science.aav7893',
  url: 'https://doi.org/10.1126/science.aav7893',
  type: 'article-journal',
  ...overrides,
})

describe('reference library', () => {
  it('parses BibTeX while preserving citation keys', () => {
    const source = `@article{custom-key,
  title={A paper},
  author={Lovelace, Ada and Hopper, Grace},
  year={2024},
  journal={Science},
  doi={https://doi.org/10.1000/EXAMPLE}
}`

    expect(parseBibliography(source)).toEqual([{
      key: 'custom-key',
      title: 'A paper',
      authors: [
        { family: 'Lovelace', given: 'Ada' },
        { family: 'Hopper', given: 'Grace' },
      ],
      year: 2024,
      containerTitle: 'Science',
      doi: '10.1000/example',
      url: null,
      type: 'article-journal',
    }])
  })

  it('returns parse errors without throwing from the safe API', () => {
    const result = tryParseBibliography('@article{broken')
    expect(result.references).toEqual([])
    expect(result.error).toBeTruthy()
  })

  it('reuses an existing DOI and leaves bibliography text byte-for-byte intact', () => {
    const source = '@article{existing, title={Original}, doi={10.1126/SCIENCE.AAV7893}}\n'
    expect(addReference(source, paper())).toEqual({
      bibliography: source,
      key: 'existing',
      added: false,
    })
  })

  it('appends a deterministic entry without rewriting existing BibTeX', () => {
    const source = '@article{Existing, title={Keep {My} Formatting}}\n'
    const result = addReference(source, paper())
    expect(result.key).toMatch(/^Stringer2019Spontaneous[a-z0-9]{6}$/)
    expect(result.added).toBe(true)
    expect(result.bibliography.startsWith(source)).toBe(true)
    expect(result.bibliography).toContain(`@article{${result.key},`)
    expect(result.bibliography).toContain('doi = {10.1126/science.aav7893}')
  })

  it('serializes complete Crossref journal metadata in the browser adapter', () => {
    const result = createGeneratedReference('', paper({
      volume: '364',
      issue: '6437',
      page: '255-255',
      publisher: 'American Association for the Advancement of Science (AAAS)',
    }))
    expect(result?.bibtex).toContain('volume = {364}')
    expect(result?.bibtex).toContain('number = {6437}')
    expect(result?.bibtex).toContain('pages = {255--255}')
    expect(result?.bibtex).toContain('publisher = {American Association')
  })

  it('adds a numeric suffix when a generated key already exists', () => {
    const first = createGeneratedReference('', paper())
    expect(first).not.toBeNull()
    const source = `@article{${first?.key}, title={Another paper}}\n`
    expect(addReference(source, paper()).key).toBe(`${first?.key}2`)
  })

  it('materializes generated entries deterministically and skips imported DOIs', () => {
    const imported = '@article{existing, title={Imported}, doi={10.1000/imported}}\n'
    const first = createGeneratedReference(imported, paper())
    const duplicateImported = {
      id: 'doi:10.1000/imported',
      key: 'ShouldNotAppear',
      doi: '10.1000/imported',
      bibtex: '@article{ShouldNotAppear, title={Duplicate}}',
    }
    expect(first).not.toBeNull()
    const result = materializeBibliography(imported, [first!, duplicateImported])
    expect(result.startsWith(imported)).toBe(true)
    expect(result).toContain(first!.key)
    expect(result).not.toContain('ShouldNotAppear')
  })

  it('converges simultaneous additions of the same DOI to one shared entry', () => {
    const firstDocument = new Y.Doc()
    const secondDocument = new Y.Doc()
    Y.applyUpdate(secondDocument, Y.encodeStateAsUpdate(firstDocument))
    const firstReferences = firstDocument.getMap<ReturnType<typeof createGeneratedReference>>(
      'references',
    )
    const secondReferences = secondDocument.getMap<ReturnType<typeof createGeneratedReference>>(
      'references',
    )
    const entry = createGeneratedReference('', paper())
    expect(entry).not.toBeNull()

    firstReferences.set(entry!.id, entry)
    secondReferences.set(entry!.id, entry)
    Y.applyUpdate(firstDocument, Y.encodeStateAsUpdate(secondDocument))
    Y.applyUpdate(secondDocument, Y.encodeStateAsUpdate(firstDocument))

    expect(firstReferences.size).toBe(1)
    expect(secondReferences.size).toBe(1)
    expect(materializeBibliography('', firstReferences.values()).match(/@article\{/g)).toHaveLength(1)
  })

  it('places references beside nested manuscripts', () => {
    expect(getBibliographyPath('paper.md')).toBe('references.bib')
    expect(getBibliographyPath('manuscript/main.myst')).toBe('manuscript/references.bib')
  })

  it('formats deduplicated parenthetical and narrative citation roles', () => {
    expect(formatCitation(['smith2024', 'jones2023', 'smith2024'], 'parenthetical'))
      .toBe('{cite:p}`smith2024; jones2023`')
    expect(formatCitation(['smith2024'], 'narrative')).toBe('{cite:t}`smith2024`')
    expect(() => formatCitation([], 'parenthetical')).toThrow('Select at least one')
  })
})