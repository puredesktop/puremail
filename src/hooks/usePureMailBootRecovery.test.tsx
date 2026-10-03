// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { usePureMailBoot } from './usePureMailBoot'
import { readPersistedMailStore } from '../lib/mailPersistence'
import { emptyMailStore } from '../lib/mailStoreData'

vi.mock('../lib/mailPersistence', () => ({ readPersistedMailStore: vi.fn() }))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../bridge/platformBridge')>(),
  fetchGoogleCredentialStatus: vi.fn(async () => ({ connected: true, email: 'me@example.test' })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('stops writable boot on a drafts read failure and re-reads storage on retry', async () => {
  localStorage.clear()
  const read = vi.mocked(readPersistedMailStore)
  read.mockRejectedValueOnce(new Error('Your saved drafts could not be read.'))
  const host = document.createElement('div')
  const root = createRoot(host)
  let api!: ReturnType<typeof usePureMailBoot>
  function Harness() { api = usePureMailBoot(true); return null }
  try {
    await act(async () => root.render(<Harness />))
    expect(api.boot).toBeNull()
    expect(api.bootError?.message).toContain('drafts could not be read')
    expect(read).toHaveBeenCalledOnce()
    const store = emptyMailStore()
    store.drafts = [{ id: 'saved', threadId: 'thread', subject: 'Unsent', body: 'Recovered writing', to: [], attachments: [], updatedAt: '2026-10-03T00:00:00Z', syncState: 'pending' }]
    read.mockResolvedValueOnce({ store, migratedFromLocalStorage: false })
    await act(async () => api.rebootMail())
    expect(read).toHaveBeenCalledTimes(2)
    expect(api.bootError).toBeNull()
    expect(api.boot?.store.drafts[0].body).toBe('Recovered writing')
    expect(api.boot?.provider).toBe('gmail')
  } finally {
    await act(async () => root.unmount())
    read.mockReset()
  }
})
