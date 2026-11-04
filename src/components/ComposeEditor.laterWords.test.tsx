// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'
import { usePendingSend } from '../hooks/usePendingSend'
import { createMailDeliveryController } from '../lib/mailDelivery'
import { holdDraftForSend } from '../lib/mailDeliveryStatus'
import { createComposedMessageDraft, emptyMailStore } from '../lib/mailModel'
import type { Draft, MailMessage, MailStore } from '../types'
import { ComposeEditor, type ComposeEditorProps } from './ComposeEditor'

vi.mock('@purescience/platform-ui/release/gesture', async original => ({ ...(await original<object>()), isPersonGesture: () => true }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ATTACHED: Array<{ id: string; name: string; mimeType: string; content?: string }> = []

/** The real window on a saved draft, with the real hold and delivery controller and a fake mail service. */
async function open(options: { offline?: boolean; evidence?: 'partial' | 'absent' | 'complete' | 'partial-lastSeen' | 'missing-recipients' | 'missing-html' | 'missing-attachments' } = {}) {
  const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Text', attachments: [] })
  const storeRef = { current: made.store as MailStore }
  if (options.evidence) {
    const draft = made.store.drafts[0]!
    const message = { id: `msg_sent_${made.draftId}_1`, sentDraftId: made.draftId, deliveryAccepted: true, subject: 'Letter', body: 'Text', ...(['complete', 'missing-recipients', 'missing-html', 'missing-attachments'].includes(options.evidence) ? { to: draft.to, ...(options.evidence !== 'missing-recipients' ? { cc: [] } : {}), bcc: [], ...(options.evidence !== 'missing-html' ? { bodyHtml: '' } : {}), ...(options.evidence !== 'missing-attachments' ? { attachments: [] } : {}) } : {}) } as unknown as MailMessage
    storeRef.current = { ...storeRef.current, drafts: options.evidence === 'partial-lastSeen' ? [{ id: made.draftId, to: draft.to, cc: [], bcc: [], subject: 'Letter', body: 'Text', bodyHtml: '' } as unknown as Draft] : [], messages: options.evidence === 'absent' ? [] : [message] }
  }
  const setStore = (value: MailStore | ((current: MailStore) => MailStore)) => { storeRef.current = typeof value === 'function' ? value(storeRef.current) : value }
  const send = vi.fn(async (draft: Draft): Promise<MailMessage> => ({ id: 'accepted', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true }))
  const deliver = createMailDeliveryController({ read: () => storeRef.current, update: setStore, persist: async () => {}, prepare: async draft => ({ ...draft }), release: () => {}, online: () => true })
  const setComposeOpen = vi.fn()
  const provider = { send: ({ draft }: { draft: Draft }) => send(draft), capabilities: { compose: true } }
  let typeBody!: (body: string) => void
  let setWindow!: (next: { body?: string; subject?: string; to?: string; threadId?: string; attachments?: unknown[]; html?: string }) => void
  function Host() {
    const [composeBody, setComposeBody] = useState('Text')
    const [rest, setRest] = useState<{ subject?: string; to?: string; threadId?: string; attachments?: unknown[]; html?: string }>({})
    typeBody = setComposeBody
    setWindow = ({ body, ...others }) => { if (body !== undefined) setComposeBody(body); setRest(others) }
    const noop = () => {}
    const hold = usePendingSend({ undoSendDelaySeconds: 10, setCommandNotice: noop })
    const props = {
      store: storeRef.current, setStore, storeRef, activeProvider: 'gmail', mailProviderRef: { current: options.offline ? undefined : provider },
      selectedAccount: { id: 'account', provider: 'gmail', name: 'Me', email: 'me@example.test', syncState: 'online' },
      composeTo: rest.to ?? 'Ana <ana@example.test>', composeCc: '', composeBcc: '', composeCcBccOpen: false, composeSubject: rest.subject ?? 'Letter', composeBody, composeBodyHtml: rest.html ?? '', composeAttachments: rest.attachments ?? ATTACHED, composeDropActive: false, variant: 'docked',
      setComposeTo: noop, setComposeCc: noop, setComposeBcc: noop, setComposeCcBccOpen: noop, setComposeSubject: noop, setComposeBody: noop, setComposeBodyHtml: noop, setComposeAttachments: noop, setComposeDropActive: noop, setComposeOpen,
      composeContext: { threadId: rest.threadId ?? made.threadId, messageId: null, kind: 'draft', draftId: made.draftId }, composeQuote: null, setComposeQuote: noop, switchComposeReplyKind: noop, onResetComposeContext: noop, discardContextDraft: noop,
      composeToRef: { current: null }, pendingSend: hold.pendingSend, schedulePendingSend: hold.schedulePendingSend, undoPendingSend: hold.undoPendingSend, sendDraftThroughProvider: deliver, markDraftSending: hold.markDraftSending, setCommandNotice: noop,
      setSelectedMailboxId: noop, setSelectedThreadId: noop, reportSendFailure: noop,
    } as unknown as ComposeEditorProps
    return <ThemeProvider theme={{}}><ComposeEditor {...props} /></ThemeProvider>
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<Host />))
  return {
    draftId: made.draftId, send, storeRef, setComposeOpen, host,
    type: (body: string) => act(() => typeBody(body)),
    clear: () => act(() => setWindow({ body: '', subject: '', to: '', attachments: [] })),
    other: () => act(() => setWindow({ body: 'Words for someone else', threadId: 'another-thread' })),
    attachmentsFetched: () => act(() => setWindow({ attachments: [] })),
    edit: (next: { subject?: string; to?: string; attachments?: unknown[]; html?: string }) => act(() => setWindow(next)),
    close: () => act(() => root.unmount()),
    press: async (selector: string) => {
      const button = host.querySelector<HTMLButtonElement>(selector)
      expect(button, selector).toBeTruthy()
      await act(async () => { button!.click() })
    },
    pass: async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) },
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T10:00:00Z')) })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

it('words typed during the window\'s own hold are kept as a new draft; the send carries what was approved', async () => {
  const w = await open()
  await w.press('button[data-release="send"]')
  expect(w.storeRef.current.drafts.find(draft => draft.id === w.draftId)!.sendAttempt?.phase).toBe('held')
  w.type('Text, and a thought after pressing Send')
  await w.pass(10000)
  expect(w.send).toHaveBeenCalledTimes(1)
  expect(w.send.mock.calls[0]![0].body).toBe('Text')
  expect(w.storeRef.current.drafts.find(draft => draft.id === w.draftId)).toBeUndefined()
  const later = w.storeRef.current.drafts.filter(draft => draft.id !== w.draftId)
  expect(later.map(draft => draft.body)).toEqual(['Text, and a thought after pressing Send'])
  expect(later[0]!.sendAttempt).toBeUndefined()
  expect(w.setComposeOpen).toHaveBeenCalledWith(false)
  w.close()
})

it('no later words: nothing extra is saved when the window\'s own send goes', async () => {
  const w = await open()
  await w.press('button[data-release="send"]')
  await w.pass(10000)
  expect(w.send).toHaveBeenCalledTimes(1)
  expect(w.storeRef.current.drafts).toEqual([])
  w.close()
})

it('closing the window on a draft that is leaving keeps the words apart and leaves the approval alone', async () => {
  const w = await open()
  w.storeRef.current = holdDraftForSend(w.storeRef.current, w.draftId, { id: 'card', approved: 'x', at: '2026-11-02T10:00:00Z' })
  w.type('Text, and more')
  await w.press('button[aria-label="Close"]')
  const original = w.storeRef.current.drafts.find(draft => draft.id === w.draftId)!
  expect(original.body).toBe('Text')
  expect(original.sendAttempt?.id).toBe('card')
  expect(w.storeRef.current.drafts.filter(draft => draft.id !== w.draftId).map(draft => draft.body)).toEqual(['Text, and more'])
  w.close()
})

it('pressing Send on a draft already leaving starts nothing', async () => {
  const w = await open()
  w.storeRef.current = holdDraftForSend(w.storeRef.current, w.draftId, { id: 'card', approved: 'x', at: '2026-11-02T10:00:00Z' })
  await w.press('button[data-release="send"]')
  await w.pass(20000)
  expect(w.send).not.toHaveBeenCalled()
  w.close()
})

it('closing the window during its own hold leaves no empty draft behind when the send goes', async () => {
  const w = await open()
  await w.press('button[data-release="send"]')
  w.clear()
  await w.pass(10000)
  expect(w.send).toHaveBeenCalledTimes(1)
  expect(w.send.mock.calls[0]![0].body).toBe('Text')
  expect(w.storeRef.current.drafts).toEqual([])
  w.close()
})

it('a window now holding another conversation does not lend its words to the message that went', async () => {
  const w = await open()
  await w.press('button[data-release="send"]')
  w.other()
  await w.pass(10000)
  expect(w.send).toHaveBeenCalledTimes(1)
  expect(w.storeRef.current.drafts).toEqual([])
  w.close()
})

it('attachment bytes fetched during the hold are not later words', async () => {
  const w = await open()
  await w.press('button[data-release="send"]')
  w.attachmentsFetched()
  await w.pass(10000)
  expect(w.send).toHaveBeenCalledTimes(1)
  expect(w.storeRef.current.drafts).toEqual([])
  w.close()
})

it('with no connection left at the end of the hold, later words are still kept apart', async () => {
  const w = await open({ offline: true })
  await w.press('button[data-release="send"]')
  w.type('Text, and more')
  await w.pass(10000)
  expect(w.send).not.toHaveBeenCalled()
  expect(w.storeRef.current.drafts.map(draft => draft.body).sort()).toEqual(['Text', 'Text, and more'])
  w.close()
})

it('closing a window on a draft that already went saves no copy of it; words typed since are kept', async () => {
  const gone = (w: Awaited<ReturnType<typeof open>>) => {
    const draft = w.storeRef.current.drafts[0]!
    w.storeRef.current = { ...w.storeRef.current, drafts: [], messages: [...w.storeRef.current.messages, { id: `msg_sent_${draft.id}_1`, threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true, deliveryAccepted: true, sentDraftId: draft.id }] }
  }
  const quiet = await open()
  gone(quiet)
  await quiet.press('button[aria-label="Close"]')
  expect(quiet.storeRef.current.drafts).toEqual([])
  quiet.close()
  const typed = await open()
  gone(typed)
  typed.type('Text, and more')
  await typed.press('button[aria-label="Close"]')
  expect(typed.storeRef.current.drafts.map(draft => draft.body)).toEqual(['Text, and more'])
  typed.close()
})

it.each([
  ['subject', { subject: 'Letter, retitled' }],
  ['recipient', { to: 'bo@example.test' }],
  ['attachment', { attachments: [{ id: 'f1', name: 'later.pdf', mimeType: 'application/pdf', size: 1 }] }],
  ['format, with the same plain words', { html: '<p><strong>Text</strong></p>' }],
])('a %s changed after it went is kept when the window closes before autosave', async (_field, next) => {
  const w = await open()
  const draft = w.storeRef.current.drafts[0]!
  w.storeRef.current = { ...w.storeRef.current, drafts: [], messages: [...w.storeRef.current.messages, { id: `msg_sent_${draft.id}_1`, threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true, deliveryAccepted: true, sentDraftId: draft.id }] }
  w.edit(next)
  await w.press('button[aria-label="Close"]')
  expect(w.storeRef.current.drafts).toHaveLength(1)
  const kept = w.storeRef.current.drafts[0]!
  expect(kept.id).not.toBe(draft.id)
  expect(kept.sendAttempt).toBeUndefined()
  if ('subject' in next) expect(kept.subject).toBe(next.subject)
  if ('to' in next) expect(kept.to.map(contact => contact.email)).toEqual([next.to])
  if ('attachments' in next) expect(kept.attachments.map(file => file.name)).toEqual(['later.pdf'])
  if ('html' in next) { expect(kept.bodyHtml).toBe(next.html); expect(kept.body).toBe('Text') }
  w.close()
})

it.each(['partial', 'absent', 'complete', 'partial-lastSeen', 'missing-recipients', 'missing-html', 'missing-attachments'] as const)('actual Close with %s comparison evidence preserves unchanged plain words conservatively', async evidence => {
  const w = await open({ evidence })
  // Remove partial lastSeen before Close as a receipt would; no full comparison was ever present.
  w.storeRef.current = { ...w.storeRef.current, drafts: [] }
  await w.press('button[aria-label="Close"]')
  expect(w.storeRef.current.drafts).toHaveLength(evidence === 'complete' ? 0 : 1)
  if (evidence !== 'complete') expect(w.storeRef.current.drafts[0]).toMatchObject({ subject: 'Letter', body: 'Text', to: [{ name: 'Ana', email: 'ana@example.test' }], cc: [], bcc: [], attachments: [] })
  expect(w.send).not.toHaveBeenCalled()
  w.close()
})
