/**
 * Pure derivations behind "replies open the docked compose window".
 *
 * The docked compose window (composeWindowMode.ts) is the ONE composer
 * surface; opening a reply, reply-all or forward seeds its fields from the
 * thread being answered. Everything that can be derived without the DOM
 * lives here so the addressing rules — who a reply goes to, what happens to
 * the subject prefix, what the quoted history contains — are testable
 * without mounting the shell.
 */

import type {
  Attachment,
  Draft,
  MailContact,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'
import { escapeComposeHtml } from './mailCompose'
import { cleanMailMessageText } from './mailTextUtils'

export type ReplyComposeKind = 'reply' | 'replyAll' | 'forward'

/**
 * What the open compose window is FOR, when it is not a brand-new message.
 * Owned by the shell next to the other compose state; ComposeEditor branches
 * on it only where a reply differs from a compose (context strip, threaded
 * send path).
 *
 * kind 'draft' is the degenerate context: the window is editing an existing
 * standalone draft (opened from the Drafts mailbox) that answers nothing —
 * no context strip, but send still goes through the draft's own thread.
 */
export interface ComposeReplyContext {
  threadId: string
  /** The message being answered; null for a draft with no source message. */
  messageId: string | null
  kind: ReplyComposeKind | 'draft'
  /** The store draft the window is editing, when one already exists. */
  draftId: string | null
}

export interface ComposeQuoteState {
  html: string
  text: string
  count: number
}

export interface ReplyComposeFields {
  to: string
  cc: string
  subject: string
  quote: ComposeQuoteState | null
}

const SUBJECT_PREFIX = /^\s*(re|fwd?|aw|sv)\s*:\s*/i

/** The subject with every leading Re:/Fwd:-style prefix removed. */
export function baseSubject(subject: string): string {
  let value = subject.trim()
  while (SUBJECT_PREFIX.test(value)) {
    value = value.replace(SUBJECT_PREFIX, '')
  }
  return value
}

/**
 * Prefix a subject for a reply or forward. Idempotent: applying it twice, or
 * to a subject that already carries the right prefix (in any case), never
 * stacks "Re: Re:". Switching kind swaps the prefix — "Re: Budget" forwarded
 * becomes "Fwd: Budget", not "Fwd: Re: Budget".
 */
export function replyComposeSubject(
  subject: string,
  kind: ReplyComposeKind,
): string {
  const base = baseSubject(subject)
  const prefix = kind === 'forward' ? 'Fwd: ' : 'Re: '
  return `${prefix}${base}`
}

const contactKey = (contact: MailContact): string =>
  contact.email.trim().toLowerCase()

const identitySet = (ownerEmails: string[]): Set<string> =>
  new Set(ownerEmails.map(email => email.trim().toLowerCase()).filter(Boolean))

/** Render contacts the way the compose To field parses them back. */
export function contactsToComposeInput(contacts: MailContact[]): string {
  return contacts
    .map(contact =>
      contact.name && contact.name !== contact.email
        ? `${contact.name} <${contact.email}>`
        : contact.email,
    )
    .join(', ')
}

/**
 * Who a plain reply addresses: the sender's Reply-To when the message
 * carries one, otherwise the sender — and for a message the user sent
 * themself, its original recipients (never a self-addressed draft).
 */
export function replyToContacts(
  message: MailMessage,
  ownerEmails: string[],
): MailContact[] {
  if (message.replyTo && message.replyTo.length > 0) return message.replyTo
  const own = identitySet(ownerEmails)
  if (own.has(contactKey(message.from))) {
    return message.to.filter(contact => !own.has(contactKey(contact)))
  }
  return [message.from]
}

/**
 * Reply-all: the reply targets in To, everyone else on the message (To +
 * Cc) in Cc — minus every identity the user owns, minus anyone already in
 * To, each address once.
 */
export function replyAllContacts(
  message: MailMessage,
  ownerEmails: string[],
): { to: MailContact[]; cc: MailContact[] } {
  const to = replyToContacts(message, ownerEmails)
  const seen = identitySet(ownerEmails)
  for (const contact of to) seen.add(contactKey(contact))
  // The sender never lands in Cc even when Reply-To redirected the To.
  seen.add(contactKey(message.from))
  const cc: MailContact[] = []
  for (const contact of [...message.to, ...(message.cc ?? [])]) {
    const key = contactKey(contact)
    if (!key || seen.has(key)) continue
    seen.add(key)
    cc.push(contact)
  }
  return { to, cc }
}

function quoteAttribution(message: MailMessage): string {
  const when = new Date(message.receivedAt)
  const stamp = Number.isNaN(when.getTime())
    ? message.receivedAt
    : when.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
  return `On ${stamp}, ${message.from.name || message.from.email} wrote:`
}

function forwardHeader(message: MailMessage): string[] {
  const to = message.to
    .map(contact => contact.name || contact.email)
    .filter(Boolean)
    .join(', ')
  return [
    '---------- Forwarded message ---------',
    `From: ${message.from.name || message.from.email} <${message.from.email}>`,
    `Date: ${message.receivedAt}`,
    `Subject: ${message.subject}`,
    `To: ${to || 'Undisclosed recipients'}`,
  ]
}

function quoteBodyText(message: MailMessage): string {
  return cleanMailMessageText(message).text || message.body
}

function linesToQuoteHtml(lines: string[]): string {
  return lines
    .map(line =>
      line.trim() ? `<p>${escapeComposeHtml(line)}</p>` : '<p><br></p>',
    )
    .join('')
}

/**
 * The quoted history for a reply (newest first, mail convention) or the
 * forwarded messages for a forward (oldest first, so the conversation reads
 * downward). Returns both renderings: text is what draft.body and text-only
 * clients carry; html is what the expand chip injects into the editor —
 * ALWAYS passed through sanitizeMailHtml before touching the editable DOM.
 */
export function buildQuotedHistory(
  messages: MailMessage[],
  kind: ReplyComposeKind,
): ComposeQuoteState | null {
  const real = messages.filter(message => !message.isDraft)
  if (real.length === 0) return null
  const ordered = [...real].sort((a, b) =>
    kind === 'forward'
      ? a.receivedAt.localeCompare(b.receivedAt)
      : b.receivedAt.localeCompare(a.receivedAt),
  )
  const textBlocks: string[] = []
  const htmlBlocks: string[] = []
  for (const message of ordered) {
    const body = quoteBodyText(message)
    if (kind === 'forward') {
      const header = forwardHeader(message)
      textBlocks.push(`${header.join('\n')}\n\n${body}`)
      htmlBlocks.push(
        `<div>${linesToQuoteHtml(header)}</div><blockquote>${linesToQuoteHtml(
          body.split('\n'),
        )}</blockquote>`,
      )
      continue
    }
    const attribution = quoteAttribution(message)
    textBlocks.push(`${attribution}\n${body}`)
    htmlBlocks.push(
      `<div><p>${escapeComposeHtml(attribution)}</p><blockquote>${linesToQuoteHtml(
        body.split('\n'),
      )}</blockquote></div>`,
    )
  }
  return {
    text: textBlocks.join('\n\n'),
    html: htmlBlocks.join('<p><br></p>'),
    count: ordered.length,
  }
}

/**
 * Everything the compose window needs to open as a reply/reply-all/forward
 * of `message` on `thread`. Switching kind in the context strip calls this
 * again — recipients and subject are RE-DERIVED for the new kind; the body
 * (the user's words) is never touched by a switch.
 */
export function deriveReplyComposeFields(
  thread: MailThread,
  messages: MailMessage[],
  message: MailMessage | null,
  kind: ReplyComposeKind,
  ownerEmails: string[],
): ReplyComposeFields {
  const subject = replyComposeSubject(thread.subject, kind)
  const quote = buildQuotedHistory(messages, kind)
  // A forward starts unaddressed — recipients are the user's call.
  if (kind === 'forward') return { to: '', cc: '', subject, quote }
  if (!message) {
    // A reply with no message to answer (a participants-only thread)
    // targets the other participants.
    const own = identitySet(ownerEmails)
    const to = thread.participants.filter(
      contact => !own.has(contactKey(contact)),
    )
    return { to: contactsToComposeInput(to), cc: '', subject, quote }
  }
  if (kind === 'replyAll') {
    const recipients = replyAllContacts(message, ownerEmails)
    return {
      to: contactsToComposeInput(recipients.to),
      cc: contactsToComposeInput(recipients.cc),
      subject,
      quote,
    }
  }
  return {
    to: contactsToComposeInput(replyToContacts(message, ownerEmails)),
    cc: '',
    subject,
    quote,
  }
}

/**
 * The compose body with the still-collapsed quoted history appended — what
 * actually goes on the wire. The chip collapsing the quote is a reading
 * convenience, never an omission: a collapsed quote is still sent.
 */
export function bodyWithQuote(
  body: string,
  quote: ComposeQuoteState | null,
): string {
  if (!quote) return body
  const lead = body.trimEnd()
  return lead ? `${lead}\n\n${quote.text}` : quote.text
}

export function bodyHtmlWithQuote(
  bodyHtml: string,
  quote: ComposeQuoteState | null,
): string {
  if (!quote) return bodyHtml
  return bodyHtml ? `${bodyHtml}<p><br></p>${quote.html}` : quote.html
}

export interface ReplyDraftInput {
  context: ComposeReplyContext
  to: MailContact[]
  cc: MailContact[]
  bcc: MailContact[]
  subject: string
  /** Full plain body — quote already appended when it was collapsed. */
  body: string
  /** Full sanitized html body, '' when the compose was plain text. */
  bodyHtml: string
  attachments: Attachment[]
  now?: string
  /** Pre-minted id for a NEW draft — never minted inside a state updater. */
  newDraftId?: string
}

/**
 * Write the compose window's reply state into the store as a draft on the
 * answered thread: updates the draft the window was opened on, or files a
 * new `draft_reply_*`/`draft_forward_*` draft. The one draft path both the
 * close-saves rule and the threaded send build on.
 */
export function upsertReplyDraft(
  store: MailStore,
  input: ReplyDraftInput,
): { store: MailStore; draftId: string } {
  const now = input.now ?? new Date().toISOString()
  const subject = input.subject.trim() || '(no subject)'
  const existing = input.context.draftId
    ? store.drafts.find(draft => draft.id === input.context.draftId)
    : undefined
  if (existing) {
    // Rebuilt field by field, not spread-patched: a body that went back to
    // plain text must DROP the stale bodyHtml key, and a spread cannot
    // delete a key.
    const { bodyHtml: _staleHtml, ...kept } = existing
    const updated: Draft = {
      ...kept,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject,
      body: input.body,
      ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
      attachments: input.attachments,
      updatedAt: now,
      syncState: 'pending',
    }
    return {
      draftId: existing.id,
      store: {
        ...store,
        drafts: store.drafts.map(draft =>
          draft.id === existing.id ? updated : draft,
        ),
      },
    }
  }
  const stamp = now.replace(/[^0-9]/g, '')
  const prefix =
    input.context.kind === 'forward' ? 'draft_forward' : 'draft_reply'
  const draftId =
    input.newDraftId ?? `${prefix}_${input.context.threadId}_${stamp}`
  const draft: Draft = {
    id: draftId,
    threadId: input.context.threadId,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject,
    body: input.body,
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    attachments: input.attachments,
    updatedAt: now,
    syncState: 'pending',
    source: 'manual',
    draftKind: 'manual',
    ...(input.context.messageId
      ? { sourceMessageId: input.context.messageId }
      : {}),
    provenance: [
      input.context.kind === 'forward'
        ? 'Created as a forward draft in the compose window.'
        : 'Created as a reply draft in the compose window.',
    ],
  }
  return {
    draftId,
    store: { ...store, drafts: [...store.drafts, draft] },
  }
}

/**
 * The window kind an existing store draft opens under. A draft on a thread
 * that has real inbound mail IS a reply to that mail whatever its id shape
 * (agent-generated and provider-synced drafts carry neither the prefix nor
 * a sourceMessageId); only a draft alone on its own thread — a stashed or
 * re-homed compose — opens as a bare 'draft' with no reply context strip.
 */
export function draftComposeKind(
  draft: Draft,
  threadHasMessages: boolean,
): ReplyComposeKind | 'draft' {
  if (draft.id.startsWith('draft_forward')) return 'forward'
  if (draft.id.startsWith('draft_reply') || draft.sourceMessageId) {
    return 'reply'
  }
  return threadHasMessages ? 'reply' : 'draft'
}

/**
 * The short line the reader-foot launcher shows for a draft in progress.
 * One line, trimmed — the launcher is a strip, not a preview pane.
 */
export function draftLaunchPreview(body: string, limit = 110): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit - 1).trimEnd()}…`
}
