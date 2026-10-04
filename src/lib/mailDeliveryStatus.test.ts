import { imapDraftMessageId, mailConnectionsVerified, mailErrorToastText } from './mailDeliveryStatus'
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

it('only marks connections healthy when both directions are verified', () => {
  expect(mailConnectionsVerified({ receiving: 'IMAP connection verified', sending: 'SMTP authentication verified; no test email sent' })).toBe(true)
  expect(mailConnectionsVerified({ receiving: 'IMAP connection verified', sending: 'Failed: SMTP authentication failed' })).toBe(false)
  expect(mailConnectionsVerified({ receiving: 'IMAP connection verified', sending: 'Not verified' })).toBe(false)
  expect(mailConnectionsVerified(null)).toBe(false)
})

it('keeps raw transport identifiers out of error toasts', () => {
  expect(mailErrorToastText("Error invoking remote method 'shell:mailTransport:fetchAttachment': No message with uid 442 in Drafts")).toBe('An attachment is unavailable. Open the draft and reattach the missing file.')
  expect(mailErrorToastText('SMTP connection test timed out after 35 seconds.')).toContain('Mail connection timed out')
})

it('never lets a malformed stored draft Message-ID inject MIME headers', () => {
  const safe = imapDraftMessageId({ id: 'draft\r\nunsafe', providerDraftMessageIdHeader: '<evil@example.test>\r\nBcc: other@example.test' })
  expect(safe).toBe('<puremail-draft-draft%0D%0Aunsafe@puremail.local>')
  expect(safe).not.toMatch(/[\r\n]/)
})
