import type { MailMessage, MailStore } from '../types'
import type { Draft } from '../types'

/** An append may have landed; retrying it could create another draft. */
export class MailDraftSaveUncertain extends Error {}

/** Draft identity is separate from the Message-ID of a submitted message. */
export function imapDraftMessageId(draft: Pick<Draft, 'id' | 'providerDraftMessageIdHeader'>): string {
  const existing = draft.providerDraftMessageIdHeader?.trim().replace(/^</, '').replace(/>$/, '')
  return existing && /^[^<>\s]+$/.test(existing)
    ? `<${existing}>`
    : `<puremail-draft-${encodeURIComponent(draft.id)}@puremail.local>`
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
export const LOST_HOLD_REASON = 'Mail closed before it left. Nothing was sent.'
export const LOST_SUBMISSION_REASON = 'Mail closed while sending, so this may have gone. Check Sent before allowing another attempt.'
export const NO_EVIDENCE_REASON = 'Mail has no record of whether this left. Check Sent before allowing another attempt.'

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
  if (draft.sendAttempt) return { state: draft.sendAttempt.phase === 'held' ? 'held' : 'submitting', at: draft.sendAttempt.at }
  if (draft.sendState === 'uncertain') return { state: 'unconfirmed', reason: draft.sendError || UNCONFIRMED_REASON }
  if (draft.syncState === 'conflict' || draft.providerConflict) return { state: 'conflict', reason: CONFLICT_REASON }
  if (draft.sendState === 'failed' || draft.sendError) return { state: 'not_submitted', reason: draft.sendError || 'The send failed. Nothing was sent.' }
  if (draft.sendUndoneAt) return { state: 'not_submitted', reason: 'The send was undone. Nothing was sent.', at: draft.sendUndoneAt }
  return { state: 'none' }
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
  return patchDraft(store, draftId, draft => (draft.sendState === 'uncertain' ? draft : { ...draft, sendAttempt: { ...attempt, phase: 'held' }, sendState: undefined, sendError: undefined, sendUndoneAt: undefined }))
}

/** This attempt ended before anything left. A later or different attempt is left alone. */
export function settleDraftNotSent(store: MailStore, draftId: string, attemptId: string, reason: string): MailStore {
  return patchDraft(store, draftId, draft => (draft.sendAttempt?.id === attemptId ? { ...draft, sendAttempt: undefined, sendState: 'failed', sendError: reason } : draft))
}

export function undoDraftHold(store: MailStore, draftId: string, attemptId: string, at: string): MailStore {
  return patchDraft(store, draftId, draft => (draft.sendAttempt?.id === attemptId && draft.sendAttempt.phase === 'held' ? { ...draft, sendAttempt: undefined, sendUndoneAt: at } : draft))
}
