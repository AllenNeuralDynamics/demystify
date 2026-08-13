import { describe, expect, it } from 'vitest'
import {
  getLiveProposalChanges,
  getLiveProposalInlineChanges,
} from './liveProposal'

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

describe('getLiveProposalInlineChanges', () => {
  it('groups an adjacent accepted deletion and working insertion as one replacement', () => {
    expect(getLiveProposalInlineChanges(
      'alpha gamma omega',
      'alpha INSERT omega',
    )).toEqual([{
      id: 'live-inline-6-11',
      from: 6,
      to: 11,
      workingFrom: 6,
      workingTo: 12,
      before: 'gamma',
      after: 'INSERT',
    }])
  })

  it('keeps a pending insertion identity stable while its text is re-edited', () => {
    const first = getLiveProposalInlineChanges('alpha omega', 'alpha INSERT-A omega')
    const revised = getLiveProposalInlineChanges('alpha omega', 'alpha INSERT-B omega')

    expect(first).toHaveLength(1)
    expect(revised).toHaveLength(1)
    expect(first[0]?.id).toBe('live-inline-6-6')
    expect(revised[0]?.id).toBe(first[0]?.id)
  })

  it('keeps nonadjacent changes as separate review anchors', () => {
    expect(getLiveProposalInlineChanges(
      'alpha target middle omega',
      'alpha middle revised omega',
    )).toMatchObject([
      { before: 'target ', after: '' },
      { before: '', after: 'revised ' },
    ])
  })

  it('keeps whitespace-separated substitutions in readable phrases', () => {
    const changes = getLiveProposalInlineChanges(
      'Ada Researcher, Lin Collaborator, and the Open Methods Group',
      'A long attributed proposal that remains readable and wraps naturally',
    )

    expect(changes.some((change) => change.after.includes('long attributed proposal')))
      .toBe(true)
  })
})