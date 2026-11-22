import { replyStateInStore } from './mailReplyState'
import type { FollowUpReminder, MailStore, MailThread } from '../types'

/**
 * The views the thread list switches between.
 *
 * Unread is a property of messages, not threads — a thread is unread when any
 * of its messages is — so every count is derived from the same store the list
 * renders, and a chip cannot claim a number the list then contradicts.
 */
export type MailListFilterId =
  | 'all'
  | 'unread'
  | 'priority'
  | 'followups'
  | 'vip'
  | 'attachments'

interface ListFilterStoreIndex {
  unread: Set<string>
  withAttachments: Set<string>
  vipThreadIds: Set<string>
  activeRemindersByThread: Map<string, FollowUpReminder[]>
}

const listFilterIndexCache = new WeakMap<MailStore, ListFilterStoreIndex>()

function indexForStore(store: MailStore): ListFilterStoreIndex {
  const cached = listFilterIndexCache.get(store)
  if (cached) return cached

  const unread = new Set<string>()
  const withAttachments = new Set<string>()
  const vips = new Set(
    (store.vipSenders ?? []).map(email => email.trim().toLowerCase()).filter(Boolean),
  )
  const vipThreadIds = new Set<string>()

  for (const message of store.messages) {
    if (!message.read) unread.add(message.threadId)
    if ((message.attachments?.length ?? 0) > 0) {
      withAttachments.add(message.threadId)
    }
    if (
      vips.size > 0 &&
      vips.has(message.from.email.trim().toLowerCase())
    ) {
      vipThreadIds.add(message.threadId)
    }
  }

  if (vips.size > 0) {
    for (const thread of store.threads) {
      if (
        thread.participants.some(p =>
          vips.has(p.email.trim().toLowerCase()),
        )
      ) {
        vipThreadIds.add(thread.id)
      }
    }
  }

  const activeRemindersByThread = new Map<string, FollowUpReminder[]>()
  for (const reminder of store.followUpReminders ?? []) {
    if (reminder.dismissedAt) continue
    const list = activeRemindersByThread.get(reminder.threadId)
    if (list) list.push(reminder)
    else activeRemindersByThread.set(reminder.threadId, [reminder])
  }

  const built: ListFilterStoreIndex = {
    unread,
    withAttachments,
    vipThreadIds,
    activeRemindersByThread,
  }
  listFilterIndexCache.set(store, built)
  return built
}

export function unreadThreadIds(store: MailStore): Set<string> {
  return indexForStore(store).unread
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
    // Aligned with `mailQuery` `is:overdue` (badge) and `is:awaiting` (list):
    // includes both reply-tracking waits and explicit follow-up reminders.
    count: (store, accountId) => {
      const idx = indexForStore(store)
      const nowMs = Date.now()
      return forAccount(store, accountId).filter(thread => {
        const reminders = idx.activeRemindersByThread.get(thread.id) ?? []
        if (reminders.some(r => Date.parse(r.remindAt) <= nowMs)) return true
        const state = replyStateInStore(store, thread)
        return state.kind === 'awaiting' && state.overdue
      }).length
    },
    matches: (thread, _unread, store) => {
      const idx = indexForStore(store)
      if ((idx.activeRemindersByThread.get(thread.id)?.length ?? 0) > 0) {
        return true
      }
      return replyStateInStore(store, thread).kind === 'awaiting'
    },
  },
  {
    id: 'vip',
    label: 'VIP',
    count: (store, accountId) => {
      const idx = indexForStore(store)
      if (idx.vipThreadIds.size === 0) return 0
      return forAccount(store, accountId).filter(thread =>
        idx.vipThreadIds.has(thread.id),
      ).length
    },
    matches: (thread, _unread, store) =>
      indexForStore(store).vipThreadIds.has(thread.id),
  },
  {
    id: 'attachments',
    label: 'Attachments',
    count: (store, accountId) => {
      const idx = indexForStore(store)
      return forAccount(store, accountId).filter(thread =>
        idx.withAttachments.has(thread.id),
      ).length
    },
    matches: (thread, _unread, store) =>
      indexForStore(store).withAttachments.has(thread.id),
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
  const idx = indexForStore(store)
  const since = new Map(
    kept.map(thread => {
      const state = replyStateInStore(store, thread)
      if (state.kind === 'awaiting') return [thread.id, state.since]
      const earliestReminder = idx.activeRemindersByThread
        .get(thread.id)
        ?.map(r => r.remindAt)
        .sort()[0]
      return [thread.id, earliestReminder ?? '']
    }),
  )
  return [...kept].sort((a, b) =>
    (since.get(a.id) ?? '').localeCompare(since.get(b.id) ?? ''),
  )
}
