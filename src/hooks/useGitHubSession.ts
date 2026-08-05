import { useEffect, useState } from 'react'
import {
  disconnectGitHub,
  getGitHubSession,
  type GitHubSession,
} from '../lib/github'

export const useGitHubSession = () => {
  const [session, setSession] = useState<GitHubSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = async () => {
    setIsLoading(true)
    try {
      setSession(await getGitHubSession())
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getGitHubSession()
      .then((nextSession) => {
        if (active) setSession(nextSession)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const disconnect = async () => {
    await disconnectGitHub()
    await refresh()
  }

  return { session, isLoading, refresh, disconnect }
}