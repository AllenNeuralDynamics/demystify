import { describe, expect, it } from 'vitest'
import type { SharedComment, SharedCommentMessage } from '../hooks/useCollaboration'
import { filterReviewThreads, getVisibleReviewThreads } from './reviewInbox'

const comments: SharedComment[] = [
  {
    id: 'open-comment',
    authorId: 'reviewer-a',
    authorName: 'Reviewer A',
    authorColor: '#16705d',
    body: 'Clarify the analysis window.',
    createdAt: '2026-08-14T10:00:00.000Z',
    resolved: false,
    anchor: { version: 1, start: 'start', end: 'end', quote: 'analysis window' },
  },
  {
    id: 'resolved-suggestion',
    authorId: 'reviewer-b',
    authorName: 'Reviewer B',
    authorColor: '#a64b36',
    body: 'Suggested edit',
    createdAt: '2026-08-14T09:00:00.000Z',
    resolved: true,
    suggestion: {
      kind: 'replace',
      filePath: 'manuscript.md',
      before: 'weak claim',
      after: 'bounded claim',
      status: 'accepted',
    },
  },
]

const messages: SharedCommentMessage[] = [{
  id: 'reply',
  threadId: 'open-comment',
  authorId: 'maintainer',
  authorName: 'Maintainer',
  authorColor: '#174f3f',
  body: 'I can revise the methods paragraph.',
  createdAt: '2026-08-14T11:00:00.000Z',
}]

describe('filterReviewThreads', () => {
  it('filters by status and review type', () => {
    expect(filterReviewThreads(comments, messages, {
      query: '',
      status: 'open',
      type: 'comments',
    }).map((comment) => comment.id)).toEqual(['open-comment'])

    expect(filterReviewThreads(comments, messages, {
      query: '',
      status: 'resolved',
      type: 'suggestions',
    }).map((comment) => comment.id)).toEqual(['resolved-suggestion'])
  })

  it('searches source context, suggestion text, authors, and replies', () => {
    expect(filterReviewThreads(comments, messages, {
      query: 'methods paragraph',
      status: 'all',
      type: 'all',
    }).map((comment) => comment.id)).toEqual(['open-comment'])

    expect(filterReviewThreads(comments, messages, {
      query: 'bounded claim',
      status: 'all',
      type: 'all',
    }).map((comment) => comment.id)).toEqual(['resolved-suggestion'])
  })

  it('limits For you to threads authored or joined by the current actor', () => {
    expect(filterReviewThreads(comments, messages, {
      query: '',
      status: 'all',
      type: 'all',
      forActorIds: ['maintainer'],
    }).map((comment) => comment.id)).toEqual(['open-comment'])
  })

  it('keeps a selected thread inside a bounded review window', () => {
    const manyComments = Array.from({ length: 60 }, (_, index): SharedComment => ({
      id: `comment-${index}`,
      authorId: 'reviewer',
      authorName: 'Reviewer',
      authorColor: '#16705d',
      body: `Comment ${index}`,
      createdAt: '2026-08-14T10:00:00.000Z',
      resolved: false,
    }))

    const visible = getVisibleReviewThreads(manyComments, 50, 'comment-55')
    expect(visible).toHaveLength(50)
    expect(visible[0].id).toBe('comment-55')
    expect(new Set(visible.map((comment) => comment.id)).size).toBe(50)
  })
})