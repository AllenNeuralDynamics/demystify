import * as decoding from 'lib0/decoding'
import { createRequire } from 'node:module'
import type { RawData, WebSocket } from 'ws'
import type * as Yjs from 'yjs'

const require = createRequire(import.meta.url)
const Y = require('yjs') as typeof Yjs

const messageSync = 0
const messageAwareness = 1
const syncStep1 = 0
const syncStep2 = 1
const syncUpdate = 2
const commentIdPattern = /^[A-Za-z0-9_-]{1,100}$/
const allowedRootTypes = new Set([
  'content',
  'bibliography',
  'mystConfig',
  'projectFiles',
  'references',
  'comments',
  'commentMessages',
  'metadata',
])

const toUint8Array = (data: RawData) => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  const buffer = Array.isArray(data) ? Buffer.concat(data) : data
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export const isReadOnlyWebSocketMessageAllowed = (data: RawData) => {
  try {
    const decoder = decoding.createDecoder(toUint8Array(data))
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageAwareness) return true
    return messageType === messageSync && decoding.readVarUint(decoder) === syncStep1
  } catch {
    return false
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stableEntries = (map: Yjs.Map<unknown>) =>
  Array.from(map.entries()).sort(([first], [second]) => first.localeCompare(second))

const getProtectedState = (document: Yjs.Doc) => JSON.stringify({
  content: document.getText('content').toString(),
  bibliography: document.getText('bibliography').toString(),
  mystConfig: document.getText('mystConfig').toString(),
  projectFiles: Array.from(document.getMap<Yjs.Text>('projectFiles').entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([path, text]) => [path, text.toString()]),
  references: stableEntries(document.getMap('references')),
  metadata: stableEntries(document.getMap('metadata')),
})

const hasOnlyKnownRoots = (document: Yjs.Doc) =>
  Array.from(document.share.keys()).every((name) => allowedRootTypes.has(name))

const hasText = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum

const hasOptionalText = (value: unknown, maximum: number) =>
  value === undefined || (typeof value === 'string' && value.length <= maximum)

const hasValidIdentity = (value: Record<string, unknown>) =>
  hasText(value.authorId, 200) &&
  hasText(value.authorName, 200) &&
  hasText(value.authorColor, 100) &&
  hasText(value.createdAt, 100) &&
  !Number.isNaN(Date.parse(value.createdAt as string))

const resolveAnchorQuote = (
  document: Yjs.Doc,
  anchorValue: unknown,
) => {
  if (!isRecord(anchorValue)) return null
  if (
    anchorValue.version !== 1 ||
    !hasText(anchorValue.start, 20_000) ||
    !hasText(anchorValue.end, 20_000) ||
    typeof anchorValue.quote !== 'string' ||
    anchorValue.quote.length > 60_000
  ) return null
  try {
    const text = document.getText('content')
    const start = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(Buffer.from(anchorValue.start as string, 'base64')),
      document,
    )
    const end = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(Buffer.from(anchorValue.end as string, 'base64')),
      document,
    )
    if (!start || !end || start.type !== text || end.type !== text) return null
    const from = Math.min(start.index, end.index)
    const to = Math.max(start.index, end.index)
    const quote = text.toString().slice(from, to)
    return quote === anchorValue.quote ? { from, to, quote } : null
  } catch {
    return null
  }
}

const isValidNewSuggestion = (
  value: Record<string, unknown>,
  anchorResult: { from: number; to: number; quote: string } | null,
  existingComments: Yjs.Map<unknown>,
  document: Yjs.Doc,
) => {
  const suggestion = value.suggestion
  if (!isRecord(suggestion) || !anchorResult) return false
  if (
    suggestion.status !== 'pending' ||
    suggestion.decidedAt !== undefined ||
    suggestion.decidedById !== undefined ||
    suggestion.decidedByName !== undefined ||
    !hasText(suggestion.filePath, 1_000) ||
    !hasOptionalText(suggestion.before, 60_000) ||
    !hasOptionalText(suggestion.after, 60_000)
  ) return false
  const before = suggestion.before as string
  const after = suggestion.after as string
  if (before !== anchorResult.quote || before === after) return false
  const supersedes = suggestion.supersedes
  if (supersedes !== undefined) {
    if (
      !Array.isArray(supersedes) ||
      supersedes.length === 0 ||
      supersedes.length > 100 ||
      new Set(supersedes).size !== supersedes.length
    ) return false
    for (const supersededId of supersedes) {
      if (typeof supersededId !== 'string' || !commentIdPattern.test(supersededId)) return false
      const superseded = existingComments.get(supersededId)
      if (!isRecord(superseded) || !isRecord(superseded.suggestion)) return false
      const supersededAnchor = resolveAnchorQuote(document, superseded.anchor)
      if (
        !supersededAnchor ||
        superseded.suggestion.status !== 'pending' ||
        superseded.suggestion.filePath !== suggestion.filePath ||
        supersededAnchor.from < anchorResult.from ||
        supersededAnchor.to > anchorResult.to
      ) return false
    }
  }
  return (
    (suggestion.kind === 'insert' && !before && Boolean(after)) ||
    (suggestion.kind === 'replace' && Boolean(before) && Boolean(after)) ||
    (suggestion.kind === 'delete' && Boolean(before) && !after)
  )
}

const isValidNewComment = (
  document: Yjs.Doc,
  id: string,
  value: unknown,
  existingComments: Yjs.Map<unknown>,
) => {
  if (!commentIdPattern.test(id) || !isRecord(value)) return false
  if (
    value.id !== id ||
    !hasValidIdentity(value) ||
    !hasText(value.body, 60_000) ||
    value.resolved !== false ||
    value.github !== undefined
  ) return false
  const anchorResult = value.anchor === undefined
    ? null
    : resolveAnchorQuote(document, value.anchor)
  if (value.anchor !== undefined && !anchorResult) return false
  return value.suggestion === undefined ||
    isValidNewSuggestion(value, anchorResult, existingComments, document)
}

const withoutResolved = (value: Record<string, unknown>) => {
  const result = { ...value }
  delete result.resolved
  return result
}

const commentsAreAllowed = (current: Yjs.Doc, candidate: Yjs.Doc) => {
  const before = current.getMap<unknown>('comments')
  const after = candidate.getMap<unknown>('comments')
  for (const [id, value] of before.entries()) {
    const next = after.get(id)
    if (!isRecord(value) || !isRecord(next)) return false
    if (value.suggestion !== undefined) {
      if (JSON.stringify(next) !== JSON.stringify(value)) return false
      continue
    }
    if (
      typeof next.resolved !== 'boolean' ||
      JSON.stringify(withoutResolved(next)) !== JSON.stringify(withoutResolved(value))
    ) return false
  }
  for (const [id, value] of after.entries()) {
    if (!before.has(id) && !isValidNewComment(candidate, id, value, before)) return false
  }
  return after.size >= before.size
}

const isValidNewMessage = (
  comments: Yjs.Map<unknown>,
  id: string,
  value: unknown,
) => isRecord(value) &&
  commentIdPattern.test(id) &&
  value.id === id &&
  hasText(value.threadId, 100) &&
  comments.has(value.threadId as string) &&
  hasValidIdentity(value) &&
  hasText(value.body, 60_000) &&
  value.github === undefined

const messagesAreAllowed = (current: Yjs.Doc, candidate: Yjs.Doc) => {
  const before = current.getMap<unknown>('commentMessages')
  const after = candidate.getMap<unknown>('commentMessages')
  for (const [id, value] of before.entries()) {
    if (!after.has(id) || JSON.stringify(after.get(id)) !== JSON.stringify(value)) return false
  }
  const comments = candidate.getMap<unknown>('comments')
  for (const [id, value] of after.entries()) {
    if (!before.has(id) && !isValidNewMessage(comments, id, value)) return false
  }
  return after.size >= before.size
}

const isCollaboratorUpdateAllowed = (document: Yjs.Doc, update: Uint8Array) => {
  try {
    const protectedState = getProtectedState(document)
    const candidate = new Y.Doc()
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
      Y.applyUpdate(candidate, update)
      return hasOnlyKnownRoots(candidate) &&
        getProtectedState(candidate) === protectedState &&
        commentsAreAllowed(document, candidate) &&
        messagesAreAllowed(document, candidate)
    } finally {
      candidate.destroy()
    }
  } catch {
    return false
  }
}

export const isCollaboratorWebSocketMessageAllowed = (
  data: RawData,
  document: Yjs.Doc,
) => {
  try {
    const decoder = decoding.createDecoder(toUint8Array(data))
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageAwareness) return true
    if (messageType !== messageSync) return false
    const subtype = decoding.readVarUint(decoder)
    if (subtype === syncStep1) return true
    if (subtype !== syncStep2 && subtype !== syncUpdate) return false
    return isCollaboratorUpdateAllowed(document, decoding.readVarUint8Array(decoder))
  } catch {
    return false
  }
}

export const setupReadOnlyAwareWebSocket = (
  socket: WebSocket,
  isReadOnly: () => boolean,
  setup: (socket: WebSocket) => void,
  isWritableMessageAllowed: (data: RawData) => boolean = () => true,
) => {
  const originalOn = socket.on
  socket.on = function guardedOn(
    this: WebSocket,
    event: string,
    listener: (...args: unknown[]) => void,
  ) {
    if (event !== 'message') {
      return originalOn.call(this, event, listener)
    }
    return originalOn.call(
      this,
      event,
      (data: RawData, ...args: unknown[]) => {
        if (
          isReadOnly()
            ? isReadOnlyWebSocketMessageAllowed(data)
            : isWritableMessageAllowed(data)
        ) {
          listener.call(this, data, ...args)
        }
      },
    )
  } as typeof socket.on
  try {
    setup(socket)
  } finally {
    socket.on = originalOn
  }
}