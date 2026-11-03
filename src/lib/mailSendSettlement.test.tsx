// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingSend } from '../hooks/usePendingSend'
import { createMailDeliveryController, MailSendError } from './mailDelivery'
import { SUPERSEDED_REASON, draftDelivery, markDraftSendFailed } from './mailDeliveryStatus'
import { createComposedMessageDraft, emptyMailStore } from './mailModel'
import { recoverInterruptedSends, settleUndoneHold } from './mailRuns'
import { scheduleSend } from './mailScheduledSend'
import { createStoreDraftSender, sendFailure } from './mailSendRelease'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The real delivery controller, sender and hold, a fake mail service, and a
 * record a second actor can change while a send is in the air: what another
 * window saving, or the same window's later decision, does to an older attempt.
 */
function rig() {
  const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Same words', attachments: [] })
  let store: MailStore = scheduleSend(made.store, { draftId: made.draftId, threadId: made.threadId, sendAt: '2026-11-03T10:00:00Z' }, '2026-11-02T09:00:00Z')
  const update = (updater: (current: MailStore) => MailStore) => { store = updater(store) }
  const send = vi.fn(async (draft: Draft): Promise<MailMessage> => ({ id: 'accepted', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true }))
  const provider = { send: ({ draft }: { draft: Draft }) => send(draft) } as unknown as MailProvider
  const prepared: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
  const prepare = vi.fn((draft: Draft) => new Promise<Draft>((resolve, reject) => { prepared.push({ resolve: () => resolve({ ...draft }), reject }) }))
  const deliver = createMailDeliveryController({ read: () => store, update, persist: async () => {}, prepare, release: () => {}, online: () => true })
  let hold!: ReturnType<typeof usePendingSend>
  function Window() {
    hold = usePendingSend({ undoSendDelaySeconds: 10, setCommandNotice: () => {}, onUndone: pending => { if (pending.draftId) update(current => settleUndoneHold(current, pending.draftId!, pending.id)) } })
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Window />))
  const notices: string[] = []
  const failed: Array<{ outcome: string; attemptId: string }> = []
  const sender = createStoreDraftSender({
    read: () => store, update, provider: () => provider, localAccount: () => false, canCompose: () => true, online: () => true, home: () => 'Fake', undoSeconds: () => 10,
    schedule: (...args) => hold.schedulePendingSend(...args), holdForDraft: id => hold.holdForDraft(id), isDraftSending: id => hold.isDraftSending(id), markDraftSending: (id, on) => hold.markDraftSending(id, on),
    deliver: (p, draft, attempt) => deliver(p, draft, attempt), reportFailure: (id, reason) => update(current => markDraftSendFailed(current, id, reason)), notice: text => notices.push(text), record: () => {},
  })
  const current = () => store.drafts.find(draft => draft.id === made.draftId)
  const patch = (next: Partial<Draft>) => update(s => ({ ...s, drafts: s.drafts.map(draft => (draft.id === made.draftId ? { ...draft, ...next } : draft)) }))
  const pass = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  return {
    draftId: made.draftId, read: () => store, current, patch, send, provider, deliver, notices, failed, pass, prepared: () => prepared,
    /** Approve through the sender and take it past the hold, into preparation. */
    approveIntoPreparation: async () => {
      act(() => { sender(current()!, { onFailed: (_reason, outcome, attemptId) => failed.push({ outcome, attemptId }) }) })
      const attemptId = current()!.sendAttempt!.id
      await pass(10_000)
      expect(current()!.sendAttempt).toMatchObject({ id: attemptId, phase: 'preparing' })
      return attemptId
    },
    schedules: () => store.scheduledSends!.map(entry => entry.status),
    close: () => act(() => root.unmount()),
  }
}

const NEWER = { id: 'newer', phase: 'held' as const, approved: 'identical-content', at: '2026-11-02T10:00:20Z' }
const afterNewer: Array<[string, Partial<Draft>, 'held' | 'not_submitted' | 'unconfirmed']> = [
  ['a newer hold', { sendAttempt: NEWER }, 'held'],
  ['a newer attempt undone', { sendAttempt: undefined, sendUndoneAt: '2026-11-02T10:00:21Z', sendSettledAttemptId: 'newer' }, 'not_submitted'],
  ['a newer attempt known not sent', { sendAttempt: undefined, sendState: 'failed', sendError: 'Newer refusal', sendSettledAttemptId: 'newer' }, 'not_submitted'],
  ['a newer attempt left unconfirmed', { sendAttempt: undefined, sendState: 'uncertain', sendError: 'Newer unknown', sendSettledAttemptId: 'newer' }, 'unconfirmed'],
]

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T10:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe.each(afterNewer)('an older attempt ending after %s, with the same content', (_name, newer, state) => {
  const expectUntouched = (r: ReturnType<typeof rig>) => {
    expect(r.current()).toMatchObject(newer)
    expect(r.current()!.sendAttempt?.id).toBe(newer.sendAttempt?.id)
    expect(draftDelivery(r.read(), r.draftId).state).toBe(state)
    expect(draftDelivery(r.read(), r.draftId).reason).toBe(newer.sendError ?? (newer.sendUndoneAt ? 'The send was undone. Nothing was sent.' : undefined))
    expect(r.schedules()).toEqual(['scheduled'])
  }

  it('through the sender: its preparation failing changes nothing, and is reported as about the earlier attempt', async () => {
    const r = rig()
    await r.approveIntoPreparation()
    r.patch(newer)
    await act(async () => { r.prepared()[0]!.reject(new Error('Attachment fetch failed')); await vi.advanceTimersByTimeAsync(0) })
    expectUntouched(r)
    expect(r.send).not.toHaveBeenCalled()
    expect(r.failed.at(-1)!.outcome).toBe('not_sent')
    expect(r.notices.at(-1)).toMatch(/This send of the draft did not go/)
    expect(r.notices.join()).not.toMatch(/Could not send/)
    r.close()
  })

  it('through the sender: its preparation finishing leaves it unsent, with no service call', async () => {
    const r = rig()
    await r.approveIntoPreparation()
    r.patch(newer)
    await act(async () => { r.prepared()[0]!.resolve(); await vi.advanceTimersByTimeAsync(0) })
    expectUntouched(r)
    expect(r.send).not.toHaveBeenCalled()
    r.close()
  })

  it('through the sender: a definite refusal from the service changes nothing', async () => {
    const r = rig()
    let refuse!: (error: unknown) => void
    r.send.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject }))
    await r.approveIntoPreparation()
    await act(async () => { r.prepared()[0]!.resolve(); await vi.advanceTimersByTimeAsync(0) })
    expect(r.send).toHaveBeenCalledTimes(1)
    r.patch({ sendState: undefined, sendError: undefined, ...newer })
    await act(async () => { refuse(new MailSendError('Authentication rejected', 'not_sent')); await vi.advanceTimersByTimeAsync(0) })
    expectUntouched(r)
    r.close()
  })

  it('a schedule\'s own dispatch, which names no attempt: same', async () => {
    const r = rig()
    const going = r.deliver(r.provider, r.current()!)
    await r.pass()
    r.patch(newer)
    r.prepared()[0]!.reject(new Error('Attachment fetch failed'))
    await expect(going).rejects.toMatchObject({ superseded: true, outcome: 'not_sent' })
    expectUntouched(r)
    const report = sendFailure(r.read(), r.draftId, await going.catch(error => error), 'Fake', 'saved')
    expect(report.outcome).toBe('not_sent')
    r.close()
  })
})

describe('what an older attempt keeps', () => {
  const submit = async (r: ReturnType<typeof rig>) => {
    let settle!: { resolve: (message: MailMessage) => void; reject: (error: unknown) => void }
    r.send.mockReturnValue(new Promise((resolve, reject) => { settle = { resolve, reject } }))
    const attemptId = await r.approveIntoPreparation()
    await act(async () => { r.prepared()[0]!.resolve(); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()!.sendAttempt).toMatchObject({ id: attemptId, phase: 'submitting' })
    return { attemptId, settle: () => settle }
  }

  it('its genuine uncertainty under a newer hold: the hold keeps its identity, but cannot leave, and the draft ends unconfirmed', async () => {
    const r = rig()
    const { settle } = await submit(r)
    r.patch({ sendState: undefined, sendError: undefined, sendAttempt: NEWER })
    await act(async () => { settle().reject(new Error('Connection closed after submission')); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()!.sendAttempt?.id).toBe('newer')
    expect(draftDelivery(r.read(), r.draftId).state).toBe('held')
    expect(r.current()).toMatchObject({ sendState: 'uncertain', sendError: 'Connection closed after submission' })
    expect(r.failed.at(-1)!.outcome).toBe('uncertain')
    expect(r.notices.at(-1)).toMatch(/did not confirm an earlier send/)
    // The newer attempt's own end cannot wipe that out.
    r.patch({ sendAttempt: undefined })
    expect(draftDelivery(r.read(), r.draftId)).toMatchObject({ state: 'unconfirmed', reason: 'Connection closed after submission' })
    r.close()
  })

  it('its genuine uncertainty after a newer attempt ended: it may have gone, so it reads unconfirmed under its own identity', async () => {
    const r = rig()
    const { attemptId, settle } = await submit(r)
    r.patch({ sendState: undefined, sendError: undefined, sendAttempt: undefined, sendUndoneAt: '2026-11-02T10:00:21Z', sendSettledAttemptId: 'newer' })
    await act(async () => { settle().reject(new Error('Connection closed after submission')); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()).toMatchObject({ sendState: 'uncertain', sendSettledAttemptId: attemptId })
    expect(draftDelivery(r.read(), r.draftId).state).toBe('unconfirmed')
    r.close()
  })

  it('its receipt after a newer hold on the same content: confirmed stays confirmed, and nothing goes twice', async () => {
    const r = rig()
    const { attemptId, settle } = await submit(r)
    r.patch({ sendState: undefined, sendError: undefined, sendAttempt: NEWER })
    await act(async () => { settle().resolve({ id: 'accepted', threadId: r.current()!.threadId, from: { name: 'Me', email: 'me@example.test' }, to: [], subject: 'Letter', body: 'Same words', attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true }); await vi.advanceTimersByTimeAsync(0) })
    expect(r.read().messages.find(message => message.sentDraftId === r.draftId)).toMatchObject({ sentAttemptId: attemptId, deliveryAccepted: true })
    expect(draftDelivery(r.read(), r.draftId).state).toBe('submitted')
    await r.pass(60_000)
    expect(r.send).toHaveBeenCalledTimes(1)
    r.close()
  })

  it('its own failure, with nothing newer: settled as before, and its schedule stopped', async () => {
    const r = rig()
    const attemptId = await r.approveIntoPreparation()
    await act(async () => { r.prepared()[0]!.reject(new Error('Attachment fetch failed')); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()).toMatchObject({ sendState: 'failed', sendError: 'Attachment fetch failed', sendSettledAttemptId: attemptId })
    expect(r.schedules()).toEqual(['failed'])
    expect(r.notices.at(-1)).toMatch(/Could not send/)
    r.close()
  })

  it('another window read it as unconfirmed while it slept: on waking it stops, and its own record shows nothing left', async () => {
    const r = rig()
    const attemptId = await r.approveIntoPreparation()
    // The other window's own pass, over a saved snapshot of this send, taken in here as a save would.
    const seen = recoverInterruptedSends(r.read())
    expect(draftDelivery(seen, r.draftId).state).toBe('unconfirmed')
    r.patch(seen.drafts.find(draft => draft.id === r.draftId)!)
    await act(async () => { r.prepared()[0]!.resolve(); await vi.advanceTimersByTimeAsync(0) })
    expect(r.send).not.toHaveBeenCalled()
    expect(r.current()).toMatchObject({ sendState: 'failed', sendError: SUPERSEDED_REASON, sendSettledAttemptId: attemptId })
    expect(draftDelivery(r.read(), r.draftId).state).toBe('not_submitted')
    r.close()
  })

  it('a save that takes this send over between the marker and the service stops it there', async () => {
    const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Same words', attachments: [] })
    let store: MailStore = made.store
    const update = (updater: (current: MailStore) => MailStore) => { store = updater(store) }
    const send = vi.fn()
    const persist = vi.fn(async () => { update(s => ({ ...s, drafts: s.drafts.map(draft => ({ ...draft, sendAttempt: NEWER, sendState: undefined, sendError: undefined })) })) })
    const deliver = createMailDeliveryController({ read: () => store, update, persist, prepare: async draft => ({ ...draft }), release: () => {}, online: () => true })
    await expect(deliver({ send } as unknown as MailProvider, store.drafts[0]!)).rejects.toMatchObject({ superseded: true, outcome: 'not_sent' })
    expect(send).not.toHaveBeenCalled()
    expect(store.drafts[0]!.sendAttempt).toEqual(NEWER)
  })
})
