// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'
import { createComposedMessageDraft, emptyMailStore } from '../lib/mailModel'
import type { MailMessage, MailStore } from '../types'
import { ComposeEditor, type ComposeEditorProps } from './ComposeEditor'

vi.mock('@purescience/platform-ui/release/gesture', async original => ({ ...(await original<object>()), isPersonGesture: () => true }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<ReturnType<typeof createRoot>> = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
})

function fixture() {
  const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Text', attachments: [] })
  return { store: made.store, draftId: made.draftId, threadId: made.store.drafts[0]!.threadId }
}
const sentCopy = (draftId: string, threadId: string): MailMessage => ({ id: `msg_sent_${draftId}_1`, threadId, from: { name: 'Me', email: 'me@example.test' }, to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Text', attachments: [], receivedAt: '2026-11-02T10:00:00Z', read: true, deliveryAccepted: true, sentDraftId: draftId })

/** The real window, left open on the draft, with only the shell around it stood in for. */
async function openWindow(store: MailStore, draftId: string, threadId: string) {
  const schedulePendingSend = vi.fn(() => true)
  const setCommandNotice = vi.fn()
  const send = vi.fn()
  const noop = () => {}
  const setStore = vi.fn()
  const props = {
    store, setStore, storeRef: { current: store }, activeProvider: 'gmail', mailProviderRef: { current: { send, capabilities: { compose: true } } },
    selectedAccount: { id: 'account', provider: 'gmail', name: 'Me', email: 'me@example.test', syncState: 'online' },
    composeTo: 'ana@example.test', composeCc: '', composeBcc: '', composeCcBccOpen: false, composeSubject: 'Letter', composeBody: 'Text', composeBodyHtml: '<p>Text</p>', composeAttachments: [], composeDropActive: false,
    setComposeTo: noop, setComposeCc: noop, setComposeBcc: noop, setComposeCcBccOpen: noop, setComposeSubject: noop, setComposeBody: noop, setComposeBodyHtml: noop, setComposeAttachments: noop, setComposeDropActive: noop, setComposeOpen: noop,
    composeContext: { threadId, messageId: null, kind: 'draft', draftId }, composeQuote: null, setComposeQuote: noop, switchComposeReplyKind: noop, onResetComposeContext: noop, discardContextDraft: noop,
    composeToRef: { current: null }, pendingSend: null, schedulePendingSend, undoPendingSend: noop, sendDraftThroughProvider: send, markDraftSending: noop, setCommandNotice,
  } as unknown as ComposeEditorProps
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<ThemeProvider theme={{}}><ComposeEditor {...props} /></ThemeProvider>))
  const press = async () => {
    const button = host.querySelector<HTMLButtonElement>('button[data-release="send"]')
    expect(button, 'the window has a Send button').toBeTruthy()
    await act(async () => { button!.click() })
  }
  const pressSendLater = async () => {
    await act(async () => { host.querySelector<HTMLButtonElement>('button[title="Send later"]')!.click() })
    const choice = host.querySelector<HTMLElement>('[role="menuitem"]')
    expect(choice, 'Send later offers a time').toBeTruthy()
    await act(async () => { choice!.click() })
  }
  return { press, pressSendLater, schedulePendingSend, setCommandNotice, send, setStore }
}

describe('Send in a compose window left open on a draft', () => {
  it('sends an ordinary draft through the hold', async () => {
    const f = fixture()
    const window = await openWindow(f.store, f.draftId, f.threadId)
    await window.press()
    expect(window.schedulePendingSend).toHaveBeenCalledTimes(1)
  })

  it('refuses once that draft was confirmed sent and removed', async () => {
    const f = fixture()
    const sent = { ...f.store, drafts: [], messages: [sentCopy(f.draftId, f.threadId)] }
    const window = await openWindow(sent, f.draftId, f.threadId)
    await window.press()
    expect(window.schedulePendingSend).not.toHaveBeenCalled()
    expect(window.send).not.toHaveBeenCalled()
    expect(window.setCommandNotice).toHaveBeenCalledWith('This draft was sent already.')
  })

  it('Send later schedules an ordinary draft, and refuses one already confirmed sent', async () => {
    const f = fixture()
    const ordinary = await openWindow(f.store, f.draftId, f.threadId)
    await ordinary.pressSendLater()
    expect(ordinary.setStore).toHaveBeenCalled()
    const sent = await openWindow({ ...f.store, drafts: [], messages: [sentCopy(f.draftId, f.threadId)] }, f.draftId, f.threadId)
    await sent.pressSendLater()
    expect(sent.setStore).not.toHaveBeenCalled()
    expect(sent.setCommandNotice).toHaveBeenCalledWith('This draft was sent already.')
  })

  it.each([
    ['unconfirmed', { sendState: 'uncertain', sendError: 'Check Sent' }, /Check Sent/],
    ['conflicted', { syncState: 'conflict' }, /conflicting edits/],
    ['already waiting', { sendAttempt: { id: 'a', phase: 'held', approved: 'x', at: 'now' } }, /already waiting/],
  ] as const)('refuses a draft that is %s', async (_name, patch, words) => {
    const f = fixture()
    const changed = { ...f.store, drafts: f.store.drafts.map(item => ({ ...item, ...patch })) } as MailStore
    const window = await openWindow(changed, f.draftId, f.threadId)
    await window.press()
    expect(window.schedulePendingSend).not.toHaveBeenCalled()
    expect(window.setCommandNotice).toHaveBeenCalledWith(expect.stringMatching(words))
  })
})
