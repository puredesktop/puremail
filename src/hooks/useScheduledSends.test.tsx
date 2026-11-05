// @vitest-environment happy-dom
import { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMailDeliveryController, MailSendError } from '../lib/mailDelivery'
import { LOST_HOLD_REASON, draftDelivery } from '../lib/mailDeliveryStatus'
import { readPersistedMailStore } from '../lib/mailPersistence'
import { createComposedMessageDraft, emptyMailStore, persistableMailStore } from '../lib/mailModel'
import { settleUndoneHold } from '../lib/mailRuns'
import { answerSendOwnership, settleAbandonedSends } from '../lib/mailSendOwners'
import { scheduleSend } from '../lib/mailScheduledSend'
import { createStoreDraftSender } from '../lib/mailSendRelease'
import type { Draft, DraftSendAttempt, MailMessage, MailProvider, MailStore, ScheduledSend } from '../types'
import { usePendingSend } from './usePendingSend'
import { usePureMailBoot } from './usePureMailBoot'
import { createScheduledSendDispatcher, useScheduledSendTimer } from './useScheduledSends'

vi.mock('../lib/mailPersistence', () => ({ readPersistedMailStore: vi.fn() }))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../bridge/platformBridge')>(),
  fetchGoogleCredentialStatus: vi.fn(async () => ({ connected: true, email: 'me@example.test' })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Windows of one origin hearing each other, as BroadcastChannel delivers: to every other object of that name. */
class FakeChannel {
  static open = new Set<FakeChannel>()
  onmessage: ((event: { data: unknown }) => void) | null = null
  constructor(readonly name: string) { FakeChannel.open.add(this) }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.({ data }))
  }
  close(): void { FakeChannel.open.delete(this) }
}
vi.stubGlobal('BroadcastChannel', FakeChannel)
let onDisk: MailStore | null = null

const NOW = '2026-11-02T12:00:00.000Z'
const LONG_AGO = '2026-11-02T10:00:00.000Z'
const read = vi.mocked(readPersistedMailStore)
const send = vi.fn(async (draft: Draft): Promise<MailMessage> => ({ id: 'accepted', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: NOW, read: true }))
const provider = { send: ({ draft }: { draft: Draft }) => send(draft) } as unknown as MailProvider
const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

/** A prepared draft with a schedule already due, and whatever was saved about its send. */
function saved(patch: Partial<Draft> & { sendAttempt?: DraftSendAttempt } = {}, sendAt = LONG_AGO, undoSeconds: 10 | 30 = 10): { store: MailStore; draftId: string; entryId: string } {
  const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Approved', attachments: [] })
  const store = scheduleSend({ ...made.store, settings: { ...made.store.settings, undoSendDelaySeconds: undoSeconds }, drafts: made.store.drafts.map(draft => ({ ...draft, ...patch })) }, { draftId: made.draftId, threadId: made.threadId, sendAt }, LONG_AGO)
  return { store, draftId: made.draftId, entryId: store.scheduledSends![0]!.id }
}

/** The real boot, recovery, hold, sender, delivery controller, dispatcher and timer, wired as the shell wires them. */
function reopen(from: MailStore | Error, options: { prepare?: (draft: Draft) => Promise<Draft> } = {}) {
  if (!(from instanceof Error)) onDisk = from
  if (from instanceof Error) read.mockRejectedValueOnce(from)
  else read.mockResolvedValueOnce({ store: JSON.parse(JSON.stringify(persistableMailStore(from))), migratedFromLocalStorage: false })
  let store: MailStore | null = null
  let hold!: ReturnType<typeof usePendingSend>
  let sender!: ReturnType<typeof createStoreDraftSender>
  let booted!: ReturnType<typeof usePureMailBoot>
  const update = (updater: (current: MailStore) => MailStore) => { store = updater(store!) }
  function Desk({ initial }: { initial: MailStore }) {
    if (!store) store = initial
    hold = usePendingSend({ undoSendDelaySeconds: store.settings.undoSendDelaySeconds, setCommandNotice: () => {}, onUndone: pending => { if (pending.draftId) update(current => settleUndoneHold(current, pending.draftId!, pending.id)) } })
    const deliver = useRef(createMailDeliveryController({ read: () => store!, update, persist: async () => {}, prepare: options.prepare ?? (async draft => ({ ...draft })), release: () => {}, online: () => true })).current
    sender = createStoreDraftSender({
      read: () => store!, update, provider: () => provider, localAccount: () => false, canCompose: () => true, online: () => true, home: () => 'Fake', undoSeconds: () => store!.settings.undoSendDelaySeconds ?? 10,
      schedule: hold.schedulePendingSend, holdForDraft: hold.holdForDraft, isDraftSending: hold.isDraftSending, markDraftSending: hold.markDraftSending,
      deliver: (p, draft, attempt) => deliver(p, draft, attempt), reportFailure: () => {}, notice: () => {}, record: () => {},
    })
    const dispatch = createScheduledSendDispatcher({
      read: () => store!, update, provider: () => provider, online: () => true, localAccount: () => false, home: () => 'Fake',
      holdForDraft: hold.holdForDraft, isDraftSending: hold.isDraftSending, markDraftSending: hold.markDraftSending,
      deliver: (p, draft) => deliver(p, draft), reportFailure: () => {}, notice: () => {}, record: () => {},
    })
    const mine = (id: string) => Boolean(hold.holdForDraft(id) || hold.isDraftSending(id))
    useEffect(() => answerSendOwnership(id => mine(id)), [])
    useScheduledSendTimer(() => {
      void settleAbandonedSends({ read: () => store!, update, mine, readSaved: async () => onDisk })
      return store!
    }, dispatch)
    return null
  }
  function App() {
    booted = usePureMailBoot(true)
    return booted.boot ? <Desk initial={booted.boot.store} /> : null
  }
  const root = createRoot(document.createElement('div'))
  return {
    start: async () => {
      await act(async () => root.render(<App />))
      await pass(400)
    },
    store: () => store,
    bootError: () => booted.bootError,
    entry: (id: string): ScheduledSend | undefined => store?.scheduledSends?.find(item => item.id === id),
    approve: (draftId: string) => { let out!: ReturnType<typeof sender>; act(() => { out = sender(store!.drafts.find(draft => draft.id === draftId)!, {}) }); return out },
    undo: () => act(() => { hold.undoPendingSend(hold.pendingSends[0]!.id) }),
    update,
    close: () => act(() => root.unmount()),
  }
}

const open = async (from: MailStore | Error, options: { prepare?: (draft: Draft) => Promise<Draft> } = {}) => { const desk = reopen(from, options); await desk.start(); return desk }

beforeEach(() => {
  localStorage.clear()
  send.mockClear()
  read.mockReset()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

describe('reopening Mail with a schedule on an interrupted draft', () => {
  it('a lost hold: no service call on reopening or reopening again, and only a new decision sends', async () => {
    const { store, draftId, entryId } = saved({ sendAttempt: { id: 'h1', phase: 'held', approved: 'x', at: LONG_AGO } })
    const first = await open(store)
    await pass(600_000)
    expect(send).not.toHaveBeenCalled()
    expect(draftDelivery(first.store()!, draftId)).toMatchObject({ state: 'unconfirmed', reason: LOST_HOLD_REASON })
    expect(first.entry(entryId)).toMatchObject({ status: 'unconfirmed', lastError: LOST_HOLD_REASON })
    const again = first.store()!
    first.close()
    const second = await open(again)
    await pass(600_000)
    expect(send).not.toHaveBeenCalled()
    expect(second.approve(draftId)).toMatchObject({ ok: false })
    // The recovery panel's "I checked Sent — allow retry", then a fresh approval.
    second.update(current => ({ ...current, drafts: current.drafts.map(draft => (draft.id === draftId ? { ...draft, sendState: 'failed' as const, sendError: 'You checked Sent and allowed another attempt.' } : draft)) }))
    expect(second.approve(draftId)).toMatchObject({ ok: true })
    await pass(10_000)
    expect(send).toHaveBeenCalledTimes(1)
    await pass(600_000)
    expect(send).toHaveBeenCalledTimes(1)
    second.close()
  })

  it('a preparation cut off: same', async () => {
    const { store, draftId, entryId } = saved({ sendAttempt: { id: 'h1', phase: 'preparing', approved: 'x', at: LONG_AGO } })
    const desk = await open(store)
    await pass(120_000)
    expect(send).not.toHaveBeenCalled()
    expect(draftDelivery(desk.store()!, draftId).state).toBe('unconfirmed')
    expect(desk.entry(entryId)!.status).toBe('unconfirmed')
    desk.close()
  })

  it('an ambiguous submission: no service call, unconfirmed, and no ordinary attempt either', async () => {
    const { store, draftId, entryId } = saved({ sendState: 'uncertain', sendError: 'pending', sendAttempt: { id: 'h1', phase: 'submitting', approved: 'x', at: LONG_AGO } })
    const desk = await open(store)
    await pass(600_000)
    expect(send).not.toHaveBeenCalled()
    expect(draftDelivery(desk.store()!, draftId).state).toBe('unconfirmed')
    expect(desk.entry(entryId)!.status).toBe('unconfirmed')
    expect(desk.approve(draftId)).toMatchObject({ ok: false })
    await pass(60_000)
    expect(send).not.toHaveBeenCalled()
    desk.close()
  })

  it('a scheduled dispatch cut off with no marker: no service call, and it cannot read as not sent', async () => {
    const made = saved()
    const store = { ...made.store, scheduledSends: made.store.scheduledSends!.map(entry => ({ ...entry, status: 'sending' as const })) }
    const desk = await open(store)
    await pass(120_000)
    expect(send).not.toHaveBeenCalled()
    expect(draftDelivery(desk.store()!, made.draftId).state).toBe('unconfirmed')
    expect(desk.entry(made.entryId)!.status).toBe('unconfirmed')
    desk.close()
  })

  it('a failed load settles nothing and sends nothing', async () => {
    const desk = await open(new Error('Your saved drafts could not be read.'))
    await pass(600_000)
    expect(desk.store()).toBeNull()
    expect(desk.bootError()).not.toBeNull()
    expect(send).not.toHaveBeenCalled()
    desk.close()
  })

  it.each([
    ['moments old', () => new Date(Date.parse(NOW) - 5000).toISOString()],
    ['ancient', () => LONG_AGO],
    ['from a clock ahead', () => new Date(Date.parse(NOW) + 86_400_000).toISOString()],
    ['with an unreadable time', () => 'not a time'],
  ])('an attempt no window claims, %s: unconfirmed at once and through every reopening, with no service call', async (_name, at) => {
    const { store, draftId, entryId } = saved({ sendAttempt: { id: 'h1', phase: 'held', approved: 'x', at: at() } })
    let current = store
    for (let opening = 0; opening < 3; opening += 1) {
      const desk = await open(current)
      expect(draftDelivery(desk.store()!, draftId).state).toBe('unconfirmed')
      expect(desk.entry(entryId)!.status).toBe('unconfirmed')
      expect(desk.approve(draftId)).toMatchObject({ ok: false })
      await pass(600_000)
      expect(send).not.toHaveBeenCalled()
      current = desk.store()!
      desk.close()
    }
  })

  it('a dispatch cut off after an older failure: that failure is not this dispatch\'s, so it cannot read as not sent', async () => {
    const made = saved({ sendState: 'failed', sendError: 'An older refusal', sendSettledAttemptId: 'older' })
    const desk = await open({ ...made.store, scheduledSends: made.store.scheduledSends!.map(entry => ({ ...entry, status: 'sending' as const })) })
    await pass(120_000)
    expect(send).not.toHaveBeenCalled()
    expect(draftDelivery(desk.store()!, made.draftId).state).toBe('unconfirmed')
    expect(desk.entry(made.entryId)!.status).toBe('unconfirmed')
    desk.close()
  })

  it('a schedule on a draft with no interrupted send still goes at its time, once', async () => {
    const { store, draftId, entryId } = saved()
    const desk = await open(store)
    await pass(0)
    expect(send).toHaveBeenCalledTimes(1)
    await pass(120_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(desk.entry(entryId)!.status).toBe('sent')
    expect(draftDelivery(desk.store()!, draftId).state).toBe('submitted')
    desk.close()
  })
})

describe('two Mail windows open on one store', () => {
  it('a preparation outlasting any age limit is not called dead by the other window, which then reports how it really ended', async () => {
    const { store, draftId } = saved({}, new Date(Date.parse(NOW) + 3_600_000).toISOString())
    let ready!: () => void
    const first = await open(store, { prepare: draft => new Promise(resolve => { ready = () => resolve({ ...draft }) }) })
    first.approve(draftId)
    await pass(10_000)
    expect(first.store()!.drafts[0]!.sendAttempt?.phase).toBe('preparing')
    await pass(300_000)
    const second = await open(first.store()!)
    expect(draftDelivery(second.store()!, draftId).state).toBe('submitting')
    await pass(120_000)
    expect(draftDelivery(second.store()!, draftId).state).toBe('submitting')
    expect(second.approve(draftId)).toMatchObject({ ok: true, already: 'submitting' })
    expect(send).not.toHaveBeenCalled()
    await act(async () => { ready(); await vi.advanceTimersByTimeAsync(0) })
    expect(send).toHaveBeenCalledTimes(1)
    expect(draftDelivery(first.store()!, draftId).state).toBe('submitted')
    onDisk = first.store()
    await pass(120_000)
    expect(draftDelivery(second.store()!, draftId).state).toBe('submitted')
    expect(send).toHaveBeenCalledTimes(1)
    first.close()
    second.close()
  })

  it('a window that says nothing and left no record of the outcome reads as unconfirmed, never as nothing sent', async () => {
    const { store, draftId } = saved({ sendAttempt: { id: 'h1', phase: 'held', approved: 'x', at: LONG_AGO } }, new Date(Date.parse(NOW) + 3_600_000).toISOString())
    const desk = reopen({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendAttempt: { ...draft.sendAttempt!, at: new Date(Date.parse(NOW) - 5000).toISOString() } })) })
    await desk.start()
    onDisk = { ...store, drafts: [] }
    await pass(120_000)
    expect(draftDelivery(desk.store()!, draftId).state).toBe('unconfirmed')
    expect(send).not.toHaveBeenCalled()
    desk.close()
  })

  it('a failed read of the saved record settles nothing', async () => {
    const { store, draftId } = saved({ sendAttempt: { id: 'h1', phase: 'held', approved: 'x', at: new Date(Date.parse(NOW) - 5000).toISOString() } }, new Date(Date.parse(NOW) + 3_600_000).toISOString())
    const clean = { ...store, drafts: store.drafts.map(draft => ({ ...draft, sendAttempt: undefined })) }
    const desk = await open(clean)
    // What this window learned of another's send since it opened.
    desk.update(current => ({ ...current, drafts: store.drafts }))
    onDisk = null
    await pass(120_000)
    expect(draftDelivery(desk.store()!, draftId).state).toBe('held')
    desk.close()
  })

  describe.each([
    ['a suspended window, silent on the channel', () => { for (const channel of [...FakeChannel.open]) channel.onmessage = null }],
    ['no channel at all', () => { vi.stubGlobal('BroadcastChannel', undefined) }],
    ['a channel that cannot be opened', () => { vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('blocked') } }) }],
  ])('%s', (_name, silence) => {
    afterEach(() => { vi.stubGlobal('BroadcastChannel', FakeChannel) })

    it('its possible send is never known not sent or resent; waking before it has read the other\'s save, it goes once and the receipt stands (twoCopies.test.ts has it read that save)', async () => {
      const { store, draftId } = saved({}, new Date(Date.parse(NOW) + 3_600_000).toISOString())
      let ready!: () => void
      const asleep = await open(store, { prepare: draft => new Promise(resolve => { ready = () => resolve({ ...draft }) }) })
      asleep.approve(draftId)
      await pass(10_000)
      expect(asleep.store()!.drafts[0]!.sendAttempt?.phase).toBe('preparing')
      silence()
      const other = await open(asleep.store()!)
      expect(draftDelivery(other.store()!, draftId).state).toBe('unconfirmed')
      expect(other.approve(draftId)).toMatchObject({ ok: false })
      await pass(600_000)
      expect(draftDelivery(other.store()!, draftId).state).toBe('unconfirmed')
      expect(send).not.toHaveBeenCalled()
      await act(async () => { ready(); await vi.advanceTimersByTimeAsync(0) })
      expect(send).toHaveBeenCalledTimes(1)
      expect(draftDelivery(asleep.store()!, draftId).state).toBe('submitted')
      asleep.close()
      other.close()
    })
  })
})

describe('a schedule falling due while a send of the draft is live', () => {
  // The timer ticks at 30s: approved at 15s, a 30s hold is open across that tick with the schedule already due.
  const soon = new Date(Date.parse(NOW) + 5000).toISOString()

  it('waits out a hold and goes only as that one approved send', async () => {
    const { store, draftId, entryId } = saved({}, soon, 30)
    const desk = await open(store)
    await pass(15_000)
    desk.approve(draftId)
    await pass(20_000)
    expect(send).not.toHaveBeenCalled()
    await pass(15_000)
    expect(send).toHaveBeenCalledTimes(1)
    await pass(120_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(desk.entry(entryId)!.status).toBe('sent')
    desk.close()
  })

  it('Undo stops the schedule too: it does not send what the person just stopped', async () => {
    const { store, draftId, entryId } = saved({}, soon, 30)
    const desk = await open(store)
    await pass(15_000)
    desk.approve(draftId)
    await pass(20_000)
    desk.undo()
    await pass(600_000)
    expect(send).not.toHaveBeenCalled()
    expect(desk.entry(entryId)!.status).toBe('cancelled')
    expect(draftDelivery(desk.store()!, draftId).state).toBe('not_submitted')
    desk.close()
  })

  it('an approved attempt known not to have left does not hand the draft to the schedule', async () => {
    const { store, draftId, entryId } = saved({}, soon, 30)
    const desk = await open(store)
    await pass(15_000)
    send.mockRejectedValueOnce(new MailSendError('Authentication rejected', 'not_sent'))
    desk.approve(draftId)
    await pass(31_000)
    expect(send).toHaveBeenCalledTimes(1)
    await pass(600_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(desk.entry(entryId)).toMatchObject({ status: 'failed', lastError: 'Authentication rejected' })
    expect(draftDelivery(desk.store()!, draftId).state).toBe('not_submitted')
    desk.close()
  })

  it('a new Send later after a known failure is the person\'s decision, and goes', async () => {
    const { store, draftId } = saved({ sendState: 'failed', sendError: 'Authentication rejected', sendSettledAttemptId: 'old' })
    const desk = await open(store)
    await pass(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect(draftDelivery(desk.store()!, draftId).state).toBe('submitted')
    desk.close()
  })

  it('an uncertain submission cannot be retried by the schedule', async () => {
    const { store, draftId, entryId } = saved({}, soon, 30)
    const desk = await open(store)
    await pass(15_000)
    send.mockRejectedValueOnce(new Error('Connection closed after submission'))
    desk.approve(draftId)
    await pass(31_000)
    expect(send).toHaveBeenCalledTimes(1)
    await pass(600_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(draftDelivery(desk.store()!, draftId).state).toBe('unconfirmed')
    expect(desk.entry(entryId)!.status).toBe('unconfirmed')
    desk.close()
  })
})
