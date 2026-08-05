import {
  Bold,
  Check,
  ChevronDown,
  Code2,
  Eye,
  FilePlus2,
  FileText,
  GitFork,
  Heading2,
  Italic,
  LoaderCircle,
  MessageSquare,
  PanelLeftClose,
  Redo2,
  Save,
  Share2,
  SplitSquareHorizontal,
  Undo2,
  UserRound,
  X,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  CollaborativeEditor,
  type CollaborativeEditorHandle,
} from './components/CollaborativeEditor'
import { GitHubDialog } from './components/GitHubDialog'
import { useCollaboration } from './hooks/useCollaboration'
import { useGitHubSession } from './hooks/useGitHubSession'
import { createSnapshot, type RepositoryBinding } from './lib/github'
import { loadProfile, saveProfile } from './lib/profile'
import { sampleManuscript } from './lib/sampleManuscript'

type WorkspaceView = 'source' | 'split' | 'preview'

const MystPreview = lazy(async () => {
  const module = await import('./components/MystPreview')
  return { default: module.MystPreview }
})

const getRoomName = () => {
  const url = new URL(window.location.href)
  const room = url.searchParams.get('doc')
  if (room && /^[A-Za-z0-9_-]{8,100}$/.test(room)) return room

  const generatedRoom = crypto.randomUUID()
  url.searchParams.set('doc', generatedRoom)
  window.history.replaceState(null, '', url)
  return generatedRoom
}

const getDocumentTitle = (content: string) => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]
  return heading || 'Untitled manuscript'
}

const loadRepositoryBinding = (roomName: string): RepositoryBinding | null => {
  try {
    const binding = localStorage.getItem(`demystify.binding.${roomName}`)
    return binding ? (JSON.parse(binding) as RepositoryBinding) : null
  } catch {
    return null
  }
}

const consumeGitHubResult = () => {
  const url = new URL(window.location.href)
  const result = url.searchParams.get('github')
  if (!result) return null
  url.searchParams.delete('github')
  window.history.replaceState(null, '', url)
  return result === 'connected' ? 'GitHub connected' : 'GitHub connection failed'
}

const formatRelativeTime = (isoDate: string) => {
  const elapsedMinutes = Math.floor((Date.now() - Date.parse(isoDate)) / 60_000)
  if (elapsedMinutes < 1) return 'now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  if (elapsedMinutes < 1_440) return `${Math.floor(elapsedMinutes / 60)}h`
  return `${Math.floor(elapsedMinutes / 1_440)}d`
}

function App() {
  const [roomName] = useState(getRoomName)
  const [profile, setProfile] = useState(loadProfile)
  const [view, setView] = useState<WorkspaceView>('split')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName, setProfileName] = useState(profile.name)
  const [notice, setNotice] = useState<string | null>(consumeGitHubResult)
  const [githubDialogOpen, setGitHubDialogOpen] = useState(false)
  const [repositoryBinding, setRepositoryBinding] = useState<RepositoryBinding | null>(
    () => loadRepositoryBinding(roomName),
  )
  const [isSaving, setIsSaving] = useState(false)
  const editorRef = useRef<CollaborativeEditorHandle>(null)
  const collaboration = useCollaboration(roomName, profile, sampleManuscript)
  const github = useGitHubSession()

  const title = getDocumentTitle(collaboration.content)
  const wordCount = collaboration.content.trim()
    ? collaboration.content.trim().split(/\s+/).length
    : 0

  const showNotice = (message: string) => {
    setNotice(message)
  }

  useEffect(() => {
    const storageKey = `demystify.binding.${roomName}`
    if (repositoryBinding) {
      localStorage.setItem(storageKey, JSON.stringify(repositoryBinding))
    } else {
      localStorage.removeItem(storageKey)
    }
  }, [repositoryBinding, roomName])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 2_400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const shareDocument = async () => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('doc', roomName)
      await navigator.clipboard.writeText(url.toString())
      showNotice('Collaboration link copied')
    } catch {
      showNotice('Could not copy the collaboration link')
    }
  }

  const createDocument = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('doc', crypto.randomUUID())
    window.location.assign(url)
  }

  const submitComment = () => {
    collaboration.addComment(commentDraft)
    setCommentDraft('')
  }

  const updateProfile = () => {
    const nextName = profileName.trim()
    if (!nextName) return
    const nextProfile = { ...profile, name: nextName }
    saveProfile(nextProfile)
    setProfile(nextProfile)
    setEditingProfile(false)
  }

  const saveToGitHub = async () => {
    if (!github.session?.user || !repositoryBinding) {
      setGitHubDialogOpen(true)
      return false
    }

    setIsSaving(true)
    try {
      const snapshot = await createSnapshot(repositoryBinding, collaboration.content)
      showNotice(`Committed ${snapshot.commitSha.slice(0, 7)} to ${snapshot.branchName}`)
      return true
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'GitHub save failed')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const openRepositoryFile = (binding: RepositoryBinding, content: string) => {
    collaboration.replaceContent(content)
    setRepositoryBinding(binding)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <button
            className="icon-button mobile-sidebar-toggle"
            type="button"
            title="Toggle files"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <PanelLeftClose size={18} />
          </button>
          <div className="brand-mark" aria-hidden="true">D</div>
          <div>
            <div className="brand-name">DeMystify</div>
            <div className="workspace-name">Collaborative MyST</div>
          </div>
        </div>

        <div className="document-identity">
          <span className="document-title">{title}</span>
          <span className={`sync-status ${collaboration.status}`}>
            <span className="status-dot" />
            {collaboration.status === 'connected' ? 'Live' : collaboration.status}
          </span>
        </div>

        <div className="topbar-actions">
          <div className="collaborator-stack" aria-label="Current collaborators">
            {collaboration.collaborators.slice(0, 4).map((collaborator) => (
              <button
                className="avatar"
                key={collaborator.clientId}
                style={{ background: collaborator.colorLight, color: collaborator.color }}
                title={collaborator.name}
                type="button"
                onClick={() => {
                  if (collaborator.id === profile.id) setEditingProfile(true)
                }}
              >
                {collaborator.name.slice(0, 1).toUpperCase()}
              </button>
            ))}
          </div>
          <button className="button secondary-button" type="button" onClick={shareDocument}>
            <Share2 size={16} />
            <span>Share</span>
          </button>
          <button
            className="button github-button"
            type="button"
            disabled={isSaving}
            onClick={() => {
              if (github.session?.user && repositoryBinding) void saveToGitHub()
              else setGitHubDialogOpen(true)
            }}
          >
            {isSaving ? <LoaderCircle className="spin" size={16} /> : <GitFork size={16} />}
            <span>
              {github.session?.user && repositoryBinding ? 'Save to GitHub' : 'Connect GitHub'}
            </span>
          </button>
        </div>
      </header>

      <main className={`workspace ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <aside className={`file-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-heading">
            <span>Workspace</span>
            <button className="icon-button" type="button" title="New document" onClick={createDocument}>
              <FilePlus2 size={16} />
            </button>
          </div>
          <button className="repository-picker" type="button" onClick={() => setGitHubDialogOpen(true)}>
            <span className="repository-icon"><GitFork size={15} /></span>
            <span>
              <strong>{repositoryBinding?.fullName ?? 'Local draft'}</strong>
              <small>{repositoryBinding?.path ?? 'Not connected'}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          <nav className="file-tree" aria-label="Manuscript files">
            <span className="tree-label">Files</span>
            <button className="file-row active" type="button">
              <FileText size={16} />
              <span>manuscript.md</span>
              <span className="live-file-dot" title="Live document" />
            </button>
          </nav>
          <div className="sidebar-footer">
            <Code2 size={15} />
            <span>MyST source</span>
            <span className="branch-name">{repositoryBinding?.branchName ?? 'main'}</span>
          </div>
        </aside>

        <section className="manuscript-workspace">
          <div className="editor-toolbar">
            <div className="formatting-tools" aria-label="Formatting tools">
              <button className="icon-button" type="button" title="Undo" onClick={() => editorRef.current?.undo()}>
                <Undo2 size={17} />
              </button>
              <button className="icon-button" type="button" title="Redo" onClick={() => editorRef.current?.redo()}>
                <Redo2 size={17} />
              </button>
              <span className="toolbar-divider" />
              <button className="icon-button" type="button" title="Heading" onClick={() => editorRef.current?.prefixLine('## ')}>
                <Heading2 size={17} />
              </button>
              <button className="icon-button" type="button" title="Bold" onClick={() => editorRef.current?.wrapSelection('**')}>
                <Bold size={17} />
              </button>
              <button className="icon-button" type="button" title="Italic" onClick={() => editorRef.current?.wrapSelection('*')}>
                <Italic size={17} />
              </button>
              <button className="icon-button" type="button" title="Inline code" onClick={() => editorRef.current?.wrapSelection('`')}>
                <Code2 size={17} />
              </button>
              <span className="toolbar-divider" />
              <button className="icon-button" type="button" title="Open comments" onClick={() => setCommentsOpen((open) => !open)}>
                <MessageSquare size={17} />
                {collaboration.comments.filter((comment) => !comment.resolved).length > 0 && (
                  <span className="comment-count">
                    {collaboration.comments.filter((comment) => !comment.resolved).length}
                  </span>
                )}
              </button>
            </div>

            <div className="view-switcher" aria-label="Workspace view">
              <button className={view === 'source' ? 'active' : ''} type="button" title="Source only" onClick={() => setView('source')}>
                <Code2 size={15} /><span>Source</span>
              </button>
              <button className={view === 'split' ? 'active' : ''} type="button" title="Split view" onClick={() => setView('split')}>
                <SplitSquareHorizontal size={15} /><span>Split</span>
              </button>
              <button className={view === 'preview' ? 'active' : ''} type="button" title="Preview only" onClick={() => setView('preview')}>
                <Eye size={15} /><span>Preview</span>
              </button>
            </div>

            <div className="document-stats">
              <span>{wordCount.toLocaleString()} words</span>
              <button className="icon-button" type="button" title="Save snapshot to GitHub" disabled={isSaving} onClick={() => void saveToGitHub()}>
                {isSaving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              </button>
            </div>
          </div>

          <div className={`document-panes view-${view} ${commentsOpen ? 'comments-open' : ''}`}>
            <section className="source-pane" aria-label="MyST source editor">
              {collaboration.sharedText && collaboration.provider ? (
                <CollaborativeEditor
                  ref={editorRef}
                  sharedText={collaboration.sharedText}
                  provider={collaboration.provider}
                />
              ) : (
                <div className="pane-loading">Opening shared document...</div>
              )}
            </section>

            <section className="preview-pane" aria-label="Publication preview">
              <div className="preview-label">
                <span>Publication preview</span>
                <span>{collaboration.isSynced ? 'MyST 1.0' : 'Preparing'}</span>
              </div>
              <Suspense fallback={<div className="pane-loading">Rendering MyST...</div>}>
                <MystPreview content={collaboration.content} />
              </Suspense>
            </section>

            {commentsOpen && (
              <aside className="comments-panel" aria-label="Comments">
                <div className="comments-heading">
                  <div>
                    <strong>Comments</strong>
                    <span>{collaboration.comments.filter((comment) => !comment.resolved).length} open</span>
                  </div>
                  <button className="icon-button" type="button" title="Close comments" onClick={() => setCommentsOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="comment-composer">
                  <textarea
                    aria-label="New comment"
                    placeholder="Leave a comment..."
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitComment()
                    }}
                  />
                  <button className="button comment-button" type="button" disabled={!commentDraft.trim()} onClick={submitComment}>
                    Comment
                  </button>
                </div>
                <div className="comment-list">
                  {collaboration.comments.length === 0 ? (
                    <div className="comments-empty">
                      <MessageSquare size={20} />
                      <span>No comments yet</span>
                    </div>
                  ) : collaboration.comments.map((comment) => (
                    <article className={`comment ${comment.resolved ? 'resolved' : ''}`} key={comment.id}>
                      <div className="comment-meta">
                        <span className="mini-avatar" style={{ background: `${comment.authorColor}1f`, color: comment.authorColor }}>
                          {comment.authorName.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{comment.authorName}</strong>
                        <time dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
                      </div>
                      <p>{comment.body}</p>
                      <button type="button" onClick={() => collaboration.toggleComment(comment)}>
                        <Check size={13} /> {comment.resolved ? 'Reopen' : 'Resolve'}
                      </button>
                    </article>
                  ))}
                </div>
              </aside>
            )}
          </div>
        </section>
      </main>

      {editingProfile && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingProfile(false)}>
          <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-icon"><UserRound size={20} /></div>
            <h2 id="profile-title">Your collaborator name</h2>
            <p>This name appears beside your cursor and comments.</p>
            <input autoFocus value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') updateProfile() }} />
            <div className="dialog-actions">
              <button className="button secondary-button" type="button" onClick={() => setEditingProfile(false)}>Cancel</button>
              <button className="button primary-button" type="button" onClick={updateProfile}>Save name</button>
            </div>
          </section>
        </div>
      )}

      <GitHubDialog
        open={githubDialogOpen}
        roomName={roomName}
        documentTitle={title}
        session={github.session}
        sessionLoading={github.isLoading}
        binding={repositoryBinding}
        onClose={() => setGitHubDialogOpen(false)}
        onOpenFile={openRepositoryFile}
        onBindDraft={setRepositoryBinding}
        onSave={saveToGitHub}
        onDisconnect={async () => {
          await github.disconnect()
          showNotice('GitHub disconnected')
        }}
        onNotice={showNotice}
      />

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

export default App