import type { Attachment, MailMessage, MailStore } from '../types'
import type { Draft } from '../types'
import { attachmentReceiptHash, receiptTextHash } from './mailAttachmentIdentity'

/** An append may have landed; retrying it could create another draft. */
export class MailDraftSaveUncertain extends Error {}

/** Draft identity is separate from the Message-ID of a submitted message. */
export function imapDraftMessageId(draft: Pick<Draft, 'id' | 'providerDraftMessageIdHeader'>): string {
  const existing = draft.providerDraftMessageIdHeader?.trim().replace(/^</, '').replace(/>$/, '')
  return existing && /^[^<>\s]+$/.test(existing)
    ? `<${existing}>`
    : `<puremail-draft-${encodeURIComponent(draft.id)}@puremail.local>`
}

/** The draft id a Message-ID minted by imapDraftMessageId names, if it is one. */
export function draftIdFromMessageId(header: string | undefined): string | null {
  const minted = /^<?puremail-draft-([^@<>\s]+)@puremail\.local>?$/.exec(header?.trim() ?? '')?.[1]
  if (!minted) return null
  try {
    return decodeURIComponent(minted)
  } catch {
    return null
  }
}

/** Content-only baseline for detecting edits made in another mail client. */
export function draftContentRevision(draft: Draft): string {
  const emails = (contacts: Draft['to']) => contacts.map(contact => contact.email.trim().toLowerCase()).sort()
  return JSON.stringify({ subject: draft.subject, body: draft.body.replace(/\r\n/g, '\n'), to: emails(draft.to), cc: emails(draft.cc ?? []), bcc: emails(draft.bcc ?? []), ...(draft.replyTo?.length ? { replyTo: emails(draft.replyTo) } : {}), attachments: draft.attachments.map(attachment => [attachment.name, attachment.mimeType]) })
}

/** The hold is over: Undo no longer applies, and the marker saved next is what says it may have gone. */
export function markDraftPreparing(store: MailStore, draftId: string, attemptId: string): MailStore {
  return {
    ...store,
    drafts: store.drafts.map(draft => (draft.id === draftId && draft.sendAttempt?.id === attemptId ? { ...draft, sendAttempt: { ...draft.sendAttempt, phase: 'preparing' as const } } : draft)),
  }
}

/** Send failures belong to the draft, independently of incoming-mail sync. */
export function markDraftSendFailed(store: MailStore, draftId: string, error: unknown): MailStore {
  // A failure of an attempt the draft has moved on from says nothing about what the draft holds now.
  if ((error as { superseded?: boolean } | null)?.superseded) return store
  const reason = error instanceof Error ? error.message : String(error || 'Send failed.')
  return {
    ...store,
    drafts: store.drafts.map(draft => draft.id === draftId ? { ...draft, sendError: reason } : draft),
  }
}

/** Keep transport internals in recovery details, not in the mail chrome. */
export function mailErrorToastText(reason: string): string {
  if (/fetchAttachment|No message with uid|attachment.*(download|content)|reattach/i.test(reason))
    return 'An attachment is unavailable. Open the draft and reattach the missing file.'
  if (/authentication|stored.*password|password.*missing|credentials/i.test(reason))
    return 'Mail authentication failed. Check the account credentials in Mail settings.'
  if (/timed? ?out|timeout/i.test(reason))
    return 'Mail connection timed out. Check your connection or mail bridge and try again.'
  if (/not connected|connection (?:closed|refused|reset)|socket clos(?:e|ed)|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i.test(reason))
    return 'Mail connection failed. Check your network or mail bridge.'
  return reason.replace(/^Failed:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').slice(0, 240)
}

export function mailConnectionsVerified(result: { receiving: string; sending: string } | null): boolean {
  return !!result && [result.receiving, result.sending].every(value =>
    /verified/i.test(value) && !/failed|not verified|unavailable|timed out|error/i.test(value))
}

export type DraftDeliveryState = 'none' | 'held' | 'submitting' | 'not_submitted' | 'unconfirmed' | 'conflict' | 'submitted'

/** The one reading of what happened to a send, from evidence on the record. */
export interface DraftDelivery {
  state: DraftDeliveryState
  reason?: string
  at?: string
  sentMessageId?: string
}

type DeliveryStore = Pick<MailStore, 'drafts' | 'messages'>

export const UNCONFIRMED_REASON = 'The previous send was not confirmed. Check Sent before allowing another attempt.'
export const CONFLICT_REASON = 'This draft has conflicting edits from another mail app. Resolve them before sending.'
export const CHANGED_REASON = 'It changed after it was approved, so it was not sent. Approve it again.'
export const LOST_HOLD_REASON = 'Mail lost touch with this send before it reached the mail service, and cannot show that it stopped. Check Sent before allowing another attempt.'
export const LOST_SUBMISSION_REASON = 'Mail lost touch with this send while it was going, so this may have gone. Check Sent before allowing another attempt.'
export const NO_EVIDENCE_REASON = 'Mail has no record of whether this left. Check Sent before allowing another attempt.'
export const SUPERSEDED_REASON = 'This attempt stopped before it left, because another attempt or Mail window took over. Nothing went from this attempt.'

/**
 * The stored copy that proves the service took it: a receipt or a synced Sent
 * copy. An optimistic "Sending…" placeholder and a draft copy prove nothing.
 */
export function confirmedSentCopy(store: Pick<MailStore, 'messages'>, draftId: string): MailMessage | undefined {
  return store.messages.find(message => !message.isDraft && !message.optimistic && (message.sentDraftId === draftId || message.id.startsWith(`msg_sent_${draftId}_`)))
}

/**
 * Sent means the mail service confirmed submission, never that anyone received
 * or read it. A queued state, an elapsed timer or a missing Sent copy is not
 * evidence either way, so each state below rests on what is actually recorded.
 */
export function draftDelivery(store: DeliveryStore, draftId: string): DraftDelivery {
  const draft = store.drafts.find(item => item.id === draftId)
  const copy = confirmedSentCopy(store, draftId)
  if (draft?.sentAt || copy) {
    const at = draft?.sentAt ?? copy?.receivedAt
    const sentMessageId = copy ? copy.gmailMessageId ?? copy.id : draft?.sentMessageId
    return { state: 'submitted', ...(at ? { at } : {}), ...(sentMessageId ? { sentMessageId } : {}) }
  }
  if (!draft) return { state: 'none' }
  const earlier = draft.sendUncertainties?.find(item => !item.checkedAt && !store.messages.some(message => message.deliveryAccepted && message.sentAttemptId === item.attemptId))
  if (earlier) return { state: 'unconfirmed', reason: earlier.reason }
  if (draft.sendAttempt) return { state: draft.sendAttempt.phase === 'held' ? 'held' : 'submitting', at: draft.sendAttempt.at }
  if (draft.sendState === 'uncertain') return { state: 'unconfirmed', reason: draft.sendError || UNCONFIRMED_REASON }
  if (draft.syncState === 'conflict' || draft.providerConflict) return { state: 'conflict', reason: CONFLICT_REASON }
  if (draft.sendState === 'failed' || draft.sendError) return { state: 'not_submitted', reason: draft.sendError || 'The send failed. Nothing was sent.' }
  if (draft.sendUndoneAt) return { state: 'not_submitted', reason: 'The send was undone. Nothing was sent.', at: draft.sendUndoneAt }
  return { state: 'none' }
}

/** A draft can carry uncertainty from its current or a superseded submission. */
export function hasUnconfirmedSendEvidence(draft: Pick<Draft, 'sendState' | 'sendUncertainties'>): boolean {
  return draft.sendState === 'uncertain' || Boolean(draft.sendUncertainties?.some(item => !item.checkedAt))
}

/** A display label or local id alone cannot establish which file was submitted. */
function sameReceiptAttachment(left: Attachment, right: Attachment): boolean {
  if (!left || !right || typeof left.name !== 'string' || typeof left.mimeType !== 'string' ||
      left.name !== right.name || left.mimeType !== right.mimeType) return false
  const leftHash = attachmentReceiptHash(left)
  const rightHash = attachmentReceiptHash(right) ?? (/^[a-f0-9]{64}$/.test(right.receiptContentHash ?? '') ? right.receiptContentHash : undefined)
  // Provider part ids and display sizes may change when the same bytes are saved.
  if (leftHash !== undefined && rightHash !== undefined) return leftHash === rightHash
  const reference = (file: Attachment) => {
    // Only explicit hydration provenance can bridge bytes to a remote-only copy.
    const ref = file.content ? file.hydratedFrom : file.remote
    switch (ref?.provider) {
      case 'gmail': return ref.messageId && ref.attachmentId ? ['gmail', ref.messageId, ref.attachmentId] : null
      case 'imap': return ref.folderPath && Number.isInteger(ref.uid) && ref.uid > 0 && ref.partId ? ['imap', ref.folderPath, ref.uid, ref.partId] : null
    }
    return null
  }
  const a = reference(left), b = reference(right)
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b))
}

/** Reserved identity for one unsent revision per original draft and confirmed attempt. */
export const RECEIPT_DRAFT_ID_PREFIX = 'draft_compose_after_'

/** A separate unsent draft never owns the original's submission or provider copy. */
export function unsentDraftAfterReceipt(draft: Draft, id: string): Draft {
  return {
    ...draft, id, syncState: 'pending',
    sendAttempt: undefined, sendSupersedes: undefined, sendUncertainties: undefined,
    sendState: undefined, sendError: undefined, sendUndoneAt: undefined,
    sendSettledAttemptId: undefined, sendMessageId: undefined,
    sentAt: undefined, sentMessageId: undefined, sentTo: undefined, sentCc: undefined, sentBcc: undefined,
    sentWithoutReview: undefined, sentByAutomation: undefined, sentReviewBypassReason: undefined,
    providerDraftId: undefined, providerDraftMessageId: undefined, providerDraftMessageIdHeader: undefined,
    staleProviderDraftIds: undefined, providerRevision: undefined, providerAbsentOnce: undefined,
    importedFromProvider: undefined, providerSaveUncertain: undefined, providerSaveWarning: undefined,
    providerSaveError: undefined,
  }
}

const receiptText = (text: string): string => text.replace(/\r\n/g, '\n').trim()
function receiptAddresses(contacts: Draft['to']): string[] | null {
  if (!Array.isArray(contacts) || contacts.some(contact => !contact || typeof contact.email !== 'string' || !contact.email.trim())) return null
  return contacts.map(contact => contact.email.trim().toLowerCase()).sort()
}

/** Keep later words and files apart when a receipt for a superseded submission arrives. */
export function draftAfterEarlierReceipt(draft: Draft, receipt: Pick<MailMessage, 'id' | 'receivedAt' | 'sentAttemptId' | 'subject' | 'body' | 'bodyHtml' | 'receiptBodyHtmlHash' | 'to' | 'cc' | 'bcc' | 'attachments'>): { evidence: Draft; later?: Draft } {
  // Another confirmed attempt already owns this record. Its receipt remains authoritative.
  if (draft.sentAt) return { evidence: draft }
  const html = draft.bodyHtml ?? ''
  const sameHtml = typeof html === 'string' && (receipt.bodyHtml !== undefined
    ? typeof receipt.bodyHtml === 'string' && receiptText(html) === receiptText(receipt.bodyHtml)
    : /^[a-f0-9]{64}$/.test(receipt.receiptBodyHtmlHash ?? '')
      ? [html, receiptText(html)].some(value => receiptTextHash(value) === receipt.receiptBodyHtmlHash)
      : !html)
  const complete = typeof receipt.subject === 'string' && typeof receipt.body === 'string' && Array.isArray(receipt.to) && Array.isArray(receipt.attachments)
  const draftAddresses = [draft.to, draft.cc ?? [], draft.bcc ?? []].map(receiptAddresses)
  const sentAddresses = [receipt.to, receipt.cc ?? [], receipt.bcc ?? []].map(receiptAddresses)
  const same = complete && typeof draft.body === 'string' && draft.subject === receipt.subject && receiptText(draft.body) === receiptText(receipt.body) && sameHtml &&
    draftAddresses.every((emails, index) => emails !== null && sentAddresses[index] !== null && JSON.stringify(emails) === JSON.stringify(sentAddresses[index])) &&
    draft.attachments.length === receipt.attachments.length && draft.attachments.every((file, index) => sameReceiptAttachment(file, receipt.attachments[index]))
  // The id is stable over repeated reads and conditional-write retries.
  const later = !same ? unsentDraftAfterReceipt(draft, `${RECEIPT_DRAFT_ID_PREFIX}${draft.id}_${receipt.sentAttemptId ?? receipt.id}`) : undefined
  const evidence: Draft = { ...draft, attachments: Array.isArray(receipt.attachments) ? receipt.attachments : [], ...(complete ? { subject: receipt.subject, body: receipt.body, bodyHtml: receipt.bodyHtml, to: receipt.to, cc: receipt.cc ?? [], bcc: receipt.bcc ?? [], attachments: receipt.attachments } : {}), sentAt: receipt.receivedAt, sentMessageId: receipt.id }
  return { evidence, ...(later ? { later } : {}) }
}

/** One plain sentence for whoever reports it. */
export function deliveryNote(delivery: DraftDelivery): string {
  switch (delivery.state) {
    case 'held': return 'Waiting in the undo hold: nothing has left yet.'
    case 'submitting': return 'Being submitted to the mail service: not confirmed yet.'
    case 'not_submitted': return `Not sent. ${delivery.reason ?? ''}`.trim()
    case 'unconfirmed': return `Not confirmed: it may have gone. ${delivery.reason ?? ''}`.trim()
    case 'conflict': return delivery.reason ?? CONFLICT_REASON
    case 'submitted': return 'Sent: the mail service accepted it. That does not show it was received or read.'
    case 'none': return 'Not sent.'
  }
}

/** Why a send of this draft must not be queued at all; null when a person may send it. */
export function draftReleaseBlock(store: DeliveryStore, draftId: string): { reason: string; outcome: 'not_sent' | 'uncertain' } | null {
  // The attempt under way is not itself a block: what lies beneath it is.
  const delivery = draftDelivery({ ...store, drafts: store.drafts.map(draft => (draft.id === draftId ? { ...draft, sendAttempt: undefined } : draft)) }, draftId)
  if (delivery.state === 'submitted') return { reason: 'This draft was sent already.', outcome: 'not_sent' }
  if (delivery.state === 'unconfirmed') return { reason: UNCONFIRMED_REASON, outcome: 'uncertain' }
  if (delivery.state === 'conflict') return { reason: CONFLICT_REASON, outcome: 'not_sent' }
  return null
}

/** Why this draft's content must not change now; null when it may. */
export function draftEditBlock(store: DeliveryStore, draftId: string): string | null {
  const { state } = draftDelivery(store, draftId)
  if (state === 'held') return 'This message is waiting to send. Undo it first to change it; after that it needs a fresh approval.'
  if (state === 'submitting') return 'This message is being sent, so it cannot change now.'
  if (state === 'unconfirmed') return 'The previous send was not confirmed. Check Sent before changing this draft.'
  return null
}

/** Throwing a draft away would destroy the only record of a send that may be under way. */
export const draftDiscardBlock = draftEditBlock

const patchDraft = (store: MailStore, draftId: string, patch: (draft: Draft) => Draft): MailStore => ({
  ...store,
  drafts: store.drafts.map(draft => (draft.id === draftId ? patch(draft) : draft)),
})

export function holdDraftForSend(store: MailStore, draftId: string, attempt: Omit<NonNullable<Draft['sendAttempt']>, 'phase'>): MailStore {
  // An unconfirmed marker is cleared only by someone checking Sent, never by a new hold.
  return patchDraft(store, draftId, draft => (draftReleaseBlock(store, draftId) ? draft : { ...draft, sendSupersedes: [...new Set([...(draft.sendSupersedes ?? []), draft.sendAttempt?.id, draft.sendSettledAttemptId].filter((id): id is string => Boolean(id) && id !== attempt.id))], sendAttempt: { ...attempt, phase: 'held' }, sendState: undefined, sendError: undefined, sendUndoneAt: undefined, sendSettledAttemptId: undefined }))
}

/** An approved attempt ended without leaving: an old schedule must not quietly try again. Another try is a new decision. */
export function stopDraftSchedules(store: MailStore, draftId: string, reason: string): MailStore {
  if (!store.scheduledSends?.some(entry => entry.draftId === draftId && entry.status === 'scheduled')) return store
  return { ...store, scheduledSends: store.scheduledSends.map(entry => (entry.draftId === draftId && entry.status === 'scheduled' ? { ...entry, status: 'failed' as const, lastError: reason } : entry)) }
}

/**
 * This attempt ended before anything left. A later or different attempt is left
 * alone, and so is an uncertainty an earlier attempt left beneath it.
 */
export function settleDraftNotSent(store: MailStore, draftId: string, attemptId: string, reason: string): MailStore {
  if (!store.drafts.some(draft => draft.id === draftId && draft.sendAttempt?.id === attemptId)) return store
  return stopDraftSchedules(patchDraft(store, draftId, draft => (draft.sendAttempt?.id !== attemptId ? draft : draft.sendState === 'uncertain' ? { ...draft, sendAttempt: undefined, sendSettledAttemptId: attemptId } : { ...draft, sendAttempt: undefined, sendState: 'failed', sendError: reason, sendSettledAttemptId: attemptId })), draftId, reason)
}

export function undoDraftHold(store: MailStore, draftId: string, attemptId: string, at: string): MailStore {
  return patchDraft(store, draftId, draft => (draft.sendAttempt?.id === attemptId && draft.sendAttempt.phase === 'held' ? { ...draft, sendAttempt: undefined, sendUndoneAt: at, sendSettledAttemptId: attemptId } : draft))
}
