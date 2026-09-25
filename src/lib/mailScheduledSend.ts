import type { MailStore, ScheduledSend, ScheduledSendStatus } from '../types'

/**
 * Phase M4 send-later: scheduled sends persist in the M0 store field and
 * are dispatched by the in-app scheduler (boot catch-up + timer). The
 * scheduler runs in the renderer: sends due while the window is closed
 * dispatch on next launch — the plan's flagged limitation; a main-process
 * scheduler would be a shell change outside this app's scope.
 */
export function scheduleSend(
  store: MailStore,
  input: { draftId: string; threadId: string; sendAt: string },
  now = new Date().toISOString(),
): MailStore {
  const entry: ScheduledSend = {
    id: `scheduled_${input.draftId}_${now.replace(/[^0-9]/g, '')}`,
    draftId: input.draftId,
    threadId: input.threadId,
    sendAt: input.sendAt,
    createdAt: now,
    status: 'scheduled',
  }
  return {
    ...store,
    scheduledSends: [...(store.scheduledSends ?? []), entry],
  }
}

export function cancelScheduledSend(
  store: MailStore,
  scheduledSendId: string,
): MailStore {
  return {
    ...store,
    scheduledSends: (store.scheduledSends ?? []).map(entry =>
      entry.id === scheduledSendId && entry.status === 'scheduled'
        ? { ...entry, status: 'cancelled' as const }
        : entry,
    ),
  }
}

/** Active (not yet dispatched/cancelled) schedules, oldest due first. */
export function activeScheduledSends(store: MailStore): ScheduledSend[] {
  return (store.scheduledSends ?? [])
    .filter(entry => entry.status === 'scheduled')
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
}

/** Schedules due at `now` (boot catch-up includes everything overdue). */
export function dueScheduledSends(
  store: MailStore,
  now = new Date().toISOString(),
): ScheduledSend[] {
  return activeScheduledSends(store).filter(entry => entry.sendAt <= now)
}

export function markScheduledSend(
  store: MailStore,
  scheduledSendId: string,
  status: ScheduledSendStatus,
  lastError?: string,
): MailStore {
  return {
    ...store,
    scheduledSends: (store.scheduledSends ?? []).map(entry =>
      entry.id === scheduledSendId
        ? { ...entry, status, ...(lastError ? { lastError } : {}) }
        : entry,
    ),
  }
}
