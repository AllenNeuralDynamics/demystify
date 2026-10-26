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
  it('hides an expired cached invitation even when its capability still matches', async () => {
    sessionStorage.clear()
    const linkedRoom = { ...room, collaboratorLink: { id: 'expired-capability', createdAt: '1999-01-01T00:00:00.000Z', expiresAt: '2000-01-01T00:00:00.000Z' } }
    sessionStorage.setItem(`demystify.share-links:${JSON.stringify([room.roomName, room.ownerId])}`, JSON.stringify({
      collaborator: { url: `${location.origin}/?doc=${room.roomName}#collaborate=${'t'.repeat(43)}`,
        fingerprint: 'expired-capability', confirmedAt: linkedRoom.collaboratorLink.createdAt, expiresAt: linkedRoom.collaboratorLink.expiresAt },
    }))
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ShareDialog open roomName={room.roomName} room={linkedRoom} canManageLinks
        onClose={vi.fn()} onRoomRefresh={vi.fn(async () => linkedRoom)} onNotice={vi.fn()} />))
      expect(container.querySelector('[aria-label="Suggestion link"]')).toBeNull()
      expect(container.textContent).toContain('Expired')
    } finally { await act(async () => root.unmount()); sessionStorage.clear() }
  })

  it('retains an owner-created URL across reopening and remount, but invalidates replaced or revoked links', async () => {
    const container = document.createElement('div')
    let root = createRoot(container)
    sessionStorage.clear()
    const token = 't'.repeat(43)
    let currentRoom = room
    const linkedRoom = { ...room, updatedAt: '2026-10-26T00:00:00.000Z', collaboratorLink: { id: 'suggestion-capability', createdAt: '2026-10-26T00:00:00.000Z', expiresAt: null } }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...linkedRoom, link: linkedRoom.collaboratorLink, token }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }))
    const render = (open: boolean) => act(async () => {
      root.render(<ShareDialog open={open} roomName={room.roomName} room={currentRoom} canManageLinks onClose={vi.fn()}
        onRoomRefresh={async () => { currentRoom = linkedRoom; return currentRoom }} onNotice={vi.fn()} />)
    })
    try {
      await render(true)
      await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Create suggestion link'))!.click())
      const created = container.querySelector<HTMLInputElement>('[aria-label="Suggestion link"]')!.value
      expect(created).toContain('#collaborate=')
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Close share dialog"]')!.click())
      await render(false)
      await render(true)
      expect(container.querySelector<HTMLInputElement>('[aria-label="Suggestion link"]')?.value).toBe(created)
      await act(async () => root.unmount())
      root = createRoot(container)
      await render(true)
      expect(container.querySelector<HTMLInputElement>('[aria-label="Suggestion link"]')?.value).toBe(created)
      currentRoom = { ...linkedRoom, updatedAt: '2026-10-26T00:00:01.000Z',
        collaboratorLink: { id: 'replacement-capability', createdAt: '2026-10-26T00:00:01.000Z', expiresAt: null } }
      await render(true)
      expect(container.querySelector('[aria-label="Suggestion link"]')).toBeNull()
      expect(container.textContent).toContain('Active link URL unavailable in this tab')
      currentRoom = { ...currentRoom, collaboratorLink: null }
      await render(true)
      expect(container.querySelector('[aria-label="Suggestion link"]')).toBeNull()
      currentRoom = { ...linkedRoom, ownerId: 99 }
      await render(true)
      expect(container.querySelector('[aria-label="Suggestion link"]')).toBeNull()
    } finally { await act(async () => root.unmount()); fetch.mockRestore(); sessionStorage.clear() }
  })

  it('shows a normal room URL to suggestion participants without invitation-management controls', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const guest = { ...room, access: 'collaborator' as const, actorId: 'share:guest', viewerLink: null, collaboratorLink: null }
    await act(async () => root.render(<ShareDialog open roomName={room.roomName} room={guest} canManageLinks={false}
      onClose={vi.fn()} onRoomRefresh={vi.fn(async () => guest)} onNotice={vi.fn()} />))
    expect(container.querySelector<HTMLInputElement>('[aria-label="Room link"]')?.value).toContain(`?doc=${room.roomName}`)
    expect(container.querySelector('[aria-label="Suggestion link"]')).toBeNull()
    expect(container.querySelector('[aria-label="Suggestion link expiration"]')).toBeNull()
    expect(container.textContent).not.toContain('Create suggestion link')
    expect(container.textContent).toContain('Only the room owner can manage sharing links')
    await act(async () => root.unmount())
  })

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
    expect(roleNames).toEqual(['Room link', 'Suggestion mode', 'Viewer'])
    expect(container.textContent).toContain('The link grants no authority by itself')
    expect(container.textContent).toContain('submit attributed Source or Visual suggestions')
    expect(container.textContent).toContain('accept or reject each suggestion independently')
    expect(container.textContent).toContain('only maintainers submit accepted source to GitHub')
    expect(container.textContent).toContain('Editing and publishing are disabled')
    expect(container.querySelector('[aria-label="Room link"]')).not.toBeNull()
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