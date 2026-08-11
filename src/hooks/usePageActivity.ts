import { useEffect, useState } from 'react'

export const pageIdleTimeoutMs = 10 * 60_000

export const usePageActivity = (idleTimeoutMs = pageIdleTimeoutMs) => {
  const [isActive, setIsActive] = useState(
    () => document.visibilityState !== 'hidden',
  )

  useEffect(() => {
    let idleTimer: number | undefined

    const clearIdleTimer = () => {
      window.clearTimeout(idleTimer)
      idleTimer = undefined
    }
    const suspend = () => {
      clearIdleTimer()
      setIsActive(false)
    }
    const markActive = () => {
      if (document.visibilityState === 'hidden') {
        suspend()
        return
      }
      setIsActive(true)
      clearIdleTimer()
      idleTimer = window.setTimeout(suspend, idleTimeoutMs)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') suspend()
      else markActive()
    }

    document.addEventListener('pointerdown', markActive, { passive: true })
    document.addEventListener('keydown', markActive)
    document.addEventListener('scroll', markActive, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', markActive)
    markActive()

    return () => {
      clearIdleTimer()
      document.removeEventListener('pointerdown', markActive)
      document.removeEventListener('keydown', markActive)
      document.removeEventListener('scroll', markActive, true)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', markActive)
    }
  }, [idleTimeoutMs])

  return isActive
}