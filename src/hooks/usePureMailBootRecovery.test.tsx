// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { usePureMailBoot } from './usePureMailBoot'
import { readPersistedMailStore } from '../lib/mailPersistence'
import { emptyMailStore } from '../lib/mailStoreData'
import { DemoMailProvider } from '../lib/demoMailProvider'
import { GmailMailProvider } from '../lib/gmailMailProvider'
import { ImapMailProvider } from '../lib/imapMailProvider'

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

it('recovers interrupted sends only after a successful load, and reopening sends nothing', async () => {
  const sends = [GmailMailProvider, ImapMailProvider, DemoMailProvider].map(provider => vi.spyOn(provider.prototype, 'send'))
  const read = vi.mocked(readPersistedMailStore)
  let api!: ReturnType<typeof usePureMailBoot>
  function Harness() {
    api = usePureMailBoot(true)
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    read.mockRejectedValueOnce(new Error('Your saved drafts could not be read.'))
    await act(async () => root.render(<Harness />))
    expect(api.boot).toBeNull()
    expect(api.bootError).not.toBeNull()
    for (const send of sends) expect(send).not.toHaveBeenCalled()
    const store = emptyMailStore()
    const draft = { id: 'held', threadId: 'thread', subject: 'Held', body: 'Text', to: [{ name: '', email: 'a@example.test' }], attachments: [], updatedAt: '2026-01-01T00:00:00Z', sendAttempt: { id: 'h1', phase: 'held' as const, approved: 'x', at: '2026-01-01T00:00:00Z' } }
    const ambiguous = { ...draft, id: 'gone', sendState: 'uncertain' as const, sendMessageId: '<m>', sendAttempt: { id: 'h2', phase: 'submitting' as const, approved: 'x', at: '2026-01-01T00:00:00Z' } }
    store.drafts = [draft, ambiguous] as unknown as typeof store.drafts
    read.mockResolvedValueOnce({ store, migratedFromLocalStorage: false })
    await act(async () => api.rebootMail())
    const booted = api.boot!.store
    expect(booted.drafts.find(item => item.id === 'held')).toMatchObject({ sendState: 'failed', sendError: 'Mail closed before it left. Nothing was sent.' })
    expect(booted.drafts.find(item => item.id === 'held')!.sendAttempt).toBeUndefined()
    expect(booted.drafts.find(item => item.id === 'gone')).toMatchObject({ sendState: 'uncertain' })
    expect(booted.drafts.find(item => item.id === 'gone')!.sendAttempt).toBeUndefined()
    read.mockResolvedValueOnce({ store: booted, migratedFromLocalStorage: false })
    await act(async () => api.rebootMail())
    expect(api.boot!.store.drafts).toEqual(booted.drafts)
    for (const send of sends) expect(send).not.toHaveBeenCalled()
  } finally {
    for (const send of sends) send.mockRestore()
    await act(async () => root.unmount())
    read.mockReset()
  }
})
