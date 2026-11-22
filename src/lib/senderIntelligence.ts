import type {
  MailAuthResults,
  MailStore,
  MailThread,
  ScreenerDestination,
} from '../types'

export interface SenderRecentThread {
  threadId: string
  subject: string
  lastMessageAt: string
  status: MailThread['status']
  unread: boolean
  snippet: string
}

export interface SenderSharedAttachment {
  id: string
  name: string
  mimeType: string
  sizeLabel: string
  size?: number
  messageId: string
  threadId: string
  receivedAt: string
}

export interface SenderProfile {
  name: string
  email: string
  domain: string
  receivedCount: number
  sentCount: number
  firstContactAt: string | null
  lastContactAt: string | null
  isVip: boolean
  screenerDestination: ScreenerDestination | null
  latestAuth: MailAuthResults | null
  recentThreads: SenderRecentThread[]
  sharedAttachments: SenderSharedAttachment[]
}

const MAX_RECENT_THREADS = 15
const MAX_SHARED_ATTACHMENTS = 20

function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function compareIsoDesc(a: string, b: string): number {
  const am = Date.parse(a)
  const bm = Date.parse(b)
  if (Number.isFinite(am) && Number.isFinite(bm)) return bm - am
  return b.localeCompare(a)
}

function isEarlierIso(candidate: string, current: string): boolean {
  const cm = Date.parse(candidate)
  const curm = Date.parse(current)
  if (Number.isFinite(cm) && Number.isFinite(curm)) return cm < curm
  return candidate < current
}

function isLaterIso(candidate: string, current: string): boolean {
  const cm = Date.parse(candidate)
  const curm = Date.parse(current)
  if (Number.isFinite(cm) && Number.isFinite(curm)) return cm > curm
  return candidate > current
}

export function buildSenderProfile(
  store: MailStore,
  email: string,
  accountEmail?: string,
  accountId?: string,
): SenderProfile {
  const target = normalizeEmail(email)
  const ownEmails = new Set<string>(
    [
      accountEmail,
      ...store.accounts.map(a => a.email),
      ...(store.settings.ownerIdentities?.emails ?? []),
    ]
      .map(normalizeEmail)
      .filter(Boolean),
  )
  const targetIsSelf = Boolean(target && ownEmails.has(target))

  const domain = target.includes('@') ? target.split('@')[1] ?? '' : ''
  const vipSet = new Set((store.vipSenders ?? []).map(normalizeEmail))
  const decision =
    target &&
    store.screenerDecisions &&
    Object.prototype.hasOwnProperty.call(store.screenerDecisions, target)
      ? store.screenerDecisions[target]
      : undefined

  const trashIds = new Set(
    store.mailboxes.filter(m => m.role === 'trash').map(m => m.id),
  )
  const visibleThreadIds = new Set(
    store.threads
      .filter(
        thread =>
          (!accountId || thread.accountId === accountId) &&
          !trashIds.has(thread.mailboxId),
      )
      .map(thread => thread.id),
  )

  let displayName = decision?.senderName?.trim() || ''
  let receivedCount = 0
  let sentCount = 0
  let firstContactAt: string | null = null
  let lastContactAt: string | null = null
  let latestAuth: MailAuthResults | null = null
  let latestAuthAt = ''

  const relatedThreadIds = new Set<string>()
  const unreadThreadIds = new Set<string>()
  const sharedAttachments: SenderSharedAttachment[] = []

  const sortedMessages = [...store.messages]
    .filter(
      message =>
        !message.isDraft &&
        (visibleThreadIds.size === 0 || visibleThreadIds.has(message.threadId)),
    )
    .sort((a, b) => compareIsoDesc(a.receivedAt, b.receivedAt))

  for (const message of sortedMessages) {
    if (!message.read) unreadThreadIds.add(message.threadId)

    const fromEmail = normalizeEmail(message.from.email)
    const recipients = [
      ...message.to,
      ...(message.cc ?? []),
      ...(message.bcc ?? []),
    ]
    const recipientEmails = recipients.map(c => normalizeEmail(c.email))
    const isFromTarget = fromEmail === target
    const isToTarget = recipientEmails.includes(target)
    const isFromOwn =
      ownEmails.has(fromEmail) ||
      Boolean(message.sentCopyPresent) ||
      Boolean(message.deliveryAccepted)

    const isDirectExchange = targetIsSelf
      ? isFromTarget || isToTarget
      : isFromTarget || (isToTarget && isFromOwn)

    if (!isDirectExchange) continue

    relatedThreadIds.add(message.threadId)

    if (isFromTarget && !targetIsSelf) {
      receivedCount += 1
      if (!displayName && message.from.name.trim()) {
        displayName = message.from.name.trim()
      }
      if (
        message.authResults &&
        (!latestAuthAt || !isEarlierIso(message.receivedAt, latestAuthAt))
      ) {
        latestAuth = message.authResults
        latestAuthAt = message.receivedAt
      }
    } else if (isFromTarget && targetIsSelf) {
      sentCount += 1
      if (!displayName && message.from.name.trim()) {
        displayName = message.from.name.trim()
      }
    } else if (isToTarget && isFromOwn) {
      sentCount += 1
      if (!displayName) {
        const matched = recipients.find(c => normalizeEmail(c.email) === target)
        if (matched?.name.trim()) displayName = matched.name.trim()
      }
    } else if (isToTarget && targetIsSelf) {
      receivedCount += 1
    }

    if (!firstContactAt || isEarlierIso(message.receivedAt, firstContactAt)) {
      firstContactAt = message.receivedAt
    }
    if (!lastContactAt || isLaterIso(message.receivedAt, lastContactAt)) {
      lastContactAt = message.receivedAt
    }

    for (const attachment of message.attachments ?? []) {
      sharedAttachments.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeLabel: attachment.sizeLabel,
        ...(attachment.size !== undefined ? { size: attachment.size } : {}),
        messageId: message.id,
        threadId: message.threadId,
        receivedAt: message.receivedAt,
      })
    }
  }

  const recentThreads: SenderRecentThread[] = store.threads
    .filter(
      thread =>
        (!accountId || thread.accountId === accountId) &&
        !trashIds.has(thread.mailboxId) &&
        (relatedThreadIds.has(thread.id) ||
          thread.participants.some(p => normalizeEmail(p.email) === target)),
    )
    .sort((a, b) => compareIsoDesc(a.lastMessageAt, b.lastMessageAt))
    .slice(0, MAX_RECENT_THREADS)
    .map(thread => ({
      threadId: thread.id,
      subject: thread.subject,
      lastMessageAt: thread.lastMessageAt,
      status: thread.status,
      unread: unreadThreadIds.has(thread.id),
      snippet: thread.summary,
    }))

  if (!displayName) {
    for (const thread of store.threads) {
      if (accountId && thread.accountId !== accountId) continue
      const contact = thread.participants.find(
        p => normalizeEmail(p.email) === target,
      )
      if (contact?.name.trim()) {
        displayName = contact.name.trim()
        break
      }
    }
  }

  return {
    name: displayName || target,
    email: target,
    domain,
    receivedCount,
    sentCount,
    firstContactAt,
    lastContactAt,
    isVip: Boolean(target && vipSet.has(target)),
    screenerDestination: decision?.destination ?? null,
    latestAuth,
    recentThreads,
    sharedAttachments: sharedAttachments
      .sort((a, b) => compareIsoDesc(a.receivedAt, b.receivedAt))
      .slice(0, MAX_SHARED_ATTACHMENTS),
  }
}
