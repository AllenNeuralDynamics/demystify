import { describe, expect, it } from 'vitest'
import {
  getProjectedSuggestionReplacement,
  mapProjectedRange,
  projectPendingSuggestions,
} from './suggestionProjection'

describe('suggestion projection', () => {
  it('shows only the latest same-range revision', () => {
    const source = 'Original paragraph.'
    const projection = projectPendingSuggestions(source, [
      {
        id: 'first',
        from: 0,
        to: source.length,
        before: source,
        after: 'First proposal.',
        createdAt: '2026-08-12T01:00:00.000Z',
      },
      {
        id: 'second',
        from: 0,
        to: source.length,
        before: source,
        after: 'Current proposal.',
        createdAt: '2026-08-12T01:01:00.000Z',
      },
    ])

    expect(projection.content).toBe('Current proposal.')
    expect(projection.suggestions).toHaveLength(1)
    expect(projection.suggestions[0].revisionIds).toEqual(['first', 'second'])
    expect(projection.hiddenIds).toContain('first')
  })

  it('does not restore a predecessor after its child revision is rejected', () => {
    const source = 'Original paragraph.'
    const projection = projectPendingSuggestions(source, [
      {
        id: 'first',
        from: 0,
        to: source.length,
        before: source,
        after: 'First proposal.',
        createdAt: '2026-08-12T01:00:00.000Z',
      },
      {
        id: 'rejected-child',
        active: false,
        from: 0,
        to: source.length,
        before: source,
        after: 'Rejected revision.',
        createdAt: '2026-08-12T01:01:00.000Z',
        supersedes: ['first'],
      },
    ])

    expect(projection.content).toBe(source)
    expect(projection.suggestions).toHaveLength(0)
    expect(projection.hiddenIds).toContain('first')
  })

  it('maps an edit of proposed text back to its canonical anchor', () => {
    const source = 'Before. Original paragraph. After.'
    const before = 'Original paragraph.'
    const from = source.indexOf(before)
    const projection = projectPendingSuggestions(source, [{
      id: 'proposal',
      from,
      to: from + before.length,
      before,
      after: 'Current proposal.',
      createdAt: '2026-08-12T01:00:00.000Z',
    }])

    expect(getProjectedSuggestionReplacement(
      projection,
      projection.content.replace('Current proposal.', 'Current proposal with detail.'),
    )).toEqual({
      replacement: {
        from,
        to: from + before.length,
        before,
        after: 'Current proposal with detail.',
      },
      supersedes: ['proposal'],
    })
  })

  it('maps an edit outside proposed text to canonical source', () => {
    const source = 'First paragraph. Second paragraph.'
    const second = 'Second paragraph.'
    const from = source.indexOf(second)
    const projection = projectPendingSuggestions(source, [{
      id: 'proposal',
      from,
      to: source.length,
      before: second,
      after: 'Proposed second paragraph.',
      createdAt: '2026-08-12T01:00:00.000Z',
    }])

    expect(getProjectedSuggestionReplacement(
      projection,
      projection.content.replace('First', 'Revised first'),
    )).toEqual({
      replacement: {
        from: 0,
        to: 1,
        before: 'F',
        after: 'Revised f',
      },
      supersedes: [],
    })
  })

  it('maps a Visual block containing current proposed text', () => {
    const source = 'Original paragraph.'
    const projection = projectPendingSuggestions(source, [{
      id: 'proposal',
      from: 0,
      to: source.length,
      before: source,
      after: 'Current proposal.',
      createdAt: '2026-08-12T01:00:00.000Z',
    }])

    expect(mapProjectedRange(projection, 0, projection.content.length)).toEqual({
      replacement: {
        from: 0,
        to: source.length,
        before: source,
        after: 'Current proposal.',
      },
      supersedes: ['proposal'],
    })
  })

  it('maps a Visual block containing a smaller Source suggestion', () => {
    const source = 'The live preview remains inspectable.'
    const before = 'preview'
    const from = source.indexOf(before)
    const projection = projectPendingSuggestions(source, [{
      id: 'proposal',
      from,
      to: from + before.length,
      before,
      after: 'browser preview',
      createdAt: '2026-08-12T01:00:00.000Z',
    }])

    expect(mapProjectedRange(projection, 0, projection.content.length)).toEqual({
      replacement: {
        from: 0,
        to: source.length,
        before: source,
        after: 'The live browser preview remains inspectable.',
      },
      supersedes: ['proposal'],
    })
  })
})
