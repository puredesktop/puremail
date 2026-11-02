// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDraftHandler, listDraftsHandler, sendDraftHandler, updateDraftHandler, discardDraftHandler } from '../agents/handlers'
import { getRunHandler, sendRunItemHandler, skipRunItemHandler } from '../agents/runHandlers'
import type { MailAgentToolContext } from '../agents/catalog'
import { usePendingSend } from '../hooks/usePendingSend'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
import { createMailDeliveryController, MailSendError } from './mailDelivery'
import { CHANGED_REASON, LOST_HOLD_REASON, deliveryNote, draftDelivery } from './mailDeliveryStatus'
import { draftEditVersion, draftSendFingerprint } from './mailDrawerDrafts'
import { EXECUTIVE_TAKEN_DIR, executiveDraftIds, executiveDraftState, parseDraftState, reportExecutiveDraftStates, type ExecutiveShareFiles } from './executiveShare'
import { createComposedMessageDraft, emptyMailStore, persistableMailStore } from './mailModel'
import { createRunFromDrafts, markRunItemCommitted, markRunItemUnconfirmed, markRunItemUnsent, reconcileRun, recoverInterruptedSends, replaceRun, runItemDelivery, runProgress, runSummaryLine, settleUndoneHold, startRun } from './mailRuns'
import { composeHoldStillApproved, createStoreDraftSender } from './mailSendRelease'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const parse = (result: { content: string }): any => JSON.parse(result.content)
const accepted = (draft: Draft): MailMessage => ({ id: 'accepted-1', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true, messageIdHeader: draft.sendMessageId })

/** The real hold, sender and delivery controller over a store in memory, a fake mail service and fake timers. */
function rig(options: { undoSeconds?: number; drafts?: number; run?: boolean } = {}) {
  let store: MailStore = emptyMailStore()
  const ids: string[] = []
  for (let n = 0; n < (options.drafts ?? 1); n += 1) {
    const made = createComposedMessageDraft(store, { to: [{ name: 'Ana', email: `ana${n}@example.test` }, { name: 'Bo', email: 'bo@example.test' }], subject: `Letter ${n}`, body: `Body ${n}`, attachments: [] })
    store = made.store
    // The first is the kind of draft the team's share reports on.
    const id = n === 0 ? executiveDraftIds('cos-k-1').draftId : made.draftId
    store = { ...store, drafts: store.drafts.map(item => (item.id === made.draftId ? { ...item, id } : item)) }
    ids.push(id)
  }
  const persisted: MailStore[] = []
  const persist = vi.fn(async (snapshot: MailStore) => { persisted.push(JSON.parse(JSON.stringify(persistableMailStore(snapshot)))) })
  const send = vi.fn(async (draft: Draft): Promise<MailMessage> => accepted(draft))
  const provider = { send: ({ draft }: { draft: Draft }) => send(draft) } as unknown as MailProvider
  const read = () => store
  const update = (updater: (current: MailStore) => MailStore) => { store = updater(store) }
  const record = vi.fn()
  const notice = vi.fn()
  const deliver = createMailDeliveryController({ read, update, persist, prepare: async draft => ({ ...draft }), release: () => {}, online: () => true })
  let hold!: ReturnType<typeof usePendingSend>
  const undoSeconds = options.undoSeconds ?? 10
  function Harness() {
    hold = usePendingSend({ undoSendDelaySeconds: undoSeconds, setCommandNotice: notice, onUndone: pending => { if (pending.draftId) update(current => settleUndoneHold(current, pending.draftId!, pending.id, '2026-11-02T10:00:00Z')) } })
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Harness />))
  const sender = createStoreDraftSender({
    read, update, provider: () => provider, localAccount: () => false, canCompose: () => true, online: () => true, home: () => 'Fake', undoSeconds: () => undoSeconds,
    schedule: (...args) => hold.schedulePendingSend(...args), holdForDraft: id => hold.holdForDraft(id), isDraftSending: id => hold.isDraftSending(id), markDraftSending: (id, on) => hold.markDraftSending(id, on),
    deliver: (p, draft, attempt) => deliver(p, draft, attempt), reportFailure: () => {}, notice, record,
  })
  let runId = ''
  if (options.run) {
    const made = createRunFromDrafts(store, { name: 'Letters', accountId: 'account', draftIds: store.drafts.map(draft => draft.id) }, '2026-11-02T09:00:00Z')
    store = made.store
    runId = made.run.id
    store = replaceRun(store, startRun(made.run, '2026-11-02T09:00:00Z'))
  }
  const context = {
    get store() { return store },
    set store(next: MailStore) { store = next },
    accountId: 'account', now: new Date('2026-11-02T10:00:00Z'), currentQuery: '', selectedThread: null,
    setStore: update, showQuery: () => {}, applyAction: () => {}, listMailOperations: async () => [], addTaskForThread: () => {}, requestDraftForThread: async () => { throw new Error('n/a') }, noteAgentSearch: () => {},
    sendStoreDraft: sender,
    editDraft: (draftId: string, patch: { body?: string }) => { update(current => ({ ...current, drafts: current.drafts.map(item => item.id === draftId ? { ...item, ...patch, updatedAt: '2026-11-02T10:00:09Z' } : item) })); return { ok: true as const } },
    discardDraft: () => ({ ok: true as const }),
  } as unknown as MailAgentToolContext
  return { read, update, send, persist, persisted, ids, draftId: ids[0]!, context, runId, record, notice, hold: () => hold, unmount: () => act(() => root.unmount()) }
}
type Rig = ReturnType<typeof rig>
const elapse = async (ms = 10000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const inAct = <T,>(fn: () => T): T => {
  let out!: T
  act(() => { out = fn() })
  return out
}
const approve = (r: Rig, id = r.draftId) => inAct(() => parse(sendDraftHandler(r.context, { draftId: id })))
const approveItem = (r: Rig) => inAct(() => parse(sendRunItemHandler(r.context, { runId: r.runId })))

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T10:00:00Z')) })
afterEach(() => vi.useRealTimers())

const shared = (r: Rig) => executiveDraftState(r.read(), { id: 'account' }, 'cos-k-1', r.draftId, null, '2026-11-02T10:00:30Z')!

describe('one reading of a send, in every view', () => {
  const cases: Array<[string, (r: Rig) => Promise<void>, { state: string; sharedState: string; sent: number; leaving: number; unconfirmed: number; toGo: number; agentState: string }]> = [
    ['held', async r => { approveItem(r) }, { state: 'held', sharedState: 'draft', sent: 0, leaving: 1, unconfirmed: 0, toGo: 0, agentState: 'held' }],
    ['submitting', async r => { r.send.mockReturnValue(new Promise(() => {})); approveItem(r); await elapse() }, { state: 'submitting', sharedState: 'draft', sent: 0, leaving: 1, unconfirmed: 0, toGo: 0, agentState: 'submitting' }],
    ['known not submitted', async r => { r.send.mockRejectedValue(new MailSendError('Authentication rejected', 'not_sent')); approveItem(r); await elapse() }, { state: 'not_submitted', sharedState: 'draft', sent: 0, leaving: 0, unconfirmed: 0, toGo: 1, agentState: 'not_sent' }],
    ['unconfirmed', async r => { r.send.mockRejectedValue(new Error('Connection closed after submission')); approveItem(r); await elapse() }, { state: 'unconfirmed', sharedState: 'draft', sent: 0, leaving: 0, unconfirmed: 1, toGo: 0, agentState: 'unconfirmed' }],
    ['conflict', async r => { r.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, syncState: 'conflict' as const })) })) }, { state: 'conflict', sharedState: 'draft', sent: 0, leaving: 0, unconfirmed: 0, toGo: 1, agentState: 'conflict' }],
    ['confirmed', async r => { approveItem(r); await elapse() }, { state: 'submitted', sharedState: 'sent', sent: 1, leaving: 0, unconfirmed: 0, toGo: 0, agentState: 'sent' }],
  ]
  it.each(cases)('%s', async (_name, arrange, want) => {
    const r = rig({ run: true })
    await arrange(r)
    const run = r.read().runs!.find(item => item.id === r.runId)!
    expect(draftDelivery(r.read(), r.draftId).state).toBe(want.state)
    expect(runItemDelivery(r.read(), run.items[0]!).state).toBe(want.state)
    expect(runProgress(run, r.read())).toMatchObject({ sent: want.sent, leaving: want.leaving, unconfirmed: want.unconfirmed, toGo: want.toGo })
    expect(parse(getRunHandler(r.context, { runId: r.runId })).items[0].delivery.state).toBe(want.state)
    const team = shared(r)
    expect(team.state).toBe(want.sharedState)
    expect(team.delivery?.state).toBe(want.state)
    if (want.state !== 'submitted') {
      const agent = parse(getDraftHandler(r.context, { draftId: r.draftId }))
      expect(agent.state).toBe(want.agentState)
      expect(agent.delivery.state).toBe(want.state)
      expect(parse(listDraftsHandler(r.context, {})).drafts[0].delivery.state).toBe(want.state)
    }
    if (want.sent === 0) expect(runSummaryLine(run)).toContain('0 sent')
    r.unmount()
  })

  it('confirmed says what it means: accepted by the service, not received or read', async () => {
    const r = rig()
    approve(r)
    await elapse()
    expect(draftDelivery(r.read(), r.draftId).state).toBe('submitted')
    const again = () => sendDraftHandler(r.context, { draftId: r.draftId })
    expect(again).toThrow('sent already')
    const answered = rig({ undoSeconds: 0 })
    const out = approve(answered)
    expect(out.delivery.state).toBe('submitting')
    expect(out.status).toBe('queued')
    expect(out.note).not.toMatch(/^Sent/)
    expect(deliveryNote({ state: 'submitted' })).toBe('Sent: the mail service accepted it. That does not show it was received or read.')
    const kept = rig()
    kept.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, sentAt: '2026-11-02T10:00:00Z' })) }))
    expect(parse(getDraftHandler(kept.context, { draftId: kept.draftId }))).toMatchObject({ state: 'sent', delivery: { state: 'submitted', note: deliveryNote({ state: 'submitted' }) } })
    r.unmount(); answered.unmount(); kept.unmount()
  })

  it('a queued answer is never a sent claim, and the log names every recipient only once it is confirmed', async () => {
    const r = rig()
    const out = approve(r)
    expect(out).toMatchObject({ status: 'queued', undoSeconds: 10, delivery: { state: 'held' } })
    expect(r.record).not.toHaveBeenCalled()
    await elapse()
    expect(r.record).toHaveBeenCalledTimes(1)
    const [kind, line] = r.record.mock.calls[0]!
    expect(kind).toBe('mail.draft.send')
    expect(line).toContain('ana0@example.test, bo@example.test')
    expect(line).not.toContain('send run')
    r.unmount()
  })
})

describe('reopening Mail', () => {
  const reopen = (saved: MailStore) => recoverInterruptedSends(JSON.parse(JSON.stringify(persistableMailStore(saved))))

  it('closed during the hold: known not sent, back on the list, and nothing is sent', async () => {
    const r = rig({ run: true })
    approveItem(r)
    const saved = r.read()
    r.unmount() // the hold's timer dies with the window
    await elapse(60000)
    const opened = reopen(saved)
    expect(draftDelivery(opened, r.draftId)).toMatchObject({ state: 'not_submitted', reason: LOST_HOLD_REASON })
    expect(opened.runs![0]!.items[0]).toMatchObject({ status: 'pending', skipReason: LOST_HOLD_REASON })
    expect(opened.runs![0]!.items[0]!.sentAt).toBeUndefined()
    expect(runProgress(opened.runs![0]!)).toMatchObject({ sent: 0, toGo: 1 })
    expect(r.send).not.toHaveBeenCalled()
  })

  it('closed during submission: unconfirmed and excluded from retry', async () => {
    const r = rig({ run: true })
    r.send.mockReturnValue(new Promise(() => {}))
    approveItem(r)
    await elapse()
    expect(r.send).toHaveBeenCalledTimes(1)
    const opened = reopen(r.persisted.at(-1)!)
    expect(draftDelivery(opened, r.draftId).state).toBe('unconfirmed')
    expect(opened.runs![0]!.items[0]!.status).toBe('unconfirmed')
    r.update(() => opened)
    expect(() => sendRunItemHandler(r.context, { runId: r.runId })).toThrow(/Check Sent/)
    expect(() => sendDraftHandler(r.context, { draftId: r.draftId })).toThrow(/Check Sent/)
    expect(r.send).toHaveBeenCalledTimes(1)
    r.unmount()
  })

  it('a confirmed record stays confirmed', async () => {
    const r = rig({ run: true })
    approveItem(r)
    await elapse()
    const opened = reopen(r.read())
    expect(draftDelivery(opened, r.draftId).state).toBe('submitted')
    expect(opened.runs![0]!.items[0]!.status).toBe('sent')
    r.unmount()
  })

  it('legacy records with too little evidence stay unconfirmed, and a reported id stands', () => {
    const r = rig({ drafts: 3, run: true })
    const [held, plain, gone] = r.ids as [string, string, string]
    const legacy = (status: string, extra = {}) => ({ status, sentAt: '2026-11-01T10:00:00Z', ...extra })
    r.update(store => ({
      ...store,
      drafts: store.drafts.filter(item => item.id !== gone),
      runs: store.runs!.map(run => ({ ...run, items: run.items.map(item => ({ ...item, ...(item.draftId === held ? legacy('sent', { pendingSendId: 'old' }) : item.draftId === plain ? legacy('sent') : legacy('sent', { sentMessageId: 'imap_sent_1' })) })) as typeof run.items })),
    }))
    const opened = reopen(r.read())
    const status = (id: string) => opened.runs![0]!.items.find(item => item.draftId === id)!.status
    expect(status(held)).toBe('unconfirmed')
    expect(status(plain)).toBe('unconfirmed')
    expect(status(gone)).toBe('sent')
    expect(draftDelivery(opened, held).state).toBe('unconfirmed')
    expect(r.send).not.toHaveBeenCalled()
    r.unmount()
  })

  it('repeating it changes nothing and sends nothing; an empty store is left alone', () => {
    const r = rig({ run: true })
    approveItem(r)
    const once = recoverInterruptedSends(r.read(), '2026-11-02T11:00:00Z')
    expect(recoverInterruptedSends(once, '2026-11-02T12:00:00Z')).toBe(once)
    const empty = emptyMailStore()
    expect(recoverInterruptedSends(empty)).toBe(empty)
    expect(r.send).not.toHaveBeenCalled()
    r.unmount()
  })

  it('a live screen never treats a temporarily empty store as a lost send', () => {
    const r = rig({ run: true })
    approveItem(r)
    const run = r.read().runs![0]!
    expect(reconcileRun({ drafts: [], messages: [] }, run)).toBe(run)
    r.unmount()
  })
})

describe('one approval, one hold, one submission', () => {
  it('repeated approvals in one tick and during submission reuse the attempt', async () => {
    const r = rig()
    let answer!: (message: MailMessage) => void
    r.send.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const first = approve(r)
    const second = approve(r)
    const third = approve(r)
    expect(first.alreadyQueued).toBeUndefined()
    expect(second).toMatchObject({ alreadyQueued: true, delivery: { state: 'held' } })
    expect(third.alreadyQueued).toBe(true)
    expect(r.hold().pendingSends).toHaveLength(1)
    await elapse()
    expect(approve(r)).toMatchObject({ alreadyQueued: true, delivery: { state: 'submitting' } })
    await elapse(20000)
    expect(r.send).toHaveBeenCalledTimes(1)
    await act(async () => { answer(accepted(r.read().drafts[0]!)); await vi.advanceTimersByTimeAsync(0) })
    expect(draftDelivery(r.read(), r.draftId).state).toBe('submitted')
    r.unmount()
  })

  it('a stale view of the store does not get a second hold either', () => {
    const r = rig()
    const stale = r.read().drafts[0]!
    approve(r)
    const seen = { store: { ...r.read(), drafts: [stale] }, sendStoreDraft: r.context.sendStoreDraft } as unknown as MailAgentToolContext
    expect(inAct(() => parse(sendDraftHandler(seen, { draftId: stale.id })))).toMatchObject({ alreadyQueued: true })
    expect(r.hold().pendingSends).toHaveLength(1)
    r.unmount()
  })

  it.each([['conflict', { syncState: 'conflict' }, /conflicting edits/], ['unconfirmed', { sendState: 'uncertain', sendError: 'Check Sent' }, /Check Sent/]] as const)('refuses a %s draft before claiming it is queued', (_n, patch, words) => {
    const r = rig()
    r.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, ...patch })) as Draft[] }))
    expect(() => sendDraftHandler(r.context, { draftId: r.draftId })).toThrow(words)
    expect(r.hold().pendingSends).toHaveLength(0)
    expect(r.send).not.toHaveBeenCalled()
    r.unmount()
  })

  it('a conflict that arrives during the hold stops the send with its reason', async () => {
    const r = rig()
    approve(r)
    r.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, syncState: 'conflict' as const })) }))
    await elapse()
    expect(r.send).not.toHaveBeenCalled()
    expect(draftDelivery(r.read(), r.draftId).state).toBe('conflict')
    r.unmount()
  })
})

describe('late callbacks', () => {
  it('undo after the hold ended is refused and changes nothing', async () => {
    const r = rig({ run: true })
    r.send.mockReturnValue(new Promise(() => {}))
    approveItem(r)
    const hold = r.hold().pendingSends[0]!
    await elapse()
    expect(inAct(() => r.hold().undoPendingSend(hold.id))).toBe(false)
    expect(r.notice).toHaveBeenLastCalledWith(expect.stringContaining('Too late'))
    expect(draftDelivery(r.read(), r.draftId).state).toBe('submitting')
    r.unmount()
  })

  it('undo back to pending; the undone attempt cannot speak afterwards', async () => {
    const r = rig({ run: true })
    approveItem(r)
    const hold = r.hold().pendingSends[0]!
    act(() => { r.hold().undoPendingSend(hold.id) })
    expect(r.read().runs![0]!.items[0]).toMatchObject({ status: 'pending' })
    expect(draftDelivery(r.read(), r.draftId)).toMatchObject({ state: 'not_submitted', reason: expect.stringContaining('undone') })
    await elapse(30000)
    expect(r.send).not.toHaveBeenCalled()
    const run = r.read().runs![0]!
    expect(markRunItemCommitted(run, r.draftId, 'late', undefined, hold.id).items[0]!.status).not.toBe('pending')
    expect(markRunItemUnconfirmed(run, r.draftId, 'late', undefined, hold.id).items[0]!.status).toBe('pending')
    r.unmount()
  })

  it('a failure from an older attempt leaves a newer one alone, and nothing resets a confirmed send', () => {
    const r = rig({ run: true })
    approveItem(r)
    const run = r.read().runs![0]!
    expect(markRunItemUnsent(run, r.draftId, 'late', undefined, 'older').items[0]!.status).toBe('sending')
    const confirmed = markRunItemCommitted(run, r.draftId, 'id', undefined, run.items[0]!.sendAttemptId)
    expect(markRunItemUnsent(confirmed, r.draftId, 'late').items[0]!.status).toBe('sent')
    expect(markRunItemUnconfirmed(confirmed, r.draftId, 'late').items[0]!.status).toBe('sent')
    r.unmount()
  })

  it('a Sent copy found by a sync during submission beats a late failure', async () => {
    const r = rig({ run: true })
    let fail!: (error: Error) => void
    r.send.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    approveItem(r)
    await elapse()
    const draft = r.read().drafts[0]!
    r.update(store => {
      const next = { ...store, drafts: [], messages: [{ ...accepted(draft), id: 'imap_Sent_1', sentDraftId: draft.id }] }
      return { ...next, runs: next.runs!.map(run => reconcileRun(next, run)) }
    })
    await act(async () => { fail(new Error('Socket closed')); await vi.advanceTimersByTimeAsync(0) })
    expect(draftDelivery(r.read(), r.draftId).state).toBe('submitted')
    expect(r.read().runs![0]!.items[0]!.status).toBe('sent')
    r.unmount()
  })
})

describe('what was approved is what leaves', () => {
  it.each([
    ['body', { body: 'Changed' }],
    ['subject', { subject: 'Changed' }],
    ['recipients', { to: [{ name: '', email: 'other@example.test' }] }],
    ['cc', { cc: [{ name: '', email: 'other@example.test' }] }],
    ['bcc', { bcc: [{ name: '', email: 'other@example.test' }] }],
    ['reply-to', { replyTo: [{ name: '', email: 'other@example.test' }] }],
    ['attachments', { attachments: [{ id: 'a', name: 'a.pdf', mimeType: 'application/pdf', sizeLabel: '1 KB', content: 'data:;base64,QQ==' }] }],
  ])('a %s change during the hold stops it; the later edit is kept', async (_name, patch) => {
    const r = rig()
    approve(r)
    r.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, ...patch })) as Draft[] }))
    await elapse()
    expect(r.send).not.toHaveBeenCalled()
    expect(draftDelivery(r.read(), r.draftId)).toMatchObject({ state: 'not_submitted', reason: CHANGED_REASON })
    expect(r.read().drafts[0]).toMatchObject(patch)
    r.unmount()
  })

  it('a remote attachment with the same name but another source is a change; provider bookkeeping is not', () => {
    const r = rig()
    const draft: Draft = { ...r.read().drafts[0]!, attachments: [{ id: 'a', name: 'a.pdf', mimeType: 'application/pdf', sizeLabel: '1 KB', remote: { provider: 'imap', folderPath: 'INBOX', uid: 1, partId: '2' } }] }
    const before = draftSendFingerprint(draft)
    expect(draftSendFingerprint({ ...draft, attachments: [{ ...draft.attachments[0]!, remote: { provider: 'imap', folderPath: 'INBOX', uid: 2, partId: '2' } }] })).not.toBe(before)
    expect(draftSendFingerprint({ ...draft, providerDraftId: 'x', updatedAt: 'later', syncState: 'synced' })).toBe(before)
    r.unmount()
  })

  it('a compose hold on a saved draft goes only if that draft is what was approved', () => {
    const r = rig()
    const draft: Draft = { ...r.read().drafts[0]!, sendAttempt: { id: 'h', phase: 'held', approved: 'a', at: 'now' } }
    const approved = draftSendFingerprint(draft)
    const outgoing = draftSendFingerprint({ ...draft, body: 'As in the window' })
    expect(composeHoldStillApproved(draft, 'h', approved, outgoing)).toBe(true)
    expect(composeHoldStillApproved({ ...draft, body: 'As in the window' }, 'h', approved, outgoing)).toBe(true)
    expect(composeHoldStillApproved({ ...draft, body: 'Edited elsewhere' }, 'h', approved, outgoing)).toBe(false)
    expect(composeHoldStillApproved(draft, 'other', approved, outgoing)).toBe(false)
    expect(composeHoldStillApproved(undefined, 'h', approved, outgoing)).toBe(false)
    r.unmount()
  })

  it('an edit that lands during preparation stops it before anything is marked or sent', async () => {
    const r = rig()
    let store = r.read()
    const update = (updater: (current: MailStore) => MailStore) => { store = updater(store) }
    const send = vi.fn(async (draft: Draft) => accepted(draft))
    const deliver = createMailDeliveryController({ read: () => store, update, persist: async () => {}, release: () => {}, online: () => true, prepare: async draft => {
      update(current => ({ ...current, drafts: current.drafts.map(item => ({ ...item, body: 'Edited meanwhile' })) }))
      return { ...draft }
    } })
    await expect(deliver({ send: ({ draft }: { draft: Draft }) => send(draft) } as unknown as MailProvider, store.drafts[0]!)).rejects.toThrow(CHANGED_REASON)
    expect(send).not.toHaveBeenCalled()
    expect(store.drafts[0]).toMatchObject({ body: 'Edited meanwhile', sendState: 'failed' })
    r.unmount()
  })

  it('tools cannot change or discard a held or submitting draft', async () => {
    const r = rig({ run: true })
    r.send.mockReturnValue(new Promise(() => {}))
    approveItem(r)
    const version = draftEditVersion(r.read().drafts[0]!)
    expect(() => updateDraftHandler(r.context, { draftId: r.draftId, body: 'x', expectedVersion: version })).toThrow(/Undo it first/)
    expect(() => discardDraftHandler(r.context, { draftId: r.draftId })).toThrow(/Undo it first/)
    await elapse()
    expect(() => updateDraftHandler(r.context, { draftId: r.draftId, body: 'x', expectedVersion: draftEditVersion(r.read().drafts[0]!) })).toThrow(/being sent/)
    expect(() => skipRunItemHandler(r.context, { runId: r.runId })).toThrow()
    r.unmount()
  })

  it('undo, edit, fresh approval: the old approval no longer works and the new text leaves', async () => {
    const r = rig()
    const approvedVersion = draftEditVersion(r.read().drafts[0]!)
    inAct(() => sendDraftHandler(r.context, { draftId: r.draftId, version: approvedVersion }))
    act(() => { r.hold().undoPendingSend(r.hold().pendingSends[0]!.id) })
    expect(r.read().drafts[0]!.sendAttempt).toBeUndefined()
    parse(updateDraftHandler(r.context, { draftId: r.draftId, body: 'Reworded', expectedVersion: draftEditVersion(r.read().drafts[0]!) }))
    expect(() => sendDraftHandler(r.context, { draftId: r.draftId, version: approvedVersion })).toThrow(/changed after you approved/)
    expect(r.hold().pendingSends).toHaveLength(0)
    inAct(() => sendDraftHandler(r.context, { draftId: r.draftId, version: draftEditVersion(r.read().drafts[0]!) }))
    await elapse()
    expect(r.send).toHaveBeenCalledTimes(1)
    expect(r.send.mock.calls[0]![0].body).toBe('Reworded')
    r.unmount()
  })
})

describe('failures on the way out', () => {
  it('saving the marker fails: nothing is sent, and it reads as known not sent', async () => {
    const r = rig({ run: true })
    r.persist.mockRejectedValueOnce(new Error('Draft delivery state could not be saved. Nothing was sent.'))
    approveItem(r)
    await elapse()
    expect(r.send).not.toHaveBeenCalled()
    expect(draftDelivery(r.read(), r.draftId)).toMatchObject({ state: 'not_submitted', reason: expect.stringContaining('could not be saved') })
    expect(r.read().runs![0]!.items[0]).toMatchObject({ status: 'pending', skipReason: expect.stringContaining('could not be saved') })
    r.unmount()
  })

  it('a definite refusal and an ambiguous result stay distinct on disk and in progress', async () => {
    const refused = rig({ run: true })
    refused.send.mockRejectedValue(new MailSendError('Authentication rejected', 'not_sent'))
    approveItem(refused)
    await elapse()
    expect(refused.persisted.at(-1)!.drafts[0]).toMatchObject({ sendState: 'failed', sendError: 'Authentication rejected' })
    expect(runProgress(refused.read().runs![0]!)).toMatchObject({ toGo: 1, unconfirmed: 0 })

    const lost = rig({ run: true })
    lost.send.mockRejectedValue(new Error('Socket closed'))
    approveItem(lost)
    await elapse()
    expect(lost.persisted.at(-1)!.drafts[0]).toMatchObject({ sendState: 'uncertain' })
    expect(runProgress(lost.read().runs![0]!)).toMatchObject({ toGo: 0, unconfirmed: 1 })
    refused.unmount(); lost.unmount()
  })

  it('a failure whose record cannot be saved leaves the safer marker on disk', async () => {
    const r = rig()
    r.send.mockRejectedValue(new MailSendError('Authentication rejected', 'not_sent'))
    r.persist.mockImplementationOnce(async snapshot => { r.persisted.push(JSON.parse(JSON.stringify(persistableMailStore(snapshot)))) }).mockRejectedValueOnce(new Error('Disk full'))
    approve(r)
    await elapse()
    expect(r.persisted.at(-1)!.drafts[0]!.sendState).toBe('uncertain')
    expect(recoverInterruptedSends(r.persisted.at(-1)!).drafts[0]!.sendState).toBe('uncertain')
    r.unmount()
  })

  it('accepted, but the receipt cannot be saved: still sent, never submitted twice', async () => {
    const r = rig()
    r.persist.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('Disk full'))
    approve(r)
    await elapse()
    expect(draftDelivery(r.read(), r.draftId).state).toBe('submitted')
    expect(() => sendDraftHandler(r.context, { draftId: r.draftId })).toThrow('sent already')
    expect(r.send).toHaveBeenCalledTimes(1)
    r.unmount()
  })
})

describe('the team status file', () => {
  const memory = () => {
    const disk = new Map<string, string>()
    const files: ExecutiveShareFiles = {
      read: async path => disk.get(path) ?? null,
      write: async (path, text) => { disk.set(path, text) },
      list: async folder => [...disk.keys()].filter(key => key.startsWith(`${folder}/`)).map(key => key.slice(folder.length + 1)),
      rename: async () => {},
      remove: async path => { disk.delete(path) },
    }
    return { disk, files }
  }

  it('adds delivery beside the existing fields, and a reason change alone is reported', async () => {
    const r = rig()
    const { disk, files } = memory()
    disk.set(`/o/${EXECUTIVE_TAKEN_DIR}/cos-k-1.json`, JSON.stringify({ draftId: r.draftId, takenAt: new Date().toISOString() }))
    const look = async () => reportExecutiveDraftStates({ files, root: '/o', store: r.read(), account: { id: 'account' } })
    const paths = [...disk.keys()]
    const statePath = () => [...disk.keys()].find(key => !paths.includes(key) && key.includes('/state/'))
    const lookup = await look()
    if (!lookup.written.length) { r.unmount(); throw new Error(`no state written; files: ${paths.join(', ')}`) }
    const first = parseDraftState(disk.get(statePath()!)!)!
    expect(first).toMatchObject({ v: 1, key: 'cos-k-1', state: 'draft', subject: 'Letter 0', delivery: { state: 'none' } })
    expect(first.version).toBeTruthy()
    expect((await look()).written).toEqual([])
    r.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, sendState: 'failed' as const, sendError: 'One reason' })) }))
    expect((await look()).written).toEqual(['cos-k-1'])
    r.update(store => ({ ...store, drafts: store.drafts.map(item => ({ ...item, sendError: 'Another reason' })) }))
    expect((await look()).written).toEqual(['cos-k-1'])
    expect(parseDraftState(disk.get(statePath()!)!)!.delivery).toMatchObject({ state: 'not_submitted', reason: 'Another reason' })
    r.unmount()
  })

  it('reads a file from before this field', () => {
    const legacy = parseDraftState(JSON.stringify({ v: 1, key: 'k', draftId: 'd', state: 'draft', at: '', to: [], cc: [], subject: 's', body: 'b', version: 'v' }))!
    expect(legacy.state).toBe('draft')
    expect(legacy.delivery).toBeUndefined()
  })

  it('an optimistic placeholder is not sent, and a draft gone mid-send is not a discard', () => {
    const r = rig()
    const draft = r.read().drafts[0]!
    const previous = { ...shared(r), delivery: { state: 'unconfirmed' as const, reason: 'r' } }
    const withPlaceholder = { ...r.read(), drafts: [], messages: [{ ...accepted(draft), id: `msg_sent_${draft.id}_1`, optimistic: true }], threads: [{ ...r.read().threads[0]!, accountId: 'account' }] }
    const next = executiveDraftState(withPlaceholder, { id: 'account' }, 'cos-k-1', draft.id, previous, 'now')!
    expect(next.state).toBe('draft')
    expect(next.delivery?.state).toBe('unconfirmed')
    r.unmount()
  })
})
