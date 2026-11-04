import { expect, it } from 'vitest'
import { draftAfterEarlierReceipt } from './mailDeliveryStatus'
import { settleReceipt } from './mailDelivery'
import { draftSendFingerprint } from './mailDrawerDrafts'
import { createComposedMessageDraft, emptyMailStore } from './mailModel'
import type { Draft, MailMessage } from '../types'

function example() {
  const made = createComposedMessageDraft(emptyMailStore(), { to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Approved', attachments: [] })
  const sent = made.store.drafts[0]
  const receipt: MailMessage = { id: 'older-receipt', threadId: sent.threadId, from: { name: 'Me', email: 'me@example.test' }, to: sent.to, cc: [], bcc: [], subject: sent.subject, body: sent.body, attachments: [], read: true, receivedAt: '2026-11-02T10:00:00Z', deliveryAccepted: true, sentDraftId: sent.id, sentAttemptId: 'A' }
  return { ...made, sent, receipt }
}

it('an older receipt leaves an already confirmed record and its newer content unchanged', () => {
  const { store, sent, receipt } = example()
  const newer: Draft = { ...sent, body: 'Confirmed later words', sentAt: '2026-11-02T10:10:00Z', sentMessageId: 'newer-receipt', sendSettledAttemptId: 'B', sendSupersedes: ['A'] }
  expect(draftAfterEarlierReceipt(newer, receipt)).toEqual({ evidence: newer })
  const settled = settleReceipt({ ...store, drafts: [newer] }, sent, 'A', draftSendFingerprint(sent), { sentMessage: receipt, sentMessageId: receipt.id })
  expect(settled.drafts).toEqual([newer])
  expect(settled.messages.some(message => message.sentAttemptId === 'A')).toBe(true)
})

it.each(['sync/file', 'controller'] as const)('%s: a later draft carries content but no receipt or provider-copy state', path => {
  const { store, sent, receipt } = example()
  const later: Draft = {
    ...sent, body: 'Later words', sendSettledAttemptId: 'B', sendSupersedes: ['A'],
    sentTo: sent.to, sentCc: sent.to, sentBcc: sent.to,
    staleProviderDraftIds: ['old-uid'], providerRevision: 'old-revision', providerDraftId: 'old-draft', providerDraftMessageId: 'old-message', providerDraftMessageIdHeader: '<old>',
    providerAbsentOnce: true, importedFromProvider: true, providerSaveUncertain: true, providerSaveWarning: 'old warning', providerSaveError: 'old error', providerConflict: { ...sent, subject: 'old conflict', body: 'old words', updatedAt: sent.updatedAt },
    sentWithoutReview: true, sentByAutomation: true, sentReviewBypassReason: 'old reason',
  }
  const kept = path === 'sync/file' ? draftAfterEarlierReceipt(later, receipt).later! : settleReceipt({ ...store, drafts: [later] }, sent, 'A', draftSendFingerprint(sent), { sentMessage: receipt, sentMessageId: receipt.id }).drafts.find(draft => draft.id !== sent.id)!
  expect(kept.body).toBe('Later words')
  expect(kept.syncState).toBe('pending')
  // A conflicting version contains writing, not obsolete provider-copy bookkeeping.
  expect(kept.providerConflict).toEqual(later.providerConflict)
  for (const key of ['sentAt', 'sentMessageId', 'sentTo', 'sentCc', 'sentBcc', 'sendAttempt', 'sendSupersedes', 'sendUncertainties', 'sendState', 'sendError', 'sendUndoneAt', 'sendSettledAttemptId', 'sendMessageId', 'providerDraftId', 'providerDraftMessageId', 'providerDraftMessageIdHeader', 'staleProviderDraftIds', 'providerRevision', 'providerAbsentOnce', 'importedFromProvider', 'providerSaveUncertain', 'providerSaveWarning', 'providerSaveError', 'sentWithoutReview', 'sentByAutomation', 'sentReviewBypassReason'] as const) expect(kept[key], key).toBeUndefined()
})

it.each(['to', 'cc', 'bcc'] as const)('incomplete %s contact evidence preserves the unsent content', field => {
  const { sent, receipt } = example()
  for (const contact of [{}, { email: '' }]) {
    const partial = { ...receipt, [field]: [contact] } as MailMessage
    expect(draftAfterEarlierReceipt(sent, partial).later).toMatchObject({ subject: sent.subject, body: sent.body, to: sent.to })
  }
})

it.each(['body', 'bodyHtml'] as const)('partial draft %s evidence remains unknown during receipt comparison', field => {
  const { sent, receipt } = example()
  const partial = { ...sent, [field]: field === 'body' ? undefined : {} } as Draft
  expect(draftAfterEarlierReceipt(partial, receipt).later).toBeDefined()
})
