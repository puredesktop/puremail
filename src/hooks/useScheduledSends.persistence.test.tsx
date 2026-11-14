// @vitest-environment happy-dom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMailDeliveryController } from '../lib/mailDelivery'
import { LOST_HOLD_REASON, draftDelivery } from '../lib/mailDeliveryStatus'
import { MAIL_STORE_FILE, writePersistedMailStore } from '../lib/mailPersistence'
import { createComposedMessageDraft, emptyMailStore } from '../lib/mailModel'
import { scheduleSend } from '../lib/mailScheduledSend'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
import { usePendingSend } from './usePendingSend'
import { usePureMailBoot } from './usePureMailBoot'
import { createScheduledSendDispatcher, useScheduledSendTimer } from './useScheduledSends'

/** The disk behind the real persistence, with a cache write that can be made to fail. */
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), failCache: false, cacheFile: 'mail-store.json' }))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../bridge/platformBridge')>(),
  fetchGoogleCredentialStatus: vi.fn(async () => ({ connected: true, email: 'me@example.test' })),
  readPlatformStorageJson: vi.fn(async ({ fileName }: { fileName: string }) => {
    const text = disk.files.get(fileName)
    return { value: text === undefined ? null : JSON.parse(text) }
  }),
  writePlatformStorageJson: vi.fn(async ({ fileName, value }: { fileName: string; value: unknown }) => {
    if (disk.failCache && fileName === disk.cacheFile) throw new Error('Disk full')
    disk.files.set(fileName, JSON.stringify(value))
  }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = '2026-11-02T12:00:00.000Z'
const LONG_AGO = '2026-11-02T10:00:00.000Z'
const send = vi.fn(async (draft: Draft): Promise<MailMessage> => ({ id: 'accepted', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: NOW, read: true }))
const provider = { send: ({ draft }: { draft: Draft }) => send(draft) } as unknown as MailProvider
const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

/** Real boot, real saved files, real dispatcher and timer. Each pass of the timer saves, as the shell's persistence does. */
async function open() {
  let store: MailStore | null = null
  let booted!: ReturnType<typeof usePureMailBoot>
  const update = (updater: (current: MailStore) => MailStore) => { store = updater(store!) }
  function Desk({ initial }: { initial: MailStore }) {
    if (!store) store = initial
    const hold = usePendingSend({ undoSendDelaySeconds: 10, setCommandNotice: () => {} })
    const deliver = useRef(createMailDeliveryController({ read: () => store!, update, persist: async snapshot => { await writePersistedMailStore(snapshot) }, prepare: async draft => ({ ...draft }), release: () => {}, online: () => true })).current
    const dispatch = createScheduledSendDispatcher({
      read: () => store!, update, provider: () => provider, online: () => true, localAccount: () => false, home: () => 'Fake',
      holdForDraft: hold.holdForDraft, isDraftSending: hold.isDraftSending, markDraftSending: hold.markDraftSending,
      deliver: (p, draft) => deliver(p, draft), reportFailure: () => {}, notice: () => {}, record: () => {},
    })
    useScheduledSendTimer(() => store!, dispatch)
    return null
  }
  function App() {
    booted = usePureMailBoot(true)
    return booted.boot ? <Desk initial={booted.boot.store} /> : null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<App />))
  await pass(400)
  return { store: () => store!, save: async () => { await writePersistedMailStore(store!) }, close: () => act(() => root.unmount()) }
}

function interrupted(): { store: MailStore; draftId: string; threadId: string } {
  const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Approved', attachments: [] })
  const store = { ...made.store, drafts: made.store.drafts.map(draft => ({ ...draft, sendAttempt: { id: 'h1', phase: 'held' as const, approved: 'x', at: LONG_AGO } })) }
  return { store: scheduleSend(store, { draftId: made.draftId, threadId: made.threadId, sendAt: LONG_AGO }, LONG_AGO), draftId: made.draftId, threadId: made.threadId }
}

/** A cache from before schedules moved, or one whose later write failed: it still holds the schedule as it was. */
function oldCacheHoldsTheSchedule(): void {
  const cache = JSON.parse(disk.files.get(MAIL_STORE_FILE)!)
  cache.scheduledSends = JSON.parse(disk.files.get('mail-drafts.json')!).scheduledSends
  disk.files.set(MAIL_STORE_FILE, JSON.stringify(cache))
}

beforeEach(() => {
  localStorage.clear()
  disk.files.clear()
  disk.failCache = false
  disk.cacheFile = MAIL_STORE_FILE
  send.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

it('the recovered draft saved and the cache write failed: the old schedule stays off through repeated reopening', async () => {
  const { store, draftId } = interrupted()
  await writePersistedMailStore(store)
  oldCacheHoldsTheSchedule()
  const first = await open()
  expect(send).not.toHaveBeenCalled()
  expect(draftDelivery(first.store(), draftId)).toMatchObject({ state: 'unconfirmed', reason: LOST_HOLD_REASON })
  disk.failCache = true
  await first.save()
  first.close()
  // The cache on disk is the old one: it still says the schedule is live.
  expect(JSON.parse(disk.files.get(MAIL_STORE_FILE)!).scheduledSends[0].status).toBe('scheduled')
  for (let reopening = 0; reopening < 3; reopening += 1) {
    const again = await open()
    await pass(120_000)
    expect(send).not.toHaveBeenCalled()
    expect(again.store().scheduledSends![0]).toMatchObject({ status: 'unconfirmed', lastError: LOST_HOLD_REASON })
    expect(draftDelivery(again.store(), draftId).state).toBe('unconfirmed')
    await again.save()
    again.close()
  }
})

it('a Send later made after that is the person\'s new decision, and goes once', async () => {
  const { store, draftId, threadId } = interrupted()
  await writePersistedMailStore(store)
  oldCacheHoldsTheSchedule()
  const first = await open()
  disk.failCache = true
  const checked = { ...first.store(), drafts: first.store().drafts.map(draft => (draft.id === draftId ? { ...draft, sendState: 'failed' as const, sendError: 'You checked Sent and allowed another attempt.' } : draft)) }
  await writePersistedMailStore(scheduleSend(checked, { draftId, threadId, sendAt: new Date(Date.parse(NOW) + 60_000).toISOString() }))
  first.close()
  const again = await open()
  await pass(0)
  expect(send).not.toHaveBeenCalled()
  await pass(90_000)
  expect(send).toHaveBeenCalledTimes(1)
  await pass(120_000)
  expect(send).toHaveBeenCalledTimes(1)
  again.close()
})

it('a cache-only record from before schedules moved still loads and is still recovered', async () => {
  const { store, draftId } = interrupted()
  await writePersistedMailStore(store)
  oldCacheHoldsTheSchedule()
  const drafts = JSON.parse(disk.files.get('mail-drafts.json')!)
  delete drafts.scheduledSends
  disk.files.set('mail-drafts.json', JSON.stringify(drafts))
  const desk = await open()
  await pass(120_000)
  expect(send).not.toHaveBeenCalled()
  expect(desk.store().scheduledSends![0]!.status).toBe('unconfirmed')
  expect(draftDelivery(desk.store(), draftId).state).toBe('unconfirmed')
  desk.close()
})
