import { useEffect, useState } from 'react'
import { activateViewerSession } from '../lib/github'

const readViewerToken = () => {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return parameters.get('view')
}

const removeViewerToken = () => {
  const url = new URL(window.location.href)
  const parameters = new URLSearchParams(url.hash.replace(/^#/, ''))
  parameters.delete('view')
  url.hash = parameters.toString()
  window.history.replaceState(null, '', url)
}

export const useViewerSession = (roomName: string) => {
  const [token] = useState(readViewerToken)
  const [isLoading, setIsLoading] = useState(Boolean(token))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let active = true
    removeViewerToken()
    activateViewerSession(roomName, token)
      .then(() => {
        if (!active) return
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (!active) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'This viewer link is invalid or expired.',
        )
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [roomName, token])

  return { isLoading, error }
}