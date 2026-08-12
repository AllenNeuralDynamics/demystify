import { getBibliographyPath, type PaperSearchResult } from './references'

export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string
}

export interface GitHubSession {
  githubConfigured: boolean
  appSlug: string | null
  installationUrl: string | null
  user: GitHubUser | null
}

export interface GitHubRepository {
  id: number
  name: string
  fullName: string
  owner: string
  isFork: boolean
  parentFullName: string | null
  private: boolean
  defaultBranch: string
  canPush: boolean
}

export interface GitHubEntry {
  type: 'file' | 'dir'
  name: string
  path: string
  sha: string
}

export interface RepositoryProjectFile {
  content: string
  sha: string
  path: string
  htmlUrl: string
}

export interface RepositoryBinding {
  owner: string
  repository: string
  fullName: string
  isFork: boolean
  parentFullName: string | null
  path: string
  baseBranch: string
  branchName: string
}

const encodeRepositoryPath = (value: string) =>
  value.split('/').filter(Boolean).map(encodeURIComponent).join('/')

export const getRepositoryAssetBaseUrl = (binding: RepositoryBinding) => {
  const directory = binding.path.split('/').slice(0, -1).join('/')
  const suffix = directory ? `${encodeRepositoryPath(directory)}/` : ''
  return `https://raw.githubusercontent.com/${encodeURIComponent(binding.owner)}/${encodeURIComponent(binding.repository)}/refs/heads/${encodeRepositoryPath(binding.baseBranch)}/${suffix}`
}

export const getRepositoryGitHubUrl = (binding: RepositoryBinding) =>
  `https://github.com/${encodeURIComponent(binding.owner)}/${encodeURIComponent(binding.repository)}`

export const getRepositoryFileGitHubUrl = (
  binding: RepositoryBinding,
  reference: string,
) =>
  `${getRepositoryGitHubUrl(binding)}/blob/${encodeRepositoryPath(reference)}/${encodeRepositoryPath(binding.path)}`

export interface RoomReview {
  number: number
  htmlUrl: string
  title: string
  state: 'draft' | 'open' | 'closed' | 'merged'
  createdAt: string
  updatedAt: string
}

export interface PullRequestCommentMirror {
  id: number
  htmlUrl: string
  updatedAt: string
  mode: 'conversation' | 'review'
}

export interface PullRequestCommentSync {
  messages: Array<{
    id: string
    threadId: string
    authorId: string
    authorName: string
    authorColor: string
    body: string
    createdAt: string
    github: PullRequestCommentMirror
  }>
  resolutions: Array<{
    threadId: string
    resolved: boolean
  }>
}

export interface SnapshotResult {
  branchName: string
  commitSha: string
  commitUrl: string
  fileSha: string | null
  unchanged: boolean
  review: RoomReview | null
}

export interface ProjectConfigSnapshot {
  path: string
  content: string
}

export interface CollaborationRoom {
  roomName: string
  ownerId: number
  ownerLogin: string
  binding: RepositoryBinding | null
  review: RoomReview | null
  nextRoomName: string | null
  access: 'editor' | 'viewer' | 'collaborator'
  viewerLink: {
    createdAt: string
    expiresAt: string | null
  } | null
  collaboratorLink: {
    createdAt: string
    expiresAt: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export class GitHubApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const apiRequest = async <Result>(path: string, init?: RequestInit): Promise<Result> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const payload = (await response.json().catch(() => null)) as
    | (Result & { error?: string })
    | null
  if (!response.ok) {
    throw new GitHubApiError(response.status, payload?.error ?? 'The GitHub request failed.')
  }
  return payload as Result
}

export const getGitHubSession = () => apiRequest<GitHubSession>('/api/auth/session')

export const claimCollaborationRoom = (roomName: string) =>
  apiRequest<CollaborationRoom>(`/api/rooms/${encodeURIComponent(roomName)}/claim`, {
    method: 'POST',
  })

export type AnonymousShareRole = 'viewer' | 'collaborator'

export const activateShareSession = async (
  roomName: string,
  token: string,
  role: AnonymousShareRole,
) => {
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomName)}/${role}-session`,
    {
      method: 'POST',
      headers: { 'X-Demystify-Share-Token': token },
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new GitHubApiError(
      response.status,
      payload?.error ?? 'This sharing link is invalid or expired.',
    )
  }
}

export const createShareLink = (
  roomName: string,
  expiresInDays: number | null,
  role: AnonymousShareRole,
) =>
  apiRequest<{
    token: string
    link: NonNullable<CollaborationRoom['viewerLink']>
  }>(`/api/rooms/${encodeURIComponent(roomName)}/${role}-links`, {
    method: 'POST',
    body: JSON.stringify({ expiresInDays }),
  })

export const revokeShareLink = async (
  roomName: string,
  role: AnonymousShareRole,
) => {
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomName)}/${role}-links`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new GitHubApiError(
      response.status,
      payload?.error ?? `The ${role} link could not be revoked.`,
    )
  }
}

export const bindCollaborationRoom = (
  roomName: string,
  binding: RepositoryBinding,
) =>
  apiRequest<CollaborationRoom>(
    `/api/rooms/${encodeURIComponent(roomName)}/binding`,
    {
      method: 'PUT',
      body: JSON.stringify({
        owner: binding.owner,
        repository: binding.repository,
        path: binding.path,
      }),
    },
  )

export const startRoomRevision = (roomName: string) =>
  apiRequest<CollaborationRoom>(
    `/api/rooms/${encodeURIComponent(roomName)}/revisions`,
    { method: 'POST' },
  )

export const disconnectGitHub = async () => {
  const response = await fetch('/api/auth/logout', { method: 'POST' })
  if (!response.ok) throw new GitHubApiError(response.status, 'Could not disconnect GitHub.')
}

export const listRepositories = async () => {
  const result = await apiRequest<{ repositories: GitHubRepository[] }>(
    '/api/github/repositories',
  )
  return result.repositories
}

export const listRepositoryContents = async (
  repository: GitHubRepository,
  path: string,
) => {
  const query = new URLSearchParams({
    owner: repository.owner,
    repository: repository.name,
    path,
    ref: repository.defaultBranch,
  })
  const result = await apiRequest<{ entries: GitHubEntry[] }>(
    `/api/github/contents?${query}`,
  )
  return result.entries
}

export const loadRepositoryFile = async (binding: RepositoryBinding) => {
  const query = new URLSearchParams({
    owner: binding.owner,
    repository: binding.repository,
    path: binding.path,
    ref: binding.baseBranch,
  })
  return apiRequest<{ content: string; sha: string; path: string; htmlUrl: string }>(
    `/api/github/file?${query}`,
  )
}

export const loadRepositoryBibliography = async (
  binding: RepositoryBinding,
  path = getBibliographyPath(binding.path),
) => {
  try {
    const file = await loadRepositoryFile({ ...binding, path })
    return { ...file, exists: true }
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return { content: '', sha: null, path, htmlUrl: null, exists: false }
    }
    throw error
  }
}

export const loadRepositoryMystConfig = async (binding: RepositoryBinding) => {
  const query = new URLSearchParams({
    owner: binding.owner,
    repository: binding.repository,
    path: binding.path,
    ref: binding.baseBranch,
  })
  return apiRequest<{
    content: string
    sha: string | null
    path: string
    htmlUrl: string | null
    exists: boolean
  }>(`/api/github/myst-config?${query}`)
}

export const loadRepositoryProjectFiles = async (binding: RepositoryBinding) => {
  const query = new URLSearchParams({
    owner: binding.owner,
    repository: binding.repository,
    path: binding.path,
    ref: binding.baseBranch,
  })
  return apiRequest<{
    config: {
      content: string
      sha: string | null
      path: string
      htmlUrl: string | null
      exists: boolean
    }
    files: RepositoryProjectFile[]
    missing: string[]
    bibliographyPaths: string[]
  }>(`/api/github/project-files?${query}`)
}

export const createSnapshot = (
  roomName: string,
  content: string,
  bibliography?: string | ProjectConfigSnapshot,
  mystConfig?: ProjectConfigSnapshot,
  projectFiles?: ProjectConfigSnapshot[],
) =>
  apiRequest<SnapshotResult>(`/api/rooms/${encodeURIComponent(roomName)}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      ...(bibliography === undefined ? {} : { bibliography }),
      ...(mystConfig === undefined ? {} : { mystConfig }),
      ...(projectFiles?.length ? { projectFiles } : {}),
    }),
  })

export const searchPapers = async (roomName: string, query: string) => {
  const parameters = new URLSearchParams({ q: query })
  const result = await apiRequest<{ results: PaperSearchResult[] }>(
    `/api/rooms/${encodeURIComponent(roomName)}/citations/search?${parameters}`,
  )
  return result.results
}

export const createPullRequest = (roomName: string, title: string) =>
  apiRequest<RoomReview>(
    `/api/rooms/${encodeURIComponent(roomName)}/pull-requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
      }),
    },
  )

export const mirrorRoomComment = (
  roomName: string,
  comment: {
    id: string
    githubCommentId?: number
    githubMode?: 'conversation' | 'review'
    authorName: string
    body: string
    resolved: boolean
    suggestion?: {
      kind: 'insert' | 'delete' | 'replace'
      before: string
      after: string
      status: 'pending' | 'accepted' | 'rejected' | 'conflicted'
      decidedAt?: string
      decidedByName?: string
    }
    anchor?: {
      startLine: number
      endLine: number
      quote: string
    }
  },
) =>
  apiRequest<PullRequestCommentMirror>(
    `/api/rooms/${encodeURIComponent(roomName)}/comments/${encodeURIComponent(comment.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        githubCommentId: comment.githubCommentId,
        githubMode: comment.githubMode,
        authorName: comment.authorName,
        body: comment.body,
        resolved: comment.resolved,
        suggestion: comment.suggestion,
        anchor: comment.anchor,
      }),
    },
  )

export const mirrorRoomCommentReply = (
  roomName: string,
  threadId: string,
  message: {
    id: string
    githubCommentId?: number
    rootGitHubCommentId: number
    mode: 'conversation' | 'review'
    authorName: string
    body: string
  },
) =>
  apiRequest<PullRequestCommentMirror>(
    `/api/rooms/${encodeURIComponent(roomName)}/comments/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(message.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(message),
    },
  )

export const syncRoomComments = (roomName: string) =>
  apiRequest<PullRequestCommentSync>(
    `/api/rooms/${encodeURIComponent(roomName)}/comments/sync`,
  )