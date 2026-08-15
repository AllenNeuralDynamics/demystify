import type { SharedComment, SharedCommentMessage } from '../hooks/useCollaboration'

export type ReviewStatusFilter = 'open' | 'resolved' | 'all'
export type ReviewTypeFilter = 'all' | 'comments' | 'suggestions'

export interface ReviewInboxFilters {
  query: string
  status: ReviewStatusFilter
  type: ReviewTypeFilter
  forActorIds?: string[]
}

const normalize = (value: string) => value.trim().toLocaleLowerCase()

export const filterReviewThreads = (
  comments: SharedComment[],
  messages: SharedCommentMessage[],
  filters: ReviewInboxFilters,
) => {
  const query = normalize(filters.query)
  const ownedActorIds = new Set(filters.forActorIds ?? [])
  const messagesByThread = new Map<string, SharedCommentMessage[]>()
  messages.forEach((message) => {
    const threadMessages = messagesByThread.get(message.threadId) ?? []
    threadMessages.push(message)
    messagesByThread.set(message.threadId, threadMessages)
  })

  return comments.filter((comment) => {
    if (filters.status === 'open' && comment.resolved) return false
    if (filters.status === 'resolved' && !comment.resolved) return false
    if (filters.type === 'comments' && comment.suggestion) return false
    if (filters.type === 'suggestions' && !comment.suggestion) return false

    const replies = messagesByThread.get(comment.id) ?? []
    if (
      ownedActorIds.size > 0 &&
      !ownedActorIds.has(comment.authorId) &&
      !comment.mentions?.some((mention) => ownedActorIds.has(mention.actorId)) &&
      !replies.some((message) =>
        ownedActorIds.has(message.authorId) ||
        message.mentions?.some((mention) => ownedActorIds.has(mention.actorId)),
      )
    ) return false

    if (!query) return true
    return [
      comment.authorName,
      comment.body,
      comment.anchor?.quote,
      comment.suggestion?.before,
      comment.suggestion?.after,
      ...replies.flatMap((message) => [message.authorName, message.body]),
    ].some((value) => value && normalize(value).includes(query))
  })
}

export const getVisibleReviewThreads = (
  comments: SharedComment[],
  limit: number,
  activeCommentId: string | null,
) => {
  const visible = comments.slice(0, limit)
  if (!activeCommentId || visible.some((comment) => comment.id === activeCommentId)) {
    return visible
  }
  const active = comments.find((comment) => comment.id === activeCommentId)
  return active
    ? [active, ...visible.slice(0, Math.max(0, limit - 1))]
    : visible
}