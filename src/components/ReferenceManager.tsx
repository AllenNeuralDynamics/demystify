import {
  ArrowLeft,
  BookOpenText,
  Download,
  GitMerge,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  countCitationKeyUsages,
  deleteBibliographyEntry,
  importBibliography,
  mergeDuplicateReferences,
  parseBibliographySourceEntries,
  replaceBibliographyEntry,
  type BibliographyEditResult,
  type BibliographySourceEntry,
} from '../lib/references'

interface ReferenceManagerProps {
  bibliography: string
  manuscript: string
  readOnly: boolean
  onApply: (expected: string, replacement: string) => BibliographyEditResult
  onClose: () => void
}

type ManagerMode = 'library' | 'edit' | 'import'

const authorLabel = (entry: BibliographySourceEntry) => {
  const names = entry.reference?.authors
    .map((author) => author.family || author.literal)
    .filter((name): name is string => Boolean(name)) ?? []
  if (!names.length) return 'Unknown author'
  if (names.length <= 3) return names.join(', ')
  return `${names[0]} et al.`
}

const importSummary = (
  imported: number,
  skipped: number,
  renamed: Array<{ from: string; to: string }>,
) => [
  `${imported} imported`,
  skipped ? `${skipped} skipped` : '',
  renamed.length ? `renamed ${renamed.map((entry) => `${entry.from} to ${entry.to}`).join(', ')}` : '',
].filter(Boolean).join('; ')

export const ReferenceManager = ({
  bibliography,
  manuscript,
  readOnly,
  onApply,
  onClose,
}: ReferenceManagerProps) => {
  const [mode, setMode] = useState<ManagerMode>('library')
  const [query, setQuery] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [expectedBibliography, setExpectedBibliography] = useState('')
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const parsed = useMemo(() => {
    try {
      return { entries: parseBibliographySourceEntries(bibliography), error: null }
    } catch (nextError) {
      return {
        entries: [] as BibliographySourceEntry[],
        error: nextError instanceof Error ? nextError.message : 'The bibliography could not be parsed.',
      }
    }
  }, [bibliography])
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = useMemo(() => parsed.entries.filter((entry) => {
    if (!normalizedQuery) return true
    return [
      entry.key,
      entry.reference?.title,
      entry.reference?.year,
      entry.reference?.containerTitle,
      entry.doi,
      authorLabel(entry),
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
  }), [normalizedQuery, parsed.entries])
  const duplicateDois = useMemo(() => {
    const counts = new Map<string, number>()
    parsed.entries.forEach((entry) => {
      if (entry.doi) counts.set(entry.doi, (counts.get(entry.doi) ?? 0) + 1)
    })
    return counts
  }, [parsed.entries])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const resetLibrary = (message?: string) => {
    setMode('library')
    setEditingKey(null)
    setDraft('')
    setExpectedBibliography('')
    setPendingDeleteKey(null)
    setError(null)
    if (message) setFeedback(message)
  }

  const applyBibliography = (expected: string, replacement: string, message: string) => {
    const result = onApply(expected, replacement)
    if (result === 'conflict') {
      setError('The reference library changed elsewhere. Return to the library and try again.')
      return false
    }
    if (result === 'unavailable') {
      setError('The reference library is not writable in this room.')
      return false
    }
    resetLibrary(message)
    return true
  }

  const beginEdit = (entry: BibliographySourceEntry) => {
    setExpectedBibliography(bibliography)
    setEditingKey(entry.key)
    setDraft(entry.raw)
    setError(null)
    setMode('edit')
  }

  const saveEdit = () => {
    if (!editingKey) return
    try {
      const replacement = replaceBibliographyEntry(expectedBibliography, editingKey, draft)
      applyBibliography(expectedBibliography, replacement, `Updated ${editingKey}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The entry could not be updated.')
    }
  }

  const deleteEntry = (entry: BibliographySourceEntry) => {
    try {
      const replacement = deleteBibliographyEntry(bibliography, entry.key, manuscript)
      applyBibliography(bibliography, replacement, `Deleted ${entry.key}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The entry could not be deleted.')
    }
  }

  const mergeEntry = (entry: BibliographySourceEntry) => {
    try {
      const replacement = mergeDuplicateReferences(bibliography, entry.key, manuscript)
      applyBibliography(bibliography, replacement, `Merged DOI duplicates into ${entry.key}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The entries could not be merged.')
    }
  }

  const beginImport = () => {
    setExpectedBibliography(bibliography)
    setDraft('')
    setError(null)
    setMode('import')
  }

  const runImport = () => {
    try {
      const result = importBibliography(expectedBibliography, draft)
      const message = importSummary(
        result.importedKeys.length,
        result.skippedKeys.length,
        result.renamedKeys,
      )
      if (!result.importedKeys.length) {
        resetLibrary(message)
        return
      }
      applyBibliography(expectedBibliography, result.bibliography, message)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The BibTeX could not be imported.')
    }
  }

  const readImportFile = (file: File | undefined) => {
    if (!file) return
    void file.text()
      .then((content) => {
        setDraft(content)
        setError(null)
      })
      .catch(() => setError('The selected file could not be read.'))
  }

  const exportBibliography = () => {
    const url = URL.createObjectURL(new Blob([bibliography], { type: 'application/x-bibtex' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'references.bib'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="reference-manager-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="reference-manager" role="dialog" aria-modal="true" aria-labelledby="reference-manager-title">
        <header className="reference-manager-header">
          <div className="reference-manager-heading">
            {mode !== 'library' ? (
              <button className="icon-button" type="button" title="Back to reference library" onClick={() => resetLibrary()}>
                <ArrowLeft size={17} />
              </button>
            ) : <BookOpenText size={20} aria-hidden="true" />}
            <div>
              <h2 id="reference-manager-title">
                {mode === 'edit' ? `Edit ${editingKey}` : mode === 'import' ? 'Import BibTeX' : 'Reference library'}
              </h2>
              <span>{mode === 'library' ? `${parsed.entries.length} entries in references.bib` : 'Standard BibTeX; existing citation keys stay fixed'}</span>
            </div>
          </div>
          <button className="icon-button" type="button" title="Close reference library" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        {mode === 'library' ? (
          <>
            <div className="reference-manager-tools">
              <div className="reference-library-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="Search reference library"
                  placeholder="Title, author, year, DOI, or key"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <button className="button secondary-button" type="button" title="Import BibTeX" disabled={readOnly} onClick={beginImport}>
                <Upload size={15} /> Import
              </button>
              <button className="button secondary-button" type="button" title="Export references.bib" disabled={!bibliography.trim()} onClick={exportBibliography}>
                <Download size={15} /> Export
              </button>
            </div>

            <div className="reference-manager-messages" aria-live="polite">
              {(parsed.error || error) && <span className="error">{parsed.error ?? error}</span>}
              {feedback && !error && <span>{feedback}</span>}
            </div>

            <div className="reference-library-list">
              {!filteredEntries.length && !parsed.error ? (
                <div className="reference-library-empty">
                  <BookOpenText size={24} />
                  <span>{normalizedQuery ? 'No references match this search.' : 'Import a .bib file or add papers with Cite.'}</span>
                </div>
              ) : filteredEntries.map((entry) => {
                const usageCount = countCitationKeyUsages(manuscript, entry.key)
                const duplicateCount = entry.doi ? duplicateDois.get(entry.doi) ?? 0 : 0
                const duplicateEntries = entry.doi
                  ? parsed.entries.filter((candidate) => candidate.doi === entry.doi && candidate !== entry)
                  : []
                const mergeBlocked = duplicateEntries.some(
                  (candidate) => countCitationKeyUsages(manuscript, candidate.key) > 0,
                )
                return (
                  <article className="reference-library-row" key={`${entry.key}-${entry.from}`}>
                    <div className="reference-library-copy">
                      <strong>{entry.reference?.title ?? entry.key}</strong>
                      <span>
                        {authorLabel(entry)}
                        {entry.reference?.year ? ` · ${entry.reference.year}` : ''}
                        {entry.reference?.containerTitle ? ` · ${entry.reference.containerTitle}` : ''}
                      </span>
                      <small>{entry.key}{entry.doi ? ` · ${entry.doi}` : ''}</small>
                    </div>
                    <div className="reference-library-badges">
                      {usageCount > 0 && <span>{usageCount} cited</span>}
                      {duplicateCount > 1 && <span className="duplicate">DOI duplicate</span>}
                    </div>
                    <div className="reference-library-actions">
                      {duplicateCount > 1 && (
                        <button
                          className="icon-button"
                          type="button"
                          title={mergeBlocked ? 'A duplicate key is cited and cannot be removed' : `Keep ${entry.key} and merge DOI duplicates`}
                          disabled={readOnly || mergeBlocked}
                          onClick={() => mergeEntry(entry)}
                        >
                          <GitMerge size={15} />
                        </button>
                      )}
                      <button className="icon-button" type="button" title={`Edit ${entry.key}`} disabled={readOnly} onClick={() => beginEdit(entry)}>
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        title={usageCount ? `Used by ${usageCount} citation${usageCount === 1 ? '' : 's'}` : `Delete ${entry.key}`}
                        disabled={readOnly || usageCount > 0}
                        onClick={() => setPendingDeleteKey(entry.key)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {pendingDeleteKey === entry.key && (
                      <div className="reference-delete-confirmation">
                        <span>Delete {entry.key} from references.bib?</span>
                        <button type="button" onClick={() => setPendingDeleteKey(null)}>Cancel</button>
                        <button className="danger" type="button" onClick={() => deleteEntry(entry)}>Delete</button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </>
        ) : mode === 'edit' ? (
          <div className="reference-manager-form">
            <p>Edit this standard BibTeX entry. The citation key is fixed so existing manuscript citations remain valid.</p>
            <textarea aria-label="BibTeX entry" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} />
            {error && <div className="reference-form-error" role="alert">{error}</div>}
            <div className="reference-manager-form-actions">
              <button className="button secondary-button" type="button" onClick={() => resetLibrary()}>Cancel</button>
              <button className="button primary-button" type="button" disabled={readOnly || !draft.trim()} onClick={saveEdit}>Save entry</button>
            </div>
          </div>
        ) : (
          <div className="reference-manager-form">
            <p>Paste BibTeX or choose a `.bib` file. DOI duplicates are skipped; conflicting keys are renamed during import.</p>
            <label className="reference-file-picker button secondary-button">
              <Upload size={15} /> Choose .bib file
              <input type="file" accept=".bib,application/x-bibtex,text/plain" onChange={(event) => readImportFile(event.target.files?.[0])} />
            </label>
            <textarea aria-label="BibTeX to import" spellCheck={false} placeholder="@article{...}" value={draft} onChange={(event) => setDraft(event.target.value)} />
            {error && <div className="reference-form-error" role="alert">{error}</div>}
            <div className="reference-manager-form-actions">
              <button className="button secondary-button" type="button" onClick={() => resetLibrary()}>Cancel</button>
              <button className="button primary-button" type="button" disabled={readOnly || !draft.trim()} onClick={runImport}>Import references</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}