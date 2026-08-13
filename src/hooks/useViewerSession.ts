import { useEffect, useState } from 'react'
import {
  activateShareSession,
  type AnonymousShareRole,
} from '../lib/github'
import { loadProfile } from '../lib/profile'

const readShareToken = (): { token: string; role: AnonymousShareRole } | null => {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const collaboratorToken = parameters.get('collaborate')
  if (collaboratorToken) return { token: collaboratorToken, role: 'collaborator' }
  const viewerToken = parameters.get('view')
  return viewerToken ? { token: viewerToken, role: 'viewer' } : null
}

const removeShareToken = () => {
  const url = new URL(window.location.href)
  const parameters = new URLSearchParams(url.hash.replace(/^#/, ''))
  parameters.delete('view')
  parameters.delete('collaborate')
  url.hash = parameters.toString()
  window.history.replaceState(null, '', url)
}

export const useShareSession = (roomName: string) => {
  const [shareToken] = useState(readShareToken)
  const [isLoading, setIsLoading] = useState(Boolean(shareToken))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!shareToken) return
    let active = true
    removeShareToken()
    activateShareSession(roomName, shareToken.token, shareToken.role, loadProfile().name)
      .then(() => {
        if (!active) return
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'This sharing link is invalid or expired.',
        )
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [roomName, shareToken])

  return { isLoading, error, role: shareToken?.role ?? null }
}