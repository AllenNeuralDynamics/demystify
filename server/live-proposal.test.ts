import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  decideLiveProposalDocument,
  getUnsubmittedProposalContributorNames,
  markAcceptedCheckpointsSubmitted,
} from './live-proposal.js'

const contributor = {
  actorId: 'share:reviewer',
  name: 'Ada Reviewer',
  color: '#a64b36',
  firstEditedAt: '2026-08-12T01:00:00.000Z',
  lastEditedAt: '2026-08-12T01:01:00.000Z',
}

const createDocument = () => {
  const document = new Y.Doc()
  document.getText('content').insert(0, '# Accepted')
  document.getText('workingContent').insert(0, '# Proposed')
  document.getMap('proposalContributors').set(contributor.actorId, contributor)
  return document
}

describe('server live proposal decisions', () => {
  it('accepts working text and archives the complete contributor set', () => {
    const document = createDocument()
    const checkpoint = decideLiveProposalDocument(
      document,
      'accepted',
      { id: 'github:42', name: 'Maintainer' },
      '2026-08-12T01:02:00.000Z',
    )

    expect(document.getText('content').toString()).toBe('# Proposed')
    expect(document.getText('workingContent').toString()).toBe('# Proposed')
    expect(document.getMap('proposalContributors').size).toBe(0)
    expect(checkpoint).toMatchObject({
      before: '# Accepted',
      after: '# Proposed',
      contributors: [contributor],
      decidedById: 'github:42',
      status: 'accepted',
    })
    expect(document.getMap('proposalHistory').get(checkpoint?.id ?? ''))
      .toEqual(checkpoint)
  })

  it('preserves accepted-text anchors outside the changed proposal range', () => {
    const document = new Y.Doc()
    const accepted = document.getText('content')
    const working = document.getText('workingContent')
    accepted.insert(0, 'Original intro. Stable suffix.')
    working.insert(0, 'Revised intro. Stable suffix.')
    document.getMap('proposalContributors').set(contributor.actorId, contributor)
    const suffixIndex = accepted.toString().indexOf('Stable suffix.')
    const relative = Y.createRelativePositionFromTypeIndex(accepted, suffixIndex)

    decideLiveProposalDocument(
      document,
      'accepted',
      { id: 'github:42', name: 'Maintainer' },
    )

    const resolved = Y.createAbsolutePositionFromRelativePosition(relative, document)
    expect(resolved?.type).toBe(accepted)
    expect(accepted.toString().slice(resolved?.index)).toBe('Stable suffix.')
  })

  it('rejects working text without changing accepted source', () => {
    const document = createDocument()
    const checkpoint = decideLiveProposalDocument(
      document,
      'rejected',
      { id: 'github:42', name: 'Maintainer' },
      '2026-08-12T01:02:00.000Z',
    )

    expect(document.getText('content').toString()).toBe('# Accepted')
    expect(document.getText('workingContent').toString()).toBe('# Accepted')
    expect(checkpoint?.status).toBe('rejected')
  })

  it('does not decide synchronized or unattributed text', () => {
    const synchronized = new Y.Doc()
    synchronized.getText('content').insert(0, '# Same')
    synchronized.getText('workingContent').insert(0, '# Same')
    expect(decideLiveProposalDocument(
      synchronized,
      'accepted',
      { id: 'github:42', name: 'Maintainer' },
    )).toBeNull()

    const unattributed = new Y.Doc()
    unattributed.getText('content').insert(0, '# Before')
    unattributed.getText('workingContent').insert(0, '# After')
    expect(decideLiveProposalDocument(
      unattributed,
      'accepted',
      { id: 'github:42', name: 'Maintainer' },
    )).toBeNull()
  })

  it('links accepted checkpoints to the first Git snapshot once', () => {
    const document = createDocument()
    const checkpoint = decideLiveProposalDocument(
      document,
      'accepted',
      { id: 'github:42', name: 'Maintainer' },
      '2026-08-12T01:02:00.000Z',
    )

    expect(getUnsubmittedProposalContributorNames(document)).toEqual(['Ada Reviewer'])

    expect(markAcceptedCheckpointsSubmitted(
      document,
      'abcdef1234567890',
      '2026-08-12T01:03:00.000Z',
    )).toBe(1)
    expect(document.getMap('proposalHistory').get(checkpoint?.id ?? ''))
      .toMatchObject({
        commitSha: 'abcdef1234567890',
        submittedAt: '2026-08-12T01:03:00.000Z',
      })
    expect(markAcceptedCheckpointsSubmitted(
      document,
      'fedcba0987654321',
      '2026-08-12T01:04:00.000Z',
    )).toBe(0)
    expect(getUnsubmittedProposalContributorNames(document)).toEqual([])
  })
})
