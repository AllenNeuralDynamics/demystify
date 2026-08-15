import { describe, expect, it } from 'vitest'
import {
  getActiveMention,
  insertMention,
  resolveMentions,
  type MentionCandidate,
} from './mentions'

const candidates: MentionCandidate[] = [{
  actorId: 'reviewer-a',
  name: 'Reviewer A',
  color: '#16705d',
  colorLight: '#e4f0eb',
}, {
  actorId: 'reviewer-ann',
  name: 'Reviewer Ann',
  color: '#a64b36',
  colorLight: '#f8e5df',
}]

describe('mentions', () => {
  it('finds a mention query at the caret but ignores email addresses', () => {
    expect(getActiveMention('Could you check this, @Rev', 26)).toEqual({
      from: 22,
      to: 26,
      query: 'Rev',
    })
    expect(getActiveMention('reviewer@example.org', 20)).toBeNull()
  })

  it('replaces the active query and puts the caret after the mention', () => {
    const activeMention = getActiveMention('Thanks @Rev', 11)
    expect(activeMention).not.toBeNull()
    if (!activeMention) return

    expect(insertMention('Thanks @Rev', activeMention, candidates[0])).toEqual({
      value: 'Thanks @Reviewer A ',
      caret: 19,
    })
  })

  it('resolves exact known participants without matching name prefixes', () => {
    expect(resolveMentions('Thanks, @Reviewer Ann please review.', candidates)).toEqual([{
      actorId: 'reviewer-ann',
      name: 'Reviewer Ann',
    }])
  })
})