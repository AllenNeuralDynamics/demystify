import type { Request } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRepositoryPullRequest,
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