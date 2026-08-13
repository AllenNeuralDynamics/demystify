import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  initializeLiveProposal,
  liveProposalRoots,
} from './liveProposalState'

describe('live proposal state', () => {
  it('initializes one working text without replacing it on reconnect', () => {
    const document = new Y.Doc()
    expect(initializeLiveProposal(document, '# Original')).toBe(true)
    document.getText(liveProposalRoots.workingContent).insert(10, ' draft')
    expect(initializeLiveProposal(document, '# Replacement')).toBe(false)
    expect(document.getText(liveProposalRoots.workingContent).toString())
      .toBe('# Original draft')
  })

})