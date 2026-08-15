import {
  Archive,
  AtSign,
  BookOpenText,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  ExternalLink,
  FilePlus2,
  FileText,
  GitFork,
  GitBranchPlus,
  GitPullRequest,
  Italic,
  Link2,
  LoaderCircle,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Plus,
  PencilLine,
  Redo2,
  RefreshCw,
  Reply,
  Save,
  Search,
  Share2,
  SplitSquareHorizontal,
  TextQuote,
  Tags,
  Undo2,
  Unlink2,
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
  type SourceSuggestionHighlight,
} from './components/CollaborativeEditor'
import { CitationPicker, type CitationSelection } from './components/CitationPicker'
import { DocumentMenu } from './components/DocumentMenu'
import { GitHubDialog } from './components/GitHubDialog'
import { HelpDialog } from './components/HelpDialog'
import { MystInsertMenu } from './components/MystInsertMenu'
import { MentionInput } from './components/MentionInput'
import type { MystPreviewSuggestion } from './components/MystPreview'
import { ParticipantsMenu } from './components/ParticipantsMenu'
import { ReferenceManager } from './components/ReferenceManager'
import { ShareDialog } from './components/ShareDialog'
import type { VisualCitationInserter } from './components/VisualInlineEditor'
import {
  useCollaboration,
  type Collaborator,
  type PrimaryEditMode,
  type SharedComment,
  type SharedCommentMessage,
} from './hooks/useCollaboration'
import { useGitHubSession } from './hooks/useGitHubSession'
import { usePageActivity } from './hooks/usePageActivity'
import { useRoomAccess } from './hooks/useRoomAccess'
import { useShareSession } from './hooks/useViewerSession'
import {
  createSnapshot,
  decideLiveProposal,
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
  getProjectedSuggestionReplacement,
  mapProjectedRange,
  projectPendingSuggestions,
} from './lib/suggestionProjection'
import { getLiveProposalInlineChanges } from './lib/liveProposal'
import {
  filterReviewThreads,
  getVisibleReviewThreads,
  type ReviewStatusFilter,
  type ReviewTypeFilter,
} from './lib/reviewInbox'
import { resolveMentions, type MentionCandidate } from './lib/mentions'
import {
  detectCitationSyntax,
  formatCitation,
  type CitationDetails,
  type CitationStyle,
} from './lib/references'
import { sampleManuscript } from './lib/sampleManuscript'

type WorkspaceView = 'source' | 'split' | 'preview'

const isMystSourcePath = (path: string) => /\.(?:md|myst)$/i.test(path)
const projectManifestVersion = 1
const githubPollIntervalMs = 60_000
const reviewBatchSize = 50
const linkedScrollTolerance = 0.002

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
  const [linkedPaneScrolling, setLinkedPaneScrolling] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentComposerOpen, setCommentComposerOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [reviewQuery, setReviewQuery] = useState('')
  const [reviewStatus, setReviewStatus] = useState<ReviewStatusFilter>('open')
  const [reviewType, setReviewType] = useState<ReviewTypeFilter>('all')
  const [reviewForMe, setReviewForMe] = useState(false)
  const [reviewVisibleLimit, setReviewVisibleLimit] = useState(reviewBatchSize)
  const [followedCollaboratorClientId, setFollowedCollaboratorClientId] = useState<number | null>(null)
  const [sourceDraftPreview, setSourceDraftPreview] = useState<{
    filePath: string
    content: string
  } | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [activeLiveProposalChangeId, setActiveLiveProposalChangeId] = useState<string | null>(null)
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
  const [maintainerEditMode, setMaintainerEditMode] = useState<PrimaryEditMode>('editing')
  const [editingReviewItem, setEditingReviewItem] = useState<{
    id: string
    kind: 'comment' | 'reply'
    body: string
  } | null>(null)
  const [visualCitationInserter, setVisualCitationInserter] = useState<VisualCitationInserter | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDecidingProposal, setIsDecidingProposal] = useState(false)
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
  const previewPaneRef = useRef<HTMLElement>(null)
  const expectedSourceScrollRef = useRef<number | null>(null)
  const expectedPreviewScrollRef = useRef<number | null>(null)
  const visualSuggestionSupersedesRef = useRef<string[]>([])
  const reviewThreadRefs = useRef(new Map<string, HTMLElement>())
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
  const isContributor = sharedAccessRole === 'collaborator'
  const primaryEditMode: PrimaryEditMode = isContributor || isViewer || maintainerEditMode === 'suggesting'
    ? 'suggesting'
    : 'editing'
  const isArchived =
    roomAccess.review?.state === 'closed' || roomAccess.review?.state === 'merged'
  const canEditRoom = roomAccess.isReady && !isArchived && (isMaintainer || isContributor)
  const canManageRepository = roomAccess.isReady && !isArchived && isMaintainer
  const canMirrorGitHub = canManageRepository
  const isReadOnly = !canEditRoom
  const roomReviewNumber = roomAccess.review?.number
  const refreshRoom = roomAccess.refresh
  const collaborationProfile = github.session?.user
    ? {
        ...profile,
        id: roomAccess.room?.actorId ?? `github:${github.session.user.id}`,
        name: github.session.user.name
          ? `${github.session.user.name} (@${github.session.user.login})`
          : `@${github.session.user.login}`,
      }
    : {
        ...profile,
        id: roomAccess.room?.actorId ?? profile.id,
      }
  const ownedActorIds = useMemo(
    () => roomAccess.room?.ownedActorIds ?? [collaborationProfile.id],
    [collaborationProfile.id, roomAccess.room?.ownedActorIds],
  )
  const collaboration = useCollaboration(
    roomName,
    collaborationProfile,
    revisionInitialContent ?? sampleManuscript,
    roomAccess.isReady && revisionInitialContent !== null,
    isReadOnly,
    pageActive,
  )
  const effectiveReadOnly = isReadOnly || Boolean(collaboration.accessError)
  const isSuggestionMode = primaryEditMode === 'suggesting' ||
    collaboration.hasPendingWorkingChanges
  const isAtomicSuggestionMode = primaryEditMode === 'suggesting' &&
    !collaboration.hasPendingWorkingChanges
  const isStructuredEditorReadOnly = effectiveReadOnly || isSuggestionMode
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
  const isSourceReadOnly = effectiveReadOnly || (isSuggestionMode && !isPrimaryFile)
  const canInsertCitation = !isSourceReadOnly && isActiveMystSource
  const canAddCitationReferences = !isStructuredEditorReadOnly
  const citationDisabledReason = canInsertCitation
    ? undefined
    : isArchived
      ? 'Archived documents are read-only'
      : !isActiveMystSource
      ? 'Available in .md and .myst files'
      : isSuggestionMode && !isPrimaryFile
        ? 'Suggestion mode can edit only the primary manuscript'
        : collaboration.accessError
          ? 'Sharing access has ended'
          : 'Editing access is required'
  const activeSharedText = collaboration.getSharedText(activeFilePath, primaryFilePath)
    ?? collaboration.sharedText
  const activeContent = isPrimaryFile
    ? collaboration.workingContent
    : collaboration.projectFiles[activeFilePath] ?? ''
  const activeAssetBaseUrl = repositoryBinding
    ? getRepositoryAssetBaseUrl({ ...repositoryBinding, path: activeFilePath })
    : undefined
  const projectManuscriptContent = useMemo(() => [
    collaboration.workingContent,
    ...Object.entries(collaboration.projectFiles).flatMap(([path, fileContent]) =>
      isMystSourcePath(path) ? [fileContent] : []),
  ].join('\n'), [collaboration.projectFiles, collaboration.workingContent])
  const sharedComments = collaboration.comments
  const collaborators = collaboration.collaborators
  const getCollaboratorCursor = collaboration.getCollaboratorCursor
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
      return !comment.suggestion && location && !location.orphaned
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
  const primarySuggestionProjection = useMemo(
    () => projectPendingSuggestions(
      collaboration.content,
      sharedComments.flatMap((comment) => {
        const location = commentLocations.get(comment.id)
        return comment.suggestion && location && !location.orphaned
          ? [{
              id: comment.id,
              active: comment.suggestion.status === 'pending',
              from: location.from,
              to: location.to,
              before: comment.suggestion.before,
              after: comment.suggestion.after,
              createdAt: comment.createdAt,
              supersedes: comment.suggestion.supersedes,
            }]
          : []
      }),
    ),
    [collaboration.content, commentLocations, sharedComments],
  )
  const activeSuggestionProjection = useMemo(
    () => isPrimaryFile
      ? primarySuggestionProjection
      : projectPendingSuggestions(activeContent, []),
    [activeContent, isPrimaryFile, primarySuggestionProjection],
  )
  const suggestionBaseContent = isAtomicSuggestionMode && isActiveMystSource
    ? activeSuggestionProjection.content
    : activeContent
  const activeSourceDraftPreview = isAtomicSuggestionMode &&
    sourceDraftPreview?.filePath === activeFilePath
    ? sourceDraftPreview.content
    : null
  const displayedContent = activeSourceDraftPreview ?? suggestionBaseContent
  const activeOutline = useMemo(
    () => isActiveMystSource ? getMystOutline(displayedContent) : [],
    [displayedContent, isActiveMystSource],
  )
  const liveProposalChanges = useMemo(
    () => getLiveProposalInlineChanges(
      collaboration.content,
      collaboration.workingContent,
    ),
    [collaboration.content, collaboration.workingContent],
  )
  const selectedLiveProposalChangeId = liveProposalChanges.some(
    (change) => change.id === activeLiveProposalChangeId,
  ) ? activeLiveProposalChangeId : null
  const liveProposalAttribution = useMemo(() => {
    const first = collaboration.proposalContributors[0]
    return {
      name: collaboration.proposalContributors.length > 1
        ? `${collaboration.proposalContributors.length} contributors`
        : first?.name ?? 'Live proposal',
      color: first?.color ?? '#16705d',
    }
  }, [collaboration.proposalContributors])
  const liveProposalSourceHighlights = useMemo(
    () => liveProposalChanges.map((change) => ({
      id: change.id,
      from: change.workingFrom,
      to: change.workingTo,
      before: change.before,
      after: change.after,
      authorName: liveProposalAttribution.name,
      authorColor: liveProposalAttribution.color,
      active: selectedLiveProposalChangeId === change.id,
      projection: 'working' as const,
    })),
    [liveProposalAttribution, liveProposalChanges, selectedLiveProposalChangeId],
  )
  const liveProposalVisualSuggestions = useMemo(
    () => liveProposalChanges.map((change) => ({
      id: change.id,
      from: change.workingFrom,
      to: change.workingTo,
      before: change.before,
      after: change.after,
      authorName: liveProposalAttribution.name,
      authorColor: liveProposalAttribution.color,
      active: selectedLiveProposalChangeId === change.id,
      projection: 'working' as const,
    })),
    [liveProposalAttribution, liveProposalChanges, selectedLiveProposalChangeId],
  )
  const atomicInlineSuggestions = useMemo<MystPreviewSuggestion[]>(
    () => isPrimaryFile ? primarySuggestionProjection.suggestions.flatMap((suggestion) => {
      const comment = sharedComments.find((candidate) => candidate.id === suggestion.id)
      return comment ? [{
        id: suggestion.id,
        from: suggestion.from,
        to: suggestion.to,
        before: suggestion.before,
        after: suggestion.after,
        authorName: comment.authorName,
        authorColor: comment.authorColor,
        active: activeCommentId === suggestion.id,
      }] : []
    }) : [],
    [activeCommentId, isPrimaryFile, primarySuggestionProjection.suggestions, sharedComments],
  )
  const atomicSourceSuggestions = useMemo<SourceSuggestionHighlight[]>(
    () => isPrimaryFile ? primarySuggestionProjection.suggestions.flatMap((suggestion) => {
      const comment = sharedComments.find((candidate) => candidate.id === suggestion.id)
      return comment ? [{
        id: suggestion.id,
        from: suggestion.projectedFrom,
        to: suggestion.projectedTo,
        before: suggestion.before,
        after: suggestion.after,
        authorName: comment.authorName,
        authorColor: comment.authorColor,
        active: activeCommentId === suggestion.id,
        projection: 'working' as const,
      }] : []
    }) : [],
    [
      activeCommentId,
      isPrimaryFile,
      primarySuggestionProjection.suggestions,
      sharedComments,
    ],
  )
  const sourceSuggestions = collaboration.hasPendingWorkingChanges
    ? liveProposalSourceHighlights
    : atomicSourceSuggestions
  const visualSuggestions = collaboration.hasPendingWorkingChanges
    ? liveProposalVisualSuggestions
    : atomicInlineSuggestions
  const inactiveSuggestionIds = useMemo(
    () => collaboration.hasPendingWorkingChanges
      ? new Set(sharedComments.flatMap((comment) =>
          comment.suggestion?.status === 'pending' ? [comment.id] : [],
        ))
      : primarySuggestionProjection.hiddenIds,
    [
      collaboration.hasPendingWorkingChanges,
      primarySuggestionProjection.hiddenIds,
      sharedComments,
    ],
  )

  const title = useMemo(
    () => getDocumentTitle(displayedContent),
    [displayedContent],
  )
  const wordCount = useMemo(
    () => displayedContent.trim()
      ? displayedContent.trim().split(/\s+/).length
      : 0,
    [displayedContent],
  )

  const openCommentCount = useMemo(
    () => sharedComments.filter((comment) => !comment.resolved).length,
    [sharedComments],
  )
  const filteredReviewComments = useMemo(
    () => filterReviewThreads(sharedComments, sharedCommentMessages, {
      query: reviewQuery,
      status: reviewStatus,
      type: reviewType,
      ...(reviewForMe ? { forActorIds: ownedActorIds } : {}),
    }),
    [
      ownedActorIds,
      reviewForMe,
      reviewQuery,
      reviewStatus,
      reviewType,
      sharedCommentMessages,
      sharedComments,
    ],
  )
  const visibleReviewComments = useMemo(
    () => getVisibleReviewThreads(
      filteredReviewComments,
      reviewVisibleLimit,
      activeCommentId,
    ),
    [activeCommentId, filteredReviewComments, reviewVisibleLimit],
  )
  const commentMessagesByThread = useMemo(() => {
    const messages = new Map<string, SharedCommentMessage[]>()
    sharedCommentMessages.forEach((message) => {
      const threadMessages = messages.get(message.threadId) ?? []
      threadMessages.push(message)
      messages.set(message.threadId, threadMessages)
    })
    return messages
  }, [sharedCommentMessages])
  const mentionCandidates = useMemo(() => {
    const candidates = new Map<string, MentionCandidate>()
    const addCandidate = (
      actorId: string,
      name: string,
      color: string,
      colorLight = `${color}1f`,
      displayName = name,
    ) => {
      if (ownedActorIds.includes(actorId) || candidates.has(actorId)) return
      candidates.set(actorId, { actorId, name, displayName, color, colorLight })
    }
    collaborators.forEach((collaborator) => {
      const githubLogin = collaborator.name.match(/\(@([^)]+)\)$/)?.[1]
      addCandidate(
        collaborator.id,
        githubLogin ?? collaborator.name,
        collaborator.color,
        collaborator.colorLight,
        collaborator.name,
      )
    })
    sharedComments.forEach((comment) => addCandidate(
      comment.authorId,
      comment.authorName,
      comment.authorColor,
    ))
    sharedCommentMessages.forEach((message) => addCandidate(
      message.authorId,
      message.authorName,
      message.authorColor,
    ))
    return Array.from(candidates.values()).sort((left, right) =>
      left.name.localeCompare(right.name))
  }, [collaborators, ownedActorIds, sharedCommentMessages, sharedComments])

  const showNotice = (message: string) => {
    setNotice(message)
  }

  const revealCollaborator = (collaborator: Collaborator, message: string) => {
    if (!activeSharedText) return false
    const cursor = getCollaboratorCursor(
      collaborator.clientId,
      activeSharedText,
    )
    if (!cursor) {
      showNotice(`${collaborator.name} is viewing another file or mode.`)
      return false
    }

    const reveal = () => editorRef.current?.revealPosition(cursor.from)
    if (view === 'preview') {
      setView('source')
      window.requestAnimationFrame(reveal)
    } else reveal()
    showNotice(message)
    return true
  }

  const followCollaborator = (clientId: number | null) => {
    if (clientId === null) {
      setFollowedCollaboratorClientId(null)
      showNotice('Stopped following collaborator.')
      return
    }
    const collaborator = collaborators.find(
      (candidate) => candidate.clientId === clientId,
    )
    if (
      collaborator &&
      revealCollaborator(collaborator, `Following ${collaborator.name}.`)
    ) setFollowedCollaboratorClientId(clientId)
  }

  useEffect(() => {
    if (followedCollaboratorClientId === null || !activeSharedText) return
    const collaborator = collaborators.find(
      (candidate) => candidate.clientId === followedCollaboratorClientId,
    )
    if (!collaborator) return
    const cursor = getCollaboratorCursor(
      collaborator.clientId,
      activeSharedText,
    )
    if (cursor) editorRef.current?.revealPosition(cursor.from)
  }, [
    activeSharedText,
    collaborators,
    followedCollaboratorClientId,
    getCollaboratorCursor,
  ])

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

  useLayoutEffect(() => {
    if (!commentsOpen || !activeCommentId) return
    const frame = window.requestAnimationFrame(() => {
      const visualSuggestion = Array.from(
        document.querySelectorAll<HTMLElement>('[data-myst-suggestion-id]'),
      ).find((element) => element.dataset.mystSuggestionId === activeCommentId)
      visualSuggestion?.scrollIntoView({ block: 'center' })
      const thread = reviewThreadRefs.current.get(activeCommentId)
      thread?.scrollIntoView({ block: 'nearest' })
      thread?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeCommentId, commentsOpen, visibleReviewComments])

  const synchronizePreviewScroll = (progress: number) => {
    const expectedSourceProgress = expectedSourceScrollRef.current
    if (expectedSourceProgress !== null) {
      expectedSourceScrollRef.current = null
      if (Math.abs(progress - expectedSourceProgress) <= linkedScrollTolerance) return
    }
    const previewScroller = previewPaneRef.current
    if (
      view !== 'split' ||
      !linkedPaneScrolling ||
      !previewScroller ||
      window.getComputedStyle(previewScroller).display === 'none'
    ) return
    const range = previewScroller.scrollHeight - previewScroller.clientHeight
    const nextProgress = Math.max(0, Math.min(1, progress))
    const currentProgress = range > 0 ? previewScroller.scrollTop / range : 0
    if (Math.abs(currentProgress - nextProgress) <= linkedScrollTolerance) return
    expectedPreviewScrollRef.current = nextProgress
    previewScroller.scrollTop = nextProgress * Math.max(0, range)
  }

  const synchronizeSourceScroll = (previewScroller: HTMLElement) => {
    const range = previewScroller.scrollHeight - previewScroller.clientHeight
    const progress = range > 0 ? previewScroller.scrollTop / range : 0
    const expectedPreviewProgress = expectedPreviewScrollRef.current
    if (expectedPreviewProgress !== null) {
      expectedPreviewScrollRef.current = null
      if (Math.abs(progress - expectedPreviewProgress) <= linkedScrollTolerance) return
    }
    if (view !== 'split' || !linkedPaneScrolling) return
    const currentProgress = editorRef.current?.getScrollProgress() ?? 0
    if (Math.abs(currentProgress - progress) <= linkedScrollTolerance) return
    expectedSourceScrollRef.current = progress
    editorRef.current?.setScrollProgress(progress)
  }

  useEffect(() => {
    expectedSourceScrollRef.current = null
    expectedPreviewScrollRef.current = null
    if (view !== 'split' || !linkedPaneScrolling) return
    const frame = window.requestAnimationFrame(() => {
      const previewScroller = previewPaneRef.current
      if (!previewScroller || window.getComputedStyle(previewScroller).display === 'none') return
      const progress = editorRef.current?.getScrollProgress() ?? 0
      const range = previewScroller.scrollHeight - previewScroller.clientHeight
      const nextProgress = Math.max(0, Math.min(1, progress))
      const currentProgress = range > 0 ? previewScroller.scrollTop / range : 0
      if (Math.abs(currentProgress - nextProgress) <= linkedScrollTolerance) return
      expectedPreviewScrollRef.current = nextProgress
      previewScroller.scrollTop = nextProgress * Math.max(0, range)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeFilePath, commentsOpen, linkedPaneScrolling, view])

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
      if (
        comment.github?.resolved === comment.resolved &&
        (!comment.suggestion || comment.github.suggestionStatus === comment.suggestion.status)
      ) continue
      const version = [
        reviewNumber,
        comment.resolved,
        comment.body,
        comment.suggestion?.status,
        comment.suggestion?.decidedAt,
      ].join(':')
      if (commentSyncAttempts.current.get(comment.id) === version) continue
      commentSyncAttempts.current.set(comment.id, version)
      const location = resolveCommentAnchor(comment)

      void mirrorRoomComment(roomName, {
        ...comment,
        githubCommentId: comment.github?.id,
        githubMode: comment.github?.mode,
        anchor: (
          !comment.suggestion ||
          comment.suggestion.status === 'pending' ||
          comment.suggestion.status === 'conflicted'
        ) && location && !location.orphaned
          ? {
              startLine: location.startLine,
              endLine: location.endLine,
              quote: location.quote,
            }
          : undefined,
        suggestion: comment.suggestion && {
          kind: comment.suggestion.kind,
          before: comment.suggestion.before,
          after: comment.suggestion.after,
          status: comment.suggestion.status,
          decidedAt: comment.suggestion.decidedAt,
          decidedByName: comment.suggestion.decidedByName,
        },
      })
        .then((mirror) => {
          applyCommentMirror(
            comment.id,
            mirror,
            comment.resolved,
            comment.suggestion?.status,
          )
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
    if (commentId) {
      setActiveCommentId(commentId)
      setCommentComposerOpen(false)
    }
    setCommentDraft('')
  }

  const openCommentComposer = () => {
    if (!isPrimaryFile) {
      showNotice('Review comments on secondary project files are not available yet.')
      return
    }
    setCommentsOpen(true)
    setCommentComposerOpen(true)
    setActiveCommentId(null)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[aria-label="New comment"]')?.focus()
    })
  }

  const submitReply = (comment: SharedComment) => {
    const draft = replyDrafts[comment.id] ?? ''
    if (!collaboration.addCommentReply(
      comment.id,
      draft,
      resolveMentions(draft, mentionCandidates),
    )) return
    setReplyDrafts((current) => ({ ...current, [comment.id]: '' }))
  }

  const saveReviewItemEdit = () => {
    if (!editingReviewItem) return
    const pendingEdit = editingReviewItem
    setEditingReviewItem(null)
    const applied = pendingEdit.kind === 'comment'
      ? collaboration.editComment(pendingEdit.id, pendingEdit.body)
      : collaboration.editCommentReply(pendingEdit.id, pendingEdit.body)
    if (!applied) {
      showNotice('Only the original author can edit this comment.')
      return
    }
  }

  const beginCommentEdit = (comment: SharedComment) => {
    if (!ownedActorIds.includes(comment.authorId) || comment.suggestion) return
    setEditingReviewItem({ id: comment.id, kind: 'comment', body: comment.body })
  }

  const beginReplyEdit = (message: SharedCommentMessage) => {
    if (!ownedActorIds.includes(message.authorId)) return
    setEditingReviewItem({ id: message.id, kind: 'reply', body: message.body })
  }

  const decideCurrentProposal = async (status: 'accepted' | 'rejected') => {
    if (!isMaintainer || isDecidingProposal || !collaboration.isSynced) return
    setIsDecidingProposal(true)
    try {
      await decideLiveProposal(roomName, status)
      setMaintainerEditMode('editing')
      setActiveLiveProposalChangeId(null)
      showNotice(status === 'accepted' ? 'Live proposal accepted' : 'Live proposal discarded')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not decide the live proposal')
    } finally {
      setIsDecidingProposal(false)
    }
  }

  const decideSuggestion = (comment: SharedComment, decision: 'accept' | 'reject') => {
    if (!isMaintainer || !comment.suggestion) return
    if (inactiveSuggestionIds.has(comment.id)) {
      showNotice('A newer revision replaced this version. Review the current proposal instead.')
      return
    }
    const result = collaboration.decideTextSuggestion(
      comment.id,
      decision,
      primaryFilePath,
    )
    if (result === 'applied') {
      showNotice(decision === 'accept' ? 'Suggestion accepted' : 'Suggestion rejected')
      return
    }
    showNotice(
      result === 'conflict'
        ? 'The source changed around this suggestion. Review the latest text before deciding.'
        : 'This suggestion is no longer available.',
    )
  }

  const openCommentThread = (commentId: string, preserveReviewFilters = false) => {
    const comment = sharedComments.find((candidate) => candidate.id === commentId)
    setCommentsOpen(true)
    setCommentComposerOpen(false)
    if (!preserveReviewFilters) {
      setReviewQuery('')
      setReviewStatus(comment?.resolved ? 'resolved' : 'open')
      setReviewType('all')
      setReviewForMe(false)
      setReviewVisibleLimit(reviewBatchSize)
    }
    setActiveCommentId(commentId)
    setActiveLiveProposalChangeId(null)
    const location = commentLocations.get(commentId)
    if (!location || location.orphaned) return
    if (view === 'preview') setView('split')
    window.requestAnimationFrame(() => {
      editorRef.current?.revealRange(location.from, location.to, false)
    })
  }

  const openLiveProposalChange = (changeId: string) => {
    const change = liveProposalChanges.find((candidate) => candidate.id === changeId)
    if (!change) {
      openCommentThread(changeId)
      return
    }
    setCommentsOpen(true)
    setActiveCommentId(null)
    setActiveLiveProposalChangeId(changeId)
    if (view === 'preview') setView('split')
    window.requestAnimationFrame(() => {
      editorRef.current?.revealRange(change.workingFrom, change.workingTo)
    })
  }

  const reviewChangesOrEnterEditing = () => {
    if (!collaboration.hasPendingWorkingChanges) {
      setMaintainerEditMode('editing')
      return
    }
    const firstChange = liveProposalChanges[0]
    if (firstChange) openLiveProposalChange(firstChange.id)
    else setCommentsOpen(true)
    showNotice('Accept all or discard all proposed changes before returning to Editing')
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
    if (collaboration.hasPendingWorkingChanges) {
      showNotice('Accept or discard the live proposal before submitting accepted MyST to GitHub.')
      setCommentsOpen(true)
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
      if (!canInsertCitation) {
        throw new Error(citationDisabledReason ?? 'Citation insertion is unavailable.')
      }
      if (!canAddCitationReferences && selections.some((selection) => selection.kind === 'paper')) {
        throw new Error('New papers can be added after proposed changes are resolved.')
      }
      const citationSyntax = detectCitationSyntax(activeContent)
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
          citationSyntax,
        )
      }
      else editorRef.current?.insertCitation(formatCitation(
        keys,
        style,
        details,
        citationSyntax,
      ))
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

  useEffect(() => {
    const openCommentsFromKeyboard = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'm' ||
        !(event.metaKey || event.ctrlKey) ||
        !event.altKey ||
        blockingDialogOpen
      ) return
      event.preventDefault()
      openCommentComposer()
    }
    window.addEventListener('keydown', openCommentsFromKeyboard)
    return () => window.removeEventListener('keydown', openCommentsFromKeyboard)
  })

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

  const saveOrConnectRepository = () => {
    if (repositoryBinding) void saveToGitHub()
    else setGitHubDialogOpen(true)
  }

  return (
    <div className="app-shell">
      <header className="topbar" inert={blockingDialogOpen}>
        <div className="brand-block">
          <div className="brand-mark" aria-label="DeMystify" role="img">D</div>
          <div className="document-chrome">
            <div className="document-heading">
              <span className="document-title">{title}</span>
              <span className={`sync-status ${isArchived ? 'archived' : collaboration.status !== 'connected' ? collaboration.status : sharedAccessRole ? 'viewer' : collaboration.status}`}>
                <span className="status-dot" />
                {isArchived
                  ? 'Archived'
                  : collaboration.accessError
                    ? 'Access revoked'
                    : collaboration.status !== 'connected'
                      ? collaboration.status
                      : isViewer
                        ? 'Viewing'
                        : isSuggestionMode
                          ? 'Suggesting'
                          : 'Live'}
              </span>
            </div>
            <nav className="document-menu-bar" aria-label="Document menu">
              <DocumentMenu
                label="File"
                items={[
                  {
                    label: 'New document',
                    icon: FilePlus2,
                    onSelect: createDocument,
                  },
                  {
                    label: repositoryBinding ? 'Save to GitHub' : 'Connect repository to save',
                    icon: Save,
                    disabled: isSaving || !canManageRepository || collaboration.hasPendingWorkingChanges,
                    onSelect: saveOrConnectRepository,
                  },
                  {
                    label: repositoryBinding ? 'Change repository or file' : 'Connect GitHub repository',
                    icon: GitFork,
                    separatorBefore: true,
                    disabled: !canManageRepository,
                    onSelect: () => setGitHubDialogOpen(true),
                  },
                ]}
              />
              <DocumentMenu
                label="Edit"
                items={[
                  {
                    label: 'Undo',
                    icon: Undo2,
                    shortcut: '⌘Z',
                    disabled: isSourceReadOnly,
                    onSelect: () => editorRef.current?.undo(),
                  },
                  {
                    label: 'Redo',
                    icon: Redo2,
                    shortcut: '⌘⇧Z',
                    disabled: isSourceReadOnly,
                    onSelect: () => editorRef.current?.redo(),
                  },
                ]}
              />
              <DocumentMenu
                label="View"
                items={[
                  {
                    label: 'Source',
                    icon: Code2,
                    checked: view === 'source',
                    onSelect: () => setView('source'),
                  },
                  {
                    label: 'Split',
                    icon: SplitSquareHorizontal,
                    checked: view === 'split',
                    disabled: !isActiveMystSource,
                    onSelect: () => setView('split'),
                  },
                  {
                    label: 'Visual',
                    icon: Eye,
                    checked: view === 'preview',
                    disabled: !isActiveMystSource,
                    onSelect: () => setView('preview'),
                  },
                  {
                    label: sidebarOpen ? 'Collapse project sidebar' : 'Show project sidebar',
                    icon: sidebarOpen ? ChevronLeft : ChevronRight,
                    separatorBefore: true,
                    onSelect: () => setSidebarOpen((open) => !open),
                  },
                ]}
              />
              <MystInsertMenu
                variant="menu"
                disabled={isSourceReadOnly || !isActiveMystSource}
                onAddComment={openCommentComposer}
                onInsert={(pattern) => editorRef.current?.insertSnippet(
                  pattern.template,
                  pattern.selectedTextPlaceholder,
                )}
              />
              <DocumentMenu
                label="Format"
                items={[
                  {
                    label: 'Bold',
                    icon: Bold,
                    shortcut: '⌘B',
                    disabled: isSourceReadOnly || !isActiveMystSource,
                    onSelect: () => editorRef.current?.wrapSelection('**'),
                  },
                  {
                    label: 'Italic',
                    icon: Italic,
                    shortcut: '⌘I',
                    disabled: isSourceReadOnly || !isActiveMystSource,
                    onSelect: () => editorRef.current?.wrapSelection('*'),
                  },
                  {
                    label: 'Inline code',
                    icon: Code2,
                    disabled: isSourceReadOnly || !isActiveMystSource,
                    onSelect: () => editorRef.current?.wrapSelection('`'),
                  },
                ]}
              />
              <DocumentMenu
                label="Tools"
                items={[
                  {
                    label: 'Review suggested edits',
                    icon: MessageSquare,
                    disabled: !isMaintainer || !collaboration.hasPendingWorkingChanges,
                    onSelect: reviewChangesOrEnterEditing,
                  },
                  {
                    label: 'Citations',
                    icon: AtSign,
                    separatorBefore: true,
                    description: citationDisabledReason,
                    disabled: !canInsertCitation,
                    onSelect: () => {
                      setVisualCitationInserter(null)
                      setCitationPickerOpen(true)
                    },
                  },
                  {
                    label: 'Reference library',
                    icon: BookOpenText,
                    onSelect: () => setReferenceManagerOpen(true),
                  },
                  {
                    label: 'Publication metadata',
                    icon: Tags,
                    disabled: !isActiveMystSource,
                    onSelect: () => setPublicationMetadataOpen(true),
                  },
                  {
                    label: 'Word count',
                    icon: TextQuote,
                    shortcut: `${wordCount.toLocaleString()} words`,
                    separatorBefore: true,
                    onSelect: () => showNotice(`${wordCount.toLocaleString()} words`),
                  },
                ]}
              />
              <button
                ref={helpTriggerRef}
                className="document-menu-trigger"
                type="button"
                title="How DeMystify works"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>
            </nav>
          </div>
        </div>

        <div className="topbar-actions">
          <ParticipantsMenu
            collaborators={collaborators}
            currentActorId={collaborationProfile.id}
            followedClientId={followedCollaboratorClientId}
            onEditProfile={!github.session?.user ? () => setEditingProfile(true) : undefined}
            onFollow={followCollaborator}
            onJump={(collaborator) => {
              setFollowedCollaboratorClientId(null)
              revealCollaborator(collaborator, `Jumped to ${collaborator.name}.`)
            }}
          />
          {github.session?.user ? (
            <button
              aria-label={`GitHub identity @${github.session.user.login}`}
              className="button secondary-button github-profile-button"
              type="button"
              title={`GitHub identity @${github.session.user.login}`}
              onClick={() => setGitHubDialogOpen(true)}
            >
              {github.session.user.avatarUrl ? (
                <img src={github.session.user.avatarUrl} alt="" />
              ) : (
                <UserRound size={17} aria-hidden="true" />
              )}
            </button>
          ) : !isMaintainer ? (
            <button
              className="button github-button"
              type="button"
              disabled={github.isLoading}
              title="Connect GitHub identity"
              onClick={() => setGitHubDialogOpen(true)}
            >
              <GitFork size={16} />
              <span>Connect GitHub</span>
            </button>
          ) : null}
          {isMaintainer && !isArchived && (
            <button className="button secondary-button" type="button" title="Share access" onClick={shareDocument}>
              <Share2 size={16} />
              <span>Share</span>
            </button>
          )}
          {isMaintainer && (isArchived || !repositoryBinding) ? (
            <button
              className="button github-button"
              type="button"
              disabled={isSaving || (!isArchived && collaboration.hasPendingWorkingChanges)}
              title={isArchived
                ? 'Open pull request'
                : collaboration.hasPendingWorkingChanges
                  ? 'Accept or discard the live proposal before saving to GitHub'
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
          ) : null}
        </div>
      </header>

      <main
        className={`workspace ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
        inert={blockingDialogOpen}
      >
        <button
          ref={sidebarToggleRef}
          className={`sidebar-edge-toggle ${sidebarOpen ? 'open' : ''}`}
          type="button"
          title={sidebarOpen ? 'Hide files' : 'Show files'}
          aria-controls="project-files-sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
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
                <strong>
                  {collaboration.accessError
                    ? 'Sharing access ended'
                    : isViewer ? 'Viewer access' : 'Suggestion mode'}
                </strong>
                <span>
                  {collaboration.accessError
                    ? collaboration.accessError
                    : isViewer
                    ? 'Live manuscript updates and review history are available; editing is disabled.'
                    : github.session?.user
                      ? 'Your GitHub identity labels each Source and Visual suggestion. Maintainers accept or reject suggestions individually.'
                      : 'Source suggestions save after a short pause; Visual suggestions save when you finish the edit. Connect GitHub for verified attribution.'}
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
            <div className="toolbar-left">
              <div className="formatting-tools" aria-label="Authoring tools">
                <button
                  className="icon-button toolbar-save"
                  type="button"
                  title={collaboration.hasPendingWorkingChanges
                    ? 'Accept or discard the live proposal before saving to GitHub'
                    : 'Save snapshot to GitHub'}
                  disabled={
                    isArchived ||
                    isSaving ||
                    !canManageRepository ||
                    collaboration.hasPendingWorkingChanges
                  }
                  onClick={saveOrConnectRepository}
                >
                  {isSaving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
                </button>
                <button className="icon-button collapsible-authoring-tool" type="button" title="Undo" disabled={isSourceReadOnly} onClick={() => editorRef.current?.undo()}>
                  <Undo2 size={17} />
                </button>
                <button className="icon-button collapsible-authoring-tool" type="button" title="Redo" disabled={isSourceReadOnly} onClick={() => editorRef.current?.redo()}>
                  <Redo2 size={17} />
                </button>
                <span className="toolbar-divider collapsible-authoring-tool" />
                <button className="icon-button collapsible-authoring-tool" type="button" title="Bold" disabled={isSourceReadOnly || !isActiveMystSource} onClick={() => editorRef.current?.wrapSelection('**')}>
                  <Bold size={17} />
                </button>
                <button className="icon-button collapsible-authoring-tool" type="button" title="Italic" disabled={isSourceReadOnly || !isActiveMystSource} onClick={() => editorRef.current?.wrapSelection('*')}>
                  <Italic size={17} />
                </button>
                <button className="icon-button collapsible-authoring-tool" type="button" title="Inline code" disabled={isSourceReadOnly || !isActiveMystSource} onClick={() => editorRef.current?.wrapSelection('`')}>
                  <Code2 size={17} />
                </button>
              </div>

              <details className="authoring-more">
                <summary className="icon-button" title="More authoring tools" aria-label="More authoring tools">
                  <MoreHorizontal size={17} />
                </summary>
                <div className="authoring-more-menu" role="menu" aria-label="More authoring tools">
                <button type="button" role="menuitem" disabled={isSourceReadOnly} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  editorRef.current?.undo()
                }}>
                  <Undo2 size={15} /> Undo
                </button>
                <button type="button" role="menuitem" disabled={isSourceReadOnly} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  editorRef.current?.redo()
                }}>
                  <Redo2 size={15} /> Redo
                </button>
                <button type="button" role="menuitem" disabled={isSourceReadOnly || !isActiveMystSource} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  editorRef.current?.wrapSelection('**')
                }}>
                  <Bold size={15} /> Bold
                </button>
                <button type="button" role="menuitem" disabled={isSourceReadOnly || !isActiveMystSource} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  editorRef.current?.wrapSelection('*')
                }}>
                  <Italic size={15} /> Italic
                </button>
                <button type="button" role="menuitem" disabled={isSourceReadOnly || !isActiveMystSource} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  editorRef.current?.wrapSelection('`')
                }}>
                  <Code2 size={15} /> Inline code
                </button>
                </div>
              </details>
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

            <div className="review-tools">
              <button
                ref={commentsTriggerRef}
                className="icon-button comments-trigger"
                type="button"
                title={isPrimaryFile ? 'Open comments' : 'Comments are currently limited to the primary manuscript'}
                disabled={!isPrimaryFile}
                onClick={() => {
                  setCommentsOpen((open) => {
                    if (open) setCommentComposerOpen(false)
                    return !open
                  })
                }}
              >
                <MessageSquare size={17} />
                {openCommentCount > 0 && (
                  <span className="comment-count">
                    {openCommentCount}
                  </span>
                )}
              </button>

              {isMaintainer && isPrimaryFile && !isArchived ? (
                <DocumentMenu
                  align="right"
                  className={`mode-menu ${collaboration.hasPendingWorkingChanges ? 'needs-review' : ''}`}
                  disabled={!collaboration.isSynced}
                  icon={collaboration.hasPendingWorkingChanges || isSuggestionMode ? MessageSquare : PencilLine}
                  label={collaboration.hasPendingWorkingChanges
                    ? 'Review changes'
                    : isSuggestionMode ? 'Suggesting' : 'Editing'}
                  showChevron
                  items={[
                    ...(collaboration.hasPendingWorkingChanges ? [{
                      label: 'Review changes',
                      icon: MessageSquare,
                      onSelect: reviewChangesOrEnterEditing,
                    }] : []),
                    {
                      label: 'Editing',
                      icon: PencilLine,
                      checked: !isSuggestionMode,
                      separatorBefore: collaboration.hasPendingWorkingChanges,
                      onSelect: reviewChangesOrEnterEditing,
                    },
                    {
                      label: 'Suggesting',
                      icon: MessageSquare,
                      checked: isSuggestionMode,
                      onSelect: () => setMaintainerEditMode('suggesting'),
                    },
                  ]}
                />
              ) : (
                <button
                  className="mode-status"
                  type="button"
                  aria-label={isViewer || isArchived ? 'Viewing' : 'Suggesting'}
                  disabled
                >
                  {isViewer || isArchived ? <Eye size={15} /> : <MessageSquare size={15} />}
                  <span>{isViewer || isArchived ? 'Viewing' : 'Suggesting'}</span>
                </button>
              )}
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
                  onCommentClick={openLiveProposalChange}
                  onProposeSourceEdit={(draft) => {
                    const projected = getProjectedSuggestionReplacement(
                      activeSuggestionProjection,
                      draft,
                    )
                    if (!projected || projected === 'conflict') {
                      return {
                        result: projected === 'conflict' ? 'conflict' : 'unavailable',
                      }
                    }
                    const { replacement, supersedes } = projected
                    const anchor = collaboration.beginTextEdit(
                      replacement.from,
                      replacement.to,
                      replacement.before,
                      activeFilePath,
                      primaryFilePath,
                    )
                    if (!anchor) return { result: 'conflict' as const }
                    const proposal = collaboration.createTextSuggestion(
                      anchor,
                      replacement.after,
                      activeFilePath,
                      primaryFilePath,
                      supersedes,
                    )
                    if (proposal.suggestionId) {
                      setActiveCommentId(proposal.suggestionId)
                      setCommentsOpen(true)
                      showNotice('Suggestion ready for review')
                    }
                    return proposal
                  }}
                  onScrollProgress={synchronizePreviewScroll}
                  onSourceDraftChange={(draft) => setSourceDraftPreview(
                    draft === null ? null : { filePath: activeFilePath, content: draft },
                  )}
                  readOnly={isSourceReadOnly}
                  suggestionBaseContent={suggestionBaseContent}
                  suggestionMode={isAtomicSuggestionMode && isActiveMystSource && isPrimaryFile}
                  suggestionHighlights={isPrimaryFile ? sourceSuggestions : []}
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

            {view === 'split' && isActiveMystSource && (
              <button
                aria-label={linkedPaneScrolling ? 'Unlink pane scrolling' : 'Link pane scrolling'}
                aria-pressed={linkedPaneScrolling}
                className={`pane-scroll-link ${linkedPaneScrolling ? 'active' : ''}`}
                type="button"
                title={linkedPaneScrolling ? 'Unlink pane scrolling' : 'Link pane scrolling'}
                onClick={() => {
                  expectedSourceScrollRef.current = null
                  expectedPreviewScrollRef.current = null
                  setLinkedPaneScrolling((current) => !current)
                }}
              >
                {linkedPaneScrolling
                  ? <Link2 size={14} aria-hidden="true" />
                  : <Unlink2 size={14} aria-hidden="true" />}
              </button>
            )}

            <section
              ref={previewPaneRef}
              className="preview-pane"
              aria-label={effectiveReadOnly ? 'Browser preview' : 'Visual document editor'}
              onScroll={(event) => synchronizeSourceScroll(event.currentTarget)}
            >
              <div className="preview-label">
                <span>{effectiveReadOnly ? 'Browser preview' : 'Visual editor'}</span>
                <span>{collaboration.isSynced ? 'Live draft' : 'Preparing'}</span>
              </div>
              <Suspense fallback={<div className="pane-loading">Rendering MyST...</div>}>
                <MystPreview
                  assetBaseUrl={activeAssetBaseUrl}
                  bibliography={collaboration.bibliography}
                  content={displayedContent}
                  liveEditing={!isAtomicSuggestionMode}
                  editable={
                    !effectiveReadOnly &&
                    collaboration.isSynced &&
                    isActiveMystSource &&
                    (!isSuggestionMode || (isPrimaryFile && activeSourceDraftPreview === null))
                  }
                  projectFiles={collaboration.projectFiles}
                  sourcePath={activeFilePath}
                  onBeginEdit={(block) => {
                    visualSuggestionSupersedesRef.current = []
                    if (!isAtomicSuggestionMode) {
                      return collaboration.beginTextEdit(
                        block.from,
                        block.to,
                        block.value,
                        activeFilePath,
                        primaryFilePath,
                      )
                    }
                    const projected = mapProjectedRange(
                      activeSuggestionProjection,
                      block.from,
                      block.to,
                    )
                    if (projected === 'conflict') return null
                    visualSuggestionSupersedesRef.current = projected.supersedes
                    return collaboration.beginTextEdit(
                      projected.replacement.from,
                      projected.replacement.to,
                      projected.replacement.before,
                      activeFilePath,
                      primaryFilePath,
                    )
                  }}
                  onCommitEdit={(anchor, replacement) => {
                    if (!isAtomicSuggestionMode) {
                      return collaboration.commitTextEdit(
                        anchor,
                        replacement,
                        activeFilePath,
                        primaryFilePath,
                      )
                    }
                    const proposal = collaboration.createTextSuggestion(
                      anchor,
                      replacement,
                      activeFilePath,
                      primaryFilePath,
                      visualSuggestionSupersedesRef.current,
                    )
                    visualSuggestionSupersedesRef.current = []
                    if (proposal.suggestionId) {
                      setActiveCommentId(proposal.suggestionId)
                      setCommentsOpen(true)
                      showNotice('Suggestion ready for review')
                    }
                    return proposal.result
                  }}
                  onEditError={showNotice}
                  onSuggestionClick={openLiveProposalChange}
                  onRequestCitation={(insert) => {
                    setVisualCitationInserter(() => insert)
                    setCitationPickerOpen(true)
                  }}
                  suggestions={isPrimaryFile ? visualSuggestions : []}
                />
              </Suspense>
            </section>

            {commentsOpen && (
              <aside
                className={`comments-panel ${commentComposerOpen ? 'composer-open' : ''}`}
                aria-label="Comments"
              >
                <div className="comments-heading">
                  <div>
                    <strong>Review</strong>
                    <span title={commentPollError ?? undefined}>
                      {openCommentCount} open
                      {commentPollError ? ' | GitHub sync retrying' : ''}
                    </span>
                  </div>
                  <div className="comments-heading-actions">
                    {!effectiveReadOnly && (
                      <button
                        className="icon-button"
                        type="button"
                        title="Add comment to selection"
                        onClick={openCommentComposer}
                      >
                        <Plus size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      type="button"
                      title="Close comments"
                      onClick={() => {
                        setCommentsOpen(false)
                        setCommentComposerOpen(false)
                        window.requestAnimationFrame(() => commentsTriggerRef.current?.focus())
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <div className="review-inbox-controls">
                  <label className="review-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      aria-label="Search review"
                      placeholder="Search comments"
                      type="search"
                      value={reviewQuery}
                      onChange={(event) => {
                        setReviewQuery(event.target.value)
                        setReviewVisibleLimit(reviewBatchSize)
                      }}
                    />
                  </label>
                  <div className="review-filter-row">
                    <div className="review-segmented" role="group" aria-label="Review status">
                      {(['open', 'resolved', 'all'] as const).map((status) => (
                        <button
                          aria-pressed={reviewStatus === status}
                          key={status}
                          type="button"
                          onClick={() => {
                            setReviewStatus(status)
                            setReviewVisibleLimit(reviewBatchSize)
                          }}
                        >
                          {status[0].toUpperCase() + status.slice(1)}
                        </button>
                      ))}
                    </div>
                    <button
                      aria-pressed={reviewForMe}
                      className="review-for-me"
                      type="button"
                      onClick={() => {
                        setReviewForMe((current) => !current)
                        setReviewVisibleLimit(reviewBatchSize)
                      }}
                    >
                      For you
                    </button>
                  </div>
                  <div className="review-type-row" role="group" aria-label="Review type">
                    {(['all', 'comments', 'suggestions'] as const).map((type) => (
                      <button
                        aria-pressed={reviewType === type}
                        key={type}
                        type="button"
                        onClick={() => {
                          setReviewType(type)
                          setReviewVisibleLimit(reviewBatchSize)
                        }}
                      >
                        {type[0].toUpperCase() + type.slice(1)}
                      </button>
                    ))}
                    <span aria-live="polite">
                      {visibleReviewComments.length} of {filteredReviewComments.length}
                    </span>
                  </div>
                </div>
                {commentComposerOpen && (
                  <div className="comment-composer">
                    <textarea
                      aria-label="New comment"
                      placeholder="Comment on the current selection..."
                      disabled={effectiveReadOnly}
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitComment()
                      }}
                    />
                    <div className="comment-composer-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setCommentDraft('')
                          setCommentComposerOpen(false)
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="button comment-button"
                        type="button"
                        disabled={effectiveReadOnly || !commentDraft.trim()}
                        onClick={submitComment}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                )}
                <div className="comment-list">
                  {collaboration.hasPendingWorkingChanges && (
                    <article className="live-proposal-card">
                      <div className="live-proposal-heading">
                        <div>
                          <strong>Current live proposal</strong>
                          <span>Visible to everyone in Source and Visual</span>
                        </div>
                        <span className="live-proposal-status">pending</span>
                      </div>
                      <div className="proposal-contributors" aria-label="Proposal contributors">
                        {collaboration.proposalContributors.length > 0
                          ? collaboration.proposalContributors.map((contributor) => (
                              <span key={contributor.actorId} style={{ borderColor: contributor.color }}>
                                {contributor.name}
                              </span>
                            ))
                          : <span>Recording contributor...</span>}
                      </div>
                      <div className="live-proposal-changes" aria-label="Live proposal changes">
                        {liveProposalChanges.map((change, index) => {
                          const kind = change.before && change.after
                            ? 'Replace'
                            : change.before ? 'Delete' : 'Add'
                          return (
                          <button
                            aria-pressed={selectedLiveProposalChangeId === change.id}
                            className={`live-proposal-change ${selectedLiveProposalChangeId === change.id ? 'is-active' : ''}`}
                            key={change.id}
                            onClick={() => openLiveProposalChange(change.id)}
                            type="button"
                          >
                            <span className="live-proposal-change-heading">
                              <strong>{kind}</strong>
                              <span>{index + 1} of {liveProposalChanges.length}</span>
                            </span>
                            {change.before && (
                              <span className="suggestion-line removed">
                                <Minus size={13} aria-hidden="true" />
                                <del>{change.before}</del>
                              </span>
                            )}
                            {change.after && (
                              <span className="suggestion-line added">
                                <Plus size={13} aria-hidden="true" />
                                <ins>{change.after}</ins>
                              </span>
                            )}
                          </button>
                          )
                        })}
                      </div>
                      {isMaintainer ? (
                        <div className="live-proposal-actions">
                          <button
                            type="button"
                            disabled={
                              isDecidingProposal ||
                              !collaboration.isSynced ||
                              collaboration.proposalContributors.length === 0
                            }
                            onClick={() => void decideCurrentProposal('rejected')}
                          >
                            <X size={13} /> Discard all
                          </button>
                          <button
                            className="accept"
                            type="button"
                            disabled={
                              isDecidingProposal ||
                              !collaboration.isSynced ||
                              collaboration.proposalContributors.length === 0
                            }
                            onClick={() => void decideCurrentProposal('accepted')}
                          >
                            <Check size={13} /> Accept all
                          </button>
                        </div>
                      ) : (
                        <small>A maintainer must accept or reject this proposal.</small>
                      )}
                    </article>
                  )}
                  {collaboration.proposalHistory.slice(0, 10).map((checkpoint) => (
                    <details className="proposal-checkpoint" key={checkpoint.id}>
                      <summary>
                        <span>{checkpoint.status === 'accepted' ? 'Accepted' : 'Rejected'} proposal</span>
                        <time dateTime={checkpoint.decidedAt}>{formatRelativeTime(checkpoint.decidedAt)}</time>
                      </summary>
                      <p>
                        {checkpoint.contributors.map((contributor) => contributor.name).join(', ') || 'Unattributed migration'}
                        {' | '}{checkpoint.status} by {checkpoint.decidedByName}
                        {checkpoint.commitSha && ` | Git ${checkpoint.commitSha.slice(0, 7)}`}
                      </p>
                    </details>
                  ))}
                  {sharedComments.length === 0 && !collaboration.hasPendingWorkingChanges ? (
                    <div className="comments-empty">
                      <MessageSquare size={20} />
                      <span>No comments yet</span>
                    </div>
                  ) : filteredReviewComments.length === 0 ? (
                    <div className="comments-empty">
                      <Search size={20} />
                      <span>No matching review threads</span>
                    </div>
                  ) : visibleReviewComments.map((comment) => {
                    const location = commentLocations.get(comment.id)
                    const replies = commentMessagesByThread.get(comment.id) ?? []
                    const isActiveThread = activeCommentId === comment.id
                    const isEarlierRevision = comment.suggestion?.status === 'pending' &&
                      inactiveSuggestionIds.has(comment.id)
                    const suggestionAction = comment.suggestion?.kind === 'insert'
                      ? 'Insert'
                      : comment.suggestion?.kind === 'delete'
                        ? 'Delete'
                        : 'Replace'
                    const suggestionState = isEarlierRevision
                      ? 'Earlier revision'
                      : comment.suggestion?.status === 'accepted'
                        ? 'Accepted'
                        : comment.suggestion?.status === 'rejected'
                          ? 'Rejected'
                          : comment.suggestion?.status === 'conflicted'
                            ? 'Needs attention'
                            : null
                    return (
                    <article
                      aria-expanded={isActiveThread}
                      aria-label={`${comment.suggestion ? 'Suggestion' : 'Comment'} thread by ${comment.authorName}, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                      className={`comment ${comment.suggestion ? 'suggestion-thread' : ''} ${comment.resolved ? 'resolved' : ''} ${isActiveThread ? 'active' : ''}`}
                      data-review-thread-id={comment.id}
                      key={comment.id}
                      onClick={(event) => {
                        const target = event.target
                        if (
                          target instanceof Element &&
                          target.closest('button, a, input, textarea, select, summary')
                        ) return
                        openCommentThread(comment.id, true)
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        openCommentThread(comment.id, true)
                      }}
                      ref={(element) => {
                        if (element) reviewThreadRefs.current.set(comment.id, element)
                        else reviewThreadRefs.current.delete(comment.id)
                      }}
                      tabIndex={0}
                    >
                      <div className="comment-meta">
                        <span aria-hidden="true" className="mini-avatar" style={{ background: `${comment.authorColor}1f`, color: comment.authorColor }}>
                          {comment.authorName.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{comment.authorName}</strong>
                        <time dateTime={comment.createdAt}>{formatRelativeTime(comment.createdAt)}</time>
                        {(replies.length > 0 || comment.resolved) && (
                          <span className="comment-thread-state">
                            {replies.length > 0
                              ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                              : 'Resolved'}
                          </span>
                        )}
                      </div>
                      {!comment.suggestion && comment.anchor ? (
                        <button
                          className="comment-anchor-context"
                          type="button"
                          onClick={() => openCommentThread(comment.id, true)}
                        >
                          <span>{location?.orphaned ? comment.anchor.quote : location?.quote ?? comment.anchor.quote}</span>
                          {location?.orphaned && <em>Original text deleted</em>}
                        </button>
                      ) : !comment.suggestion ? (
                        <div className="comment-document-context">Document comment</div>
                      ) : null}
                      {comment.suggestion ? (
                        <>
                          <p className={`suggestion-summary is-${isEarlierRevision ? 'superseded' : comment.suggestion.status}`}>
                            {suggestionState && <><span>{suggestionState}</span>{' '}</>}
                            <strong>{suggestionAction}:</strong>{' '}
                            {comment.suggestion.kind === 'replace' ? (
                              <>
                                <q>{comment.suggestion.before}</q> with <q>{comment.suggestion.after}</q>
                              </>
                            ) : (
                              <q>{comment.suggestion.kind === 'delete'
                                ? comment.suggestion.before
                                : comment.suggestion.after}</q>
                            )}
                          </p>
                          {isActiveThread && comment.suggestion.decidedByName && (
                            <small className="suggestion-decision">
                              {comment.suggestion.status === 'accepted' ? 'Accepted' : 'Rejected'} by{' '}
                              {comment.suggestion.decidedByName}
                            </small>
                          )}
                        </>
                      ) : (
                        editingReviewItem?.kind === 'comment' && editingReviewItem.id === comment.id ? (
                          <div className="comment-edit-composer">
                            <textarea
                              aria-label={`Edit comment by ${comment.authorName}`}
                              value={editingReviewItem.body}
                              onChange={(event) => setEditingReviewItem({
                                ...editingReviewItem,
                                body: event.target.value,
                              })}
                              onKeyDown={(event) => {
                                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                  event.preventDefault()
                                  saveReviewItemEdit()
                                }
                              }}
                            />
                            <div>
                              <button type="button" onClick={() => setEditingReviewItem(null)}>Cancel</button>
                              <button type="button" disabled={!editingReviewItem.body.trim()} onClick={saveReviewItemEdit}>Save</button>
                            </div>
                          </div>
                        ) : (
                          <p>
                            {comment.body}
                            {comment.editedAt && <small className="edited-label"> edited</small>}
                          </p>
                        )
                      )}
                      {isActiveThread && replies.length > 0 && (
                        <div className="comment-replies">
                          {replies.map((message) => (
                            <div className="comment-reply" key={message.id}>
                              <div className="comment-meta">
                                <span aria-hidden="true" className="mini-avatar" style={{ background: `${message.authorColor}1f`, color: message.authorColor }}>
                                  {message.authorName.slice(0, 1).toUpperCase()}
                                </span>
                                <strong>{message.authorName}</strong>
                                <time dateTime={message.createdAt}>{formatRelativeTime(message.createdAt)}</time>
                                {ownedActorIds.includes(message.authorId) && (
                                  <button
                                    className="comment-inline-edit"
                                    type="button"
                                    title="Edit your reply"
                                    onClick={() => beginReplyEdit(message)}
                                  >
                                    <PencilLine size={12} />
                                  </button>
                                )}
                              </div>
                              {editingReviewItem?.kind === 'reply' && editingReviewItem.id === message.id ? (
                                <div className="comment-edit-composer">
                                  <textarea
                                    aria-label={`Edit reply by ${message.authorName}`}
                                    value={editingReviewItem.body}
                                    onChange={(event) => setEditingReviewItem({
                                      ...editingReviewItem,
                                      body: event.target.value,
                                    })}
                                    onKeyDown={(event) => {
                                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                        event.preventDefault()
                                        saveReviewItemEdit()
                                      }
                                    }}
                                  />
                                  <div>
                                    <button type="button" onClick={() => setEditingReviewItem(null)}>Cancel</button>
                                    <button type="button" disabled={!editingReviewItem.body.trim()} onClick={saveReviewItemEdit}>Save</button>
                                  </div>
                                </div>
                              ) : (
                                <p>
                                  {message.body}
                                  {message.editedAt && <small className="edited-label"> edited</small>}
                                </p>
                              )}
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
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                      {isActiveThread && (
                        <div className="comment-reply-composer">
                          <MentionInput
                            ariaLabel={`Reply to comment by ${comment.authorName}`}
                            candidates={mentionCandidates}
                            disabled={effectiveReadOnly}
                            placeholder={mentionCandidates.length > 0
                              ? 'Reply or add others with @'
                              : 'Reply'}
                            value={replyDrafts[comment.id] ?? ''}
                            onChange={(value) => setReplyDrafts((current) => ({
                              ...current,
                              [comment.id]: value,
                            }))}
                            onSubmit={() => submitReply(comment)}
                          />
                          <button
                            type="button"
                            title="Reply"
                            disabled={effectiveReadOnly || !(replyDrafts[comment.id] ?? '').trim()}
                            onClick={() => submitReply(comment)}
                          >
                            <Reply size={14} />
                          </button>
                        </div>
                      )}
                      {isActiveThread && <div className="comment-actions">
                        {comment.suggestion ? (
                          isMaintainer && (
                            comment.suggestion.status === 'pending' ||
                            comment.suggestion.status === 'conflicted'
                          ) && !isEarlierRevision ? (
                            <div className="suggestion-actions">
                              <button type="button" onClick={() => decideSuggestion(comment, 'reject')}>
                                <X size={13} /> Reject
                              </button>
                              <button className="accept" type="button" onClick={() => decideSuggestion(comment, 'accept')}>
                                <Check size={13} />
                                {comment.suggestion.status === 'conflicted' ? 'Retry accept' : 'Accept'}
                              </button>
                            </div>
                          ) : null
                        ) : (
                          <>
                            {ownedActorIds.includes(comment.authorId) && (
                              <button type="button" disabled={effectiveReadOnly} onClick={() => beginCommentEdit(comment)}>
                                <PencilLine size={13} /> Edit
                              </button>
                            )}
                            <button type="button" disabled={effectiveReadOnly} onClick={() => collaboration.toggleComment(comment)}>
                              <Check size={13} /> {comment.resolved ? 'Reopen' : 'Resolve'}
                            </button>
                          </>
                        )}
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
                      </div>}
                    </article>
                  )})}
                  {visibleReviewComments.length < filteredReviewComments.length && (
                    <button
                      className="review-show-older"
                      type="button"
                      onClick={() => setReviewVisibleLimit((limit) => limit + reviewBatchSize)}
                    >
                      Show older
                    </button>
                  )}
                </div>
              </aside>
            )}
          </div>
        </section>
      </main>

      {citationPickerOpen && (
        <CitationPicker
          allowNewReferences={canAddCitationReferences}
          bibliography={collaboration.bibliography}
          key={canAddCitationReferences ? 'full' : 'library-only'}
          roomName={roomName}
          onClose={closeCitationPicker}
          onInsert={insertCitation}
        />
      )}

      {referenceManagerOpen && (
        <ReferenceManager
          bibliography={collaboration.bibliography}
          manuscript={projectManuscriptContent}
          readOnly={isStructuredEditorReadOnly}
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
            readOnly={isStructuredEditorReadOnly}
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