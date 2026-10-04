import { describe, expect, it } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { mergeThreadFragment } from './mailStoreData'
import type { MailMessage } from '../types'

describe('on-demand thread history and accepted sends', () => {
  function fixture() {
    const store = demoMailStore()
    const thread = store.threads[0]
    const receipt: MailMessage = { ...store.messages.find(message => message.threadId === thread.id)!, id: 'local-smtp-receipt', messageIdHeader: '<accepted@example.com>', deliveryAccepted: true, sentDraftId: 'consumed-draft', sentDraftProviderIds: ['old-provider-draft'], sentCopyMime: 'exact-mime-for-repair', deliveryWarnings: ['Could not confirm the IMAP Sent copy.', 'The old Drafts copy needs cleanup.'], deliveryRejectedRecipients: ['rejected@example.com'], read: true }
    store.messages = [receipt]
    const remote: MailMessage = { ...receipt, id: 'imap_msg_Sent_432', read: false, deliveryAccepted: undefined, sentCopyPresent: true, sentCopyMime: undefined, sentDraftId: undefined, sentDraftProviderIds: undefined, deliveryWarnings: undefined, deliveryRejectedRecipients: undefined }
    return { store, thread, receipt, remote }
  }

  it('replaces the local receipt with one remote copy while preserving delivery evidence', () => {
    const { store, thread, remote } = fixture()
    const result = mergeThreadFragment(store, { threads: [thread], messages: [remote] })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({ id: remote.id, read: true, deliveryAccepted: true, sentCopyPresent: true, sentDraftId: 'consumed-draft', sentDraftProviderIds: ['old-provider-draft'], deliveryRejectedRecipients: ['rejected@example.com'], deliveryWarnings: ['The old Drafts copy needs cleanup.'] })
    expect(result.messages[0].sentCopyMime).toBeUndefined()
    expect(mergeThreadFragment(result, { threads: [thread], messages: [remote] }).messages).toHaveLength(1)
  })

  it('keeps repair MIME and warnings when history is only an Inbox mirror', () => {
    const { store, thread, remote } = fixture()
    const result = mergeThreadFragment(store, { threads: [thread], messages: [{ ...remote, sentCopyPresent: false }] })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].sentCopyMime).toBe('exact-mime-for-repair')
    expect(result.messages[0].deliveryWarnings).toContain('Could not confirm the IMAP Sent copy.')
  })

  it('preserves a local unread choice and stronger provider delivery metadata', () => {
    const { store, thread, remote } = fixture()
    store.messages[0].read = false
    const result = mergeThreadFragment(store, { threads: [thread], messages: [{ ...remote, read: true, deliveryRejectedRecipients: ['other-rejected@example.com'], sentDraftProviderIds: ['another-consumed-draft'] }] })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].read).toBe(false)
    expect(result.messages[0].deliveryRejectedRecipients).toEqual(['rejected@example.com', 'other-rejected@example.com'])
    expect(result.messages[0].sentDraftProviderIds).toEqual(['old-provider-draft', 'another-consumed-draft'])
  })

  it('does not consume a receipt in a different account with the same RFC ID', () => {
    const { store, thread, remote } = fixture()
    const other = { ...thread, id: 'other-account-thread', accountId: 'other-account' }
    const result = mergeThreadFragment(store, { threads: [other], messages: [{ ...remote, threadId: other.id }] })
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].deliveryAccepted).toBeUndefined()
  })

  it('does not treat a Draft with the same header as delivered mail', () => {
    const { store, thread, remote } = fixture()
    const result = mergeThreadFragment(store, { threads: [thread], messages: [{ ...remote, isDraft: true }] })
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].deliveryAccepted).toBeUndefined()
  })

  it('preserves ambiguous local receipts rather than guessing', () => {
    const { store, thread, receipt, remote } = fixture()
    store.messages.push({ ...receipt, id: 'another-receipt' })
    const result = mergeThreadFragment(store, { threads: [thread], messages: [remote] })
    expect(result.messages).toHaveLength(3)
    expect(result.messages[2].deliveryAccepted).toBeUndefined()
  })

  it('preserves ambiguous remote copies rather than assigning one receipt twice', () => {
    const { store, thread, remote } = fixture()
    const result = mergeThreadFragment(store, { threads: [thread], messages: [remote, { ...remote, id: 'other-provider-copy' }] })
    expect(result.messages).toHaveLength(3)
    expect(result.messages.filter(message => message.deliveryAccepted)).toHaveLength(1)
  })

  it('leaves a newer unsent reply and unrelated history untouched', () => {
    const { store, thread, receipt, remote } = fixture()
    const draft = { ...store.drafts[0], id: 'newer-reply', threadId: thread.id, body: 'Keep this newer unsent reply', sentAt: undefined }
    store.drafts = [draft]
    store.messages.push({ ...receipt, id: 'older-history', messageIdHeader: '<earlier@example.com>', deliveryAccepted: undefined })
    const result = mergeThreadFragment(store, { threads: [thread], messages: [remote] })
    expect(result.drafts).toEqual([draft])
    expect(result.messages.map(message => message.id)).toEqual(['older-history', remote.id])
  })

  it('does not attach one receipt to different records identified by separate headers', () => {
    const { store, thread, remote } = fixture()
    store.messages[0].gmailMessageId = 'gmail-accepted'
    const result = mergeThreadFragment(store, { threads: [thread], messages: [remote, { ...remote, id: 'another-remote', messageIdHeader: undefined, gmailMessageId: 'gmail-accepted' }] })
    expect(result.messages).toHaveLength(3)
    expect(result.messages.filter(message => message.deliveryAccepted)).toHaveLength(1)
  })

  it('requires an accepted receipt, not just matching ordinary RFC IDs', () => {
    const { store, thread, remote } = fixture()
    store.messages[0].deliveryAccepted = undefined
    const result = mergeThreadFragment(store, { threads: [thread], messages: [remote] })
    expect(result.messages).toHaveLength(2)
  })

  it('correlates a Gmail send using its account-scoped provider ID', () => {
    const { store, thread, remote } = fixture()
    store.messages[0] = { ...store.messages[0], messageIdHeader: undefined, gmailMessageId: 'gmail-accepted' }
    const result = mergeThreadFragment(store, { threads: [thread], messages: [{ ...remote, messageIdHeader: undefined, gmailMessageId: 'gmail-accepted' }] })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].deliveryAccepted).toBe(true)
  })
})
