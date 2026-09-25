import { replyStateInStore } from './mailReplyState'
import type { MailStore, MailThread } from '../types'

/**
 * The four views the thread list switches between.
 *
 * Unread is a property of messages, not threads — a thread is unread when any
 * of its messages is — so every count is derived from the same store the list
 * renders, and a chip cannot claim a number the list then contradicts.
 */
export type MailListFilterId = 'all' | 'unread' | 'priority' | 'followups'

export function unreadThreadIds(store: MailStore): Set<string> {
  const unread = new Set<string>()
  for (const message of store.messages) {
    if (!message.read) unread.add(message.threadId)
  }
  return unread
}

function forAccount(store: MailStore, accountId: string): MailThread[] {
  return store.threads.filter(
    thread => !accountId || thread.accountId === accountId,
  )
}

export interface MailListFilter {
  id: MailListFilterId
  label: string
  count: (store: MailStore, accountId: string) => number
  matches: (thread: MailThread, unread: Set<string>, store: MailStore) => boolean
}

export const MAIL_LIST_FILTERS: MailListFilter[] = [
  {
    id: 'all',
    label: 'All',
    // A state, not a tally; a number here would be noise.
    count: () => 0,
    matches: () => true,
  },
  {
    id: 'unread',
    label: 'Unread',
    count: (store, accountId) => {
      const unread = unreadThreadIds(store)
      return forAccount(store, accountId).filter(thread =>
        unread.has(thread.id),
      ).length
    },
    matches: (thread, unread) => unread.has(thread.id),
  },
  {
    id: 'priority',
    label: 'Priority',
    count: (store, accountId) =>
      forAccount(store, accountId).filter(thread => thread.priority === 'high')
        .length,
    matches: thread => thread.priority === 'high',
  },
  {
    id: 'followups',
    label: 'Follow-ups',
    // A follow-up is a thread where the last word was yours, to someone
    // else, and they have not come back. The badge counts the OVERDUE ones
    // (past the threshold in follow-up settings); the list shows every one
    // still awaiting, longest wait first. Snoozed threads are due back
    // rather than waiting on someone, so they are neither.
    count: (store, accountId) =>
      forAccount(store, accountId).filter(thread => {
        const state = replyStateInStore(store, thread)
        return state.kind === 'awaiting' && state.overdue
      }).length,
    matches: (thread, _unread, store) =>
      replyStateInStore(store, thread).kind === 'awaiting',
  },
]

export function filterThreadsByListFilter(
  threads: MailThread[],
  id: MailListFilterId,
  unread: Set<string>,
  store: MailStore,
): MailThread[] {
  if (id === 'all') return threads
  const filter = MAIL_LIST_FILTERS.find(entry => entry.id === id)
  if (!filter) return threads
  const kept = threads.filter(thread => filter.matches(thread, unread, store))
  if (id !== 'followups') return kept
  // Longest wait first: the one you most need to chase is at the top.
  const since = new Map(
    kept.map(thread => {
      const state = replyStateInStore(store, thread)
      return [thread.id, state.kind === 'awaiting' ? state.since : '']
    }),
  )
  return [...kept].sort((a, b) =>
    (since.get(a.id) ?? '').localeCompare(since.get(b.id) ?? ''),
  )
}
