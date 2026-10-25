// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubSession, RepositoryBinding, RoomReview } from '../lib/github'
import { GitHubDialog } from './GitHubDialog'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const disconnectedSession: GitHubSession = {
  githubConfigured: true,
  appSlug: 'demystify-test',
  installationUrl: 'https://github.com/apps/demystify-test/installations/new',
  user: null,
}

const renderDialog = async (session: GitHubSession, options: {
  binding?: RepositoryBinding
  canManageRepository?: boolean
  draftSource?: string
  review?: RoomReview
} = {}) => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const onClose = vi.fn()
  const onOpenFile = vi.fn()
  const onBindDraft = vi.fn()
  const onSave = vi.fn()
  await act(async () => {
    root.render(
      <GitHubDialog
        open
        roomName="identity-test-room"
        documentTitle="Identity test"
        session={session}
        sessionLoading={false}
        canManageRepository={options.canManageRepository ?? false}
        binding={options.binding ?? null}
        review={options.review ?? null}
        draftSource={options.draftSource ?? ''}
        onClose={onClose}
        onOpenFile={onOpenFile}
        onBindDraft={onBindDraft}
        onSave={onSave}
        onDisconnect={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
  })
  return { container, root, onClose, onOpenFile, onBindDraft, onSave }
}

describe('GitHubDialog identity mode', () => {
  it('offers GitHub authentication without requiring repository access', async () => {
    const { container, root } = await renderDialog(disconnectedSession)

    expect(container.textContent).toContain('GitHub identity')
    expect(container.textContent).toContain('does not grant repository or publishing access')
    const connect = container.querySelector<HTMLAnchorElement>('a[href^="/api/auth/github"]')
    expect(connect?.textContent).toContain('Continue with GitHub')
    expect(container.textContent).not.toContain('Install the app on repositories')

    await act(async () => root.unmount())
  })

  it('shows the verified identity without repository publishing controls', async () => {
    const { container, root } = await renderDialog({
      ...disconnectedSession,
      user: {
        id: 42,
        login: 'researcher',
        name: 'Ada Researcher',
        avatarUrl: 'https://avatars.example/researcher.png',
      },
    })

    expect(container.textContent).toContain('Identity connected')
    expect(container.textContent).toContain('@researcher')
    expect(container.textContent).toContain('only a verified repository writer can publish')
    expect(container.querySelector('.repository-controls')).toBeNull()

    await act(async () => root.unmount())
  })

  it('closes on Escape', async () => {
    const { onClose, root } = await renderDialog(disconnectedSession)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})

describe('GitHubDialog bound manuscripts', () => {
  it.each(['https://avatars.example/researcher.png', ''])('shows bound branches without an empty avatar request: %s', async (avatarUrl) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected repository import'))
    const binding: RepositoryBinding = {
      owner: 'research', repository: 'paper', fullName: 'research/paper',
      isFork: false, parentFullName: null, path: 'paper/index.md',
      baseBranch: 'main', branchName: 'demystify/current-room',
    }
    const { container, root } = await renderDialog({
      ...disconnectedSession,
      user: { id: 42, login: 'researcher', name: 'Ada', avatarUrl },
    }, { binding, canManageRepository: true })

    expect(container.textContent).toContain('Manuscript versions')
    expect(container.textContent).toContain('Source branch main')
    expect(container.textContent).toContain('Draft branch demystify/current-room')
    expect(container.textContent).toContain('paper/index.md')
    expect(container.querySelector('.repository-controls')).toBeNull()
    expect(container.querySelector('.repo-browser')).toBeNull()
    expect(container.querySelector('img[src=""]')).toBeNull()
    expect(container.querySelector('.github-user img') !== null).toBe(Boolean(avatarUrl))
    expect(container.textContent).not.toContain('Bind current draft')
    expect(fetch).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    fetch.mockRestore()
  })

  it('compares the source branch without rebinding, publishing or changing the draft', async () => {
    const binding: RepositoryBinding = {
      owner: 'research', repository: 'paper', fullName: 'research/paper',
      isFork: false, parentFullName: null, path: 'paper/index.md',
      baseBranch: 'main', branchName: 'demystify/current-room',
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      content: '# Paper\n\nSource paragraph.\n', sha: 'source-sha', path: binding.path,
      htmlUrl: 'https://github.com/research/paper/blob/main/paper/index.md',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { container, root, onBindDraft, onOpenFile, onSave } = await renderDialog({
      ...disconnectedSession,
      user: { id: 42, login: 'researcher', name: 'Ada', avatarUrl: 'https://avatars.example/researcher.png' },
    }, { binding, canManageRepository: true, draftSource: '# Paper\n\nRoom paragraph.\n' })
    const compare = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Compare with main'))!
    await act(async () => compare.click())

    expect(container.textContent).toContain('Room differs from main')
    expect(container.textContent).toContain('-Source paragraph.')
    expect(container.textContent).toContain('+Room paragraph.')
    expect(String(fetch.mock.calls[0][0])).toContain('ref=main')
    expect(onBindDraft).not.toHaveBeenCalled()
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    fetch.mockRestore()
  })

  it('opens another manuscript in a separate room and leaves this room untouched', async () => {
    const binding: RepositoryBinding = {
      owner: 'research', repository: 'paper', fullName: 'research/paper',
      isFork: false, parentFullName: null, path: 'paper/index.md',
      baseBranch: 'main', branchName: 'demystify/current-room',
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { container, root, onBindDraft, onOpenFile, onClose } = await renderDialog({
      ...disconnectedSession,
      user: { id: 42, login: 'researcher', name: 'Ada', avatarUrl: 'https://avatars.example/researcher.png' },
    }, { binding, canManageRepository: true })
    const another = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Open another manuscript'))!
    await act(async () => another.click())
    const url = new URL(String(open.mock.calls[0][0]))
    expect(url.searchParams.get('doc')).not.toBe('identity-test-room')
    expect(url.searchParams.get('import')).toBe('github')
    expect(open.mock.calls[0].slice(1)).toEqual(['_blank', 'noopener,noreferrer'])
    expect(onBindDraft).not.toHaveBeenCalled()
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    open.mockRestore()
  })

  it('links to an existing PR without silently saving a new snapshot', async () => {
    const binding: RepositoryBinding = {
      owner: 'research', repository: 'paper', fullName: 'research/paper',
      isFork: false, parentFullName: null, path: 'paper/index.md',
      baseBranch: 'main', branchName: 'demystify/current-room',
    }
    const { container, root, onSave } = await renderDialog({
      ...disconnectedSession,
      user: { id: 42, login: 'researcher', name: 'Ada', avatarUrl: 'https://avatars.example/researcher.png' },
    }, { binding, canManageRepository: true, review: {
      number: 12, htmlUrl: 'https://github.com/research/paper/pull/12', title: 'Paper update',
      state: 'draft', createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T11:00:00Z',
    } })
    expect(container.querySelector<HTMLAnchorElement>('a[href$="/pull/12"]')?.textContent).toContain('PR #12')
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('ignores a comparison response that arrives after the dialog closes', async () => {
    const binding: RepositoryBinding = {
      owner: 'research', repository: 'paper', fullName: 'research/paper',
      isFork: false, parentFullName: null, path: 'paper/index.md',
      baseBranch: 'main', branchName: 'demystify/current-room',
    }
    let finish!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((resolve) => { finish = resolve }))
    const { container, root, onClose } = await renderDialog({
      ...disconnectedSession,
      user: { id: 42, login: 'researcher', name: 'Ada', avatarUrl: 'https://avatars.example/researcher.png' },
    }, { binding, canManageRepository: true, draftSource: '# Draft\n' })
    const compare = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Compare with main'))!
    await act(async () => compare.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Close GitHub dialog"]')!.click())
    await act(async () => finish(new Response(JSON.stringify({ content: '# Source\n', sha: 'source-sha' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })))
    expect(onClose).toHaveBeenCalledOnce()
    expect(container.querySelector('.manuscript-comparison')).toBeNull()
    await act(async () => root.unmount())
    fetch.mockRestore()
  })
})