import { randomUUID } from 'node:crypto'
import { diffChars } from 'diff'
import type * as Yjs from 'yjs'

export type ProposalDecisionStatus = 'accepted' | 'rejected'

interface ProposalContributor {
  actorId: string
  name: string
  color: string
  firstEditedAt: string
  lastEditedAt: string
}

interface ProposalCheckpoint {
  id: string
  before: string
  after: string
  contributors: ProposalContributor[]
  createdAt: string
  decidedAt: string
  decidedById: string
  decidedByName: string
  status: ProposalDecisionStatus
  submittedAt?: string
  commitSha?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isContributor = (value: unknown): value is ProposalContributor =>
  isRecord(value) &&
  typeof value.actorId === 'string' &&
  typeof value.name === 'string' &&
  typeof value.color === 'string' &&
  typeof value.firstEditedAt === 'string' &&
  typeof value.lastEditedAt === 'string'

const replaceText = (text: Yjs.Text, content: string) => {
  let offset = 0
  for (const part of diffChars(text.toString(), content)) {
    if (part.removed) text.delete(offset, part.value.length)
    else if (part.added) {
      text.insert(offset, part.value)
      offset += part.value.length
    } else offset += part.value.length
  }
}

export const decideLiveProposalDocument = (
  document: Yjs.Doc,
  status: ProposalDecisionStatus,
  actor: { id: string; name: string },
  decidedAt = new Date().toISOString(),
) => {
  const acceptedText = document.getText('content')
  const workingText = document.getText('workingContent')
  const before = acceptedText.toString()
  const after = workingText.toString()
  if (before === after) return null

  const contributorMap = document.getMap<ProposalContributor>('proposalContributors')
  const contributors = Array.from(contributorMap.values())
    .filter(isContributor)
    .sort((first, second) => first.firstEditedAt.localeCompare(second.firstEditedAt))
  if (contributors.length === 0) return null

  const checkpoint: ProposalCheckpoint = {
    id: randomUUID(),
    before,
    after,
    contributors,
    createdAt: contributors[0]?.firstEditedAt ?? decidedAt,
    decidedAt,
    decidedById: actor.id,
    decidedByName: actor.name,
    status,
  }

  document.transact(() => {
    if (status === 'accepted') replaceText(acceptedText, after)
    else replaceText(workingText, before)
    document.getMap<ProposalCheckpoint>('proposalHistory').set(checkpoint.id, checkpoint)
    contributorMap.clear()

    const comments = document.getMap<Record<string, unknown>>('comments')
    for (const [id, comment] of comments.entries()) {
      if (!isRecord(comment.suggestion) || comment.suggestion.status !== 'pending') continue
      comments.set(id, {
        ...comment,
        resolved: true,
        suggestion: {
          ...comment.suggestion,
          status,
          decidedAt,
          decidedById: actor.id,
          decidedByName: actor.name,
        },
      })
    }
  })
  return checkpoint
}

export const markAcceptedCheckpointsSubmitted = (
  document: Yjs.Doc,
  commitSha: string,
  submittedAt = new Date().toISOString(),
) => {
  const history = document.getMap<ProposalCheckpoint>('proposalHistory')
  let updated = 0
  document.transact(() => {
    for (const [id, checkpoint] of history.entries()) {
      if (checkpoint.status !== 'accepted' || checkpoint.commitSha) continue
      history.set(id, { ...checkpoint, commitSha, submittedAt })
      updated += 1
    }
  })
  return updated
}

export const getUnsubmittedProposalContributorNames = (document: Yjs.Doc) => {
  return Array.from(new Set(
    Array.from(document.getMap<ProposalCheckpoint>('proposalHistory').values())
      .filter((checkpoint) => checkpoint.status === 'accepted' && !checkpoint.commitSha)
      .flatMap((checkpoint) => checkpoint.contributors.map((item) => item.name)),
  ))
}
