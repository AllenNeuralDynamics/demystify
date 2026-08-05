import { useEffect, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import type { CollaboratorProfile } from '../lib/profile'
import {
  normalizeSourceText,
  serializeSourceText,
  type SourceLineEnding,
} from '../lib/sourceText'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface Collaborator extends CollaboratorProfile {
  clientId: number
}

export interface SharedComment {
  id: string
  authorId: string
  authorName: string
  authorColor: string
  body: string
  createdAt: string
  resolved: boolean
}

interface CollaborationSession {
  document: Y.Doc
  provider: WebsocketProvider
  text: Y.Text
  comments: Y.Map<SharedComment>
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
) => {
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const [content, setContent] = useState('')
  const [comments, setComments] = useState<SharedComment[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [isSynced, setIsSynced] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const document = new Y.Doc()
    const provider = new WebsocketProvider(getWebSocketUrl(), roomName, document, {
      connect: false,
    })
    const text = document.getText('content')
    const commentMap = document.getMap<SharedComment>('comments')
    const metadata = document.getMap<string | number | boolean>('metadata')
    const nextSession = { document, provider, text, comments: commentMap, metadata }
    let initializationTimer: number | undefined

    const updateContent = () => setContent(text.toString())
    const updateComments = () => {
      setComments(
        Array.from(commentMap.values()).sort((first, second) =>
          second.createdAt.localeCompare(first.createdAt),
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
    commentMap.observe(updateComments)
    const connectionTimer = window.setTimeout(() => provider.connect(), 0)

    return () => {
      window.clearTimeout(connectionTimer)
      window.clearTimeout(initializationTimer)
      text.unobserve(updateContent)
      commentMap.unobserve(updateComments)
      provider.off('status', updateStatus)
      provider.awareness.off('change', updateCollaborators)
      provider.off('sync', initializeEmptyDocument)
      provider.destroy()
      document.destroy()
      setSession(null)
      setIsSynced(false)
    }
  }, [enabled, initialContent, roomName])

  useEffect(() => {
    session?.provider.awareness.setLocalStateField('user', profile)
  }, [profile, session])

  const addComment = (body: string) => {
    const trimmedBody = body.trim()
    if (!session || !trimmedBody) return

    const id = crypto.randomUUID()
    session.comments.set(id, {
      id,
      authorId: profile.id,
      authorName: profile.name,
      authorColor: profile.color,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
      resolved: false,
    })
  }

  const toggleComment = (comment: SharedComment) => {
    session?.comments.set(comment.id, { ...comment, resolved: !comment.resolved })
  }

  const replaceContent = (nextContent: string) => {
    if (!session) return
    const normalized = normalizeSourceText(nextContent)
    session.document.transact(() => {
      session.text.delete(0, session.text.length)
      session.text.insert(0, normalized.content)
      session.metadata.set('lineEnding', normalized.lineEnding)
      session.metadata.set('initialized', true)
    })
  }

  const getSnapshotContent = () => {
    if (!session) return content
    return serializeSourceText(
      session.text.toString(),
      getSourceLineEnding(session.metadata),
    )
  }

  return {
    sharedText: session?.text ?? null,
    provider: session?.provider ?? null,
    content,
    comments,
    collaborators,
    status: enabled ? status : 'disconnected',
    isSynced,
    addComment,
    toggleComment,
    replaceContent,
    getSnapshotContent,
  }
}