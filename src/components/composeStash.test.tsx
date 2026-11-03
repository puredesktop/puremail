// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { DRAFT_LINK_PREFIX } from '../lib/executiveShare'
import { demoMailStore } from '../test/mailFixtures'
import { PureMailShell } from './PureMailShell'
import type { ComposeEditorProps } from './ComposeEditor'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'

/**
 * The real shell, with its real compose state and its real stashOpenCompose. Only
 * the window's own face is a stand-in, because a rich-text editor cannot be typed
 * into here; it hands back the props the shell gives the real one. The second
 * opened link is what makes the shell put the open window aside. The provider
 * only records, and nothing is approved, so nothing can be sent.
 */
const face = vi.hoisted(() => ({ props: null as unknown }))
vi.mock('./ComposeEditor', async original => ({
  ...(await original<object>()),
  ComposeEditor: (props: unknown) => { face.props = props; return null },
}))
vi.mock('../hooks/useExecutiveMailShare', () => ({ useExecutiveMailShare: vi.fn(() => ({ afterSync: vi.fn(), teamReads: {} })) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const provider = () => ({
  capabilities: { compose: true, drafts: true },
  fetchStore: vi.fn(), sync: vi.fn(async (store: MailStore) => store), send: vi.fn(), search: vi.fn(async () => []),
  labelThread: vi.fn(async () => undefined), archiveThread: vi.fn(async () => undefined), moveThread: vi.fn(async () => undefined), deleteThread: vi.fn(async () => undefined), markThreadRead: vi.fn(async () => undefined),
  createDraft: vi.fn(async () => 'provider-draft'), updateDraft: vi.fn(async () => undefined), deleteDraft: vi.fn(async () => undefined), listDrafts: vi.fn(async () => []),
}) as unknown as MailProvider & { send: ReturnType<typeof vi.fn> }

const props = () => face.props as ComposeEditorProps
const fileDraft = (id: string, threadId: string): Draft => ({ id, threadId, to: [{ name: 'Mira', email: 'mira@example.com' }], cc: [], bcc: [], subject: 'Hello', body: 'Words', bodyHtml: '<p>Words</p>', attachments: [], updatedAt: '2026-11-01T00:00:00.000Z', syncState: 'synced', providerDraftId: `p-${id}` } as unknown as Draft)

let root: Root | null = null
type ShellProps = ComponentProps<typeof PureMailShell>

/** Mail open with the draft in its compose window, then confirmed sent from elsewhere with the window still open. */
async function openThenConfirmedSent() {
  const store = demoMailStore()
  const threadId = 'thread-of-the-draft'
  const sentMessage = { id: 'msg_sent_going_1', threadId, from: { name: 'Me', email: 'me@example.test' }, to: [{ name: 'Mira', email: 'mira@example.com' }], subject: 'Hello', body: 'Words', attachments: [], receivedAt: '2026-11-01T00:00:01.000Z', read: true, deliveryAccepted: true, sentDraftId: 'going' } as unknown as MailMessage
  const mail = provider()
  const render = (openedFile: { path: string } | null) => root!.render(
    <AppFrame>
      <PureMailShell {...({ initialProvider: 'imap', mailProvider: mail, initialStore: { ...store, threads: [...store.threads, { ...store.threads[0]!, id: threadId }], drafts: [fileDraft('going', threadId), fileDraft('next', threadId)] }, initialNotice: null, openedFile, onOpenedFileHandled: () => {} } as unknown as ShellProps)} />
    </AppFrame>,
  )
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => render({ path: `${DRAFT_LINK_PREFIX}going` }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(props()?.composeContext?.draftId).toBe('going')
  act(() => { props().setStore((current: MailStore) => ({ ...current, drafts: current.drafts.filter(draft => draft.id !== 'going'), messages: [...current.messages, sentMessage] })) })
  return { mail, putAside: async () => { await act(async () => render({ path: `${DRAFT_LINK_PREFIX}next` })) }, store: () => props().storeRef.current }
}

beforeEach(() => { window.localStorage.clear() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  face.props = null
  document.body.innerHTML = ''
})

describe('the shell putting aside a window on a draft that went, before autosave has run', () => {
  it.each<[string, (window: ComposeEditorProps) => void, (draft: Draft) => void]>([
    ['format alone, with the same plain words', window => window.setComposeBodyHtml('<p><strong>Words</strong></p>'), draft => { expect(draft.body).toBe('Words'); expect(draft.bodyHtml).toBe('<p><strong>Words</strong></p>') }],
    ['subject', window => window.setComposeSubject('Hello, retitled'), draft => expect(draft.subject).toBe('Hello, retitled')],
    ['recipient', window => window.setComposeTo('bo@example.test'), draft => expect(draft.to.map(contact => contact.email)).toEqual(['bo@example.test'])],
    ['attachment', window => window.setComposeAttachments([{ id: 'f', name: 'later.pdf', mimeType: 'application/pdf', size: 1 }] as never), draft => expect(draft.attachments.map(file => file.name)).toEqual(['later.pdf'])],
  ])('a later %s is kept as its own unsent draft, and the sent copy is left alone', async (_field, change, check) => {
    const desk = await openThenConfirmedSent()
    act(() => change(props()))
    await desk.putAside()
    const kept = desk.store().drafts.filter(draft => !['going', 'next'].includes(draft.id))
    expect(kept).toHaveLength(1)
    check(kept[0]!)
    expect(kept[0]!.sendAttempt).toBeUndefined()
    expect(desk.store().messages.find(message => message.sentDraftId === 'going')!.subject).toBe('Hello')
    expect(desk.mail.send).not.toHaveBeenCalled()
  })

  it('unchanged content makes no second draft', async () => {
    const desk = await openThenConfirmedSent()
    await desk.putAside()
    expect(desk.store().drafts.map(draft => draft.id)).toEqual(['next'])
    expect(desk.mail.send).not.toHaveBeenCalled()
  })
})
