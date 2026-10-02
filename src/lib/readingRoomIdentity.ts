import type { MailMessage } from '../types'
import { readerMailBody } from './mailTextUtils'
import type { MessageAnnotations, MessageIdentity } from './readingRoom'

/** The identity of a message as the reading room keeps it, from the live message or a saved record. */
export function identityOf(message: MailMessage | null, record: MessageAnnotations | undefined, accountId?: string): MessageIdentity | null {
  if (message) {
    return {
      messageId: message.id,
      threadId: message.threadId,
      ...(accountId ? { accountId } : {}),
      subject: message.subject,
      from: { name: message.from.name, email: message.from.email },
      receivedAt: message.receivedAt,
      article: record?.article || readerMailBody(message).visibleText,
    }
  }
  if (!record) return null
  const { notes: _notes, context: _context, replyRequestedAt: _requested, updatedAt: _updated, ...identity } = record
  return identity
}

