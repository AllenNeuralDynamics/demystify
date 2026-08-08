import { randomBytes } from 'node:crypto'
import { Router, type Request } from 'express'

interface GitHubCredentials {
  clientId: string
  clientSecret: string
  appSlug?: string
  appUrl: string
}

interface GitHubTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface GitHubApiUser {
  id: number
  login: string
  name: string | null
  avatar_url: string
}

interface GitHubInstallation {
  id: number
}

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  fork: boolean
  private: boolean
  default_branch: string
  owner: {
    login: string
  }
  parent?: {
    full_name: string
  }
  permissions?: {
    admin?: boolean
    maintain?: boolean
    pull?: boolean
    push?: boolean
  }
}

interface GitHubContentFile {
  type: 'file'
  name: string
  path: string
  sha: string
  content?: string
  encoding?: string
  html_url: string
}

interface GitHubContentDirectory {
  type: 'dir'
  name: string
  path: string
  sha: string
  html_url: string
}

interface GitReference {
  object: {
    sha: string
  }
}

interface GitCommitResponse {
  commit: {
    sha: string
    html_url: string
  }
  content: {
    sha: string
  } | null
}

interface GitPullRequest {
  number: number
  html_url: string
  title: string
  state: 'open' | 'closed'
  draft?: boolean
  merged_at?: string | null
  head?: {
    sha: string
    ref?: string
    repo?: {
      full_name: string
    } | null
  }
  base?: {
    ref: string
  }
}

interface GitHubIssueComment {
  id: number
  html_url: string
  body: string
  created_at?: string
  updated_at: string
  issue_url?: string
  user?: {
    id: number
    login: string
  }
}

interface GitHubReviewComment extends GitHubIssueComment {
  in_reply_to_id?: number
  pull_request_url?: string
}

export interface RepositoryPullRequest {
  number: number
  htmlUrl: string
  title: string
  state: 'draft' | 'open' | 'closed' | 'merged'
}

export interface RepositoryPullRequestComment {
  id: number
  htmlUrl: string
  updatedAt: string
  mode: 'conversation' | 'review'
}

export interface RepositoryPullRequestCommentInput {
  id: string
  githubCommentId?: number
  githubMode?: 'conversation' | 'review'
  authorName: string
  body: string
  resolved: boolean
  anchor?: {
    startLine: number
    endLine: number
    quote: string
  }
}

export interface RepositoryPullRequestCommentReplyInput {
  id: string
  threadId: string
  githubCommentId?: number
  rootGitHubCommentId: number
  mode: 'conversation' | 'review'
  authorName: string
  body: string
}

export interface RepositoryPullRequestCommentSync {
  messages: Array<{
    id: string
    threadId: string
    authorId: string
    authorName: string
    authorColor: string
    body: string
    createdAt: string
    github: RepositoryPullRequestComment
  }>
  resolutions: Array<{
    threadId: string
    resolved: boolean
  }>
}

export interface RepositoryWriteTarget {
  owner: string
  repository: string
  path: string
  baseBranch: string
  branchName: string
}

const toRepositoryPullRequest = (
  pullRequest: GitPullRequest,
): RepositoryPullRequest => ({
  number: pullRequest.number,
  htmlUrl: pullRequest.html_url,
  title: pullRequest.title,
  state: pullRequest.merged_at
    ? 'merged'
    : pullRequest.state === 'closed'
      ? 'closed'
      : pullRequest.draft
        ? 'draft'
        : 'open',
})

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

const getCredentials = (): GitHubCredentials | null => {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
    appSlug: process.env.GITHUB_APP_SLUG,
    appUrl: (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, ''),
  }
}

const readString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${field} is required.`)
  }
  return value.trim()
}

const readQueryString = (request: Request, field: string) =>
  readString(request.query[field], field)

const validateRepositoryPart = (value: string, field: string) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ApiError(400, `${field} contains unsupported characters.`)
  }
  return value
}

const validatePath = (value: string) => {
  const normalized = value.replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new ApiError(400, 'path must point to a repository file.')
  }
  return normalized
}

const validateBranch = (value: string, field: string) => {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..')
  ) {
    throw new ApiError(400, `${field} is not a valid Git branch name.`)
  }
  return value
}

const encodeRepositoryPath = (value: string) =>
  value.split('/').map(encodeURIComponent).join('/')

const saveSession = (request: Request) =>
  new Promise<void>((resolve, reject) => {
    request.session.save((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

const exchangeToken = async (body: Record<string, string>) => {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const token = (await response.json()) as GitHubTokenResponse
  if (!response.ok || !token.access_token) {
    throw new ApiError(
      502,
      token.error_description ?? token.error ?? 'GitHub did not issue an access token.',
    )
  }
  return token
}

const getAccessToken = async (request: Request) => {
  const auth = request.session.github
  if (!auth) throw new ApiError(401, 'Connect GitHub to continue.')

  if (!auth.expiresAt || auth.expiresAt > Date.now() + 60_000) {
    return auth.accessToken
  }

  const credentials = getCredentials()
  if (!credentials || !auth.refreshToken) {
    delete request.session.github
    throw new ApiError(401, 'Your GitHub session expired. Connect again.')
  }

  const token = await exchangeToken({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
  })
  auth.accessToken = token.access_token as string
  auth.refreshToken = token.refresh_token ?? auth.refreshToken
  auth.expiresAt = token.expires_in ? Date.now() + token.expires_in * 1_000 : undefined
  await saveSession(request)
  return auth.accessToken
}

const githubRequest = async <Result>(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Result> => {
  const accessToken = await getAccessToken(request)
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const apiMessage =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : `GitHub request failed with status ${response.status}.`
    throw new ApiError(response.status, apiMessage, payload)
  }

  return payload as Result
}

export const requireRepositoryWriteAccess = async (
  request: Request,
  owner: string,
  repository: string,
) => {
  const details = await githubRequest<GitHubRepository>(
    request,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
  )
  if (
    !details.permissions?.push &&
    !details.permissions?.maintain &&
    !details.permissions?.admin
  ) {
    throw new ApiError(403, 'Write access to this repository is required.')
  }
  return details
}

const findOrCreateBranch = async (
  request: Request,
  owner: string,
  repository: string,
  baseBranch: string,
  branchName: string,
) => {
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  try {
    return await githubRequest<GitReference>(
      request,
      `${repositoryPath}/git/ref/heads/${encodeURIComponent(branchName)}`,
    )
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }

  const baseReference = await githubRequest<GitReference>(
    request,
    `${repositoryPath}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  )
  return githubRequest<GitReference>(request, `${repositoryPath}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseReference.object.sha,
    }),
  })
}

export const createRepositorySnapshot = async (
  request: Request,
  target: RepositoryWriteTarget,
  content: string,
  commitMessage?: string,
) => {
  const { owner, repository, path, baseBranch, branchName } = target
  const message = commitMessage?.trim()
    ? commitMessage.trim().slice(0, 120)
    : `Update ${path} from DeMystify`
  const branchReference = await findOrCreateBranch(
    request,
    owner,
    repository,
    baseBranch,
    branchName,
  )
  const repositoryPath = `/repos/${owner}/${repository}`
  let existingSha: string | undefined
  let existingContent: string | undefined
  try {
    const existingFile = await githubRequest<GitHubContentFile>(
      request,
      `${repositoryPath}/contents/${encodeRepositoryPath(path)}?ref=${encodeURIComponent(branchName)}`,
    )
    existingSha = existingFile.sha
    if (existingFile.encoding === 'base64' && existingFile.content) {
      existingContent = Buffer.from(
        existingFile.content.replace(/\s/g, ''),
        'base64',
      ).toString('utf8')
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
  }

  if (existingContent === content) {
    return {
      branchName,
      commitSha: branchReference.object.sha,
      commitUrl: `https://github.com/${owner}/${repository}/commit/${branchReference.object.sha}`,
      fileSha: existingSha ?? null,
      unchanged: true,
    }
  }

  const commit = await githubRequest<GitCommitResponse>(
    request,
    `${repositoryPath}/contents/${encodeRepositoryPath(path)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: branchName,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
  )

  return {
    branchName,
    commitSha: commit.commit.sha,
    commitUrl: commit.commit.html_url,
    fileSha: commit.content?.sha ?? null,
    unchanged: false,
  }
}

export const createRepositoryPullRequest = async (
  request: Request,
  target: RepositoryWriteTarget,
  title: string,
): Promise<RepositoryPullRequest> => {
  const { owner, repository, baseBranch: base, branchName: head } = target
  const body = 'Collaborative MyST manuscript update created with DeMystify.'
  const repositoryPath = `/repos/${owner}/${repository}`
  const repositoryDetails = await githubRequest<GitHubRepository>(request, repositoryPath)
  if (repositoryDetails.fork) {
    throw new ApiError(
      409,
      'Pull requests are disabled for fork bindings because GitHub can target the parent repository. Use a standalone test repository or create the PR manually after verifying its base repository.',
    )
  }

  try {
    const pullRequest = await githubRequest<GitPullRequest>(
      request,
      `${repositoryPath}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({ title, head, base, body, draft: true }),
      },
    )
    return toRepositoryPullRequest(pullRequest)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 422) throw error
    const existing = await findRepositoryPullRequest(request, target)
    if (!existing) throw error
    return existing
  }
}

export const findRepositoryPullRequest = async (
  request: Request,
  target: RepositoryWriteTarget,
): Promise<RepositoryPullRequest | null> => {
  const { owner, repository, baseBranch: base, branchName: head } = target
  const repositoryPath = `/repos/${owner}/${repository}`
  const existing = await githubRequest<GitPullRequest[]>(
    request,
    `${repositoryPath}/pulls?state=all&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`,
  )
  return existing[0] ? toRepositoryPullRequest(existing[0]) : null
}

export const getRepositoryPullRequest = async (
  request: Request,
  target: RepositoryWriteTarget,
  pullRequestNumber: number,
): Promise<RepositoryPullRequest> => {
  const { owner, repository, baseBranch, branchName } = target
  const pullRequest = await githubRequest<GitPullRequest>(
    request,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullRequestNumber}`,
  )
  if (
    pullRequest.head?.ref !== branchName ||
    pullRequest.base?.ref !== baseBranch ||
    (pullRequest.head.repo && pullRequest.head.repo.full_name !== `${owner}/${repository}`)
  ) {
    throw new ApiError(409, 'The room pull request no longer matches its repository binding.')
  }
  return toRepositoryPullRequest(pullRequest)
}

const getCommentMarker = (commentId: string) =>
  `<!-- demystify-comment:${commentId} -->`

const getCommentMessageMarker = (threadId: string, messageId: string) =>
  `<!-- demystify-thread:${threadId} message:${messageId} -->`

const commentMarkerPattern = /<!-- demystify-comment:([A-Za-z0-9_-]{1,100}) -->/
const messageMarkerPattern = /<!-- demystify-thread:([A-Za-z0-9_-]{1,100}) message:([A-Za-z0-9_-]{1,100}) -->/

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

interface GitHubReviewThread {
  id: string
  isResolved: boolean
  comments: {
    nodes: Array<{ databaseId: number | null }>
  }
}

interface GitHubReviewThreadsResponse {
  data?: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: GitHubReviewThread[]
        }
      } | null
    } | null
  }
  errors?: Array<{ message: string }>
}

const getReviewThreads = async (
  request: Request,
  target: RepositoryWriteTarget,
  pullRequestNumber: number,
) => {
  const result = await githubRequest<GitHubReviewThreadsResponse>(
    request,
    '/graphql',
    {
      method: 'POST',
      body: JSON.stringify({
        query: `
          query DeMystifyReviewThreads($owner: String!, $repository: String!, $number: Int!) {
            repository(owner: $owner, name: $repository) {
              pullRequest(number: $number) {
                reviewThreads(first: 100) {
                  nodes {
                    id
                    isResolved
                    comments(first: 100) { nodes { databaseId } }
                  }
                }
              }
            }
          }
        `,
        variables: {
          owner: target.owner,
          repository: target.repository,
          number: pullRequestNumber,
        },
      }),
    },
  )
  if (result.errors?.length) {
    throw new ApiError(502, result.errors.map((error) => error.message).join('; '))
  }
  return result.data?.repository?.pullRequest?.reviewThreads.nodes ?? []
}

const setReviewThreadResolution = async (
  request: Request,
  target: RepositoryWriteTarget,
  pullRequestNumber: number,
  commentId: number,
  resolved: boolean,
) => {
  const threads = await getReviewThreads(request, target, pullRequestNumber)
  const thread = threads.find((candidate) =>
    candidate.comments.nodes.some((comment) => comment.databaseId === commentId),
  )
  if (!thread) throw new ApiError(502, 'GitHub did not return the review thread.')
  if (thread.isResolved === resolved) return

  const mutation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
  const result = await githubRequest<{ errors?: Array<{ message: string }> }>(
    request,
    '/graphql',
    {
      method: 'POST',
      body: JSON.stringify({
        query: `
          mutation DeMystifySetThreadResolution($threadId: ID!) {
            ${mutation}(input: { threadId: $threadId }) {
              thread { id isResolved }
            }
          }
        `,
        variables: { threadId: thread.id },
      }),
    },
  )
  if (result.errors?.length) {
    throw new ApiError(502, result.errors.map((error) => error.message).join('; '))
  }
}

const listGitHubComments = async <Comment extends GitHubIssueComment>(
  request: Request,
  path: string,
) => {
  const comments: Comment[] = []
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const next = await githubRequest<Comment[]>(
      request,
      `${path}${separator}per_page=100&page=${page}`,
    )
    comments.push(...next)
    if (next.length < 100) break
  }
  return comments
}

const formatPullRequestComment = (
  comment: RepositoryPullRequestCommentInput,
  target: RepositoryWriteTarget,
  includeAnchor: boolean,
) => {
  const status = comment.resolved ? 'Resolved' : 'Open'
  const anchorContext = includeAnchor && comment.anchor
    ? [
        `[${target.path}:${comment.anchor.startLine}-${comment.anchor.endLine}](` +
          `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}` +
          `/blob/${encodeURIComponent(target.branchName)}/${encodeRepositoryPath(target.path)}` +
          `#L${comment.anchor.startLine}-L${comment.anchor.endLine})`,
        comment.anchor.quote
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      ].join('\n\n')
    : null
  return [
    anchorContext,
    comment.body,
    `<sub>DeMystify comment by ${escapeHtml(comment.authorName)} - ${status}</sub>`,
    getCommentMarker(comment.id),
  ].filter(Boolean).join('\n\n')
}

export const upsertRepositoryPullRequestComment = async (
  request: Request,
  target: RepositoryWriteTarget,
  pullRequestNumber: number,
  comment: RepositoryPullRequestCommentInput,
): Promise<RepositoryPullRequestComment> => {
  const { owner, repository } = target
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  const marker = getCommentMarker(comment.id)
  let mode = comment.githubMode ?? (comment.anchor ? 'review' : 'conversation')
  let existing: GitHubIssueComment | GitHubReviewComment | undefined
  if (comment.githubCommentId) {
    try {
      const candidate = await githubRequest<GitHubIssueComment | GitHubReviewComment>(
        request,
        mode === 'review'
          ? `${repositoryPath}/pulls/comments/${comment.githubCommentId}`
          : `${repositoryPath}/issues/comments/${comment.githubCommentId}`,
      )
      if (!candidate.body.includes(marker)) {
        throw new ApiError(409, 'The GitHub comment does not belong to this room comment.')
      }
      existing = candidate
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
    }
  }
  if (!existing && comment.anchor) {
    const reviewComments = await listGitHubComments<GitHubReviewComment>(
      request,
      `${repositoryPath}/pulls/${pullRequestNumber}/comments`,
    )
    existing = reviewComments.find((candidate) => candidate.body.includes(marker))
    if (existing) mode = 'review'
  }
  if (!existing) {
    const comments = await listGitHubComments<GitHubIssueComment>(
      request,
      `${repositoryPath}/issues/${pullRequestNumber}/comments?sort=created&direction=desc`,
    )
    existing = comments.find((candidate) => candidate.body.includes(marker))
    if (existing) mode = 'conversation'
  }
  const body = formatPullRequestComment(comment, target, mode === 'conversation')

  let mirrored: GitHubIssueComment | GitHubReviewComment
  if (existing) {
    mirrored = existing.body === body
      ? existing
      : await githubRequest<GitHubIssueComment | GitHubReviewComment>(
          request,
          mode === 'review'
            ? `${repositoryPath}/pulls/comments/${existing.id}`
            : `${repositoryPath}/issues/comments/${existing.id}`,
          { method: 'PATCH', body: JSON.stringify({ body }) },
        )
  } else if (mode === 'review' && comment.anchor) {
    const pullRequest = await githubRequest<GitPullRequest>(
      request,
      `${repositoryPath}/pulls/${pullRequestNumber}`,
    )
    if (!pullRequest.head?.sha) {
      throw new ApiError(502, 'GitHub did not return the pull request head commit.')
    }
    const committedFile = await githubRequest<GitHubContentFile>(
      request,
      `${repositoryPath}/contents/${encodeRepositoryPath(target.path)}?ref=${encodeURIComponent(pullRequest.head.sha)}`,
    )
    const committedSource = committedFile.encoding === 'base64' && committedFile.content
      ? Buffer.from(committedFile.content.replace(/\s/g, ''), 'base64')
          .toString('utf8')
          .replace(/\r\n?/g, '\n')
      : ''
    const committedLines = committedSource.split('\n')
    const committedQuote = committedLines
      .slice(comment.anchor.startLine - 1, comment.anchor.endLine)
      .join('\n')
    const anchorMatchesHead = committedQuote.includes(
      comment.anchor.quote.replace(/\r\n?/g, '\n'),
    )
    if (!anchorMatchesHead) {
      mode = 'conversation'
      const fallbackBody = formatPullRequestComment(comment, target, true)
      mirrored = await githubRequest<GitHubIssueComment>(
        request,
        `${repositoryPath}/issues/${pullRequestNumber}/comments`,
        { method: 'POST', body: JSON.stringify({ body: fallbackBody }) },
      )
      return {
        id: mirrored.id,
        htmlUrl: mirrored.html_url,
        updatedAt: mirrored.updated_at,
        mode,
      }
    }
    try {
      mirrored = await githubRequest<GitHubReviewComment>(
        request,
        `${repositoryPath}/pulls/${pullRequestNumber}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            body,
            commit_id: pullRequest.head.sha,
            path: target.path,
            line: comment.anchor.endLine,
            side: 'RIGHT',
            ...(comment.anchor.startLine !== comment.anchor.endLine
              ? {
                  start_line: comment.anchor.startLine,
                  start_side: 'RIGHT',
                }
              : {}),
          }),
        },
      )
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error
      mode = 'conversation'
      const fallbackBody = formatPullRequestComment(comment, target, true)
      mirrored = await githubRequest<GitHubIssueComment>(
        request,
        `${repositoryPath}/issues/${pullRequestNumber}/comments`,
        { method: 'POST', body: JSON.stringify({ body: fallbackBody }) },
      )
    }
  } else {
    mirrored = await githubRequest<GitHubIssueComment>(
      request,
      `${repositoryPath}/issues/${pullRequestNumber}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
    )
  }

  if (mode === 'review' && (comment.githubCommentId || comment.resolved)) {
    await setReviewThreadResolution(
      request,
      target,
      pullRequestNumber,
      mirrored.id,
      comment.resolved,
    )
  }

  return {
    id: mirrored.id,
    htmlUrl: mirrored.html_url,
    updatedAt: mirrored.updated_at,
    mode,
  }
}

const stripMirrorMetadata = (body: string) => body
  .replace(/\n\n<sub>DeMystify (?:comment|reply) by .*?<\/sub>/g, '')
  .replace(/\n\n<!-- demystify-(?:comment|thread):.*? -->/g, '')
  .trim()

const toSyncedMessage = (
  comment: GitHubIssueComment | GitHubReviewComment,
  threadId: string,
  messageId: string,
  mode: 'conversation' | 'review',
) => ({
  id: messageId,
  threadId,
  authorId: `github:${comment.user?.id ?? comment.id}`,
  authorName: comment.user?.login ?? 'GitHub user',
  authorColor: '#0969da',
  body: stripMirrorMetadata(comment.body),
  createdAt: comment.created_at ?? comment.updated_at,
  github: {
    id: comment.id,
    htmlUrl: comment.html_url,
    updatedAt: comment.updated_at,
    mode,
  },
})

export const getRepositoryPullRequestCommentSync = async (
  request: Request,
  target: RepositoryWriteTarget,
  pullRequestNumber: number,
): Promise<RepositoryPullRequestCommentSync> => {
  const repositoryPath = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`
  const reviewComments = await listGitHubComments<GitHubReviewComment>(
    request,
    `${repositoryPath}/pulls/${pullRequestNumber}/comments`,
  )
  const issueComments = await listGitHubComments<GitHubIssueComment>(
    request,
    `${repositoryPath}/issues/${pullRequestNumber}/comments?sort=created&direction=asc`,
  )
  const roots = new Map<number, { threadId: string; mode: 'conversation' | 'review' }>()
  for (const comment of reviewComments) {
    const marker = comment.body.match(commentMarkerPattern)
    if (marker && !comment.in_reply_to_id) {
      roots.set(comment.id, { threadId: marker[1], mode: 'review' })
    }
  }
  for (const comment of issueComments) {
    const marker = comment.body.match(commentMarkerPattern)
    if (marker) roots.set(comment.id, { threadId: marker[1], mode: 'conversation' })
  }

  const messages: RepositoryPullRequestCommentSync['messages'] = []
  for (const comment of reviewComments) {
    if (!comment.in_reply_to_id) continue
    const root = roots.get(comment.in_reply_to_id)
    if (!root) continue
    const marker = comment.body.match(messageMarkerPattern)
    messages.push(toSyncedMessage(
      comment,
      root.threadId,
      marker?.[2] ?? `github-${comment.id}`,
      'review',
    ))
  }
  for (const comment of issueComments) {
    const marker = comment.body.match(messageMarkerPattern)
    if (marker) messages.push(toSyncedMessage(comment, marker[1], marker[2], 'conversation'))
  }

  const reviewThreads = await getReviewThreads(request, target, pullRequestNumber)
  const resolutions = reviewThreads.flatMap((thread) => {
    const root = thread.comments.nodes
      .map((comment) => comment.databaseId === null ? null : roots.get(comment.databaseId))
      .find((candidate) => candidate?.mode === 'review')
    return root ? [{ threadId: root.threadId, resolved: thread.isResolved }] : []
  })

  return { messages, resolutions }
}

export const upsertRepositoryPullRequestCommentReply = async (
  request: Request,
  target: RepositoryWriteTarget,
  pullRequestNumber: number,
  reply: RepositoryPullRequestCommentReplyInput,
): Promise<RepositoryPullRequestComment> => {
  const repositoryPath = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`
  const rootPath = reply.mode === 'review'
    ? `${repositoryPath}/pulls/comments/${reply.rootGitHubCommentId}`
    : `${repositoryPath}/issues/comments/${reply.rootGitHubCommentId}`
  const root = await githubRequest<GitHubIssueComment | GitHubReviewComment>(
    request,
    rootPath,
  )
  if (!root.body.includes(getCommentMarker(reply.threadId))) {
    throw new ApiError(409, 'The GitHub root comment does not belong to this thread.')
  }
  const expectedRootUrl = reply.mode === 'review'
    ? `/pulls/${pullRequestNumber}`
    : `/issues/${pullRequestNumber}`
  const actualRootUrl = reply.mode === 'review'
    ? (root as GitHubReviewComment).pull_request_url
    : root.issue_url
  if (!actualRootUrl?.endsWith(expectedRootUrl)) {
    throw new ApiError(409, 'The GitHub root comment belongs to a different pull request.')
  }

  const marker = getCommentMessageMarker(reply.threadId, reply.id)
  let existing: GitHubIssueComment | GitHubReviewComment | undefined
  if (reply.githubCommentId) {
    const candidate = await githubRequest<GitHubIssueComment | GitHubReviewComment>(
      request,
      reply.mode === 'review'
        ? `${repositoryPath}/pulls/comments/${reply.githubCommentId}`
        : `${repositoryPath}/issues/comments/${reply.githubCommentId}`,
    )
    if (!candidate.body.includes(marker)) {
      throw new ApiError(409, 'The GitHub reply does not belong to this thread message.')
    }
    existing = candidate
  }
  if (!existing) {
    const comments = reply.mode === 'review'
      ? await listGitHubComments<GitHubReviewComment>(
          request,
          `${repositoryPath}/pulls/${pullRequestNumber}/comments`,
        )
      : await listGitHubComments<GitHubIssueComment>(
          request,
          `${repositoryPath}/issues/${pullRequestNumber}/comments?sort=created&direction=desc`,
        )
    existing = comments.find((candidate) => candidate.body.includes(marker))
  }

  const body = [
    reply.body,
    `<sub>DeMystify reply by ${escapeHtml(reply.authorName)}</sub>`,
    marker,
  ].join('\n\n')
  const mirrored = existing?.body === body
    ? existing
    : await githubRequest<GitHubIssueComment | GitHubReviewComment>(
        request,
        existing
          ? reply.mode === 'review'
            ? `${repositoryPath}/pulls/comments/${existing.id}`
            : `${repositoryPath}/issues/comments/${existing.id}`
          : reply.mode === 'review'
            ? `${repositoryPath}/pulls/${pullRequestNumber}/comments`
            : `${repositoryPath}/issues/${pullRequestNumber}/comments`,
        {
          method: existing ? 'PATCH' : 'POST',
          body: JSON.stringify({
            body,
            ...(!existing && reply.mode === 'review'
              ? { in_reply_to: reply.rootGitHubCommentId }
              : {}),
          }),
        },
      )

  return {
    id: mirrored.id,
    htmlUrl: mirrored.html_url,
    updatedAt: mirrored.updated_at,
    mode: reply.mode,
  }
}

export const githubRouter = Router()

githubRouter.get('/config', (_request, response) => {
  const credentials = getCredentials()
  response.json({
    githubConfigured: Boolean(credentials),
    appSlug: credentials?.appSlug ?? null,
    installationUrl: credentials?.appSlug
      ? `https://github.com/apps/${credentials.appSlug}/installations/new`
      : null,
  })
})

githubRouter.get('/auth/session', (request, response) => {
  const credentials = getCredentials()
  response.json({
    githubConfigured: Boolean(credentials),
    appSlug: credentials?.appSlug ?? null,
    installationUrl: credentials?.appSlug
      ? `https://github.com/apps/${credentials.appSlug}/installations/new`
      : null,
    user: request.session.github?.user ?? null,
  })
})

githubRouter.get('/auth/github', (request, response) => {
  const credentials = getCredentials()
  if (!credentials) {
    throw new ApiError(503, 'GitHub App credentials have not been configured.')
  }

  const state = randomBytes(24).toString('hex')
  const returnTo = typeof request.query.returnTo === 'string' ? request.query.returnTo : '/'
  request.session.githubOAuthState = state
  request.session.githubReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'

  const authorizationUrl = new URL('https://github.com/login/oauth/authorize')
  authorizationUrl.searchParams.set('client_id', credentials.clientId)
  authorizationUrl.searchParams.set('redirect_uri', `${credentials.appUrl}/api/auth/github/callback`)
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('allow_signup', 'false')
  response.redirect(authorizationUrl.toString())
})

githubRouter.get('/auth/github/callback', async (request, response) => {
  const credentials = getCredentials()
  if (!credentials) throw new ApiError(503, 'GitHub App credentials are missing.')

  const code = readQueryString(request, 'code')
  const state = readQueryString(request, 'state')
  if (!request.session.githubOAuthState || state !== request.session.githubOAuthState) {
    throw new ApiError(400, 'GitHub returned an invalid OAuth state.')
  }

  delete request.session.githubOAuthState
  const token = await exchangeToken({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    redirect_uri: `${credentials.appUrl}/api/auth/github/callback`,
  })
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.access_token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!userResponse.ok) throw new ApiError(502, 'GitHub user lookup failed.')
  const user = (await userResponse.json()) as GitHubApiUser

  request.session.github = {
    accessToken: token.access_token as string,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : undefined,
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
    },
  }
  const returnTo = request.session.githubReturnTo ?? '/'
  delete request.session.githubReturnTo
  await saveSession(request)

  const destination = new URL(returnTo, `${credentials.appUrl}/`)
  destination.searchParams.set('github', 'connected')
  response.redirect(destination.toString())
})

githubRouter.post('/auth/logout', async (request, response) => {
  delete request.session.github
  await saveSession(request)
  response.status(204).end()
})

githubRouter.get('/github/repositories', async (request, response) => {
  const installationResponse = await githubRequest<{ installations: GitHubInstallation[] }>(
    request,
    '/user/installations?per_page=100',
  )
  const repositoryResponses = await Promise.all(
    installationResponse.installations.map((installation) =>
      githubRequest<{ repositories: GitHubRepository[] }>(
        request,
        `/user/installations/${installation.id}/repositories?per_page=100`,
      ),
    ),
  )
  const repositories = repositoryResponses
    .flatMap((result) => result.repositories)
    .filter((repository, index, all) =>
      all.findIndex((candidate) => candidate.id === repository.id) === index,
    )
    .sort((first, second) => first.full_name.localeCompare(second.full_name))
    .map((repository) => ({
      id: repository.id,
      name: repository.name,
      fullName: repository.full_name,
      owner: repository.owner.login,
      isFork: repository.fork,
      parentFullName: repository.parent?.full_name ?? null,
      private: repository.private,
      defaultBranch: repository.default_branch,
      canPush: repository.permissions?.push ?? false,
    }))

  response.json({ repositories })
})

githubRouter.get('/github/file', async (request, response) => {
  const owner = validateRepositoryPart(readQueryString(request, 'owner'), 'owner')
  const repository = validateRepositoryPart(readQueryString(request, 'repository'), 'repository')
  const path = validatePath(readQueryString(request, 'path'))
  const reference = validateBranch(readQueryString(request, 'ref'), 'ref')
  const file = await githubRequest<GitHubContentFile>(
    request,
    `/repos/${owner}/${repository}/contents/${encodeRepositoryPath(path)}?ref=${encodeURIComponent(reference)}`,
  )

  if (file.type !== 'file' || file.encoding !== 'base64' || !file.content) {
    throw new ApiError(422, 'The selected path is not a readable text file.')
  }

  response.json({
    path: file.path,
    sha: file.sha,
    content: Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'),
    htmlUrl: file.html_url,
  })
})

githubRouter.get('/github/contents', async (request, response) => {
  const owner = validateRepositoryPart(readQueryString(request, 'owner'), 'owner')
  const repository = validateRepositoryPart(readQueryString(request, 'repository'), 'repository')
  const path = typeof request.query.path === 'string' ? request.query.path.replace(/^\/+/, '') : ''
  const reference = validateBranch(readQueryString(request, 'ref'), 'ref')
  const suffix = path ? `/${encodeRepositoryPath(path)}` : ''
  const contents = await githubRequest<Array<GitHubContentFile | GitHubContentDirectory>>(
    request,
    `/repos/${owner}/${repository}/contents${suffix}?ref=${encodeURIComponent(reference)}`,
  )

  response.json({
    entries: contents
      .filter((entry) => entry.type === 'dir' || /\.(md|myst|txt)$/i.test(entry.name))
      .sort((first, second) => {
        if (first.type !== second.type) return first.type === 'dir' ? -1 : 1
        return first.name.localeCompare(second.name)
      })
      .map((entry) => ({
        type: entry.type,
        name: entry.name,
        path: entry.path,
        sha: entry.sha,
      })),
  })
})