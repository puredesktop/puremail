import type {
  MailAiTriageRecord,
  MailAiTriageVerdict,
  MailContact,
  MailStore,
  MailThread,
  OwnerIdentityRegistry,
} from '../types'
import {
  AI_TRIAGE_LABELS,
  AI_TRIAGE_VERDICTS,
  aiTriageCurrent,
  aiTriageRecordFor,
  isAiTriageVerdict,
  isDeliveredMessage,
  latestDeliveredMessage,
} from './aiTriageState'
import { isOwnerContact, ownerIdentityRegistryForStore } from './mailModel'
import { resolveThreadQuery } from './mailQuery'
import { cleanMailMessageText } from './mailTextUtils'

/**
 * AI triage, the app's half. The assistant judges every thread; the app
 * makes each judgment cheap and keeps it.
 *
 * - The feed hands over untriaged threads a batch at a time: the latest
 *   message cleaned of quoted history and signatures, plus facts the app
 *   knows for certain. No keyword guesses — every verdict is the model's.
 * - A batch is packed to stay under the shell's limit for one tool result
 *   (4,000 characters). Past it, a result is parked in a file the model
 *   reads back a chunk per turn, and those turns are what made triage slow.
 * - Decisions are recorded against the latest message the model saw. A new
 *   message reopens the thread, and a decision about a message that has
 *   since been superseded is refused as stale rather than recorded blind.
 * - The report reads recorded decisions, so nothing is read twice.
 */

/** Characters one feed or report result may use: under the shell's 4,000. */
export const AI_TRIAGE_RESULT_BUDGET = 3700
/** The longest excerpt of one message a batch carries. */
export const AI_TRIAGE_TEXT_CAP = 900
/** Threads one batch returns at most, however short they are. */
export const AI_TRIAGE_MAX_BATCH = 12
/** Decisions kept, newest first. */
export const AI_TRIAGE_KEEP = 3000

const DEFAULT_SCOPE = 'in:inbox newer_than:1d'

export interface AiTriageRow {
  id: string
  /** When the latest message arrived. recordTriage takes it back. */
  at: string
  subject: string
  from: string
  /** Who sent the latest message. */
  last: 'them' | 'you'
  messages: number
  text: string
  /** The excerpt was shortened. */
  cut?: true
  unread?: true
  /** The user is only on Cc. */
  cc?: true
  draft?: true
  files?: string[]
  invite?: string
  /** The sender marks it as bulk mail (a List-Unsubscribe header). */
  bulk?: true
  /** What was decided before a new message reopened the thread. */
  before?: string
  sender?: { replied?: number; marked?: MailAiTriageVerdict }
}

export interface AiTriageFeed {
  scope: string
  returned: number
  remaining: number
  threads: AiTriageRow[]
  note: string
}

export interface AiTriageDecision {
  id: string
  at?: string
  verdict: string
  reason?: string
  action?: string
}

export interface AiTriageApplied {
  store: MailStore
  recorded: Array<{ id: string; subject: string; verdict: MailAiTriageVerdict }>
  stale: Array<{ id: string; subject: string }>
  unknown: string[]
  invalid: Array<{ id: string; problem: string }>
}

export interface AiTriageReportRow {
  id: string
  verdict: MailAiTriageVerdict
  subject: string
  from: string
  reason: string
  action?: string
  /** When it was decided. */
  at: string
  /** The user set it themselves. */
  by?: 'you'
  /** The user has replied since. */
  done?: true
  /** A new message came in; the thread is back in the triage queue. */
  reopened?: true
}

export interface AiTriageReport {
  since: string
  counts: Record<MailAiTriageVerdict, number>
  total: number
  items: AiTriageReportRow[]
  nextOffset?: number
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max
    ? { text: `${text.slice(0, max - 1)}…`, cut: true }
    : { text, cut: false }
}

function contactLine(contact: MailContact): string {
  const name = flat(contact.name ?? '')
  const email = contact.email ?? ''
  return name && name.toLowerCase() !== email.toLowerCase()
    ? `${name} <${email}>`
    : email || name
}

function emailKey(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Threads in the scope with no decision standing, one per conversation, in
 * the order the query sorts them. Only threads with a delivered message.
 */
export function untriagedThreads(
  store: MailStore,
  accountId: string,
  scope: string = DEFAULT_SCOPE,
  now?: Date,
): MailThread[] {
  const resolved = resolveThreadQuery(
    store,
    accountId,
    `${scope.trim() || DEFAULT_SCOPE} is:untriaged`,
    now,
  )
  return resolved.entries.flatMap(entry => {
    // The open thread of the conversation, not its representative: a
    // representative already triaged would be fed, recorded as nothing
    // new, and fed again forever.
    const open = entry.threads.find(
      thread =>
        aiTriageCurrent(store, thread) === null &&
        latestDeliveredMessage(store, thread.id) !== null,
    )
    return open ? [open] : []
  })
}

export function aiTriageRemaining(
  store: MailStore,
  accountId: string,
  scope?: string,
  now?: Date,
): number {
  return untriagedThreads(store, accountId, scope, now).length
}

interface SenderFacts {
  owner: OwnerIdentityRegistry
  /** Messages the user has sent to an address. */
  replied: Map<string, number>
  /** The verdict the user last gave a sender themselves. */
  marked: Map<string, MailAiTriageVerdict>
}

export function senderFacts(store: MailStore): SenderFacts {
  const owner = ownerIdentityRegistryForStore(store)
  const replied = new Map<string, number>()
  for (const message of store.messages) {
    if (!isDeliveredMessage(message) || !isOwnerContact(message.from, owner)) continue
    for (const contact of [...(message.to ?? []), ...(message.cc ?? [])]) {
      const key = emailKey(contact.email)
      if (key) replied.set(key, (replied.get(key) ?? 0) + 1)
    }
  }
  const marked = new Map<string, MailAiTriageVerdict>()
  const byUser = (store.aiTriage ?? [])
    .filter(record => record.decidedBy === 'user')
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
  for (const record of byUser) marked.set(emailKey(record.from.email), record.verdict)
  return { owner, replied, marked }
}

export function triageRow(
  store: MailStore,
  thread: MailThread,
  facts: SenderFacts,
): AiTriageRow {
  const latest = latestDeliveredMessage(store, thread.id)!
  const delivered = store.messages.filter(
    message => message.threadId === thread.id && isDeliveredMessage(message),
  )
  const fromYou = isOwnerContact(latest.from, facts.owner)
  const excerpt = clip(
    cleanTriageExcerpt(cleanMailMessageText(latest).text || latest.body || ''),
    AI_TRIAGE_TEXT_CAP,
  )
  const toYou = (latest.to ?? []).some(contact => isOwnerContact(contact, facts.owner))
  const ccYou = (latest.cc ?? []).some(contact => isOwnerContact(contact, facts.owner))
  const files = (latest.attachments ?? []).map(file => file.name).filter(Boolean)
  const previous = aiTriageRecordFor(store, thread.id)
  const senderKey = emailKey(latest.from.email)
  const replied = fromYou ? 0 : facts.replied.get(senderKey) ?? 0
  const marked = fromYou ? undefined : facts.marked.get(senderKey)
  const invite = latest.calendarInvite
  return {
    id: thread.id,
    at: latest.receivedAt,
    subject: clip(flat(thread.subject || latest.subject || '(no subject)'), 140).text,
    from: clip(contactLine(latest.from), 90).text,
    last: fromYou ? 'you' : 'them',
    messages: delivered.length,
    text: excerpt.text,
    ...(excerpt.cut ? { cut: true as const } : {}),
    ...(delivered.some(message => !message.read) ? { unread: true as const } : {}),
    ...(!toYou && ccYou ? { cc: true as const } : {}),
    ...(store.drafts.some(draft => draft.threadId === thread.id && !draft.sentAt)
      ? { draft: true as const }
      : {}),
    ...(files.length ? { files: files.slice(0, 4).map(name => clip(name, 60).text) } : {}),
    ...(invite
      ? {
          invite: clip(
            flat(`${invite.method.toLowerCase()} ${invite.title} ${invite.startsAt}`),
            120,
          ).text,
        }
      : {}),
    ...(latest.listUnsubscribe ? { bulk: true as const } : {}),
    ...(previous
      ? { before: `${previous.verdict}${previous.decidedBy === 'user' ? ' (set by the user)' : ''}` }
      : {}),
    ...(replied || marked
      ? { sender: { ...(replied ? { replied } : {}), ...(marked ? { marked } : {}) } }
      : {}),
  }
}

/** The next batch of untriaged threads, packed to fit one tool result. */
export function aiTriageFeed(
  store: MailStore,
  accountId: string,
  options: { scope?: string; limit?: number; now?: Date; budget?: number } = {},
): AiTriageFeed {
  const scope = options.scope?.trim() || DEFAULT_SCOPE
  const budget = options.budget ?? AI_TRIAGE_RESULT_BUDGET
  const requested = Math.floor(options.limit ?? AI_TRIAGE_MAX_BATCH)
  const limit = Math.max(
    1,
    Math.min(AI_TRIAGE_MAX_BATCH, Number.isFinite(requested) ? requested : AI_TRIAGE_MAX_BATCH),
  )
  const candidates = untriagedThreads(store, accountId, scope, options.now)
  const facts = senderFacts(store)
  const envelope = (rows: AiTriageRow[]): AiTriageFeed => {
    const remaining = candidates.length - rows.length
    return {
      scope,
      returned: rows.length,
      remaining,
      threads: rows,
      note:
        remaining > 0
          ? 'Judge every thread, recordTriage them all with their at, then call nextTriageBatch again.'
          : rows.length
            ? 'Last batch: judge these and recordTriage them.'
            : 'Nothing left to triage in this scope.',
    }
  }
  const rows: AiTriageRow[] = []
  for (const thread of candidates) {
    if (rows.length >= limit) break
    const row = triageRow(store, thread, facts)
    const size = JSON.stringify(envelope([...rows, row])).length
    if (size <= budget) {
      rows.push(row)
      continue
    }
    if (rows.length) break
    // One long message on its own: shorten its excerpt rather than overflow.
    const room = Math.max(160, row.text.length - (size - budget) - 1)
    rows.push({ ...row, text: `${row.text.slice(0, room)}…`, cut: true })
    break
  }
  return envelope(rows)
}

/**
 * Record decisions. The assistant's must name the `at` it was shown, so a
 * thread that got a new message in between is refused as stale; the user's
 * own changes apply to the thread as it is. One decision per thread: the
 * last one given wins. A user change keeps what the assistant had said.
 */
export function applyAiTriage(
  store: MailStore,
  decisions: readonly AiTriageDecision[],
  options: { decidedBy: 'agent' | 'user' | 'model'; now: Date; confidence?: number; model?: string; provider?: 'typesafe' | 'local' },
): AiTriageApplied {
  const decidedAt = options.now.toISOString()
  const threads = new Map(store.threads.map(thread => [thread.id, thread]))
  const next = new Map((store.aiTriage ?? []).map(record => [record.threadId, record]))
  const byThread = new Map<string, AiTriageDecision>()
  for (const decision of decisions) byThread.set(decision.id, decision)
  const recorded: AiTriageApplied['recorded'] = []
  const stale: AiTriageApplied['stale'] = []
  const unknown: string[] = []
  const invalid: AiTriageApplied['invalid'] = []

  for (const decision of byThread.values()) {
    const thread = threads.get(decision.id)
    if (!thread) {
      unknown.push(decision.id)
      continue
    }
    const verdict = (decision.verdict ?? '').trim().toLowerCase()
    if (!isAiTriageVerdict(verdict)) {
      invalid.push({
        id: thread.id,
        problem: `verdict must be one of ${AI_TRIAGE_VERDICTS.join(', ')}`,
      })
      continue
    }
    const latest = latestDeliveredMessage(store, thread.id)
    if (!latest) {
      invalid.push({ id: thread.id, problem: 'the thread has no delivered message to triage' })
      continue
    }
    const reason = flat(decision.reason ?? '')
    const action = flat(decision.action ?? '')
    if (options.decidedBy !== 'user') {
      if (!decision.at) {
        invalid.push({ id: thread.id, problem: 'at is required: the at nextTriageBatch gave for this thread' })
        continue
      }
      if (decision.at !== latest.receivedAt) {
        stale.push({ id: thread.id, subject: thread.subject })
        continue
      }
      if (!reason) {
        invalid.push({ id: thread.id, problem: 'reason is required: one line on why' })
        continue
      }
    }
    const previous = next.get(thread.id) ?? null
    const sameMessage = previous !== null && previous.messageId === latest.id
    if (sameMessage && ((options.decidedBy === 'model' && previous.decidedBy !== 'model') || (options.decidedBy === 'agent' && previous.decidedBy === 'user'))) continue
    let correctedFrom: MailAiTriageVerdict | undefined
    if (options.decidedBy === 'user' && previous && sameMessage) {
      const agentVerdict =
        previous.decidedBy !== 'user' ? previous.verdict : previous.correctedFrom
      correctedFrom = agentVerdict && agentVerdict !== verdict ? agentVerdict : undefined
    }
    const keptAction =
      action || (options.decidedBy === 'user' && sameMessage ? previous?.action ?? '' : '')
    const record: MailAiTriageRecord = {
      threadId: thread.id,
      accountId: thread.accountId,
      messageId: latest.id,
      seenAt: latest.receivedAt,
      verdict,
      reason: reason || (sameMessage && previous ? previous.reason : 'Set by you.'),
      ...(keptAction ? { action: keptAction } : {}),
      subject: thread.subject || latest.subject || '(no subject)',
      from: { name: latest.from.name ?? '', email: latest.from.email ?? '' },
      decidedAt,
      decidedBy: options.decidedBy,
      ...(options.decidedBy === 'model' ? {confidence:options.confidence,model:options.model,provider:options.provider} : {}),
      ...(correctedFrom ? { correctedFrom } : {}),
    }
    next.set(thread.id, record)
    recorded.push({ id: thread.id, subject: record.subject, verdict })
  }

  if (!recorded.length) return { store, recorded, stale, unknown, invalid }
  const kept = [...next.values()]
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
    .slice(0, AI_TRIAGE_KEEP)
  return { store: { ...store, aiTriage: kept }, recorded, stale, unknown, invalid }
}

/** Forget the decision on these threads: the next batch looks at them again. */
export function clearAiTriage(store: MailStore, threadIds: readonly string[]): MailStore {
  const drop = new Set(threadIds)
  const current = store.aiTriage ?? []
  if (!current.some(record => drop.has(record.threadId))) return store
  return { ...store, aiTriage: current.filter(record => !drop.has(record.threadId)) }
}

export function countVerdicts(
  items: readonly { verdict: MailAiTriageVerdict }[],
): Record<MailAiTriageVerdict, number> {
  const counts: Record<MailAiTriageVerdict, number> = {
    needs_reply: 0,
    important: 0,
    fyi: 0,
    noise: 0,
  }
  for (const item of items) counts[item.verdict] += 1
  return counts
}

/** The ledger line for a recorded batch. */
export function aiTriageSummary(recorded: readonly { verdict: MailAiTriageVerdict }[]): string {
  const counts = countVerdicts(recorded)
  const parts = AI_TRIAGE_VERDICTS.filter(verdict => counts[verdict]).map(verdict =>
    verdict === 'needs_reply'
      ? `${counts[verdict]} ${counts[verdict] === 1 ? 'needs a reply' : 'need a reply'}`
      : `${counts[verdict]} ${AI_TRIAGE_LABELS[verdict]}`,
  )
  return `Triaged ${recorded.length} thread${recorded.length === 1 ? '' : 's'}: ${parts.join(', ')}.`
}

/** An ISO date, or a span back from now: 12h, 1d, 1w. Empty means 1d. */
export function parseSince(since: string | undefined, now: Date): Date | null {
  const value = (since ?? '').trim() || '1d'
  const relative = /^(\d+)\s*([hdw])$/i.exec(value)
  if (relative) {
    const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
      relative[2].toLowerCase() as 'h' | 'd' | 'w'
    ]
    return new Date(now.getTime() - Number(relative[1]) * unit)
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}

function reportRow(
  store: MailStore,
  record: MailAiTriageRecord,
  owner: OwnerIdentityRegistry,
): AiTriageReportRow {
  const latest = latestDeliveredMessage(store, record.threadId)
  const newer =
    latest !== null && latest.id !== record.messageId && latest.receivedAt > record.seenAt
  const fromYou = newer && isOwnerContact(latest!.from, owner)
  return {
    id: record.threadId,
    verdict: record.verdict,
    subject: clip(flat(record.subject), 140).text,
    from: clip(contactLine(record.from), 90).text,
    reason: clip(flat(record.reason), 300).text,
    ...(record.action ? { action: clip(flat(record.action), 200).text } : {}),
    at: record.decidedAt,
    ...(record.decidedBy === 'user' ? { by: 'you' as const } : {}),
    ...(fromYou ? { done: true as const } : newer ? { reopened: true as const } : {}),
  }
}

/**
 * Decisions made since a time, needs_reply first, then important, fyi and
 * (when asked) noise; newest first within each. Paged to fit one result.
 */
export function aiTriageReport(
  store: MailStore,
  accountId: string,
  options: {
    since: Date
    include?: readonly MailAiTriageVerdict[]
    offset?: number
    budget?: number
  },
): AiTriageReport {
  const include = new Set<MailAiTriageVerdict>(
    options.include?.length ? options.include : ['needs_reply', 'important', 'fyi'],
  )
  const budget = options.budget ?? AI_TRIAGE_RESULT_BUDGET
  const since = options.since.toISOString()
  const owner = ownerIdentityRegistryForStore(store)
  const inWindow = (store.aiTriage ?? []).filter(
    record => record.accountId === accountId && record.decidedAt >= since,
  )
  const counts = countVerdicts(inWindow)
  const order = new Map(AI_TRIAGE_VERDICTS.map((verdict, index) => [verdict, index]))
  const rows = inWindow
    .filter(record => include.has(record.verdict))
    .sort(
      (a, b) =>
        (order.get(a.verdict) ?? 0) - (order.get(b.verdict) ?? 0) ||
        b.decidedAt.localeCompare(a.decidedAt),
    )
    .map(record => reportRow(store, record, owner))
  const offset = Math.max(0, Math.floor(options.offset ?? 0))
  const envelope = (items: AiTriageReportRow[], nextOffset?: number): AiTriageReport => ({
    since,
    counts,
    total: rows.length,
    items,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
  })
  const page: AiTriageReportRow[] = []
  for (let index = offset; index < rows.length; index += 1) {
    const candidate = [...page, rows[index]]
    const more = index + 1 < rows.length ? index + 1 : undefined
    if (!page.length || JSON.stringify(envelope(candidate, more)).length <= budget) {
      page.push(rows[index])
      continue
    }
    break
  }
  const nextIndex = offset + page.length
  return envelope(page, nextIndex < rows.length ? nextIndex : undefined)
}

/** Remove hidden preheader padding and URL noise before either triage path. */
export function cleanTriageExcerpt(text:string):string {
  return text.replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'')
    .replace(/\[https?:\/\/[^\]\s]+\]/gi,'')
    .replace(/https?:\/\/\S+/gi,'[link]').replace(/\s+/g,' ').trim()
}
