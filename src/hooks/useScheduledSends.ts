import { useEffect, useRef } from 'react'
import type { PendingSendState } from '../components/mailShellHelpers'
import { confirmedSentCopy, draftDelivery } from '../lib/mailDeliveryStatus'
import { sendDraft } from '../lib/mailModel'
import { dueScheduledSends, markScheduledSend } from '../lib/mailScheduledSend'
import { sendFailure } from '../lib/mailSendRelease'
import type { Draft, MailMessage, MailProvider, MailStore } from '../types'

const DISPATCH_INTERVAL_MS = 30_000

/**
 * Carries out one due schedule, if it still may go. An approved send of the
 * draft under way settles the entry later; a draft that has already gone, may
 * have gone or is in conflict settles it now, with no call to the mail service.
 */
export function createScheduledSendDispatcher(input: {
  read: () => MailStore
  update: (updater: (store: MailStore) => MailStore) => void
  provider: () => MailProvider | undefined
  online: () => boolean
  /** No provider is expected: the local account's send is the source of truth. */
  localAccount: () => boolean
  home: () => string
  holdForDraft: (draftId: string) => PendingSendState | undefined
  isDraftSending: (draftId: string) => boolean
  markDraftSending: (draftId: string, sending: boolean) => void
  deliver: (provider: MailProvider, draft: Draft) => Promise<MailMessage>
  reportFailure: (draftId: string, reason: unknown) => void
  notice: (text: string) => void
  record: (kind: string, summary: string) => void
}): (scheduledSendId: string) => void {
  return scheduledSendId => {
    const entry = input.read().scheduledSends?.find(item => item.id === scheduledSendId)
    if (!entry || entry.status !== 'scheduled') return
    const draft = input.read().drafts.find(item => item.id === entry.draftId)
    if (!draft) {
      // Gone because it was sent is not a failure of this entry.
      if (confirmedSentCopy(input.read(), entry.draftId)) {
        input.update(current => markScheduledSend(current, entry.id, 'sent'))
        return
      }
      input.update(current => markScheduledSend(current, entry.id, 'failed', 'Draft no longer exists.'))
      input.notice('A scheduled send failed: its draft no longer exists.')
      return
    }
    // An approved send of this draft is under way: its outcome settles this
    // entry. Starting here would take the send out from under its Undo.
    if (draft.sendAttempt || input.holdForDraft(draft.id) || input.isDraftSending(draft.id)) return
    const delivery = draftDelivery(input.read(), draft.id)
    if (delivery.state === 'submitted') {
      input.update(current => markScheduledSend(current, entry.id, 'sent'))
      return
    }
    if (delivery.state === 'unconfirmed' || delivery.state === 'conflict') {
      input.update(current => markScheduledSend(current, entry.id, delivery.state === 'unconfirmed' ? 'unconfirmed' : 'failed', delivery.reason))
      input.notice(`A scheduled send did not go: ${delivery.reason}`)
      return
    }
    input.update(current => markScheduledSend(current, entry.id, 'sending'))
    const finishLocal = (): void => {
      input.update(current => {
        const sentStore = sendDraft(current, draft.id)
        const sentMailboxId = sentStore.mailboxes.find(mailbox => mailbox.role === 'sent')?.id ?? ''
        return markScheduledSend(
          {
            ...sentStore,
            threads: sentStore.threads.map(thread =>
              thread.id === entry.threadId && sentMailboxId
                ? { ...thread, mailboxId: sentMailboxId }
                : thread,
            ),
          },
          entry.id,
          'sent',
        )
      })
      input.notice(`Scheduled message "${draft.subject}" sent.`)
      input.record('mail.compose.send', `Sent scheduled message "${draft.subject}".`)
    }
    const provider = input.provider()
    if (provider && input.online()) {
      input.markDraftSending(draft.id, true)
      void input.deliver(provider, draft)
        .then(() => finishLocal())
        .catch(error => {
          const failure = sendFailure(input.read(), draft.id, error, input.home(), 'the draft is still in Drafts')
          if (failure.outcome !== 'submitted') input.reportFailure(draft.id, error)
          input.update(current =>
            markScheduledSend(
              current,
              entry.id,
              failure.outcome === 'not_sent' ? 'failed' : failure.outcome === 'uncertain' ? 'unconfirmed' : 'sent',
              failure.reason,
            ),
          )
          if (failure.outcome === 'not_sent') input.notice('A scheduled send failed — the draft is still in Drafts.')
          else if (failure.outcome === 'uncertain') input.notice(`A scheduled send: ${failure.notice}`)
        })
        .finally(() => input.markDraftSending(draft.id, false))
      return
    }
    if (!input.localAccount()) {
      input.reportFailure(draft.id, 'Mail is disconnected — scheduled message not sent.')
      // A real account with no reachable provider must not pretend: the
      // draft stays saved; a failed delivery requires review before retry.
      input.update(current =>
        markScheduledSend(current, entry.id, 'failed', `${input.home()} is not connected; the message was not sent.`),
      )
      input.notice('A scheduled send could not reach the account — the draft is still in Drafts.')
      return
    }
    finishLocal()
  }
}

/**
 * Boot catch-up (sends due while the window was closed dispatch on launch, a
 * renderer-timer limitation) plus a timer while open. `pass` prepares and
 * returns the store to read due entries from.
 */
export function useScheduledSendTimer(pass: () => MailStore, dispatch: (scheduledSendId: string) => void): void {
  const latest = useRef({ pass, dispatch })
  latest.current = { pass, dispatch }
  useEffect(() => {
    const tick = (): void => {
      for (const entry of dueScheduledSends(latest.current.pass())) latest.current.dispatch(entry.id)
    }
    tick()
    const interval = window.setInterval(tick, DISPATCH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])
}
