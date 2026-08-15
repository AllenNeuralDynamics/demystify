// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { Collaborator } from '../hooks/useCollaboration'
import { ParticipantsMenu } from './ParticipantsMenu'

const collaborators: Collaborator[] = Array.from({ length: 6 }, (_, index) => ({
  id: `participant-${index + 1}`,
  clientId: index + 1,
  name: `Participant ${index + 1}`,
  color: '#16705d',
  colorLight: '#dcefe9',
  hasCursor: index !== 5,
}))

describe('ParticipantsMenu', () => {
  it('keeps four avatars visible and offers overflow jump and follow actions', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onJump = vi.fn()
    const onFollow = vi.fn()

    await act(async () => root.render(
      <ParticipantsMenu
        collaborators={collaborators}
        currentActorId="participant-1"
        followedClientId={null}
        onFollow={onFollow}
        onJump={onJump}
      />,
    ))

    expect(container.querySelectorAll('.collaborator-stack > .avatar')).toHaveLength(4)
    expect(container.querySelector('.participant-overflow')?.textContent).toBe('+2')

    const jump = container.querySelectorAll<HTMLButtonElement>('.participant-jump')[4]
    const follow = container.querySelector<HTMLButtonElement>('[aria-label="Follow Participant 5"]')
    await act(async () => jump.click())
    expect(onJump).toHaveBeenCalledWith(collaborators[4])
    await act(async () => follow?.click())
    expect(onFollow).toHaveBeenCalledWith(5)

    await act(async () => root.unmount())
  })
})
