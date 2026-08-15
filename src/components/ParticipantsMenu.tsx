import { Eye, LocateFixed, PencilLine, UsersRound } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Collaborator } from '../hooks/useCollaboration'

const visibleParticipantLimit = 4

interface ParticipantsMenuProps {
  collaborators: Collaborator[]
  currentActorId: string
  followedClientId: number | null
  onEditProfile?: () => void
  onFollow: (clientId: number | null) => void
  onJump: (collaborator: Collaborator) => void
}

const getParticipantOverflow = (collaborators: Collaborator[]) => ({
  visible: collaborators.slice(0, visibleParticipantLimit),
  overflowCount: Math.max(0, collaborators.length - visibleParticipantLimit),
})

export const ParticipantsMenu = ({
  collaborators,
  currentActorId,
  followedClientId,
  onEditProfile,
  onFollow,
  onJump,
}: ParticipantsMenuProps) => {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const { visible, overflowCount } = getParticipantOverflow(collaborators)

  const closeMenu = () => detailsRef.current?.removeAttribute('open')

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const activateParticipant = (collaborator: Collaborator) => {
    if (collaborator.id === currentActorId && onEditProfile) onEditProfile()
    else onJump(collaborator)
    closeMenu()
  }

  return (
    <div className="collaborator-stack" role="group" aria-label="Current collaborators">
      {visible.map((collaborator) => {
        const isCurrent = collaborator.id === currentActorId
        return (
          <button
            aria-label={isCurrent && onEditProfile
              ? `Edit your profile (${collaborator.name})`
              : `Jump to ${collaborator.name}`}
            className="avatar"
            key={collaborator.clientId}
            style={{ background: collaborator.colorLight, color: collaborator.color }}
            title={isCurrent && onEditProfile
              ? `Edit your profile (${collaborator.name})`
              : collaborator.hasCursor
                ? `Jump to ${collaborator.name}`
                : `${collaborator.name} is watching`}
            type="button"
            onClick={() => activateParticipant(collaborator)}
          >
            {collaborator.name.slice(0, 1).toUpperCase()}
          </button>
        )
      })}
      <details className="participants-menu" ref={detailsRef}>
        <summary
          aria-label={`Show all ${collaborators.length} participants`}
          className="avatar participant-overflow"
          title={`${collaborators.length} people here`}
        >
          {overflowCount > 0
            ? `+${overflowCount}`
            : <UsersRound size={14} aria-hidden="true" />}
        </summary>
          <div className="participants-popover">
            <header>
              <strong>People</strong>
              <span>{collaborators.length} here</span>
            </header>
            <ul>
              {collaborators.map((collaborator) => {
                const isCurrent = collaborator.id === currentActorId
                const isFollowing = followedClientId === collaborator.clientId
                return (
                  <li key={collaborator.clientId}>
                    <button
                      className="participant-jump"
                      type="button"
                      onClick={() => activateParticipant(collaborator)}
                    >
                      <span
                        className="participant-avatar"
                        style={{ background: collaborator.colorLight, color: collaborator.color }}
                      >
                        {collaborator.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="participant-identity">
                        <strong>{collaborator.name}</strong>
                        <small>
                          {isCurrent ? 'You' : collaborator.hasCursor ? 'Active in document' : 'Watching'}
                        </small>
                      </span>
                      {isCurrent && onEditProfile
                        ? <PencilLine size={14} aria-hidden="true" />
                        : collaborator.hasCursor
                          ? <LocateFixed size={14} aria-hidden="true" />
                          : null}
                    </button>
                    {!isCurrent && (
                      <button
                        aria-label={isFollowing
                          ? `Stop following ${collaborator.name}`
                          : `Follow ${collaborator.name}`}
                        aria-pressed={isFollowing}
                        className="participant-follow"
                        disabled={!collaborator.hasCursor}
                        title={isFollowing
                          ? `Stop following ${collaborator.name}`
                          : `Follow ${collaborator.name}`}
                        type="button"
                        onClick={() => {
                          onFollow(isFollowing ? null : collaborator.clientId)
                          closeMenu()
                        }}
                      >
                        <Eye size={15} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
      </details>
    </div>
  )
}
