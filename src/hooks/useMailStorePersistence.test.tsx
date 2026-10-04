// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useMailStorePersistence } from './useMailStorePersistence'
import { emptyMailStore } from '../lib/mailModel'
import { writePersistedMailStore } from '../lib/mailPersistence'
vi.mock('../lib/mailPersistence', () => ({ writePersistedMailStore: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('serializes a send-state flush behind an earlier write and waits for the new snapshot', async () => {
  const write = vi.mocked(writePersistedMailStore); write.mockReset()
  let finish!: (result: { draftsWritten: boolean; cacheWritten: boolean }) => void
  write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ draftsWritten: true, cacheWritten: true })
  const host = document.createElement('div'); const root = createRoot(host)
  const original = emptyMailStore(); const next = { ...original, settings: { ...original.settings, undoSendDelaySeconds: 20 as const } }
  let api!: ReturnType<typeof useMailStorePersistence>
  function Harness() { api = useMailStorePersistence(original); return null }
  try {
    await act(async () => root.render(<Harness />))
    let first!: Promise<void>; let second!: Promise<void>
    await act(async () => { first = api.flushForSend(original); second = api.flushForSend(next) })
    expect(write).toHaveBeenCalledTimes(1)
    let done = false; void second.then(() => { done = true })
    expect(done).toBe(false)
    await act(async () => { finish({ draftsWritten: true, cacheWritten: true }); await first; await second })
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toBe(next)
    expect(done).toBe(true)
  } finally { await act(async () => root.unmount()); write.mockReset() }
})

it('rejects the before-send flush when draft state cannot be saved', async () => {
  const write = vi.mocked(writePersistedMailStore); write.mockReset()
  write.mockResolvedValue({ draftsWritten: false, cacheWritten: true, error: 'Disk full' })
  const host = document.createElement('div'); const root = createRoot(host)
  let api!: ReturnType<typeof useMailStorePersistence>
  function Harness() { api = useMailStorePersistence(emptyMailStore()); return null }
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => { await expect(api.flushForSend(emptyMailStore())).rejects.toThrow('Nothing was sent') })
    expect(api.persistFailure?.draftsLost).toBe(true)
  } finally { await act(async () => root.unmount()); write.mockReset() }
})
