import { ArrowLeft, BookmarkPlus, Clock3, FileDiff, FileText, LoaderCircle, PencilLine, RefreshCw, RotateCcw } from 'lucide-react'
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'
import { structuredPatch } from 'diff'
import {
  createDocumentVersion, listDocumentVersions, previewDocumentVersion, renameDocumentVersion, restoreDocumentVersion,
  getRepositoryAssetBaseUrl, type RepositoryBinding,
} from '../lib/github'
import type { DocumentSnapshot, DocumentVersion, VersionPreview } from '../lib/documentHistory'
import { materializeBibliography, type GeneratedReferenceEntry } from '../lib/references'

const MystPreview = lazy(() => import('./MystPreview').then((module) => ({ default: module.MystPreview })))
const sourceFor = (snapshot: DocumentSnapshot, path: string, primaryPath: string) => {
  if (path === primaryPath) return snapshot.metadata.some(([key, value]) => key === 'workingContentInitialized' && value === true)
    ? snapshot.workingContent : snapshot.content
  if (path === 'Bibliography') return snapshot.bibliography
  if (path === 'MyST configuration') return snapshot.mystConfig
  return snapshot.projectFiles.find(([file]) => file === path)?.[1] ?? ''
}
const labelFor = (version: DocumentVersion) => version.name ?? new Date(version.createdAt)
  .toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Manuscript history is unavailable.'

export const VersionHistory = ({ roomName, binding, canRestore, onClose, onNotice }: {
  roomName: string
  binding: RepositoryBinding | null
  canRestore: boolean
  onClose: () => void
  onNotice: (message: string) => void
}) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef(0)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [preview, setPreview] = useState<VersionPreview | null>(null)
  const [revision, setRevision] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const [mode, setMode] = useState<'preview' | 'changes'>('preview')
  const [name, setName] = useState('')
  const primaryPath = binding?.path ?? 'manuscript.md'
  const [path, setPath] = useState(primaryPath)

  const select = async (id: string) => {
    const current = ++request.current
    setLoading(true)
    setError(null)
    try {
      const result = await previewDocumentVersion(roomName, id)
      if (request.current !== current) return
      setPreview(result)
      setRevision(result.revision)
    } catch (error) {
      if (request.current === current) setError(errorMessage(error))
    } finally {
      if (request.current === current) setLoading(false)
    }
  }

  const refresh = async (selectId?: string, before?: number) => {
    const result = await listDocumentVersions(roomName, before)
    setVersions((current) => before ? [...current, ...result.versions] : result.versions)
    setCursor(result.nextCursor)
    setRevision(result.revision)
    if (selectId ?? (!before && !preview ? result.versions[0]?.id : undefined)) {
      await select(selectId ?? result.versions[0].id)
    }
    return result
  }
  const selectFromEffect = useEffectEvent((id: string) => select(id))

  useEffect(() => {
    dialog.current?.showModal()
    let active = true
    void listDocumentVersions(roomName).then(async (result) => {
      if (!active) return
      setVersions(result.versions)
      setCursor(result.nextCursor)
      setRevision(result.revision)
      if (result.versions[0]) await selectFromEffect(result.versions[0].id)
      else setLoading(false)
    }).catch((error: unknown) => { if (active) { setError(errorMessage(error)); setLoading(false) } })
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void listDocumentVersions(roomName).then((result) => {
        if (!active) return
        setVersions((current) => [...result.versions, ...current.filter((version) => version.sequence < (result.versions.at(-1)?.sequence ?? 0))])
        setRevision(result.revision)
      }).catch((error: unknown) => { if (active) setError(errorMessage(error)) })
    }, 15_000)
    return () => { active = false; request.current += 1; window.clearInterval(timer) }
  }, [roomName])

  const saveNamed = async () => {
    if (!name.trim() || !canRestore) return
    setBusy(true)
    setError(null)
    try {
      const version = await createDocumentVersion(roomName, name.trim())
      setName('')
      await refresh(version.id)
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const rename = async () => {
    if (!preview || !canRestore) return
    const value = window.prompt('Name this version', preview.version.name ?? '')
    if (!value?.trim()) return
    setBusy(true)
    try { await renameDocumentVersion(roomName, preview.version.id, value.trim()); await refresh(preview.version.id) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const restore = async () => {
    if (!preview || !canRestore || revision !== preview.revision) return
    if (!window.confirm(`Restore "${labelFor(preview.version)}"? The current draft will be saved as a safety version. Comments and review history are retained.`)) return
    setBusy(true)
    setError(null)
    try {
      const version = await restoreDocumentVersion(roomName, preview.version.id, preview.revision)
      await refresh(version.id)
      onNotice('Version restored. The previous draft remains in history.')
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const source = preview ? sourceFor(preview.snapshot, path, primaryPath) : ''
  const currentSource = preview ? sourceFor(preview.current, path, primaryPath) : ''
  const hunks = mode === 'changes' ? structuredPatch(path, path, source, currentSource, '', '', { context: 3 }).hunks : []
  const isCurrent = preview && JSON.stringify(preview.snapshot) === JSON.stringify(preview.current)
  const paths = Array.from(new Set([primaryPath, ...(preview?.snapshot.projectFiles.map(([file]) => file) ?? []), 'Bibliography', 'MyST configuration']))
  const bibliography = preview ? materializeBibliography(preview.snapshot.bibliography,
    preview.snapshot.references.map(([, value]) => value) as GeneratedReferenceEntry[]) : ''

  return <dialog ref={dialog} className="version-history-dialog" aria-label="Version history" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="editor-toolbar history-bar">
      <button className="icon-button" type="button" title="Back to document" disabled={busy} onClick={onClose}><ArrowLeft size={18} /></button>
      <div className="history-heading"><h2>Version history</h2><span>{preview ? labelFor(preview.version) : 'Loading versions...'}</span></div>
      {preview && <button className="button secondary-button" type="button" disabled={busy || loading || !canRestore || Boolean(isCurrent) || revision !== preview.revision} onClick={() => void restore()}><RotateCcw size={15} /> Restore this version</button>}
    </header>
    <div className="history-workspace">
      <main className="history-preview" aria-label="Version preview">
        {error && <div className="github-error" role="alert">{error}</div>}
        {revision && preview && revision !== preview.revision && <p role="status">The draft changed. Refresh the preview before restoring.</p>}
        {!canRestore && <p className="permission-note" role="status">Read-only history. Restore requires a writable, server-saved draft.</p>}
        {preview && <div className="history-preview-controls">
          <select aria-label="Version file" value={path} onChange={(event) => setPath(event.target.value)}>{paths.map((file) => <option key={file} value={file}>{file}</option>)}</select>
          <div className="view-switcher" role="group" aria-label="History view">
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}><FileText size={14} /> Preview</button>
            <button type="button" aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}><FileDiff size={14} /> Changes</button>
          </div>
          <button className="icon-button" type="button" title="Refresh version preview" disabled={loading || busy} onClick={() => void refresh(preview.version.id).catch((error: unknown) => setError(errorMessage(error)))}><RefreshCw size={14} /></button>
        </div>}
        {loading ? <div className="pane-loading"><LoaderCircle className="spin" size={18} /> Loading version...</div>
          : !preview ? <p>No saved versions yet.</p>
          : mode === 'changes' ? <section className="history-changes" aria-label="Changes since this version">
            <div className="version-diff-legend"><span>- Selected version</span><span>+ Current draft</span></div>
            {hunks.length === 0 ? <p>No text differences in this file.</p> : hunks.map((hunk) => <div className="version-diff-hunk" key={`${hunk.oldStart}:${hunk.newStart}`}>
              <div className="version-diff-location">Version line {hunk.oldStart} / current line {hunk.newStart}</div>
              <pre>{hunk.lines.map((line, index) => <code key={index} data-change={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context'}>{line}</code>)}</pre>
            </div>)}
          </section>
          : <Suspense fallback={<div className="pane-loading">Rendering version...</div>}><MystPreview content={source} bibliography={bibliography}
            projectFiles={Object.fromEntries(preview.snapshot.projectFiles)} sourcePath={path}
            assetBaseUrl={binding ? getRepositoryAssetBaseUrl(binding) : undefined} /></Suspense>}
      </main>
      <aside className="history-timeline" aria-label="Saved versions">
        <div className="repository-controls"><label>Versions<select aria-label="History filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All versions</option><option value="named">Named versions</option>
        </select></label></div>
        <ol>{versions.filter((version) => filter === 'all' || version.name).map((version, index, visible) => {
          const date = new Date(version.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
          const previousDate = index > 0 ? new Date(visible[index - 1].createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''
          return <li key={version.id}>
            {date !== previousDate && <h3>{date}</h3>}
            <button className="history-version" type="button" aria-label={`Preview version: ${labelFor(version)}`} aria-pressed={preview?.version.id === version.id} disabled={busy} onClick={() => void select(version.id)}>
              <strong>{version.name ?? new Date(version.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}</strong>
              <small>{version.kind === 'restore' ? 'Restored version' : version.kind === 'safety' ? 'Safety checkpoint' : version.name ? 'Named version' : 'Automatic checkpoint'}</small>
              <span>{version.authors.map((author) => author.name).join(', ') || 'Server checkpoint'}</span>
              {version.id === versions[0]?.id && <small>Latest saved version</small>}
            </button>
          </li>
        })}{cursor && <li><button className="button secondary-button" type="button" disabled={busy} onClick={() => void refresh(undefined, cursor).catch((error: unknown) => setError(errorMessage(error)))}>Load older versions</button></li>}</ol>
        <form className="repository-controls history-name" onSubmit={(event) => { event.preventDefault(); void saveNamed() }}>
          <label>Name current version<input aria-label="Version name" value={name} maxLength={120} disabled={busy || !canRestore} onChange={(event) => setName(event.target.value)} /></label>
          <button className="icon-button" type="submit" title="Save named version" disabled={busy || !canRestore || !name.trim()}><BookmarkPlus size={18} /></button>
          <button className="icon-button" type="button" title="Name selected version" disabled={busy || !canRestore || !preview} onClick={() => void rename()}><PencilLine size={16} /></button>
        </form>
        <div className="history-caption"><Clock3 size={13} /> Server checkpoints</div>
      </aside>
    </div>
  </dialog>
}