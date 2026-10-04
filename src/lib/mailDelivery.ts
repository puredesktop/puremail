import type { Draft, MailMessage, MailProvider, MailStore } from '../types'
import { sendDraft } from './mailModel'

export class MailSendError extends Error {
  constructor(message: string, readonly outcome: 'not_sent' | 'uncertain') { super(message) }
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
  return async (provider: MailProvider, draft: Draft): Promise<MailMessage> => {
    if (sending.has(draft.id)) throw new MailSendError('This message is already being sent.', 'not_sent')
    if (input.read().messages.some(message => message.deliveryAccepted && message.sentDraftId === draft.id)) {
      input.update(store => ({ ...store, drafts: store.drafts.filter(item => item.id !== draft.id) }))
      throw new MailSendError('This draft was already sent. No second copy was sent.', 'not_sent')
    }
    const saved = input.read().drafts.find(item => item.id === draft.id)
    if (!saved) throw new MailSendError('This draft no longer exists. Nothing was sent.', 'not_sent')
    if (saved?.syncState === 'conflict' || saved?.providerConflict) throw new MailSendError('This draft has conflicting edits from another mail app. Resolve them before sending.', 'not_sent')
    if (saved?.sendState === 'uncertain') throw new MailSendError('The previous send was not confirmed. Check Sent before allowing another attempt.', 'uncertain')
    if (!input.online()) throw new MailSendError('Offline — message not sent. Your draft is saved.', 'not_sent')
    sending.add(draft.id)
    let submitted = false
    try {
      const prepared = await input.prepare(draft)
      prepared.sendMessageId = `<puremail-${crypto.randomUUID()}@puremail.local>`
      input.update(store => ({ ...store, drafts: store.drafts.map(item => item.id === draft.id ? {
        ...item, providerDraftId: prepared.providerDraftId, sendMessageId: prepared.sendMessageId, sendState: 'uncertain', sendError: 'Send confirmation pending. Check Sent before retrying.',
      } : item) }))
      // If the process stops after submission, this durable marker blocks an
      // automatic retry instead of quietly turning the message into a draft.
      await input.persist(input.read())
      if (!input.online()) throw new MailSendError('Offline — message not sent. Your draft is saved.', 'not_sent')
      submitted = true
      const message = await provider.send({ draft: prepared, threadId: prepared.threadId })
      if (!message.id) throw new MailSendError('The server returned no send confirmation. Check Sent before retrying.', 'uncertain')
      const accepted = { ...message, deliveryAccepted: true, sentDraftId: draft.id, ...(prepared.providerDraftId ? { sentDraftProviderId: prepared.providerDraftId } : {}), sentDraftProviderIds: [...new Set([prepared.providerDraftId, ...(prepared.staleProviderDraftIds ?? [])].filter((id): id is string => Boolean(id)))] }
      if (prepared.providerSaveWarning && !prepared.providerDraftId) accepted.deliveryWarnings = [...(accepted.deliveryWarnings ?? []), 'The message was accepted, but an earlier draft save was unconfirmed. Check the account Drafts folder for an old copy; do not resend it.']
      input.update(store => sendDraft(store, draft.id, undefined, { sentMessage: accepted, sentMessageId: message.id, sentGmailMessageId: message.gmailMessageId }))
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
      input.update(store => ({ ...store, drafts: store.drafts.map(item => item.id === draft.id ? {
        ...item, sendState: uncertain ? 'uncertain' : 'failed', sendError: reason,
      } : item) }))
      await input.persist(input.read()).catch(() => {})
      throw error
    } finally {
      sending.delete(draft.id)
      input.release(draft.id)
    }
  }
}
