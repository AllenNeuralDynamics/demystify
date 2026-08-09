// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubSession } from '../lib/github'
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

const renderDialog = async (session: GitHubSession) => {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <GitHubDialog
        open
        roomName="identity-test-room"
        documentTitle="Identity test"
        session={session}
        sessionLoading={false}
        canManageRepository={false}
        binding={null}
        review={null}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        onBindDraft={vi.fn()}
        onSave={vi.fn()}
        onDisconnect={vi.fn()}
        onNotice={vi.fn()}
      />,
    )
  })
  return { container, root }
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
})