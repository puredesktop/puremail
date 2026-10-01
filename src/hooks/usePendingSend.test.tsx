// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePendingSend } from './usePendingSend'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function mount() {
  const root = createRoot(document.createElement('div'))
  let api!: ReturnType<typeof usePendingSend>
  function Harness() {
    api = usePendingSend({
      undoSendDelaySeconds: 10,
      setCommandNotice: vi.fn(),
    })
    return null
  }
  act(() => root.render(<Harness />))
  return { api: () => api, unmount: () => act(() => root.unmount()) }
}
const message = { id: 'one', target: 'compose' as const, label: 'Message' }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('refuses a second compose send before React has rendered the first hold', () => {
  const harness = mount()
  const send = vi.fn()
  act(() => {
    const api = harness.api()
    expect(api.schedulePendingSend(message, send)).toBe(true)
    expect(api.schedulePendingSend({ ...message, id: 'two' }, send)).toBe(false)
  })
  act(() => vi.advanceTimersByTime(10000))
  expect(send).toHaveBeenCalledTimes(1)
  harness.unmount()
})

it('allows distinct run holds but refuses duplicate run IDs', () => {
  const harness = mount()
  const send = vi.fn()
  act(() => {
    const api = harness.api()
    expect(api.schedulePendingSend({ ...message, target: 'run' }, send)).toBe(
      true,
    )
    expect(api.schedulePendingSend({ ...message, target: 'run' }, send)).toBe(
      false,
    )
    expect(
      api.schedulePendingSend({ ...message, id: 'two', target: 'run' }, send),
    ).toBe(true)
  })
  act(() => vi.advanceTimersByTime(10000))
  expect(send).toHaveBeenCalledTimes(2)
  harness.unmount()
})

it('undo immediately releases the hold and cancels only its send', () => {
  const harness = mount()
  const cancelled = vi.fn()
  const next = vi.fn()
  act(() => {
    const api = harness.api()
    api.schedulePendingSend(message, cancelled)
    api.undoPendingSend(message.id)
    expect(api.schedulePendingSend({ ...message, id: 'two' }, next)).toBe(true)
  })
  act(() => vi.advanceTimersByTime(10000))
  expect(cancelled).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalledOnce()
  harness.unmount()
})

it('cancels queued sends when the mail surface unmounts', () => {
  const harness = mount()
  const send = vi.fn()
  act(() => {
    harness.api().schedulePendingSend(message, send)
  })
  harness.unmount()
  act(() => vi.advanceTimersByTime(10000))
  expect(send).not.toHaveBeenCalled()
})
