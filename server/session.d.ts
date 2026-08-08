import 'express-session'

interface GitHubSessionUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string
}

interface GitHubSessionAuth {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  user: GitHubSessionUser
}

declare module 'express-session' {
  interface SessionData {
    githubOAuthState?: string
    githubReturnTo?: string
    github?: GitHubSessionAuth
    viewerRooms?: Record<string, {
      shareId: string
      expiresAt: string | null
      role?: 'viewer' | 'collaborator'
    }>
  }
}

export {}