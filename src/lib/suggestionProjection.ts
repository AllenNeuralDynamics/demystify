import {
  getTextReplacement,
  type TextReplacement,
} from './collaborativeTextEdit'

export interface PendingTextSuggestion {
  id: string
  active?: boolean
  from: number
  to: number
  before: string
  after: string
  createdAt: string
  supersedes?: string[]
}

export interface ProjectedTextSuggestion extends PendingTextSuggestion {
  projectedFrom: number
  projectedTo: number
  revisionIds: string[]
}

export interface SuggestionProjection {
  source: string
  content: string
  suggestions: ProjectedTextSuggestion[]
  hiddenIds: Set<string>
}

export interface ProjectedSuggestionReplacement {
  replacement: TextReplacement
  supersedes: string[]
}

const overlaps = (
  first: Pick<PendingTextSuggestion, 'from' | 'to'>,
  second: Pick<PendingTextSuggestion, 'from' | 'to'>,
) => {
  if (first.from === first.to && second.from === second.to) {
    return first.from === second.from
  }
  return first.from < second.to && second.from < first.to
}

const newestFirst = (first: PendingTextSuggestion, second: PendingTextSuggestion) =>
  second.createdAt.localeCompare(first.createdAt) || second.id.localeCompare(first.id)

export const projectPendingSuggestions = (
  source: string,
  suggestions: PendingTextSuggestion[],
): SuggestionProjection => {
  const valid = suggestions.filter((suggestion) =>
    suggestion.from >= 0 &&
    suggestion.to >= suggestion.from &&
    suggestion.to <= source.length &&
    source.slice(suggestion.from, suggestion.to) === suggestion.before)
  const explicitlyHidden = new Set(valid.flatMap((suggestion) => suggestion.supersedes ?? []))
  const candidates = valid.filter((suggestion) =>
    suggestion.active !== false && !explicitlyHidden.has(suggestion.id))
  const selected: PendingTextSuggestion[] = []
  const hiddenIds = new Set(explicitlyHidden)

  for (const suggestion of [...candidates].sort(newestFirst)) {
    const conflict = selected.find((current) => overlaps(current, suggestion))
    if (conflict) {
      hiddenIds.add(suggestion.id)
      continue
    }
    selected.push(suggestion)
  }

  const ordered = selected.sort((first, second) =>
    first.from - second.from || first.to - second.to || first.createdAt.localeCompare(second.createdAt))
  let canonicalCursor = 0
  let projectedCursor = 0
  let content = ''
  const projected = ordered.map((suggestion) => {
    const unchanged = source.slice(canonicalCursor, suggestion.from)
    content += unchanged
    projectedCursor += unchanged.length
    const projectedFrom = projectedCursor
    content += suggestion.after
    projectedCursor += suggestion.after.length
    canonicalCursor = suggestion.to
    const sameRangeIds = valid
      .filter((candidate) =>
        candidate.from === suggestion.from &&
        candidate.to === suggestion.to &&
        candidate.before === suggestion.before)
      .map((candidate) => candidate.id)
    return {
      ...suggestion,
      projectedFrom,
      projectedTo: projectedCursor,
      revisionIds: Array.from(new Set([
        ...sameRangeIds,
        ...(suggestion.supersedes ?? []),
      ])),
    }
  })
  content += source.slice(canonicalCursor)

  return { source, content, suggestions: projected, hiddenIds }
}

const mapUnchangedPosition = (
  projection: SuggestionProjection,
  position: number,
) => {
  let offset = 0
  for (const suggestion of projection.suggestions) {
    if (position < suggestion.projectedFrom) return position - offset
    if (position === suggestion.projectedFrom) return suggestion.from
    if (position === suggestion.projectedTo) return suggestion.to
    if (position < suggestion.projectedTo) return null
    offset += suggestion.after.length - suggestion.before.length
  }
  return position - offset
}

export const getProjectedSuggestionReplacement = (
  projection: SuggestionProjection,
  draft: string,
): ProjectedSuggestionReplacement | null | 'conflict' => {
  const local = getTextReplacement(projection.content, draft)
  if (!local) return null

  const containingSuggestion = projection.suggestions.find((suggestion) =>
    local.from >= suggestion.projectedFrom &&
    local.to <= suggestion.projectedTo)
  if (containingSuggestion) {
    const relativeFrom = local.from - containingSuggestion.projectedFrom
    const relativeTo = local.to - containingSuggestion.projectedFrom
    return {
      replacement: {
        from: containingSuggestion.from,
        to: containingSuggestion.to,
        before: containingSuggestion.before,
        after: `${containingSuggestion.after.slice(0, relativeFrom)}${local.after}${containingSuggestion.after.slice(relativeTo)}`,
      },
      supersedes: containingSuggestion.revisionIds,
    }
  }

  const touchedSuggestions = projection.suggestions.filter((suggestion) =>
    local.from < suggestion.projectedTo && local.to > suggestion.projectedFrom)
  if (touchedSuggestions.length > 0) {
    const projectedFrom = Math.min(
      local.from,
      ...touchedSuggestions.map((suggestion) => suggestion.projectedFrom),
    )
    const projectedTo = Math.max(
      local.to,
      ...touchedSuggestions.map((suggestion) => suggestion.projectedTo),
    )
    const from = mapUnchangedPosition(projection, projectedFrom)
    const to = mapUnchangedPosition(projection, projectedTo)
    if (from === null || to === null) return 'conflict'
    return {
      replacement: {
        from,
        to,
        before: projection.source.slice(from, to),
        after: `${projection.content.slice(projectedFrom, local.from)}${local.after}${projection.content.slice(local.to, projectedTo)}`,
      },
      supersedes: Array.from(new Set(
        touchedSuggestions.flatMap((suggestion) => suggestion.revisionIds),
      )),
    }
  }

  const from = mapUnchangedPosition(projection, local.from)
  const to = mapUnchangedPosition(projection, local.to)
  if (from === null || to === null) return 'conflict'
  return {
    replacement: {
      from,
      to,
      before: local.before,
      after: local.after,
    },
    supersedes: [],
  }
}

export const mapProjectedRange = (
  projection: SuggestionProjection,
  from: number,
  to: number,
): ProjectedSuggestionReplacement | 'conflict' => {
  const canonicalFrom = mapUnchangedPosition(projection, from)
  const canonicalTo = mapUnchangedPosition(projection, to)
  if (canonicalFrom === null || canonicalTo === null) return 'conflict'
  const touchedSuggestions = projection.suggestions.filter((suggestion) =>
    from <= suggestion.projectedFrom && to >= suggestion.projectedTo)
  return {
    replacement: {
      from: canonicalFrom,
      to: canonicalTo,
      before: projection.source.slice(canonicalFrom, canonicalTo),
      after: projection.content.slice(from, to),
    },
    supersedes: Array.from(new Set(
      touchedSuggestions.flatMap((suggestion) => suggestion.revisionIds),
    )),
  }
}
