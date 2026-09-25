import type {
  MailNotificationPreferences,
  MailStore,
  MailThread,
} from '../types'

/**
 * Phase M4 desktop notifications: pure gating logic here; the shell owns
 * the web Notification API calls (permission handled lazily, silent
 * degradation when denied — correct for an iframe app since the platform
 * bridge exposes no notification surface).
 */
export function notificationsMuted(
  preferences: MailNotificationPreferences,
  now = new Date().toISOString(),
): boolean {
  return Boolean(preferences.mutedUntil && preferences.mutedUntil > now)
}

/**
 * Should a new message on this thread notify? Honors the global enable,
 * mute window, per-account scope overrides, and the important/all scope
 * against the thread's inbox category. Only inbox-mailbox threads notify.
 */
export function shouldNotifyForThread(
  preferences: MailNotificationPreferences,
  store: MailStore,
  thread: MailThread,
  now = new Date().toISOString(),
): boolean {
  if (!preferences.enabled) return false
  if (notificationsMuted(preferences, now)) return false
  const mailboxRole = store.mailboxes.find(
    mailbox => mailbox.id === thread.mailboxId,
  )?.role
  if (mailboxRole !== 'inbox') return false
  const scope =
    preferences.perAccount?.[thread.accountId] ?? preferences.scope
  if (scope === 'none') return false
  if (scope === 'all') return true
  // Gmail's own IMPORTANT label arrives as priority 'high'; that is the
  // real importance signal now that PureMail has no lane of its own.
  return thread.priority === 'high'
}

/** Should a snooze wake notify? Gated separately from new-mail scope. */
export function shouldNotifyForSnoozeReturn(
  preferences: MailNotificationPreferences,
  now = new Date().toISOString(),
): boolean {
  if (!preferences.enabled) return false
  if (notificationsMuted(preferences, now)) return false
  return preferences.notifyOnSnoozeReturn ?? true
}

/**
 * New unread inbox threads between two stores (a fetch merge), for the
 * new-mail notification pass.
 */
export function newlyArrivedThreads(
  before: MailStore,
  after: MailStore,
): MailThread[] {
  const knownMessageIds = new Set(before.messages.map(message => message.id))
  const threadsWithNewMail = new Set(
    after.messages
      .filter(message => !knownMessageIds.has(message.id) && !message.read)
      .map(message => message.threadId),
  )
  return after.threads.filter(thread => threadsWithNewMail.has(thread.id))
}
