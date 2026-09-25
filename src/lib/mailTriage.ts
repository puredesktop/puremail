import type {
  MailStore,
  MailThreadSnooze,
  QueuedMailActionType,
} from '../types'
import {
  archiveThread,
  deleteThread,
  labelThread,
  markThreadRead,
  moveThread,
  snoozeThread,
  unarchiveThread,
} from './mailModel'

/**
 * Phase M1 triage mutations: star state and multi-thread bulk actions.
 * Bulk helpers fold the existing single-thread store transitions so bulk
 * and single-thread behavior can never drift apart. All of them return a
 * new store and leave unknown thread ids untouched.
 */

export function setThreadStarred(
  store: MailStore,
  threadId: string,
  starred: boolean,
): MailStore {
  const current = store.starredThreadIds ?? []
  if (starred === current.includes(threadId)) return store
  return {
    ...store,
    starredThreadIds: starred
      ? [...current, threadId]
      : current.filter(id => id !== threadId),
  }
}

function fold(
  store: MailStore,
  threadIds: string[],
  apply: (current: MailStore, threadId: string) => MailStore,
): MailStore {
  return threadIds.reduce((current, threadId) => apply(current, threadId), store)
}

export function bulkArchiveThreads(
  store: MailStore,
  threadIds: string[],
): MailStore {
  return fold(store, threadIds, archiveThread)
}

export function bulkTrashThreads(
  store: MailStore,
  threadIds: string[],
): MailStore {
  return fold(store, threadIds, (current, threadId) =>
    deleteThread(current, threadId),
  )
}

export function bulkMarkThreadsRead(
  store: MailStore,
  threadIds: string[],
  read: boolean,
): MailStore {
  return fold(store, threadIds, (current, threadId) =>
    markThreadRead(current, threadId, read),
  )
}

export function bulkLabelThreads(
  store: MailStore,
  threadIds: string[],
  labelId: string,
): MailStore {
  return fold(store, threadIds, (current, threadId) =>
    labelThread(current, threadId, labelId),
  )
}

export function bulkMoveThreads(
  store: MailStore,
  threadIds: string[],
  mailboxId: string,
): MailStore {
  return fold(store, threadIds, (current, threadId) =>
    moveThread(current, threadId, mailboxId),
  )
}

export function bulkSnoozeThreads(
  store: MailStore,
  threadIds: string[],
  snoozedUntil: string,
  now = new Date().toISOString(),
): MailStore {
  const withThreads = fold(store, threadIds, (current, threadId) =>
    snoozeThread(current, threadId, snoozedUntil),
  )
  const snoozed = new Set(threadIds)
  const kept = (store.snoozes ?? []).filter(
    entry => !snoozed.has(entry.threadId),
  )
  const added: MailThreadSnooze[] = threadIds
    .map((threadId): MailThreadSnooze | null => {
      const thread = store.threads.find(item => item.id === threadId)
      if (!thread) return null
      return {
        threadId,
        snoozedUntil,
        snoozedAt: now,
        returnMailboxId: thread.mailboxId,
        reason: 'manual',
      }
    })
    .filter((entry): entry is MailThreadSnooze => entry !== null)
  return { ...withThreads, snoozes: [...kept, ...added] }
}

/**
 * One vocabulary for every multi-select triage action so the rail UI, the
 * shell dispatcher, and tests can never disagree about what an action is.
 */
export type BulkTriageAction =
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'read'; read: boolean }
  | { type: 'label'; labelId: string }
  | { type: 'move'; mailboxId: string }
  | { type: 'snooze'; snoozedUntil: string }
  | { type: 'star'; starred: boolean }

export function applyBulkTriageAction(
  store: MailStore,
  threadIds: string[],
  action: BulkTriageAction,
  now = new Date().toISOString(),
): MailStore {
  switch (action.type) {
    case 'archive':
      return bulkArchiveThreads(store, threadIds)
    case 'trash':
      return bulkTrashThreads(store, threadIds)
    case 'read':
      return bulkMarkThreadsRead(store, threadIds, action.read)
    case 'label':
      return bulkLabelThreads(store, threadIds, action.labelId)
    case 'move': {
      // A move must survive the next provider sync: box and archive targets
      // archive INTO the target (status + return bookkeeping), an inbox
      // target restores. Plain moveThread state is what a fetch merge
      // silently reverts.
      const target = store.mailboxes.find(
        mailbox => mailbox.id === action.mailboxId,
      )
      if (target?.role === 'custom' || target?.role === 'archive') {
        return fold(store, threadIds, (current, threadId) => {
          const thread = current.threads.find(item => item.id === threadId)
          if (!thread) return current
          if (thread.status === 'archived') {
            return moveThread(current, threadId, action.mailboxId)
          }
          return archiveThread(current, threadId, action.mailboxId)
        })
      }
      if (target?.role === 'inbox') {
        return fold(store, threadIds, (current, threadId) =>
          unarchiveThread(current, threadId),
        )
      }
      return bulkMoveThreads(store, threadIds, action.mailboxId)
    }
    case 'snooze':
      return bulkSnoozeThreads(store, threadIds, action.snoozedUntil, now)
    case 'star':
      // The same per-thread star path the UI's star toggle uses.
      return fold(store, threadIds, (current, threadId) =>
        setThreadStarred(current, threadId, action.starred),
      )
  }
}

/**
 * Provider-side encoding of a bulk action, for providers that implement
 * `bulkModifyThreads` behind the `bulkActions` capability flag.
 */
export function queuedActionForBulkTriage(action: BulkTriageAction): {
  type: QueuedMailActionType
  payload?: Record<string, unknown>
} {
  switch (action.type) {
    case 'archive':
      return { type: 'archive' }
    case 'trash':
      return { type: 'trash' }
    case 'read':
      return { type: action.read ? 'markRead' : 'markUnread' }
    case 'label':
      return { type: 'label', payload: { labelId: action.labelId } }
    case 'move':
      return { type: 'move', payload: { mailboxId: action.mailboxId } }
    case 'snooze':
      return { type: 'snooze', payload: { snoozedUntil: action.snoozedUntil } }
    case 'star':
      return { type: action.starred ? 'star' : 'unstar' }
  }
}

/** Human summary for notices and the operations ledger. */
export function bulkTriageActionSummary(
  action: BulkTriageAction,
  count: number,
): string {
  const threads = `${count} thread${count === 1 ? '' : 's'}`
  switch (action.type) {
    case 'archive':
      return `Archived ${threads}.`
    case 'trash':
      return `Moved ${threads} to Trash.`
    case 'read':
      return action.read
        ? `Marked ${threads} read.`
        : `Marked ${threads} unread.`
    case 'label':
      return `Labeled ${threads}.`
    case 'move':
      return `Moved ${threads}.`
    case 'snooze':
      return `Snoozed ${threads}.`
    case 'star':
      return action.starred
        ? `Starred ${threads}.`
        : `Unstarred ${threads}.`
  }
}
