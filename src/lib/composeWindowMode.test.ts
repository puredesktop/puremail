import { describe, expect, it } from 'vitest'
import {
  composeEscapeAction,
  composeHoldsDraft,
  composeSurfaceVisible,
  modeAfterOpenCompose,
  type ComposeMode,
} from './composeWindowMode'

const ALL_MODES: ComposeMode[] = ['closed', 'docked', 'minimized', 'full']

describe('composeSurfaceVisible', () => {
  it('is true exactly for the modes that show a typing surface', () => {
    expect(ALL_MODES.filter(composeSurfaceVisible)).toEqual(['docked', 'full'])
  })
})

describe('composeHoldsDraft', () => {
  it('a minimized composer still holds the draft-in-progress', () => {
    expect(composeHoldsDraft('minimized')).toBe(true)
  })

  it('only closed means no draft to protect from compose intents', () => {
    expect(ALL_MODES.filter(composeHoldsDraft)).toEqual([
      'docked',
      'minimized',
      'full',
    ])
  })
})

describe('modeAfterOpenCompose', () => {
  it('opens docked from closed', () => {
    expect(modeAfterOpenCompose('closed')).toBe('docked')
  })

  it('restores a minimized composer to the docked window', () => {
    expect(modeAfterOpenCompose('minimized')).toBe('docked')
  })

  it('does not demote an already full-screen composer', () => {
    expect(modeAfterOpenCompose('full')).toBe('full')
  })

  it('keeps a docked composer docked', () => {
    expect(modeAfterOpenCompose('docked')).toBe('docked')
  })
})

describe('composeEscapeAction', () => {
  it('closes open menus before minimizing the docked window', () => {
    expect(composeEscapeAction('docked', true)).toBe('close-menus')
  })

  it('minimizes the docked window when nothing else is open', () => {
    expect(composeEscapeAction('docked', false)).toBe('minimize')
  })

  it('returns a full-screen composer to the docked window', () => {
    expect(composeEscapeAction('full', false)).toBe('dock')
    expect(composeEscapeAction('full', true)).toBe('dock')
  })

  it('does nothing when there is no visible composer', () => {
    expect(composeEscapeAction('closed', false)).toBe('none')
    expect(composeEscapeAction('minimized', false)).toBe('none')
  })
})
