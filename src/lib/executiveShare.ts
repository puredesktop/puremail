/**
 * The executive team's mail share (ps-suite #1013, file formats §1).
 *
 * On an organisation's team desk the Executive app's Chief of Staff reads the
 * organisation's mail and leaves drafts. It never calls PureMail: the two
 * exchange plain files under `.appdata/executive/mail/` in the workspace.
 *
 *   share.json            written by the Executive app: which account, since
 *                         when, and what must never be read.
 *   digest/<day>.jsonl    written here after each successful sync: one line
 *                         per new message, once per message id (cursor.json).
 *   drafts/<key>.json     written by the Executive app; imported here as a
 *                         DRAFT, then moved to drafts/taken/ or drafts/refused/.
 *
 * Nothing here sends mail, calls a model or touches the network. The state
 * lives in these files, never in the mail store: mergeMailProviderSyncResult
 * drops store fields it does not name. Several PureMail windows can run at
 * once, so every file is re-read on use, written atomically (the shell's
 * fs.write is temp-file + rename), and the two read-modify-write steps are
 * guarded by renaming the file being worked on (a rename succeeds for one
 * window only).
 */
import { attachmentByteSize, attachmentKindLabel } from './mailAttachments'
import { createComposedMessageDraft, createReplyDraft } from './mailModel'
import { cleanMailMessageText, compactMailText, stripHtmlToText } from './mailTextUtils'
import type {
  Draft,
  MailAccount,
  MailContact,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'

export const EXECUTIVE_MAIL_DIR = '.appdata/executive/mail'
export const EXECUTIVE_SHARE_FILE = `${EXECUTIVE_MAIL_DIR}/share.json`
export const EXECUTIVE_CURSOR_NAME = 'cursor.json'
export const EXECUTIVE_DIGEST_DIR = `${EXECUTIVE_MAIL_DIR}/digest`
export const EXECUTIVE_DRAFTS_DIR = `${EXECUTIVE_MAIL_DIR}/drafts`
export const EXECUTIVE_TAKEN_DIR = `${EXECUTIVE_DRAFTS_DIR}/taken`
export const EXECUTIVE_REFUSED_DIR = `${EXECUTIVE_DRAFTS_DIR}/refused`

/** The cursor remembers this many written ids (the newest). */
export const DIGEST_CURSOR_LIMIT = 5000
/** A digest line's text is at most this many characters. */
export const DIGEST_TEXT_LIMIT = 2000
/** A drafts file name is `<key>.json` with a key of this shape. */
export const DRAFT_KEY_PATTERN = /^[a-z0-9-]{4,80}$/
/** Longer than any real letter; the same cap the drawer's reply commit uses. */
export const DRAFT_BODY_LIMIT = 100_000
/** A claim on a drafts file older than this was left by a window that died. */
export const DRAFT_CLAIM_STALE_MS = 5 * 60_000
/** A digest lock older than this was left by a window that died. */
export const DIGEST_LOCK_STALE_MS = 2 * 60_000

// ---------------------------------------------------------------- share file

export interface ExecutiveMailShare {
  /** Automatically generated incoming role aliases supplied by Executive. */
  roleAddresses?: string[]
  account: string
  since: string
  neverRead: { senders: string[]; domains: string[]; folders: string[] }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * Read share.json. Anything that is not a version-1 share naming an account
 * and a valid `since` is no share at all: PureMail then writes nothing.
 */
export function parseMailShare(raw: string | null): ExecutiveMailShare | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (record.v !== 1) return null
  const account = typeof record.account === 'string' ? record.account.trim() : ''
  if (!account.includes('@')) return null
  const since = typeof record.since === 'string' ? record.since.trim() : ''
  if (!since || Number.isNaN(Date.parse(since))) return null
  const neverRead =
    record.neverRead && typeof record.neverRead === 'object'
      ? (record.neverRead as Record<string, unknown>)
      : {}
  return {
    account,
    since,
    ...(Array.isArray(record.roleAddresses) ? { roleAddresses: stringList(record.roleAddresses).map(a => a.toLowerCase()) } : {}),
    neverRead: {
      senders: stringList(neverRead.senders).map(item => item.toLowerCase()),
      domains: stringList(neverRead.domains).map(item =>
        item.toLowerCase().replace(/^@/, '').replace(/^\*\./, ''),
      ),
      folders: stringList(neverRead.folders).map(item => item.toLowerCase()),
    },
  }
}

/** Executive owns the time grammar. Retain full addressed context even for an invalid tag so it can explain a repair. */
export function isTeamAddress(share: ExecutiveMailShare, address: string): boolean {
  const recipient = address.trim().toLowerCase()
  return (share.roleAddresses ?? []).some(alias => {
    const at = alias.lastIndexOf('@'), local = alias.slice(0, at), domain = alias.slice(at)
    return recipient === alias || (recipient.endsWith(domain) && recipient.slice(0, -domain.length).startsWith(`${local}-`))
  })
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/** The connected (non-demo) account the share names, or null. */
export function sharedAccount(
  store: Pick<MailStore, 'accounts'>,
  share: ExecutiveMailShare | null,
): MailAccount | null {
  if (!share) return null
  return (
    store.accounts.find(
      account =>
        account.provider !== 'demo' &&
        Boolean(account.email) &&
        sameAddress(account.email, share.account),
    ) ?? null
  )
}

// ---------------------------------------------------------------- never read

function addressDomain(address: string): string {
  const at = address.lastIndexOf('@')
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase()
}

/** Exact sender (case-insensitive), or a listed domain or a subdomain of it. */
export function isNeverReadAddress(
  share: ExecutiveMailShare,
  address: string | undefined,
): boolean {
  if (!address) return false
  const normalized = address.trim().toLowerCase()
  if (share.neverRead.senders.includes(normalized)) return true
  const domain = addressDomain(normalized)
  if (!domain) return false
  return share.neverRead.domains.some(
    listed => domain === listed || domain.endsWith(`.${listed}`),
  )
}

/**
 * A folder or label on the never-read list. A folder matches by its full
 * path or its last segment ("Personal" matches "INBOX/Personal").
 */
export function isNeverReadPlace(
  share: ExecutiveMailShare,
  folder: string,
  labels: readonly string[],
): boolean {
  if (share.neverRead.folders.length === 0) return false
  const names = new Set<string>()
  const lowerFolder = folder.trim().toLowerCase()
  if (lowerFolder) {
    names.add(lowerFolder)
    names.add(lowerFolder.split('/').pop() ?? lowerFolder)
  }
  labels.forEach(label => names.add(label.trim().toLowerCase()))
  return share.neverRead.folders.some(listed => names.has(listed))
}

// ---------------------------------------------------------------- the digest

export interface DigestContact {
  name: string
  address: string
}

export interface DigestAttachment {
  name: string
  kind: string
  size?: number
}

/** One line of `digest/<yyyy-mm-dd>.jsonl` (formats §1b), in field order. */
export interface DigestLine {
  v: 1
  id: string
  threadId: string
  at: string
  from: DigestContact
  to: DigestContact[]
  cc: DigestContact[]
  bcc?: DigestContact[]
  deliveredTo?: DigestContact[]
  inReplyTo?: string
  references?: string[]
  calendarInvite?: Omit<NonNullable<MailMessage['calendarInvite']>, 'rawSource' | 'attendees' | 'organizer' | 'recurrenceRule' | 'status'>
  subject: string
  folder: string
  labels: string[]
  fromMe: boolean
  text: string
  attachments: DigestAttachment[]
}

const SPAM_FOLDER = /^(spam|junk|junk e-?mail|bulk mail)$/i

/** The message's stable id: its Message-ID header, else PureMail's id. */
export function digestMessageId(message: MailMessage): string {
  return message.messageIdHeader?.trim() || message.id
}

/**
 * Where a message is filed. IMAP message ids carry their folder path
 * (`imap_msg_<path>_<uid>`), so a sent reply in an Inbox thread is "Sent";
 * otherwise the thread's mailbox (Gmail: Inbox, Sent, Drafts, Trash).
 */
export function messagePlace(
  store: Pick<MailStore, 'mailboxes'>,
  thread: MailThread,
  message: MailMessage,
): { folder: string; role: string } {
  const imap = /^imap_msg_(.+)_\d+$/.exec(message.id)
  if (imap) {
    const path = imap[1]!
    const mailbox = store.mailboxes.find(item => item.id === `imap_mbx_${path}`)
    return { folder: path, role: mailbox?.role ?? 'custom' }
  }
  const mailbox = store.mailboxes.find(item => item.id === thread.mailboxId)
  return { folder: mailbox?.name ?? '', role: mailbox?.role ?? 'custom' }
}

/** Never in the digest: drafts, unsent local copies, spam and trash. */
function isUnsharedPlace(message: MailMessage, place: { folder: string; role: string }): boolean {
  if (message.isDraft || message.optimistic) return true
  if (place.role === 'drafts' || place.role === 'trash') return true
  const leaf = place.folder.split('/').pop() ?? place.folder
  return SPAM_FOLDER.test(leaf.trim())
}

/**
 * Plain text for the digest: PureMail's own reader cleaning (quoted history
 * and signature blocks stripped), a "-- " signature cut, then at most
 * DIGEST_TEXT_LIMIT characters.
 */
export function digestText(message: MailMessage): string {
  let text = cleanMailMessageText(message).text
  const sigDash = /(?:^|\n)-- ?\n/.exec(text)
  if (sigDash && sigDash.index > 0) text = text.slice(0, sigDash.index)
  text = compactMailText(text)
  if (text.length <= DIGEST_TEXT_LIMIT) return text
  const cut = text.slice(0, DIGEST_TEXT_LIMIT - 1)
  const atWord = cut.replace(/\s+\S*$/, '')
  return `${atWord.length > DIGEST_TEXT_LIMIT * 0.8 ? atWord : cut}…`
}

/** Role requests retain their full text and quoted context instead of a short review digest. */
export function addressedMailText(message: MailMessage): string {
  const body = message.body?.trim() || stripHtmlToText(message.bodyHtml)
  const limit = 200_000
  return body.length <= limit ? body : `${body.slice(0, limit)}\n\n[Message exceeds 200,000 characters. Open the original in PureMail for the remainder.]`
}

function digestContact(contact: MailContact): DigestContact {
  return { name: contact.name?.trim() ?? '', address: contact.email?.trim() ?? '' }
}

function isoInstant(value: string): string {
  return new Date(value).toISOString().replace(/\.000Z$/, 'Z')
}

/** The message's local calendar day, `yyyy-mm-dd` (names the digest file). */
export function localDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function ownAddresses(store: Pick<MailStore, 'settings'>, account: MailAccount): Set<string> {
  return new Set(
    [account.email, ...(store.settings.ownerIdentities?.emails ?? [])]
      .filter(Boolean)
      .map(item => item.trim().toLowerCase()),
  )
}

/**
 * The digest lines a store owes: the shared account's messages dated at or
 * after `since`, not yet written, oldest first. A message is left out when it
 * is a draft, in spam or trash, filed in a never-read folder or label, from a
 * never-read sender or domain — or, for the account's own sent mail, when any
 * recipient is on the never-read list (a reply to a private correspondent is
 * as private as their letter).
 */
export function digestLinesFor(
  store: MailStore,
  share: ExecutiveMailShare,
  account: MailAccount,
  written: ReadonlySet<string>,
): Array<{ day: string; line: DigestLine }> {
  const sinceMs = Date.parse(share.since)
  const threads = new Map(
    store.threads
      .filter(thread => thread.accountId === account.id)
      .map(thread => [thread.id, thread]),
  )
  const own = ownAddresses(store, account)
  const seen = new Set<string>()
  const out: Array<{ day: string; line: DigestLine; ms: number }> = []
  for (const message of store.messages) {
    const thread = threads.get(message.threadId)
    if (!thread) continue
    const ms = Date.parse(message.receivedAt)
    if (Number.isNaN(ms) || ms < sinceMs) continue
    const id = digestMessageId(message)
    if (written.has(id) || seen.has(id)) continue
    const place = messagePlace(store, thread, message)
    if (isUnsharedPlace(message, place)) continue
    const labels = [...new Set(thread.labels)]
    if (isNeverReadPlace(share, place.folder, labels)) continue
    if (isNeverReadAddress(share, message.from.email)) continue
    const fromMe = own.has(message.from.email?.trim().toLowerCase() ?? '')
    if (
      fromMe &&
      [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].some(contact =>
        isNeverReadAddress(share, contact.email),
      )
    ) {
      continue
    }
    seen.add(id)
    const at = isoInstant(message.receivedAt)
    out.push({
      ms,
      day: localDay(message.receivedAt),
      line: {
        v: 1,
        id,
        threadId: thread.id,
        at,
        from: digestContact(message.from),
        to: message.to.map(digestContact),
        cc: (message.cc ?? []).map(digestContact),
        ...(message.bcc?.length ? { bcc: message.bcc.map(digestContact) } : {}),
        ...(message.deliveredTo?.length ? { deliveredTo: message.deliveredTo.map(digestContact) } : {}),
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
        ...(message.references?.length ? { references: message.references.slice(-30) } : {}),
        ...(message.calendarInvite ? { calendarInvite: {
          uid: message.calendarInvite.uid, method: message.calendarInvite.method, sequence: message.calendarInvite.sequence,
          title: message.calendarInvite.title.slice(0, 1000), description: message.calendarInvite.description.slice(0, 12000),
          startsAt: message.calendarInvite.startsAt, endsAt: message.calendarInvite.endsAt, timeZone: message.calendarInvite.timeZone,
          ...(message.calendarInvite.location ? { location: message.calendarInvite.location.slice(0, 2000) } : {}),
        } } : {}),
        subject: message.subject,
        folder: place.folder,
        labels,
        fromMe,
        text: [...message.to, ...(message.cc ?? []), ...(message.bcc ?? []), ...(message.deliveredTo ?? [])].some(p => isTeamAddress(share, p.email ?? ''))
          ? addressedMailText(message) : digestText(message),
        attachments: message.attachments.map(attachment => {
          const size = attachmentByteSize(attachment)
          return {
            name: attachment.name,
            kind: attachmentKindLabel(attachment).toLowerCase(),
            ...(size === null ? {} : { size }),
          }
        }),
      },
    })
  }
  return out
    .sort((left, right) => left.ms - right.ms)
    .map(({ day, line }) => ({ day, line }))
}

/** The ids cursor.json lists; a missing or broken cursor lists none. */
export function parseDigestCursor(raw: string | null): string[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as { written?: unknown }
    return Array.isArray(data.written)
      ? data.written.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function serializeDigestCursor(ids: readonly string[]): string {
  return `${JSON.stringify({ v: 1, written: ids.slice(-DIGEST_CURSOR_LIMIT) })}\n`
}

/** The ids already in a day file (a second guard beside the cursor). */
export function digestFileIds(raw: string | null): Set<string> {
  const ids = new Set<string>()
  for (const row of (raw ?? '').split('\n')) {
    if (!row.trim()) continue
    try {
      const id = (JSON.parse(row) as { id?: unknown }).id
      if (typeof id === 'string') ids.add(id)
    } catch {
      // A torn or foreign line is left as it is.
    }
  }
  return ids
}

/** Append lines to a day file's text (append only; ends in a newline). */
export function appendDigestLines(existing: string | null, lines: readonly DigestLine[]): string {
  const head = existing ?? ''
  const prefix = head && !head.endsWith('\n') ? `${head}\n` : head
  return `${prefix}${lines.map(line => JSON.stringify(line)).join('\n')}\n`
}

// ---------------------------------------------------------------- drafts drop

export interface ExecutiveDraftRequest {
  key: string
  account: string
  to: MailContact[]
  cc: MailContact[]
  replyTo?: MailContact[]
  subject: string
  body: string
  inReplyTo?: { threadId?: string; messageId?: string }
  why?: string
}

export type DraftRequestCheck =
  | { ok: true; request: ExecutiveDraftRequest; record: Record<string, unknown> }
  | { ok: false; why: string; record: Record<string, unknown> }

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

function contactsFrom(
  value: unknown,
  field: 'to' | 'cc' | 'replyTo',
): { ok: true; contacts: MailContact[] } | { ok: false; why: string } {
  if (value === undefined || value === null) return { ok: true, contacts: [] }
  if (!Array.isArray(value)) {
    return { ok: false, why: `"${field}" is not a list of people.` }
  }
  const contacts: MailContact[] = []
  for (const item of value) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const address = typeof record.address === 'string' ? record.address.trim() : ''
    if (!ADDRESS.test(address)) {
      return {
        ok: false,
        why: address
          ? `"${address}" is not an email address.`
          : `Someone in "${field}" has no email address.`,
      }
    }
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (/[\r\n\x00]/.test(name)) return { ok: false, why: `Someone in \"${field}\" has an invalid name.` }
    contacts.push({ name, email: address })
  }
  return { ok: true, contacts }
}

/**
 * Check a drafts file against formats §1c. Every refusal is a plain sentence
 * the Executive app can show as it is.
 */
export function checkDraftRequest(
  raw: string,
  fileKey: string,
  share: ExecutiveMailShare,
): DraftRequestCheck {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, why: 'The file is not valid JSON, so no draft was made.', record: { v: 1, key: fileKey, raw } }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, why: 'The file does not hold a draft, so no draft was made.', record: { v: 1, key: fileKey, raw } }
  }
  const record = data as Record<string, unknown>
  const refuse = (why: string): DraftRequestCheck => ({ ok: false, why, record })
  if (record.v !== 1) return refuse('The file is not version 1 of the drafts format.')
  if (record.key !== fileKey) return refuse(`The key inside the file does not match its name (${fileKey}.json).`)
  const account = typeof record.account === 'string' ? record.account.trim() : ''
  if (!account) return refuse('The draft does not say which account it is for.')
  if (!sameAddress(account, share.account)) {
    return refuse(`The draft is for ${account}, but the mailbox shared with the executive team is ${share.account}.`)
  }
  const to = contactsFrom(record.to, 'to')
  if (!to.ok) return refuse(to.why)
  if (to.contacts.length === 0) return refuse('The draft has no one to send it to.')
  const cc = contactsFrom(record.cc, 'cc')
  if (!cc.ok) return refuse(cc.why)
  const replyTo = contactsFrom(record.replyTo, 'replyTo')
  if (!replyTo.ok) return refuse(replyTo.why)
  if (record.subject !== undefined && typeof record.subject !== 'string') {
    return refuse('The subject is not text.')
  }
  const body = typeof record.body === 'string' ? record.body : ''
  if (!body.trim()) return refuse('The draft has no body.')
  if (body.length > DRAFT_BODY_LIMIT) return refuse('The body is longer than 100,000 characters.')
  let inReplyTo: ExecutiveDraftRequest['inReplyTo']
  if (record.inReplyTo && typeof record.inReplyTo === 'object') {
    const reply = record.inReplyTo as Record<string, unknown>
    const threadId = typeof reply.threadId === 'string' ? reply.threadId.trim() : ''
    const messageId = typeof reply.messageId === 'string' ? reply.messageId.trim() : ''
    if (threadId || messageId) {
      inReplyTo = { ...(threadId ? { threadId } : {}), ...(messageId ? { messageId } : {}) }
    }
  }
  return {
    ok: true,
    record,
    request: {
      key: fileKey,
      account,
      to: to.contacts,
      cc: cc.contacts,
      ...(replyTo.contacts.length ? { replyTo: replyTo.contacts } : {}),
      subject: typeof record.subject === 'string' ? record.subject.trim() : '',
      body,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(typeof record.why === 'string' && record.why.trim() ? { why: record.why.trim() } : {}),
    },
  }
}

function normalizeMessageIdHeader(value: string | undefined): string {
  return (value ?? '').trim().replace(/^<|>$/g, '').toLowerCase()
}

/**
 * The thread (and message) a draft answers: the named thread when it is the
 * account's, else the thread holding the named Message-ID. Null makes the
 * draft a new message instead.
 */
export function findReplyTarget(
  store: Pick<MailStore, 'threads' | 'messages'>,
  account: MailAccount,
  inReplyTo: ExecutiveDraftRequest['inReplyTo'],
): { thread: MailThread; message: MailMessage | null } | null {
  if (!inReplyTo) return null
  const wanted = normalizeMessageIdHeader(inReplyTo.messageId)
  const byHeader = wanted
    ? store.messages.find(
        message => !message.isDraft && normalizeMessageIdHeader(message.messageIdHeader) === wanted,
      )
    : undefined
  const thread =
    store.threads.find(item => item.id === inReplyTo.threadId && item.accountId === account.id) ??
    store.threads.find(item => item.id === byHeader?.threadId && item.accountId === account.id)
  if (!thread) return null
  const inThread = store.messages
    .filter(message => message.threadId === thread.id && !message.isDraft && !message.optimistic)
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
  const message =
    (byHeader && byHeader.threadId === thread.id ? byHeader : undefined) ?? inThread.at(-1) ?? null
  return { thread, message }
}

/** The store ids an imported draft gets: stable per key, so a retry finds it. */
export function executiveDraftIds(key: string): { draftId: string; replyDraftId: string; threadId: string } {
  return {
    draftId: `draft_compose_exec-${key}`,
    replyDraftId: `draft_reply_exec-${key}`,
    threadId: `thread_compose_exec-${key}`,
  }
}

/** The draft already made for this key, if a window made it before. */
export function existingExecutiveDraft(store: Pick<MailStore, 'drafts'>, key: string): Draft | null {
  const ids = executiveDraftIds(key)
  return store.drafts.find(draft => draft.id === ids.draftId || draft.id === ids.replyDraftId) ?? null
}

/**
 * Build the DRAFT for a request, the same records PureMail's own reply and
 * compose make (syncState "pending", so the draft sync saves it to the
 * account's Drafts like any draft the person writes). Never sends.
 */
export function buildExecutiveDraft(
  store: MailStore,
  account: MailAccount,
  request: ExecutiveDraftRequest,
  options: { signature?: string; now?: string } = {},
): { draft: Draft; thread: MailThread | null; inThread: boolean } {
  const now = options.now ?? new Date().toISOString()
  const signature = options.signature?.trim() ?? ''
  const ids = executiveDraftIds(request.key)
  const provenance = [
    `Drafted by the executive team (${request.key}). Not sent.`,
    ...(request.why ? [`Why: ${request.why}`] : []),
  ]
  const target = findReplyTarget(store, account, request.inReplyTo)
  if (target) {
    const reply = createReplyDraft(
      target.thread,
      target.message,
      signature,
      now,
      account.email,
      'reply',
      request.body,
    )
    return {
      inThread: true,
      thread: null,
      draft: {
        ...reply,
        id: ids.replyDraftId,
        to: request.to,
        cc: request.cc,
        ...(request.replyTo?.length ? { replyTo: request.replyTo } : {}),
        bcc: [],
        subject: request.subject || reply.subject,
        ...(target.message ? { sourceMessageId: target.message.id } : {}),
        provenance,
      },
    }
  }
  const body = signature ? `${request.body.trimEnd()}\n\n${signature}` : request.body
  const composed = createComposedMessageDraft(
    store,
    {
      accountId: account.id,
      to: request.to,
      cc: request.cc,
      subject: request.subject,
      body,
      origin: 'manual',
    },
    now,
    { draftId: ids.draftId, threadId: ids.threadId },
  )
  const draft = composed.store.drafts.find(item => item.id === ids.draftId)!
  const thread = composed.store.threads.find(item => item.id === ids.threadId)!
  return { inThread: false, thread, draft: { ...draft, ...(request.replyTo?.length ? { replyTo: request.replyTo } : {}), provenance } }
}

/** Add a built draft (and its new thread) to a store, once. */
export function addExecutiveDraft(
  store: MailStore,
  built: { draft: Draft; thread: MailThread | null },
): MailStore {
  if (store.drafts.some(draft => draft.id === built.draft.id)) return store
  return {
    ...store,
    threads:
      built.thread && !store.threads.some(thread => thread.id === built.thread!.id)
        ? [built.thread, ...store.threads]
        : store.threads,
    drafts: [...store.drafts, built.draft],
  }
}

// ---------------------------------------------------------------- the files

/**
 * The file operations the share needs, all through the shell. `read` gives
 * null for a missing file; `write` is atomic; `list` gives [] for a missing
 * folder and hides dotfiles; `rename` stays in the same folder and throws
 * when the source is gone or the target exists.
 */
export interface ExecutiveShareFiles {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  list(folder: string): Promise<string[]>
  rename(path: string, newName: string): Promise<void>
  remove(path: string): Promise<void>
}

export function joinPath(root: string, relative: string): string {
  return `${root.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`
}

export async function readMailShare(
  files: ExecutiveShareFiles,
  root: string,
): Promise<ExecutiveMailShare | null> {
  return parseMailShare(await files.read(joinPath(root, EXECUTIVE_SHARE_FILE)))
}

function claimAge(name: string, marker: string, now: number): number | null {
  const at = name.lastIndexOf(marker)
  if (at < 0) return null
  const stamp = Number(name.slice(at + marker.length).split('-').pop())
  return Number.isFinite(stamp) ? now - stamp : null
}

async function tryRename(files: ExecutiveShareFiles, path: string, name: string): Promise<boolean> {
  try {
    await files.rename(path, name)
    return true
  } catch {
    return false
  }
}

/**
 * Append the store's new messages to the digest (formats §1b). Holds the
 * cursor by renaming it to `cursor.json.writing-<window>-<ms>` while it works,
 * so two windows syncing at once cannot both write the same message; the
 * window that finds it held skips this round (the next sync catches up).
 */
export async function writeMailDigest(input: {
  files: ExecutiveShareFiles
  root: string
  store: MailStore
  share: ExecutiveMailShare
  account: MailAccount
  instanceId: string
  now?: number
}): Promise<{ written: number; busy?: boolean }> {
  const { files, root, store, share, account, instanceId } = input
  const now = input.now ?? Date.now()
  const dir = joinPath(root, EXECUTIVE_MAIL_DIR)
  const cursorPath = `${dir}/${EXECUTIVE_CURSOR_NAME}`
  const lockMarker = `${EXECUTIVE_CURSOR_NAME}.writing-`

  let names = await files.list(dir)
  // A lock left by a window that died gives the cursor back.
  for (const name of names) {
    const age = claimAge(name, lockMarker, now)
    if (age !== null && age > DIGEST_LOCK_STALE_MS && !names.includes(EXECUTIVE_CURSOR_NAME)) {
      await tryRename(files, `${dir}/${name}`, EXECUTIVE_CURSOR_NAME)
    }
  }
  if ((await files.read(cursorPath)) === null) {
    names = await files.list(dir)
    if (names.some(name => name.startsWith(lockMarker))) return { written: 0, busy: true }
    await files.write(cursorPath, serializeDigestCursor([]))
  }
  const lockName = `${lockMarker}${instanceId}-${now}`
  const lockPath = `${dir}/${lockName}`
  if (!(await tryRename(files, cursorPath, lockName))) return { written: 0, busy: true }

  try {
    const written = parseDigestCursor(await files.read(lockPath))
    const pending = digestLinesFor(store, share, account, new Set(written))
    if (pending.length === 0) return { written: 0 }
    const byDay = new Map<string, DigestLine[]>()
    for (const item of pending) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item.line])
    const added: string[] = []
    for (const [day, lines] of byDay) {
      const dayPath = joinPath(root, `${EXECUTIVE_DIGEST_DIR}/${day}.jsonl`)
      const existing = await files.read(dayPath)
      const present = digestFileIds(existing)
      const fresh = lines.filter(line => !present.has(line.id))
      if (fresh.length > 0) await files.write(dayPath, appendDigestLines(existing, fresh))
      added.push(...lines.map(line => line.id))
    }
    await files.write(lockPath, serializeDigestCursor([...written, ...added]))
    return { written: added.length }
  } finally {
    if (!(await tryRename(files, lockPath, EXECUTIVE_CURSOR_NAME))) {
      // Someone restored a cursor meanwhile (they thought this lock stale):
      // theirs stays, and the next sync re-checks every id against the day files.
      await files.remove(lockPath).catch(() => undefined)
    }
  }
}

export interface DraftImportResult {
  taken: Array<{ key: string; draftId: string }>
  refused: Array<{ key: string; why: string }>
}

/**
 * Import the drafts drop (formats §1c). Each `<key>.json` is claimed by
 * renaming it to `<key>.json.taking-<window>-<ms>` (one window wins), checked,
 * saved as a DRAFT through `save`, and moved to taken/ or refused/. `save`
 * makes a draft and nothing else: this function has no way to send.
 */
export async function takeExecutiveDrafts(input: {
  files: ExecutiveShareFiles
  root: string
  share: ExecutiveMailShare
  instanceId: string
  save: (request: ExecutiveDraftRequest) => { draftId: string }
  now?: number
}): Promise<DraftImportResult> {
  const { files, root, share, instanceId, save } = input
  const now = input.now ?? Date.now()
  const stamp = new Date(now).toISOString()
  const dir = joinPath(root, EXECUTIVE_DRAFTS_DIR)
  const takenDir = joinPath(root, EXECUTIVE_TAKEN_DIR)
  const refusedDir = joinPath(root, EXECUTIVE_REFUSED_DIR)
  const result: DraftImportResult = { taken: [], refused: [] }

  const names = await files.list(dir)
  const work: Array<{ key: string; claimName: string }> = []
  for (const name of names) {
    const fresh = /^(.+)\.json$/.exec(name)
    const claimed = /^(.+)\.json\.taking-/.exec(name)
    const key = (fresh ?? claimed)?.[1]
    if (!key || !DRAFT_KEY_PATTERN.test(key)) continue
    if (claimed) {
      const age = claimAge(name, '.json.taking-', now)
      if (age === null || age <= DRAFT_CLAIM_STALE_MS) continue
    }
    const claimName = `${key}.json.taking-${instanceId}-${now}`
    if (await tryRename(files, `${dir}/${name}`, claimName)) work.push({ key, claimName })
  }

  for (const { key, claimName } of work) {
    const claimPath = `${dir}/${claimName}`
    const raw = (await files.read(claimPath)) ?? ''
    const refuse = async (record: Record<string, unknown>, why: string) => {
      const refusal = `${JSON.stringify({ ...record, why, refusedAt: stamp }, null, 2)}\n`
      const target =
        (await files.read(`${refusedDir}/${key}.json`)) === null
          ? `${refusedDir}/${key}.json`
          : `${refusedDir}/${key}.again-${now}.json`
      await files.write(target, refusal)
      await files.remove(claimPath)
      result.refused.push({ key, why })
    }
    const checked = checkDraftRequest(raw, key, share)
    const handledBefore =
      (await files.read(`${takenDir}/${key}.json`)) !== null ||
      (await files.read(`${refusedDir}/${key}.json`)) !== null
    if (handledBefore) {
      await refuse(checked.record, 'already handled')
      continue
    }
    if (!checked.ok) {
      await refuse(checked.record, checked.why)
      continue
    }
    let draftId: string
    try {
      draftId = save(checked.request).draftId
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await refuse(checked.record, `PureMail could not make the draft: ${reason}`)
      continue
    }
    await files.write(
      `${takenDir}/${key}.json`,
      `${JSON.stringify({ ...checked.record, draftId, takenAt: stamp }, null, 2)}\n`,
    )
    await files.remove(claimPath)
    result.taken.push({ key, draftId })
  }
  return result
}
