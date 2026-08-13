import * as Y from 'yjs'

export type ProposalCheckpointStatus = 'accepted' | 'rejected'

export interface SharedProposalContributor {
  actorId: string
  name: string
  color: string
  firstEditedAt: string
  lastEditedAt: string
}

export interface SharedProposalCheckpoint {
  id: string
  before: string
  after: string
  contributors: SharedProposalContributor[]
  createdAt: string
  decidedAt: string
  decidedById: string
  decidedByName: string
  status: ProposalCheckpointStatus
  submittedAt?: string
  commitSha?: string
}

export const liveProposalRoots = {
  workingContent: 'workingContent',
  contributors: 'proposalContributors',
  history: 'proposalHistory',
} as const

export const initializeLiveProposal = (
  document: Y.Doc,
  content: string,
) => {
  const metadata = document.getMap<string | number | boolean>('metadata')
  if (metadata.get('workingContentInitialized') === true) return false
  const workingText = document.getText(liveProposalRoots.workingContent)
  document.transact(() => {
    workingText.delete(0, workingText.length)
    if (content) workingText.insert(0, content)
    metadata.set('workingContentInitialized', true)
  })
  return true
}