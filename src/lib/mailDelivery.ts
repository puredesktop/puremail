import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
import { CHANGED_REASON, CONFLICT_REASON, SUPERSEDED_REASON, UNCONFIRMED_REASON, settleDraftNotSent, stopDraftSchedules } from './mailDeliveryStatus'
import { recordConfirmedSent } from './draftsFileMerge'
import { draftSendFingerprint } from './mailDrawerDrafts'
import { sendDraft } from './mailModel'
import { finalizeRunDraftForSend } from './mailRuns'

export class MailSendError extends Error {
  /** `superseded`: this is about an attempt the draft has moved on from, not about what the draft holds now. */
  constructor(message: string, readonly outcome: 'not_sent' | 'uncertain', readonly superseded = false) { super(message) }
}

/**
 * A provider receipt is authoritative for the attempt it answers. If the draft
 * has since moved on (a newer attempt, different words), that later work is not
 * what went: the copy records what was approved, and the later work stays an
 * unsent draft of its own for the person's own decision.
 */
export function settleReceipt(store: MailStore, sent: Draft, attemptId: string, approved: string, options: Parameters<typeof sendDraft>[3]): MailStore {
  const current = store.drafts.find(item => item.id === sent.id)
  const movedOn = current && ((current.sendAttempt && current.sendAttempt.id !== attemptId) || draftSendFingerprint(finalizeRunDraftForSend(current)) !== approved)
  if (!current || !movedOn) return sendDraft(store, sent.id, undefined, options)
  const later: Draft = { ...current, id: `draft_compose_${crypto.randomUUID()}`, sendAttempt: undefined, sendState: undefined, sendError: undefined, sendUndoneAt: undefined, sendSettledAttemptId: undefined, sendMessageId: undefined, providerDraftId: undefined, providerDraftMessageId: undefined, providerDraftMessageIdHeader: undefined, syncState: 'pending' }
  const done = sendDraft({ ...store, drafts: store.drafts.map(item => (item.id === sent.id ? { ...sent, sendAttempt: undefined } : item)) }, sent.id, undefined, options)
  return { ...done, drafts: [...done.drafts, later] }
}

/** One submission per draft. Persist uncertainty before contacting the server. */
export function createMailDeliveryController(input: {
  read: () => MailStore
  update: (updater: (store: MailStore) => MailStore) => void
  persist: (store: MailStore) => Promise<void>
  prepare: (draft: Draft) => Promise<Draft>
  release: (draftId: string) => void
  online: () => boolean
}) {
  const sending = new Set<string>()
  /** `attempt` names the approved hold this send carries out, and the content it approved. */
  return async (provider: MailProvider, draft: Draft, attempt?: { id: string; approved?: string }): Promise<MailMessage> => {
    if (sending.has(draft.id)) throw new MailSendError('This message is already being sent.', 'not_sent', true)
    const attemptId = attempt?.id ?? crypto.randomUUID()
    const approved = attempt?.approved ?? draftSendFingerprint(finalizeRunDraftForSend(draft))
    const changed = (): boolean => {
      const current = input.read().drafts.find(item => item.id === draft.id)
      return !current || draftSendFingerprint(finalizeRunDraftForSend(current)) !== approved
    }
    const refuse = (reason: string): MailSendError => {
      input.update(store => settleDraftNotSent(store, draft.id, attemptId, reason))
      return new MailSendError(reason, 'not_sent')
    }
    if (input.read().messages.some(message => message.deliveryAccepted && message.sentDraftId === draft.id)) {
      input.update(store => ({ ...store, drafts: store.drafts.filter(item => item.id !== draft.id) }))
      throw new MailSendError('This draft was already sent. No second copy was sent.', 'not_sent')
    }
    const saved = input.read().drafts.find(item => item.id === draft.id)
    if (!saved) throw new MailSendError('This draft no longer exists. Nothing was sent.', 'not_sent')
    if (saved.syncState === 'conflict' || saved.providerConflict) throw refuse(CONFLICT_REASON)
    if (saved.sendState === 'uncertain') throw new MailSendError(UNCONFIRMED_REASON, 'uncertain')
    if (!input.online()) throw refuse('Offline — message not sent. Your draft is saved.')
    if (changed()) throw refuse(CHANGED_REASON)
    sending.add(draft.id)
    let submitted = false
    let marked = false
    // A newer attempt under way or ended: the record is no longer this send's to carry on or settle.
    const settledAtStart = saved.sendSettledAttemptId
    const heldByOther = (item: Draft): boolean => (item.sendAttempt ? item.sendAttempt.id !== attemptId : item.sendSettledAttemptId !== settledAtStart && item.sendSettledAttemptId !== attemptId)
    const currentRecord = (): Draft | undefined => input.read().drafts.find(item => item.id === draft.id)
    // What another copy saved can arrive at any await here: a copy of this draft already sent ends it.
    const stopIfSent = (): void => {
      if (!recordConfirmedSent(input.read().messages, draft)) return
      input.update(store => ({ ...store, drafts: store.drafts.filter(item => item.id !== draft.id) }))
      throw new MailSendError('This draft was already sent. No second copy was sent.', 'not_sent')
    }
    try {
      const prepared = await input.prepare(draft)
      stopIfSent()
      // Provider saves finish during prepare; an edit that landed meanwhile stops it here.
      if (changed()) throw new MailSendError(CHANGED_REASON, 'not_sent')
      const beforeMarker = currentRecord()
      if (beforeMarker && (heldByOther(beforeMarker) || beforeMarker.sendState === 'uncertain')) throw new MailSendError(SUPERSEDED_REASON, 'not_sent')
      prepared.sendMessageId = `<puremail-${crypto.randomUUID()}@puremail.local>`
      const at = new Date().toISOString()
      input.update(store => ({ ...store, drafts: store.drafts.map(item => item.id === draft.id ? {
        ...item, providerDraftId: prepared.providerDraftId, sendMessageId: prepared.sendMessageId, sendState: 'uncertain', sendError: 'Send confirmation pending. Check Sent before retrying.', sendUndoneAt: undefined,
        sendAttempt: { id: attemptId, phase: 'submitting', approved, at },
      } : item) }))
      marked = true
      // If the process stops after submission, this durable marker blocks an
      // automatic retry instead of quietly turning the message into a draft.
      await input.persist(input.read())
      if (!input.online()) throw new MailSendError('Offline — message not sent. Your draft is saved.', 'not_sent')
      // Saving takes in what other copies saved, and the file's conditional write
      // decides whose marker came first: only the record still this attempt's may go.
      stopIfSent()
      if (currentRecord()?.sendAttempt?.id !== attemptId) throw new MailSendError(SUPERSEDED_REASON, 'not_sent')
      submitted = true
      const message = await provider.send({ draft: prepared, threadId: prepared.threadId })
      if (!message.id) throw new MailSendError('The server returned no send confirmation. Check Sent before retrying.', 'uncertain')
      const accepted = { ...message, deliveryAccepted: true, sentDraftId: draft.id, sentAttemptId: attemptId, ...(prepared.providerDraftId ? { sentDraftProviderId: prepared.providerDraftId } : {}), sentDraftProviderIds: [...new Set([prepared.providerDraftId, ...(prepared.staleProviderDraftIds ?? [])].filter((id): id is string => Boolean(id)))] }
      if (prepared.providerSaveWarning && !prepared.providerDraftId) accepted.deliveryWarnings = [...(accepted.deliveryWarnings ?? []), 'The message was accepted, but an earlier draft save was unconfirmed. Check the account Drafts folder for an old copy; do not resend it.']
      input.update(store => settleReceipt(store, draft, attemptId, approved, { sentMessage: accepted, sentMessageId: message.id, sentGmailMessageId: message.gmailMessageId }))
      // Once accepted, filing/persistence errors must never turn it back into
      // a failed send or cause the caller to submit it a second time.
      try { await input.persist(input.read()) } catch {
        accepted.deliveryWarnings = [...(accepted.deliveryWarnings ?? []), 'The server accepted this message, but its local sent record could not be saved. Check Sent before any retry.']
        input.update(store => ({ ...store, messages: store.messages.map(item => item.deliveryAccepted && item.threadId === draft.threadId && item.subject === draft.subject ? { ...item, deliveryWarnings: accepted.deliveryWarnings } : item) }))
      }
      return accepted
    } catch (error) {
      const uncertain = submitted && (!(error instanceof MailSendError) || error.outcome === 'uncertain')
      const reason = error instanceof Error ? error.message : 'Send failed.'
      // Only this attempt's own record. A Sent copy a sync found in the
      // meantime has already removed the draft and stays the answer.
      const record = currentRecord()
      const superseded = Boolean(record && heldByOther(record))
      // What was reported uncertain beneath this attempt before its own marker, it cannot clear.
      const staysUncertain = uncertain || (!marked && record?.sendState === 'uncertain' && !superseded && record.sendSettledAttemptId !== attemptId)
      input.update(store => {
        const settled = { ...store, drafts: store.drafts.map(item => {
          if (item.id !== draft.id) return item
          if (!heldByOther(item)) return { ...item, sendAttempt: undefined, sendState: staysUncertain ? 'uncertain' as const : 'failed' as const, sendError: staysUncertain && !uncertain ? item.sendError : reason, sendSettledAttemptId: attemptId }
          // It may have gone, and that outlives a newer attempt: this one's identity
          // and phase stand, and what lies beneath it now stops it leaving as well.
          if (!uncertain) return item
          return item.sendAttempt ? (item.sendAttempt.phase === 'submitting' ? item : { ...item, sendState: 'uncertain' as const, sendError: reason }) : { ...item, sendState: 'uncertain' as const, sendError: reason, sendSettledAttemptId: attemptId }
        }) }
        // A schedule's own dispatch names no attempt, and is settled by the scheduler.
        return attempt && !uncertain && !superseded ? stopDraftSchedules(settled, draft.id, reason) : settled
      })
      await input.persist(input.read()).catch(() => {})
      if (superseded) throw new MailSendError(reason, uncertain ? 'uncertain' : 'not_sent', true)
      throw error
    } finally {
      sending.delete(draft.id)
      input.release(draft.id)
    }
  }
}
