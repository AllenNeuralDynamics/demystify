import { useCallback, useEffect, useState } from 'react'
import {
  bindCollaborationRoom,
  claimCollaborationRoom,
  type CollaborationRoom,
  type RepositoryBinding,
  type RoomReview,
} from '../lib/github'

interface AuthorizedRoom {
  principalKey: string
  room: CollaborationRoom
}

export const useRoomAccess = (
  roomName: string,
  principalKey: string,
  enabled = true,
) => {
  const [access, setAccess] = useState<AuthorizedRoom | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return null
    const claimedRoom = await claimCollaborationRoom(roomName)
    setAccess({ principalKey, room: claimedRoom })
    setError(null)
    return claimedRoom
  }, [enabled, principalKey, roomName])

  useEffect(() => {
    if (!enabled) return
    let active = true

    claimCollaborationRoom(roomName)
      .then((claimedRoom) => {
        if (!active) return
        setAccess({ principalKey, room: claimedRoom })
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setAccess(null)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'This collaboration room is unavailable.',
        )
      })

    return () => {
      active = false
    }
  }, [enabled, principalKey, roomName])

  const bind = async (binding: RepositoryBinding) => {
    if (!enabled || access?.room.access !== 'editor') {
      throw new Error('Editor access is required to bind a repository.')
    }
    const boundRoom = await bindCollaborationRoom(roomName, binding)
    setAccess({ principalKey, room: boundRoom })
    setError(null)
    return boundRoom
  }

  const applyReview = (review: RoomReview | null) => {
    setAccess((current) =>
      current?.principalKey === principalKey
        ? { ...current, room: { ...current.room, review } }
        : current,
    )
  }

  const authorizedRoom = access?.principalKey === principalKey ? access.room : null

  return {
    room: authorizedRoom,
    binding: authorizedRoom?.binding ?? null,
    review: authorizedRoom?.review ?? null,
    error,
    isReady: enabled && Boolean(authorizedRoom),
    isLoading: enabled && !authorizedRoom && !error,
    refresh,
    bind,
    applyReview,
  }
}