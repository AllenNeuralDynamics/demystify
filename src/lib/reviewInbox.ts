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
      !replies.some((message) => ownedActorIds.has(message.authorId))
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