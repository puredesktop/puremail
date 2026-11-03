// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'
import { useCompactInRoom, useRoomSlot } from './useCompactInRoom'

vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({
  useAdjacentApp: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function compactBeside(neighbour: { tabId: string; name: string; heldInRoom?: boolean } | null): boolean {
  vi.mocked(useAdjacentApp).mockReturnValue(neighbour)
  let compact = false
  function Probe() {
    compact = useCompactInRoom()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  act(() => root.unmount())
  return compact
}

describe('useCompactInRoom', () => {
  afterEach(() => document.documentElement.removeAttribute('data-held-in-room'))

  it('is on beside the Executive app', () => {
    expect(compactBeside({ tabId: 'tab', name: 'Executive', heldInRoom: true })).toBe(true)
  })

  it('is off with no neighbour', () => {
    expect(compactBeside(null)).toBe(false)
  })

  it.each(['Book', 'Writer', 'Calendar', 'executive', 'Executive team', ''])(
    'is off beside %j',
    name => {
      expect(compactBeside({ tabId: 'tab', name })).toBe(false)
    },
  )

  it('is on while held in the room, before the name arrives', () => {
    document.documentElement.setAttribute('data-held-in-room', '')
    expect(compactBeside(null)).toBe(true)
  })

  it('is off beside another app, even when held', () => {
    document.documentElement.setAttribute('data-held-in-room', '')
    expect(compactBeside({ tabId: 'tab', name: 'Book' })).toBe(false)
  })

  it('turns off when the room lets go, with no new neighbour message', async () => {
    document.documentElement.setAttribute('data-held-in-room', '')
    vi.mocked(useAdjacentApp).mockReturnValue(null)
    const seen: boolean[] = []
    function Probe() {
      seen.push(useCompactInRoom())
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<Probe />))
    await act(async () => {
      document.documentElement.removeAttribute('data-held-in-room')
      await Promise.resolve()
    })
    expect(seen.at(-1)).toBe(false)
    act(() => root.unmount())
  })
})

describe('useRoomSlot', () => {
  it('keeps the two values apart', () => {
    let api!: [string, (value: string) => void]
    function Probe({ compact }: { compact: boolean }) {
      api = useRoomSlot(compact, 'whole', 'room')
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<Probe compact={false} />))
    expect(api[0]).toBe('whole')
    act(() => root.render(<Probe compact />))
    expect(api[0]).toBe('room')
    act(() => api[1]('opened in the box'))
    expect(api[0]).toBe('opened in the box')
    act(() => root.render(<Probe compact={false} />))
    expect(api[0]).toBe('whole')
    act(() => root.unmount())
  })
})
