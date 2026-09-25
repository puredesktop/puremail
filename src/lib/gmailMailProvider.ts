import {
  withHttpRetry,
  type HttpRetryOptions,
} from '@purescience/platform-ui/net/httpRetry.js'
import {
  archiveThread as archiveThreadInStore,
  deleteThread as deleteThreadInStore,
  emptyMailStore,
  mailFetchWindowForStore,
  mailFetchWindowStartDate,
  labelThread as labelThreadInStore,
  markThreadRead as markThreadReadInStore,
  moveThread as moveThreadInStore,
  searchMailAndTasks,
  unarchiveThread as unarchiveThreadInStore,
} from './mailModel'
import { setThreadStarred as setThreadStarredInStore } from './mailTriage'
import { parseCalendarInvite } from './mailCalendarInvite'
import {
  attachmentContentToBase64,
  formatAttachmentBytes,
  GMAIL_ATTACHMENT_LIMIT_BYTES,
  totalAttachmentBytes,
} from './mailAttachments'
import { buildMimeMessage, type MimeAttachmentPart } from './mailMime'
import type {
  Attachment,
  Draft,
  ProviderDraftRef,
  ProviderLabelMetadata,
  MailContact,
  MailMessage,
  MailPriority,
  MailProvider,
  MailProviderCapabilities,
  MailSettings,
  MailStore,
  MailSyncCoverage,
  MailThread,
  SendDraftInput,
} from '../types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const GMAIL_ACCOUNT_ID = 'acct_gmail'
const GMAIL_INBOX_ID = 'gmail_inbox'
const GMAIL_SENT_ID = 'gmail_sent'
const GMAIL_ARCHIVE_ID = 'gmail_archive'
const GMAIL_TRASH_ID = 'gmail_trash'
const GMAIL_DRAFTS_ID = 'gmail_drafts'
const GMAIL_INBOX_PAGE_SIZE = 100
const GMAIL_INBOX_THREAD_LIMIT = 250

export interface GmailNetworkResponse {
  ok: boolean
  status: number
  /** Response headers when the transport provides them (`Retry-After`). */
  headers?: Record<string, string>
  body: string
}

export interface GmailMailProviderOptions {
  email?: string
  settings?: Partial<MailSettings>
  fetch: (request: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => Promise<GmailNetworkResponse>
  /**
   * Short-lived access-token supplier backed by the shell credential vault.
   * The shell refreshes transparently; the provider never sees refresh
   * tokens or the OAuth client secret.
   */
  accessToken: () => Promise<string>
  /**
   * Tuning/test seam for the shared retry policy (429/5xx backoff honoring
   * `Retry-After`, one retry after a 401). Tests inject `sleep` so backoff
   * does not wall-clock wait; production uses the defaults.
   */
  retryOptions?: HttpRetryOptions
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailMessagePart {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailMessagePart[]
}

interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  internalDate?: string
  payload?: GmailMessagePart & { headers?: GmailHeader[] }
  snippet?: string
}

interface GmailThread {
  id: string
  messages?: GmailMessage[]
}

function gmailPath(path: string): string {
  return `${GMAIL_API_BASE}${path}`
}

function header(message: GmailMessage, name: string): string {
  const match = (message.payload?.headers ?? []).find(
    candidate => candidate.name.toLowerCase() === name.toLowerCase(),
  )
  return match?.value ?? ''
}

export function parseMailContact(raw: string): MailContact {
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/)
  if (match) {
    const name = match[1]?.trim() ?? ''
    const email = match[2]?.trim() ?? ''
    return { name: name || email, email }
  }
  const email = raw.trim()
  return { name: email, email }
}

export function parseMailContactList(raw: string): MailContact[] {
  if (!raw.trim()) return []
  // Split on commas that are NOT inside quoted names or <addr> brackets —
  // '"Doe, John" <jd@provider.example>' is one contact, not two broken ones.
  const parts = raw.match(/(?:"[^"]*"|<[^>]*>|[^,])+/g) ?? []
  return parts
    .map(parseMailContact)
    .filter(contact => contact.email.length > 0)
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function normalizedBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4
  return padding ? `${normalized}${'='.repeat(4 - padding)}` : normalized
}

function gmailAttachmentContent(data: string, mimeType: string): string {
  if (
    mimeType.toLowerCase().startsWith('text/') ||
    mimeType.toLowerCase().includes('json') ||
    mimeType.toLowerCase().includes('xml')
  ) {
    return decodeBase64Url(data)
  }
  return `data:${
    mimeType || 'application/octet-stream'
  };base64,${normalizedBase64Url(data)}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function findBodyPart(
  part: GmailMessagePart | undefined,
  mimeType: string,
): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }
  for (const child of part.parts ?? []) {
    const found = findBodyPart(child, mimeType)
    if (found !== null) return found
  }
  return null
}

function messageHtml(message: GmailMessage): string | undefined {
  const html = findBodyPart(message.payload, 'text/html')
  return html?.trim() || undefined
}

function messageBody(message: GmailMessage): string {
  const plain = findBodyPart(message.payload, 'text/plain')
  if (plain !== null) return plain.trim()
  const html = messageHtml(message)
  if (html) return stripHtml(html)
  return message.snippet ?? ''
}

function attachmentSizeLabel(size?: number): string {
  if (!size) return '0 KB'
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function extractAttachments(message: GmailMessage): Attachment[] {
  const attachments: Attachment[] = []
  const walk = (part: GmailMessagePart | undefined): void => {
    if (!part) return
    if (part.filename) {
      const content = part.body?.data
        ? decodeBase64Url(part.body.data)
        : undefined
      const attachmentId = part.body?.attachmentId
      attachments.push({
        id: `gmail_att_${message.id}_${attachments.length}`,
        name: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        sizeLabel: attachmentSizeLabel(part.body?.size),
        ...(typeof part.body?.size === 'number'
          ? { size: part.body.size }
          : {}),
        ...(content ? { content } : {}),
        ...(attachmentId
          ? {
              remote: {
                provider: 'gmail' as const,
                messageId: message.id,
                attachmentId,
              },
            }
          : {}),
      })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(message.payload)
  return attachments
}

function parsedMessage(message: GmailMessage): MailMessage {
  const attachments = extractAttachments(message)
  const html = messageHtml(message)
  const calendarAttachment = attachments.find(
    attachment =>
      attachment.mimeType.toLowerCase() === 'text/calendar' ||
      attachment.name.toLowerCase().endsWith('.ics'),
  )
  const calendarInvite = calendarAttachment?.content
    ? parseCalendarInvite(calendarAttachment.content) ?? undefined
    : undefined
  // A missing/invalid internalDate must NOT fabricate "now" — that rocketed
  // the thread to the rail top as perpetually "just now", re-stamped fresher
  // on every sync. But it must not collapse to epoch 0 either: the rail only
  // shows threads inside the fetch window, so a 1970 lastMessageAt makes
  // fetched mail silently disappear from the list. Fall back to the RFC 822
  // Date header; epoch 0 only when the message is truly undatable.
  const internalMs = Number(message.internalDate ?? Number.NaN)
  const headerDateMs = Date.parse(header(message, 'Date'))
  const receivedMs =
    Number.isFinite(internalMs) && internalMs > 0
      ? internalMs
      : Number.isFinite(headerDateMs)
        ? headerDateMs
        : 0
  const messageIdHeader = header(message, 'Message-ID').trim()
  return {
    id: `gmail_msg_${message.id}`,
    threadId: `gmail_thread_${message.threadId}`,
    ...(messageIdHeader ? { messageIdHeader } : {}),
    from: parseMailContact(header(message, 'From') || 'unknown@unknown'),
    to: parseMailContactList(header(message, 'To')),
    cc: parseMailContactList(header(message, 'Cc')),
    subject: header(message, 'Subject') || '(no subject)',
    body: messageBody(message),
    ...(html ? { bodyHtml: html } : {}),
    receivedAt: new Date(receivedMs).toISOString(),
    attachments,
    ...(calendarInvite ? { calendarInvite } : {}),
    ...(header(message, 'List-Unsubscribe')
      ? { listUnsubscribe: header(message, 'List-Unsubscribe') }
      : {}),
    read: !(message.labelIds ?? []).includes('UNREAD'),
    ...((message.labelIds ?? []).includes('DRAFT') ? { isDraft: true } : {}),
    gmailMessageId: message.id,
  }
}

function uniqueParticipants(
  messages: MailMessage[],
  ownEmail: string,
): MailContact[] {
  const own = ownEmail.toLowerCase()
  const contacts = new Map<string, MailContact>()
  for (const message of messages) {
    for (const contact of [message.from, ...message.to]) {
      if (!contacts.has(contact.email.toLowerCase())) {
        contacts.set(contact.email.toLowerCase(), contact)
      }
    }
  }
  const all = [...contacts.values()]
  return [
    ...all.filter(contact => contact.email.toLowerCase() !== own),
    ...all.filter(contact => contact.email.toLowerCase() === own),
  ]
}

function threadPriority(messages: GmailMessage[]): MailPriority {
  return messages.some(message =>
    (message.labelIds ?? []).includes('IMPORTANT'),
  )
    ? 'high'
    : 'none'
}

function needsReply(messages: MailMessage[], ownEmail: string): boolean {
  const latest = messages[messages.length - 1]
  if (!latest) return false
  if (latest.from.email.toLowerCase() === ownEmail.toLowerCase()) return false
  const text = `${latest.subject}\n${latest.body}`
  const ownerName = (ownEmail.split('@')[0] ?? '').replace(/[^a-z0-9]/gi, '')
  const directedQuestion = new RegExp(
    `\\b(?:${ownerName ? `${ownerName}|` : ''}you|your)\\b[^?]{0,120}\\?`,
    'i',
  )
  // Directed requests only — bare verbs like "review", "call", or "confirm"
  // match too much bulk and marketing mail.
  return (
    /\b(can you|could you|would you|can we|could we|would we|please reply|please review|please send|please share|please confirm|please approve|let me know|do you approve|need your|needs confirmation|needs your|does that work|would that work|is that ok|is that okay|are you ok with|are you okay with|should i|can i)\b/i.test(
      text,
    ) || directedQuestion.test(text)
  )
}

function threadPlacement(gmailThread: GmailThread): {
  mailboxId: string
  status: MailThread['status']
} {
  const labels = new Set(
    (gmailThread.messages ?? []).flatMap(message => message.labelIds ?? []),
  )
  if (labels.has('INBOX')) return { mailboxId: GMAIL_INBOX_ID, status: 'inbox' }
  if (labels.has('TRASH')) {
    return { mailboxId: GMAIL_TRASH_ID, status: 'archived' }
  }
  // A thread whose only message is a draft has neither INBOX nor TRASH, and
  // used to fall through to Sent — filing unsent mail as sent mail, in the one
  // folder where it could not possibly belong.
  if (labels.has('DRAFT')) {
    return { mailboxId: GMAIL_DRAFTS_ID, status: 'waiting' }
  }
  return { mailboxId: GMAIL_SENT_ID, status: 'waiting' }
}

/**
 * Coverage tells mergeMailProviderSyncResult what this fetch actually saw.
 * Threads that failed to fetch, or that fall past a truncated listing's
 * horizon, must never be treated as remotely deleted.
 */
function coverageForFetch(
  gmailThreads: GmailThread[],
  failedIds: string[],
  truncated: boolean,
): MailSyncCoverage | undefined {
  const failedThreadIds = failedIds.map(id => `gmail_thread_${id}`)
  let coveredFrom: string | undefined
  if (truncated) {
    // The listing is newest-first, so a truncated fetch only covers threads
    // at least as fresh as the oldest thread it returned.
    let oldestLatestMs = Number.POSITIVE_INFINITY
    for (const thread of gmailThreads) {
      let latestMs = 0
      for (const message of thread.messages ?? []) {
        const ms = Number(message.internalDate ?? '0')
        if (Number.isFinite(ms) && ms > latestMs) latestMs = ms
      }
      if (latestMs > 0 && latestMs < oldestLatestMs) oldestLatestMs = latestMs
    }
    coveredFrom = Number.isFinite(oldestLatestMs)
      ? new Date(oldestLatestMs).toISOString()
      : new Date().toISOString()
  }
  if (!coveredFrom && failedThreadIds.length === 0) return undefined
  return {
    ...(coveredFrom ? { coveredFrom } : {}),
    ...(failedThreadIds.length
      ? { failedThreadIds, failedCount: failedThreadIds.length }
      : {}),
  }
}

/**
 * Turn the DRAFT-labelled messages the fetch already returned into editable
 * Draft records, using the drafts listing for the one thing the message does
 * not carry: which Gmail draft id owns it.
 *
 * Without this a Gmail draft arrived as a MailMessage flagged `isDraft` —
 * correctly labelled in the timeline, and completely inert. No composer, no
 * Send, no Discard, and no id to update or delete it with.
 */
function draftsFromMessages(
  messages: MailMessage[],
  refs: ProviderDraftRef[],
  now: string,
): Draft[] {
  const messageById = new Map(
    messages
      .filter(message => message.gmailMessageId)
      .map(message => [message.gmailMessageId as string, message]),
  )
  const drafts: Draft[] = []
  for (const ref of refs) {
    const message = messageById.get(ref.messageId)
    if (!message) continue
    drafts.push({
      id: `gmail_draft_${ref.providerDraftId}`,
      threadId: message.threadId,
      to: message.to,
      ...(message.cc?.length ? { cc: message.cc } : {}),
      subject: message.subject === '(no subject)' ? '' : message.subject,
      body: message.body,
      ...(message.bodyHtml ? { bodyHtml: message.bodyHtml } : {}),
      providerDraftId: ref.providerDraftId,
      providerDraftMessageId: message.id,
      attachments: message.attachments,
      updatedAt: message.receivedAt || now,
      syncState: 'synced',
      source: 'manual',
      draftKind: 'manual',
      provenance: ['Written outside PureMail; synced from the account.'],
    })
  }
  return drafts
}

function toMailStore(
  gmailThreads: GmailThread[],
  email: string,
  base: MailStore = emptyMailStore(),
  syncCoverage?: MailSyncCoverage,
  providerLabels: ProviderLabelMetadata[] = [],
  draftRefs: ProviderDraftRef[] = [],
): MailStore {
  const userLabelsById = new Map(
    providerLabels
      .filter(label => label.type === 'user')
      .map(label => [label.id, label]),
  )
  const account = {
    id: GMAIL_ACCOUNT_ID,
    provider: 'gmail' as const,
    name: email,
    email,
    syncState: 'online' as const,
  }
  const mailboxes = [
    {
      id: GMAIL_INBOX_ID,
      accountId: account.id,
      name: 'Inbox',
      role: 'inbox' as const,
      unreadCount: 0,
    },
    {
      id: GMAIL_SENT_ID,
      accountId: account.id,
      name: 'Sent',
      role: 'sent' as const,
      unreadCount: 0,
    },
    {
      id: GMAIL_ARCHIVE_ID,
      accountId: account.id,
      name: 'Archive',
      role: 'archive' as const,
      unreadCount: 0,
    },
    {
      id: GMAIL_TRASH_ID,
      accountId: account.id,
      name: 'Trash',
      role: 'trash' as const,
      unreadCount: 0,
    },
    {
      id: GMAIL_DRAFTS_ID,
      accountId: account.id,
      name: 'Drafts',
      role: 'drafts' as const,
      unreadCount: 0,
    },
  ]
  const messages = gmailThreads.flatMap(thread =>
    (thread.messages ?? []).map(parsedMessage),
  )
  const threads = gmailThreads.reduce<MailThread[]>((mapped, gmailThread) => {
    const threadMessages = messages
      .filter(message => message.threadId === `gmail_thread_${gmailThread.id}`)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    const latest = threadMessages[threadMessages.length - 1]
    if (!latest) return mapped
    const placement = threadPlacement(gmailThread)
    const inInbox = placement.mailboxId === GMAIL_INBOX_ID
    const replyNeeded = inInbox && needsReply(threadMessages, email)
    mapped.push({
      id: `gmail_thread_${gmailThread.id}`,
      accountId: account.id,
      mailboxId: placement.mailboxId,
      subject: latest.subject,
      participants: uniqueParticipants(threadMessages, email),
      labels: [
        ...(replyNeeded ? ['Needs reply'] : []),
        ...[
          ...new Set(
            (gmailThread.messages ?? []).flatMap(
              message => message.labelIds ?? [],
            ),
          ),
        ]
          .map(labelId => userLabelsById.get(labelId)?.name)
          .filter((name): name is string => Boolean(name)),
      ],
      status: placement.status,
      priority: threadPriority(gmailThread.messages ?? []),
      summary: (latest.body || latest.subject).slice(0, 180),
      lastMessageAt: latest.receivedAt,
      syncState: 'synced' as const,
      gmailThreadId: gmailThread.id,
    })
    return mapped
  }, [])
  // Gmail STARRED is the remote source of truth for star state: any starred
  // message stars its thread, matching Gmail's own thread star semantics.
  const starredThreadIds = gmailThreads
    .filter(gmailThread =>
      (gmailThread.messages ?? []).some(message =>
        (message.labelIds ?? []).includes('STARRED'),
      ),
    )
    .map(gmailThread => `gmail_thread_${gmailThread.id}`)

  return {
    ...base,
    accounts: [account],
    mailboxes,
    threads,
    messages,
    drafts: draftsFromMessages(messages, draftRefs, new Date().toISOString()),
    starredThreadIds,
    // Provider labels: cached metadata plus the app-facing label list, so
    // sidebar views and bulk label actions work on real Gmail labels.
    ...(providerLabels.length
      ? {
          providerLabels,
          labels: [...userLabelsById.values()].map(label => ({
            id: label.id,
            name: label.name,
            color: label.color ?? '#7e8aa2',
          })),
        }
      : {}),
    ...(syncCoverage ? { syncCoverage } : { syncCoverage: undefined }),
  }
}

/** Characters allowed unquoted in an RFC 5322 display name (atext + space). */
const ADDRESS_ATOM_TEXT = /^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]*$/

/**
 * Display names went into To/Cc headers unquoted. A name like
 * "Example, Casey C" — one contact, comma inside — splits the address list
 * and Gmail rejects the whole send with "Invalid Cc header" (400). Names
 * outside the atom set are quoted; non-ASCII names are RFC 2047 B-encoded;
 * contacts with no usable address are dropped rather than sent as "<>".
 */
export function formatAddressList(contacts: MailContact[]): string {
  return contacts
    .filter(contact => contact.email && contact.email.includes('@'))
    .map(contact => {
      const name = contact.name?.trim()
      if (!name || name === contact.email) return contact.email
      // eslint-disable-next-line no-control-regex
      if (/[^\x20-\x7e]/.test(name)) {
        const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(name)))
        return `=?UTF-8?B?${encoded}?= <${contact.email}>`
      }
      if (ADDRESS_ATOM_TEXT.test(name)) return `${name} <${contact.email}>`
      return `"${name.replace(/[\\"]/g, '\\$&')}" <${contact.email}>`
    })
    .join(', ')
}

function encodeRfc822(raw: string): string {
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class GmailMailProvider implements MailProvider {
  /**
   * Honest as-implemented surface. compose: sends via the Gmail API
   * (reply/forward today). drafts: local drafts plus a Gmail drafts mailbox
   * (provider-backed drafts land in Phase M2). labels: provider labels sync
   * through the Gmail labels API (labelThread/unlabelThread call
   * /threads/:id/modify for provider-real labels; app-local labels stay
   * local). bulkActions is not implemented yet; flip a flag only when the
   * provider method actually honours it remotely.
   */
  readonly capabilities: MailProviderCapabilities = {
    compose: true,
    drafts: true,
    labels: true,
    bulkActions: false,
  }

  private store: MailStore | null = null

  constructor(private readonly options: GmailMailProviderOptions) {}

  /**
   * All Gmail calls run through the shared retry policy (429/5xx backoff
   * honoring `Retry-After`; a single retry after 401). The access token is
   * re-read on EVERY attempt — the shell refreshes it transparently, which
   * is what makes the policy's one 401 retry actually recover.
   *
   * `idempotent: false` (the send path) changes ONE thing: a THROWN network
   * error is not retried. A connection that dies after POST /messages/send
   * is ambiguous — Gmail may have accepted the message before the failure,
   * and retrying could deliver the email twice. Error RESPONSES (429/5xx/
   * 401) are still retried even for send, because a response proves the
   * server rejected the request and nothing was sent.
   */
  private async request<T>(
    path: string,
    init: { method?: string; body?: string; idempotent?: boolean } = {},
  ): Promise<T> {
    const idempotent = init.idempotent ?? true
    let networkFailure: unknown = null
    const attemptFetch = async (): Promise<GmailNetworkResponse> =>
      this.options.fetch({
        url: path.startsWith('https://') ? path : gmailPath(path),
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${await this.options.accessToken()}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      })
    const response = await withHttpRetry(async () => {
      if (idempotent) return attemptFetch()
      try {
        return await attemptFetch()
      } catch (error) {
        networkFailure = error
        // Status 0 is not a retryable status, so withHttpRetry returns this
        // sentinel immediately and the original error is rethrown below.
        return { ok: false, status: 0, body: '' }
      }
    }, this.options.retryOptions)
    if (networkFailure !== null) throw networkFailure
    if (!response.ok) {
      throw new Error(`Gmail API error (${response.status}): ${response.body}`)
    }
    return response.body ? (JSON.parse(response.body) as T) : ({} as T)
  }

  private async listThreadIds(
    query: string,
    limit = GMAIL_INBOX_THREAD_LIMIT,
  ): Promise<{ ids: string[]; truncated: boolean }> {
    const ids: string[] = []
    let pageToken: string | undefined
    let truncated = false
    do {
      const pageQuery = new URLSearchParams(query)
      if (pageToken) pageQuery.set('pageToken', pageToken)
      const list = await this.request<{
        threads?: Array<{ id: string }>
        nextPageToken?: string
      }>(`/threads?${pageQuery.toString()}`)
      ids.push(...(list.threads?.map(thread => thread.id) ?? []))
      if (list.nextPageToken && ids.length >= limit) truncated = true
      pageToken =
        list.nextPageToken && ids.length < limit ? list.nextPageToken : undefined
    } while (pageToken)
    if (ids.length > limit) truncated = true
    return { ids: ids.slice(0, limit), truncated }
  }

  private async fetchThreadDetails(
    ids: string[],
  ): Promise<{ threads: GmailThread[]; failedIds: string[] }> {
    const threads: GmailThread[] = []
    const failedIds: string[] = []
    let firstError: unknown
    for (let index = 0; index < ids.length; index += 5) {
      const batch = await Promise.all(
        ids.slice(index, index + 5).map(async id => {
          // One unfetchable thread (404 after a remote delete, transient
          // 500) must not fail the whole sync and drop every other thread.
          try {
            return await this.request<GmailThread>(`/threads/${id}?format=full`)
          } catch (error) {
            firstError = firstError ?? error
            failedIds.push(id)
            return null
          }
        }),
      )
      threads.push(
        ...batch.filter((thread): thread is GmailThread => thread !== null),
      )
    }
    // Large bodies (marketing HTML, long threads) arrive attachment-backed:
    // the part carries an attachmentId and no inline data. Left unhydrated,
    // messageHtml() finds nothing and the reader falls back to the sender's
    // text/plain — raw bracketed tracking URLs and all.
    await this.hydrateAttachmentBackedBodies(threads)
    // Every single fetch failing is systemic (expired session, outage) —
    // surface the real error instead of a store that looks merely partial.
    if (ids.length > 0 && failedIds.length === ids.length) {
      throw firstError instanceof Error
        ? firstError
        : new Error('Gmail thread fetch failed for every thread.')
    }
    return { threads, failedIds }
  }

  private async hydrateAttachmentBackedBodies(
    threads: GmailThread[],
  ): Promise<void> {
    const jobs: Array<{
      messageId: string
      part: GmailMessagePart
    }> = []
    const collect = (messageId: string, part?: GmailMessagePart): void => {
      if (!part) return
      if (
        (part.mimeType === 'text/html' || part.mimeType === 'text/plain') &&
        part.body?.attachmentId &&
        !part.body.data
      ) {
        jobs.push({ messageId, part })
      }
      for (const child of part.parts ?? []) collect(messageId, child)
    }
    for (const thread of threads) {
      for (const message of thread.messages ?? []) {
        collect(message.id, message.payload)
      }
    }
    // Best-effort, batched like the thread fetch: a body that stays
    // unhydrated just falls back to text/plain, same as before this existed.
    for (let index = 0; index < jobs.length; index += 5) {
      await Promise.all(
        jobs.slice(index, index + 5).map(async job => {
          try {
            const result = await this.request<{ data?: string }>(
              `/messages/${encodeURIComponent(
                job.messageId,
              )}/attachments/${encodeURIComponent(
                job.part.body!.attachmentId!,
              )}`,
            )
            if (result.data) job.part.body!.data = result.data
          } catch {
            // Fall back to the text alternative for this message only.
          }
        }),
      )
    }
  }

  private async listThreads(query: string): Promise<GmailThread[]> {
    const { ids } = await this.listThreadIds(query)
    return (await this.fetchThreadDetails(ids)).threads
  }

  private mailboxListQuery(
    labelIds: 'INBOX' | 'SENT' | 'TRASH' | 'DRAFT',
    store?: Pick<MailStore, 'settings'>,
  ): string {
    const base = new URLSearchParams({
      labelIds,
      maxResults: String(GMAIL_INBOX_PAGE_SIZE),
    })
    if (labelIds === 'TRASH') base.set('includeSpamTrash', 'true')
    const settings = {
      ...emptyMailStore().settings,
      ...(this.options.settings ?? {}),
      ...(store?.settings ?? {}),
    }
    const window = mailFetchWindowForStore({ settings })
    if (window === 'today') {
      const start = mailFetchWindowStartDate(window)
      const yyyy = start.getFullYear()
      const mm = String(start.getMonth() + 1).padStart(2, '0')
      const dd = String(start.getDate()).padStart(2, '0')
      base.set('q', `after:${yyyy}/${mm}/${dd}`)
    } else {
      base.set('q', `newer_than:${window}`)
    }
    return base.toString()
  }

  private async fetchMailboxThreads(base: Pick<MailStore, 'settings'>): Promise<{
    threads: GmailThread[]
    coverage: MailSyncCoverage | undefined
  }> {
    const [inbox, trash, sent, drafts] = await Promise.all([
      this.listThreadIds(this.mailboxListQuery('INBOX', base)),
      this.listThreadIds(this.mailboxListQuery('TRASH', base)),
      this.listThreadIds(this.mailboxListQuery('SENT', base)),
      // Drafts were never listed at all, so a draft written in Gmail only
      // reached PureMail by accident — when it happened to hang off a thread
      // that also carried inbox or sent mail.
      this.listThreadIds(this.mailboxListQuery('DRAFT', base)),
    ])
    const uniqueIds = [
      ...new Set([...inbox.ids, ...trash.ids, ...sent.ids, ...drafts.ids]),
    ]
    const { threads, failedIds } = await this.fetchThreadDetails(uniqueIds)
    return {
      threads,
      coverage: coverageForFetch(
        threads,
        failedIds,
        inbox.truncated ||
          trash.truncated ||
          sent.truncated ||
          drafts.truncated,
      ),
    }
  }

  async fetchStore(): Promise<MailStore> {
    const profile = await this.request<{ emailAddress: string }>('/profile')
    const email = profile.emailAddress || this.options.email || 'gmail'
    const base = {
      ...emptyMailStore(),
      settings: {
        ...emptyMailStore().settings,
        ...(this.options.settings ?? {}),
      },
    }
    const [{ threads, coverage }, labels, draftRefs] = await Promise.all([
      this.fetchMailboxThreads(base),
      this.fetchProviderLabels(),
      this.safeListDrafts(),
    ])
    this.store = toMailStore(
      threads,
      email,
      base,
      // Only claim draft coverage when the listing actually succeeded: the
      // merge deletes synced drafts the provider no longer has, and it must
      // never do that on the strength of a failed request.
      draftRefs ? { ...(coverage ?? {}), draftsCovered: true } : coverage,
      labels,
      draftRefs ?? [],
    )
    return this.store
  }

  /**
   * The drafts listing, or null when it failed. A drafts outage must degrade
   * to "we did not look", never to "there are none" — the second would delete
   * the user's synced drafts on the next merge.
   */
  private async safeListDrafts(): Promise<ProviderDraftRef[] | null> {
    try {
      return await this.listDrafts()
    } catch (error) {
      console.warn('[puremail] gmail drafts listing failed:', error)
      return null
    }
  }

  /**
   * Gmail labels API → defensive metadata cache. Hidden labels are skipped;
   * missing colors and counts stay undefined rather than inventing values.
   */
  private async fetchProviderLabels(): Promise<ProviderLabelMetadata[]> {
    try {
      const response = await this.request<{
        labels?: Array<{
          id?: string
          name?: string
          type?: string
          labelListVisibility?: string
          color?: { backgroundColor?: string }
          messagesUnread?: number
          messagesTotal?: number
        }>
      }>('/labels')
      const now = new Date().toISOString()
      return (response.labels ?? [])
        .filter(
          label =>
            label.id &&
            label.name &&
            label.labelListVisibility !== 'labelHide',
        )
        .map(label => ({
          id: label.id!,
          name: label.name!,
          type: label.type === 'user' ? ('user' as const) : ('system' as const),
          ...(label.color?.backgroundColor
            ? { color: label.color.backgroundColor }
            : {}),
          ...(typeof label.messagesUnread === 'number'
            ? { unreadCount: label.messagesUnread }
            : {}),
          ...(typeof label.messagesTotal === 'number'
            ? { totalCount: label.messagesTotal }
            : {}),
          updatedAt: now,
        }))
    } catch {
      // Label listing is an enhancement — a failure must never sink a sync.
      return this.store?.providerLabels ?? []
    }
  }

  async sync(store?: MailStore): Promise<MailStore> {
    const profile = await this.request<{ emailAddress: string }>('/profile')
    const email = profile.emailAddress || this.options.email || 'gmail'
    const base = {
      ...emptyMailStore(),
      ...(store ?? {}),
      settings: {
        ...emptyMailStore().settings,
        ...(this.options.settings ?? {}),
        ...(store?.settings ?? {}),
      },
    }
    const [{ threads, coverage }, labels, draftRefs] = await Promise.all([
      this.fetchMailboxThreads(base),
      this.fetchProviderLabels(),
      this.safeListDrafts(),
    ])
    this.store = toMailStore(
      threads,
      email,
      base,
      // Only claim draft coverage when the listing actually succeeded: the
      // merge deletes synced drafts the provider no longer has, and it must
      // never do that on the strength of a failed request.
      draftRefs ? { ...(coverage ?? {}), draftsCovered: true } : coverage,
      labels,
      draftRefs ?? [],
    )
    return this.store
  }

  /**
   * Sending needs every attachment's bytes. Locally attached files carry
   * data-URI content; forwarded Gmail attachments may hold only a remote
   * ref (persistence strips re-fetchable blobs), so fetch those first. An
   * attachment with neither is unrecoverable — fail loudly instead of
   * sending a mail the recipient thinks has files in it.
   */
  private async resolveSendAttachments(
    attachments: Attachment[],
  ): Promise<Attachment[]> {
    return Promise.all(
      attachments.map(async attachment => {
        if (attachment.content) return attachment
        if (!attachment.remote) {
          throw new Error(
            `Attachment "${attachment.name}" has no content to send. Remove it or attach the file again.`,
          )
        }
        if (attachment.remote.provider !== 'gmail') {
          throw new Error(
            `Attachment "${attachment.name}" belongs to another provider.`,
          )
        }
        const response = await this.request<{ data?: string; size?: number }>(
          `/messages/${encodeURIComponent(
            attachment.remote.messageId,
          )}/attachments/${encodeURIComponent(attachment.remote.attachmentId)}`,
        )
        if (!response.data) {
          throw new Error(
            `Gmail did not return content for attachment "${attachment.name}".`,
          )
        }
        return {
          ...attachment,
          content: gmailAttachmentContent(response.data, attachment.mimeType),
          ...(typeof response.size === 'number' ? { size: response.size } : {}),
        }
      }),
    )
  }

  async send(input: SendDraftInput): Promise<MailMessage> {
    const thread = this.store?.threads.find(item => item.id === input.threadId)
    // Local compose threads (thread_compose_*) have no Gmail counterpart —
    // omit threadId so Gmail starts a new thread instead of rejecting the id.
    const gmailThreadId =
      thread?.gmailThreadId ??
      (input.threadId.startsWith('gmail_thread_')
        ? input.threadId.replace(/^gmail_thread_/, '')
        : undefined)
    const cc = input.draft.cc ?? []
    const bcc = input.draft.bcc ?? []
    // Threading headers keep replies attached to the conversation for the
    // recipient's client, not just inside Gmail's own thread id.
    const references = gmailThreadId
      ? [
          ...new Set(
            (this.store?.messages ?? [])
              .filter(message => message.threadId === input.threadId)
              .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
              .map(message => message.messageIdHeader)
              .filter((id): id is string => Boolean(id)),
          ),
        ]
      : []
    const inReplyTo = references[references.length - 1]
    const attachments = await this.resolveSendAttachments(
      input.draft.attachments,
    )
    const totalBytes = totalAttachmentBytes(attachments)
    if (totalBytes > GMAIL_ATTACHMENT_LIMIT_BYTES) {
      throw new Error(
        `Attachments total ${formatAttachmentBytes(
          totalBytes,
        )} — Gmail's limit is 25 MB. Remove some attachments and try again.`,
      )
    }
    const mimeAttachments = attachments.reduce<MimeAttachmentPart[]>(
      (parts, attachment) => {
        const base64 = attachmentContentToBase64(attachment)
        if (base64 === null) {
          throw new Error(
            `Attachment "${attachment.name}" could not be encoded for sending.`,
          )
        }
        parts.push({
          name: attachment.name,
          mimeType: attachment.mimeType,
          base64,
        })
        return parts
      },
      [],
    )
    const headerLines = [
      `To: ${formatAddressList(input.draft.to)}`,
      ...(cc.length ? [`Cc: ${formatAddressList(cc)}`] : []),
      ...(bcc.length ? [`Bcc: ${formatAddressList(bcc)}`] : []),
      `Subject: ${input.draft.subject}`,
      ...(inReplyTo
        ? [`In-Reply-To: ${inReplyTo}`, `References: ${references.join(' ')}`]
        : []),
    ]
    const raw = buildMimeMessage({
      headerLines,
      body: input.draft.body,
      ...(input.draft.bodyHtml ? { bodyHtml: input.draft.bodyHtml } : {}),
      attachments: mimeAttachments,
    })
    const sent = await this.sendRaw(input, raw, gmailThreadId)
    const message: MailMessage = {
      id: `gmail_msg_${sent.id}`,
      threadId: input.threadId,
      from: {
        name: this.options.email ?? 'Me',
        email: this.options.email ?? '',
      },
      to: input.draft.to,
      cc,
      bcc,
      subject: input.draft.subject,
      body: input.draft.body,
      ...(input.draft.bodyHtml ? { bodyHtml: input.draft.bodyHtml } : {}),
      receivedAt: new Date().toISOString(),
      attachments: input.draft.attachments,
      read: true,
      gmailMessageId: sent.id,
    }
    if (this.store) {
      this.store = {
        ...this.store,
        messages: [...this.store.messages, message],
        drafts: this.store.drafts.filter(draft => draft.id !== input.draft.id),
        threads: this.store.threads.map(item =>
          item.id === input.threadId
            ? {
                ...item,
                status: 'waiting',
                lastMessageAt: message.receivedAt,
                syncState: 'synced',
              }
            : item,
        ),
      }
    }
    return message
  }

  /**
   * Fetch one thread by id, regardless of the sync window. Returns a store
   * fragment (thread + messages) built with the same conversion as sync, so
   * ids and mailbox assignments line up with the local store and the caller
   * can merge it in. Used to open a searchAllMail result the window never
   * synced.
   */
  async fetchThreadById(
    threadId: string,
  ): Promise<{ threads: MailThread[]; messages: MailMessage[] } | null> {
    const gmailId = threadId.replace(/^gmail_thread_/, '')
    if (!gmailId.trim()) return null
    let thread: GmailThread
    try {
      thread = await this.request<GmailThread>(
        `/threads/${encodeURIComponent(gmailId)}?format=full`,
      )
    } catch {
      return null
    }
    await this.hydrateAttachmentBackedBodies([thread])
    const profile = await this.request<{ emailAddress: string }>('/profile')
    const fragment = toMailStore(
      [thread],
      profile.emailAddress || this.options.email || 'gmail',
    )
    return { threads: fragment.threads, messages: fragment.messages }
  }

  /**
   * Server-side Gmail search, unconstrained by the local fetch window. The
   * query goes to Gmail verbatim (Gmail search syntax), so agents can reach
   * mail the local store never synced.
   */
  async searchThreadSummaries(
    query: string,
    limit = 20,
  ): Promise<
    Array<{
      threadId: string
      subject: string
      from: string
      date: string
      snippet: string
      inLocalWindow: boolean
    }>
  > {
    if (!query.trim()) return []
    const threads = await this.listThreads(
      `q=${encodeURIComponent(query)}&maxResults=${Math.min(
        Math.max(1, Math.round(limit)),
        50,
      )}`,
    )
    const profile = await this.request<{ emailAddress: string }>('/profile')
    const searchStore = toMailStore(
      threads,
      profile.emailAddress || this.options.email || 'gmail',
    )
    const localThreadIds = new Set(this.store?.threads.map(t => t.id) ?? [])
    return searchStore.threads.map(thread => {
      const messages = searchStore.messages
        .filter(message => message.threadId === thread.id)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      const latest = messages[0]
      return {
        threadId: thread.id,
        subject: thread.subject,
        from: latest?.from.email ?? thread.participants[0]?.email ?? '',
        date: latest?.receivedAt ?? thread.lastMessageAt,
        snippet: (latest?.body ?? thread.summary)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160),
        inLocalWindow: localThreadIds.has(thread.id),
      }
    })
  }

  async search(query: string): Promise<
    Array<{
      id: string
      type: 'thread' | 'message' | 'task' | 'attachment'
      title: string
    }>
  > {
    if (!query.trim()) return []
    const threads = await this.listThreads(
      `q=${encodeURIComponent(query)}&maxResults=20`,
    )
    const profile = await this.request<{ emailAddress: string }>('/profile')
    const searchStore = toMailStore(
      threads,
      profile.emailAddress || this.options.email || 'gmail',
    )
    return searchMailAndTasks(searchStore, query).map(result => ({ ...result }))
  }

  async getAttachmentContent(
    message: MailMessage,
    attachment: Attachment,
  ): Promise<Attachment> {
    if (attachment.content) return attachment
    const remote =
      attachment.remote?.provider === 'gmail' ? attachment.remote : undefined
    const gmailMessageId = remote?.messageId ?? message.gmailMessageId
    const gmailAttachmentId = remote?.attachmentId
    if (!gmailMessageId || !gmailAttachmentId) {
      throw new Error('This Gmail attachment cannot be downloaded.')
    }
    const response = await this.request<{ data?: string; size?: number }>(
      `/messages/${encodeURIComponent(
        gmailMessageId,
      )}/attachments/${encodeURIComponent(gmailAttachmentId)}`,
    )
    if (!response.data) {
      throw new Error('Gmail attachment response did not include content.')
    }
    return {
      ...attachment,
      content: gmailAttachmentContent(response.data, attachment.mimeType),
      sizeLabel: response.size
        ? attachmentSizeLabel(response.size)
        : attachment.sizeLabel,
      ...(typeof response.size === 'number' ? { size: response.size } : {}),
    }
  }

  async labelThread(threadId: string, labelId: string): Promise<void> {
    // Provider labels apply remotely; app-local labels (label_review etc.)
    // stay local-only exactly as before.
    const providerLabel = this.store?.providerLabels?.find(
      label => label.id === labelId,
    )
    if (providerLabel) {
      const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
      await this.request(`/threads/${gmailThreadId}/modify`, {
        method: 'POST',
        body: JSON.stringify({ addLabelIds: [labelId] }),
      })
    }
    if (!this.store) return
    this.store = labelThreadInStore(this.store, threadId, labelId)
  }

  async unlabelThread(threadId: string, labelId: string): Promise<void> {
    const providerLabel = this.store?.providerLabels?.find(
      label => label.id === labelId,
    )
    if (providerLabel) {
      const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
      await this.request(`/threads/${gmailThreadId}/modify`, {
        method: 'POST',
        body: JSON.stringify({ removeLabelIds: [labelId] }),
      })
    }
    if (!this.store) return
    const labelName = providerLabel?.name ?? labelId
    this.store = {
      ...this.store,
      threads: this.store.threads.map(thread =>
        thread.id === threadId
          ? {
              ...thread,
              labels: thread.labels.filter(label => label !== labelName),
            }
          : thread,
      ),
    }
  }

  async createLabel(name: string): Promise<ProviderLabelMetadata> {
    const created = await this.request<{
      id?: string
      name?: string
      color?: { backgroundColor?: string }
    }>('/labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    })
    if (!created.id || !created.name) {
      throw new Error('Gmail did not return the created label.')
    }
    const metadata: ProviderLabelMetadata = {
      id: created.id,
      name: created.name,
      type: 'user',
      ...(created.color?.backgroundColor
        ? { color: created.color.backgroundColor }
        : {}),
      updatedAt: new Date().toISOString(),
    }
    if (this.store) {
      this.store = {
        ...this.store,
        providerLabels: [...(this.store.providerLabels ?? []), metadata],
        labels: [
          ...this.store.labels,
          {
            id: metadata.id,
            name: metadata.name,
            color: metadata.color ?? '#7e8aa2',
          },
        ],
      }
    }
    return metadata
  }

  async archiveThread(threadId: string): Promise<void> {
    const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
    await this.request(`/threads/${gmailThreadId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
    })
    if (this.store) this.store = archiveThreadInStore(this.store, threadId)
  }

  async unarchiveThread(threadId: string): Promise<void> {
    const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
    await this.request(`/threads/${gmailThreadId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: ['INBOX'] }),
    })
    if (this.store) this.store = unarchiveThreadInStore(this.store, threadId)
  }


  async moveThread(threadId: string, mailboxId: string): Promise<void> {
    if (this.store)
      this.store = moveThreadInStore(this.store, threadId, mailboxId)
  }

  async deleteThread(threadId: string): Promise<void> {
    const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
    await this.request(`/threads/${gmailThreadId}/trash`, { method: 'POST' })
    if (this.store) this.store = deleteThreadInStore(this.store, threadId)
  }

  async markThreadRead(threadId: string, read: boolean): Promise<void> {
    const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
    await this.request(`/threads/${gmailThreadId}/modify`, {
      method: 'POST',
      body: JSON.stringify(
        read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] },
      ),
    })
    if (this.store)
      this.store = markThreadReadInStore(this.store, threadId, read)
  }

  async setThreadStarred(threadId: string, starred: boolean): Promise<void> {
    const gmailThreadId = threadId.replace(/^gmail_thread_/, '')
    await this.request(`/threads/${gmailThreadId}/modify`, {
      method: 'POST',
      body: JSON.stringify(
        starred
          ? { addLabelIds: ['STARRED'] }
          : { removeLabelIds: ['STARRED'] },
      ),
    })
    if (this.store)
      this.store = setThreadStarredInStore(this.store, threadId, starred)
  }

  /**
   * Put the message on the wire, using the drafts API when this draft already
   * has a Gmail draft behind it.
   *
   * `messages.send` alone left that Gmail draft sitting in Drafts after the
   * send: Gmail ended up holding both a sent message and a stale draft, and
   * because the draft is on the same thread it came straight back on the next
   * fetch as an unsent message inside the conversation you had just replied
   * to. `drafts.send` sends and clears the draft in one operation — which is
   * exactly "a sent draft moves to Sent", done by the system that owns the
   * folder.
   *
   * The draft is updated with the current content first: the local copy may
   * have been edited since it was last pushed, and sending the provider's
   * older text would send the wrong email. If either step fails, fall back to
   * `messages.send` and delete the draft afterwards, so a Gmail-side problem
   * costs a ghost draft at worst, never an unsent reply.
   */
  private async sendRaw(
    input: SendDraftInput,
    raw: string,
    gmailThreadId: string | undefined,
  ): Promise<{ id: string; threadId?: string }> {
    const providerDraftId = input.draft.providerDraftId
    if (providerDraftId) {
      try {
        await this.request(`/drafts/${encodeURIComponent(providerDraftId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            id: providerDraftId,
            message: {
              ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
              raw: encodeRfc822(raw),
            },
          }),
        })
        return await this.request<{ id: string; threadId?: string }>(
          '/drafts/send',
          {
            method: 'POST',
            body: JSON.stringify({ id: providerDraftId }),
            idempotent: false,
          },
        )
      } catch (error) {
        console.warn(
          '[puremail] gmail drafts.send failed; falling back to messages.send:',
          error,
        )
      }
    }
    const sent = await this.request<{ id: string; threadId?: string }>(
      '/messages/send',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
          raw: encodeRfc822(raw),
        }),
        // Non-idempotent: a network error thrown mid-send must NOT retry —
        // Gmail may have accepted the message, and a retry would send twice.
        // 429/5xx/401 responses still retry (see request()).
        idempotent: false,
      },
    )
    if (providerDraftId) {
      // The send succeeded, so the draft must go whatever happens next.
      try {
        await this.deleteDraft(providerDraftId)
      } catch (error) {
        console.warn(
          '[puremail] sent message left a Gmail draft behind:',
          error,
        )
      }
    }
    return sent
  }

  /**
   * Raw RFC 822 payload for the Gmail drafts API. Threading headers are
   * omitted (Gmail attaches the draft to its thread via the message
   * threadId); attachments without local content are skipped — their bytes
   * already live in Gmail when they came from a remote message.
   */
  private draftRaw(draft: Draft): string {
    const cc = draft.cc ?? []
    const bcc = draft.bcc ?? []
    const attachments = draft.attachments.reduce<MimeAttachmentPart[]>(
      (parts, attachment) => {
        const base64 = attachmentContentToBase64(attachment)
        if (base64 !== null) {
          parts.push({
            name: attachment.name,
            mimeType: attachment.mimeType,
            base64,
          })
        }
        return parts
      },
      [],
    )
    return buildMimeMessage({
      headerLines: [
        `To: ${formatAddressList(draft.to)}`,
        ...(cc.length ? [`Cc: ${formatAddressList(cc)}`] : []),
        ...(bcc.length ? [`Bcc: ${formatAddressList(bcc)}`] : []),
        `Subject: ${draft.subject}`,
      ],
      body: draft.body,
      ...(draft.bodyHtml ? { bodyHtml: draft.bodyHtml } : {}),
      attachments,
    })
  }

  async createDraft(draft: Draft): Promise<string> {
    const thread = this.store?.threads.find(item => item.id === draft.threadId)
    const gmailThreadId =
      thread?.gmailThreadId ??
      (draft.threadId.startsWith('gmail_thread_')
        ? draft.threadId.replace(/^gmail_thread_/, '')
        : undefined)
    const created = await this.request<{ id: string }>('/drafts', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
          raw: encodeRfc822(this.draftRaw(draft)),
        },
      }),
    })
    return created.id
  }

  async updateDraft(providerDraftId: string, draft: Draft): Promise<void> {
    await this.request(`/drafts/${encodeURIComponent(providerDraftId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        id: providerDraftId,
        message: { raw: encodeRfc822(this.draftRaw(draft)) },
      }),
    })
  }

  /**
   * The account's drafts, as id pairs. Deliberately light: the draft bodies
   * already arrived with the DRAFT-labelled threads, so all that is missing is
   * which Gmail draft id owns which message — the link that makes a remote
   * draft editable, sendable and deletable here rather than a read-only
   * message that merely says "draft".
   */
  async listDrafts(): Promise<ProviderDraftRef[]> {
    const refs: ProviderDraftRef[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({ maxResults: '100' })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.request<{
        drafts?: Array<{
          id?: string
          message?: { id?: string; threadId?: string }
        }>
        nextPageToken?: string
      }>(`/drafts?${params.toString()}`)
      for (const entry of page.drafts ?? []) {
        if (!entry.id || !entry.message?.id || !entry.message.threadId) continue
        refs.push({
          providerDraftId: entry.id,
          messageId: entry.message.id,
          threadId: entry.message.threadId,
        })
      }
      pageToken = page.nextPageToken
      // A mailbox with thousands of drafts is a pathology, not a use case;
      // stop rather than paginate forever.
      if (refs.length >= 500) break
    } while (pageToken)
    return refs
  }

  async deleteDraft(providerDraftId: string): Promise<void> {
    await this.request(`/drafts/${encodeURIComponent(providerDraftId)}`, {
      method: 'DELETE',
    })
  }
}
