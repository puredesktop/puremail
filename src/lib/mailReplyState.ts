import type { MailMessage, MailStore, MailThread } from '../types'

/** What reply tracking needs from an account: its address, plus any aliases. */
export interface OwnAddresses {
  email: string
  emails?: string[]
}

/**
 * Reply tracking, derived — nothing stored.
 *
 * "Waiting" used to mean only that the last move on a thread was yours; it
 * never noticed a reply arriving, and it counted notes-to-self and FYIs
 * alongside real asks. This derives the honest state from what the store
 * already holds — each message's sender and time, and the account's own
 * addresses — so it costs no provider work and no migration:
 *
 *   replied   the last message is from someone else, after one of yours
 *   awaiting  the last message is yours, to at least one external address,
 *             and the clock has run `days` working days (overdue past the
 *             threshold)
 *   none      nothing to wait for: an inbound-only thread, a note to
 *             yourself, a message to a no-reply address, or a list message
 *
 * Sending again resets the clock. In a group thread any external reply
 * counts. The threshold lives with the follow-up settings.
 */

export type ReplyState =
  | { kind: 'replied'; at: string; hoursAgo: number }
  | { kind: 'awaiting'; since: string; days: number; overdue: boolean }
  | { kind: 'none' }

export const DEFAULT_REPLY_THRESHOLD_WORKING_DAYS = 3

const NO_REPLY_ADDRESS = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|notifications?|bounce)[@.+-]/i

/** Every address the account answers to, lower-cased. */
export function ownAddresses(account: OwnAddresses | undefined): Set<string> {
  const set = new Set<string>()
  if (!account) return set
  for (const email of [account.email, ...(account.emails ?? [])]) {
    const clean = email?.trim().toLowerCase()
    if (clean) set.add(clean)
  }
  return set
}

function isOwn(email: string | undefined, own: Set<string>): boolean {
  return Boolean(email) && own.has(email!.trim().toLowerCase())
}

/** Mon–Fri between two instants, counting the day the clock started as day 0. */
export function workingDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (!(to > from)) return 0
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  let days = 0
  for (let day = new Date(start.getTime() + 86_400_000); day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const weekday = day.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days += 1
  }
  return days
}

export function replyStateForThread(
  thread: Pick<MailThread, 'id'>,
  messages: readonly MailMessage[],
  account: OwnAddresses | undefined,
  now: string | Date = new Date(),
  thresholdWorkingDays = DEFAULT_REPLY_THRESHOLD_WORKING_DAYS,
): ReplyState {
  const own = ownAddresses(account)
  if (own.size === 0) return { kind: 'none' }
  const nowIso = typeof now === 'string' ? now : now.toISOString()
  const timeline = messages
    .filter(message => message.threadId === thread.id && !message.isDraft)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const last = timeline[timeline.length - 1]
  if (!last) return { kind: 'none' }

  if (!isOwn(last.from.email, own)) {
    // Theirs. It is a reply only if we spoke first on this thread.
    const weSpoke = timeline.some(message => isOwn(message.from.email, own))
    if (!weSpoke) return { kind: 'none' }
    const hoursAgo = Math.max(0, (new Date(nowIso).getTime() - new Date(last.receivedAt).getTime()) / 3_600_000)
    return { kind: 'replied', at: last.receivedAt, hoursAgo }
  }

  // Ours. Is there anyone to wait for?
  const recipients = [...last.to, ...(last.cc ?? []), ...(last.bcc ?? [])]
  const external = recipients.filter(contact => !isOwn(contact.email, own))
  if (external.length === 0) return { kind: 'none' }
  if (external.every(contact => NO_REPLY_ADDRESS.test(contact.email ?? ''))) {
    return { kind: 'none' }
  }
  // A reply to a list message is not an ask of anyone.
  const inboundBefore = [...timeline].reverse().find(message => !isOwn(message.from.email, own))
  if (inboundBefore?.listUnsubscribe) return { kind: 'none' }

  const days = workingDaysBetween(last.receivedAt, nowIso)
  return { kind: 'awaiting', since: last.receivedAt, days, overdue: days >= thresholdWorkingDays }
}

/** Convenience over a whole store: the account is the thread's own. */
export function replyStateInStore(
  store: MailStore,
  thread: MailThread,
  now: string | Date = new Date(),
): ReplyState {
  const account = store.accounts.find(entry => entry.id === thread.accountId)
  const threshold =
    store.settings?.followUp?.replyThresholdWorkingDays ??
    DEFAULT_REPLY_THRESHOLD_WORKING_DAYS
  return replyStateForThread(thread, store.messages, account, now, threshold)
}

/** How long a fresh "replied" stays worth showing in Sent. */
export const REPLIED_CHIP_HOURS = 24

export function replyStateChip(
  state: ReplyState,
): { label: string; tone: 'waiting' | 'overdue' | 'replied' } | null {
  if (state.kind === 'awaiting') {
    const label = state.days === 0 ? 'no reply · today' : `no reply · ${state.days}d`
    return { label, tone: state.overdue ? 'overdue' : 'waiting' }
  }
  if (state.kind === 'replied' && state.hoursAgo < REPLIED_CHIP_HOURS) {
    const hours = Math.floor(state.hoursAgo)
    return { label: hours < 1 ? 'replied just now' : `replied ${hours}h`, tone: 'replied' }
  }
  return null
}
