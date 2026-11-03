// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseComposeRecipients } from '../components/mailShellHelpers'
import { createMailDeliveryController } from '../lib/mailDelivery'
import { draftDelivery, draftEditBlock } from '../lib/mailDeliveryStatus'
import { createComposedMessageDraft, emptyMailStore } from '../lib/mailModel'
import { settleUndoneHold } from '../lib/mailRuns'
import { createStoreDraftSender } from '../lib/mailSendRelease'
import type { ComposeReplyContext } from '../lib/replyCompose'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
import { composeSaveTarget, composeWordsDiffer, useComposeDraftAutosave } from './useComposeDraftAutosave'
import { usePendingSend } from './usePendingSend'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const APPROVED = 'Approved words'
const TYPED = 'Approved words, and later ones'

/** The real autosave, hold, sender and delivery controller, with a window open on the draft and a fake mail service. */
function desk(options: { prepare?: (draft: Draft) => Promise<Draft>; openOnUnseen?: boolean } = {}) {
  const made = createComposedMessageDraft(emptyMailStore(), { to: parseComposeRecipients('ana@example.test'), subject: 'Letter', body: APPROVED, attachments: [] })
  let store: MailStore = made.store
  const storeRef = { current: store }
  const send = vi.fn(async (draft: Draft): Promise<MailMessage> => ({ id: 'accepted', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true }))
  const provider = { send: ({ draft }: { draft: Draft }) => send(draft) } as unknown as MailProvider
  let rerender: () => void = () => {}
  const update = (updater: (current: MailStore) => MailStore) => {
    store = updater(store)
    storeRef.current = store
    rerender()
  }
  const deliver = createMailDeliveryController({ read: () => store, update, persist: async () => {}, prepare: options.prepare ?? (async draft => ({ ...draft })), release: () => {}, online: () => true })
  const onLocked = vi.fn()
  const onKept = vi.fn()
  let hold!: ReturnType<typeof usePendingSend>
  let type!: (body: string) => void
  let setFields!: (fields: { subject?: string; to?: string; html?: string }) => void
  let context!: ComposeReplyContext | null
  function Window() {
    const [, force] = useState(0)
    rerender = () => force(value => value + 1)
    const [body, setBody] = useState(APPROVED)
    const [currentContext, setContext] = useState<ComposeReplyContext | null>({ threadId: made.threadId, draftId: options.openOnUnseen ? 'never-seen-here' : made.draftId, messageId: null, kind: 'draft' })
    type = setBody
    const [fields, setFieldsState] = useState<{ subject?: string; to?: string; html?: string }>({})
    setFields = setFieldsState
    context = currentContext
    hold = usePendingSend({ undoSendDelaySeconds: 10, setCommandNotice: () => {}, onUndone: pending => { if (pending.draftId) update(current => settleUndoneHold(current, pending.draftId!, pending.id)) } })
    const id = currentContext?.draftId
    useComposeDraftAutosave({
      active: true, pending: hold.pendingSend?.target === 'compose', session: 1, signature: '', context: currentContext, quote: null,
      snapshot: { to: fields.to ?? 'ana@example.test', cc: '', bcc: '', subject: fields.subject ?? 'Letter', body, bodyHtml: fields.html ?? '', attachments: [] },
      storeRef, setStore: value => update(typeof value === 'function' ? value : () => value), setContext,
      editBlock: id ? draftEditBlock(store, id) : null,
      sentAway: id ? draftDelivery(store, id).state === 'submitted' : false,
      onLocked, onKeptSeparately: onKept,
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Window />))
  const sender = createStoreDraftSender({
    read: () => store, update, provider: () => provider, localAccount: () => false, canCompose: () => true, online: () => true, home: () => 'Fake', undoSeconds: () => 10,
    schedule: (...args) => hold.schedulePendingSend(...args), holdForDraft: id => hold.holdForDraft(id), isDraftSending: id => hold.isDraftSending(id), markDraftSending: (id, on) => hold.markDraftSending(id, on),
    deliver: (p, draft, attempt) => deliver(p, draft, attempt), reportFailure: () => {}, notice: () => {}, record: () => {},
  })
  return {
    draftId: made.draftId,
    read: () => store,
    update: (updater: (current: MailStore) => MailStore) => act(() => update(updater)),
    send,
    onLocked,
    onKept,
    context: () => context,
    current: () => store.drafts.find(draft => draft.id === made.draftId),
    approve: (id = made.draftId) => { let out!: ReturnType<typeof sender>; act(() => { out = sender(store.drafts.find(draft => draft.id === id)!, {}) }); return out },
    undo: () => act(() => { hold.undoPendingSend(hold.pendingSends[0]!.id) }),
    type: (body: string) => act(() => type(body)),
    fields: (next: { subject?: string; to?: string; html?: string }) => act(() => setFields(next)),
    pass: async (ms = 400) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) },
    close: () => act(() => root.unmount()),
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T10:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('typing in a window already open on a draft that is leaving', () => {
  it('held: the approval stands, then the later words become their own unsent draft', async () => {
    const d = desk()
    d.approve()
    d.type(TYPED)
    await d.pass()
    expect(d.current()!.body).toBe(APPROVED)
    expect(d.current()!.sendAttempt?.phase).toBe('held')
    expect(d.onLocked).toHaveBeenCalledTimes(1)
    await d.pass(10000)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.send.mock.calls[0]![0].body).toBe(APPROVED)
    expect(d.current()).toBeUndefined()
    await d.pass()
    expect(d.read().drafts).toHaveLength(1)
    const kept = d.read().drafts[0]!
    expect(kept.body).toBe(TYPED)
    expect(kept.id).not.toBe(d.draftId)
    expect(draftDelivery(d.read(), kept.id).state).toBe('none')
    expect(d.context()?.draftId).toBe(kept.id)
    expect(d.onKept).toHaveBeenCalledTimes(1)
    expect(d.send).toHaveBeenCalledTimes(1)
    d.close()
  })

  it('preparing: nothing changes under the approval and the service gets the approved words', async () => {
    let ready!: () => void
    const d = desk({ prepare: draft => new Promise(resolve => { ready = () => resolve({ ...draft }) }) })
    d.approve()
    await d.pass(10000)
    expect(d.current()!.sendAttempt?.phase).toBe('preparing')
    d.type(TYPED)
    await d.pass()
    expect(d.current()!.body).toBe(APPROVED)
    await act(async () => { ready(); await vi.advanceTimersByTimeAsync(0) })
    expect(d.send.mock.calls[0]![0].body).toBe(APPROVED)
    await d.pass()
    expect(d.read().drafts.map(draft => draft.body)).toEqual([TYPED])
    d.close()
  })

  it('submitting: completion neither overwrites nor loses what was typed meanwhile', async () => {
    const d = desk()
    let finish!: (message: MailMessage) => void
    d.send.mockReturnValue(new Promise(resolve => { finish = resolve }))
    d.approve()
    await d.pass(10000)
    expect(d.current()!.sendAttempt?.phase).toBe('submitting')
    d.type(TYPED)
    await d.pass()
    expect(d.current()!.body).toBe(APPROVED)
    await act(async () => { finish({ id: 'accepted', threadId: 't', from: { name: '', email: 'me@example.test' }, to: [], subject: 'Letter', body: APPROVED, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true }); await vi.advanceTimersByTimeAsync(0) })
    await d.pass()
    expect(d.read().drafts.map(draft => draft.body)).toEqual([TYPED])
    d.close()
  })

  it('unconfirmed: the words wait in the window, and only checking Sent then a fresh approval sends them', async () => {
    const d = desk()
    d.send.mockRejectedValueOnce(new Error('Connection closed after submission'))
    d.approve()
    await d.pass(10000)
    expect(draftDelivery(d.read(), d.draftId).state).toBe('unconfirmed')
    d.type(TYPED)
    await d.pass()
    expect(d.current()!.body).toBe(APPROVED)
    expect(d.read().drafts).toHaveLength(1)
    expect(d.onLocked).toHaveBeenCalledTimes(1)
    expect(d.approve()).toMatchObject({ ok: false })
    expect(d.send).toHaveBeenCalledTimes(1)
    // The recovery panel's "I checked Sent — allow retry".
    d.update(store => ({ ...store, drafts: store.drafts.map(draft => (draft.id === d.draftId ? { ...draft, sendState: 'failed' as const, sendError: 'You checked Sent and allowed another attempt.' } : draft)) }))
    await d.pass()
    expect(d.current()!.body).toBe(TYPED)
    d.approve()
    await d.pass(10000)
    expect(d.send).toHaveBeenCalledTimes(2)
    expect(d.send.mock.calls[1]![0].body).toBe(TYPED)
    d.close()
  })

  it('Undo frees the draft: the words are saved, nothing goes, and a fresh approval sends only them', async () => {
    const d = desk()
    d.approve()
    d.type(TYPED)
    await d.pass()
    expect(d.current()!.body).toBe(APPROVED)
    d.undo()
    await d.pass()
    expect(d.current()!.body).toBe(TYPED)
    expect(draftDelivery(d.read(), d.draftId).state).toBe('not_submitted')
    await d.pass(30000)
    expect(d.send).not.toHaveBeenCalled()
    d.approve()
    await d.pass(10000)
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.send.mock.calls[0]![0].body).toBe(TYPED)
    d.close()
  })

  it('a save already timed before the approval does not land after it', async () => {
    const d = desk()
    d.type(TYPED)
    await d.pass(100)
    d.approve()
    await d.pass()
    expect(d.current()!.body).toBe(APPROVED)
    await d.pass(10000)
    expect(d.send.mock.calls[0]![0].body).toBe(APPROVED)
    d.close()
  })

  it('no later words: the window stays quiet and no extra draft appears', async () => {
    const d = desk()
    d.approve()
    await d.pass(10000)
    await d.pass()
    expect(d.send).toHaveBeenCalledTimes(1)
    expect(d.read().drafts).toEqual([])
    expect(d.onLocked).not.toHaveBeenCalled()
    expect(d.onKept).not.toHaveBeenCalled()
    d.close()
  })

  it.each<[string, { subject?: string; to?: string; html?: string }]>([
    ['subject', { subject: 'Retitled' }],
    ['recipient', { to: 'bo@example.test' }],
    ['format alone, with the same plain words', { html: '<p><strong>Approved words</strong></p>' }],
  ])('a later change of %s after it went becomes its own draft, and the approved copy keeps what was approved', async (_name, next) => {
    const d = desk()
    d.approve()
    await d.pass(10000)
    expect(d.send.mock.calls[0]![0].body).toBe(APPROVED)
    d.fields(next)
    await d.pass()
    expect(d.read().drafts).toHaveLength(1)
    const kept = d.read().drafts[0]!
    expect(kept.id).not.toBe(d.draftId)
    if (next.subject) expect(kept.subject).toBe(next.subject)
    if (next.to) expect(kept.to[0]!.email).toBe(next.to)
    if (next.html) expect(kept.bodyHtml).toBe(next.html)
    expect(d.read().messages.find(message => message.sentDraftId === d.draftId)!.subject).toBe('Letter')
    expect(d.send).toHaveBeenCalledTimes(1)
    d.close()
  })

  it('confirmed sent with no last words to compare: the window\'s words are kept, not dropped', async () => {
    const d = desk({ openOnUnseen: true })
    d.update(store => ({ ...store, drafts: [], messages: [...store.messages, { id: 'msg_sent_never-seen-here_1', threadId: 't', from: { name: 'Me', email: 'me@example.test' }, to: [], subject: 'Other', body: 'Other', attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true, deliveryAccepted: true, sentDraftId: 'never-seen-here' }] }))
    await d.pass()
    expect(d.read().drafts.map(draft => draft.body)).toEqual([APPROVED])
    expect(d.onKept).toHaveBeenCalledTimes(1)
    d.close()
  })

  it('a draft that is free saves as it always did', async () => {
    const d = desk()
    d.type(TYPED)
    await d.pass()
    expect(d.current()!.body).toBe(TYPED)
    expect(d.onLocked).not.toHaveBeenCalled()
    d.close()
  })
})

describe('where a window\'s words may go when it closes or is put aside', () => {
  const made = createComposedMessageDraft(emptyMailStore(), { to: parseComposeRecipients('ana@example.test'), subject: 'Letter', body: APPROVED, attachments: [] })
  const draft = made.store.drafts[0]!
  const fields = (body: string) => ({ to: draft.to, cc: [], bcc: [], subject: 'Letter', body, bodyHtml: '', attachments: draft.attachments })
  const withDraft = (patch: Partial<Draft>) => ({ drafts: [{ ...draft, ...patch }], messages: [] })

  it.each([
    ['held', { sendAttempt: { id: 'a', phase: 'held' as const, approved: 'x', at: '2026-11-02T10:00:00Z' } }],
    ['preparing', { sendAttempt: { id: 'a', phase: 'preparing' as const, approved: 'x', at: '2026-11-02T10:00:00Z' } }],
    ['submitting', { sendAttempt: { id: 'a', phase: 'submitting' as const, approved: 'x', at: '2026-11-02T10:00:00Z' } }],
    ['unconfirmed', { sendState: 'uncertain' as const }],
    ['sent and kept', { sentAt: '2026-11-02T10:00:00Z' }],
  ])('%s: apart when the words differ, nowhere when they do not', (_name, patch) => {
    expect(composeSaveTarget(withDraft(patch), draft.id, fields(TYPED))).toBe('apart')
    expect(composeSaveTarget(withDraft(patch), draft.id, fields(APPROVED))).toBe('nothing')
  })

  it('a free draft, or a window with none yet, saves as it always did', () => {
    expect(composeSaveTarget(withDraft({}), draft.id, fields(TYPED))).toBe('free')
    expect(composeSaveTarget(withDraft({ sendState: 'failed', sendError: 'No' }), draft.id, fields(TYPED))).toBe('free')
    expect(composeSaveTarget(withDraft({}), null, fields(TYPED))).toBe('free')
  })

  it('a draft that went is compared on every field with what it last said, the way the shell puts a window aside', () => {
    const gone = { drafts: [], messages: [{ id: `msg_sent_${draft.id}_1`, threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: 'Letter', body: APPROVED, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true, deliveryAccepted: true, sentDraftId: draft.id }] }
    expect(composeSaveTarget(gone, draft.id, fields(APPROVED), draft)).toBe('nothing')
    expect(composeSaveTarget(gone, draft.id, { ...fields(APPROVED), subject: 'Retitled' }, draft)).toBe('apart')
    expect(composeSaveTarget(gone, draft.id, { ...fields(APPROVED), to: parseComposeRecipients('bo@example.test') }, draft)).toBe('apart')
    expect(composeSaveTarget(gone, draft.id, { ...fields(APPROVED), attachments: [{ id: 'f', name: 'a.pdf', mimeType: 'application/pdf', size: 1 }] as unknown as Draft['attachments'] }, draft)).toBe('apart')
    expect(composeSaveTarget({ drafts: [], messages: gone.messages }, draft.id, { ...fields(APPROVED), subject: 'Retitled' })).toBe('apart')
  })

  it('fetched bytes do not count as a change of words', () => {
    const file = { id: 'f', name: 'a.pdf', mimeType: 'application/pdf', size: 1 }
    const stored = { ...draft, attachments: [{ ...file, content: 'bytes' }] } as unknown as Draft
    expect(composeWordsDiffer(stored, { ...fields(APPROVED), attachments: [file] as unknown as Draft['attachments'] })).toBe(false)
  })
})
