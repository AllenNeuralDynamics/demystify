import { describe, expect, it } from 'vitest'
import {
  getSourcePositionForVisualOffset,
  getVisualOffsetForPosition,
  type LinkedScrollPoint,
} from './linkedScroll'

const points: LinkedScrollPoint[] = [
  { position: 100, offset: 40 },
  { position: 200, offset: 240 },
  { position: 400, offset: 340 },
]

describe('linked scroll interpolation', () => {
  it('maps source positions to rendered offsets despite unequal block heights', () => {
    expect(getVisualOffsetForPosition(points, 150)).toBe(140)
    expect(getVisualOffsetForPosition(points, 300)).toBe(290)
  })

  it('maps rendered offsets back to source positions', () => {
    expect(getSourcePositionForVisualOffset(points, 140)).toBe(150)
    expect(getSourcePositionForVisualOffset(points, 290)).toBe(300)
  })

  it('clamps outside the mapped content and handles an empty map', () => {
    expect(getVisualOffsetForPosition(points, 0)).toBe(40)
    expect(getVisualOffsetForPosition(points, 500)).toBe(340)
    expect(getSourcePositionForVisualOffset([], 100)).toBeNull()
  })
})