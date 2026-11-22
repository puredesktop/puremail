import type {
  MailMessage,
  MailStore,
  MailThread,
  ScreenerDecision,
  ScreenerDestination,
} from '../types'
import { archiveThread, deleteThread } from './mailModel'

export interface UnscreenedSender {
  email: string
  name: string
  latestThreadId: string
  latestSubject: string
  latestDate: string
  count: number
  suggestedDestination: ScreenerDestination
}

const NEWSLETTER_SENDER_PATTERN =
  /^(?:news(?:letter)?|digest|weekly|daily|editorial|bulletin|updates?|marketing|promo(?:tions)?|announcements?|community|substack)[@.+-]/i

const NEWSLETTER_DOMAIN_PATTERN =
  /(?:^|\.)(?:substack\.com|beehiiv\.com|ghost\.io|convertkit\.com|buttondown\.email|mailchimp\.com|revue\.email|medium\.com|morningbrew\.com|stratechery\.com)$/i

const NEWSLETTER_SUBJECT_PATTERN =
  /\b(?:newsletter|digest|weekly\s+roundup|daily\s+brief|issue\s*#?\d+|edition\s*#?\d+|what['’]s\s+new)\b/i

const PAPER_TRAIL_SUBJECT_PATTERN =
  /(?:^(?:receipt|invoice)\b|\b(?:your\s+(?:receipt|invoice|order|package|statement|subscription)|(?:payment|order|tax|billing|monthly|annual|stripe|apple|amazon|uber|lyft|doordash|google\s+play)\s+(?:receipt|invoice|statement|confirmation|trip)|(?:receipt|invoice)\s*(?:#\d+|no\.?\s*\d+|\d{3,}|for\s+your|from\s+|attached|ready|paid)|order\s+(?:confirm(?:ed|ation)?|#\d+|shipped|delivered)|shipping\s+(?:confirm(?:ed|ation)?|update|notification)|tracking\s+number|out\s+for\s+delivery|payment\s+(?:confirm(?:ed|ation)?|received|failed)|statement\s+(?:is\s+)?ready|subscription\s+renewed|e-?ticket|boarding\s+pass|booking\s+confirm(?:ed|ation)?|flight\s+itinerary)\b)/i

const PAPER_TRAIL_SENDER_PATTERN =
  /^(?:receipts?|billing|invoices?|orders?|shipping|payments?|accounting|finance|statements?|auto-?confirm|shipment-tracking)[@.+-]/i

function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function canonicalOwnEmail(email: string | undefined): string {
  const clean = normalizeEmail(email)
  const at = clean.lastIndexOf('@')
  if (at < 0) return clean
  let local = clean.slice(0, at)
  let domain = clean.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

function primarySenderEmail(
  thread: MailThread,
  messages: MailMessage[],
): string {
  const firstMsg = [...messages]
    .filter(m => !m.isDraft)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0]
  return normalizeEmail(firstMsg?.from.email ?? thread.participants[0]?.email)
}

function explicitDecisionForThread(
  thread: MailThread,
  messages: MailMessage[],
  decisions?: Record<string, ScreenerDecision>,
): ScreenerDecision | undefined {
  if (!decisions) return undefined
  const sender = primarySenderEmail(thread, messages)
  if (sender && Object.prototype.hasOwnProperty.call(decisions, sender)) {
    return decisions[sender]
  }
  for (const msg of messages) {
    const email = normalizeEmail(msg.from.email)
    if (email && Object.prototype.hasOwnProperty.call(decisions, email)) {
      return decisions[email]
    }
  }
  return undefined
}

function hasListHeader(message: MailMessage): boolean {
  if (message.listUnsubscribe || message.listUnsubscribePost) return true
  if (!message.rawHeaders?.length) return false
  return message.rawHeaders.some(header => {
    const name = header.name.toLowerCase()
    if (name === 'list-id' || name === 'list-unsubscribe') return true
    if (name === 'precedence') {
      return /^(?:bulk|list|junk)$/i.test(header.value.trim())
    }
    return false
  })
}

export function isPaperTrailThread(
  thread: MailThread,
  messages: MailMessage[],
  decisions?: Record<string, ScreenerDecision>,
): boolean {
  const decision = explicitDecisionForThread(thread, messages, decisions)
  if (decision) return decision.destination === 'paper_trail'

  const isReplySubject = /^\s*(?:re|fwd|fw)\s*:/i.test(thread.subject)
  if (!isReplySubject && PAPER_TRAIL_SUBJECT_PATTERN.test(thread.subject)) {
    return true
  }
  for (const message of messages) {
    if (PAPER_TRAIL_SENDER_PATTERN.test(normalizeEmail(message.from.email))) {
      return true
    }
    if (
      !/^\s*(?:re|fwd|fw)\s*:/i.test(message.subject) &&
      PAPER_TRAIL_SUBJECT_PATTERN.test(message.subject)
    ) {
      return true
    }
  }
  return false
}

export function isNewsletterThread(
  thread: MailThread,
  messages: MailMessage[],
  decisions?: Record<string, ScreenerDecision>,
): boolean {
  const decision = explicitDecisionForThread(thread, messages, decisions)
  if (decision) return decision.destination === 'feed'

  // Receipts/invoices with unsubscribe footers belong in Paper Trail, not Feed.
  if (isPaperTrailThread(thread, messages)) return false

  for (const message of messages) {
    if (hasListHeader(message)) return true
    const email = normalizeEmail(message.from.email)
    const domain = email.split('@')[1] ?? ''
    if (NEWSLETTER_DOMAIN_PATTERN.test(domain)) return true
    if (
      NEWSLETTER_SENDER_PATTERN.test(email) &&
      (NEWSLETTER_SUBJECT_PATTERN.test(message.subject) ||
        /\bunsubscribe\b/i.test(message.body))
    ) {
      return true
    }
  }
  return (
    !/^\s*(?:re|fwd|fw)\s*:/i.test(thread.subject) &&
    NEWSLETTER_SUBJECT_PATTERN.test(thread.subject)
  )
}

function ownEmailsForStore(store: MailStore): {
  exact: Set<string>
  canonical: Set<string>
} {
  const exact = new Set<string>()
  const canonical = new Set<string>()
  for (const account of store.accounts) {
    const email = normalizeEmail(account.email)
    if (email) {
      exact.add(email)
      canonical.add(canonicalOwnEmail(email))
    }
  }
  for (const email of store.settings.ownerIdentities?.emails ?? []) {
    const clean = normalizeEmail(email)
    if (clean) {
      exact.add(clean)
      canonical.add(canonicalOwnEmail(clean))
    }
  }
  return { exact, canonical }
}

function isOwnEmail(
  email: string,
  own: { exact: Set<string>; canonical: Set<string> },
): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return own.exact.has(normalized) || own.canonical.has(canonicalOwnEmail(normalized))
}

export function unscreenedSendersInStore(
  store: MailStore,
  accountId?: string,
): UnscreenedSender[] {
  const own = ownEmailsForStore(store)
  const vipSet = new Set(
    (store.vipSenders ?? []).map(normalizeEmail).filter(Boolean),
  )
  const decisions = store.screenerDecisions ?? {}

  // Senders the user has previously sent mail to are implicitly known/approved.
  const emailedRecipients = new Set<string>()
  for (const message of store.messages) {
    if (message.isDraft) continue
    const from = normalizeEmail(message.from.email)
    if (!isOwnEmail(from, own) && !message.sentCopyPresent && !message.deliveryAccepted) {
      continue
    }
    for (const contact of [
      ...message.to,
      ...(message.cc ?? []),
      ...(message.bcc ?? []),
    ]) {
      const email = normalizeEmail(contact.email)
      if (email) emailedRecipients.add(email)
    }
  }

  const inboxIds = new Set(
    store.mailboxes
      .filter(m => m.role === 'inbox' && (!accountId || m.accountId === accountId))
      .map(m => m.id),
  )
  const messagesByThread = new Map<string, MailMessage[]>()
  for (const message of store.messages) {
    const list = messagesByThread.get(message.threadId)
    if (list) list.push(message)
    else messagesByThread.set(message.threadId, [message])
  }

  const bySender = new Map<
    string,
    {
      email: string
      name: string
      latestThreadId: string
      latestSubject: string
      latestDate: string
      threadIds: Set<string>
      threads: MailThread[]
      messages: MailMessage[]
    }
  >()

  for (const thread of store.threads) {
    if (accountId && thread.accountId !== accountId) continue
    // Only screen active Inbox threads (not Archived, Snoozed, Sent, or Trash).
    if (!inboxIds.has(thread.mailboxId) || thread.status === 'archived' || thread.status === 'snoozed') {
      continue
    }
    const threadMessages = (messagesByThread.get(thread.id) ?? []).filter(
      m => !m.isDraft,
    )

    // Group strictly per-sender so each sender's messages are attributed only to them.
    for (const msg of threadMessages) {
      const senderEmail = normalizeEmail(msg.from.email)
      if (!senderEmail) continue
      if (isOwnEmail(senderEmail, own)) continue
      if (vipSet.has(senderEmail)) continue
      if (emailedRecipients.has(senderEmail)) continue
      if (Object.prototype.hasOwnProperty.call(decisions, senderEmail)) continue

      const existing = bySender.get(senderEmail)
      if (existing) {
        if (!existing.threadIds.has(thread.id)) {
          existing.threadIds.add(thread.id)
          existing.threads.push(thread)
        }
        existing.messages.push(msg)
        if (msg.receivedAt > existing.latestDate) {
          existing.latestDate = msg.receivedAt
          existing.latestThreadId = thread.id
          existing.latestSubject = thread.subject
          if (msg.from.name) existing.name = msg.from.name
        }
      } else {
        bySender.set(senderEmail, {
          email: senderEmail,
          name: msg.from.name || senderEmail,
          latestThreadId: thread.id,
          latestSubject: thread.subject,
          latestDate: msg.receivedAt,
          threadIds: new Set([thread.id]),
          threads: [thread],
          messages: [msg],
        })
      }
    }
  }

  return [...bySender.values()]
    .map(entry => {
      const sampleThread = entry.threads[0]!
      const suggestedDestination: ScreenerDestination = isPaperTrailThread(
        sampleThread,
        entry.messages,
      )
        ? 'paper_trail'
        : isNewsletterThread(sampleThread, entry.messages)
          ? 'feed'
          : 'inbox'
      return {
        email: entry.email,
        name: entry.name,
        latestThreadId: entry.latestThreadId,
        latestSubject: entry.latestSubject,
        latestDate: entry.latestDate,
        count: entry.threadIds.size,
        suggestedDestination,
      }
    })
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))
}

export function applyScreenerDecisionWithEffects(
  store: MailStore,
  email: string,
  destination: ScreenerDestination,
  senderName?: string,
  nowIso = new Date().toISOString(),
  accountId?: string,
): { store: MailStore; affectedThreadIds: string[] } {
  const normalized = normalizeEmail(email)
  if (!normalized) return { store, affectedThreadIds: [] }

  const decision: ScreenerDecision = {
    email: normalized,
    destination,
    decidedAt: nowIso,
    updatedAt: nowIso,
    ...(senderName?.trim() ? { senderName: senderName.trim() } : {}),
  }

  let next: MailStore = {
    ...store,
    screenerDecisions: {
      ...(store.screenerDecisions ?? {}),
      [normalized]: decision,
    },
  }

  const affectedThreadIds: string[] = []
  if (destination === 'blocked') {
    const inboxIds = new Set(
      next.mailboxes
        .filter(
          m => m.role === 'inbox' && (!accountId || m.accountId === accountId),
        )
        .map(m => m.id),
    )
    // Match ONLY threads with an actual inbound `from` message from the blocked sender
    // (never passive CC/To participants).
    const threadIdsFromSender = new Set<string>()
    for (const message of next.messages) {
      if (message.isDraft) continue
      if (normalizeEmail(message.from.email) === normalized) {
        threadIdsFromSender.add(message.threadId)
      }
    }
    for (const thread of next.threads) {
      if (accountId && thread.accountId !== accountId) continue
      if (!inboxIds.has(thread.mailboxId)) continue
      if (!threadIdsFromSender.has(thread.id)) continue
      const accountTrash = next.mailboxes.find(
        m => m.accountId === thread.accountId && m.role === 'trash',
      )
      const accountArchive = next.mailboxes.find(
        m => m.accountId === thread.accountId && m.role === 'archive',
      )
      next = accountTrash
        ? deleteThread(next, thread.id, accountTrash.id)
        : archiveThread(next, thread.id, accountArchive?.id)
      affectedThreadIds.push(thread.id)
    }
  }

  return { store: next, affectedThreadIds }
}

export function applyScreenerDecision(
  store: MailStore,
  email: string,
  destination: ScreenerDestination,
  senderName?: string,
  nowIso = new Date().toISOString(),
  accountId?: string,
): MailStore {
  return applyScreenerDecisionWithEffects(
    store,
    email,
    destination,
    senderName,
    nowIso,
    accountId,
  ).store
}
