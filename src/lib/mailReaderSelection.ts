import type { MailStore } from '../types'

/** Follow a composed send when sync replaces its local thread with the provider's. */
export function replacementMailThread(
  previous: MailStore,
  current: MailStore,
  selectedId: string,
  accountId: string,
): string {
  const accountThreads = current.threads.filter(
    thread => thread.accountId === accountId,
  )
  if (accountThreads.some(thread => thread.id === selectedId)) return selectedId
  const previousMessages = previous.messages.filter(
    message => message.threadId === selectedId && !message.isDraft,
  )
  const replacement = current.messages.find(
    message =>
      !message.isDraft &&
      accountThreads.some(thread => thread.id === message.threadId) &&
      previousMessages.some(
        old =>
          old.id === message.id ||
          (old.messageIdHeader &&
            old.messageIdHeader === message.messageIdHeader) ||
          (old.gmailMessageId && old.gmailMessageId === message.gmailMessageId),
      ),
  )
  return replacement?.threadId ?? accountThreads[0]?.id ?? ''
}
