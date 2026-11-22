import type { MailStore } from '../types'

/**
 * Phase M3 bulk unsubscribe: RFC 2369 List-Unsubscribe + RFC 8058 One-Click
 * parsing with a body-link heuristic fallback, grouped per sender across the
 * inbox.
 */

export interface UnsubscribeTargets {
  mailto?: string
  https?: string
  /** RFC 8058 List-Unsubscribe-Post header when present. */
  listUnsubscribePost?: string
  /** True when both a header HTTPS target and `List-Unsubscribe=One-Click` are present. */
  oneClick?: boolean
}

const ONE_CLICK_POST_PATTERN = /\bList-Unsubscribe\s*=\s*One-Click\b/i
const ONE_CLICK_TIMEOUT_MS = 10_000

const BLOCKED_PRIVATE_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.lan',
  '.home.arpa',
  '.localdomain',
  '.corp',
  '.intranet',
] as const

function isIpLiteralHost(host: string): boolean {
  if (!host) return true
  if (host.startsWith('[') || host.endsWith(']') || host.includes(':')) {
    return true
  }
  // Reject all numeric/IPv4 literal encodings (dotted decimal, octal, hex, single integer)
  if (/^[0-9.]+$/.test(host)) return true
  if (/^0x[0-9a-f]+$/i.test(host)) return true
  const labels = host.split('.')
  if (
    labels.length > 0 &&
    labels.every(
      label =>
        /^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(label),
    )
  ) {
    return true
  }
  return false
}

function isSafePublicHttpsUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (parsed.port && parsed.port !== '443') return false

  const host = parsed.hostname.trim().toLowerCase().replace(/\.+$/, '')
  if (!host || !host.includes('.')) return false
  if (host === 'localhost') return false
  if (BLOCKED_PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix))) {
    return false
  }
  if (isIpLiteralHost(host)) return false
  return true
}

/**
 * Parse an RFC 2369 List-Unsubscribe header: comma-separated `<url>`
 * entries, each mailto: or https:. Malformed entries are skipped; the
 * first usable URL of each kind wins. When an RFC 8058
 * `List-Unsubscribe-Post` header is also provided, sets `oneClick`.
 */
export function parseListUnsubscribe(
  value: string | undefined,
  listUnsubscribePost?: string,
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
  if (listUnsubscribePost?.trim()) {
    targets.listUnsubscribePost = listUnsubscribePost.trim()
    if (
      targets.https &&
      ONE_CLICK_POST_PATTERN.test(targets.listUnsubscribePost)
    ) {
      targets.oneClick = true
    }
  }
  return targets
}

/** True when a target supports RFC 8058 One-Click HTTPS POST unsubscribe. */
export function supportsOneClickUnsubscribe(
  target: UnsubscribeTargets | null | undefined,
): boolean {
  if (!target?.https) return false
  if (!isSafePublicHttpsUrl(target.https)) return false
  return (
    target.oneClick === true ||
    ONE_CLICK_POST_PATTERN.test(target.listUnsubscribePost ?? '')
  )
}

/**
 * Execute an RFC 8058 One-Click Unsubscribe POST against a verified public
 * HTTPS endpoint with `Content-Type: application/x-www-form-urlencoded` and
 * body `List-Unsubscribe=One-Click`.
 */
export async function executeOneClickUnsubscribe(
  target: UnsubscribeTargets,
  fetchFn: typeof fetch = fetch,
  timeoutMs = ONE_CLICK_TIMEOUT_MS,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!target.https || !isSafePublicHttpsUrl(target.https)) {
    return {
      ok: false,
      error: 'One-click unsubscribe requires a public HTTPS URL.',
    }
  }
  if (!supportsOneClickUnsubscribe(target)) {
    return {
      ok: false,
      error: 'Sender does not advertise RFC 8058 one-click unsubscribe.',
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(target.https, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Request failed.',
    }
  } finally {
    clearTimeout(timer)
  }
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
  const bySender = new Map<
    string,
    {
      candidate: UnsubscribeCandidate
      hasHeaderHttps: boolean
    }
  >()
  for (const message of store.messages) {
    if (!threadIds.has(message.threadId)) continue
    const headerTargets = parseListUnsubscribe(
      message.listUnsubscribe,
      message.listUnsubscribePost,
    )
    const bodyLink =
      !headerTargets.mailto && !headerTargets.https
        ? unsubscribeLinkFromBody(message.body, message.bodyHtml)
        : null
    if (!headerTargets.mailto && !headerTargets.https && !bodyLink) continue
    const senderEmail = message.from.email.trim().toLowerCase()
    if (!senderEmail) continue

    // Strictly per-message RFC 8058 evaluation: NEVER promote a heuristic bodyLink.
    const msgOneClick = Boolean(
      headerTargets.https && headerTargets.oneClick === true,
    )

    const existing = bySender.get(senderEmail)
    if (existing) {
      const prev = existing.candidate
      let https = prev.targets.https
      let listUnsubscribePost = prev.targets.listUnsubscribePost
      let oneClick = prev.targets.oneClick === true
      let hasHeaderHttps = existing.hasHeaderHttps

      if (headerTargets.https) {
        if (!hasHeaderHttps || (!oneClick && msgOneClick)) {
          https = headerTargets.https
          hasHeaderHttps = true
          if (msgOneClick) {
            oneClick = true
            listUnsubscribePost = headerTargets.listUnsubscribePost
          }
        }
      } else if (!https && bodyLink) {
        https = bodyLink
      }

      const targets: UnsubscribeTargets = {
        ...(prev.targets.mailto ?? headerTargets.mailto
          ? { mailto: prev.targets.mailto ?? headerTargets.mailto }
          : {}),
        ...(https ? { https } : {}),
        ...(oneClick && listUnsubscribePost ? { listUnsubscribePost } : {}),
        ...(oneClick ? { oneClick: true } : {}),
      }
      prev.targets = targets
      prev.heuristicOnly =
        prev.heuristicOnly && !headerTargets.mailto && !headerTargets.https
      prev.messageCount += 1
      if (!prev.threadIds.includes(message.threadId)) {
        prev.threadIds.push(message.threadId)
      }
      existing.hasHeaderHttps = hasHeaderHttps
    } else {
      const https = headerTargets.https ?? bodyLink ?? undefined
      const targets: UnsubscribeTargets = {
        ...(headerTargets.mailto ? { mailto: headerTargets.mailto } : {}),
        ...(https ? { https } : {}),
        ...(msgOneClick && headerTargets.listUnsubscribePost
          ? { listUnsubscribePost: headerTargets.listUnsubscribePost }
          : {}),
        ...(msgOneClick ? { oneClick: true } : {}),
      }
      bySender.set(senderEmail, {
        hasHeaderHttps: Boolean(headerTargets.https),
        candidate: {
          senderEmail,
          senderName: message.from.name || message.from.email,
          threadIds: [message.threadId],
          messageCount: 1,
          targets,
          heuristicOnly: !headerTargets.mailto && !headerTargets.https,
        },
      })
    }
  }
  return [...bySender.values()]
    .map(entry => entry.candidate)
    .sort((a, b) => {
      if (a.heuristicOnly !== b.heuristicOnly) return a.heuristicOnly ? 1 : -1
      return b.messageCount - a.messageCount
    })
}
