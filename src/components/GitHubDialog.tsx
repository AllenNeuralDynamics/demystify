import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Folder,
  GitFork,
  GitPullRequest,
  LoaderCircle,
  LogOut,
  LockKeyhole,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createPullRequest,
  listRepositories,
  listRepositoryContents,
  loadRepositoryFile,
  type GitHubEntry,
  type GitHubRepository,
  type GitHubSession,
  type RepositoryBinding,
} from '../lib/github'

interface GitHubDialogProps {
  open: boolean
  roomName: string
  documentTitle: string
  session: GitHubSession | null
  sessionLoading: boolean
  binding: RepositoryBinding | null
  onClose: () => void
  onOpenFile: (binding: RepositoryBinding, content: string) => void
  onBindDraft: (binding: RepositoryBinding) => void
  onSave: () => Promise<boolean>
  onDisconnect: () => Promise<void>
  onNotice: (message: string) => void
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The GitHub request failed.'

export const GitHubDialog = ({
  open,
  roomName,
  documentTitle,
  session,
  sessionLoading,
  binding,
  onClose,
  onOpenFile,
  onBindDraft,
  onSave,
  onDisconnect,
  onNotice,
}: GitHubDialogProps) => {
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null)
  const [selectedFullName, setSelectedFullName] = useState(binding?.fullName ?? '')
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<GitHubEntry[] | null>(null)
  const [filePath, setFilePath] = useState(binding?.path ?? 'manuscript.md')
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedRepository = repositories?.find(
    (repository) => repository.fullName === selectedFullName,
  )
  const isLoadingRepositories = repositories === null
  const isLoadingDirectory = entries === null

  useEffect(() => {
    if (!open || !session?.user) return
    let active = true
    listRepositories()
      .then((nextRepositories) => {
        if (!active) return
        setRepositories(nextRepositories)
        setSelectedFullName((current) =>
          nextRepositories.some((repository) => repository.fullName === current)
            ? current
            : (nextRepositories[0]?.fullName ?? ''),
        )
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setRepositories([])
        setError(getErrorMessage(requestError))
      })
    return () => {
      active = false
    }
  }, [open, session?.user])

  useEffect(() => {
    if (!open || !selectedRepository) return
    let active = true
    listRepositoryContents(selectedRepository, directory)
      .then((nextEntries) => {
        if (active) setEntries(nextEntries)
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setEntries([])
        setError(getErrorMessage(requestError))
      })
    return () => {
      active = false
    }
  }, [directory, open, selectedRepository])

  if (!open) return null

  const makeBinding = (): RepositoryBinding | null => {
    if (!selectedRepository || !filePath.trim()) return null
    const existingBranch =
      binding?.fullName === selectedRepository.fullName ? binding.branchName : null
    return {
      owner: selectedRepository.owner,
      repository: selectedRepository.name,
      fullName: selectedRepository.fullName,
      isFork: selectedRepository.isFork,
      parentFullName: selectedRepository.parentFullName,
      path: filePath.trim().replace(/^\/+/, ''),
      baseBranch: selectedRepository.defaultBranch,
      branchName: existingBranch ?? `demystify/${roomName.slice(0, 12)}`,
    }
  }

  const openFile = async () => {
    const nextBinding = makeBinding()
    if (!nextBinding) return
    setIsWorking(true)
    setError(null)
    try {
      const file = await loadRepositoryFile(nextBinding)
      onOpenFile(nextBinding, file.content)
      onNotice(`Opened ${nextBinding.path} from GitHub`)
      onClose()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  const bindDraft = () => {
    const nextBinding = makeBinding()
    if (!nextBinding) return
    onBindDraft(nextBinding)
    onNotice(`Draft linked to ${nextBinding.fullName}`)
    onClose()
  }

  const openPullRequest = async () => {
    if (!binding) return
    if (binding.isFork) {
      setError(
        `Pull requests are disabled for this fork because GitHub may target ${binding.parentFullName ?? 'its parent repository'}. Use a standalone test repository or create the PR manually after checking the base repository.`,
      )
      return
    }
    setIsWorking(true)
    setError(null)
    try {
      if (!(await onSave())) return
      const pullRequest = await createPullRequest(
        binding,
        `Update ${documentTitle}`,
      )
      window.open(pullRequest.htmlUrl, '_blank', 'noopener,noreferrer')
      onNotice(`Pull request #${pullRequest.number} is ready`)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  const moveUp = () => {
    const parts = directory.split('/').filter(Boolean)
    parts.pop()
    setEntries(null)
    setError(null)
    setDirectory(parts.join('/'))
  }

  const disconnect = async () => {
    setError(null)
    try {
      await onDisconnect()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  const connectUrl = `/api/auth/github?returnTo=${encodeURIComponent(
    `${window.location.pathname}${window.location.search}`,
  )}`

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="github-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="github-dialog-header">
          <div className="dialog-title-group">
            <span className="dialog-icon"><GitFork size={20} /></span>
            <div>
              <h2 id="github-dialog-title">GitHub repository</h2>
              <p>Open a MyST file or publish this live draft to a review branch.</p>
            </div>
          </div>
          <button className="icon-button" type="button" title="Close GitHub dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {sessionLoading ? (
          <div className="github-dialog-loading"><LoaderCircle size={20} /> Checking GitHub session...</div>
        ) : !session?.githubConfigured ? (
          <div className="github-setup">
            <span className="setup-kicker">One-time server setup</span>
            <h3>Add your GitHub App credentials</h3>
            <p>
              Create a GitHub App with read/write access to Contents and Pull requests,
              then add its credentials to <code>.env</code>. Tokens stay in the server session
              and are never sent to the editor.
            </p>
            <div className="env-list">
              <code>GITHUB_CLIENT_ID</code>
              <code>GITHUB_CLIENT_SECRET</code>
              <code>GITHUB_APP_SLUG</code>
              <code>SESSION_SECRET</code>
            </div>
            <p className="callback-copy">
              Callback URL: <code>{window.location.origin}/api/auth/github/callback</code>
            </p>
          </div>
        ) : !session.user ? (
          <div className="github-connect-state">
            <GitFork size={28} />
            <h3>Connect your GitHub account</h3>
            <p>Access is limited to repositories where this GitHub App is installed.</p>
            <a className="button primary-button" href={connectUrl}>Continue with GitHub</a>
            {session.installationUrl && (
              <a className="text-link" href={session.installationUrl} target="_blank" rel="noreferrer">
                Install the app on repositories <ExternalLink size={13} />
              </a>
            )}
          </div>
        ) : (
          <div className="github-dialog-body">
            <div className="github-account-bar">
              <span className="github-user">
                <img src={session.user.avatarUrl} alt="" />
                <span><strong>{session.user.name ?? session.user.login}</strong><small>@{session.user.login}</small></span>
              </span>
              <span className="account-actions">
                {session.installationUrl && (
                  <a href={session.installationUrl} target="_blank" rel="noreferrer">Manage access <ExternalLink size={12} /></a>
                )}
                <button type="button" onClick={() => void disconnect()}><LogOut size={13} /> Disconnect</button>
              </span>
            </div>

            <div className="repository-controls">
              <label>
                Repository
                <select
                  value={selectedFullName}
                  disabled={isLoadingRepositories}
                  onChange={(event) => {
                    setEntries(null)
                    setError(null)
                    setSelectedFullName(event.target.value)
                    setDirectory('')
                  }}
                >
                  {(repositories ?? []).map((repository) => (
                    <option key={repository.id} value={repository.fullName}>
                      {repository.fullName}{repository.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Manuscript path
                <input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="paper/manuscript.md" />
              </label>
            </div>

            <div className="repo-browser">
              <div className="browser-heading">
                <button type="button" disabled={!directory} onClick={moveUp} title="Parent directory"><ArrowLeft size={15} /></button>
                <span>/{directory}</span>
                {isLoadingDirectory && <LoaderCircle className="spin" size={15} />}
              </div>
              <div className="browser-entries">
                {entries?.length === 0 && !isLoadingDirectory ? (
                  <span className="browser-empty">No MyST or Markdown files in this directory.</span>
                ) : (entries ?? []).map((entry) => (
                  <button
                    type="button"
                    key={entry.sha}
                    className={entry.path === filePath ? 'selected' : ''}
                    onClick={() => {
                      if (entry.type === 'dir') {
                        setEntries(null)
                        setError(null)
                        setDirectory(entry.path)
                      } else {
                        setFilePath(entry.path)
                      }
                    }}
                  >
                    {entry.type === 'dir' ? <Folder size={15} /> : <FileText size={15} />}
                    <span>{entry.name}</span>
                    {entry.path === filePath && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="github-error" role="alert">{error}</div>}

            {binding?.isFork && (
              <div className="github-warning" role="status">
                This binding is a fork of {binding.parentFullName ?? 'another repository'}.
                Snapshots stay in this fork, but automatic pull requests are disabled to prevent
                accidentally targeting the parent repository.
              </div>
            )}

            <footer className="github-dialog-footer">
              <span className="permission-note"><LockKeyhole size={13} /> GitHub App permissions apply</span>
              <div>
                {binding && (
                  <button className="button secondary-button" type="button" disabled={isWorking || binding.isFork} onClick={() => void openPullRequest()} title={binding.isFork ? 'Automatic pull requests are disabled for forks' : 'Create pull request'}>
                    <GitPullRequest size={15} /> Pull request
                  </button>
                )}
                <button className="button secondary-button" type="button" disabled={!selectedRepository || isWorking} onClick={bindDraft}>
                  Bind current draft
                </button>
                <button className="button primary-button" type="button" disabled={!selectedRepository || isWorking} onClick={() => void openFile()}>
                  {isWorking ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />}
                  Open file
                </button>
              </div>
            </footer>
          </div>
        )}
      </section>
    </div>
  )
}