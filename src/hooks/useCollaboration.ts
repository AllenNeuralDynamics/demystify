import { useCallback, useEffect, useRef, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import type {
  PullRequestCommentMirror,
  PullRequestCommentSync,
} from '../lib/github'
import {
  createCommentAnchor,
  resolveCommentAnchor,
  type CommentAnchor,
} from '../lib/commentAnchors'
import type { CollaboratorProfile } from '../lib/profile'
import {
  normalizeSourceText,
  serializeSourceText,
  type SourceLineEnding,
} from '../lib/sourceText'
import {
  applyCollaborativeTextEdit,
  createCollaborativeTextEditAnchor,
  resolveCollaborativeTextEditAnchor,
  type CollaborativeTextEditAnchor,
  type CollaborativeTextEditResult,
} from '../lib/collaborativeTextEdit'
import {
  addReference,
  canonicalReferenceId,
  createGeneratedReference,
  materializeBibliography,
  type GeneratedReferenceEntry,
  type BibliographyEditResult,
  type PaperSearchResult,
} from '../lib/references'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface Collaborator extends CollaboratorProfile {
  clientId: number
}

export type SharedSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'conflicted'

export interface SharedSuggestion {
  kind: 'insert' | 'delete' | 'replace'
  filePath: string
  before: string
  after: string
  supersedes?: string[]
  status: SharedSuggestionStatus
  decidedAt?: string
  decidedById?: string
  decidedByName?: string
}

export interface SharedComment {
  id: string
  authorId: string
  authorName: string
  authorColor: string
  body: string
  createdAt: string
  resolved: boolean
  anchor?: CommentAnchor
  suggestion?: SharedSuggestion
  github?: PullRequestCommentMirror & {
    resolved: boolean
    suggestionStatus?: SharedSuggestionStatus
  }
}

export interface SharedCommentMessage {
  id: string
  threadId: string
  authorId: string
  authorName: string
  authorColor: string
  body: string
  createdAt: string
  github?: PullRequestCommentMirror
}

interface CollaborationSession {
  document: Y.Doc
  provider: WebsocketProvider
  text: Y.Text
  bibliography: Y.Text
  mystConfig: Y.Text
  projectFiles: Y.Map<Y.Text>
  generatedReferences: Y.Map<GeneratedReferenceEntry>
  comments: Y.Map<SharedComment>
  commentMessages: Y.Map<SharedCommentMessage>
  metadata: Y.Map<string | number | boolean>
}

const getWebSocketUrl = () => {
  if (import.meta.env.VITE_COLLABORATION_URL) {
    return import.meta.env.VITE_COLLABORATION_URL
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/collaboration`
}

const isCollaboratorProfile = (value: unknown): value is CollaboratorProfile => {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<CollaboratorProfile>
  return Boolean(profile.id && profile.name && profile.color && profile.colorLight)
}

const getSourceLineEnding = (
  metadata: Y.Map<string | number | boolean>,
): SourceLineEnding => {
  const lineEnding = metadata.get('lineEnding')
  return lineEnding === 'crlf' || lineEnding === 'cr' ? lineEnding : 'lf'
}

export const useCollaboration = (
  roomName: string,
  profile: CollaboratorProfile,
  initialContent: string,
  enabled = true,
  readOnly = false,
  shouldConnect = true,
) => {
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const [content, setContent] = useState('')
  const [bibliography, setBibliography] = useState('')
  const [bibliographyPath, setBibliographyPath] = useState('references.bib')
  const [mystConfig, setMystConfig] = useState('')
  const [mystConfigPath, setMystConfigPath] = useState('myst.yml')
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>({})
  const [projectManifestVersion, setProjectManifestVersion] = useState(0)
  const [isBibliographyInitialized, setIsBibliographyInitialized] = useState(false)
  const [isMystConfigInitialized, setIsMystConfigInitialized] = useState(false)
  const [areProjectFilesInitialized, setAreProjectFilesInitialized] = useState(false)
  const [comments, setComments] = useState<SharedComment[]>([])
  const [commentMessages, setCommentMessages] = useState<SharedCommentMessage[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [isSynced, setIsSynced] = useState(false)
  const providerRef = useRef<WebsocketProvider | null>(null)

  useEffect(() => {
    if (!enabled) return
    const document = new Y.Doc()
    const provider = new WebsocketProvider(getWebSocketUrl(), roomName, document, {
      connect: false,
    })
    providerRef.current = provider
    const text = document.getText('content')
    const bibliographyText = document.getText('bibliography')
    const mystConfigText = document.getText('mystConfig')
    const projectFileMap = document.getMap<Y.Text>('projectFiles')
    const generatedReferences = document.getMap<GeneratedReferenceEntry>('references')
    const commentMap = document.getMap<SharedComment>('comments')
    const commentMessageMap = document.getMap<SharedCommentMessage>('commentMessages')
    const metadata = document.getMap<string | number | boolean>('metadata')
    const nextSession = {
      document,
      provider,
      text,
      bibliography: bibliographyText,
      mystConfig: mystConfigText,
      projectFiles: projectFileMap,
      generatedReferences,
      comments: commentMap,
      commentMessages: commentMessageMap,
      metadata,
    }
    let initializationTimer: number | undefined

    const updateContent = () => setContent(text.toString())
    const updateBibliography = () => setBibliography(materializeBibliography(
      bibliographyText.toString(),
      generatedReferences.values(),
    ))
    const updateMystConfig = () => setMystConfig(mystConfigText.toString())
    const updateProjectFiles = () => setProjectFiles(Object.fromEntries(
      Array.from(projectFileMap.entries(), ([path, fileText]) => [path, fileText.toString()]),
    ))
    const updateMetadata = () => {
      setIsBibliographyInitialized(metadata.get('bibliographyInitialized') === true)
      const bibliographySourcePath = metadata.get('bibliographyPath')
      setBibliographyPath(
        typeof bibliographySourcePath === 'string' && bibliographySourcePath
          ? bibliographySourcePath
          : 'references.bib',
      )
      setIsMystConfigInitialized(metadata.get('mystConfigInitialized') === true)
      setAreProjectFilesInitialized(metadata.get('projectFilesInitialized') === true)
      const manifestVersion = metadata.get('projectManifestVersion')
      setProjectManifestVersion(
        typeof manifestVersion === 'number' && Number.isSafeInteger(manifestVersion)
          ? manifestVersion
          : 0,
      )
      const path = metadata.get('mystConfigPath')
      setMystConfigPath(typeof path === 'string' && path ? path : 'myst.yml')
    }
    const updateComments = () => {
      setComments(
        Array.from(commentMap.values()).sort((first, second) =>
          second.createdAt.localeCompare(first.createdAt),
        ),
      )
    }
    const updateCommentMessages = () => {
      setCommentMessages(
        Array.from(commentMessageMap.values()).sort((first, second) =>
          first.createdAt.localeCompare(second.createdAt),
        ),
      )
    }
    const updateCollaborators = () => {
      const nextCollaborators = Array.from(provider.awareness.getStates()).flatMap(
        ([clientId, awareness]) => {
          const user = awareness.user
          return isCollaboratorProfile(user) ? [{ ...user, clientId }] : []
        },
      )
      setCollaborators(nextCollaborators)
    }
    const initializeEmptyDocument = () => {
      setIsSynced(true)
      if (readOnly) return
      if (text.length > 0 || metadata.get('initialized')) return

      const candidate = document.clientID
      metadata.set('initializationCandidate', candidate)
      initializationTimer = window.setTimeout(() => {
        if (
          text.length === 0 &&
          !metadata.get('initialized') &&
          metadata.get('initializationCandidate') === candidate
        ) {
          const normalized = normalizeSourceText(initialContent)
          document.transact(() => {
            text.insert(0, normalized.content)
            metadata.set('lineEnding', normalized.lineEnding)
            metadata.set('initialized', true)
          })
        }
      }, 250)
    }

    const updateStatus = ({ status: nextStatus }: { status: ConnectionStatus }) => {
      setStatus(nextStatus)
      setSession((currentSession) => currentSession ?? nextSession)
    }
    provider.on('status', updateStatus)
    provider.on('sync', initializeEmptyDocument)
    provider.awareness.on('change', updateCollaborators)
    text.observe(updateContent)
    bibliographyText.observe(updateBibliography)
    mystConfigText.observe(updateMystConfig)
    projectFileMap.observeDeep(updateProjectFiles)
    generatedReferences.observe(updateBibliography)
    metadata.observe(updateMetadata)
    commentMap.observe(updateComments)
    commentMessageMap.observe(updateCommentMessages)

    return () => {
      window.clearTimeout(initializationTimer)
      text.unobserve(updateContent)
      bibliographyText.unobserve(updateBibliography)
      mystConfigText.unobserve(updateMystConfig)
      projectFileMap.unobserveDeep(updateProjectFiles)
      generatedReferences.unobserve(updateBibliography)
      metadata.unobserve(updateMetadata)
      commentMap.unobserve(updateComments)
      commentMessageMap.unobserve(updateCommentMessages)
      provider.off('status', updateStatus)
      provider.awareness.off('change', updateCollaborators)
      provider.off('sync', initializeEmptyDocument)
      provider.destroy()
      if (providerRef.current === provider) providerRef.current = null
      document.destroy()
      setSession(null)
      setIsSynced(false)
      setBibliography('')
      setBibliographyPath('references.bib')
      setMystConfig('')
      setMystConfigPath('myst.yml')
      setProjectFiles({})
      setProjectManifestVersion(0)
      setIsBibliographyInitialized(false)
      setIsMystConfigInitialized(false)
      setAreProjectFilesInitialized(false)
    }
  }, [enabled, initialContent, readOnly, roomName])

  useEffect(() => {
    const provider = providerRef.current
    if (!provider) return
    if (shouldConnect) provider.connect()
    else provider.disconnect()
  }, [enabled, initialContent, readOnly, roomName, shouldConnect])

  useEffect(() => {
    session?.provider.awareness.setLocalStateField('user', profile)
  }, [profile, session])

  const addComment = (body: string, selection?: { from: number; to: number }) => {
    const trimmedBody = body.trim()
    if (!session || readOnly || !trimmedBody) return

    const id = crypto.randomUUID()
    const anchor = selection
      ? createCommentAnchor(session.text, selection.from, selection.to)
      : undefined
    session.comments.set(id, {
      id,
      authorId: profile.id,
      authorName: profile.name,
      authorColor: profile.color,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
      resolved: false,
      ...(anchor ? { anchor } : {}),
    })
    return id
  }

  const addCommentReply = (threadId: string, body: string) => {
    const trimmedBody = body.trim()
    if (!session || readOnly || !trimmedBody || !session.comments.has(threadId)) return
    const id = crypto.randomUUID()
    session.commentMessages.set(id, {
      id,
      threadId,
      authorId: profile.id,
      authorName: profile.name,
      authorColor: profile.color,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
    })
    return id
  }

  const toggleComment = (comment: SharedComment) => {
    if (readOnly || comment.suggestion) return
    session?.comments.set(comment.id, { ...comment, resolved: !comment.resolved })
  }

  const applyCommentMirror = useCallback((
    commentId: string,
    mirror: PullRequestCommentMirror,
    resolved: boolean,
    suggestionStatus?: SharedSuggestionStatus,
  ) => {
    const comment = session?.comments.get(commentId)
    if (!session || readOnly || !comment) return
    session.comments.set(commentId, {
      ...comment,
      github: { ...mirror, resolved, ...(suggestionStatus ? { suggestionStatus } : {}) },
    })
  }, [readOnly, session])

  const applyCommentMessageMirror = useCallback((
    messageId: string,
    mirror: PullRequestCommentMirror,
  ) => {
    const message = session?.commentMessages.get(messageId)
    if (!session || readOnly || !message) return
    session.commentMessages.set(messageId, { ...message, github: mirror })
  }, [readOnly, session])

  const resolveAnchor = useCallback((comment: SharedComment) => {
    if (!session || !comment.anchor) return null
    return resolveCommentAnchor(
      session.document,
      session.text,
      comment.anchor,
      {
        allowEmpty: comment.suggestion?.kind === 'insert',
        recoverQuote: !comment.suggestion,
      },
    )
  }, [session])

  const applyGitHubCommentSync = useCallback((sync: PullRequestCommentSync) => {
    if (!session || readOnly) return
    session.document.transact(() => {
      for (const message of sync.messages) {
        const current = session.commentMessages.get(message.id)
        session.commentMessages.set(message.id, current
          ? { ...current, body: message.body, github: message.github }
          : message)
      }
      for (const resolution of sync.resolutions) {
        const comment = session.comments.get(resolution.threadId)
        if (!comment) continue
        if (comment.suggestion) continue
        if (comment.github && comment.github.resolved !== comment.resolved) continue
        session.comments.set(resolution.threadId, {
          ...comment,
          resolved: resolution.resolved,
          ...(comment.github
            ? { github: { ...comment.github, resolved: resolution.resolved } }
            : {}),
        })
      }
    })
  }, [readOnly, session])

  const replaceContent = (nextContent: string) => {
    if (!session || readOnly) return
    const normalized = normalizeSourceText(nextContent)
    session.document.transact(() => {
      session.text.delete(0, session.text.length)
      session.text.insert(0, normalized.content)
      session.metadata.set('lineEnding', normalized.lineEnding)
      session.metadata.set('initialized', true)
    })
  }

  const initializeBibliography = useCallback((source: string, path = 'references.bib') => {
    if (!session || readOnly || session.metadata.get('bibliographyInitialized')) return false
    session.document.transact(() => {
      session.bibliography.delete(0, session.bibliography.length)
      if (source) session.bibliography.insert(0, source.replace(/\r\n?/g, '\n'))
      session.metadata.set('bibliographyPath', path)
      session.metadata.set('bibliographyInitialized', true)
    })
    return true
  }, [readOnly, session])

  const replaceBibliography = useCallback((source: string, path = 'references.bib') => {
    if (!session || readOnly) return
    session.document.transact(() => {
      session.bibliography.delete(0, session.bibliography.length)
      if (source) session.bibliography.insert(0, source.replace(/\r\n?/g, '\n'))
      session.metadata.set('bibliographyPath', path)
      session.generatedReferences.clear()
      session.metadata.set('bibliographyInitialized', true)
    })
  }, [readOnly, session])

  const initializeMystConfig = useCallback((source: string, path: string) => {
    if (!session || readOnly || session.metadata.get('mystConfigInitialized')) return false
    session.document.transact(() => {
      session.mystConfig.delete(0, session.mystConfig.length)
      if (source) session.mystConfig.insert(0, source.replace(/\r\n?/g, '\n'))
      session.metadata.set('mystConfigPath', path)
      session.metadata.set('mystConfigInitialized', true)
    })
    return true
  }, [readOnly, session])

  const replaceMystConfig = useCallback((source: string, path: string) => {
    if (!session || readOnly) return
    session.document.transact(() => {
      session.mystConfig.delete(0, session.mystConfig.length)
      if (source) session.mystConfig.insert(0, source.replace(/\r\n?/g, '\n'))
      session.metadata.set('mystConfigPath', path)
      session.metadata.set('mystConfigInitialized', true)
    })
  }, [readOnly, session])

  const setProjectFileMap = useCallback((
    files: Array<{ path: string; content: string }>,
    primaryPath: string,
    replace: boolean,
    manifestVersion: number,
  ) => {
    if (!session || readOnly) return false
    session.document.transact(() => {
      if (replace) session.projectFiles.clear()
      files.forEach((file) => {
        if (file.path === primaryPath || session.projectFiles.has(file.path)) return
        const fileText = new Y.Text()
        session.projectFiles.set(file.path, fileText)
        const normalized = normalizeSourceText(file.content)
        if (normalized.content) fileText.insert(0, normalized.content)
      })
      session.metadata.set('projectFilesInitialized', true)
      session.metadata.set('projectManifestVersion', manifestVersion)
    })
    return true
  }, [readOnly, session])

  const initializeProjectFiles = useCallback((
    files: Array<{ path: string; content: string }>,
    primaryPath: string,
    manifestVersion: number,
  ) => {
    if (!session || readOnly) return false
    const currentVersion = session.metadata.get('projectManifestVersion')
    if (
      session.metadata.get('projectFilesInitialized') === true &&
      typeof currentVersion === 'number' &&
      currentVersion >= manifestVersion
    ) return false
    return setProjectFileMap(files, primaryPath, false, manifestVersion)
  }, [readOnly, session, setProjectFileMap])

  const replaceProjectFiles = useCallback((
    files: Array<{ path: string; content: string }>,
    primaryPath: string,
    manifestVersion: number,
  ) => setProjectFileMap(
    files,
    primaryPath,
    true,
    manifestVersion,
  ), [setProjectFileMap])

  const getSharedText = useCallback((path: string, primaryPath: string) => {
    if (!session) return null
    return path === primaryPath ? session.text : session.projectFiles.get(path) ?? null
  }, [session])

  const commitPublicationMetadata = useCallback((input: {
    pagePath: string
    primaryPath: string
    expectedPage: string
    expectedProject: string
    replacementPage: string
    replacementProject: string
  }): BibliographyEditResult => {
    if (!session || readOnly) return 'unavailable'
    const pageText = input.pagePath === input.primaryPath
      ? session.text
      : session.projectFiles.get(input.pagePath)
    if (!pageText) return 'unavailable'
    if (
      pageText.toString() !== input.expectedPage ||
      session.mystConfig.toString() !== input.expectedProject
    ) return 'conflict'
    const normalizedPage = normalizeSourceText(input.replacementPage)
    session.document.transact(() => {
      pageText.delete(0, pageText.length)
      pageText.insert(0, normalizedPage.content)
      if (input.pagePath === input.primaryPath) {
        session.metadata.set('lineEnding', normalizedPage.lineEnding)
        session.metadata.set('initialized', true)
      }
      session.mystConfig.delete(0, session.mystConfig.length)
      if (input.replacementProject) {
        session.mystConfig.insert(0, input.replacementProject.replace(/\r\n?/g, '\n'))
      }
      session.metadata.set('mystConfigInitialized', true)
    })
    return 'applied'
  }, [readOnly, session])

  const addBibliographyReference = useCallback((paper: PaperSearchResult) => {
    if (!session || readOnly) return null
    const id = canonicalReferenceId(paper)
    const existingGenerated = session.generatedReferences.get(id)
    if (existingGenerated) {
      return { key: existingGenerated.key, added: false }
    }

    const current = materializeBibliography(
      session.bibliography.toString(),
      session.generatedReferences.values(),
    )
    const existing = addReference(current, paper)
    if (!existing.added) return { key: existing.key, added: false }
    const generated = createGeneratedReference(current, paper)
    if (!generated) return { key: existing.key, added: false }
    session.document.transact(() => {
      session.generatedReferences.set(id, generated)
      session.metadata.set('bibliographyInitialized', true)
    })
    return { key: generated.key, added: true }
  }, [readOnly, session])

  const commitBibliographyEdit = useCallback((
    expected: string,
    replacement: string,
  ): BibliographyEditResult => {
    if (!session || readOnly) return 'unavailable'
    const current = materializeBibliography(
      session.bibliography.toString(),
      session.generatedReferences.values(),
    )
    if (current !== expected) return 'conflict'
    session.document.transact(() => {
      session.bibliography.delete(0, session.bibliography.length)
      if (replacement) session.bibliography.insert(0, replacement.replace(/\r\n?/g, '\n'))
      session.generatedReferences.clear()
      session.metadata.set('bibliographyInitialized', true)
    })
    return 'applied'
  }, [readOnly, session])

  const beginTextEdit = useCallback((
    from: number,
    to: number,
    expectedText: string,
    path?: string,
    primaryPath?: string,
  ): CollaborativeTextEditAnchor | null => {
    if (!session || readOnly) return null
    const text = path && primaryPath && path !== primaryPath
      ? session.projectFiles.get(path)
      : session.text
    return text
      ? createCollaborativeTextEditAnchor(text, from, to, expectedText)
      : null
  }, [readOnly, session])

  const commitTextEdit = useCallback((
    anchor: CollaborativeTextEditAnchor,
    replacement: string,
    path?: string,
    primaryPath?: string,
  ): CollaborativeTextEditResult => {
    if (!session || readOnly) return 'unavailable'
    const text = path && primaryPath && path !== primaryPath
      ? session.projectFiles.get(path)
      : session.text
    if (!text) return 'unavailable'
    return applyCollaborativeTextEdit(
      session.document,
      text,
      anchor,
      replacement.replace(/\r\n?/g, '\n'),
    )
  }, [readOnly, session])

  const createTextSuggestion = useCallback((
    anchor: CollaborativeTextEditAnchor,
    replacement: string,
    path: string,
    primaryPath: string,
    supersedes: string[] = [],
  ): { result: CollaborativeTextEditResult; suggestionId?: string } => {
    if (!session || readOnly) return { result: 'unavailable' }
    const text = path === primaryPath ? session.text : session.projectFiles.get(path)
    if (!text) return { result: 'unavailable' }
    const normalizedReplacement = replacement.replace(/\r\n?/g, '\n')
    if (normalizedReplacement === anchor.expectedText) return { result: 'applied' }
    const resolution = resolveCollaborativeTextEditAnchor(session.document, text, anchor)
    if (typeof resolution === 'string') return { result: resolution }

    const id = crypto.randomUUID()
    session.comments.set(id, {
      id,
      authorId: profile.id,
      authorName: profile.name,
      authorColor: profile.color,
      body: 'Suggested edit',
      createdAt: new Date().toISOString(),
      resolved: false,
      anchor: createCommentAnchor(text, resolution.from, resolution.to),
      suggestion: {
        kind: normalizedReplacement
          ? anchor.expectedText
            ? 'replace'
            : 'insert'
          : 'delete',
        filePath: path,
        before: anchor.expectedText,
        after: normalizedReplacement,
        ...(supersedes.length > 0 ? { supersedes: Array.from(new Set(supersedes)) } : {}),
        status: 'pending',
      },
    })
    return { result: 'applied', suggestionId: id }
  }, [profile, readOnly, session])

  const decideTextSuggestion = useCallback((
    suggestionId: string,
    decision: 'accept' | 'reject',
    primaryPath: string,
  ): CollaborativeTextEditResult => {
    if (!session || readOnly) return 'unavailable'
    const comment = session.comments.get(suggestionId)
    const suggestion = comment?.suggestion
    if (!comment || !comment.anchor || !suggestion) return 'unavailable'
    if (suggestion.status === 'accepted' || suggestion.status === 'rejected') {
      return 'unavailable'
    }

    const decisionDetails = {
      decidedAt: new Date().toISOString(),
      decidedById: profile.id,
      decidedByName: profile.name,
    }
    if (decision === 'reject') {
      session.comments.set(comment.id, {
        ...comment,
        resolved: true,
        suggestion: { ...suggestion, ...decisionDetails, status: 'rejected' },
      })
      return 'applied'
    }

    const text = suggestion.filePath === primaryPath
      ? session.text
      : session.projectFiles.get(suggestion.filePath)
    if (!text) return 'unavailable'
    const location = resolveCommentAnchor(
      session.document,
      text,
      comment.anchor,
      {
        allowEmpty: suggestion.kind === 'insert',
        recoverQuote: false,
      },
    )
    if (
      !location ||
      location.orphaned ||
      location.quote !== suggestion.before
    ) {
      session.comments.set(comment.id, {
        ...comment,
        resolved: false,
        suggestion: { ...suggestion, status: 'conflicted' },
      })
      return 'conflict'
    }

    const anchor = createCollaborativeTextEditAnchor(
      text,
      location.from,
      location.to,
      suggestion.before,
    )
    if (!anchor) return 'conflict'
    const result = applyCollaborativeTextEdit(
      session.document,
      text,
      anchor,
      suggestion.after,
    )
    session.document.transact(() => {
      session.comments.set(comment.id, {
        ...comment,
        resolved: result === 'applied',
        suggestion: {
          ...suggestion,
          ...(result === 'applied' ? decisionDetails : {}),
          status: result === 'applied' ? 'accepted' : 'conflicted',
        },
      })
      if (result !== 'applied') return
      for (const [otherId, otherComment] of session.comments.entries()) {
        const otherSuggestion = otherComment.suggestion
        if (
          otherId === comment.id ||
          !otherComment.anchor ||
          otherSuggestion?.status !== 'pending' ||
          otherSuggestion.filePath !== suggestion.filePath
        ) continue
        const otherLocation = resolveCommentAnchor(
          session.document,
          text,
          otherComment.anchor,
          {
            allowEmpty: otherSuggestion.kind === 'insert',
            recoverQuote: false,
          },
        )
        if (
          otherLocation &&
          !otherLocation.orphaned &&
          otherLocation.quote === otherSuggestion.before
        ) continue
        session.comments.set(otherId, {
          ...otherComment,
          resolved: false,
          suggestion: { ...otherSuggestion, status: 'conflicted' },
        })
      }
    })
    return result
  }, [profile, readOnly, session])

  const getSnapshotContent = () => {
    if (!session) return content
    return serializeSourceText(
      session.text.toString(),
      getSourceLineEnding(session.metadata),
    )
  }

  const getSnapshotBibliography = () => {
    if (!session) return bibliography
    return materializeBibliography(
      session.bibliography.toString(),
      session.generatedReferences.values(),
    )
  }

  const getSnapshotProjectFiles = () => {
    if (!session) {
      return Object.entries(projectFiles).map(([path, fileContent]) => ({
        path,
        content: fileContent,
      }))
    }
    return Array.from(session.projectFiles.entries(), ([path, fileText]) => ({
      path,
      content: fileText.toString(),
    }))
  }

  return {
    sharedText: session?.text ?? null,
    sharedBibliography: session?.bibliography ?? null,
    provider: session?.provider ?? null,
    content,
    bibliography,
    bibliographyPath,
    mystConfig,
    mystConfigPath,
    projectFiles,
    projectManifestVersion,
    comments,
    commentMessages,
    collaborators,
    status: enabled ? status : 'disconnected',
    isSynced,
    isBibliographyInitialized,
    isMystConfigInitialized,
    areProjectFilesInitialized,
    addComment,
    addCommentReply,
    toggleComment,
    applyCommentMirror,
    applyCommentMessageMirror,
    applyGitHubCommentSync,
    resolveAnchor,
    beginTextEdit,
    commitTextEdit,
    createTextSuggestion,
    decideTextSuggestion,
    replaceContent,
    initializeBibliography,
    replaceBibliography,
    initializeMystConfig,
    replaceMystConfig,
    initializeProjectFiles,
    replaceProjectFiles,
    getSharedText,
    commitPublicationMetadata,
    addBibliographyReference,
    commitBibliographyEdit,
    getSnapshotContent,
    getSnapshotBibliography,
    getSnapshotProjectFiles,
  }
}