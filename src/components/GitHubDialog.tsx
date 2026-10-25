import {
  ArrowLeft,
  Check,
  CircleUserRound,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  GitBranch,
  GitFork,
  GitPullRequest,
  LoaderCircle,
  LogOut,
  LockKeyhole,
  RefreshCw,
  Save,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { structuredPatch } from 'diff'
import type { ServerSaveStatus } from '../lib/collaborationDurability'
import {
  createPullRequest,
  getNewManuscriptRoomUrl,
  getRepositoryFileGitHubUrl,
  listRepositories,
  listRepositoryContents,
  loadRepositoryFile,
  type GitHubEntry,
  type GitHubRepository,
  type GitHubSession,
  type RepositoryBinding,
  type RoomReview,
} from '../lib/github'

interface GitHubDialogProps {
  open: boolean
  roomName: string
  documentTitle: string
  session: GitHubSession | null
  sessionLoading: boolean
  canManageRepository: boolean
  binding: RepositoryBinding | null
  review: RoomReview | null
  draftSource?: string
  draftSaveStatus?: ServerSaveStatus
  initialRepository?: string
  initialPath?: string
  onClose: () => void
  onOpenFile: (binding: RepositoryBinding, content: string) => Promise<void>
  onBindDraft: (binding: RepositoryBinding) => Promise<void>
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
  canManageRepository,
  binding,
  review,
  draftSource = '',
  draftSaveStatus = 'unconfirmed',
  initialRepository,
  initialPath,
  onClose,
  onOpenFile,
  onBindDraft,
  onSave,
  onDisconnect,
  onNotice,
}: GitHubDialogProps) => {
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null)
  const [selectedFullName, setSelectedFullName] = useState(binding?.fullName ?? initialRepository ?? '')
  const [directory, setDirectory] = useState(() => (binding?.path ?? initialPath ?? '').split('/').slice(0, -1).join('/'))
  const [entries, setEntries] = useState<GitHubEntry[] | null>(null)
  const [filePath, setFilePath] = useState(binding?.path ?? initialPath ?? 'manuscript.md')
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<{
    bindingKey: string
    draft: string
    sourceSha: string
    hunks: ReturnType<typeof structuredPatch>['hunks']
  } | null>(null)
  const comparisonRequest = useRef(0)
  const bindingKey = JSON.stringify(binding ? [roomName, binding.fullName, binding.path, binding.baseBranch, binding.branchName] : null)
  const currentComparison = comparison?.bindingKey === bindingKey ? comparison : null

  const selectedRepository = repositories?.find(
    (repository) => repository.fullName === selectedFullName,
  )
  const isLoadingRepositories = repositories === null
  const isLoadingDirectory = entries === null

  useEffect(() => {
    if (!open || !session?.user || !canManageRepository || binding) return
    let active = true
    listRepositories()
      .then((nextRepositories) => {
        if (!active) return
        setRepositories(nextRepositories)
        setSelectedFullName((current) =>
          nextRepositories.some((repository) => repository.fullName === current)
            ? current
            : initialRepository ? '' : (nextRepositories[0]?.fullName ?? ''),
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
  }, [binding, canManageRepository, initialRepository, open, session?.user])

  useEffect(() => {
    if (!open || !selectedRepository || binding) return
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
  }, [binding, directory, open, selectedRepository])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        comparisonRequest.current += 1
        setComparison(null)
        setError(null)
        setIsWorking(false)
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

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
    if (binding || !nextBinding) return
    setIsWorking(true)
    setError(null)
    try {
      const file = await loadRepositoryFile(nextBinding)
      await onOpenFile(nextBinding, file.content)
      onNotice(`Opened ${nextBinding.path} from GitHub`)
      onClose()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  const bindDraft = async () => {
    const nextBinding = makeBinding()
    if (binding || !nextBinding) return
    setIsWorking(true)
    setError(null)
    try {
      await onBindDraft(nextBinding)
      onNotice(`Draft linked to ${nextBinding.fullName}`)
      onClose()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
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
      const pullRequest = review ?? await createPullRequest(
          roomName,
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

  const compareSource = async () => {
    if (!binding) return
    const request = ++comparisonRequest.current
    setIsWorking(true)
    setError(null)
    try {
      const file = await loadRepositoryFile(binding)
      if (comparisonRequest.current !== request) return
      setComparison({
        bindingKey,
        draft: draftSource,
        sourceSha: file.sha,
        hunks: structuredPatch(binding.path, binding.path, file.content, draftSource, '', '', { context: 3 }).hunks,
      })
    } catch (requestError) {
      if (comparisonRequest.current === request) setError(getErrorMessage(requestError))
    } finally {
      if (comparisonRequest.current === request) setIsWorking(false)
    }
  }

  const saveSnapshot = async () => {
    setIsWorking(true)
    try {
      await onSave()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsWorking(false)
    }
  }

  const openNewRoom = (manuscript?: RepositoryBinding) => {
    window.open(getNewManuscriptRoomUrl(window.location.href, crypto.randomUUID(), manuscript),
      '_blank', 'noopener,noreferrer')
  }

  const closeDialog = () => {
    comparisonRequest.current += 1
    setComparison(null)
    setError(null)
    setIsWorking(false)
    onClose()
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
  const accountBar = session?.user ? (
    <div className="github-account-bar">
      <span className="github-user">
        {session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <CircleUserRound size={24} aria-hidden="true" />}
        <span><strong>{session.user.name ?? session.user.login}</strong><small>@{session.user.login}</small></span>
      </span>
      <span className="account-actions">
        {canManageRepository && session.installationUrl && (
          <a href={session.installationUrl} target="_blank" rel="noreferrer">Manage access <ExternalLink size={12} /></a>
        )}
        <button type="button" onClick={() => void disconnect()}><LogOut size={13} /> Disconnect</button>
      </span>
    </div>
  ) : null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeDialog}>
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
              <h2 id="github-dialog-title">
                {canManageRepository ? binding ? 'Manuscript versions' : 'GitHub repository' : 'GitHub identity'}
              </h2>
              <p>
                {canManageRepository
                  ? binding ? binding.fullName : 'Open a MyST file or publish this live draft to a review branch.'
                  : 'Use a verified name and avatar without granting repository access.'}
              </p>
            </div>
          </div>
          <button className="icon-button" type="button" title="Close GitHub dialog" onClick={closeDialog}>
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
            <h3>Connect your GitHub identity</h3>
            <p>
              {canManageRepository
                ? 'Repository actions remain limited to projects where you have write permission.'
                : 'Your GitHub name and handle will identify new comments and live suggestions. Signing in does not grant repository or publishing access.'}
            </p>
            <a className="button primary-button" href={connectUrl}>Continue with GitHub</a>
            {canManageRepository && session.installationUrl && (
              <a className="text-link" href={session.installationUrl} target="_blank" rel="noreferrer">
                Install the app on repositories <ExternalLink size={13} />
              </a>
            )}
          </div>
        ) : !canManageRepository ? (
          <div className="github-identity-state">
            {accountBar}
            <div className="github-identity-message">
              <span><Check size={18} /></span>
              <div>
                <strong>Identity connected</strong>
                <p>
                  New comments and live presence use this verified GitHub identity. Your room mode is unchanged; only a verified repository writer can publish to GitHub.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className={`github-dialog-body ${binding ? 'bound-manuscript' : ''}`}>
            {accountBar}

            {binding ? (
              <section className="manuscript-versions" aria-label="Manuscript versions">
                <dl>
                  <div><dt>Manuscript</dt><dd>{binding.path}</dd></div>
                  <div><dt>Room draft</dt><dd>{draftSaveStatus === 'saved' ? 'Saved to server' : draftSaveStatus === 'error' ? 'Server save failed' : 'Server save not confirmed'}</dd></div>
                  <div><dt>Source branch</dt><dd><GitBranch size={14} /> {binding.baseBranch}</dd></div>
                  <div><dt>Draft branch</dt><dd><GitBranch size={14} /> {binding.branchName}</dd></div>
                  <div><dt>Review</dt><dd>{review ? `PR #${review.number} (${review.state})` : 'No pull request'}</dd></div>
                </dl>
                <a className="text-link" href={getRepositoryFileGitHubUrl(binding, binding.baseBranch)} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> View source on GitHub
                </a>
                <div className="manuscript-version-actions">
                  <button className="button secondary-button" type="button" disabled={isWorking} onClick={() => void compareSource()}>
                    {isWorking ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                    {currentComparison ? 'Refresh comparison' : `Compare with ${binding.baseBranch}`}
                  </button>
                  <button className="button secondary-button" type="button" onClick={() => openNewRoom(binding)}>
                    <FilePlus2 size={14} /> Open source as new version
                  </button>
                </div>
                {currentComparison && <section className="manuscript-comparison" aria-label={`Comparison with ${binding.baseBranch}`}>
                  <header>
                    <h3>{currentComparison.hunks.length ? `Room differs from ${binding.baseBranch}` : `Room matches ${binding.baseBranch}`}</h3>
                    <span>Source {currentComparison.sourceSha.slice(0, 7)}</span>
                  </header>
                  {currentComparison.draft !== draftSource && <p role="status">The room draft changed. Refresh the comparison.</p>}
                  {currentComparison.hunks.length > 0 && <div className="version-diff-legend"><span>- {binding.baseBranch}</span><span>+ Room draft</span></div>}
                  {currentComparison.hunks.map((hunk) => <div className="version-diff-hunk" key={`${hunk.oldStart}:${hunk.newStart}`}>
                    <div className="version-diff-location">Source line {hunk.oldStart} / room line {hunk.newStart}</div>
                    <pre>{hunk.lines.map((line, index) => <code key={index} data-change={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context'}>{line}</code>)}</pre>
                  </div>)}
                </section>}
              </section>
            ) : <>
            <div className="repository-controls">
              <label>
                Repository
                <select
                  aria-label="Repository"
                  value={selectedFullName}
                  disabled={isLoadingRepositories}
                  onChange={(event) => {
                    setEntries(null)
                    setError(null)
                    setSelectedFullName(event.target.value)
                    setDirectory('')
                  }}
                >
                  <option value="" disabled>Select a repository</option>
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
            </>}

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
                  review ? <a className="button secondary-button" href={review.htmlUrl} target="_blank" rel="noreferrer"><GitPullRequest size={15} /> PR #{review.number}</a>
                    : <button className="button secondary-button" type="button" disabled={isWorking || binding.isFork} onClick={() => void openPullRequest()} title={binding.isFork ? 'Automatic pull requests are disabled for forks' : 'Create pull request'}>
                      <GitPullRequest size={15} /> Create draft PR
                    </button>
                )}
                {binding && <button className="button secondary-button" type="button" onClick={() => openNewRoom()}><FilePlus2 size={15} /> Open another manuscript</button>}
                {binding && <button className="button primary-button" type="button" disabled={isWorking} onClick={() => void saveSnapshot()}><Save size={15} /> Save snapshot</button>}
                {!binding && <><button className="button secondary-button" type="button" disabled={!selectedRepository || isWorking} onClick={() => void bindDraft()}>
                  Bind current draft
                </button>
                <button className="button primary-button" type="button" disabled={!selectedRepository || isWorking} onClick={() => void openFile()}>
                  {isWorking ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />}
                  Open file
                </button>
                </>}
              </div>
            </footer>
          </div>
        )}
      </section>
    </div>
  )
}