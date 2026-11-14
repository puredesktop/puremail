// @vitest-environment happy-dom
import { lateReceiptAttachmentCases } from '../test/lateReceiptAttachments'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingSend } from '../hooks/usePendingSend'
import { createMailDeliveryController, MailSendError } from './mailDelivery'
import { SUPERSEDED_REASON, draftDelivery, draftReleaseBlock, markDraftSendFailed } from './mailDeliveryStatus'
import { createComposedMessageDraft, emptyMailStore, mergeMailProviderSyncResult } from './mailModel'
import { recoverInterruptedSends, runItemDelivery, settleUndoneHold } from './mailRuns'
import { scheduleSend } from './mailScheduledSend'
import { createStoreDraftSender, sendFailure } from './mailSendRelease'
import { writePersistedMailStore, readSavedMailStore } from './mailPersistence'
import { applyDraftsFileChanges } from './draftsFileMerge'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { executiveDraftIds, executiveDraftState } from './executiveShare'
import { getDraftHandler, listDraftsHandler } from '../agents/handlers'
import type { MailAgentToolContext } from '../agents/catalog'
import type { MailRunItem } from '../types'
const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('../bridge/platformBridge', () => ({
  readPlatformStorageJson: async ({ fileName }: { fileName: string }) => ({ value: disk.has(fileName) ? JSON.parse(disk.get(fileName)!) : null, version: disk.get(fileName) ?? null }),
  writePlatformStorageJson: async ({ fileName, value, ifMatch }: { fileName: string; value: unknown; ifMatch?: string | null }) => {
    if (ifMatch !== undefined && ifMatch !== (disk.get(fileName) ?? null)) return { conflict: true }
    const raw = JSON.stringify(value); disk.set(fileName, raw); return { conflict: false, version: raw }
  },
}))

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
  const deliver = createMailDeliveryController({ read: () => store, update, persist: async () => { const result = await writePersistedMailStore(store); expect(result.draftsWritten).toBe(true); store = applyDraftsFileChanges(store, result.draftChanges) }, prepare, release: () => {}, online: () => true })
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
const afterNewer: Array<[string, Partial<Draft>, 'held' | 'submitting' | 'not_submitted' | 'unconfirmed']> = [
  ['a newer hold', { sendAttempt: NEWER }, 'held'],
  ['a newer preparation', { sendAttempt: { ...NEWER, phase: 'preparing' } }, 'submitting'],
  ['a newer submission', { sendAttempt: { ...NEWER, phase: 'submitting' }, sendMessageId: '<newer@puremail.local>' }, 'submitting'],
  ['a newer attempt undone', { sendAttempt: undefined, sendUndoneAt: '2026-11-02T10:00:21Z', sendSettledAttemptId: 'newer' }, 'not_submitted'],
  ['a newer attempt known not sent', { sendAttempt: undefined, sendState: 'failed', sendError: 'Newer refusal', sendSettledAttemptId: 'newer' }, 'not_submitted'],
  ['a newer attempt left unconfirmed', { sendAttempt: undefined, sendState: 'uncertain', sendError: 'Newer unknown', sendSettledAttemptId: 'newer' }, 'unconfirmed'],
]

beforeEach(() => { disk.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T10:00:00Z')) })
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
    const { attemptId, settle } = await submit(r)
    r.patch({ sendState: undefined, sendError: undefined, sendAttempt: NEWER })
    await act(async () => { settle().reject(new Error('Connection closed after submission')); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()!.sendAttempt?.id).toBe('newer')
    expect(draftDelivery(r.read(), r.draftId).state).toBe('unconfirmed')
    expect(r.current()).toMatchObject({ sendAttempt: NEWER, sendUncertainties: [{ attemptId, reason: 'Connection closed after submission' }] })
    expect(r.current()!.sendState).toBeUndefined()
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
    expect(r.current()).toMatchObject({ sendSettledAttemptId: 'newer', sendUncertainties: [{ attemptId, reason: 'Connection closed after submission' }] })
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

  it.each(afterNewer)('an ambiguous older submission after %s keeps both identities and the newer schedule decision on persisted readback', async (_name, newer) => {
    const r = rig()
    const { attemptId, settle } = await submit(r)
    const olderMessageId = r.current()!.sendMessageId
    r.patch({ sendState: undefined, sendError: undefined, ...newer })
    const current = { ...r.current()! }
    const schedule = structuredClone(r.read().scheduledSends)
    await act(async () => { settle().reject(new Error('Earlier submission unknown')); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()).toMatchObject({ ...current, sendUncertainties: [{ attemptId, reason: 'Earlier submission unknown', messageId: olderMessageId }] })
    const saved = (await readSavedMailStore())!
    expect(saved.drafts.find(draft => draft.id === r.draftId)).toEqual(r.current())
    expect(saved.scheduledSends).toEqual(schedule)
    expect(draftDelivery(saved, r.draftId)).toMatchObject({ state: 'unconfirmed', reason: 'Earlier submission unknown' })
    expect(draftReleaseBlock(saved, r.draftId)?.outcome).toBe('uncertain')
    expect(runItemDelivery(saved, { draftId: r.draftId, status: 'pending' } as MailRunItem).state).toBe('unconfirmed')
    const context = { store: saved } as MailAgentToolContext
    expect(JSON.parse(getDraftHandler(context, { draftId: r.draftId }).content).delivery.state).toBe('unconfirmed')
    expect(JSON.parse(listDraftsHandler(context, {}).content).drafts[0].delivery.state).toBe('unconfirmed')
    const key = 'late-result'
    const ids = executiveDraftIds(key)
    const teamStore = { ...saved, drafts: saved.drafts.map(draft => ({ ...draft, id: ids.draftId })) }
    expect(executiveDraftState(teamStore, { id: 'account' }, key, ids.draftId, null, '2026-11-02T10:00:00Z')?.delivery?.state).toBe('unconfirmed')
    // A later sync receipt identifies the OLD submission even after the current marker changed.
    const old = saved.drafts.find(draft => draft.id === r.draftId)!.sendUncertainties![0]!
    const confirmed = mergeMailProviderSyncResult(saved, { ...saved, drafts: [], messages: [{ id: 'late-synced-receipt', threadId: current.threadId, from: { name: 'Me', email: 'me@example.test' }, to: current.to, subject: current.subject, body: current.body, attachments: [], receivedAt: '2026-11-02T10:02:00Z', read: true, messageIdHeader: old.messageId }] })
    expect(confirmed.drafts.find(draft => draft.id === r.draftId)).toMatchObject(JSON.parse(JSON.stringify(current)))
    expect(confirmed.messages.find(message => message.id === 'late-synced-receipt')).toMatchObject({ deliveryAccepted: true, sentDraftId: r.draftId, sentAttemptId: attemptId })
    expect(draftDelivery(confirmed, r.draftId).state).toBe('submitted')
    const written = await writePersistedMailStore(confirmed)
    expect(written.draftsWritten).toBe(true)
    expect(draftDelivery((await readSavedMailStore())!, r.draftId).state).toBe('submitted')
    expect(r.send).toHaveBeenCalledTimes(1)
    r.close()
  })

  it.each(afterNewer)('a genuine receipt after %s preserves the newer record while every view reads confirmed', async (_name, newer) => {
    const r = rig()
    const { attemptId, settle } = await submit(r)
    r.patch({ sendState: undefined, sendError: undefined, ...newer })
    const current = { ...r.current()! }
    const schedule = structuredClone(r.read().scheduledSends)
    await act(async () => { settle().resolve({ id: 'older-receipt', threadId: current.threadId, from: { name: 'Me', email: 'me@example.test' }, to: current.to, subject: current.subject, body: current.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true }); await vi.advanceTimersByTimeAsync(0) })
    expect(r.current()).toMatchObject(JSON.parse(JSON.stringify(current)))
    const saved = (await readSavedMailStore())!
    expect(saved.drafts.find(draft => draft.id === r.draftId)).toMatchObject(JSON.parse(JSON.stringify(current)))
    expect(saved.messages.find(message => message.sentDraftId === r.draftId)).toMatchObject({ sentAttemptId: attemptId, deliveryAccepted: true })
    expect(saved.scheduledSends).toEqual(schedule)
    expect(draftDelivery(saved, r.draftId).state).toBe('submitted')
    expect(runItemDelivery(saved, { draftId: r.draftId, status: 'pending' } as MailRunItem).state).toBe('submitted')
    const context = { store: saved } as MailAgentToolContext
    expect(JSON.parse(getDraftHandler(context, { draftId: r.draftId }).content).delivery.state).toBe('submitted')
    expect(JSON.parse(listDraftsHandler(context, { includeSent: true }).content).drafts[0].delivery.state).toBe('submitted')
    const key = 'late-receipt', ids = executiveDraftIds(key)
    const teamStore = { ...saved, drafts: saved.drafts.map(draft => ({ ...draft, id: ids.draftId })), messages: saved.messages.map(message => ({ ...message, sentDraftId: ids.draftId })) }
    expect(executiveDraftState(teamStore, { id: 'account' }, key, ids.draftId, null, '2026-11-02T10:00:00Z')?.state).toBe('sent')
    expect(draftReleaseBlock(saved, r.draftId)?.outcome).toBe('not_sent')
    expect(r.send).toHaveBeenCalledTimes(1)
    r.close()
  })

  it('a receipt synced after older uncertainty preserves different later recipients, HTML, attachments and words as an unsent draft of their own', async () => {
    const r = rig()
    const { attemptId, settle } = await submit(r)
    const messageId = r.current()!.sendMessageId
    const file = { id: 'later-file', name: 'later.pdf', mimeType: 'application/pdf', sizeLabel: '1 B', content: 'data:application/pdf;base64,QQ==' }
    r.patch({ sendAttempt: NEWER, sendState: undefined, sendError: undefined, subject: 'Later subject', body: 'Later words', bodyHtml: '<p><b>Later words</b></p>', to: [{ name: 'Bo', email: 'bo@example.test' }], attachments: [file] })
    await act(async () => { settle().reject(new Error('Older result unknown')); await vi.advanceTimersByTimeAsync(0) })
    const saved = (await readSavedMailStore())!
    const received = { id: 'synced-earlier', threadId: r.current()!.threadId, sentAttemptId: attemptId, messageIdHeader: messageId, from: { name: 'Me', email: 'me@example.test' }, to: [{ name: 'Ana', email: 'ana@example.test' }], cc: [], bcc: [], subject: 'Letter', body: 'Same words', attachments: [], receivedAt: '2026-11-02T10:02:00Z', read: true }
    const confirmed = mergeMailProviderSyncResult(saved, { ...saved, drafts: [], messages: [received] })
    const later = confirmed.drafts.find(draft => draft.id !== r.draftId)!
    expect(later).toMatchObject({ subject: 'Later subject', body: 'Later words', bodyHtml: '<p><b>Later words</b></p>', to: [{ email: 'bo@example.test' }], attachments: [file] })
    expect(later.sendAttempt).toBeUndefined()
    expect(draftDelivery(confirmed, later.id).state).toBe('none')
    expect(confirmed.drafts.find(draft => draft.id === r.draftId)).toMatchObject({ body: 'Same words', sendAttempt: NEWER })
    const again = mergeMailProviderSyncResult(confirmed, { ...saved, drafts: [], messages: [received] })
    expect(again.drafts.filter(draft => draft.id !== r.draftId)).toHaveLength(1)
    await writePersistedMailStore(again)
    expect((await readSavedMailStore())!.drafts.find(draft => draft.id === later.id)).toMatchObject({ body: 'Later words', bodyHtml: '<p><b>Later words</b></p>' })
    expect(r.send).toHaveBeenCalledTimes(1)
    r.close()
  })

  it.each(lateReceiptAttachmentCases)('provider receipt sync: %s', async (_name, oldFiles, files, changed) => {
    const r = rig()
    r.patch({ bodyHtml: '<p>Same words</p>', attachments: oldFiles ?? files })
    const { attemptId, settle } = await submit(r)
    const messageId = r.current()!.sendMessageId
    r.patch({ sendAttempt: undefined, sendSettledAttemptId: 'newer', sendUndoneAt: '2026-11-02T10:00:21Z', attachments: files })
    await act(async () => { settle().reject(new Error('Older result unknown')); await vi.advanceTimersByTimeAsync(0) })
    const saved = (await readSavedMailStore())!
    const received = { id: 'attachment-receipt', threadId: r.current()!.threadId, messageIdHeader: messageId, from: { name: 'Me', email: 'me@example.test' }, to: r.current()!.to, cc: [], bcc: [], subject: 'Letter', body: 'Same words', bodyHtml: '<p>Same words</p>', attachments: oldFiles, receivedAt: '2026-11-02T10:02:00Z', read: true } as MailMessage
    let confirmed = mergeMailProviderSyncResult(saved, { ...saved, drafts: [], messages: [received] })
    for (let pass = 0; pass < 3; pass += 1) {
      const evidence = confirmed.drafts.find(draft => draft.id === r.draftId)!
      expect(evidence).toMatchObject({ sendSettledAttemptId: 'newer', sendUndoneAt: '2026-11-02T10:00:21Z' })
      expect(evidence.attachments).toEqual(oldFiles ?? [])
      expect(confirmed.messages.find(message => message.id === received.id)).toMatchObject({ deliveryAccepted: true, sentAttemptId: attemptId, sentDraftId: r.draftId })
      expect(draftDelivery(confirmed, r.draftId).state).toBe('submitted')
      const later = confirmed.drafts.filter(draft => draft.id !== r.draftId)
      expect(later).toHaveLength(changed ? 1 : 0)
      if (changed) {
        expect(later[0]).toMatchObject({ subject: 'Letter', to: r.current()!.to, body: 'Same words', bodyHtml: '<p>Same words</p>', attachments: files })
        expect(later[0].sendAttempt).toBeUndefined()
        expect(draftDelivery(confirmed, later[0].id).state).toBe('none')
        expect(draftReleaseBlock(confirmed, later[0].id)).toBeNull()
        expect(confirmed.scheduledSends!.some(entry => entry.draftId === later[0].id)).toBe(false)
      }
      await writePersistedMailStore(confirmed)
      confirmed = mergeMailProviderSyncResult((await readSavedMailStore())!, { ...saved, drafts: [], messages: [received] })
    }
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
