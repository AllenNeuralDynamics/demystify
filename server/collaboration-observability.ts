import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

type HeaderValue = string | string[] | undefined

export interface CollaborationClientMetadata {
  family: 'chrome' | 'edge' | 'firefox' | 'safari' | 'vscode' | 'other' | 'unknown'
  platform: 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'other' | 'unknown'
  fingerprint: string
}

const firstHeaderValue = (value: HeaderValue) =>
  Array.isArray(value) ? value[0] : value

const firstValidAddress = (value: HeaderValue) => {
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((entry) => entry?.split(',') ?? [])
    .map((entry) => entry.trim())
    .find((entry) => isIP(entry) !== 0)
}

const describeFamily = (userAgent: string) => {
  if (!userAgent) return 'unknown' as const
  if (/\b(?:Code|Electron)\//i.test(userAgent)) return 'vscode' as const
  if (/\b(?:Edg|EdgA|EdgiOS)\//i.test(userAgent)) return 'edge' as const
  if (/\b(?:Chrome|CriOS)\//i.test(userAgent)) return 'chrome' as const
  if (/\b(?:Firefox|FxiOS)\//i.test(userAgent)) return 'firefox' as const
  if (/\bSafari\//i.test(userAgent)) return 'safari' as const
  return 'other' as const
}

const describePlatform = (userAgent: string) => {
  if (!userAgent) return 'unknown' as const
  if (/\bAndroid\b/i.test(userAgent)) return 'android' as const
  if (/\b(?:iPhone|iPad|iPod)\b/i.test(userAgent)) return 'ios' as const
  if (/\bWindows\b/i.test(userAgent)) return 'windows' as const
  if (/\b(?:Macintosh|Mac OS X)\b/i.test(userAgent)) return 'macos' as const
  if (/\bLinux\b/i.test(userAgent)) return 'linux' as const
  return 'other' as const
}

export const describeCollaborationClient = ({
  forwardedFor,
  remoteAddress,
  userAgent,
  fingerprintSalt,
}: {
  forwardedFor: HeaderValue
  remoteAddress: string | undefined
  userAgent: HeaderValue
  fingerprintSalt: string
}): CollaborationClientMetadata => {
  const normalizedUserAgent = firstHeaderValue(userAgent) ?? ''
  const address = firstValidAddress(forwardedFor)
    || (remoteAddress && isIP(remoteAddress) !== 0 ? remoteAddress : undefined)
    || 'unknown'
  const fingerprint = createHash('sha256')
    .update(fingerprintSalt)
    .update('\0')
    .update(address)
    .digest('hex')
    .slice(0, 12)

  return {
    family: describeFamily(normalizedUserAgent),
    platform: describePlatform(normalizedUserAgent),
    fingerprint,
  }
}