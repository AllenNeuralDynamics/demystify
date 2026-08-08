import type { Request } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRepositoryPullRequest,
  getRepositoryPullRequest,
  getRepositoryPullRequestCommentSync,
  upsertRepositoryPullRequestComment,
  upsertRepositoryPullRequestCommentReply,
  type RepositoryWriteTarget,
} from './github.js'

const request = {
  session: {
    github: {
      accessToken: 'test-token',
      user: {
        id: 42,
        login: 'researcher',
        name: 'Researcher',
        avatarUrl: '',
      },
    },
  },
} as unknown as Request

const target: RepositoryWriteTarget = {
  owner: 'researcher',
  repository: 'paper',
  path: 'paper.md',
  baseBranch: 'main',
  branchName: 'demystify/test-room',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createRepositoryPullRequest', () => {
  it('creates a new pull request as a draft', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ fork: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          number: 17,
          html_url: 'https://github.com/researcher/paper/pull/17',
          title: 'Update paper',
          state: 'open',
          draft: true,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createRepositoryPullRequest(request, target, 'Update paper'),
    ).resolves.toEqual({
      number: 17,
      htmlUrl: 'https://github.com/researcher/paper/pull/17',
      title: 'Update paper',
      state: 'draft',
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      head: 'demystify/test-room',
      base: 'main',
      draft: true,
    })
  })

  it('treats a closed draft pull request as closed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      number: 17,
      html_url: 'https://github.com/researcher/paper/pull/17',
      title: 'Closed draft',
      state: 'closed',
      draft: true,
      merged_at: null,
      head: {
        ref: 'demystify/test-room',
        repo: { full_name: 'researcher/paper' },
      },
      base: { ref: 'main' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRepositoryPullRequest(request, target, 17)).resolves.toEqual({
      number: 17,
      htmlUrl: 'https://github.com/researcher/paper/pull/17',
      title: 'Closed draft',
      state: 'closed',
    })
  })

  it('discovers an existing open pull request for a legacy room branch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ fork: false }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Validation Failed' }, 422))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            number: 9,
            html_url: 'https://github.com/researcher/paper/pull/9',
            title: 'Existing review',
            state: 'open',
            draft: false,
            merged_at: null,
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createRepositoryPullRequest(request, target, 'Update paper'),
    ).resolves.toEqual({
      number: 9,
      htmlUrl: 'https://github.com/researcher/paper/pull/9',
      title: 'Existing review',
      state: 'open',
    })
    expect(fetchMock.mock.calls[2][0]).toContain(
      '/pulls?state=all&head=researcher%3Ademystify%2Ftest-room&base=main',
    )
  })
})

describe('upsertRepositoryPullRequestComment', () => {
  it('creates a marked PR conversation comment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        id: 101,
        html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-101',
        body: 'Review this section',
        updated_at: '2026-08-08T05:00:00Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertRepositoryPullRequestComment(request, target, 17, {
      id: 'comment-1',
      authorName: 'Researcher',
      body: 'Review this section',
      resolved: false,
    })).resolves.toEqual({
      id: 101,
      htmlUrl: 'https://github.com/researcher/paper/pull/17#issuecomment-101',
      updatedAt: '2026-08-08T05:00:00Z',
      mode: 'conversation',
    })
    expect(fetchMock.mock.calls[0][0]).toContain('/issues/17/comments?')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    const body = JSON.parse(fetchMock.mock.calls[1][1].body).body as string
    expect(body).toContain('DeMystify comment by Researcher - Open')
    expect(body).toContain('<!-- demystify-comment:comment-1 -->')
  })

  it('updates the marked comment when its resolution changes', async () => {
    const marker = '<!-- demystify-comment:comment-1 -->'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 101,
        html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-101',
        body: `Review this section\n\n${marker}`,
        updated_at: '2026-08-08T05:00:00Z',
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 101,
        html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-101',
        body: `Review this section\n\nResolved\n\n${marker}`,
        updated_at: '2026-08-08T05:01:00Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    await upsertRepositoryPullRequestComment(request, target, 17, {
      id: 'comment-1',
      githubCommentId: 101,
      authorName: 'Researcher',
      body: 'Review this section',
      resolved: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/issues/comments/101')
    expect(fetchMock.mock.calls[1][0]).toContain('/issues/comments/101')
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    const body = JSON.parse(fetchMock.mock.calls[1][1].body).body as string
    expect(body).toContain('DeMystify comment by Researcher - Resolved')
  })

  it('rejects a GitHub comment ID without the matching marker', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      id: 202,
      html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-202',
      body: 'An unrelated pull-request comment',
      updated_at: '2026-08-08T05:00:00Z',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertRepositoryPullRequestComment(request, target, 17, {
      id: 'comment-1',
      githubCommentId: 202,
      authorName: 'Researcher',
      body: 'Review this section',
      resolved: true,
    })).rejects.toMatchObject({ status: 409 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates an inline review thread for an anchored changed line', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ head: { sha: 'commit-sha' } }))
      .mockResolvedValueOnce(jsonResponse({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from('\n\n\n\n\n\n\nA changed paragraph.\ncontinued').toString('base64'),
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 303,
        html_url: 'https://github.com/researcher/paper/pull/17#discussion_r303',
        body: 'Check this claim',
        updated_at: '2026-08-08T05:02:00Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertRepositoryPullRequestComment(request, target, 17, {
      id: 'comment-2',
      authorName: 'Researcher',
      body: 'Check this claim',
      resolved: false,
      anchor: { startLine: 8, endLine: 9, quote: 'A changed paragraph.' },
    })).resolves.toMatchObject({ id: 303, mode: 'review' })

    const requestBody = JSON.parse(fetchMock.mock.calls[4][1].body)
    expect(fetchMock.mock.calls[4][0]).toContain('/pulls/17/comments')
    expect(requestBody).toMatchObject({
      commit_id: 'commit-sha',
      path: 'paper.md',
      start_line: 8,
      start_side: 'RIGHT',
      line: 9,
      side: 'RIGHT',
    })
  })

  it('falls back to a linked conversation comment outside the PR diff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ head: { sha: 'commit-sha' } }))
      .mockResolvedValueOnce(jsonResponse({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from('\n\n\n\n\n\n\nAn unchanged paragraph.').toString('base64'),
      }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Validation Failed' }, 422))
      .mockResolvedValueOnce(jsonResponse({
        id: 404,
        html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-404',
        body: 'Check this claim',
        updated_at: '2026-08-08T05:03:00Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertRepositoryPullRequestComment(request, target, 17, {
      id: 'comment-3',
      authorName: 'Researcher',
      body: 'Check this claim',
      resolved: false,
      anchor: { startLine: 8, endLine: 8, quote: 'An unchanged paragraph.' },
    })).resolves.toMatchObject({ id: 404, mode: 'conversation' })

    const fallbackBody = JSON.parse(fetchMock.mock.calls[5][1].body).body as string
    expect(fallbackBody).toContain('[paper.md:8-8](')
    expect(fallbackBody).toContain('/blob/demystify%2Ftest-room/paper.md#L8-L8')
    expect(fallbackBody).toContain('> An unchanged paragraph.')
  })

  it('creates a reply in the native GitHub review thread', async () => {
    const rootMarker = '<!-- demystify-comment:comment-2 -->'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 303,
        html_url: 'https://github.com/researcher/paper/pull/17#discussion_r303',
        pull_request_url: 'https://api.github.com/repos/researcher/paper/pulls/17',
        body: rootMarker,
        updated_at: '2026-08-08T05:02:00Z',
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        id: 304,
        html_url: 'https://github.com/researcher/paper/pull/17#discussion_r304',
        body: 'A reply',
        updated_at: '2026-08-08T05:04:00Z',
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(upsertRepositoryPullRequestCommentReply(request, target, 17, {
      id: 'message-1',
      threadId: 'comment-2',
      rootGitHubCommentId: 303,
      mode: 'review',
      authorName: 'Researcher',
      body: 'A reply',
    })).resolves.toMatchObject({ id: 304, mode: 'review' })

    const requestBody = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(requestBody).toMatchObject({ in_reply_to: 303 })
    expect(requestBody.body).toContain(
      '<!-- demystify-thread:comment-2 message:message-1 -->',
    )
  })

  it('imports GitHub-native replies and review-thread resolution', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          id: 303,
          html_url: 'https://github.com/researcher/paper/pull/17#discussion_r303',
          body: '<!-- demystify-comment:comment-2 -->',
          created_at: '2026-08-08T05:02:00Z',
          updated_at: '2026-08-08T05:02:00Z',
          user: { id: 42, login: 'researcher' },
        },
        {
          id: 305,
          in_reply_to_id: 303,
          html_url: 'https://github.com/researcher/paper/pull/17#discussion_r305',
          body: 'Reply written on GitHub',
          created_at: '2026-08-08T05:05:00Z',
          updated_at: '2026-08-08T05:05:00Z',
          user: { id: 84, login: 'reviewer' },
        },
      ]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{
                  id: 'PRRT_thread',
                  isResolved: true,
                  comments: {
                    nodes: [{ databaseId: 303 }, { databaseId: 305 }],
                  },
                }],
              },
            },
          },
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getRepositoryPullRequestCommentSync(request, target, 17),
    ).resolves.toEqual({
      messages: [expect.objectContaining({
        id: 'github-305',
        threadId: 'comment-2',
        authorName: 'reviewer',
        body: 'Reply written on GitHub',
        github: expect.objectContaining({ id: 305, mode: 'review' }),
      })],
      resolutions: [{ threadId: 'comment-2', resolved: true }],
    })
  })

  it('resolves the native GitHub review thread', async () => {
    const marker = '<!-- demystify-comment:comment-2 -->'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 303,
        html_url: 'https://github.com/researcher/paper/pull/17#discussion_r303',
        body: marker,
        updated_at: '2026-08-08T05:02:00Z',
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 303,
        html_url: 'https://github.com/researcher/paper/pull/17#discussion_r303',
        body: `Check this claim\n\n${marker}`,
        updated_at: '2026-08-08T05:06:00Z',
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{
                  id: 'PRRT_thread',
                  isResolved: false,
                  comments: { nodes: [{ databaseId: 303 }] },
                }],
              },
            },
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { resolveReviewThread: { thread: { id: 'PRRT_thread', isResolved: true } } },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await upsertRepositoryPullRequestComment(request, target, 17, {
      id: 'comment-2',
      githubCommentId: 303,
      githubMode: 'review',
      authorName: 'Researcher',
      body: 'Check this claim',
      resolved: true,
      anchor: { startLine: 8, endLine: 8, quote: 'A changed paragraph.' },
    })

    const mutation = JSON.parse(fetchMock.mock.calls[3][1].body).query as string
    expect(mutation).toContain('resolveReviewThread')
    expect(fetchMock.mock.calls[3][0]).toBe('https://api.github.com/graphql')
  })
})