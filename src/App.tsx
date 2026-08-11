import {
  Archive,
  AtSign,
  BookOpenText,
  Bold,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Eye,
  ExternalLink,
  FilePlus2,
  FileText,
  GitFork,
  GitBranchPlus,
  GitPullRequest,
  Italic,
  LoaderCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  RefreshCw,
  Reply,
  Save,
  Share2,
  SplitSquareHorizontal,
  TextQuote,
  Tags,
  Undo2,
  UserRound,
  X,
} from 'lucide-react'
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import {
  CollaborativeEditor,
  type CollaborativeEditorHandle,
} from './components/CollaborativeEditor'
import { CitationPicker, type CitationSelection } from './components/CitationPicker'
import { GitHubDialog } from './components/GitHubDialog'
import { HelpDialog } from './components/HelpDialog'
import { MystInsertMenu } from './components/MystInsertMenu'
import { ReferenceManager } from './components/ReferenceManager'
import { ShareDialog } from './components/ShareDialog'
import type { VisualCitationInserter } from './components/VisualInlineEditor'
import { useCollaboration, type SharedComment } from './hooks/useCollaboration'
import { useGitHubSession } from './hooks/useGitHubSession'
import { usePageActivity } from './hooks/usePageActivity'
import { useRoomAccess } from './hooks/useRoomAccess'
import { useShareSession } from './hooks/useViewerSession'
import {
  createSnapshot,
  getRepositoryAssetBaseUrl,
  getRepositoryGitHubUrl,
  loadRepositoryFile,
  loadRepositoryBibliography,
  loadRepositoryProjectFiles,
  mirrorRoomComment,
  mirrorRoomCommentReply,
  startRoomRevision,
  syncRoomComments,
  type RepositoryBinding,
} from './lib/github'
import { loadProfile, saveProfile } from './lib/profile'
import { getMystOutline } from './lib/mystOutline'
import {
  formatCitation,
  type CitationDetails,
  type CitationStyle,
} from './lib/references'
import { sampleManuscript } from './lib/sampleManuscript'

type WorkspaceView = 'source' | 'split' | 'preview'

const isMystSourcePath = (path: string) => /\.(?:md|myst)$/i.test(path)
const projectManifestVersion = 1
const githubPollIntervalMs = 60_000

const MystPreview = lazy(async () => {
  const module = await import('./components/MystPreview')
  return { default: module.MystPreview }
})

const PublicationMetadata = lazy(async () => {
  const module = await import('./components/PublicationMetadata')
  return { default: module.PublicationMetadata }
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

const formatRepositoryName = (name: string) =>
  name.split(/([/_-])/).map((part, index) => (
    <Fragment key={`${index}-${part}`}>
      {part}
      {/^[/_-]$/.test(part) && <wbr />}
    </Fragment>
  ))

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
  const [helpOpen, setHelpOpen] = useState(false)
  const [citationPickerOpen, setCitationPickerOpen] = useState(false)
  const [referenceManagerOpen, setReferenceManagerOpen] = useState(false)
  const [publicationMetadataOpen, setPublicationMetadataOpen] = useState(false)
  const blockingDialogOpen =
    citationPickerOpen ||
    referenceManagerOpen ||
    publicationMetadataOpen ||
    helpOpen ||
    editingProfile ||
    shareDialogOpen ||
    githubDialogOpen
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null)
  const [visualCitationInserter, setVisualCitationInserter] = useState<VisualCitationInserter | null>(null)
  const [isSaving, setIsSaving] = useState(false)
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
  const narrowViewport = useRef(window.innerWidth <= 820)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const commentsTriggerRef = useRef<HTMLButtonElement>(null)
  const helpTriggerRef = useRef<HTMLButtonElement>(null)
  const wasSidebarOpen = useRef(sidebarOpen)
  const escapeStateRef = useRef({
    blockingDialogOpen,
    commentsOpen,
    editingProfile,
    sidebarOpen,
  })
  const pageActive = usePageActivity()
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
  const repositoryGitHubUrl = repositoryBinding
    ? getRepositoryGitHubUrl(repositoryBinding)
    : null
  const roomRole = roomAccess.room?.access ?? shareSession.role
  const sharedAccessRole = roomRole === 'editor'
    ? null
    : roomRole
  const isMaintainer = roomRole === 'editor'
  const isViewer = sharedAccessRole === 'viewer'
  const isSuggestionMode = sharedAccessRole === 'collaborator'
  const isArchived =
    roomAccess.review?.state === 'closed' || roomAccess.review?.state === 'merged'
  const canEditRoom = roomAccess.isReady && !isArchived && (isMaintainer || isSuggestionMode)
  const canManageRepository = roomAccess.isReady && !isArchived && isMaintainer
  const canMirrorGitHub = canManageRepository
  const isReadOnly = !canEditRoom
  const roomReviewNumber = roomAccess.review?.number
  const refreshRoom = roomAccess.refresh
  const collaborationProfile = github.session?.user
    ? {
        ...profile,
        id: `github:${github.session.user.id}`,
        name: github.session.user.name
          ? `${github.session.user.name} (@${github.session.user.login})`
          : `@${github.session.user.login}`,
      }
    : profile
  const collaboration = useCollaboration(
    roomName,
    collaborationProfile,
    revisionInitialContent ?? sampleManuscript,
    roomAccess.isReady && revisionInitialContent !== null,
    isReadOnly,
    pageActive,
  )
  const primaryFilePath = repositoryBinding?.path ?? 'manuscript.md'
  const projectFilePaths = useMemo(() => Array.from(new Set([
    primaryFilePath,
    ...Object.keys(collaboration.projectFiles),
  ])).sort((first, second) => {
    if (first === primaryFilePath) return -1
    if (second === primaryFilePath) return 1
    return first.localeCompare(second)
  }), [collaboration.projectFiles, primaryFilePath])
  const activeFilePath = activeProjectPath && projectFilePaths.includes(activeProjectPath)
    ? activeProjectPath
    : primaryFilePath
  const isActiveMystSource = isMystSourcePath(activeFilePath)
  const isPrimaryFile = activeFilePath === primaryFilePath
  const activeSharedText = collaboration.getSharedText(activeFilePath, primaryFilePath)
    ?? collaboration.sharedText
  const activeContent = isPrimaryFile
    ? collaboration.content
    : collaboration.projectFiles[activeFilePath] ?? ''
  const activeAssetBaseUrl = repositoryBinding
    ? getRepositoryAssetBaseUrl({ ...repositoryBinding, path: activeFilePath })
    : undefined
  const projectManuscriptContent = useMemo(() => [
    collaboration.content,
    ...Object.entries(collaboration.projectFiles).flatMap(([path, fileContent]) =>
      isMystSourcePath(path) ? [fileContent] : []),
  ].join('\n'), [collaboration.content, collaboration.projectFiles])
  const activeOutline = useMemo(
    () => isActiveMystSource ? getMystOutline(activeContent) : [],
    [activeContent, isActiveMystSource],
  )
  const sharedComments = collaboration.comments
  const initializeBibliography = collaboration.initializeBibliography
  const initializeMystConfig = collaboration.initializeMystConfig
  const initializeProjectFiles = collaboration.initializeProjectFiles
  const isBibliographyInitialized = collaboration.isBibliographyInitialized
  const isMystConfigInitialized = collaboration.isMystConfigInitialized
  const areProjectFilesInitialized = collaboration.areProjectFilesInitialized
  const currentProjectManifestVersion = collaboration.projectManifestVersion
  const isCollaborationSynced = collaboration.isSynced
  const applyCommentMirror = collaboration.applyCommentMirror
  const applyCommentMessageMirror = collaboration.applyCommentMessageMirror
  const applyGitHubCommentSync = collaboration.applyGitHubCommentSync
  const sharedCommentMessages = collaboration.commentMessages
  const resolveCommentAnchor = collaboration.resolveAnchor
  const commentLocations = useMemo(
    () => new Map(sharedComments.map((comment) => [
      comment.id,
      resolveCommentAnchor(comment),
    ])),
    [resolveCommentAnchor, sharedComments],
  )
  const commentHighlights = useMemo(
    () => isPrimaryFile ? sharedComments.flatMap((comment) => {
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
    }) : [],
    [activeCommentId, commentLocations, isPrimaryFile, sharedComments],
  )

  const title = useMemo(
    () => getDocumentTitle(activeContent),
    [activeContent],
  )
  const wordCount = useMemo(
    () => activeContent.trim()
      ? activeContent.trim().split(/\s+/).length
      : 0,
    [activeContent],
  )
  const openCommentCount = useMemo(
    () => sharedComments.filter((comment) => !comment.resolved).length,
    [sharedComments],
  )

  const showNotice = (message: string) => {
    setNotice(message)
  }

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 2_400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useLayoutEffect(() => {
    escapeStateRef.current = {
      blockingDialogOpen,
      commentsOpen,
      editingProfile,
      sidebarOpen,
    }
  }, [blockingDialogOpen, commentsOpen, editingProfile, sidebarOpen])

  useEffect(() => {
    const handleResize = () => {
      const nextNarrowViewport = window.innerWidth <= 820
      if (nextNarrowViewport && !narrowViewport.current) setSidebarOpen(false)
      narrowViewport.current = nextNarrowViewport
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const {
        blockingDialogOpen: dialogOpen,
        commentsOpen: commentsVisible,
        editingProfile: profileOpen,
        sidebarOpen: sidebarVisible,
      } = escapeStateRef.current
      if (profileOpen) {
        event.preventDefault()
        setEditingProfile(false)
        return
      }
      if (dialogOpen || window.innerWidth > 820) return
      if (sidebarVisible) {
        event.preventDefault()
        setSidebarOpen(false)
      } else if (commentsVisible) {
        event.preventDefault()
        setCommentsOpen(false)
        window.requestAnimationFrame(() => commentsTriggerRef.current?.focus())
      }
    }
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (
      wasSidebarOpen.current &&
      !sidebarOpen &&
      sidebarRef.current?.contains(document.activeElement)
    ) sidebarToggleRef.current?.focus()
    wasSidebarOpen.current = sidebarOpen
  }, [sidebarOpen])

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
    if (
      !repositoryBinding ||
      !isCollaborationSynced ||
      (
        isBibliographyInitialized &&
        isMystConfigInitialized &&
        areProjectFilesInitialized &&
        currentProjectManifestVersion >= projectManifestVersion
      ) ||
      !canManageRepository
    ) return
    let active = true
    void (async () => {
      try {
        const manifest = await loadRepositoryProjectFiles(repositoryBinding)
        const bibliographyPath = manifest.bibliographyPaths[0]
        const bibliographyFile = isBibliographyInitialized
          ? null
          : await loadRepositoryBibliography(repositoryBinding, bibliographyPath)
        if (!active) return
        if (bibliographyFile) {
          initializeBibliography(bibliographyFile.content, bibliographyFile.path)
        }
        initializeMystConfig(manifest.config.content, manifest.config.path)
        initializeProjectFiles(
          manifest.files,
          repositoryBinding.path,
          projectManifestVersion,
        )
        if (manifest.missing.length) {
          showNotice(`Missing project files: ${manifest.missing.join(', ')}`)
        }
      } catch (error) {
        if (!active) return
        showNotice(error instanceof Error ? error.message : 'Could not load MyST project files')
      }
    })()
    return () => {
      active = false
    }
  }, [
    areProjectFilesInitialized,
    currentProjectManifestVersion,
    initializeBibliography,
    initializeMystConfig,
    initializeProjectFiles,
    isBibliographyInitialized,
    canManageRepository,
    isCollaborationSynced,
    isMystConfigInitialized,
    repositoryBinding,
  ])

  useEffect(() => {
    if (!roomReviewNumber || !pageActive) return
    let active = true
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      void refreshRoom().catch((error: unknown) => {
        if (!active) return
        showNotice(error instanceof Error ? error.message : 'Room status refresh failed')
      })
    }
    refresh()
    const interval = window.setInterval(refresh, githubPollIntervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [pageActive, refreshRoom, roomReviewNumber])

  useEffect(() => {
    const reviewNumber = roomAccess.review?.number
    if (!reviewNumber || !canMirrorGitHub) return

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
    canMirrorGitHub,
    commentSyncRevision,
    roomAccess.review?.number,
    resolveCommentAnchor,
    roomName,
    sharedComments,
  ])

  useEffect(() => {
    if (!roomAccess.review?.number || !canMirrorGitHub || !pageActive) return
    let active = true
    const sync = () => {
      if (document.visibilityState === 'hidden') return
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
    const interval = window.setInterval(sync, githubPollIntervalMs)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [
    applyGitHubCommentSync,
    canMirrorGitHub,
    pageActive,
    roomAccess.review?.number,
    roomName,
  ])

  useEffect(() => {
    const reviewNumber = roomAccess.review?.number
    if (!reviewNumber || !canMirrorGitHub) return

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
    canMirrorGitHub,
    commentSyncRevision,
    roomAccess.review?.number,
    roomName,
    sharedCommentMessages,
    sharedComments,
  ])

  const shareDocument = () => {
    setShareDialogOpen(true)
  }

  const closeHelpDialog = () => {
    setHelpOpen(false)
    window.requestAnimationFrame(() => helpTriggerRef.current?.focus())
  }

  const createDocument = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('doc', crypto.randomUUID())
    url.searchParams.delete('revision')
    window.location.assign(url)
  }

  const startNextRevision = async () => {
    if (!isMaintainer || !isArchived) return
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
    if (!isPrimaryFile) {
      showNotice('Review comments on secondary project files are not available yet.')
      return
    }
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
    if (!canManageRepository) {
      showNotice('Maintainer access is required to publish this room to GitHub.')
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
        collaboration.bibliography.trim()
          ? {
              path: collaboration.bibliographyPath,
              content: collaboration.getSnapshotBibliography(),
            }
          : undefined,
        collaboration.mystConfig.trim()
          ? {
              path: collaboration.mystConfigPath,
              content: collaboration.mystConfig,
            }
          : undefined,
        collaboration.getSnapshotProjectFiles(),
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

  const insertCitation = (
    selections: CitationSelection[],
    style: CitationStyle,
    details: CitationDetails,
  ) => {
    try {
      const keys = selections.map((selection) => {
        if (selection.kind === 'existing') return selection.key
        const result = collaboration.addBibliographyReference(selection.paper)
        if (!result) throw new Error('The reference library is not writable.')
        return result.key
      })
      if (visualCitationInserter) {
        visualCitationInserter(
          keys,
          style,
          details,
          collaboration.getSnapshotBibliography(),
        )
      }
      else editorRef.current?.insertCitation(formatCitation(keys, style, details))
      setCitationPickerOpen(false)
      setVisualCitationInserter(null)
      showNotice(`${keys.length} ${keys.length === 1 ? 'citation' : 'citations'} inserted`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not insert the citation')
    }
  }

  const closeCitationPicker = () => {
    setCitationPickerOpen(false)
    setVisualCitationInserter(null)
  }

  const openRepositoryFile = async (binding: RepositoryBinding, content: string) => {
    if (!canManageRepository) return
    const projectManifest = await loadRepositoryProjectFiles(binding)
    const bibliographyFile = await loadRepositoryBibliography(
      binding,
      projectManifest.bibliographyPaths[0],
    )
    await roomAccess.bind(binding)
    collaboration.replaceContent(content)
    collaboration.replaceBibliography(bibliographyFile.content, bibliographyFile.path)
    collaboration.replaceMystConfig(
      projectManifest.config.content,
      projectManifest.config.path,
    )
    collaboration.replaceProjectFiles(
      projectManifest.files,
      binding.path,
      projectManifestVersion,
    )
    setActiveProjectPath(null)
  }

  const bindRepositoryDraft = async (binding: RepositoryBinding) => {
    if (!canManageRepository) return
    const projectManifest = await loadRepositoryProjectFiles(binding)
    const bibliographyFile = await loadRepositoryBibliography(
      binding,
      projectManifest.bibliographyPaths[0],
    )
    await roomAccess.bind(binding)
    collaboration.replaceBibliography(bibliographyFile.content, bibliographyFile.path)
    collaboration.replaceMystConfig(
      projectManifest.config.content,
      projectManifest.config.path,
    )
    collaboration.replaceProjectFiles(
      projectManifest.files,
      binding.path,
      projectManifestVersion,
    )
    setActiveProjectPath(null)
  }

  return (
    <div className="app-shell">
      <header className="topbar" inert={blockingDialogOpen}>
        <div className="brand-block">
          <button
            ref={sidebarToggleRef}
            className="icon-button sidebar-toggle"
            type="button"
            title={sidebarOpen ? 'Hide files' : 'Show files'}
            aria-controls="project-files-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="brand-mark" aria-hidden="true">D</div>
          <div>
            <div className="brand-name">DeMystify</div>
            <div className="workspace-name">Collaborative MyST</div>
          </div>
        </div>

        <div className="document-identity">
          <span className="document-title">{title}</span>
          <span className={`sync-status ${isArchived ? 'archived' : sharedAccessRole ? 'viewer' : collaboration.status}`}>
            <span className="status-dot" />
            {isArchived
              ? 'Archived'
              : isViewer
                ? 'Viewing'
                : isSuggestionMode
                  ? 'Suggesting'
                  : collaboration.status === 'connected'
                    ? 'Live'
                    : collaboration.status}
          </span>
        </div>

        <div className="topbar-actions">
          <button
            ref={helpTriggerRef}
            className="icon-button"
            type="button"
            title="How DeMystify works"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={18} />
          </button>
          <div className="collaborator-stack" role="group" aria-label="Current collaborators">
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
          {isMaintainer && !isArchived && (
            <button className="button secondary-button" type="button" title="Share access" onClick={shareDocument}>
              <Share2 size={16} />
              <span>Share</span>
            </button>
          )}
          {isMaintainer ? (
            <button
              className="button github-button"
              type="button"
              disabled={isSaving}
              title={isArchived
                ? 'Open pull request'
                : repositoryBinding
                  ? 'Save snapshot to GitHub'
                  : 'Connect GitHub repository'}
              onClick={() => {
                if (isArchived && roomAccess.review) {
                  window.open(roomAccess.review.htmlUrl, '_blank', 'noopener,noreferrer')
                } else if (repositoryBinding) void saveToGitHub()
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
                  : repositoryBinding
                    ? 'Save to GitHub'
                    : 'Connect GitHub'}
              </span>
            </button>
          ) : (
            <>
              {isViewer && (
                <button className="button viewer-button" type="button" title="Viewer mode" disabled>
                  <Eye size={16} />
                  <span>View only</span>
                </button>
              )}
              {isSuggestionMode && !isArchived && (
                <button className="button suggestion-button" type="button" title="Suggestion mode" disabled>
                  <UserRound size={16} />
                  <span>Suggestion mode</span>
                </button>
              )}
              <button
                className={`button ${github.session?.user ? 'secondary-button github-identity-button' : 'github-button'}`}
                type="button"
                disabled={github.isLoading}
                title={github.session?.user ? 'GitHub identity' : 'Connect GitHub identity'}
                onClick={() => setGitHubDialogOpen(true)}
              >
                {github.session?.user?.avatarUrl ? (
                  <img src={github.session.user.avatarUrl} alt="" />
                ) : (
                  github.session?.user
                    ? <UserRound size={16} />
                    : <GitFork size={16} />
                )}
                <span>{github.session?.user ? `@${github.session.user.login}` : 'Connect GitHub'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main
        className={`workspace ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
        inert={blockingDialogOpen}
      >
        {sidebarOpen && (
          <button
            className="sidebar-backdrop"
            type="button"
            aria-label="Close project files"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          ref={sidebarRef}
          id="project-files-sidebar"
          className={`file-sidebar ${sidebarOpen ? 'open' : ''}`}
          aria-label="Project files"
          inert={!sidebarOpen}
        >
          <div className="sidebar-heading">
            <span>Workspace</span>
            <button className="icon-button" type="button" title="New document" onClick={createDocument}>
              <FilePlus2 size={16} />
            </button>
          </div>
          {repositoryBinding && repositoryGitHubUrl ? (
            <div className={`repository-picker bound ${canManageRepository ? 'changeable' : ''}`}>
              <a
                className="repository-github-link"
                href={repositoryGitHubUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open ${repositoryBinding.fullName} on GitHub`}
              >
                <span className="repository-icon"><GitFork size={15} /></span>
                <span>
                  <strong>{formatRepositoryName(repositoryBinding.fullName)}</strong>
                  <small>GitHub repository</small>
                </span>
                <ExternalLink size={14} />
              </a>
              {canManageRepository && (
                <button
                  className="repository-change-button"
                  type="button"
                  title="Change repository or file"
                  onClick={() => setGitHubDialogOpen(true)}
                >
                  <ChevronDown size={14} />
                </button>
              )}
            </div>
          ) : (
            <button
              className="repository-picker"
              type="button"
              title="Connect a GitHub repository"
              disabled={!canManageRepository}
              onClick={() => setGitHubDialogOpen(true)}
            >
              <span className="repository-icon"><GitFork size={15} /></span>
              <span>
                <strong>Local draft</strong>
                <small>Not connected</small>
              </span>
              <ChevronDown size={14} />
            </button>
          )}
          <div className="sidebar-navigation">
            <nav className="file-tree" aria-label="Manuscript files">
              <span className="tree-label">Files</span>
              {projectFilePaths.map((path) => (
                <button
                  className={`file-row ${path === activeFilePath ? 'active' : ''}`}
                  key={path}
                  type="button"
                  title={path}
                  onClick={() => {
                    setActiveProjectPath(path)
                    setCommentsOpen(false)
                    if (!isMystSourcePath(path)) setView('source')
                    if (window.innerWidth <= 820) setSidebarOpen(false)
                  }}
                >
                  <FileText size={16} />
                  <span>{path}</span>
                  {path === activeFilePath && <span className="live-file-dot" title="Live document" />}
                </button>
              ))}
            </nav>
            {activeOutline.length > 0 && (
              <nav className="document-outline" aria-label="Document outline">
                <span className="tree-label">Outline</span>
                {activeOutline.map((entry) => (
                  <button
                    className="outline-row"
                    key={entry.id}
                    type="button"
                    title={entry.title}
                    style={{ paddingLeft: `${8 + Math.max(0, entry.depth - 1) * 11}px` }}
                    onClick={() => {
                      if (view === 'preview') setView('split')
                      if (window.innerWidth <= 820) setSidebarOpen(false)
                      window.requestAnimationFrame(() => {
                        editorRef.current?.revealRange(entry.from, entry.to)
                      })
                    }}
                  >
                    <span>H{entry.depth}</span>
                    <strong>{entry.title}</strong>
                  </button>
                ))}
              </nav>
            )}
          </div>
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

        <section className={`manuscript-workspace ${isArchived ? 'archived' : ''} ${sharedAccessRole && !isArchived ? 'access-mode' : ''}`}>
          {isArchived && roomAccess.review ? (
            <div className="archive-banner" role="status">
              <Archive size={18} />
              <div>
                <strong>Revision {roomAccess.review.state}</strong>
                <span>This room is read-only. Its text and review history remain available.</span>
              </div>
              <a href={roomAccess.review.htmlUrl} target="_blank" rel="noreferrer">
                PR #{roomAccess.review.number}
              </a>
              {isMaintainer && (
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
              )}
            </div>
          ) : sharedAccessRole ? (
            <div className="archive-banner viewer-banner" role="status">
              <Eye size={18} />
              <div>
                <strong>{isViewer ? 'Viewer access' : 'Suggestion mode'}</strong>
                <span>
                  {isViewer
                    ? 'Live manuscript updates and review history are available; editing is disabled.'
                    : github.session?.user
                      ? 'Your GitHub identity labels new comments and live suggestions. A maintainer publishes accepted changes and mirrors queued comments to GitHub.'
                      : 'Edits stay in DeMystify until a maintainer publishes them. Connect GitHub to identify new comments and live suggestions.'}
                </span>
              </div>
              {roomAccess.review && (
                <a href={roomAccess.review.htmlUrl} target="_blank" rel="noreferrer">
                  PR #{roomAccess.review.number}
                </a>
              )}
            </div>
          ) : null}
          <div className="editor-toolbar">
            <div className="formatting-tools" aria-label="Authoring tools">
              <button className="icon-button" type="button" title="Undo" disabled={isReadOnly} onClick={() => editorRef.current?.undo()}>
                <Undo2 size={17} />
              </button>
              <button className="icon-button" type="button" title="Redo" disabled={isReadOnly} onClick={() => editorRef.current?.redo()}>
                <Redo2 size={17} />
              </button>
              <span className="toolbar-divider" />
              <MystInsertMenu
                disabled={isReadOnly || !isActiveMystSource}
                onInsert={(pattern) => editorRef.current?.insertSnippet(
                  pattern.template,
                  pattern.selectedTextPlaceholder,
                )}
              />
              <button
                className="citation-trigger"
                type="button"
                title="Cite a paper"
                disabled={isReadOnly || !isActiveMystSource}
                onClick={() => {
                  setVisualCitationInserter(null)
                  setCitationPickerOpen(true)
                }}
              >
                <AtSign size={16} />
                <span>Cite</span>
              </button>
              <button
                className="reference-library-trigger"
                type="button"
                title="Manage references"
                onClick={() => setReferenceManagerOpen(true)}
              >
                <BookOpenText size={16} />
                <span>References</span>
              </button>
              <button
                className="publication-metadata-trigger"
                type="button"
                title="Publication metadata"
                disabled={!isActiveMystSource}
                onClick={() => setPublicationMetadataOpen(true)}
              >
                <Tags size={16} />
                <span>Metadata</span>
              </button>
              <span className="toolbar-divider" />
              <button className="icon-button" type="button" title="Bold" disabled={isReadOnly || !isActiveMystSource} onClick={() => editorRef.current?.wrapSelection('**')}>
                <Bold size={17} />
              </button>
              <button className="icon-button" type="button" title="Italic" disabled={isReadOnly || !isActiveMystSource} onClick={() => editorRef.current?.wrapSelection('*')}>
                <Italic size={17} />
              </button>
              <button className="icon-button" type="button" title="Inline code" disabled={isReadOnly || !isActiveMystSource} onClick={() => editorRef.current?.wrapSelection('`')}>
                <Code2 size={17} />
              </button>
              <span className="toolbar-divider" />
              <button
                ref={commentsTriggerRef}
                className="icon-button comments-trigger"
                type="button"
                title={isPrimaryFile ? 'Open comments' : 'Comments are currently limited to the primary manuscript'}
                disabled={!isPrimaryFile}
                onClick={() => setCommentsOpen((open) => !open)}
              >
                <MessageSquare size={17} />
                {openCommentCount > 0 && (
                  <span className="comment-count">
                    {openCommentCount}
                  </span>
                )}
              </button>
            </div>

            <div className="view-switcher" aria-label="Workspace view">
              <button className={view === 'source' ? 'active' : ''} type="button" title="Source only" onClick={() => setView('source')}>
                <Code2 size={15} /><span>Source</span>
              </button>
              <button className={view === 'split' ? 'active' : ''} type="button" title="Split view" disabled={!isActiveMystSource} onClick={() => setView('split')}>
                <SplitSquareHorizontal size={15} /><span>Split</span>
              </button>
              <button className={view === 'preview' ? 'active' : ''} type="button" title="Visual editor" disabled={!isActiveMystSource} onClick={() => setView('preview')}>
                <Eye size={15} /><span>Visual</span>
              </button>
            </div>

            <div className="document-stats">
              <span>{wordCount.toLocaleString()} words</span>
              <button className="icon-button" type="button" title="Save snapshot to GitHub" disabled={isSaving || !canManageRepository} onClick={() => void saveToGitHub()}>
                {isSaving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              </button>
            </div>
          </div>

          <div className={`document-panes view-${view} ${commentsOpen ? 'comments-open' : ''}`}>
            <section className="source-pane" aria-label={isActiveMystSource ? 'MyST source editor' : 'YAML source editor'}>
              {activeSharedText && collaboration.provider ? (
                <CollaborativeEditor
                  key={activeFilePath}
                  ref={editorRef}
                  sharedText={activeSharedText}
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

            <section className="preview-pane" aria-label={isReadOnly ? 'Browser preview' : 'Visual document editor'}>
              <div className="preview-label">
                <span>{isReadOnly ? 'Browser preview' : 'Visual editor'}</span>
                <span>{collaboration.isSynced ? 'Live draft' : 'Preparing'}</span>
              </div>
              <Suspense fallback={<div className="pane-loading">Rendering MyST...</div>}>
                <MystPreview
                  assetBaseUrl={activeAssetBaseUrl}
                  bibliography={collaboration.bibliography}
                  content={activeContent}
                  editable={!isReadOnly && collaboration.isSynced && isActiveMystSource}
                  projectFiles={collaboration.projectFiles}
                  sourcePath={activeFilePath}
                  onBeginEdit={(block) => collaboration.beginTextEdit(
                    block.from,
                    block.to,
                    block.value,
                    activeFilePath,
                    primaryFilePath,
                  )}
                  onCommitEdit={(anchor, replacement) => collaboration.commitTextEdit(
                    anchor,
                    replacement,
                    activeFilePath,
                    primaryFilePath,
                  )}
                  onEditError={showNotice}
                  onRequestCitation={(insert) => {
                    setVisualCitationInserter(() => insert)
                    setCitationPickerOpen(true)
                  }}
                />
              </Suspense>
            </section>

            {commentsOpen && (
              <aside className="comments-panel" aria-label="Comments">
                <div className="comments-heading">
                  <div>
                    <strong>Comments</strong>
                    <span title={commentPollError ?? undefined}>
                      {openCommentCount} open
                      {commentPollError ? ' | GitHub sync retrying' : ''}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    title="Close comments"
                    onClick={() => {
                      setCommentsOpen(false)
                      window.requestAnimationFrame(() => commentsTriggerRef.current?.focus())
                    }}
                  >
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
                                  disabled={!canMirrorGitHub}
                                  onClick={() => retryMessageSync(message.id)}
                                >
                                  <RefreshCw size={12} /> Retry sync
                                </button>
                              ) : !message.github ? (
                                <span className="comment-sync-label">
                                  {isSuggestionMode
                                    ? 'Queued for maintainer'
                                    : comment.github
                                      ? 'Syncing to GitHub'
                                      : 'Queued for PR'}
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
                              disabled={!canMirrorGitHub}
                              onClick={() => retryCommentSync(comment)}
                            >
                              <RefreshCw size={13} /> Retry sync
                            </button>
                          ) : comment.github?.resolved !== comment.resolved ? (
                            <span>
                              {isSuggestionMode
                                ? 'Queued for maintainer'
                                : roomAccess.review
                                  ? 'Syncing to PR'
                                  : 'Queued for PR'}
                            </span>
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

      {citationPickerOpen && (
        <CitationPicker
          bibliography={collaboration.bibliography}
          roomName={roomName}
          onClose={closeCitationPicker}
          onInsert={insertCitation}
        />
      )}

      {referenceManagerOpen && (
        <ReferenceManager
          bibliography={collaboration.bibliography}
          manuscript={projectManuscriptContent}
          readOnly={isReadOnly}
          onApply={collaboration.commitBibliographyEdit}
          onClose={() => setReferenceManagerOpen(false)}
        />
      )}

      {publicationMetadataOpen && (
        <Suspense fallback={(
          <div className="publication-metadata-backdrop">
            <div className="pane-loading">Loading publication metadata...</div>
          </div>
        )}>
          <PublicationMetadata
            pageSource={activeContent}
            pagePath={activeFilePath}
            projectFiles={collaboration.projectFiles}
            projectSource={collaboration.mystConfig}
            projectPath={collaboration.mystConfigPath}
            readOnly={isReadOnly}
            onApply={(input) => collaboration.commitPublicationMetadata({
              ...input,
              pagePath: activeFilePath,
              primaryPath: primaryFilePath,
            })}
            onClose={() => setPublicationMetadataOpen(false)}
          />
        </Suspense>
      )}

      <HelpDialog open={helpOpen} onClose={closeHelpDialog} />

      {editingProfile && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingProfile(false)}>
          <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-icon"><UserRound size={20} /></div>
            <h2 id="profile-title">Your display name</h2>
            <p>This name appears beside your cursor and comments.</p>
            <input autoFocus value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') updateProfile() }} />
            <div className="dialog-actions">
              <button className="button secondary-button" type="button" onClick={() => setEditingProfile(false)}>Cancel</button>
              <button className="button primary-button" type="button" onClick={updateProfile}>Save name</button>
            </div>
          </section>
        </div>
      )}

      {isMaintainer && roomAccess.room && (
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

      <GitHubDialog
        open={githubDialogOpen}
        roomName={roomName}
        documentTitle={title}
        session={github.session}
        sessionLoading={github.isLoading}
        canManageRepository={canManageRepository}
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
      />

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

export default App