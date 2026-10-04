import type { MailStore } from '../types'
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

/** Keep transport internals in recovery details, not in the mail chrome. */
export function mailErrorToastText(reason: string): string {
  if (/fetchAttachment|No message with uid|attachment.*(download|content)|reattach/i.test(reason))
    return 'An attachment is unavailable. Open the draft and reattach the missing file.'
  if (/authentication|stored.*password|password.*missing|credentials/i.test(reason))
    return 'Mail authentication failed. Check the account credentials in Mail settings.'
  if (/timed? ?out|timeout/i.test(reason))
    return 'Mail connection timed out. Check your connection or mail bridge and try again.'
  return reason.replace(/^Failed:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').slice(0, 240)
}

export function mailConnectionsVerified(result: { receiving: string; sending: string } | null): boolean {
  return !!result && [result.receiving, result.sending].every(value =>
    /verified/i.test(value) && !/failed|not verified|unavailable|timed out|error/i.test(value))
}
