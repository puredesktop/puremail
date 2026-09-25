import type { Draft, MailMessage } from '../types'

/**
 * The view-model behind the thread-history pill, its popover, and the thread
 * view. Messages and drafts collapse into one timeline of entries, newest
 * first, so the three surfaces cannot disagree about what the thread holds.
 *
 * Pure so the ordering, grouping and pagination arithmetic is testable
 * without a browser; the DOM wiring stays in the components.
 */

export type ThreadHistoryFilter = 'all' | 'sent' | 'received' | 'drafts'
export type ThreadHistoryState = 'sent' | 'received' | 'draft'

export interface ThreadHistoryEntry {
  id: string
  kind: 'message' | 'draft'
  state: ThreadHistoryState
  /** ISO timestamp the entry sorts and groups by. */
  at: string
  sender: string
  snippet: string
}

export interface ThreadHistoryCounts {
  all: number
  sent: number
  received: number
  drafts: number
}

function snippetOf(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 140)
}

export function buildThreadHistoryEntries(
  messages: MailMessage[],
  drafts: Draft[],
  accountEmail: string | undefined,
  accountName?: string,
): ThreadHistoryEntry[] {
  const email = accountEmail?.trim().toLowerCase()
  const entries: ThreadHistoryEntry[] = []
  for (const message of messages) {
    const outgoing = Boolean(
      email && message.from.email.toLowerCase() === email,
    )
    entries.push({
      id: message.id,
      // A draft the provider hands back is still an unsent draft, however it
      // reached us. Reading "from me" as "sent" is what let a reply drafted
      // by another client sit in the timeline claiming it had gone out.
      kind: message.isDraft ? 'draft' : 'message',
      state: message.isDraft ? 'draft' : outgoing ? 'sent' : 'received',
      at: message.receivedAt,
      sender: message.from.name || message.from.email,
      snippet: snippetOf(message.body),
    })
  }
  for (const draft of drafts) {
    entries.push({
      id: draft.id,
      kind: 'draft',
      // A sent draft is outgoing mail whoever it went to; only an unsent one
      // is a draft in the timeline's sense.
      state: draft.sentAt ? 'sent' : 'draft',
      at: draft.sentAt ?? draft.updatedAt,
      sender: accountName || 'You',
      snippet: snippetOf(draft.body),
    })
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at))
}

export function threadHistoryCounts(
  entries: ThreadHistoryEntry[],
): ThreadHistoryCounts {
  const counts = { all: entries.length, sent: 0, received: 0, drafts: 0 }
  for (const entry of entries) {
    if (entry.state === 'sent') counts.sent += 1
    else if (entry.state === 'received') counts.received += 1
    else counts.drafts += 1
  }
  return counts
}

export function filterThreadHistory(
  entries: ThreadHistoryEntry[],
  filter: ThreadHistoryFilter,
): ThreadHistoryEntry[] {
  if (filter === 'all') return entries
  const state: ThreadHistoryState =
    filter === 'sent' ? 'sent' : filter === 'received' ? 'received' : 'draft'
  return entries.filter(entry => entry.state === state)
}

/**
 * First `limit` entries, with the open message forced into view: pinned to
 * the front when it would otherwise be past the fold. The popover leans on
 * this — "the current message is always in the list" is its one promise.
 */
export function visibleThreadHistory(
  entries: ThreadHistoryEntry[],
  currentId: string | null,
  limit: number,
): ThreadHistoryEntry[] {
  const shown = entries.slice(0, Math.max(0, limit))
  if (!currentId) return shown
  if (shown.some(entry => entry.id === currentId)) return shown
  const current = entries.find(entry => entry.id === currentId)
  return current ? [current, ...shown] : shown
}

export interface ThreadHistoryMonthGroup {
  label: string
  entries: ThreadHistoryEntry[]
}

/**
 * Consecutive-month grouping for an already-sorted list. The year is spelled
 * out only when it is not the current one — "AUGUST" this year, "JULY 2025"
 * beyond it — unless `alwaysYear` (the thread view spells it out always).
 */
export function groupThreadHistoryByMonth(
  entries: ThreadHistoryEntry[],
  options?: { alwaysYear?: boolean; now?: Date },
): ThreadHistoryMonthGroup[] {
  const now = options?.now ?? new Date()
  const groups: ThreadHistoryMonthGroup[] = []
  for (const entry of entries) {
    const date = new Date(entry.at)
    const month = date
      .toLocaleDateString(undefined, { month: 'long' })
      .toUpperCase()
    const label =
      options?.alwaysYear || date.getFullYear() !== now.getFullYear()
        ? `${month} ${date.getFullYear()}`
        : month
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}

/** `Jul 2025 – Aug 2026` for the thread view's meta line. */
export function threadHistorySpan(entries: ThreadHistoryEntry[]): string {
  if (entries.length === 0) return ''
  const label = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    })
  const newest = label(entries[0].at)
  const oldest = label(entries[entries.length - 1].at)
  return newest === oldest ? newest : `${oldest} – ${newest}`
}

/**
 * A machine-generated notice restating what the invite card already shows.
 * These must never render as body prose — they are the invite's status.
 */
export function isInviteNoticeBody(body: string): boolean {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return true
  return /has (?:accepted|declined|tentatively accepted) the invitation/i.test(
    text,
  )
}
