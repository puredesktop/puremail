import type { MailStore } from '../types'

/**
 * Phase M4: snooze as a real mailbox state. Snoozing hides a thread until
 * a time ("hide until"); it is deliberately distinct from follow-ups,
 * which chase a reply. Waking restores the thread to the mailbox it left
 * and marks it visibly as returned.
 */
export interface SnoozeWakeResult {
  store: MailStore
  /** Threads that woke this pass, for notices and notifications. */
  wokenThreadIds: string[]
}

/**
 * Wake every snooze that is due at `now`. Runs on boot (catch-up for
 * wakes missed while the app was closed) and on a timer while open.
 * Idempotent: waking removes the snooze record, so a second pass is a
 * no-op.
 */
export function wakeDueSnoozes(
  store: MailStore,
  now = new Date().toISOString(),
): SnoozeWakeResult {
  const due = (store.snoozes ?? []).filter(
    entry => entry.snoozedUntil <= now,
  )
  if (due.length === 0) return { store, wokenThreadIds: [] }
  const dueByThread = new Map(due.map(entry => [entry.threadId, entry]))
  const inboxRoleMailboxes = new Set(
    store.mailboxes
      .filter(mailbox => mailbox.role === 'inbox')
      .map(mailbox => mailbox.id),
  )
  const wokenThreadIds: string[] = []
  const threads = store.threads.map(thread => {
    const entry = dueByThread.get(thread.id)
    if (!entry || thread.status !== 'snoozed') return thread
    wokenThreadIds.push(thread.id)
    const returnMailboxId = entry.returnMailboxId ?? thread.mailboxId
    const { snoozedUntil: _snoozedUntil, ...rest } = thread
    return {
      ...rest,
      mailboxId: returnMailboxId,
      status: inboxRoleMailboxes.has(returnMailboxId)
        ? ('inbox' as const)
        : ('waiting' as const),
      snoozeReturnedAt: now,
      syncState: 'pending' as const,
    }
  })
  return {
    store: {
      ...store,
      threads,
      snoozes: (store.snoozes ?? []).filter(
        entry => !dueByThread.has(entry.threadId),
      ),
    },
    wokenThreadIds,
  }
}

/** Clear the "returned from snooze" marker (the user has seen the thread). */
export function clearSnoozeReturnMarker(
  store: MailStore,
  threadId: string,
): MailStore {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread?.snoozeReturnedAt) return store
  return {
    ...store,
    threads: store.threads.map(item => {
      if (item.id !== threadId) return item
      const { snoozeReturnedAt: _snoozeReturnedAt, ...rest } = item
      return rest
    }),
  }
}
