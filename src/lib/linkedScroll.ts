export interface LinkedScrollAnchor {
  position: number | null
  progress: number
}

export interface LinkedScrollPoint {
  position: number
  offset: number
}

const interpolate = (
  points: LinkedScrollPoint[],
  value: number,
  source: keyof LinkedScrollPoint,
  target: keyof LinkedScrollPoint,
) => {
  if (points.length === 0) return null
  const sorted = [...points].sort((left, right) => left[source] - right[source])
  if (value <= sorted[0][source]) return sorted[0][target]
  if (value >= sorted[sorted.length - 1][source]) return sorted[sorted.length - 1][target]

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const next = sorted[index]
    if (value > next[source]) continue
    const span = next[source] - previous[source]
    if (span <= 0) return next[target]
    const ratio = (value - previous[source]) / span
    return previous[target] + ratio * (next[target] - previous[target])
  }
  return null
}

export const getVisualOffsetForPosition = (
  points: LinkedScrollPoint[],
  position: number,
) => interpolate(points, position, 'position', 'offset')

export const getSourcePositionForVisualOffset = (
  points: LinkedScrollPoint[],
  offset: number,
) => interpolate(points, offset, 'offset', 'position')