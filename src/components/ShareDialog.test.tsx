// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { CollaborationRoom } from '../lib/github'
import { ShareDialog } from './ShareDialog'

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true

const room: CollaborationRoom = {
  roomName: 'share-role-test',
  ownerId: 42,
  ownerLogin: 'maintainer',
  binding: null,
  review: null,
  nextRoomName: null,
  access: 'editor',
  actorId: 'github:42',
  ownedActorIds: ['github:42'],
  viewerLink: null,
  collaboratorLink: null,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
}

describe('ShareDialog', () => {
  it('presents maintainer, suggestion, and viewer modes with safe links', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ShareDialog
          open
          roomName={room.roomName}
          room={room}
          canManageLinks
          onClose={vi.fn()}
          onRoomRefresh={vi.fn(async () => room)}
          onNotice={vi.fn()}
        />,
      )
    })

    const roleNames = Array.from(container.querySelectorAll('.share-access-copy > strong'))
      .map((element) => element.textContent)
    expect(roleNames).toEqual(['Maintainer', 'Suggestion mode', 'Viewer'])
    expect(container.textContent).toContain('The link grants no authority by itself')
    expect(container.textContent).toContain('coedit one live working manuscript in Source or Visual')
    expect(container.textContent).toContain('only when a maintainer accepts the checkpoint')
    expect(container.textContent).toContain('only maintainers submit to GitHub')
    expect(container.textContent).toContain('Editing and publishing are disabled')
    expect(container.querySelector('[aria-label="Maintainer link"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Suggestion link expiration"]')).not.toBeNull()
    expect(container.textContent).toContain('Create suggestion link')

    await act(async () => root.unmount())
  })

  it('closes on Escape', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <ShareDialog
          open
          roomName={room.roomName}
          room={room}
          canManageLinks
          onClose={onClose}
          onRoomRefresh={vi.fn(async () => room)}
          onNotice={vi.fn()}
        />,
      )
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})