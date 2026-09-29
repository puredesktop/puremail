import { describe, expect, it, vi } from 'vitest'
import { guardDevelopmentTiming } from './developmentTiming'

describe('development timing compatibility', () => {
  it('keeps a render running when React diagnostic detail cannot be cloned', () => {
    const result = {} as PerformanceMeasure
    const measure = vi.fn((_name: string, options?: string | PerformanceMeasureOptions) => {
      if (typeof options === 'object' && options.detail) throw new DOMException('Cannot clone', 'DataCloneError')
      return result
    })
    const timing = { measure }
    const restore = guardDevelopmentTiming(timing)
    expect(timing.measure('\u200bMailSidebar', { start: 1, end: 2, detail: { devtools: { properties: [] } } })).toBe(result)
    expect(measure).toHaveBeenLastCalledWith('\u200bMailSidebar', { start: 1, end: 2 })
    restore()
    expect(timing.measure).toBe(measure)
  })

  it('does not suppress application timing errors or unrelated renderer errors', () => {
    const error = new DOMException('Cannot clone', 'DataCloneError')
    const timing: Pick<Performance, 'measure'> = { measure: vi.fn(() => { throw error }) }
    guardDevelopmentTiming(timing)
    expect(() => timing.measure('application timing', { detail: { devtools: {} } })).toThrow(error)
    const otherError = new Error('Unrelated error')
    const other: Pick<Performance, 'measure'> = { measure: vi.fn(() => { throw otherError }) }
    guardDevelopmentTiming(other)
    expect(() => other.measure('\u200bMailSidebar', { detail: { devtools: {} } })).toThrow(otherError)
  })
})
