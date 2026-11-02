import type { PendingSendState } from '../components/mailShellHelpers'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
import { MailSendError } from './mailDelivery'
import { CHANGED_REASON, draftDelivery, draftReleaseBlock, holdDraftForSend, settleDraftNotSent } from './mailDeliveryStatus'
import { draftSendFingerprint } from './mailDrawerDrafts'
import { sendDraft } from './mailModel'
import { finalizeRunDraftForSend } from './mailRuns'

export type SendStoreDraftResult =
  | { ok: true; pendingId: string; undoSeconds: number; already?: 'held' | 'submitting' }
  | { ok: false; reason: string }

export interface SendStoreDraftOptions {
  label?: string
  /** A send run's own item: only then does the log call it one. */
  fromRun?: boolean
  /** Accepted: the attempt exists, and the hold (if any) is about to start. */
  onStart?: (attemptId: string, undoSeconds: number) => void
  /** The hold elapsed and the attempt is going to the mail service. */
  onSubmitting?: (attemptId: string) => void
  /** The mail service confirmed it (or the demo account recorded it). */
  onCommitted?: (sentMessageId: string | undefined, attemptId: string) => void
  /** Known not submitted (`not_sent`), or it may have gone (`uncertain`). The draft is still in Drafts. */
  onFailed?: (reason: string, outcome: 'not_sent' | 'uncertain', attemptId: string) => void
}

/** Why a compose window must not start a send of this saved draft; null when it may. */
export function composeHoldBlock(store: Pick<MailStore, 'drafts' | 'messages'>, draftId: string): string | null {
  if (store.drafts.find(item => item.id === draftId)?.sendAttempt) return 'A send is already waiting. Undo it or let it finish.'
  return draftReleaseBlock(store, draftId)?.reason ?? null
}

/**
 * A compose window's hold on a saved draft: it may still go only if that draft
 * is what was approved, or the same text this window saved itself meanwhile.
 */
export function composeHoldStillApproved(current: Draft | undefined, attemptId: string, approved: string | undefined, outgoing: string | undefined): boolean {
  if (!current || current.sendAttempt?.id !== attemptId) return false
  const print = draftSendFingerprint(current)
  return print === approved || print === outgoing
}

/**
 * THE store-draft send: an existing draft, as it is in the store, goes out
 * through the usual undo hold and provider path — the run card's Send & next
 * and the sendRunItem and sendDraft tools all call exactly this. The draft is
 * finalized first (an empty note slot is stripped). What was approved is bound
 * to the attempt: if the store's draft differs when the hold ends, nothing
 * leaves. Nothing here sends more than the one draft it is handed.
 */
export function createStoreDraftSender(input: {
  read: () => MailStore
  update: (updater: (store: MailStore) => MailStore) => void
  provider: () => MailProvider | undefined
  /** No provider is expected: the local account's send is the source of truth. */
  localAccount: () => boolean
  canCompose: (provider: MailProvider) => boolean
  online: () => boolean
  home: () => string
  undoSeconds: () => number
  schedule: (pending: PendingSendState, commit: () => void, onStart?: () => void) => boolean
  holdForDraft: (draftId: string) => PendingSendState | undefined
  isDraftSending: (draftId: string) => boolean
  markDraftSending: (draftId: string, sending: boolean) => void
  deliver: (provider: MailProvider, draft: Draft, attempt: { id: string; approved: string }) => Promise<MailMessage>
  reportFailure: (draftId: string, reason: unknown) => void
  notice: (text: string) => void
  record: (kind: string, summary: string) => void
}): (draft: Draft, options: SendStoreDraftOptions) => SendStoreDraftResult {
  return (draft, options) => {
    // A second approval, however soon: report the attempt that exists.
    const hold = input.holdForDraft(draft.id)
    if (hold) return { ok: true, pendingId: hold.id, undoSeconds: input.undoSeconds(), already: 'held' }
    const live = input.read().drafts.find(item => item.id === draft.id)?.sendAttempt
    if (input.isDraftSending(draft.id) || live) {
      return { ok: true, pendingId: live?.id ?? draft.id, undoSeconds: input.undoSeconds(), already: live?.phase === 'held' ? 'held' : 'submitting' }
    }
    const blocked = draftReleaseBlock(input.read(), draft.id)
    if (blocked) return { ok: false, reason: blocked.reason }
    const stored = input.read().drafts.find(item => item.id === draft.id)
    if (!stored) return { ok: false, reason: 'The draft is not in Drafts any more. Nothing was sent.' }
    const finalized = finalizeRunDraftForSend(draft)
    const approved = draftSendFingerprint(finalized)
    if (draftSendFingerprint(finalizeRunDraftForSend(stored)) !== approved) return { ok: false, reason: CHANGED_REASON }
    const provider = input.provider()
    const home = input.home()
    if (provider && !input.canCompose(provider)) return { ok: false, reason: `${home} cannot send from here.` }
    if ((!provider || !input.online()) && !input.localAccount()) {
      input.reportFailure(finalized.id, 'Mail is disconnected — message not sent.')
      return { ok: false, reason: `${home} is not connected right now — nothing was sent.` }
    }
    if (!finalized.to.length) return { ok: false, reason: 'The draft has no recipient.' }
    const attemptId = `pending_run_${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${finalized.id}`
    const undoSeconds = input.undoSeconds()
    const subject = finalized.subject.trim() || '(no subject)'
    const recipients = finalized.to.map(contact => contact.email).join(', ') || 'a recipient'
    const origin = options.fromRun ? ' from a send run' : ''
    const kind = options.fromRun ? 'mail.run.send' : 'mail.draft.send'
    const notSent = (reason: string): void => {
      input.update(current => settleDraftNotSent(current, finalized.id, attemptId, reason))
      options.onFailed?.(reason, 'not_sent', attemptId)
      input.notice(reason)
      input.record(kind, `Did not send "${subject}" to ${recipients}${origin}: ${reason}`)
    }
    const commit = (): void => {
      const current = input.read().drafts.find(item => item.id === finalized.id)
      if (!current) {
        options.onFailed?.('The draft was removed before sending. Nothing was sent.', 'not_sent', attemptId)
        input.notice('Send cancelled — the draft was removed before sending.')
        return
      }
      // Undo cancels the timer, so an attempt missing here was lost to something else: refuse, and say so.
      if (current.sendAttempt?.id !== attemptId) {
        input.reportFailure(finalized.id, CHANGED_REASON)
        notSent(CHANGED_REASON)
        return
      }
      const refusal = draftReleaseBlock(input.read(), finalized.id)
      if (refusal) {
        notSent(refusal.reason)
        return
      }
      if (draftSendFingerprint(finalizeRunDraftForSend(current)) !== approved) {
        notSent(CHANGED_REASON)
        return
      }
      const now = new Date().toISOString()
      // The finalized text is what is approved, and the store's copy matches it apart from the empty slot.
      const stamp = (store: MailStore): MailStore => ({
        ...store,
        drafts: store.drafts.map(item => (item.id === finalized.id ? { ...item, bodyHtml: finalized.bodyHtml, updatedAt: now, syncState: 'pending' as const } : item)),
      })
      if (!provider) {
        // Local/demo account: the local send is the source of truth, so the
        // appended copy is confirmed by construction — strip the optimistic
        // marker sendDraft stamps on provider-unconfirmed sends.
        const sentMessageId = `msg_sent_${finalized.id}_${now.replace(/[^0-9]/g, '')}`
        input.update(store => {
          const sent = sendDraft(stamp(store), finalized.id, now)
          return {
            ...sent,
            messages: sent.messages.map(message => {
              if (message.id !== sentMessageId) return message
              const { optimistic: _optimistic, ...confirmed } = message
              return confirmed
            }),
          }
        })
        options.onCommitted?.(sentMessageId, attemptId)
        input.record(kind, `Sent "${subject}" to ${recipients}${origin}.`)
        return
      }
      input.update(stamp)
      options.onSubmitting?.(attemptId)
      input.markDraftSending(finalized.id, true)
      void input.deliver(provider, finalized, { id: attemptId, approved })
        .then(message => {
          const sentMessageId = message.gmailMessageId ?? message.id
          options.onCommitted?.(sentMessageId, attemptId)
          input.record(kind, `Sent "${subject}" to ${recipients}${origin} through ${home}.`)
        })
        .catch(error => {
          const reason = error instanceof Error ? error.message : 'Send failed.'
          // The delivery controller has recorded which it was; ask the record, not the error.
          const state = draftDelivery(input.read(), finalized.id).state
          const outcome = state === 'unconfirmed' || (error instanceof MailSendError && error.outcome === 'uncertain') ? 'uncertain' as const : 'not_sent' as const
          // A confirmed Sent copy found meanwhile is the answer: a late failure never replaces it.
          if (state === 'submitted') return
          if (outcome === 'not_sent') input.reportFailure(finalized.id, error)
          options.onFailed?.(reason, outcome, attemptId)
          input.notice(outcome === 'uncertain'
            ? `${home} did not confirm this send. Check Sent before allowing another attempt. (${reason})`
            : `Could not send through ${home} — the draft is still in Drafts. (${reason})`)
          input.record(kind, outcome === 'uncertain'
            ? `Could not confirm "${subject}" to ${recipients}${origin} through ${home}: ${reason}`
            : `Did not send "${subject}" to ${recipients}${origin} through ${home}: ${reason}`)
        })
        .finally(() => input.markDraftSending(finalized.id, false))
    }
    const queued = input.schedule(
      { id: attemptId, target: 'run', draftId: finalized.id, label: options.label ?? 'Message' },
      commit,
      () => {
        input.update(store => holdDraftForSend(store, finalized.id, { id: attemptId, approved, at: new Date().toISOString() }))
        options.onStart?.(attemptId, undoSeconds)
      },
    )
    if (!queued) return { ok: false, reason: 'A send is already waiting. Undo it or let it finish.' }
    return { ok: true, pendingId: attemptId, undoSeconds }
  }
}
