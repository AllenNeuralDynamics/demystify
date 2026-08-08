import type { Request } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRepositoryPullRequest,
  upsertRepositoryPullRequestComment,
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
})