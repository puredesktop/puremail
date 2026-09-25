/**
 * Where you are in the rail: the label, the row under the top edge, and
 * the scroll offset that puts a chosen row there.
 */
import { describe, expect, it } from 'vitest'
import {
  firstVisibleRow,
  listPositionLabel,
  scrollTopForRow,
} from './mailShellLayout'

describe('knowing where you are in the rail', () => {
  it('reads as a position in the whole list, thousands separated', () => {
    expect(listPositionLabel({ first: 119, total: 2236 })).toBe('120 of 2,236')
    expect(listPositionLabel({ first: 0, total: 3 })).toBe('1 of 3')
  })

  it('says nothing for an empty list, and never runs past the end', () => {
    expect(listPositionLabel({ first: 0, total: 0 })).toBeNull()
    expect(listPositionLabel({ first: 99, total: 4 })).toBe('4 of 4')
  })

  it('counts the topmost row in view, not the overscan above it', () => {
    // Rail starts 40px down the scroller; rows are 56px.
    expect(firstVisibleRow({ scrollTop: 40, railTop: 40, rowHeight: 56, total: 100 })).toBe(0)
    expect(firstVisibleRow({ scrollTop: 40 + 56 * 12, railTop: 40, rowHeight: 56, total: 100 })).toBe(12)
    // Scrolled above the rail, or an empty list.
    expect(firstVisibleRow({ scrollTop: 0, railTop: 40, rowHeight: 56, total: 100 })).toBe(0)
    expect(firstVisibleRow({ scrollTop: 999999, railTop: 40, rowHeight: 56, total: 100 })).toBe(99)
    expect(firstVisibleRow({ scrollTop: 100, railTop: 0, rowHeight: 56, total: 0 })).toBe(0)
  })

  it('jumps to a row, clamping an ask that runs off either end', () => {
    expect(scrollTopForRow({ position: 1, railTop: 40, rowHeight: 56, total: 100 })).toBe(40)
    expect(scrollTopForRow({ position: 13, railTop: 40, rowHeight: 56, total: 100 })).toBe(40 + 56 * 12)
    expect(scrollTopForRow({ position: 9999, railTop: 40, rowHeight: 56, total: 100 })).toBe(40 + 56 * 99)
    expect(scrollTopForRow({ position: -5, railTop: 40, rowHeight: 56, total: 100 })).toBe(40)
    expect(scrollTopForRow({ position: 5, railTop: 40, rowHeight: 56, total: 0 })).toBe(40)
  })
})
