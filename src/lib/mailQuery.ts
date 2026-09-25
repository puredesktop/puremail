import { aiTriageCurrent, isAiTriageVerdict } from './aiTriageState'
import type { MailStore, MailThread, MailContact } from '../types'
import { threadIsInsideFetchWindow } from './mailModel'

/**
 * The one query language. A thread list only ever comes into existence by
 * resolving a query, so the string in the search box, the sidebar nav item,
 * a saved view, and anything an agent asks for are all the same object.
 *
 * Operators (all support a leading `-` to negate):
 *   in:<mailbox>        inbox | archive | sent | trash | drafts | name | id
 *   from: to: cc:       substring match on contact name or email
 *   subject: label:
 *   has:attachment | has:calendar
 *   is:unread | read | starred | snoozed | scheduled | draft
 *   before:/after:      YYYY-MM-DD or YYYY/MM/DD (after is inclusive)
 *   older_than:30d      also h/w/m suffixes; newer_than: likewise
 *   sort:newest | oldest | sender | subject
 *   limit:N
 * Anything else is free text, matched against subject, summary, bodies and
 * sender addresses.
 */

export type MailQuerySort = 'newest' | 'oldest' | 'sender' | 'subject'

export interface MailQueryTerm {
  field: MailQueryField
  value: string
  negated: boolean
}

export type MailQueryField =
  | 'in'
  | 'from'
  | 'to'
  | 'cc'
  | 'subject'
  | 'label'
  | 'has'
  | 'is'
  | 'before'
  | 'after'
  | 'older_than'
  | 'newer_than'
  | 'triage'

export interface MailQuery {
  terms: MailQueryTerm[]
  text: string
  sort: MailQuerySort
  limit?: number
}

const FIELDS: MailQueryField[] = [
  'in',
  'from',
  'to',
  'cc',
  'subject',
  'label',
  'has',
  'is',
  'before',
  'after',
  'older_than',
  'newer_than',
  'triage',
]

const HAS_VALUES = new Set(['attachment', 'calendar'])
const IS_VALUES = new Set([
  'unread',
  'read',
  'starred',
  'snoozed',
  'scheduled',
  'draft',
  'triaged',
  'untriaged',
])
const SORT_VALUES = new Set<MailQuerySort>([
  'newest',
  'oldest',
  'sender',
  'subject',
])

const OPERATOR_PATTERN = new RegExp(
  `(-?)(${FIELDS.join('|')}|sort|limit):(?:"([^"]*)"|(\\S+))`,
  'gi',
)

export const DEFAULT_MAIL_QUERY_SORT: MailQuerySort = 'newest'

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

/** Quote a value for interpolation into a query string. */
export function quoteQueryValue(value: string): string {
  return quote(value)
}

/** Parse a query string. Unknown operators and bad values stay as free text. */
export function parseMailQuery(input: string): MailQuery {
  const query: MailQuery = { terms: [], text: '', sort: DEFAULT_MAIL_QUERY_SORT }
  const textParts: string[] = []
  let lastIndex = 0
  OPERATOR_PATTERN.lastIndex = 0
  for (;;) {
    const match = OPERATOR_PATTERN.exec(input)
    if (!match) break
    textParts.push(input.slice(lastIndex, match.index))
    lastIndex = OPERATOR_PATTERN.lastIndex
    const negated = match[1] === '-'
    const field = (match[2] ?? '').toLowerCase()
    const value = (match[3] ?? match[4] ?? '').trim()
    if (!value) {
      textParts.push(match[0])
      continue
    }
    if (field === 'sort') {
      const lowered = value.toLowerCase() as MailQuerySort
      if (SORT_VALUES.has(lowered)) query.sort = lowered
      else textParts.push(match[0])
      continue
    }
    if (field === 'limit') {
      const parsed = Number(value)
      if (Number.isInteger(parsed) && parsed > 0) query.limit = parsed
      else textParts.push(match[0])
      continue
    }
    if (field === 'has' && !HAS_VALUES.has(value.toLowerCase())) {
      textParts.push(match[0])
      continue
    }
    if (field === 'is' && !IS_VALUES.has(value.toLowerCase())) {
      textParts.push(match[0])
      continue
    }
    if (field === 'triage' && !isAiTriageVerdict(value.toLowerCase())) {
      textParts.push(match[0])
      continue
    }
    query.terms.push({
      field: field as MailQueryField,
      value,
      negated,
    })
  }
  textParts.push(input.slice(lastIndex))
  query.text = textParts.join(' ').replace(/\s+/g, ' ').trim()
  return query
}

/** Canonical string for a query. parse(build(q)) round-trips. */
export function buildMailQuery(query: MailQuery): string {
  const parts = query.terms.map(
    term => `${term.negated ? '-' : ''}${term.field}:${quote(term.value)}`,
  )
  if (query.sort !== DEFAULT_MAIL_QUERY_SORT) parts.push(`sort:${query.sort}`)
  if (query.limit) parts.push(`limit:${query.limit}`)
  if (query.text) parts.push(query.text)
  return parts.join(' ')
}

/** Add or replace a single-valued term, returning the new query string. */
export function withQueryTerm(
  input: string,
  field: MailQueryField,
  value: string | undefined,
): string {
  const query = parseMailQuery(input)
  const index = query.terms.findIndex(term => term.field === field)
  const others = query.terms.filter(term => term.field !== field)
  if (!value) return buildMailQuery({ ...query, terms: others })
  const replacement: MailQueryTerm = { field, value, negated: false }
  // Replace in place so editing one facet does not reshuffle the query the
  // user is reading.
  const terms =
    index === -1
      ? [...others, replacement]
      : [
          ...others.slice(0, index),
          replacement,
          ...others.slice(index),
        ]
  return buildMailQuery({ ...query, terms })
}

export function queryTermValue(
  query: MailQuery,
  field: MailQueryField,
): string | undefined {
  return query.terms.find(term => term.field === field && !term.negated)?.value
}

export function queryHasFlag(
  query: MailQuery,
  field: 'is' | 'has',
  value: string,
): boolean {
  return query.terms.some(
    term =>
      term.field === field &&
      !term.negated &&
      term.value.toLowerCase() === value,
  )
}

function parseAbsoluteDate(value: string): number | null {
  const ms = Date.parse(value.replace(/\//g, '-'))
  return Number.isFinite(ms) ? ms : null
}

/** `30d`, `12h`, `2w`, `6m` → milliseconds. Bare numbers mean days. */
function parseRelativeDuration(value: string): number | null {
  const match = /^(\d+)\s*([hdwm]?)$/i.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = (match[2] || 'd').toLowerCase()
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  if (unit === 'h') return amount * hour
  if (unit === 'w') return amount * 7 * day
  if (unit === 'm') return amount * 30 * day
  return amount * day
}

function contactMatches(contacts: MailContact[], needle: string): boolean {
  const lowered = needle.toLowerCase()
  return contacts.some(
    contact =>
      contact.email.toLowerCase().includes(lowered) ||
      contact.name.toLowerCase().includes(lowered),
  )
}

function mailboxIdsForToken(store: MailStore, token: string): Set<string> {
  const lowered = token.trim().toLowerCase()
  const ids = new Set<string>()
  for (const mailbox of store.mailboxes) {
    if (
      mailbox.id.toLowerCase() === lowered ||
      mailbox.name.toLowerCase() === lowered ||
      mailbox.role.toLowerCase() === lowered
    ) {
      ids.add(mailbox.id)
    }
  }
  return ids
}

/**
 * Every thread that carries at least one unsent draft.
 *
 * This is the ONE definition of "is there a draft here", used by both
 * `is:draft` and `in:Drafts`. They used to answer different questions —
 * `is:draft` looked at draft records, the folder looked at `thread.mailboxId` —
 * so the sidebar count, the folder contents and search disagreed.
 *
 * It counts pending and failed generated drafts too. Hiding those is how a
 * draft an agent reported writing became findable nowhere at all; a draft that
 * exists must be somewhere the user can see it, even if what it says is
 * "this one failed, retry".
 */
export function threadHasUnsentDraft(
  store: Pick<MailStore, 'drafts'>,
  threadId: string,
): boolean {
  return store.drafts.some(
    draft => draft.threadId === threadId && !draft.sentAt,
  )
}

/**
 * Drafts are not filed in a folder of their own — a reply draft belongs to the
 * conversation it answers, which lives in the inbox. So Drafts is a view over
 * drafts, the way Gmail's is: the conversation shows up under Drafts while it
 * holds one, and drops out the moment it is sent, without ever leaving the
 * inbox. Re-homing drafts onto synthetic threads was the alternative, and it
 * detached every draft from the conversation it was answering.
 */
function isDraftsMailboxToken(store: MailStore, token: string): boolean {
  const lowered = token.trim().toLowerCase()
  return store.mailboxes.some(
    mailbox =>
      mailbox.role === 'drafts' &&
      (mailbox.id.toLowerCase() === lowered ||
        mailbox.name.toLowerCase() === lowered ||
        mailbox.role.toLowerCase() === lowered),
  )
}

function trashMailboxIds(store: MailStore): Set<string> {
  return new Set(
    store.mailboxes
      .filter(mailbox => mailbox.role === 'trash')
      .map(mailbox => mailbox.id),
  )
}

function labelNameForToken(store: MailStore, token: string): string {
  const lowered = token.trim().toLowerCase()
  const label = store.labels.find(
    item =>
      item.id.toLowerCase() === lowered || item.name.toLowerCase() === lowered,
  )
  return (label?.name ?? token).toLowerCase()
}

interface ThreadFacts {
  thread: MailThread
  messages: MailStore['messages']
  starred: boolean
  scheduled: boolean
  haystack: string
}

/**
 * Per-store derived indexes, built once and reused for every query the
 * store's lifetime. The store is replaced wholesale on every change, so a
 * WeakMap keyed on it is both automatically invalidated and leak-free.
 *
 * Before this, EVERY resolution re-indexed all messages and re-lowercased
 * every message body into a haystack — and one open of the mailbox
 * dropdown resolves dozens of queries (a count and an unseen badge per
 * row), which with all folders synced took ~600ms of main-thread work per
 * click.
 */
interface StoreQueryIndexes {
  messagesByThread: Map<string, MailStore['messages']>
  starred: Set<string>
  scheduled: Set<string>
  factsByThread: Map<string, ThreadFacts>
  /** Lazy: threads holding at least one unread message. */
  unreadThreadIds?: Set<string>
}

const storeQueryIndexes = new WeakMap<MailStore, StoreQueryIndexes>()

function indexesForStore(store: MailStore): StoreQueryIndexes {
  const cached = storeQueryIndexes.get(store)
  if (cached) return cached
  const messagesByThread = new Map<string, MailStore['messages']>()
  for (const message of store.messages) {
    const list = messagesByThread.get(message.threadId)
    if (list) list.push(message)
    else messagesByThread.set(message.threadId, [message])
  }
  const built: StoreQueryIndexes = {
    messagesByThread,
    starred: new Set(store.starredThreadIds ?? []),
    scheduled: new Set(
      (store.scheduledSends ?? [])
        .filter(entry => entry.status === 'scheduled')
        .map(entry => entry.threadId),
    ),
    factsByThread: new Map(),
  }
  storeQueryIndexes.set(store, built)
  return built
}

/** Threads with at least one unread message, computed once per store. */
export function unreadThreadIdsForStore(store: MailStore): Set<string> {
  const indexes = indexesForStore(store)
  if (!indexes.unreadThreadIds) {
    indexes.unreadThreadIds = new Set(
      store.messages
        .filter(message => !message.read)
        .map(message => message.threadId),
    )
  }
  return indexes.unreadThreadIds
}

function buildThreadFacts(store: MailStore, threads: MailThread[]): ThreadFacts[] {
  const indexes = indexesForStore(store)
  return threads.map(thread => {
    const cached = indexes.factsByThread.get(thread.id)
    if (cached) return cached
    const messages = indexes.messagesByThread.get(thread.id) ?? []
    const facts: ThreadFacts = {
      thread,
      messages,
      starred: indexes.starred.has(thread.id),
      scheduled: indexes.scheduled.has(thread.id),
      haystack: [
        thread.subject,
        thread.summary,
        // People are what users search for most: names as well as
        // addresses, senders as well as recipients.
        ...thread.participants.flatMap(contact => [
          contact.name,
          contact.email,
        ]),
        ...messages.map(message => message.body),
        ...messages.flatMap(message => [
          message.from.name,
          message.from.email,
          ...message.to.flatMap(contact => [contact.name, contact.email]),
        ]),
      ]
        .join('\n')
        .toLowerCase(),
    }
    indexes.factsByThread.set(thread.id, facts)
    return facts
  })
}

/** Does one term hold for a thread, ignoring its `negated` flag? */
function termHolds(
  store: MailStore,
  facts: ThreadFacts,
  term: MailQueryTerm,
  nowMs: number,
): boolean {
  const { thread, messages } = facts
  const value = term.value
  switch (term.field) {
    case 'in': {
      if (isDraftsMailboxToken(store, value)) {
        return threadHasUnsentDraft(store, thread.id)
      }
      const ids = mailboxIdsForToken(store, value)
      return ids.has(thread.mailboxId)
    }
    case 'from':
      return messages.some(message => contactMatches([message.from], value))
    case 'to':
      return messages.some(message => contactMatches(message.to, value))
    case 'cc':
      return messages.some(message => contactMatches(message.cc ?? [], value))
    case 'subject':
      return thread.subject.toLowerCase().includes(value.toLowerCase())
    case 'label':
      return thread.labels.some(
        label => label.toLowerCase() === labelNameForToken(store, value),
      )
    case 'has': {
      const lowered = value.toLowerCase()
      if (lowered === 'attachment') {
        return messages.some(
          message => (message.attachments ?? []).length > 0,
        )
      }
      return messages.some(message => Boolean(message.calendarInvite))
    }
    case 'is': {
      const lowered = value.toLowerCase()
      if (lowered === 'unread') return messages.some(message => !message.read)
      if (lowered === 'read') return messages.every(message => message.read)
      if (lowered === 'starred') return facts.starred
      if (lowered === 'snoozed') return thread.status === 'snoozed'
      if (lowered === 'draft') return threadHasUnsentDraft(store, thread.id)
      if (lowered === 'triaged') return aiTriageCurrent(store, thread) !== null
      if (lowered === 'untriaged') return aiTriageCurrent(store, thread) === null
      return facts.scheduled
    }
    case 'before': {
      const ms = parseAbsoluteDate(value)
      if (ms === null) return true
      return Date.parse(thread.lastMessageAt) < ms
    }
    case 'after': {
      const ms = parseAbsoluteDate(value)
      if (ms === null) return true
      return Date.parse(thread.lastMessageAt) >= ms
    }
    case 'older_than': {
      const duration = parseRelativeDuration(value)
      if (duration === null) return true
      return Date.parse(thread.lastMessageAt) < nowMs - duration
    }
    case 'newer_than': {
      const duration = parseRelativeDuration(value)
      if (duration === null) return true
      return Date.parse(thread.lastMessageAt) >= nowMs - duration
    }
    case 'triage':
      return aiTriageCurrent(store, thread)?.verdict === value.toLowerCase()
    default:
      return true
  }
}

export interface MailQueryEntry {
  /** Representative thread for the conversation. */
  thread: MailThread
  /** Every thread grouped into this conversation. */
  threads: MailThread[]
  /** Timestamp the rail sorts and labels by. */
  sortAt: string
}

export interface MailQueryResult {
  /** Canonical query string these results came from. */
  query: string
  parsed: MailQuery
  /** One entry per conversation, in sort order. */
  entries: MailQueryEntry[]
  /** Representative thread per conversation, in sort order. */
  threads: MailThread[]
  /** Conversation count before `limit:` was applied. */
  total: number
}

function normalizedThreadSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()
}

/**
 * Group key for threads that are one human conversation. Gmail's own thread
 * id wins when present; otherwise account + mailbox + normalized subject +
 * participants.
 */
export function conversationKeyForThread(thread: MailThread): string {
  if (thread.gmailThreadId) {
    return `gmail:${thread.accountId}:${thread.gmailThreadId}`
  }
  const participants = thread.participants
    .map(contact => contact.email.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',')
  return [
    `account:${thread.accountId}`,
    `mailbox:${thread.mailboxId}`,
    `subject:${normalizedThreadSubject(thread.subject)}`,
    `people:${participants}`,
  ].join('|')
}

/**
 * The single way a thread list comes into existence.
 *
 * Scope rules that are not expressible as operators, and so always apply:
 * the account, and — unless the query names a mailbox with `in:` —
 * excluding Trash, matching Gmail. The fetch window applies only when the
 * query does not state its own time scope.
 */
/**
 * Resolved queries, cached per store object. The sidebar and its dropdown
 * resolve the same handful of queries several times per render (a count
 * and an unseen badge each), and agents probe repeatedly — all against a
 * store that only changes by wholesale replacement. Keyed on the CANONICAL
 * query plus a minute bucket of `now`, so fetch-window drift is bounded at
 * one minute while a render burst hits the cache every time. Callers treat
 * results as read-only (nothing in the app mutates them).
 */
const queryResultCache = new WeakMap<MailStore, Map<string, MailQueryResult>>()

export function resolveThreadQuery(
  store: MailStore,
  accountId: string | undefined,
  input: string,
  now: Date | string = new Date(),
): MailQueryResult {
  const parsed = parseMailQuery(input)
  const canonical = buildMailQuery(parsed)
  if (!accountId) {
    return { query: canonical, parsed, entries: [], threads: [], total: 0 }
  }
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime()
  const cacheKey = `${accountId}|${Math.floor(nowMs / 60000)}|${canonical}`
  let cachedByKey = queryResultCache.get(store)
  if (!cachedByKey) {
    cachedByKey = new Map()
    queryResultCache.set(store, cachedByKey)
  }
  const cachedResult = cachedByKey.get(cacheKey)
  if (cachedResult) return cachedResult
  const namesMailbox = parsed.terms.some(
    term => term.field === 'in' && !term.negated,
  )
  // The fetch window is a display horizon, not a filter the user asked
  // for. When the query states its own time scope, honour that instead —
  // otherwise `older_than:60d` can never return anything under a 30-day
  // window, which makes the operator a lie.
  const namesTimeScope = parsed.terms.some(term =>
    ['before', 'after', 'older_than', 'newer_than'].includes(term.field),
  )
  const trash = trashMailboxIds(store)

  const scoped = store.threads.filter(
    thread =>
      thread.accountId === accountId &&
      (namesTimeScope ||
        threadIsInsideFetchWindow(store, thread, new Date(nowMs))) &&
      (namesMailbox || !trash.has(thread.mailboxId)),
  )

  const text = parsed.text.toLowerCase()
  const matched = buildThreadFacts(store, scoped).filter(facts => {
    for (const term of parsed.terms) {
      const holds = termHolds(store, facts, term, nowMs)
      if (term.negated ? holds : !holds) return false
    }
    if (text && !facts.haystack.includes(text)) return false
    return true
  })

  // Conversation grouping: many stored threads can be one conversation.
  const conversations = new Map<string, MailThread[]>()
  for (const facts of matched) {
    const key = conversationKeyForThread(facts.thread)
    conversations.set(key, [...(conversations.get(key) ?? []), facts.thread])
  }

  const messageTimeByThread = new Map<string, string>()
  for (const facts of matched) {
    const latest = [...facts.messages].sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt),
    )[0]
    if (latest) messageTimeByThread.set(facts.thread.id, latest.receivedAt)
  }

  const entries: MailQueryEntry[] = [...conversations.values()].map(threads => {
    // Sort by the latest message overall — the same clock the thread header
    // shows — so replying bumps the conversation and the rail time agrees.
    const sortAt =
      threads
        .map(thread => messageTimeByThread.get(thread.id) ?? '')
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0] ??
      [...threads].sort((a, b) =>
        b.lastMessageAt.localeCompare(a.lastMessageAt),
      )[0]?.lastMessageAt ??
      ''
    const representative =
      threads.filter(
        thread => messageTimeByThread.get(thread.id) === sortAt,
      )[0] ??
      [...threads].sort((a, b) =>
        b.lastMessageAt.localeCompare(a.lastMessageAt),
      )[0]
    return { thread: representative, threads, sortAt }
  })

  entries.sort((a, b) => {
    if (parsed.sort === 'oldest') return a.sortAt.localeCompare(b.sortAt)
    if (parsed.sort === 'sender') {
      const left = a.thread.participants[0]?.name ?? ''
      const right = b.thread.participants[0]?.name ?? ''
      return left.localeCompare(right)
    }
    if (parsed.sort === 'subject') {
      return normalizedThreadSubject(a.thread.subject).localeCompare(
        normalizedThreadSubject(b.thread.subject),
      )
    }
    return b.sortAt.localeCompare(a.sortAt)
  })

  const total = entries.length
  const limited = parsed.limit ? entries.slice(0, parsed.limit) : entries
  const result = {
    query: canonical,
    parsed,
    entries: limited,
    threads: limited.map(entry => entry.thread),
    total,
  }
  cachedByKey.set(cacheKey, result)
  return result
}

/** Conversation count for a query — the number the sidebar badges show. */
export function countThreadQuery(
  store: MailStore,
  accountId: string | undefined,
  input: string,
  now: Date | string = new Date(),
): number {
  return resolveThreadQuery(store, accountId, input, now).total
}

/* ── Saved views: a named query pinned to the sidebar ─────────────── */

/**
 * Add or rename a saved view. Names are unique per store — saving over an
 * existing name replaces its query rather than creating a duplicate the
 * user cannot tell apart in the sidebar.
 */
export function saveMailView(
  store: MailStore,
  name: string,
  query: string,
  now = new Date().toISOString(),
): MailStore {
  const trimmed = name.trim()
  if (!trimmed) return store
  const canonical = buildMailQuery(parseMailQuery(query))
  const existing = (store.savedViews ?? []).find(
    view => view.name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  if (existing) {
    return {
      ...store,
      savedViews: (store.savedViews ?? []).map(view =>
        view.id === existing.id ? { ...view, query: canonical } : view,
      ),
    }
  }
  return {
    ...store,
    savedViews: [
      ...(store.savedViews ?? []),
      {
        id: `view_${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        name: trimmed,
        query: canonical,
        createdAt: now,
      },
    ],
  }
}

export function deleteMailView(store: MailStore, viewId: string): MailStore {
  return {
    ...store,
    savedViews: (store.savedViews ?? []).filter(view => view.id !== viewId),
  }
}


/* ── Unseen arrivals: views/boxes/labels announce what came in ─────── */

function canonicalQueryKey(input: string): string {
  return buildMailQuery(parseMailQuery(input))
}

/** Stamp "the user looked at this query now". */
export function markQuerySeen(
  store: MailStore,
  input: string,
  now: Date | string = new Date(),
): MailStore {
  const key = canonicalQueryKey(input)
  if (!key) return store
  const at = (now instanceof Date ? now : new Date(now)).toISOString()
  return {
    ...store,
    querySeenAt: { ...(store.querySeenAt ?? {}), [key]: at },
  }
}

/**
 * What is new to the user in this view.
 *
 * Two ways of being new, because a view can only answer one of them:
 *
 * - Visited before: threads that arrived since. This is the better signal —
 *   filtered mail lands where you are not looking, sometimes already marked
 *   read, and arrival is the only thing that catches it.
 * - Never visited: unread threads. A view is stamped as seen only when the
 *   user navigates to it, so on a fresh account NOTHING is stamped and the
 *   arrival count is zero for every folder — a badge that has never once
 *   appeared. Falling back to unread means the number means something from
 *   the first launch, and the moment the user opens that folder it switches
 *   to arrivals, which is the same promise kept more precisely.
 */
export function unseenArrivalCount(
  store: MailStore,
  accountId: string | undefined,
  input: string,
  now: Date | string = new Date(),
): number {
  const seenAt = store.querySeenAt?.[canonicalQueryKey(input)]
  const threads = resolveThreadQuery(store, accountId, input, now).threads
  if (!seenAt) {
    const unreadThreadIds = unreadThreadIdsForStore(store)
    return threads.filter(thread => unreadThreadIds.has(thread.id)).length
  }
  return threads.filter(thread => thread.lastMessageAt > seenAt).length
}
