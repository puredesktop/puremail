import type { MailContact, MailStore } from '../types'

const clean = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

export interface LatestFrom {
  threadId: string
  messageId: string
  subject: string
  /** How the sender writes their name, or their address when there is no name. */
  who: string
  /** Other people the words also fit, so the answer can say which one it chose. */
  alsoMatched: string[]
}

const nameOf = (contact: MailContact): string => contact.name?.trim() || contact.email

/**
 * The latest thread in which someone matching these words wrote to the person: their name or their address, every word
 * of it. Mail the person sent, drafts and the Trash do not count. Null when nobody matches.
 */
export function latestThreadFrom(store: Pick<MailStore, 'accounts' | 'threads' | 'messages' | 'mailboxes' | 'settings'>, words: string): LatestFrom | null {
  const wanted = clean(words).split(' ').filter(Boolean)
  if (!wanted.length) return null
  const own = new Set([...store.accounts.map(account => account.email), ...(store.settings?.ownerIdentities?.emails ?? [])].map(clean))
  const trash = new Set(store.mailboxes.filter(mailbox => mailbox.role === 'trash').map(mailbox => mailbox.id))
  const threads = new Map(store.threads.map(thread => [thread.id, thread]))
  const found = store.messages
    .filter(message => {
      if (message.isDraft || !message.from?.email || own.has(clean(message.from.email))) return false
      const thread = threads.get(message.threadId)
      if (!thread || trash.has(thread.mailboxId)) return false
      const sender = clean(`${message.from.name ?? ''} ${message.from.email}`)
      return wanted.every(word => sender.includes(word))
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const latest = found[0]
  if (!latest) return null
  const people = new Map<string, string>()
  for (const message of found) if (message.from && !people.has(clean(message.from.email))) people.set(clean(message.from.email), nameOf(message.from))
  return {
    threadId: latest.threadId,
    messageId: latest.id,
    subject: threads.get(latest.threadId)?.subject ?? '',
    who: nameOf(latest.from),
    alsoMatched: [...people.entries()].filter(([email]) => email !== clean(latest.from.email)).map(([, name]) => name).slice(0, 2),
  }
}
