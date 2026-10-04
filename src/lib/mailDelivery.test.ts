import { expect, it, vi } from 'vitest'
import { createMailDeliveryController, MailSendError } from './mailDelivery'
import { createComposedMessageDraft, emptyMailStore, mergeMailProviderSyncResult, persistableMailStore, mergeMailDrafts } from './mailModel'
import { draftContentRevision } from './mailDeliveryStatus'
import type { Draft, MailMessage, MailProvider } from '../types'

function fixture() {
  const created = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Recipient', email: 'recipient@example.test' }], subject: 'Reply', body: 'A reply', attachments: [] })
  let store = created.store
  const draft = store.drafts[0]
  const persist = vi.fn(async () => {})
  const prepare = vi.fn(async (draft: Draft) => draft)
  const release = vi.fn()
  const send = createMailDeliveryController({ read: () => store, update: update => { store = update(store) }, persist, prepare, release, online: () => true })
  return { draft, send, persist, prepare, release, read: () => store }
}
function provider(send: (draft: Draft) => Promise<MailMessage>): MailProvider {
  return { send: ({ draft }) => send(draft) } as MailProvider
}
const accepted = (draft: Draft): MailMessage => ({ id: 'accepted', threadId: draft.threadId, from: { name: 'Me', email: 'me@example.test' }, to: draft.to, subject: draft.subject, body: draft.body, attachments: [], receivedAt: '2026-10-03T03:00:00Z', read: true, messageIdHeader: draft.sendMessageId })

it('saves uncertainty before submission and records confirmed delivery durably', async () => {
  const f = fixture()
  await f.send(provider(async draft => {
    expect(f.persist).toHaveBeenCalledTimes(1)
    expect(f.read().drafts[0].sendState).toBe('uncertain')
    expect(f.read().drafts[0].sendMessageId).toBe(draft.sendMessageId)
    return accepted(draft)
  }), f.draft)
  expect(f.read().drafts).toHaveLength(0)
  expect(persistableMailStore(f.read()).messages[0].deliveryAccepted).toBe(true)
  expect(f.read().messages[0].optimistic).not.toBe(true)
  expect(f.persist).toHaveBeenCalledTimes(2)
})

it('removes only the consumed provider draft from history when acceptance is recorded', async () => {
  const f = fixture()
  f.read().threads[0].syncState = 'synced'
  f.draft.providerDraftMessageId = 'cached-draft'
  f.draft.providerDraftMessageIdHeader = '<stable-draft@example.test>'
  const cached = { ...accepted(f.draft), id: 'cached-draft', isDraft: true, messageIdHeader: '<stable-draft@example.test>' }
  const replacement = { ...cached, id: 'replacement-draft' }
  const newer = { ...cached, id: 'newer-unsent-reply', messageIdHeader: '<different-draft@example.test>' }
  const otherThread = { ...cached, id: 'other-account-copy', threadId: 'other-thread' }
  f.read().messages.push(cached, replacement, newer, otherThread)
  await f.send(provider(async draft => accepted(draft)), f.draft)
  const persisted = persistableMailStore(f.read())
  expect(persisted.messages.filter(message => message.isDraft).map(message => message.id)).toEqual(['newer-unsent-reply', 'other-account-copy'])
  expect(persisted.messages.filter(message => message.deliveryAccepted)).toHaveLength(1)
  expect(persisted.threads[0].syncState).toBe('synced')
})

it.each(['pending', 'failed', 'conflict'] as const)('preserves unrelated %s thread work after confirmed delivery', async syncState => {
  const f = fixture()
  f.read().threads[0].syncState = syncState
  await f.send(provider(async draft => accepted(draft)), f.draft)
  expect(f.read().threads[0].syncState).toBe(syncState)
})

it('does not submit when saving the attempt fails', async () => {
  const f = fixture(); f.persist.mockRejectedValue(new Error('Disk unavailable'))
  const remote = vi.fn(async (draft: Draft) => accepted(draft))
  await expect(f.send(provider(remote), f.draft)).rejects.toThrow('Disk unavailable')
  expect(remote).not.toHaveBeenCalled()
  expect(f.read().drafts[0].sendState).toBe('failed')
})

it('blocks a second submission while the first is in progress', async () => {
  const f = fixture()
  let resolve!: (message: MailMessage) => void
  const remote = vi.fn(() => new Promise<MailMessage>(done => { resolve = done }))
  const first = f.send(provider(remote), f.draft)
  await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1))
  await expect(f.send(provider(remote), f.draft)).rejects.toThrow('already being sent')
  resolve(accepted(f.draft)); await first
  expect(remote).toHaveBeenCalledTimes(1)
})

it('keeps a lost response uncertain and blocks a retry, including after reload', async () => {
  const f = fixture(); const remote = vi.fn(async () => { throw new Error('Connection closed after submission') })
  await expect(f.send(provider(remote), f.draft)).rejects.toThrow('Connection closed')
  expect(f.read().drafts[0].sendState).toBe('uncertain')
  const saved = JSON.parse(JSON.stringify(persistableMailStore(f.read())))
  const reloaded = createMailDeliveryController({ read: () => saved, update: vi.fn(), persist: f.persist, prepare: f.prepare, release: f.release, online: () => true })
  await expect(reloaded(provider(remote), saved.drafts[0])).rejects.toThrow('Check Sent')
  expect(remote).toHaveBeenCalledTimes(1)
})

it('retains a rejected send as failed without any sent history', async () => {
  const f = fixture()
  await expect(f.send(provider(async () => { throw new MailSendError('Authentication rejected', 'not_sent') }), f.draft)).rejects.toThrow('Authentication rejected')
  expect(f.read().drafts[0].sendState).toBe('failed')
  expect(f.read().messages).toHaveLength(0)
})

it('does not turn acceptance into failure when saving its receipt fails', async () => {
  const f = fixture(); f.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk unavailable'))
  const result = await f.send(provider(async draft => accepted(draft)), f.draft)
  expect(result.deliveryAccepted).toBe(true)
  expect(result.deliveryWarnings?.join(' ')).toContain('server accepted')
  expect(f.read().drafts).toHaveLength(0)
})

it('reconciles a lost response from a later server-confirmed Sent message', async () => {
  const f = fixture()
  let submitted!: Draft
  await expect(f.send(provider(async draft => { submitted = draft; throw new Error('Lost response') }), f.draft)).rejects.toThrow()
  const remote = { ...f.read(), drafts: [], messages: [accepted(submitted)] }
  const merged = mergeMailProviderSyncResult(f.read(), remote)
  expect(merged.drafts).toHaveLength(0)
  expect(merged.messages).toHaveLength(1)
  expect(merged.messages[0].deliveryAccepted).toBe(true)
})

it('preserves both versions when another client edits a locally edited draft', () => {
  const f = fixture()
  const baseline = { ...f.draft, providerDraftId: 'draft-on-account' }
  const local = { ...baseline, body: 'My edit', providerRevision: draftContentRevision(baseline) }
  const remote = { ...baseline, body: 'Edit from my phone', providerDraftMessageId: 'new-account-message' }
  const merged = mergeMailDrafts([local], [remote], true)[0]
  expect(merged.body).toBe('My edit')
  expect(merged.providerConflict?.body).toBe('Edit from my phone')
  expect(merged.syncState).toBe('conflict')
  expect(merged.providerDraftMessageId).toBe('new-account-message')
})

it('does not resurrect a consumed draft from a stale server snapshot', async () => {
  const f = fixture()
  f.draft.providerDraftId = 'stored-draft'
  await f.send(provider(async draft => accepted(draft)), f.draft)
  const sent = f.read().messages[0]
  const stale = { ...f.draft, providerDraftId: 'stored-draft', providerDraftMessageId: 'stale-message' }
  const remote = { ...f.read(), drafts: [stale], messages: [{ ...sent, id: 'stale-message', isDraft: true }] }
  const merged = mergeMailProviderSyncResult(f.read(), remote)
  expect(merged.drafts).toHaveLength(0)
  expect(merged.messages).toHaveLength(1)
  expect(merged.messages[0].isDraft).not.toBe(true)
})

it('replaces its local receipt with one server copy and preserves cleanup warnings', async () => {
  const f = fixture(); f.draft.providerDraftId = 'stored-draft'
  await f.send(provider(async draft => accepted(draft)), f.draft)
  const local = f.read().messages[0]
  const remoteCopy = { ...local, id: 'imap_msg_Sent_123', deliveryAccepted: undefined }
  const remote = { ...f.read(), messages: [remoteCopy], drafts: [{ ...f.draft, providerDraftId: 'stored-draft' }] }
  const merged = mergeMailProviderSyncResult(f.read(), remote)
  expect(merged.messages).toHaveLength(1)
  expect(merged.messages[0].id).toBe('imap_msg_Sent_123')
  expect(merged.messages[0].deliveryWarnings?.join(' ')).toContain('old Drafts copy')
  const cleaned = mergeMailProviderSyncResult(merged, { ...remote, drafts: [] })
  expect(cleaned.messages).toHaveLength(1)
  expect(cleaned.messages[0].deliveryWarnings).toBeUndefined()
})

it('removes a synced draft sent or discarded in another client after full draft coverage', () => {
  const f = fixture()
  const synced = { ...f.draft, providerDraftId: 'stored-draft', syncState: 'synced' as const }
  expect(mergeMailDrafts([synced], [], false)).toHaveLength(1)
  expect(mergeMailDrafts([synced], [], true)).toHaveLength(0)
})

it.each(['pending', 'failed', 'conflict'] as const)('keeps %s local draft edits when the provider copy disappears', syncState => {
  const f = fixture()
  const local = { ...f.draft, providerDraftId: 'account-draft', body: 'Unpushed edits', syncState }
  const merged = mergeMailDrafts([local], [], true)
  expect(merged).toHaveLength(1)
  expect(merged[0]).toMatchObject({ id: local.id, body: 'Unpushed edits', providerSaveUncertain: true })
})

it('keeps the conversation for retained local draft edits when it disappears remotely', () => {
  const f = fixture()
  const local = { ...f.read(),
    accounts: [{ id: 'acc', email: 'me@example.test', name: 'Me', provider: 'imap' as const, syncState: 'online' as const }],
    mailboxes: [{ id: 'inbox', accountId: 'acc', name: 'Inbox', role: 'inbox' as const, unreadCount: 0 }],
    threads: f.read().threads.map(thread => ({ ...thread, accountId: 'acc', mailboxId: 'inbox', lastMessageAt: '2026-10-03T03:00:00Z' })),
    drafts: [{ ...f.draft, providerDraftId: 'account-draft', body: 'Unpushed edits', syncState: 'pending' as const }],
  }
  const remote = { ...local, drafts: [], threads: [], messages: [], syncCoverage: { draftsCovered: true } }
  const merged = mergeMailProviderSyncResult(local, remote, '2026-10-03T04:00:00Z')
  expect(merged.drafts[0]?.body).toBe('Unpushed edits')
  expect(merged.threads.map(thread => thread.id)).toContain(f.draft.threadId)
})

it('never submits an already confirmed draft again', async () => {
  const f = fixture(); const remote = vi.fn(async (draft: Draft) => accepted(draft))
  await f.send(provider(remote), f.draft)
  await expect(f.send(provider(remote), f.draft)).rejects.toThrow('already sent')
  expect(remote).toHaveBeenCalledTimes(1)
})
