import {
  Archive,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Eye,
  ExternalLink,
  FilePlus2,
  FileText,
  GitFork,
  GitBranchPlus,
  GitPullRequest,
  Heading2,
  Italic,
  LoaderCircle,
  LogIn,
  MessageSquare,
  PanelLeftClose,
  Redo2,
  RefreshCw,
  Reply,
  Save,
  Share2,
  SplitSquareHorizontal,
  TextQuote,
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
import { ShareDialog } from './components/ShareDialog'
import { useCollaboration, type SharedComment } from './hooks/useCollaboration'
import { useGitHubSession } from './hooks/useGitHubSession'
import { useRoomAccess } from './hooks/useRoomAccess'
import { useShareSession } from './hooks/useViewerSession'
import {
  createSnapshot,
  loadRepositoryFile,
  mirrorRoomComment,
  mirrorRoomCommentReply,
  startRoomRevision,
  syncRoomComments,
  type RepositoryBinding,
} from './lib/github'
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

const consumeGitHubResult = () => {
  const url = new URL(window.location.href)
  const result = url.searchParams.get('github')
  if (!result) return null
  url.searchParams.delete('github')
  window.history.replaceState(null, '', url)
  return result === 'connected' ? 'GitHub connected' : 'GitHub connection failed'
}

const shouldInitializeRevision = () =>
  new URL(window.location.href).searchParams.get('revision') === '1'

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
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName, setProfileName] = useState(profile.name)
  const [notice, setNotice] = useState<string | null>(consumeGitHubResult)
  const [githubDialogOpen, setGitHubDialogOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCheckingEditAccess, setIsCheckingEditAccess] = useState(false)
  const [isStartingRevision, setIsStartingRevision] = useState(false)
  const [initializeRevision] = useState(shouldInitializeRevision)
  const [revisionInitialContent, setRevisionInitialContent] = useState<string | null>(
    initializeRevision ? null : sampleManuscript,
  )
  const [revisionInitializationError, setRevisionInitializationError] = useState<string | null>(null)
  const [commentSyncErrors, setCommentSyncErrors] = useState<Record<string, string>>({})
  const [commentPollError, setCommentPollError] = useState<string | null>(null)
  const [commentSyncRevision, setCommentSyncRevision] = useState(0)
  const editorRef = useRef<CollaborativeEditorHandle>(null)
  const commentSyncAttempts = useRef(new Map<string, string>())
  const messageSyncAttempts = useRef(new Map<string, string>())
  const github = useGitHubSession()
  const shareSession = useShareSession(roomName)
  const principalKey = github.session?.user
    ? `user:${github.session.user.id}`
    : 'anonymous'
  const roomAccess = useRoomAccess(
    roomName,
    principalKey,
    !github.isLoading && !shareSession.isLoading,
  )
  const repositoryBinding = roomAccess.binding
  const repositoryInvitationUrl = repositoryBinding
    ? `https://github.com/${repositoryBinding.fullName}/invitations`
    : null
  const anonymousRole = roomAccess.room?.access === 'editor'
    ? null
    : roomAccess.room?.access ?? shareSession.role
  const isViewer = anonymousRole === 'viewer'
  const isGuestCollaborator = anonymousRole === 'collaborator'
  const isArchived =
    roomAccess.review?.state === 'closed' || roomAccess.review?.state === 'merged'
  const isReadOnly = Boolean(anonymousRole) || isArchived
  const roomReviewNumber = roomAccess.review?.number
  const refreshRoom = roomAccess.refresh
  const collaborationProfile = github.session?.user
    ? {
        ...profile,
        id: `github:${github.session.user.id}`,
        name: github.session.user.name ?? github.session.user.login,
      }
    : profile
  const collaboration = useCollaboration(
    roomName,
    collaborationProfile,
    revisionInitialContent ?? sampleManuscript,
    roomAccess.isReady && revisionInitialContent !== null,
    isReadOnly,
  )
  const sharedComments = collaboration.comments
  const applyCommentMirror = collaboration.applyCommentMirror
  const applyCommentMessageMirror = collaboration.applyCommentMessageMirror
  const applyGitHubCommentSync = collaboration.applyGitHubCommentSync
  const sharedCommentMessages = collaboration.commentMessages
  const resolveCommentAnchor = collaboration.resolveAnchor
  const commentLocations = new Map(sharedComments.map((comment) => [
    comment.id,
    resolveCommentAnchor(comment),
  ]))
  const commentHighlights = sharedComments.flatMap((comment) => {
    const location = commentLocations.get(comment.id)
    return location && !location.orphaned
      ? [{
          id: comment.id,
          from: location.from,
          to: location.to,
          resolved: comment.resolved,
          active: activeCommentId === comment.id,
        }]
      : []
  })

  const title = getDocumentTitle(collaboration.content)
  const activeFileName = repositoryBinding?.path.split('/').at(-1) ?? 'manuscript.md'
  const wordCount = collaboration.content.trim()
    ? collaboration.content.trim().split(/\s+/).length
    : 0

  const showNotice = (message: string) => {
    setNotice(message)
  }

  const signInToEdit = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`
    window.location.assign(
      `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
    )
  }

  const recheckEditAccess = async () => {
    setIsCheckingEditAccess(true)
    try {
      const refreshedRoom = await refreshRoom()
      showNotice(
        refreshedRoom?.access === 'editor'
          ? 'Repository write access confirmed'
          : 'GitHub still reports no write access. Accept any pending repository invitation, then try again.',
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not recheck repository access')
    } finally {
      setIsCheckingEditAccess(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 2_400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!initializeRevision || !roomAccess.isReady || !repositoryBinding) return
    let active = true
    loadRepositoryFile(repositoryBinding)
      .then((file) => {
        if (!active) return
        setRevisionInitialContent(file.content)
        setRevisionInitializationError(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setRevisionInitializationError(
          error instanceof Error
            ? error.message
            : 'The next revision could not load its base manuscript.',
        )
      })
    return () => {
      active = false
    }
  }, [initializeRevision, repositoryBinding, roomAccess.isReady])

  useEffect(() => {
    if (!roomReviewNumber) return
    let active = true
    const refresh = () => {
      void refreshRoom().catch((error: unknown) => {
        if (!active) return
        showNotice(error instanceof Error ? error.message : 'Room status refresh failed')
      })
    }
    const interval = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [refreshRoom, roomReviewNumber])

  useEffect(() => {
    const reviewNumber = roomAccess.review?.number
    if (!reviewNumber || isReadOnly) return

    for (const comment of sharedComments) {
      if (comment.github?.resolved === comment.resolved) continue
      const version = `${reviewNumber}:${comment.resolved}:${comment.body}`
      if (commentSyncAttempts.current.get(comment.id) === version) continue
      commentSyncAttempts.current.set(comment.id, version)
      const location = resolveCommentAnchor(comment)

      void mirrorRoomComment(roomName, {
        ...comment,
        githubCommentId: comment.github?.id,
        githubMode: comment.github?.mode,
        anchor: location && !location.orphaned
          ? {
              startLine: location.startLine,
              endLine: location.endLine,
              quote: location.quote,
            }
          : undefined,
      })
        .then((mirror) => {
          applyCommentMirror(comment.id, mirror, comment.resolved)
          setCommentSyncErrors((current) => {
            if (!(comment.id in current)) return current
            const next = { ...current }
            delete next[comment.id]
            return next
          })
        })
        .catch((error: unknown) => {
          setCommentSyncErrors((current) => ({
            ...current,
            [comment.id]: error instanceof Error
              ? error.message
              : 'GitHub comment sync failed.',
          }))
        })
    }
  }, [
    applyCommentMirror,
    commentSyncRevision,
    roomAccess.review?.number,
    isReadOnly,
    resolveCommentAnchor,
    roomName,
    sharedComments,
  ])

  useEffect(() => {
    if (!roomAccess.review?.number || isReadOnly) return
    let active = true
    const sync = () => {
      void syncRoomComments(roomName)
        .then((result) => {
          if (!active) return
          applyGitHubCommentSync(result)
          setCommentPollError(null)
        })
        .catch((error: unknown) => {
          if (!active) return
          setCommentPollError(
            error instanceof Error ? error.message : 'GitHub thread sync failed.',
          )
        })
    }
    sync()
    const interval = window.setInterval(sync, 15_000)
    window.addEventListener('focus', sync)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
    }
  }, [applyGitHubCommentSync, isReadOnly, roomAccess.review?.number, roomName])

  useEffect(() => {
    const reviewNumber = roomAccess.review?.number
    if (!reviewNumber || isReadOnly) return

    for (const message of sharedCommentMessages) {
      if (message.github) continue
      const thread = sharedComments.find((comment) => comment.id === message.threadId)
      if (!thread?.github) continue
      const version = `${reviewNumber}:${thread.github.id}:${message.body}`
      if (messageSyncAttempts.current.get(message.id) === version) continue
      messageSyncAttempts.current.set(message.id, version)

      void mirrorRoomCommentReply(roomName, thread.id, {
        id: message.id,
        githubCommentId: message.github?.id,
        rootGitHubCommentId: thread.github.id,
        mode: thread.github.mode ?? 'conversation',
        authorName: message.authorName,
        body: message.body,
      })
        .then((mirror) => {
          applyCommentMessageMirror(message.id, mirror)
          setCommentSyncErrors((current) => {
            if (!(message.id in current)) return current
            const next = { ...current }
            delete next[message.id]
            return next
          })
        })
        .catch((error: unknown) => {
          setCommentSyncErrors((current) => ({
            ...current,
            [message.id]: error instanceof Error
              ? error.message
              : 'GitHub reply sync failed.',
          }))
        })
    }
  }, [
    applyCommentMessageMirror,
    commentSyncRevision,
    roomAccess.review?.number,
    isReadOnly,
    roomName,
    sharedCommentMessages,
    sharedComments,
  ])

  const shareDocument = () => {
    setShareDialogOpen(true)
  }

  const createDocument = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('doc', crypto.randomUUID())
    url.searchParams.delete('revision')
    window.location.assign(url)
  }

  const startNextRevision = async () => {
    if (!isReadOnly) return
    setIsStartingRevision(true)
    try {
      const nextRoom = await startRoomRevision(roomName)
      const url = new URL(window.location.href)
      url.searchParams.set('doc', nextRoom.roomName)
      url.searchParams.set('revision', '1')
      window.location.assign(url)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not start the next revision')
      setIsStartingRevision(false)
    }
  }

  const submitComment = () => {
    const commentId = collaboration.addComment(
      commentDraft,
      editorRef.current?.getCommentSelection() ?? undefined,
    )
    if (commentId) setActiveCommentId(commentId)
    setCommentDraft('')
  }

  const submitReply = (comment: SharedComment) => {
    const draft = replyDrafts[comment.id] ?? ''
    if (!collaboration.addCommentReply(comment.id, draft)) return
    setReplyDrafts((current) => ({ ...current, [comment.id]: '' }))
  }

  const openCommentThread = (commentId: string) => {
    setCommentsOpen(true)
    setActiveCommentId(commentId)
    const location = commentLocations.get(commentId)
    if (!location || location.orphaned) return
    if (view === 'preview') setView('split')
    window.requestAnimationFrame(() => {
      editorRef.current?.revealRange(location.from, location.to)
    })
  }

  const retryCommentSync = (comment: SharedComment) => {
    commentSyncAttempts.current.delete(comment.id)
    setCommentSyncRevision((revision) => revision + 1)
  }

  const retryMessageSync = (messageId: string) => {
    messageSyncAttempts.current.delete(messageId)
    setCommentSyncRevision((revision) => revision + 1)
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
    if (isReadOnly) {
      showNotice('This room is archived. Start the next revision to continue editing.')
      return false
    }
    if (!github.session?.user || !repositoryBinding) {
      setGitHubDialogOpen(true)
      return false
    }

    setIsSaving(true)
    try {
      const snapshot = await createSnapshot(
        roomName,
        collaboration.getSnapshotContent(),
      )
      roomAccess.applyReview(snapshot.review)
      showNotice(
        snapshot.unchanged
          ? `${snapshot.branchName} is already current`
          : snapshot.review
            ? `Committed ${snapshot.commitSha.slice(0, 7)}; PR #${snapshot.review.number} ready`
            : `Committed ${snapshot.commitSha.slice(0, 7)} to ${snapshot.branchName}`,
      )
      return true
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'GitHub save failed')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const openRepositoryFile = async (binding: RepositoryBinding, content: string) => {
    if (isReadOnly) return
    await roomAccess.bind(binding)
    collaboration.replaceContent(content)
  }

  const bindRepositoryDraft = async (binding: RepositoryBinding) => {
    if (isReadOnly) return
    await roomAccess.bind(binding)
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
          <span className={`sync-status ${isArchived ? 'archived' : anonymousRole ? 'viewer' : collaboration.status}`}>
            <span className="status-dot" />
            {isArchived
              ? 'Archived'
              : isViewer
                ? 'Viewing'
                : isGuestCollaborator
                  ? 'Read access'
                  : collaboration.status === 'connected'
                    ? 'Live'
                    : collaboration.status}
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
                  if (
                    collaborator.id === collaborationProfile.id &&
                    !github.session?.user
                  ) {
                    setEditingProfile(true)
                  }
                }}
              >
                {collaborator.name.slice(0, 1).toUpperCase()}
              </button>
            ))}
          </div>
          {!anonymousRole && (
            <button className="button secondary-button" type="button" onClick={shareDocument}>
              <Share2 size={16} />
              <span>Share</span>
            </button>
          )}
          {isViewer ? (
            <button className="button viewer-button" type="button" disabled>
              <Eye size={16} />
              <span>View only</span>
            </button>
          ) : isGuestCollaborator && !isArchived ? (
            github.session?.user ? (
              <button
                className="button github-button"
                type="button"
                disabled={isCheckingEditAccess}
                onClick={() => void recheckEditAccess()}
              >
                {isCheckingEditAccess
                  ? <LoaderCircle className="spin" size={16} />
                  : <RefreshCw size={16} />}
                <span>{isCheckingEditAccess ? 'Checking access' : 'Recheck access'}</span>
              </button>
            ) : (
              <button className="button github-button" type="button" onClick={signInToEdit}>
                <LogIn size={16} />
                <span>Sign in to edit</span>
              </button>
            )
          ) : (
            <button
              className="button github-button"
              type="button"
              disabled={isSaving}
              onClick={() => {
                if (isArchived && roomAccess.review) {
                  window.open(roomAccess.review.htmlUrl, '_blank', 'noopener,noreferrer')
                } else if (github.session?.user && repositoryBinding) void saveToGitHub()
                else setGitHubDialogOpen(true)
              }}
            >
              {isSaving
                ? <LoaderCircle className="spin" size={16} />
                : isArchived
                  ? <Archive size={16} />
                  : <GitFork size={16} />}
              <span>
                {isArchived
                  ? 'Open PR'
                  : github.session?.user && repositoryBinding
                    ? 'Save to GitHub'
                    : 'Connect GitHub'}
              </span>
            </button>
          )}
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
          <button className="repository-picker" type="button" disabled={isReadOnly} onClick={() => setGitHubDialogOpen(true)}>
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
              <span>{activeFileName}</span>
              <span className="live-file-dot" title="Live document" />
            </button>
          </nav>
          <div
            className="sidebar-footer"
            title={repositoryBinding?.branchName ?? 'main'}
          >
            <Code2 size={15} />
            <span>MyST source</span>
            {roomAccess.review ? (
              <a
                className="review-link"
                href={roomAccess.review.htmlUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open pull request #${roomAccess.review.number}`}
              >
                <GitPullRequest size={13} />
                <span>PR #{roomAccess.review.number}</span>
              </a>
            ) : (
              <span className="branch-name">{repositoryBinding?.branchName ?? 'main'}</span>
            )}
          </div>
        </aside>

        <section className={`manuscript-workspace ${isReadOnly ? 'archived' : ''}`}>
          {anonymousRole ? (
            <div className="archive-banner viewer-banner" role="status">
              <Eye size={18} />
              <div>
                <strong>{isViewer ? 'View-only access' : 'Collaborator link'}</strong>
                <span>
                  {isViewer
                    ? 'Live manuscript updates and review history are available; editing is disabled.'
                    : github.session?.user
                      ? (
                          <>
                            GitHub still reports no repository write access.{' '}
                            {repositoryInvitationUrl ? (
                              <>
                                <a href={repositoryInvitationUrl} target="_blank" rel="noreferrer">
                                  Accept any pending invitation
                                </a>
                                , then select Recheck access.
                              </>
                            ) : 'Ask the owner for repository write access, then select Recheck access.'}
                          </>
                        )
                      : 'You can read now. Sign in with GitHub and accepted repository write access to edit.'}
                </span>
              </div>
              {roomAccess.review && (
                <a href={roomAccess.review.htmlUrl} target="_blank" rel="noreferrer">
                  PR #{roomAccess.review.number}
                </a>
              )}
            </div>
          ) : isArchived && roomAccess.review ? (
            <div className="archive-banner" role="status">
              <Archive size={18} />
              <div>
                <strong>Revision {roomAccess.review.state}</strong>
                <span>This room is read-only. Its text and review history remain available.</span>
              </div>
              <a href={roomAccess.review.htmlUrl} target="_blank" rel="noreferrer">
                PR #{roomAccess.review.number}
              </a>
              <button
                className="button primary-button"
                type="button"
                disabled={isStartingRevision}
                onClick={() => void startNextRevision()}
              >
                {isStartingRevision
                  ? <LoaderCircle className="spin" size={15} />
                  : <GitBranchPlus size={15} />}
                Start next revision
              </button>
            </div>
          ) : null}
          <div className="editor-toolbar">
            <div className="formatting-tools" aria-label="Formatting tools">
              <button className="icon-button" type="button" title="Undo" disabled={isReadOnly} onClick={() => editorRef.current?.undo()}>
                <Undo2 size={17} />
              </button>
              <button className="icon-button" type="button" title="Redo" disabled={isReadOnly} onClick={() => editorRef.current?.redo()}>
                <Redo2 size={17} />
              </button>
              <span className="toolbar-divider" />
              <button className="icon-button" type="button" title="Heading" disabled={isReadOnly} onClick={() => editorRef.current?.prefixLine('## ')}>
                <Heading2 size={17} />
              </button>
              <button className="icon-button" type="button" title="Bold" disabled={isReadOnly} onClick={() => editorRef.current?.wrapSelection('**')}>
                <Bold size={17} />
              </button>
              <button className="icon-button" type="button" title="Italic" disabled={isReadOnly} onClick={() => editorRef.current?.wrapSelection('*')}>
                <Italic size={17} />
              </button>
              <button className="icon-button" type="button" title="Inline code" disabled={isReadOnly} onClick={() => editorRef.current?.wrapSelection('`')}>
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
              <button className="icon-button" type="button" title="Save snapshot to GitHub" disabled={isSaving || isReadOnly} onClick={() => void saveToGitHub()}>
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
                  commentHighlights={commentHighlights}
                  onCommentClick={openCommentThread}
                  readOnly={isReadOnly}
                />
              ) : shareSession.error ? (
                <div className="pane-loading">{shareSession.error}</div>
              ) : revisionInitializationError ? (
                <div className="pane-loading">{revisionInitializationError}</div>
              ) : roomAccess.error ? (
                <div className="pane-loading">{roomAccess.error}</div>
              ) : !github.session?.user ? (
                <div className="pane-loading">Connect GitHub or open an active viewer link.</div>
              ) : (
                <div className="pane-loading">Opening shared document...</div>
              )}
            </section>

            <section className="preview-pane" aria-label="Browser preview">
              <div className="preview-label">
                <span>Browser preview</span>
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
                    <span title={commentPollError ?? undefined}>
                      {collaboration.comments.filter((comment) => !comment.resolved).length} open
                      {commentPollError ? ' | GitHub sync retrying' : ''}
                    </span>
                  </div>
                  <button className="icon-button" type="button" title="Close comments" onClick={() => setCommentsOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="comment-composer">
                  <textarea
                    aria-label="New comment"
                    placeholder="Leave a comment..."
                    disabled={isReadOnly}
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitComment()
                    }}
                  />
                  <button className="button comment-button" type="button" disabled={isReadOnly || !commentDraft.trim()} onClick={submitComment}>
                    Comment
                  </button>
                </div>
                <div className="comment-list">
                  {collaboration.comments.length === 0 ? (
                    <div className="comments-empty">
                      <MessageSquare size={20} />
                      <span>No comments yet</span>
                    </div>
                  ) : collaboration.comments.map((comment) => {
                    const location = commentLocations.get(comment.id)
                    const replies = collaboration.commentMessages.filter(
                      (message) => message.threadId === comment.id,
                    )
                    return (
                    <article
                      className={`comment ${comment.resolved ? 'resolved' : ''} ${activeCommentId === comment.id ? 'active' : ''}`}
                      key={comment.id}
                    >
                      <div className="comment-meta">
                        <span className="mini-avatar" style={{ background: `${comment.authorColor}1f`, color: comment.authorColor }}>
                          {comment.authorName.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{comment.authorName}</strong>
                        <time dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
                      </div>
                      {comment.anchor ? (
                        <button
                          className="comment-anchor-context"
                          type="button"
                          onClick={() => openCommentThread(comment.id)}
                        >
                          <TextQuote size={13} />
                          <span>{location?.orphaned ? comment.anchor.quote : location?.quote ?? comment.anchor.quote}</span>
                          {location?.orphaned && <em>Original text deleted</em>}
                        </button>
                      ) : (
                        <div className="comment-document-context">Document comment</div>
                      )}
                      <p>{comment.body}</p>
                      {replies.length > 0 && (
                        <div className="comment-replies">
                          {replies.map((message) => (
                            <div className="comment-reply" key={message.id}>
                              <div className="comment-meta">
                                <span className="mini-avatar" style={{ background: `${message.authorColor}1f`, color: message.authorColor }}>
                                  {message.authorName.slice(0, 1).toUpperCase()}
                                </span>
                                <strong>{message.authorName}</strong>
                                <time dateTime={message.createdAt}>{formatRelativeTime(message.createdAt)}</time>
                              </div>
                              <p>{message.body}</p>
                              {message.github && (
                                <a href={message.github.htmlUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink size={12} /> GitHub reply
                                </a>
                              )}
                              {!message.github && commentSyncErrors[message.id] ? (
                                <button
                                  type="button"
                                  title={commentSyncErrors[message.id]}
                                  disabled={isReadOnly}
                                  onClick={() => retryMessageSync(message.id)}
                                >
                                  <RefreshCw size={12} /> Retry sync
                                </button>
                              ) : !message.github ? (
                                <span className="comment-sync-label">
                                  {comment.github ? 'Syncing to GitHub' : 'Queued for PR'}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="comment-reply-composer">
                        <input
                          aria-label={`Reply to comment by ${comment.authorName}`}
                          placeholder="Reply"
                          disabled={isReadOnly}
                          value={replyDrafts[comment.id] ?? ''}
                          onFocus={() => setActiveCommentId(comment.id)}
                          onChange={(event) => setReplyDrafts((current) => ({
                            ...current,
                            [comment.id]: event.target.value,
                          }))}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              submitReply(comment)
                            }
                          }}
                        />
                        <button
                          type="button"
                          title="Reply"
                          disabled={isReadOnly || !(replyDrafts[comment.id] ?? '').trim()}
                          onClick={() => submitReply(comment)}
                        >
                          <Reply size={14} />
                        </button>
                      </div>
                      <div className="comment-actions">
                        <button type="button" disabled={isReadOnly} onClick={() => collaboration.toggleComment(comment)}>
                          <Check size={13} /> {comment.resolved ? 'Reopen' : 'Resolve'}
                        </button>
                        <div className="comment-github-state">
                          {comment.github && (
                            <a
                              href={comment.github.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Open this comment on GitHub"
                            >
                              <ExternalLink size={13} /> PR comment
                            </a>
                          )}
                          {commentSyncErrors[comment.id] ? (
                            <button
                              type="button"
                              title={commentSyncErrors[comment.id]}
                              disabled={isReadOnly}
                              onClick={() => retryCommentSync(comment)}
                            >
                              <RefreshCw size={13} /> Retry sync
                            </button>
                          ) : comment.github?.resolved !== comment.resolved ? (
                            <span>{roomAccess.review ? 'Syncing to PR' : 'Queued for PR'}</span>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  )})}
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

      {!anonymousRole && roomAccess.room && (
        <ShareDialog
          open={shareDialogOpen}
          roomName={roomName}
          room={roomAccess.room}
          canManageLinks={github.session?.user?.id === roomAccess.room.ownerId}
          onClose={() => setShareDialogOpen(false)}
          onRoomRefresh={refreshRoom}
          onNotice={showNotice}
        />
      )}

      {!anonymousRole && <GitHubDialog
        open={githubDialogOpen}
        roomName={roomName}
        documentTitle={title}
        session={github.session}
        sessionLoading={github.isLoading}
        binding={repositoryBinding}
        review={roomAccess.review}
        onClose={() => setGitHubDialogOpen(false)}
        onOpenFile={openRepositoryFile}
        onBindDraft={bindRepositoryDraft}
        onSave={saveToGitHub}
        onDisconnect={async () => {
          await github.disconnect()
          showNotice('GitHub disconnected')
        }}
        onNotice={showNotice}
      />}

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

export default App