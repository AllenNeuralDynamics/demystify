import { describe, expect, it } from 'vitest'
import { getLiveProposalChanges } from './liveProposal'

describe('getLiveProposalChanges', () => {
  it('coalesces nearby word edits into one readable replacement', () => {
    expect(getLiveProposalChanges(
      'The first sentence. The second sentence.',
      'A first sentence. The revised second sentence!',
    )).toEqual([{
      id: 'live-0-40-0-46',
      from: 0,
      to: 40,
      workingFrom: 0,
      workingTo: 46,
      before: 'The first sentence. The second sentence.',
      after: 'A first sentence. The revised second sentence!',
    }])
  })

  it('groups an adjacent deletion and insertion as one replacement', () => {
    expect(getLiveProposalChanges('inspectable', 'reviewable')).toEqual([
      {
        id: 'live-0-11-0-10',
        from: 0,
        to: 11,
        workingFrom: 0,
        workingTo: 10,
        before: 'inspectable',
        after: 'reviewable',
      },
    ])
  })

  it('returns no changes for synchronized text', () => {
    expect(getLiveProposalChanges('# Same\n', '# Same\n')).toEqual([])
  })

  it('keeps edits separated across distant unchanged text', () => {
    const context = Array.from({ length: 30 }, () => 'context').join(' ')
    expect(getLiveProposalChanges(`A ${context} B`, `C ${context} D`)).toHaveLength(2)
  })
})