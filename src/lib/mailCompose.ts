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

/** Split a recipient list on `,`, `;`, or newlines outside `"..."` quotes and `<...>` brackets. */
export function splitRecipientTokens(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  let inAngle = false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!
    if (inQuotes) {
      current += ch
      if (ch === '\\' && i + 1 < value.length) {
        current += value[i + 1]!
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      }
      continue
    }
    if (ch === '"' && !inAngle) {
      inQuotes = true
      current += ch
      continue
    }
    if (ch === '<') {
      inAngle = true
      current += ch
      continue
    }
    if (ch === '>') {
      inAngle = false
      current += ch
      continue
    }
    if (!inAngle && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r')) {
      const trimmed = current.trim()
      if (trimmed) tokens.push(trimmed)
      current = ''
      continue
    }
    current += ch
  }
  const trimmed = current.trim()
  if (trimmed) tokens.push(trimmed)
  return tokens
}

/** Serialize one contact token, quoting display names that contain delimiters. */
export function formatRecipientToken(name: string, email: string): string {
  const cleanEmail = email.trim()
  const cleanName = name.trim()
  if (!cleanName || cleanName === cleanEmail) return cleanEmail
  const safeName = /[,;"<>\\]/.test(cleanName)
    ? `"${cleanName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : cleanName
  return `${safeName} <${cleanEmail}>`
}

/**
 * Parse a comma/semicolon/newline separated recipient input into contacts,
 * supporting quoted `"Doe, Jane" <email>`, `Name <email>`, and bare `email`.
 * Invalid tokens are kept (with the raw text as email) so the UI can mark
 * them clearly instead of silently dropping them.
 */
export function parseRecipientInput(value: string): MailContact[] {
  return splitRecipientTokens(value).map(token => {
    const bracketed = token.match(
      /^\s*(?:"((?:\\.|[^"\\])*)"|([^<>]*?))\s*<([^<>]*)>\s*$/,
    )
    if (bracketed) {
      const rawName =
        bracketed[1] !== undefined
          ? bracketed[1].replace(/\\(.)/g, '$1').trim()
          : (bracketed[2]?.trim() ?? '')
      const email = bracketed[3]?.trim() ?? ''
      return { name: rawName || email, email }
    }
    return { name: token, email: token }
  })
}

/**
 * Find normalized email addresses repeated across To, Cc, and Bcc fields (or
 * repeated within the same field) so the composer can warn before sending
 * without silently removing or moving recipients.
 */
export function duplicateRecipientsAcrossFields(fields: {
  to: MailContact[]
  cc?: MailContact[]
  bcc?: MailContact[]
}): Array<{ email: string; fields: Array<'To' | 'Cc' | 'Bcc'> }> {
  const map = new Map<string, { email: string; fields: Array<'To' | 'Cc' | 'Bcc'> }>()
  const record = (label: 'To' | 'Cc' | 'Bcc', list: MailContact[] | undefined) => {
    for (const contact of list ?? []) {
      const email = contact.email.trim()
      if (!isValidEmailAddress(email)) continue
      const key = email.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.fields.push(label)
      } else {
        map.set(key, { email, fields: [label] })
      }
    }
  }
  record('To', fields.to)
  record('Cc', fields.cc)
  record('Bcc', fields.bcc)
  return [...map.values()].filter(entry => entry.fields.length > 1)
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
 * True when the user's own text (excluding quoted reply/forward history)
 * talks about an attachment. Used by the send flow to ask a quiet
 * "no attachments yet — send anyway?" before the message goes out without one.
 */
export function bodyMentionsAttachment(body: string): boolean {
  const lines = body.split(/\r?\n/)
  const freshLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (
      /^On .+ wrote:\s*$/i.test(trimmed) ||
      /^-{3,}\s*Forwarded message\s*-{3,}$/i.test(trimmed) ||
      /^-{3,}\s*Original Message\s*-{3,}$/i.test(trimmed)
    ) {
      break
    }
    if (trimmed.startsWith('>')) continue
    freshLines.push(line)
  }
  const text = freshLines.join('\n').trim()
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
 * Plain text → composer HTML: one block with explicit line breaks,
 * including empty lines. Paragraph elements introduce extra rendered breaks in
 * Chromium, so reading innerText back would inflate a draft merely by
 * opening it. Signatures and old plain-text drafts keep their line spacing.
 */
export function plainTextToComposeHtml(text: string): string {
  return `<div>${escapeComposeHtml(text.replace(/\r\n/g, '\n')).replace(/\n/g, '<br>')}</div>`
}
