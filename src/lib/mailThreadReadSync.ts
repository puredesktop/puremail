import { markThreadRead } from './mailModel'
import type { MailStore } from '../types'

/** A read acknowledgement owns only the immutable snapshot this operation made. */
export function beginThreadReadSync(store: MailStore, threadId: string, read: boolean) {
  const previousThread = store.threads.find(thread => thread.id === threadId)
  const pending = markThreadRead(store, threadId, read)
  const pendingThread = pending.threads.find(thread => thread.id === threadId)
  const pendingMessages = pending.messages.filter(message => message.threadId === threadId)
  return {
    store: pending,
    acknowledge(current: MailStore): MailStore {
      // Prior failed/pending work belongs to another mutation. A later archive,
      // unread action, account switch or history refresh must keep its own state.
      if (previousThread?.syncState !== 'synced' || !pendingThread ||
          current.threads.find(thread => thread.id === threadId) !== pendingThread) return current
      const messages = current.messages.filter(message => message.threadId === threadId)
      if (messages.length !== pendingMessages.length || messages.some((message, index) => message !== pendingMessages[index])) return current
      return { ...current, threads: current.threads.map(thread => thread === pendingThread ? { ...thread, syncState: 'synced' } : thread) }
    },
  }
}
