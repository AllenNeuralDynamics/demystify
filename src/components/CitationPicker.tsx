import { Check, LoaderCircle, Search, X } from 'lucide-react'
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { searchPapers } from '../lib/github'
import {
  tryParseBibliography,
  type CitationDetails,
  type CitationStyle,
  type PaperReference,
  type PaperSearchResult,
} from '../lib/references'

export type CitationSelection =
  | { kind: 'existing'; key: string }
  | { kind: 'paper'; paper: PaperSearchResult }

interface CitationPickerProps {
  allowNewReferences?: boolean
  bibliography: string
  roomName: string
  onClose: () => void
  onInsert: (
    selection: CitationSelection[],
    style: CitationStyle,
    details: CitationDetails,
  ) => void
}

interface CitationCandidate {
  id: string
  selection: CitationSelection
  title: string
  authors: PaperReference['authors']
  year: number | null
  containerTitle: string | null
  doi: string | null
  key: string | null
  source: 'library' | 'crossref'
}

const authorLabel = (authors: PaperReference['authors']) => {
  const names = authors.map((author) => author.family || author.literal).filter(Boolean)
  if (!names.length) return 'Unknown author'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} et al.`
}

const referenceSearchText = (reference: PaperReference) => [
  reference.key,
  reference.title,
  reference.year,
  reference.containerTitle,
  reference.doi,
  ...reference.authors.flatMap((author) => [author.family, author.given, author.literal]),
].filter(Boolean).join(' ').toLowerCase()

const localCandidate = (reference: PaperReference): CitationCandidate => ({
  id: `library:${reference.key}`,
  selection: { kind: 'existing', key: reference.key },
  title: reference.title,
  authors: reference.authors,
  year: reference.year,
  containerTitle: reference.containerTitle,
  doi: reference.doi,
  key: reference.key,
  source: 'library',
})

const remoteCandidate = (paper: PaperSearchResult): CitationCandidate => ({
  id: `paper:${paper.id}`,
  selection: { kind: 'paper', paper },
  title: paper.title,
  authors: paper.authors,
  year: paper.year,
  containerTitle: paper.containerTitle,
  doi: paper.doi,
  key: null,
  source: 'crossref',
})

export const CitationPicker = ({
  allowNewReferences = true,
  bibliography,
  roomName,
  onClose,
  onInsert,
}: CitationPickerProps) => {
  const [query, setQuery] = useState('')
  const [style, setStyle] = useState<CitationStyle>('parenthetical')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [remoteResults, setRemoteResults] = useState<PaperSearchResult[]>([])
  const [selected, setSelected] = useState<Map<string, CitationCandidate>>(new Map())
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchRevision = useRef(0)
  const parsed = useMemo(() => tryParseBibliography(bibliography), [bibliography])
  const normalizedQuery = query.trim().toLowerCase()
  const localResults = useMemo(() => parsed.references
    .filter((reference) => !normalizedQuery || referenceSearchText(reference).includes(normalizedQuery))
    .slice(0, 12)
    .map(localCandidate), [normalizedQuery, parsed.references])
  const localDois = useMemo(
    () => new Set(parsed.references.map((reference) => reference.doi).filter(Boolean)),
    [parsed.references],
  )
  const candidates = useMemo(() => [
    ...localResults,
    ...(allowNewReferences ? remoteResults : [])
      .filter((paper) => !paper.doi || !localDois.has(paper.doi))
      .map(remoteCandidate),
  ], [allowNewReferences, localDois, localResults, remoteResults])
  const selectedCandidates = useMemo(
    () => Array.from(selected.values()).filter(
      (candidate) => allowNewReferences || candidate.source === 'library',
    ),
    [allowNewReferences, selected],
  )

  useEffect(() => {
    if (!allowNewReferences || query.trim().length < 2) return
    const revision = ++searchRevision.current
    const timeout = window.setTimeout(() => {
      setIsSearching(true)
      setSearchError(null)
      void searchPapers(roomName, query.trim())
        .then((results) => {
          if (revision !== searchRevision.current) return
          startTransition(() => setRemoteResults(results))
        })
        .catch((error: unknown) => {
          if (revision !== searchRevision.current) return
          setRemoteResults([])
          setSearchError(error instanceof Error ? error.message : 'Paper search failed.')
        })
        .finally(() => {
          if (revision === searchRevision.current) setIsSearching(false)
        })
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [allowNewReferences, query, roomName])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const toggleCandidate = (candidate: CitationCandidate) => {
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(candidate.id)) next.delete(candidate.id)
      else next.set(candidate.id, candidate)
      return next
    })
  }

  const updateQuery = (value: string) => {
    setQuery(value)
    if (value.trim().length >= 2) return
    searchRevision.current += 1
    setRemoteResults([])
    setSearchError(null)
    setIsSearching(false)
  }

  const insertSelection = () => {
    if (!selectedCandidates.length) return
    onInsert(selectedCandidates.map((candidate) => candidate.selection), style, {
      ...(prefix.trim() ? { prefix: prefix.trim() } : {}),
      ...(suffix.trim() ? { suffix: suffix.trim() } : {}),
    })
  }

  return (
    <div className="citation-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="citation-picker" role="dialog" aria-modal="true" aria-labelledby="citation-picker-title">
        <header className="citation-picker-header">
          <div>
            <h2 id="citation-picker-title">Cite a paper</h2>
            <span>{parsed.references.length} in this manuscript</span>
          </div>
          <button className="icon-button" type="button" title="Close citation picker" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="citation-search">
          <Search size={17} aria-hidden="true" />
          <input
            autoFocus
            aria-label="Search papers"
            placeholder={allowNewReferences
              ? 'Title, author, year, DOI, or PMID'
              : 'Search this manuscript library'}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
          />
          {allowNewReferences && isSearching && (
            <LoaderCircle className="spin" size={17} aria-label="Searching" />
          )}
        </div>

        <div className="citation-style" aria-label="Citation style">
          <button
            className={style === 'parenthetical' ? 'active' : ''}
            type="button"
            onClick={() => setStyle('parenthetical')}
          >
            Parenthetical
          </button>
          <button
            className={style === 'narrative' ? 'active' : ''}
            type="button"
            onClick={() => setStyle('narrative')}
          >
            Narrative
          </button>
        </div>

        <div className="citation-details">
          <label>
            <span>Prefix</span>
            <input
              aria-label="Citation prefix"
              placeholder="e.g. see"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
            />
          </label>
          <label>
            <span>Locator or suffix</span>
            <input
              aria-label="Citation locator or suffix"
              placeholder="e.g. p. 22"
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
            />
          </label>
        </div>

        <div className="citation-results" aria-live="polite">
          {!allowNewReferences && (
            <div className="citation-library-only-notice">
              Choose from this manuscript's library. New papers can be added after proposed changes are resolved.
            </div>
          )}
          {parsed.error && <div className="citation-message error">references.bib: {parsed.error}</div>}
          {searchError && <div className="citation-message error">{searchError}</div>}
          {!candidates.length && !isSearching && (
            <div className="citation-message">
              {normalizedQuery
                ? allowNewReferences
                  ? 'No matching papers found.'
                  : 'No matching references in this manuscript.'
                : allowNewReferences
                  ? 'Search Crossref or choose from this manuscript.'
                  : 'No references are available in this manuscript.'}
            </div>
          )}
          {candidates.map((candidate, index) => {
            const checked = selected.has(candidate.id)
            const startsRemoteResults = candidate.source === 'crossref' &&
              (index === 0 || candidates[index - 1].source !== 'crossref')
            return (
              <div key={candidate.id}>
                {(index === 0 || startsRemoteResults) && (
                  <div className="citation-result-heading">
                    {candidate.source === 'library' ? 'Manuscript library' : 'Crossref results'}
                  </div>
                )}
                <button
                  className={`citation-result ${checked ? 'selected' : ''}`}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggleCandidate(candidate)}
                >
                  <span className="citation-check" aria-hidden="true">
                    {checked && <Check size={14} />}
                  </span>
                  <span className="citation-result-copy">
                    <strong>{candidate.title}</strong>
                    <span>
                      {authorLabel(candidate.authors)}
                      {candidate.year ? ` · ${candidate.year}` : ''}
                      {candidate.containerTitle ? ` · ${candidate.containerTitle}` : ''}
                    </span>
                    <small>{candidate.key ?? candidate.doi ?? candidate.source}</small>
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <footer className="citation-picker-footer">
          <span aria-live="polite">
            {selectedCandidates.length ? `${selectedCandidates.length} selected` : 'Select references'}
          </span>
          <button className="button primary-button" type="button" disabled={!selectedCandidates.length} onClick={insertSelection}>
            Insert citation
          </button>
        </footer>
      </section>
    </div>
  )
}