import * as decoding from 'lib0/decoding'
import { diffChars } from 'diff'
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
  'workingContent',
  'bibliography',
  'mystConfig',
  'projectFiles',
  'references',
  'comments',
  'commentMessages',
  'proposalContributors',
  'proposalHistory',
  'metadata',
])

export interface CollaborationSocketActor {
  role: 'editor' | 'collaborator'
  actorId: string
  actorName: string
  ownedActorIds: string[]
}

const actorOwns = (actor: CollaborationSocketActor, authorId: unknown) =>
  typeof authorId === 'string' && actor.ownedActorIds.includes(authorId)

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
  proposalHistory: stableEntries(document.getMap('proposalHistory')),
})

const hasOnlyKnownRoots = (document: Yjs.Doc) =>
  Array.from(document.share.keys()).every((name) => allowedRootTypes.has(name))

const hasText = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum

const hasOptionalText = (value: unknown, maximum: number) =>
  value === undefined || (typeof value === 'string' && value.length <= maximum)

const hasOptionalDate = (value: unknown) =>
  value === undefined || (hasText(value, 100) && !Number.isNaN(Date.parse(value as string)))

const hasValidIdentity = (value: Record<string, unknown>) =>
  hasText(value.authorId, 200) &&
  hasText(value.authorName, 200) &&
  hasText(value.authorColor, 100) &&
  hasText(value.createdAt, 100) &&
  !Number.isNaN(Date.parse(value.createdAt as string))

const resolveAnchorQuote = (
  document: Yjs.Doc,
  anchorValue: unknown,
  target: unknown = 'content',
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
    const text = document.getText(target === 'working' ? 'workingContent' : 'content')
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
  actor: CollaborationSocketActor,
) => {
  if (!commentIdPattern.test(id) || !isRecord(value)) return false
  if (
    value.id !== id ||
    !hasValidIdentity(value) ||
    value.authorId !== actor.actorId ||
    !hasText(value.body, 60_000) ||
    value.resolved !== false ||
    value.github !== undefined
  ) return false
  const anchorResult = value.anchor === undefined
    ? null
    : resolveAnchorQuote(document, value.anchor, value.anchorTarget)
  if (value.anchor !== undefined && !anchorResult) return false
  return value.suggestion === undefined ||
    isValidNewSuggestion(value, anchorResult, existingComments, document)
}

const withoutKeys = (value: Record<string, unknown>, keys: string[]) => {
  const result = { ...value }
  keys.forEach((key) => delete result[key])
  return result
}

const suggestionDecisionIsAllowed = (
  value: Record<string, unknown>,
  next: Record<string, unknown>,
) => {
  if (!isRecord(value.suggestion) || !isRecord(next.suggestion)) return false
  if (JSON.stringify(withoutKeys(next.suggestion, [
    'status',
    'decidedAt',
    'decidedById',
    'decidedByName',
  ])) !== JSON.stringify(withoutKeys(value.suggestion, [
    'status',
    'decidedAt',
    'decidedById',
    'decidedByName',
  ]))) return false
  return ['pending', 'accepted', 'rejected', 'conflicted'].includes(
    next.suggestion.status as string,
  ) && hasOptionalDate(next.suggestion.decidedAt)
}

const existingCommentIsAllowed = (
  value: Record<string, unknown>,
  next: Record<string, unknown>,
  actor: CollaborationSocketActor,
) => {
  if (typeof next.resolved !== 'boolean') return false
  if (value.suggestion !== undefined) {
    if (actor.role !== 'editor') return JSON.stringify(next) === JSON.stringify(value)
    return suggestionDecisionIsAllowed(value, next) &&
      JSON.stringify(withoutKeys(next, ['resolved', 'suggestion', 'github'])) ===
        JSON.stringify(withoutKeys(value, ['resolved', 'suggestion', 'github']))
  }

  const bodyChanged = next.body !== value.body
  const githubChanged = JSON.stringify(next.github) !== JSON.stringify(value.github)
  if (bodyChanged && !actorOwns(actor, value.authorId) && !(actor.role === 'editor' && next.github)) {
    return false
  }
  if (bodyChanged ? !hasText(next.body, 60_000) || !hasOptionalDate(next.editedAt) : next.editedAt !== value.editedAt) {
    return false
  }
  if (githubChanged && actor.role !== 'editor') return false
  return JSON.stringify(withoutKeys(next, ['body', 'editedAt', 'resolved', 'github'])) ===
    JSON.stringify(withoutKeys(value, ['body', 'editedAt', 'resolved', 'github']))
}

const commentsAreAllowed = (
  current: Yjs.Doc,
  candidate: Yjs.Doc,
  actor: CollaborationSocketActor,
) => {
  const before = current.getMap<unknown>('comments')
  const after = candidate.getMap<unknown>('comments')
  for (const [id, value] of before.entries()) {
    const next = after.get(id)
    if (!isRecord(value) || !isRecord(next)) return false
    if (!existingCommentIsAllowed(value, next, actor)) return false
  }
  for (const [id, value] of after.entries()) {
    if (!before.has(id) && !isValidNewComment(candidate, id, value, before, actor)) return false
  }
  return after.size >= before.size
}

const isValidNewMessage = (
  comments: Yjs.Map<unknown>,
  id: string,
  value: unknown,
  actor: CollaborationSocketActor,
) => isRecord(value) &&
  commentIdPattern.test(id) &&
  value.id === id &&
  hasText(value.threadId, 100) &&
  comments.has(value.threadId as string) &&
  hasValidIdentity(value) &&
  (value.authorId === actor.actorId || (actor.role === 'editor' && isRecord(value.github))) &&
  hasText(value.body, 60_000) &&
  (value.github === undefined || actor.role === 'editor')

const existingMessageIsAllowed = (
  value: Record<string, unknown>,
  next: Record<string, unknown>,
  actor: CollaborationSocketActor,
) => {
  const bodyChanged = next.body !== value.body
  const githubChanged = JSON.stringify(next.github) !== JSON.stringify(value.github)
  if (bodyChanged && !actorOwns(actor, value.authorId) && !(actor.role === 'editor' && next.github)) {
    return false
  }
  if (bodyChanged ? !hasText(next.body, 60_000) || !hasOptionalDate(next.editedAt) : next.editedAt !== value.editedAt) {
    return false
  }
  if (githubChanged && actor.role !== 'editor') return false
  return JSON.stringify(withoutKeys(next, ['body', 'editedAt', 'github'])) ===
    JSON.stringify(withoutKeys(value, ['body', 'editedAt', 'github']))
}

const messagesAreAllowed = (
  current: Yjs.Doc,
  candidate: Yjs.Doc,
  actor: CollaborationSocketActor,
) => {
  const before = current.getMap<unknown>('commentMessages')
  const after = candidate.getMap<unknown>('commentMessages')
  for (const [id, value] of before.entries()) {
    const next = after.get(id)
    if (!isRecord(value) || !isRecord(next) || !existingMessageIsAllowed(value, next, actor)) {
      return false
    }
  }
  const comments = candidate.getMap<unknown>('comments')
  for (const [id, value] of after.entries()) {
    if (!before.has(id) && !isValidNewMessage(comments, id, value, actor)) return false
  }
  return after.size >= before.size
}

const metadataAreAllowed = (current: Yjs.Doc, candidate: Yjs.Doc) => {
  const before = current.getMap<unknown>('metadata')
  const after = candidate.getMap<unknown>('metadata')
  if (JSON.stringify(stableEntries(before)) === JSON.stringify(stableEntries(after))) return true
  if (before.get('workingContentInitialized') === true) return false
  const candidateEntries = new Map(after.entries())
  candidateEntries.delete('workingContentInitialized')
  const currentEntries = new Map(before.entries())
  currentEntries.delete('workingContentInitialized')
  return after.get('workingContentInitialized') === true &&
    JSON.stringify(Array.from(currentEntries.entries()).sort(([first], [second]) => first.localeCompare(second))) ===
      JSON.stringify(Array.from(candidateEntries.entries()).sort(([first], [second]) => first.localeCompare(second)))
}

const proposalContributorsAreUnchanged = (current: Yjs.Doc, candidate: Yjs.Doc) =>
  JSON.stringify(stableEntries(current.getMap('proposalContributors'))) ===
  JSON.stringify(stableEntries(candidate.getMap('proposalContributors')))

const isValidProposalContributor = (value: unknown) => isRecord(value) &&
  hasText(value.actorId, 200) &&
  hasText(value.name, 200) &&
  hasText(value.color, 100) &&
  hasText(value.firstEditedAt, 100) &&
  !Number.isNaN(Date.parse(value.firstEditedAt as string)) &&
  hasText(value.lastEditedAt, 100) &&
  !Number.isNaN(Date.parse(value.lastEditedAt as string))

const checkpointGitLinkIsAllowed = (
  value: Record<string, unknown>,
  next: Record<string, unknown>,
) => {
  if (JSON.stringify(next) === JSON.stringify(value)) return true
  if (value.commitSha !== undefined || value.submittedAt !== undefined) {
    return false
  }
  return /^[a-f0-9]{7,64}$/i.test(String(next.commitSha ?? '')) &&
    hasText(next.submittedAt, 100) &&
    !Number.isNaN(Date.parse(next.submittedAt as string)) &&
    JSON.stringify(withoutKeys(next, ['commitSha', 'submittedAt'])) === JSON.stringify(value)
}

const proposalHistoryTransitionIsAllowed = (
  current: Yjs.Doc,
  candidate: Yjs.Doc,
  actor: CollaborationSocketActor,
) => {
  const before = current.getMap<unknown>('proposalHistory')
  const after = candidate.getMap<unknown>('proposalHistory')
  if (after.size < before.size || after.size > before.size + 1 || after.size > 10_000) {
    return false
  }
  for (const [id, value] of before.entries()) {
    const next = after.get(id)
    if (!isRecord(value) || !isRecord(next) || !checkpointGitLinkIsAllowed(value, next)) {
      return false
    }
  }
  const additions = Array.from(after.entries()).filter(([id]) => !before.has(id))
  if (additions.length === 0) return true
  const [id, value] = additions[0] ?? []
  if (!id || !commentIdPattern.test(id) || !isRecord(value) || value.id !== id) return false
  if (
    !hasOptionalText(value.before, 2_000_000) ||
    !hasOptionalText(value.after, 2_000_000) ||
    !Array.isArray(value.contributors) ||
    value.contributors.length > 1_000 ||
    !value.contributors.every(isValidProposalContributor) ||
    !hasText(value.createdAt, 100) ||
    Number.isNaN(Date.parse(value.createdAt as string)) ||
    !hasText(value.decidedAt, 100) ||
    Number.isNaN(Date.parse(value.decidedAt as string)) ||
    value.decidedById !== actor.actorId ||
    !hasText(value.decidedByName, 200) ||
    !['accepted', 'rejected'].includes(value.status as string) ||
    value.commitSha !== undefined ||
    value.submittedAt !== undefined
  ) return false

  const accepted = current.getText('content').toString()
  const working = current.getText('workingContent').toString()
  if (value.before !== accepted || value.after !== working || accepted === working) return false
  const expectedContributors = Array.from(
    current.getMap<unknown>('proposalContributors').values(),
  ).sort((first, second) => {
    if (!isRecord(first) || !isRecord(second)) return 0
    return String(first.actorId).localeCompare(String(second.actorId))
  })
  const checkpointContributors = [...value.contributors].sort((first, second) =>
    String((first as Record<string, unknown>).actorId).localeCompare(
      String((second as Record<string, unknown>).actorId),
    ))
  if (JSON.stringify(checkpointContributors) !== JSON.stringify(expectedContributors)) return false
  if (candidate.getMap('proposalContributors').size !== 0) return false

  const nextAccepted = candidate.getText('content').toString()
  const nextWorking = candidate.getText('workingContent').toString()
  return value.status === 'accepted'
    ? nextAccepted === working && nextWorking === working
    : nextAccepted === accepted && nextWorking === accepted
}

const contributorColor = (actorId: string) => {
  let hash = 0
  for (const character of actorId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return ['#16705d', '#a64b36', '#27628d', '#7a5b16'][Math.abs(hash) % 4] ?? '#16705d'
}

const stampProposalContributor = (
  document: Yjs.Doc,
  actor: CollaborationSocketActor,
) => {
  const contributors = document.getMap<Record<string, unknown>>('proposalContributors')
  const existing = contributors.get(actor.actorId)
  const editedAt = new Date().toISOString()
  contributors.set(actor.actorId, {
    actorId: actor.actorId,
    name: actor.actorName,
    color: contributorColor(actor.actorId),
    firstEditedAt: typeof existing?.firstEditedAt === 'string'
      ? existing.firstEditedAt
      : editedAt,
    lastEditedAt: editedAt,
  })
}

const stampLegacyProposalContributors = (document: Yjs.Doc) => {
  const contributors = document.getMap<Record<string, unknown>>('proposalContributors')
  let stamped = 0
  for (const comment of document.getMap<unknown>('comments').values()) {
    if (
      !isRecord(comment) ||
      !isRecord(comment.suggestion) ||
      comment.suggestion.status !== 'pending' ||
      !hasText(comment.authorId, 200) ||
      !hasText(comment.authorName, 200) ||
      !hasText(comment.authorColor, 100) ||
      !hasText(comment.createdAt, 100)
    ) continue
    const actorId = comment.authorId as string
    const existing = contributors.get(actorId)
    contributors.set(actorId, {
      actorId,
      name: comment.authorName,
      color: comment.authorColor,
      firstEditedAt: typeof existing?.firstEditedAt === 'string'
        ? existing.firstEditedAt
        : comment.createdAt,
      lastEditedAt: comment.createdAt,
    })
    stamped += 1
  }
  return stamped
}

const replaceText = (text: Yjs.Text, content: string) => {
  let offset = 0
  for (const part of diffChars(text.toString(), content)) {
    if (part.removed) text.delete(offset, part.value.length)
    else if (part.added) {
      text.insert(offset, part.value)
      offset += part.value.length
    } else offset += part.value.length
  }
}

const isCollaboratorUpdateAllowed = (
  document: Yjs.Doc,
  update: Uint8Array,
  actor: CollaborationSocketActor,
) => {
  try {
    const protectedState = getProtectedState(document)
    const workingContent = document.getText('workingContent').toString()
    const candidate = new Y.Doc()
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
      Y.applyUpdate(candidate, update)
      const nextWorkingContent = candidate.getText('workingContent').toString()
      const legacyWorkingProposalActive =
        document.getMap('metadata').get('workingContentInitialized') === true &&
        workingContent !== document.getText('content').toString()
      const initializingWorkingContent =
        document.getMap('metadata').get('workingContentInitialized') !== true &&
        candidate.getMap('metadata').get('workingContentInitialized') === true
      const allowed = hasOnlyKnownRoots(candidate) &&
        getProtectedState(candidate) === protectedState &&
        (nextWorkingContent === workingContent || legacyWorkingProposalActive) &&
        nextWorkingContent.length <= 2_000_000 &&
        metadataAreAllowed(document, candidate) &&
        proposalContributorsAreUnchanged(document, candidate) &&
        commentsAreAllowed(document, candidate, actor) &&
        messagesAreAllowed(document, candidate, actor)
      if (allowed && nextWorkingContent !== workingContent) {
        const migrated = initializingWorkingContent
          ? stampLegacyProposalContributors(document)
          : 0
        if (
          !initializingWorkingContent ||
          (migrated === 0 && nextWorkingContent !== document.getText('content').toString())
        ) {
          stampProposalContributor(document, actor)
        }
      }
      return allowed
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
  actor: CollaborationSocketActor,
) => {
  try {
    const decoder = decoding.createDecoder(toUint8Array(data))
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageAwareness) return true
    if (messageType !== messageSync) return false
    const subtype = decoding.readVarUint(decoder)
    if (subtype === syncStep1) return true
    if (subtype !== syncStep2 && subtype !== syncUpdate) return false
    return isCollaboratorUpdateAllowed(
      document,
      decoding.readVarUint8Array(decoder),
      actor,
    )
  } catch {
    return false
  }
}

export const isEditorWebSocketMessageAllowed = (
  data: RawData,
  document: Yjs.Doc,
  actor: CollaborationSocketActor,
) => {
  try {
    const decoder = decoding.createDecoder(toUint8Array(data))
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageAwareness) return true
    if (messageType !== messageSync) return false
    const subtype = decoding.readVarUint(decoder)
    if (subtype === syncStep1) return true
    if (subtype !== syncStep2 && subtype !== syncUpdate) return false
    const update = decoding.readVarUint8Array(decoder)
    const acceptedContent = document.getText('content').toString()
    const workingContent = document.getText('workingContent').toString()
    const proposalHistory = JSON.stringify(stableEntries(document.getMap('proposalHistory')))
    const candidate = new Y.Doc()
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
      Y.applyUpdate(candidate, update)
      const nextAcceptedContent = candidate.getText('content').toString()
      const nextWorkingContent = candidate.getText('workingContent').toString()
      const nextProposalHistory = JSON.stringify(stableEntries(candidate.getMap('proposalHistory')))
      const initializingWorkingContent =
        document.getMap('metadata').get('workingContentInitialized') !== true &&
        candidate.getMap('metadata').get('workingContentInitialized') === true
      const acceptedChanged = nextAcceptedContent !== acceptedContent
      const workingChanged = nextWorkingContent !== workingContent
      const proposalDecision = nextProposalHistory !== proposalHistory
      const directAcceptedEdit = acceptedChanged && acceptedContent === workingContent
      const acceptedProposal = acceptedChanged && nextAcceptedContent === workingContent
      if (acceptedChanged && !directAcceptedEdit && !acceptedProposal) return false
      if (
        directAcceptedEdit &&
        document.getMap('proposalContributors').size > 0
      ) return false
      const historyAllowed = proposalHistoryTransitionIsAllowed(document, candidate, actor)
      const contributorStateAllowed = proposalDecision
        ? candidate.getMap('proposalContributors').size === 0
        : proposalContributorsAreUnchanged(document, candidate)
      const allowed = hasOnlyKnownRoots(candidate) &&
        nextAcceptedContent.length <= 2_000_000 &&
        nextWorkingContent.length <= 2_000_000 &&
        historyAllowed &&
        contributorStateAllowed &&
        commentsAreAllowed(document, candidate, actor) &&
        messagesAreAllowed(document, candidate, actor)
      if (
        allowed &&
        workingChanged &&
        !proposalDecision &&
        !acceptedChanged
      ) {
        const migrated = initializingWorkingContent
          ? stampLegacyProposalContributors(document)
          : 0
        if (
          !initializingWorkingContent ||
          (migrated === 0 && nextWorkingContent !== acceptedContent)
        ) {
          stampProposalContributor(document, actor)
        }
      }
      if (
        allowed &&
        directAcceptedEdit &&
        !workingChanged
      ) {
        replaceText(document.getText('workingContent'), nextAcceptedContent)
      }
      return allowed
    } finally {
      candidate.destroy()
    }
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