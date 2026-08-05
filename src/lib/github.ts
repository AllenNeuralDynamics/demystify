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

export interface SnapshotResult {
  branchName: string
  commitSha: string
  commitUrl: string
  fileSha: string | null
  unchanged: boolean
}

export interface CollaborationRoom {
  roomName: string
  ownerId: number
  ownerLogin: string
  binding: RepositoryBinding | null
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

export const createSnapshot = (roomName: string, content: string) =>
  apiRequest<SnapshotResult>(`/api/rooms/${encodeURIComponent(roomName)}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({
      content,
    }),
  })

export const createPullRequest = (roomName: string, title: string) =>
  apiRequest<{ number: number; htmlUrl: string; title: string }>(
    `/api/rooms/${encodeURIComponent(roomName)}/pull-requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
      }),
    },
  )