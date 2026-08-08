import { useEffect, useState } from 'react'
import {
  bindCollaborationRoom,
  claimCollaborationRoom,
  type CollaborationRoom,
  type RepositoryBinding,
  type RoomReview,
} from '../lib/github'

interface AuthorizedRoom {
  userId: number
  room: CollaborationRoom
}

export const useRoomAccess = (roomName: string, userId: number | null) => {
  const [access, setAccess] = useState<AuthorizedRoom | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userId === null) return
    let active = true

    claimCollaborationRoom(roomName)
      .then((claimedRoom) => {
        if (!active) return
        setAccess({ userId, room: claimedRoom })
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
  }, [roomName, userId])

  const bind = async (binding: RepositoryBinding) => {
    if (userId === null) throw new Error('Connect GitHub before binding a repository.')
    const boundRoom = await bindCollaborationRoom(roomName, binding)
    setAccess({ userId, room: boundRoom })
    setError(null)
    return boundRoom
  }

  const applyReview = (review: RoomReview | null) => {
    setAccess((current) =>
      current?.userId === userId
        ? { ...current, room: { ...current.room, review } }
        : current,
    )
  }

  const authorizedRoom = access?.userId === userId ? access.room : null

  return {
    room: authorizedRoom,
    binding: authorizedRoom?.binding ?? null,
    review: authorizedRoom?.review ?? null,
    error,
    isReady: userId !== null && Boolean(authorizedRoom),
    isLoading: userId !== null && !authorizedRoom && !error,
    bind,
    applyReview,
  }
}