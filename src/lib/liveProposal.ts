import { diffWordsWithSpace } from 'diff'

export interface LiveProposalChange {
  id: string
  from: number
  to: number
  workingFrom: number
  workingTo: number
  before: string
  after: string
}

export const getLiveProposalInlineChanges = (
  accepted: string,
  working: string,
): LiveProposalChange[] => {
  let acceptedOffset = 0
  let workingOffset = 0
  let pendingWhitespace = ''
  let current: Omit<LiveProposalChange, 'id'> | null = null
  const changes: LiveProposalChange[] = []

  const flush = () => {
    if (!current) return
    changes.push({
      ...current,
      id: `live-inline-${current.from}-${current.to}`,
    })
    current = null
  }

  for (const part of diffWordsWithSpace(accepted, working)) {
    if (!part.added && !part.removed) {
      acceptedOffset += part.value.length
      workingOffset += part.value.length
      if (current && !part.value.trim()) {
        pendingWhitespace += part.value
        continue
      }
      pendingWhitespace = ''
      flush()
      continue
    }

    if (current && pendingWhitespace) {
      current.before += pendingWhitespace
      current.after += pendingWhitespace
      current.to = acceptedOffset
      current.workingTo = workingOffset
      pendingWhitespace = ''
    }

    current ??= {
      from: acceptedOffset,
      to: acceptedOffset,
      workingFrom: workingOffset,
      workingTo: workingOffset,
      before: '',
      after: '',
    }
    if (part.removed) {
      current.before += part.value
      acceptedOffset += part.value.length
      current.to = acceptedOffset
    }
    if (part.added) {
      current.after += part.value
      workingOffset += part.value.length
      current.workingTo = workingOffset
    }
  }
  flush()
  return changes
}

export const getLiveProposalChanges = (
  accepted: string,
  working: string,
): LiveProposalChange[] => {
  const mergeContextLimit = 80
  let acceptedOffset = 0
  let workingOffset = 0
  let pendingContext = ''
  let current: Omit<LiveProposalChange, 'id'> | null = null
  const changes: LiveProposalChange[] = []

  const flush = () => {
    if (!current) return
    changes.push({
      ...current,
      id: `live-${current.from}-${current.to}-${current.workingFrom}-${current.workingTo}`,
    })
    current = null
  }

  for (const part of diffWordsWithSpace(accepted, working)) {
    if (!part.added && !part.removed) {
      acceptedOffset += part.value.length
      workingOffset += part.value.length
      if (!current) continue
      pendingContext += part.value
      if (pendingContext.length > mergeContextLimit) {
        pendingContext = ''
        flush()
      }
      continue
    }

    if (current && pendingContext) {
      current.before += pendingContext
      current.after += pendingContext
      current.to = acceptedOffset
      current.workingTo = workingOffset
      pendingContext = ''
    }

    current ??= {
      from: acceptedOffset,
      to: acceptedOffset,
      workingFrom: workingOffset,
      workingTo: workingOffset,
      before: '',
      after: '',
    }
    if (part.removed) {
      current.before += part.value
      acceptedOffset += part.value.length
      current.to = acceptedOffset
    }
    if (part.added) {
      current.after += part.value
      workingOffset += part.value.length
      current.workingTo = workingOffset
    }
  }
  flush()
  return changes
}