export interface VersionAuthor {
  id: string
  name: string
}

export interface DocumentVersion {
  id: string
  sequence: number
  name: string | null
  createdAt: string
  kind: 'automatic' | 'named' | 'safety' | 'restore' | 'github'
  authors: VersionAuthor[]
  restoredFrom?: string
  gitCommit?: string
}

export interface DocumentSnapshot {
  format: 1
  content: string
  workingContent: string
  bibliography: string
  mystConfig: string
  projectFiles: Array<[string, string]>
  references: Array<[string, unknown]>
  contributors: Array<[string, unknown]>
  metadata: Array<[string, unknown]>
}

export interface VersionPage {
  versions: DocumentVersion[]
  nextCursor: number | null
  revision: string
}

export interface VersionPreview {
  version: DocumentVersion
  snapshot: DocumentSnapshot
  current: DocumentSnapshot
  revision: string
}
