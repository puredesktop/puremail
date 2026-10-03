import type { MailStore } from '../types'
import type { Draft } from '../types'

/** An append may have landed; retrying it could create another draft. */
export class MailDraftSaveUncertain extends Error {}

/** Content-only baseline for detecting edits made in another mail client. */
export function draftContentRevision(draft: Draft): string {
  const emails = (contacts: Draft['to']) => contacts.map(contact => contact.email.trim().toLowerCase()).sort()
  return JSON.stringify({ subject: draft.subject, body: draft.body.replace(/\r\n/g, '\n'), to: emails(draft.to), cc: emails(draft.cc ?? []), bcc: emails(draft.bcc ?? []), attachments: draft.attachments.map(attachment => [attachment.name, attachment.mimeType]) })
}

/** Send failures belong to the draft, independently of incoming-mail sync. */
export function markDraftSendFailed(store: MailStore, draftId: string, error: unknown): MailStore {
  const reason = error instanceof Error ? error.message : String(error || 'Send failed.')
  return {
    ...store,
    drafts: store.drafts.map(draft => draft.id === draftId ? { ...draft, sendError: reason } : draft),
  }
}
