import type {
  FollowUpReminder,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'
import { ownAddresses } from './mailReplyState'

export function scheduleFollowUpReminder(
  store: MailStore,
  input: {
    threadId: string
    accountId: string
    remindAt: string
    note?: string
    cancelOnReply?: boolean
  },
  nowIso = new Date().toISOString(),
): MailStore {
  if (!Number.isFinite(Date.parse(input.remindAt))) return store
  const existing = store.followUpReminders ?? []
  const previous = existing.find(
    item => item.threadId === input.threadId && !item.dismissedAt,
  )
  const record: FollowUpReminder = {
    id: previous?.id ?? `followup_${crypto.randomUUID()}`,
    threadId: input.threadId,
    accountId: input.accountId,
    remindAt: input.remindAt,
    // Always refresh createdAt on reschedule so earlier inbound replies do not
    // immediately auto-cancel the newly scheduled reminder.
    createdAt: nowIso,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    cancelOnReply: input.cancelOnReply ?? true,
    updatedAt: nowIso,
  }
  const rest = existing.filter(
    item =>
      item.id !== record.id &&
      !(item.threadId === input.threadId && !item.dismissedAt),
  )
  return {
    ...store,
    followUpReminders: [...rest, record],
  }
}

export function dismissFollowUpReminder(
  store: MailStore,
  threadId: string,
  nowIso = new Date().toISOString(),
): MailStore {
  const existing = store.followUpReminders ?? []
  let changed = false
  const updated = existing.map(item => {
    if (item.threadId !== threadId || item.dismissedAt) return item
    changed = true
    return { ...item, dismissedAt: nowIso, updatedAt: nowIso }
  })
  return changed ? { ...store, followUpReminders: updated } : store
}

export function clearRepliedFollowUpReminders(
  store: MailStore,
  nowIso = new Date().toISOString(),
): MailStore {
  const existing = store.followUpReminders ?? []
  if (existing.length === 0) return store

  const messagesByThread = new Map<string, MailMessage[]>()
  for (const message of store.messages) {
    if (message.isDraft) continue
    const list = messagesByThread.get(message.threadId)
    if (list) list.push(message)
    else messagesByThread.set(message.threadId, [message])
  }

  const allOwn = ownAddresses({
    email: store.accounts[0]?.email ?? '',
    emails: [
      ...store.accounts.map(a => a.email),
      ...(store.settings.ownerIdentities?.emails ?? []),
    ],
  })

  let changed = false
  const updated = existing.map(reminder => {
    if (reminder.dismissedAt || !reminder.cancelOnReply) return reminder
    const createdMs = Date.parse(reminder.createdAt)
    const threadMessages = messagesByThread.get(reminder.threadId) ?? []
    const hasInboundReply = threadMessages.some(message => {
      const from = message.from.email.trim().toLowerCase()
      if (allOwn.has(from)) return false
      const msgMs = Date.parse(message.receivedAt)
      return Number.isFinite(msgMs) && Number.isFinite(createdMs)
        ? msgMs > createdMs
        : message.receivedAt > reminder.createdAt
    })
    if (!hasInboundReply) return reminder
    changed = true
    return { ...reminder, dismissedAt: nowIso, updatedAt: nowIso }
  })

  return changed ? { ...store, followUpReminders: updated } : store
}

export function dueFollowUpReminders(
  store: MailStore,
  nowMs = Date.now(),
): FollowUpReminder[] {
  return (store.followUpReminders ?? [])
    .filter(reminder => {
      if (reminder.dismissedAt) return false
      const remindMs = Date.parse(reminder.remindAt)
      return Number.isFinite(remindMs) && remindMs <= nowMs
    })
    .sort((a, b) => Date.parse(a.remindAt) - Date.parse(b.remindAt))
}

function capitalizeWord(word: string): string {
  if (!word) return ''
  return word[0]!.toUpperCase() + word.slice(1)
}

export function buildFollowUpNudgeText(
  thread: MailThread,
  lastSentMessage?: MailMessage,
  ownEmail?: string,
): string {
  const excluded = new Set<string>(
    [ownEmail, lastSentMessage?.from.email]
      .filter((email): email is string => Boolean(email))
      .map(email => email.trim().toLowerCase()),
  )
  const recipient =
    lastSentMessage?.to.find(
      c => !excluded.has(c.email.trim().toLowerCase()),
    ) ??
    thread.participants.find(
      c => !excluded.has(c.email.trim().toLowerCase()),
    )
  const rawName = (recipient?.name ?? '').trim()
  const firstName = rawName
    ? rawName.split(/\s+/)[0]!
    : recipient?.email
      ? capitalizeWord(
          recipient.email.split('@')[0]!.split(/[._+-]+/)[0] ?? '',
        ) || 'there'
      : 'there'
  const cleanSubject = thread.subject
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')
    .trim()
  const topic = cleanSubject ? `"${cleanSubject}"` : 'my previous note'
  return `Hi ${firstName},\n\nJust following up on ${topic} in case it slipped down your inbox. Let me know if you need anything else from my end.\n\nBest,`
}
