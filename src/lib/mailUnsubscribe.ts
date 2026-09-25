import type { MailStore } from '../types'

/**
 * Phase M3 bulk unsubscribe: RFC 2369 List-Unsubscribe parsing with a
 * body-link heuristic fallback, grouped per sender across the inbox.
 */

export interface UnsubscribeTargets {
  mailto?: string
  https?: string
}

/**
 * Parse an RFC 2369 List-Unsubscribe header: comma-separated `<url>`
 * entries, each mailto: or https:. Malformed entries are skipped; the
 * first usable URL of each kind wins.
 */
export function parseListUnsubscribe(
  value: string | undefined,
): UnsubscribeTargets {
  const targets: UnsubscribeTargets = {}
  if (!value) return targets
  const entries = [...value.matchAll(/<([^<>]+)>/g)].map(match =>
    (match[1] ?? '').trim(),
  )
  // Some senders omit the angle brackets entirely.
  if (entries.length === 0) {
    entries.push(...value.split(',').map(entry => entry.trim()))
  }
  for (const entry of entries) {
    if (!targets.mailto && /^mailto:/i.test(entry)) targets.mailto = entry
    if (!targets.https && /^https:\/\//i.test(entry)) targets.https = entry
  }
  return targets
}

const BODY_LINK_PATTERN =
  /href="(https:\/\/[^"]*(?:unsubscribe|opt[-_ ]?out|email-?preferences)[^"]*)"/i
const BODY_TEXT_PATTERN =
  /(https:\/\/\S*(?:unsubscribe|opt[-_]?out)\S*)/i

/** Heuristic fallback: an unsubscribe-looking https link in the body. */
export function unsubscribeLinkFromBody(
  body: string,
  bodyHtml?: string,
): string | null {
  const htmlMatch = bodyHtml?.match(BODY_LINK_PATTERN)
  if (htmlMatch?.[1]) return htmlMatch[1]
  const textMatch = body.match(BODY_TEXT_PATTERN)
  return textMatch?.[1] ?? null
}

export interface UnsubscribeCandidate {
  senderEmail: string
  senderName: string
  threadIds: string[]
  messageCount: number
  targets: UnsubscribeTargets
  /** True when only the body heuristic matched (no proper header). */
  heuristicOnly: boolean
}

/**
 * Group unsubscribe-capable senders across an account's inbox threads.
 * Senders with a List-Unsubscribe header rank before heuristic-only ones;
 * ties break on message volume (noisiest first).
 */
export function unsubscribeCandidatesForStore(
  store: MailStore,
  accountId: string,
): UnsubscribeCandidate[] {
  const inboxMailboxIds = new Set(
    store.mailboxes
      .filter(
        mailbox => mailbox.accountId === accountId && mailbox.role === 'inbox',
      )
      .map(mailbox => mailbox.id),
  )
  const inboxThreads = store.threads.filter(
    thread =>
      thread.accountId === accountId && inboxMailboxIds.has(thread.mailboxId),
  )
  const threadIds = new Set(inboxThreads.map(thread => thread.id))
  const bySender = new Map<string, UnsubscribeCandidate>()
  for (const message of store.messages) {
    if (!threadIds.has(message.threadId)) continue
    const headerTargets = parseListUnsubscribe(message.listUnsubscribe)
    const bodyLink =
      !headerTargets.mailto && !headerTargets.https
        ? unsubscribeLinkFromBody(message.body, message.bodyHtml)
        : null
    if (!headerTargets.mailto && !headerTargets.https && !bodyLink) continue
    const senderEmail = message.from.email.trim().toLowerCase()
    if (!senderEmail) continue
    const existing = bySender.get(senderEmail)
    const targets: UnsubscribeTargets = {
      mailto: existing?.targets.mailto ?? headerTargets.mailto,
      https:
        existing?.targets.https ?? headerTargets.https ?? bodyLink ?? undefined,
    }
    const heuristicOnly =
      (existing?.heuristicOnly ?? true) &&
      !headerTargets.mailto &&
      !headerTargets.https
    if (existing) {
      existing.targets = targets
      existing.heuristicOnly = heuristicOnly
      existing.messageCount += 1
      if (!existing.threadIds.includes(message.threadId)) {
        existing.threadIds.push(message.threadId)
      }
    } else {
      bySender.set(senderEmail, {
        senderEmail,
        senderName: message.from.name || message.from.email,
        threadIds: [message.threadId],
        messageCount: 1,
        targets,
        heuristicOnly,
      })
    }
  }
  return [...bySender.values()].sort((a, b) => {
    if (a.heuristicOnly !== b.heuristicOnly) return a.heuristicOnly ? 1 : -1
    return b.messageCount - a.messageCount
  })
}
