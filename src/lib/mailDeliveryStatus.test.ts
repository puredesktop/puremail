import { expect, it } from 'vitest'
import { emptyMailStore, createComposedMessageDraft, mergeMailDrafts, persistableMailStore, sendDraft } from './mailModel'
import { markDraftSendFailed } from './mailDeliveryStatus'
import { threadStatusLabel } from '../components/mailShellHelpers'

function fixture() {
  const initial = emptyMailStore()
  const result = createComposedMessageDraft(initial, { to: [{ name: 'Recipient', email: 'recipient@example.test' }], subject: 'Reply', body: 'My reply.', attachments: [] })
  const threadId = 'gmail_thread_reply'
  const store = { ...result.store, drafts: result.store.drafts.map(draft => ({ ...draft, threadId })), threads: result.store.threads.map(thread => ({ ...thread, id: threadId })) }
  return { store, draft: store.drafts.find(draft => draft.id === result.draftId)! }
}

it('keeps failed delivery in saved drafts and labels the conversation not sent', () => {
  const { store, draft } = fixture()
  const failed = markDraftSendFailed(store, draft.id, new Error('SMTP unavailable'))
  expect(persistableMailStore(failed).drafts[0].sendError).toBe('SMTP unavailable')
  expect(threadStatusLabel(failed, failed.threads[0], failed.drafts)).toBe('not sent')
  expect(failed.messages).toEqual(store.messages)
})

it('preserves a failed draft through incoming sync and a missing remote draft', () => {
  const { draft } = fixture()
  const failed = { ...draft, providerDraftId: 'imap_draft_1', syncState: 'synced' as const, sendError: 'SMTP unavailable' }
  expect(mergeMailDrafts([failed], [], true)).toEqual([failed])
  expect(mergeMailDrafts([failed], [{ ...draft, providerDraftId: failed.providerDraftId, updatedAt: '2099-01-01T00:00:00Z' }], true)[0].sendError).toBe('SMTP unavailable')
})

it('clears failed-draft feedback only after a confirmed send', () => {
  const { store, draft } = fixture()
  const failed = markDraftSendFailed(store, draft.id, 'SMTP unavailable')
  const sent = sendDraft(failed, draft.id, undefined, { sentMessageId: 'gmail_sent_confirmed', sentGmailMessageId: 'gmail_sent_confirmed' })
  expect(sent.drafts).toHaveLength(0)
  expect(sent.messages[0].optimistic).toBeUndefined()
  expect(persistableMailStore(sent).messages).toHaveLength(1)
  expect(persistableMailStore(sendDraft(store, draft.id)).messages).toHaveLength(0)
})
