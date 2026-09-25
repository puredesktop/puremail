import type {
  MailContact,
  MailSettings,
  MailSignature,
  MailStore,
} from '../types'

/**
 * Phase M2 compose-stack domain logic: recipient validation and
 * autocomplete, attachment reminders, and multi-signature handling. Pure
 * functions only — the composer UI stays thin.
 */

/**
 * RFC 5322-ish address check, deliberately stricter than the grammar:
 * one @, a non-empty local part without spaces, and a dotted domain with a
 * 2+ letter TLD. Good addresses pass; typos ("a@b", "x@y,com") fail loudly.
 */
export function isValidEmailAddress(email: string): boolean {
  const trimmed = email.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[a-zA-Z]{2,}$/.test(trimmed)
}

/**
 * Parse a comma/semicolon separated recipient input into contacts,
 * supporting both `Name <email>` and bare `email` tokens. Invalid tokens
 * are kept (with the raw text as email) so the UI can mark them clearly
 * instead of silently dropping them.
 */
export function parseRecipientInput(value: string): MailContact[] {
  return value
    .split(/[,;]/)
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => {
      const bracketed = token.match(/^(.*?)[\s]*<([^<>]*)>$/)
      if (bracketed) {
        const name = bracketed[1]?.trim().replace(/^"|"$/g, '') ?? ''
        const email = bracketed[2]?.trim() ?? ''
        return { name: name || email, email }
      }
      return { name: token, email: token }
    })
}

/** Recipients from an input string whose addresses fail validation. */
export function invalidRecipientsInInput(value: string): MailContact[] {
  return parseRecipientInput(value).filter(
    contact => !isValidEmailAddress(contact.email),
  )
}

export interface RankedCorrespondent {
  contact: MailContact
  /** Higher ranks first: frequency with a recency boost. */
  score: number
}

/**
 * Autocomplete source: prior correspondents for an account, ranked by how
 * often they appear on messages (from/to/cc) with a boost for recent
 * contact. The account owner is excluded.
 */
export function rankedCorrespondents(
  store: Pick<MailStore, 'messages' | 'threads' | 'accounts'>,
  accountId: string,
  query = '',
  limit = 6,
  now = new Date(),
): MailContact[] {
  const account = store.accounts.find(item => item.id === accountId)
  const ownEmail = account?.email.trim().toLowerCase() ?? ''
  const accountThreadIds = new Set(
    store.threads
      .filter(thread => thread.accountId === accountId)
      .map(thread => thread.id),
  )
  const byEmail = new Map<
    string,
    { contact: MailContact; score: number }
  >()
  const nowMs = now.getTime()
  for (const message of store.messages) {
    if (!accountThreadIds.has(message.threadId)) continue
    const ageDays =
      (nowMs - new Date(message.receivedAt).getTime()) / 86_400_000
    // A contact seen today is worth ~3 appearances from three months ago.
    const recencyBoost = ageDays <= 7 ? 2 : ageDays <= 30 ? 1 : 0
    for (const contact of [
      message.from,
      ...message.to,
      ...(message.cc ?? []),
    ]) {
      const email = contact.email.trim().toLowerCase()
      if (!email || email === ownEmail || !isValidEmailAddress(email)) continue
      const existing = byEmail.get(email)
      const increment = 1 + recencyBoost
      if (existing) {
        existing.score += increment
        // Prefer the variant that carries a display name.
        if (!existing.contact.name || existing.contact.name === email) {
          existing.contact = contact
        }
      } else {
        byEmail.set(email, { contact, score: increment })
      }
    }
  }
  const normalizedQuery = query.trim().toLowerCase()
  return [...byEmail.values()]
    .filter(({ contact }) => {
      if (!normalizedQuery) return true
      return (
        contact.email.toLowerCase().includes(normalizedQuery) ||
        contact.name.toLowerCase().includes(normalizedQuery)
      )
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ contact }) => contact)
}

const ATTACHMENT_MENTION_PATTERNS = [
  /\battach(?:ed|ment|ments|ing)\b/i,
  /\bI(?:'ve| have) attached\b/i,
  /\benclosed\b/i,
  /\bsee the (?:pdf|document|doc|file|spreadsheet|deck|slides|image)\b/i,
  /\bfind the (?:pdf|document|doc|file|spreadsheet|deck|slides|image)\b/i,
]

/**
 * True when the body talks about an attachment. Used by the send flow to
 * ask a quiet "no attachments yet — send anyway?" before the message goes
 * out without one.
 */
export function bodyMentionsAttachment(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  return ATTACHMENT_MENTION_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Signatures for an account: account-scoped first, then shared ones. When
 * no named signatures exist, the legacy `settings.signature` string acts
 * as a single implicit signature so nothing breaks for existing users.
 */
export function signaturesForAccount(
  settings: Pick<MailSettings, 'signature' | 'signatures'>,
  accountId?: string,
): MailSignature[] {
  const named = (settings.signatures ?? []).filter(
    signature => !signature.accountId || signature.accountId === accountId,
  )
  if (named.length > 0) {
    return [...named].sort((a, b) => {
      if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
        return a.isDefault ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }
  const legacy = settings.signature?.replace(/\\n/g, '\n').trim()
  if (!legacy) return []
  return [
    {
      id: 'signature_legacy',
      name: 'Signature',
      body: legacy,
      isDefault: true,
    },
  ]
}

export function defaultSignatureForAccount(
  settings: Pick<MailSettings, 'signature' | 'signatures'>,
  accountId?: string,
): MailSignature | null {
  const signatures = signaturesForAccount(settings, accountId)
  return signatures.find(signature => signature.isDefault) ?? signatures[0] ?? null
}

/** Upsert a named signature; the first signature ever added becomes default. */
export function upsertSignature(
  settings: MailSettings,
  signature: MailSignature,
): MailSettings {
  const existing = settings.signatures ?? []
  const replaced = existing.some(item => item.id === signature.id)
  let next = replaced
    ? existing.map(item => (item.id === signature.id ? signature : item))
    : [...existing, { ...signature, isDefault: signature.isDefault ?? existing.length === 0 }]
  if (signature.isDefault) {
    next = next.map(item =>
      item.id === signature.id ? item : { ...item, isDefault: false },
    )
  }
  return { ...settings, signatures: next }
}

export function removeSignature(
  settings: MailSettings,
  signatureId: string,
): MailSettings {
  const next = (settings.signatures ?? []).filter(
    item => item.id !== signatureId,
  )
  // Keep exactly one default when any signatures remain.
  if (next.length > 0 && !next.some(item => item.isDefault)) {
    next[0] = { ...next[0]!, isDefault: true }
  }
  return { ...settings, signatures: next }
}

/** Escape text for safe HTML interpolation. */
export function escapeComposeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Plain text → composer HTML: one paragraph per line, empty lines kept as
 * empty paragraphs. Used to seed the rich composer (signatures, drafts
 * written before the rich composer existed).
 */
export function plainTextToComposeHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line =>
      line.trim() ? `<p>${escapeComposeHtml(line)}</p>` : '<p><br></p>',
    )
    .join('')
}
