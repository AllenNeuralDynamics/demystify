import type { SharedMention } from '../hooks/useCollaboration'

export interface MentionCandidate extends SharedMention {
  color: string
  colorLight: string
  displayName?: string
}

export interface ActiveMention {
  from: number
  to: number
  query: string
}

const escapeRegularExpression = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const getActiveMention = (
  value: string,
  caret: number,
): ActiveMention | null => {
  const prefix = value.slice(0, caret)
  const from = prefix.lastIndexOf('@')
  if (from < 0) return null

  const characterBefore = from > 0 ? value[from - 1] : ''
  if (characterBefore && !/[\s([{"',]/.test(characterBefore)) return null

  const query = prefix.slice(from + 1)
  if (query.includes('\n') || query.length > 80) return null
  return { from, to: caret, query }
}

export const insertMention = (
  value: string,
  activeMention: ActiveMention,
  candidate: MentionCandidate,
) => {
  const suffix = value.slice(activeMention.to)
  const separator = suffix === '' || !/^\s/.test(suffix) ? ' ' : ''
  const mention = `@${candidate.name}${separator}`
  return {
    value: `${value.slice(0, activeMention.from)}${mention}${suffix}`,
    caret: activeMention.from + mention.length,
  }
}

export const resolveMentions = (
  value: string,
  candidates: MentionCandidate[],
): SharedMention[] => {
  const seenActorIds = new Set<string>()
  return candidates.flatMap((candidate) => {
    if (seenActorIds.has(candidate.actorId)) return []
    const escapedName = escapeRegularExpression(candidate.name)
    const pattern = new RegExp(
      `(^|[\\s([{"',])@${escapedName}(?=$|[\\s.,!?;:)}\\]"'])`,
      'iu',
    )
    if (!pattern.test(value)) return []
    seenActorIds.add(candidate.actorId)
    return [{ actorId: candidate.actorId, name: candidate.name }]
  })
}