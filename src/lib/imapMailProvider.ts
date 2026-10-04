import { MailDraftSaveUncertain } from './mailDeliveryStatus'
import { MailSendError } from './mailDelivery'
import { bridge } from '@purescience/platform-ui/bridge/client'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import {
  attachmentContentToBase64,
  formatAttachmentBytes,
  GMAIL_ATTACHMENT_LIMIT_BYTES,
  totalAttachmentBytes,
} from './mailAttachments'
import { parseCalendarInvite } from './mailCalendarInvite'
import {
  assignConversationKeys,
  normalizeMessageId,
  threadIdForKey,
} from './mailThreading'
import { buildMimeMessage, type MimeAttachmentPart } from './mailMime'
import {
  DEFAULT_MAIL_FETCH_WINDOW,
  mailFetchWindowStartDate,
  searchMailAndTasks,
} from './mailModel'
import type {
  Attachment,
  Draft,
  MailContact,
  Mailbox,
  MailMessage,
  MailProvider,
  MailProviderCapabilities,
  MailStore,
  MailThread,
  ProviderDraftRef,
  SendDraftInput,
} from '../types'
import { emptyMailStore } from './mailModel'

/**
 * Phase M6 IMAP/SMTP provider foundation. The provider is fully
 * transport-agnostic: it consumes the typed transports below and never
 * touches sockets itself. Raw TCP is not available in this renderer, so
 * the real transports are a shell follow-up (see
 * apps/puremail/docs/PROVIDER_ROADMAP.md); the provider logic ships proven
 * against an in-memory fake transport, making real IMAP transport-only
 * work later.
 */

export type ImapSecurity = 'ssl' | 'starttls' | 'none'

export interface ImapEnvelopeAttachment {
  /** Transport-stable part id, used to fetch the content on demand. */
  partId: string
  filename: string
  contentType: string
  size: number
}

export interface ImapEnvelope {
  uid: number
  messageId?: string
  inReplyTo?: string
  /** Root-first, as RFC 5322 sends them; the first entry is the conversation. */
  references?: string[]
  listUnsubscribe?: string
  subject: string
  from: MailContact
  to: MailContact[]
  cc?: MailContact[]
  date: string
  body: string
  /** Sanitizable HTML alternative, parsed transport-side. */
  bodyHtml?: string
  /** Raw text of an attached text/calendar part, inlined when small. */
  icsText?: string
  /** IMAP system flags, e.g. "\\Seen", "\\Flagged". */
  flags: string[]
  /** Parsed attachment metadata; content is fetched on demand. */
  attachments?: ImapEnvelopeAttachment[]
}

export interface ImapFolder {
  path: string
  /** Mapped mailbox role; unknown folders become custom. */
  role: Mailbox['role']
  /**
   * A server-managed mirror (RFC 6154 \All — Proton's "All Mail"): every
   * message appears here automatically, and moving a copy OUT of it is
   * invalid. Mutations must target the real folders only.
   */
  virtual?: boolean
}

export interface ImapTransport {
  connect(): Promise<void>
  listFolders(): Promise<ImapFolder[]>
  fetchMessages(
    folderPath: string,
    limit?: number,
    /** ISO date: fetch what arrived on or after it, not the newest N. */
    since?: string,
    /** Paging cursor: only messages with a UID below this one. */
    beforeUid?: number,
    headerSearch?: { name: string; value: string } | Array<{ name: string; value: string }>,
    uids?: number[],
  ): Promise<ImapEnvelope[]>
  setFlag(
    folderPath: string,
    uid: number,
    flag: string,
    on: boolean,
  ): Promise<void>
  move(folderPath: string, uid: number, toFolderPath: string): Promise<void>
  /**
   * APPEND a message. Returns the new message's UID when the server reports
   * one (RFC 4315 APPENDUID). Without it a stored draft has no address, so it
   * can never be updated or deleted again — which is why createDraft used to
   * hand back a fabricated `imap_draft_<timestamp>` that corresponded to
   * nothing on the server.
   */
  append(folderPath: string, rawMime: string): Promise<number | void>
  /** Flag \\Deleted and expunge. Needed to replace or discard a draft. */
  deleteMessage?(folderPath: string, uid: number): Promise<void>
  /** Attachment content on demand, base64-encoded. */
  fetchAttachment?(
    folderPath: string,
    uid: number,
    partId: string,
  ): Promise<{ base64: string; contentType: string; filename: string }>
  /** Server-side full-text search across every folder, newest first. */
  searchAll?(
    query: string,
    limit: number,
  ): Promise<
    Array<{
      folderPath: string
      uid: number
      messageId?: string
      subject: string
      from: { name: string; email: string } | null
      date: string
    }>
  >
}

export interface SmtpTransport {
  verify?(): Promise<void>
  send(rawMime: string, from: string, to: string[]): Promise<void | { rejected: string[] }>
}

/** One thin funnel so every transport method shares the bridge plumbing. */
async function callMailTransport(
  method: keyof typeof PLATFORM_BRIDGE_METHODS,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return bridge.call(PLATFORM_BRIDGE_METHODS[method] as string, [payload])
}

/**
 * RFC 6154 special-use beats name conventions: a server that says \\Sent is
 * right even when the folder is called "Objets envoyés".
 */
function imapFolderRoleFor(
  path: string,
  specialUse: string | undefined,
): Mailbox['role'] {
  switch (specialUse) {
    case '\\Sent':
      return 'sent'
    case '\\Drafts':
      return 'drafts'
    case '\\Trash':
      return 'trash'
    case '\\Archive':
    case '\\All':
      return 'archive'
    case '\\Junk':
      return 'custom'
    default:
      return imapFolderRole(path)
  }
}

export interface BridgeTransportConfig {
  profileId: string
  imap: { host: string; port: number; security: ImapSecurity }
  smtp: { host: string; port: number; security: ImapSecurity }
  username: string
  /** Slug-scoped secrets key holding the password; the value never crosses. */
  passwordSecretKey: string
}

/**
 * The real transport, over the shell's `mailTransport.*` bridge (sockets in
 * the main process; ps-suite#397). This was a stub that rejected at connect
 * time from the day the provider was written — the roadmap's "shell socket
 * capability" follow-up. Messages arrive parsed (mailparser main-side), so
 * the envelope carries the HTML alternative and attachment metadata that the
 * old envelope type could never have: "IMAP accounts have no attachments"
 * was a transport limitation, not a protocol one.
 */
export function bridgeImapTransport(config: BridgeTransportConfig): ImapTransport {
  return {
    async connect() {
      await callMailTransport('MAIL_TRANSPORT_CONNECT', {
        profileId: config.profileId,
        imap: config.imap,
        username: config.username,
        passwordSecretKey: config.passwordSecretKey,
      })
    },
    async listFolders() {
      const folders = (await callMailTransport('MAIL_TRANSPORT_LIST_FOLDERS', {
        profileId: config.profileId,
      })) as Array<{ path: string; specialUse?: string }>
      return folders.map(folder => ({
        path: folder.path,
        role: imapFolderRoleFor(folder.path, folder.specialUse),
        ...(folder.specialUse === '\\All' ? { virtual: true } : {}),
      }))
    },
    async fetchMessages(folderPath, limit, since, beforeUid, headerSearch, uids) {
      const messages = (await callMailTransport(
        'MAIL_TRANSPORT_FETCH_MESSAGES',
        {
          profileId: config.profileId,
          folderPath,
          limit,
          ...(since ? { since } : {}),
          ...(headerSearch ? { headerSearch } : {}),
          ...(uids ? { uids } : {}),
          ...(typeof beforeUid === 'number' ? { beforeUid } : {}),
        },
      )) as Array<{
        uid: number
        messageId?: string
        inReplyTo?: string
        references?: string[]
  listUnsubscribe?: string
        subject: string
        from: { name: string; email: string } | null
        to: Array<{ name: string; email: string }>
        cc: Array<{ name: string; email: string }>
        date: string
        flags: string[]
        text: string
        html?: string
        icsText?: string
        attachments: ImapEnvelopeAttachment[]
      }>
      return messages.map(message => ({
        uid: message.uid,
        ...(message.messageId ? { messageId: message.messageId } : {}),
        // Threading headers: without them every message is its own
        // conversation and a sent thread never learns it was answered.
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
        ...(message.references?.length ? { references: message.references } : {}),
        subject: message.subject,
        ...(message.listUnsubscribe ? {listUnsubscribe:message.listUnsubscribe} : {}),
        from: message.from ?? { name: '', email: '' },
        to: message.to,
        ...(message.cc.length ? { cc: message.cc } : {}),
        date: message.date,
        body: message.text,
        ...(message.html ? { bodyHtml: message.html } : {}),
        ...(message.icsText ? { icsText: message.icsText } : {}),
        flags: message.flags,
        ...(message.attachments.length
          ? { attachments: message.attachments }
          : {}),
      }))
    },
    async setFlag(folderPath, uid, flag, on) {
      await callMailTransport('MAIL_TRANSPORT_SET_FLAG', {
        profileId: config.profileId,
        folderPath,
        uid,
        flag,
        on,
      })
    },
    async move(folderPath, uid, toFolderPath) {
      await callMailTransport('MAIL_TRANSPORT_MOVE', {
        profileId: config.profileId,
        folderPath,
        uid,
        toFolderPath,
      })
    },
    async append(folderPath, rawMime) {
      const result = (await callMailTransport('MAIL_TRANSPORT_APPEND', {
        profileId: config.profileId,
        folderPath,
        rawMime,
      })) as { uid: number | null }
      return result.uid ?? undefined
    },
    async deleteMessage(folderPath, uid) {
      await callMailTransport('MAIL_TRANSPORT_DELETE_MESSAGE', {
        profileId: config.profileId,
        folderPath,
        uid,
      })
    },
    async fetchAttachment(folderPath, uid, partId) {
      return (await callMailTransport('MAIL_TRANSPORT_FETCH_ATTACHMENT', {
        profileId: config.profileId,
        folderPath,
        uid,
        partId,
      })) as { base64: string; contentType: string; filename: string }
    },
    async searchAll(query, limit) {
      return (await callMailTransport('MAIL_TRANSPORT_SEARCH', {
        profileId: config.profileId,
        query,
        limit,
      })) as Array<{
        folderPath: string
        uid: number
        messageId?: string
        subject: string
        from: { name: string; email: string } | null
        date: string
      }>
    },
  }
}

export function bridgeSmtpTransport(config: BridgeTransportConfig): SmtpTransport {
  const checkResult = (raw: unknown): { rejected: string[] } => {
    const result = raw as { ok?: boolean; outcome?: 'not_sent' | 'uncertain'; error?: string; rejected?: unknown } | null
    if (result?.ok === false) throw new MailSendError(result.error || 'SMTP submission failed.', result.outcome === 'not_sent' ? 'not_sent' : 'uncertain')
    if (result?.ok !== true) throw new MailSendError('The mail transport returned no send confirmation. Check Sent before retrying.', 'uncertain')
    return { rejected: Array.isArray(result.rejected) ? result.rejected.filter((address): address is string => typeof address === 'string') : [] }
  }
  return {
    async verify() {
      checkResult(await callMailTransport('MAIL_TRANSPORT_SMTP_SEND', {
        reportOutcome: true,
        profileId: config.profileId, smtp: config.smtp, username: config.username,
        passwordSecretKey: config.passwordSecretKey,
        verifyOnly: true, from: '', to: [], rawMime: '',
      }))
    },
    async send(rawMime, from, to) {
      try {
      return checkResult(await callMailTransport('MAIL_TRANSPORT_SMTP_SEND', {
        reportOutcome: true,
        profileId: config.profileId,
        smtp: config.smtp,
        username: config.username,
        passwordSecretKey: config.passwordSecretKey,
        from,
        to,
        rawMime,
      }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('No stored password under secrets key')) {
          throw new MailSendError('The saved outgoing-mail password is missing or could not be unlocked. Open Mail settings, edit this connection, and re-save its IMAP and SMTP passwords. For Proton Bridge, use the passwords shown by Bridge. Then retry your response.', 'not_sent')
        }
        throw error
      }
    },
  }
}

/** Map a folder path onto a mailbox role by convention. */
export function imapFolderRole(path: string): Mailbox['role'] {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'inbox') return 'inbox'
  if (name.startsWith('sent')) return 'sent'
  if (name.startsWith('draft')) return 'drafts'
  if (name === 'trash' || name.startsWith('deleted')) return 'trash'
  if (name === 'archive' || name === 'all mail') return 'archive'
  return 'custom'
}

export interface ImapAccountPreset {
  id: 'gmail-app-password' | 'proton-bridge' | 'generic'
  label: string
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  smtpHost: string
  smtpPort: number
  smtpSecurity: ImapSecurity
  note?: string
}

export const IMAP_ACCOUNT_PRESETS: ImapAccountPreset[] = [
  {
    id: 'gmail-app-password',
    label: 'Gmail (app password)',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    note: 'Needs Google two-step verification and an app password from account security.',
  },
  {
    id: 'proton-bridge',
    label: 'Proton Mail (Bridge)',
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecurity: 'starttls',
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecurity: 'starttls',
    note: 'Requires the Proton Mail Bridge app running locally; use the Bridge-generated password.',
  },
  {
    id: 'generic',
    label: 'Generic IMAP/SMTP',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'ssl',
    smtpHost: '',
    smtpPort: 587,
    smtpSecurity: 'starttls',
  },
]

export interface ImapAccountInput {
  email: string
  username: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
}

/** Required-field validation for the account form; empty array = valid. */
export function validateImapAccountInput(input: ImapAccountInput): string[] {
  const errors: string[] = []
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    errors.push('Enter the account email address.')
  if (!input.username.trim()) errors.push('Enter the IMAP username.')
  if (!input.imapHost.trim()) errors.push('Enter the IMAP host.')
  if (!(input.imapPort > 0 && input.imapPort < 65536))
    errors.push('IMAP port must be between 1 and 65535.')
  if (!input.smtpHost.trim()) errors.push('Enter the SMTP host.')
  if (!(input.smtpPort > 0 && input.smtpPort < 65536))
    errors.push('SMTP port must be between 1 and 65535.')
  return errors
}

const IMAP_ACCOUNT_ID = 'acct_imap'

const IMAP_MAILBOX_ID_PREFIX = 'imap_mbx_'

/**
 * True for a mailbox that mirrors a REAL folder on the IMAP server — as
 * opposed to a local label-backed box. Real folders take true provider
 * moves; local boxes archive-and-label.
 */
export function isImapMailboxId(mailboxId: string): boolean {
  return mailboxId.startsWith(IMAP_MAILBOX_ID_PREFIX)
}

/**
 * Newest-N per folder on a full fetch. Every folder is fetched (counts and
 * custom-folder mail depend on it), so the per-folder cap is what keeps a
 * mailbox with decades of Archive from becoming the boot payload.
 */
/** One page of a folder's window. The window decides WHICH messages. */
const FOLDER_FETCH_PAGE = 200

/**
 * A stop on runaway folders — a mailing-list archive inside a wide window
 * is not worth thirty round trips. Reaching it is reported, never silent.
 */
const FOLDER_FETCH_MAX_PAGES = 12

interface ThreadLocation {
  folder: string
  uid: number
}

export interface ImapMailProviderOptions {
  email: string
  name?: string
  imap: ImapTransport
  smtp: SmtpTransport
  settings?: Partial<MailStore['settings']>
}

/**
 * MailProvider over IMAP/SMTP transports. Honest capability surface:
 * folders instead of labels, IMAP flag semantics for read/star, APPEND
 * for drafts, SMTP for compose. No bulk provider actions — the M0
 * capability gates degrade the UI accordingly.
 */
export class ImapMailProvider implements MailProvider {
  readonly capabilities: MailProviderCapabilities = {
    compose: true,
    drafts: true,
    labels: false,
    bulkActions: false,
  }

  private remoteHits = new Map<string, { folderPath: string; uid: number }>()
  private store: MailStore | null = null
  private folders: ImapFolder[] = []
  private locations = new Map<string, ThreadLocation[]>()
  private sentRepairJobs = new Map<string, Promise<MailMessage>>()

  constructor(private readonly options: ImapMailProviderOptions) {}

  private folderByRole(role: Mailbox['role']): ImapFolder | null {
    // Never pick a virtual mirror as a move TARGET: "archive to All Mail"
    // is a no-op at best and a Bridge error at worst; Proton's real
    // Archive folder is the honest destination.
    return (
      this.folders.find(folder => folder.role === role && !folder.virtual) ??
      this.folders.find(folder => folder.role === role) ??
      null
    )
  }

  private isVirtualFolderPath(path: string): boolean {
    return (
      this.folders.find(folder => folder.path === path)?.virtual === true
    )
  }

  async fetchStore(): Promise<MailStore> {
    await this.options.imap.connect()
    this.folders = await this.options.imap.listFolders()
    const base = {
      ...emptyMailStore(),
      settings: {
        ...emptyMailStore().settings,
        ...(this.options.settings ?? {}),
      },
    }
    const account = {
      id: IMAP_ACCOUNT_ID,
      // Was 'demo' — which told every provider gate downstream that this
      // account is the local simulation, fake-send branches included.
      provider: 'imap' as const,
      name: this.options.name ?? this.options.email,
      email: this.options.email,
      syncState: 'online' as const,
    }
    const unreadByFolder = new Map<string, number>()
    const messages: MailMessage[] = []
    const threads: MailThread[] = []
    const drafts: Draft[] = []
    const starredThreadIds: string[] = []
    this.locations = new Map()
    const threadIdByKey = new Map<string, string>()
    // EVERY folder, not just inbox/sent/trash: custom folders (and with
    // Proton Bridge, the Folders/ and Labels/ hierarchies) showed a
    // permanent 0 in the rail because their mail was simply never fetched.
    //
    // Read every folder BEFORE threading anything: a conversation spans
    // Sent and Inbox, so which folder was read first must not decide what
    // belongs together (mailThreading.ts).
    // "Last 30 days" has to mean 30 days: the window the user chose picks
    // the messages, server-side, instead of the newest N by sequence.
    const windowStart = mailFetchWindowStartDate(
      this.options.settings?.fetchWindow ?? DEFAULT_MAIL_FETCH_WINDOW,
    ).toISOString()
    const fetched: { folder: ImapFolder; envelope: ImapEnvelope; handle: string }[] = []
    /** Copies of a message we skipped, still needed so moves reach them. */
    const extraLocations = new Map<string, ThreadLocation[]>()
    const seenMessageIds = new Map<string, string>()
    // Real folders before virtual mirrors: with Proton's All Mail every
    // message exists twice, and the copy worth keeping is the one in the
    // folder it actually lives in.
    const foldersRealFirst = [
      ...this.folders.filter(folder => !folder.virtual),
      ...this.folders.filter(folder => folder.virtual),
    ]
    let draftsCovered = foldersRealFirst.some(folder => folder.role === 'drafts')
    for (const folder of foldersRealFirst) {
      // Walk the window newest-first, a page at a time, until the folder
      // runs out. A cap that quietly cut the window was the whole bug.
      const envelopes: ImapEnvelope[] = []
      let beforeUid: number | undefined
      let exhausted = false
      for (let page = 0; page < FOLDER_FETCH_MAX_PAGES; page += 1) {
        const batch = await this.options.imap.fetchMessages(
          folder.path,
          FOLDER_FETCH_PAGE,
          // Unsent work has no expiry. A windowed Drafts read cannot prove
          // an older draft was sent or deleted in another client.
          folder.role === 'drafts' ? undefined : windowStart,
          beforeUid,
        )
        if (batch.length === 0) { exhausted = true; break }
        envelopes.push(...batch)
        const lowest = Math.min(...batch.map(item => item.uid))
        // A page that could not go lower would repeat itself forever.
        if (batch.length < FOLDER_FETCH_PAGE) { exhausted = true; break }
        if (beforeUid !== undefined && lowest >= beforeUid) break
        beforeUid = lowest
      }
      if (folder.role === 'drafts' && !exhausted) draftsCovered = false
      for (const envelope of envelopes) {
        const handle = `uid_${folder.path}_${envelope.uid}`
        const messageId = normalizeMessageId(envelope.messageId)
        const alreadyHave = messageId ? seenMessageIds.get(messageId) : undefined
        if (alreadyHave) {
          // The same message, mirrored into another folder. One message,
          // several locations — not two messages, which is what put a sent
          // note and its reply in two different threads.
          extraLocations.set(alreadyHave, [
            ...(extraLocations.get(alreadyHave) ?? []),
            { folder: folder.path, uid: envelope.uid },
          ])
          continue
        }
        if (messageId) seenMessageIds.set(messageId, handle)
        fetched.push({ folder, envelope, handle })
      }
    }
    const conversationKeys = assignConversationKeys(
      fetched.map(item => ({
        envelope: { ...item.envelope, date: item.envelope.date },
        fallback: item.handle,
      })),
    )
    {
      for (const { folder, envelope, handle } of fetched) {
        const role = folder.role
        const key = conversationKeys.get(handle) ?? handle
        let threadId = threadIdByKey.get(key)
        const messageId = `imap_msg_${folder.path}_${envelope.uid}`
        const read = envelope.flags.includes('\\Seen')
        if (!read) {
          unreadByFolder.set(
            folder.path,
            (unreadByFolder.get(folder.path) ?? 0) + 1,
          )
        }
        if (!threadId) {
          threadId = threadIdForKey(key)
          threadIdByKey.set(key, threadId)
          threads.push({
            id: threadId,
            accountId: account.id,
            mailboxId: `imap_mbx_${folder.path}`,
            subject: envelope.subject || '(no subject)',
          ...(envelope.listUnsubscribe ? {listUnsubscribe:envelope.listUnsubscribe} : {}),
            participants: [envelope.from, ...envelope.to],
            labels: [],
            status:
              role === 'inbox'
                ? 'inbox'
                : role === 'archive'
                  ? 'archived'
                  : 'waiting',
            priority: 'none',
            summary: envelope.body.slice(0, 160),
            lastMessageAt: envelope.date,
            syncState: 'synced',
          })
        }
        const thread = threads.find(item => item.id === threadId)!
        if (envelope.date > thread.lastMessageAt) {
          thread.lastMessageAt = envelope.date
        }
        if (envelope.flags.includes('\\Flagged')) {
          if (!starredThreadIds.includes(threadId))
            starredThreadIds.push(threadId)
        }
        // A message in the Drafts folder IS a draft, flag or no flag —
        // Bridge and some servers do not stamp \Draft on stored drafts.
        const isDraft = role === 'drafts' || envelope.flags.includes('\\Draft')
        // Same rule as the Gmail provider: an attached ICS parses into a
        // first-class invite at fetch time, so the invite card, RSVP flow,
        // and the PureCalendar mirror all light up for Bridge-delivered mail.
        const calendarInvite = envelope.icsText
          ? parseCalendarInvite(envelope.icsText) ?? undefined
          : undefined
        const attachments = (envelope.attachments ?? []).map(attachment => ({
          id: `imap_att_${envelope.uid}_${attachment.partId}`,
          name: attachment.filename,
          mimeType: attachment.contentType,
          sizeLabel: formatAttachmentBytes(attachment.size),
          size: attachment.size,
          remote: {
            provider: 'imap' as const,
            folderPath: folder.path,
            uid: envelope.uid,
            partId: attachment.partId,
          },
        }))
        messages.push({
          id: messageId,
          threadId,
          sentCopyPresent: role === 'sent' || (extraLocations.get(handle) ?? []).some(location => this.folders.some(item => item.path === location.folder && item.role === 'sent')),
          ...(envelope.messageId
            ? { messageIdHeader: envelope.messageId }
            : {}),
          inReplyTo: envelope.inReplyTo,
          references: envelope.references,
          from: envelope.from,
          to: envelope.to,
          ...(envelope.cc?.length ? { cc: envelope.cc } : {}),
          subject: envelope.subject || '(no subject)',
          ...(envelope.listUnsubscribe ? {listUnsubscribe:envelope.listUnsubscribe} : {}),
          body: envelope.body,
          ...(envelope.bodyHtml ? { bodyHtml: envelope.bodyHtml } : {}),
          receivedAt: envelope.date,
          // Metadata now, content on demand via getAttachmentContent — the
          // same shape Gmail attachments use. "IMAP accounts have no
          // attachments" was the old envelope's limitation, not IMAP's.
          attachments,
          read,
          ...(isDraft ? { isDraft: true } : {}),
          ...(calendarInvite ? { calendarInvite } : {}),
        })
        // A stored draft must also be an EDITABLE Draft record — the same
        // rule Gmail follows (see draftsFromMessages there). Without it a
        // draft written elsewhere arrived as an inert isDraft message: no
        // composer, no Send, no id to update or delete it with.
        if (isDraft && role === 'drafts') {
          drafts.push({
            id: `imap_draft_${envelope.uid}`,
            threadId,
            to: envelope.to,
            ...(envelope.cc?.length ? { cc: envelope.cc } : {}),
            subject:
              envelope.subject === '(no subject)' ? '' : envelope.subject,
            body: envelope.body,
            ...(envelope.bodyHtml ? { bodyHtml: envelope.bodyHtml } : {}),
            providerDraftId: `imap_draft_${envelope.uid}`,
            providerDraftMessageId: messageId,
            attachments,
            updatedAt: envelope.date,
            syncState: 'synced',
            source: 'manual',
            draftKind: 'manual',
            provenance: ['Written outside PureMail; synced from the account.'],
          })
        }
        this.locations.set(threadId, [
          ...(this.locations.get(threadId) ?? []),
          { folder: folder.path, uid: envelope.uid },
          ...(extraLocations.get(handle) ?? []),
        ])
      }
    }
    const mailboxes: Mailbox[] = this.folders.map(folder => ({
      id: `imap_mbx_${folder.path}`,
      accountId: account.id,
      name: folder.path.split('/').pop() ?? folder.path,
      role: folder.role,
      unreadCount: unreadByFolder.get(folder.path) ?? 0,
    }))
    this.store = {
      ...base,
      accounts: [account],
      mailboxes,
      threads,
      messages,
      drafts,
      starredThreadIds,
      syncCoverage: { messagesCoveredFrom: windowStart, draftsCovered },
    }
    return this.store
  }

  async fetchThreadById(threadId: string, cachedMessages: MailMessage[] = [], signal?: AbortSignal) {
    signal?.throwIfAborted()
    const seeds = [...cachedMessages, ...(this.store?.messages ?? [])].filter(message => message.threadId === threadId)
    const pending = new Set<string>()
    const addId = (value?: string) => { const id = normalizeMessageId(value); if (id) pending.add(id) }
    for (const message of seeds) {
      addId(message.messageIdHeader)
      addId(message.inReplyTo)
      message.references?.forEach(addId)
    }
    const remoteHit = this.remoteHits.get(threadId)
    if (!pending.size && !remoteHit) return null
    await this.options.imap.connect()
    const folders = await this.options.imap.listFolders()
    const found = new Map<string, ImapEnvelope[]>()
    if (remoteHit) {
      const envelope = (await this.options.imap.fetchMessages(remoteHit.folderPath, 1, undefined, undefined, undefined, [remoteHit.uid]))
        .find(message => message.uid === remoteHit.uid)
      if (!envelope) throw new Error('This message is no longer in its server folder. Search again to find its current location.')
      found.set(remoteHit.folderPath, [envelope])
      addId(envelope.messageId)
      addId(envelope.inReplyTo)
      envelope.references?.forEach(addId)
    }
    const searched = new Set<string>()
    // Exact RFC message-id links, never subject matching. Search is not
    // constrained by the inbox sync window, and each result is paginated.
    while ([...pending].some(id => !searched.has(id))) {
      const ids = [...pending].filter(value => !searched.has(value)).slice(0, 50)
      if (searched.size + ids.length > 200) throw new Error('Thread history exceeds the lookup limit; only synced messages are shown.')
      ids.forEach(id => searched.add(id))
      const headers = ids.flatMap(id => ['Message-ID', 'In-Reply-To', 'References'].map(name => ({ name, value: `<${id}>` })))
      for (const folder of folders) {
        let before: number | undefined
        for (;;) {
          signal?.throwIfAborted()
          const batch = await this.options.imap.fetchMessages(folder.path, FOLDER_FETCH_PAGE, undefined, before, headers)
          if (!batch.length) break
          for (const envelope of batch) {
            const links = [envelope.messageId, envelope.inReplyTo, ...(envelope.references ?? [])].map(normalizeMessageId)
            if (!ids.some(id => links.includes(id))) continue
            const items = found.get(folder.path) ?? []
            if (!items.some(item => item.uid === envelope.uid)) items.push(envelope)
            found.set(folder.path, items)
            links.forEach(value => { if (value) pending.add(value) })
          }
          const lowest = Math.min(...batch.map(item => item.uid))
          if (batch.length < FOLDER_FETCH_PAGE || (before !== undefined && lowest >= before)) break
          before = lowest
        }
      }
    }
    signal?.throwIfAborted()
    // Reuse the regular parser, attachment and duplicate-location handling.
    const parser = new ImapMailProvider({ ...this.options, imap: {
      ...this.options.imap,
      connect: async () => {},
      listFolders: async () => folders,
      fetchMessages: async (path, limit = FOLDER_FETCH_PAGE, _since, before) =>
        (found.get(path) ?? []).filter(item => before === undefined || item.uid < before)
          .sort((a, b) => b.uid - a.uid).slice(0, limit),
    } })
    const parsed = await parser.fetchStore()
    const locations = [...parser.locations.values()].flat()
    const original = this.store?.threads.find(thread => thread.id === threadId)
    const thread = original ?? parsed.threads[0]
    if (!thread) return null
    this.locations.set(threadId, [...(this.locations.get(threadId) ?? []), ...locations]
      .filter((location, index, all) => all.findIndex(item => item.folder === location.folder && item.uid === location.uid) === index))
    this.folders = folders
    const messages = parsed.messages.map(message => ({ ...message, threadId }))
    const fragment = { threads: [{ ...thread, id: threadId }], messages }
    if (this.store) {
      const ids = new Set(messages.map(message => message.id))
      this.store = { ...this.store,
        threads: [...this.store.threads.filter(item => item.id !== threadId), ...fragment.threads],
        messages: [...this.store.messages.filter(item => !ids.has(item.id)), ...messages],
      }
    }
    return fragment
  }

  async sync(store?: MailStore): Promise<MailStore> {
    const fresh = await this.fetchStore()
    // Windowed refreshes do not invalidate locations of older loaded mail.
    // IDs encode the real folder and UID, including after an app restart.
    for (const message of store?.messages ?? []) {
      if (!fresh.threads.some(thread => thread.id === message.threadId)) continue
      if (message.receivedAt >= fresh.syncCoverage!.messagesCoveredFrom!) continue
      const match = /^imap_msg_(.+)_(\d+)$/.exec(message.id)
      if (!match) continue
      const locations = this.locations.get(message.threadId) ?? []
      const location = { folder: match[1]!, uid: Number(match[2]) }
      if (!locations.some(item => item.folder === location.folder && item.uid === location.uid)) {
        this.locations.set(message.threadId, [...locations, location])
      }
    }
    return {
      ...fresh,
      settings: { ...fresh.settings, ...(store?.settings ?? {}) },
    }
  }

  private async eachLocation(
    threadId: string,
    apply: (location: ThreadLocation) => Promise<void>,
    options: { skipVirtual?: boolean } = {},
  ): Promise<void> {
    for (const location of this.locations.get(threadId) ?? []) {
      if (options.skipVirtual && this.isVirtualFolderPath(location.folder)) {
        // The mirror copy follows the real one on the server; moving it
        // ourselves fails and used to abort the whole thread's mutation.
        continue
      }
      await apply(location)
    }
  }

  private async moveThreadToRole(
    threadId: string,
    role: Mailbox['role'],
  ): Promise<void> {
    const target = this.folderByRole(role)
    if (!target) throw new Error(`No ${role} folder on this account.`)
    await this.eachLocation(
      threadId,
      location =>
        this.options.imap.move(location.folder, location.uid, target.path),
      { skipVirtual: true },
    )
    this.locations.set(
      threadId,
      (this.locations.get(threadId) ?? []).map(location => ({
        ...location,
        folder: target.path,
      })),
    )
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.moveThreadToRole(threadId, 'archive')
  }

  /**
   * Back to the inbox folder. Absent, unarchive silently stayed local-only
   * (the shell's executor probes for this method) while Gmail and demo both
   * honoured it — the classic parity hole.
   */
  async unarchiveThread(threadId: string): Promise<void> {
    await this.moveThreadToRole(threadId, 'inbox')
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.moveThreadToRole(threadId, 'trash')
  }

  async moveThread(threadId: string, mailboxId: string): Promise<void> {
    const path = mailboxId.replace(/^imap_mbx_/, '')
    await this.eachLocation(
      threadId,
      location => this.options.imap.move(location.folder, location.uid, path),
      { skipVirtual: true },
    )
  }

  async markThreadRead(threadId: string, read: boolean): Promise<void> {
    await this.eachLocation(threadId, location =>
      this.options.imap.setFlag(location.folder, location.uid, '\\Seen', read),
    )
  }

  async setThreadStarred(threadId: string, starred: boolean): Promise<void> {
    await this.eachLocation(threadId, location =>
      this.options.imap.setFlag(
        location.folder,
        location.uid,
        '\\Flagged',
        starred,
      ),
    )
  }

  async labelThread(): Promise<void> {
    // IMAP has folders, not labels (capabilities.labels = false). The UI
    // offers folder moves instead; a label call is a local-only no-op.
  }

  /**
   * Attachment bytes for an outgoing message: local content as-is, remote
   * IMAP attachments re-fetched on demand, anything else refused loudly —
   * the old builder passed `attachments: []`, silently sending and storing
   * every draft WITHOUT its attachments.
   */
  private async resolveOutgoingAttachments(
    attachments: Attachment[],
  ): Promise<MimeAttachmentPart[]> {
    const resolved = await Promise.all(
      attachments.map(async attachment => {
        if (attachment.content) return attachment
        if (attachment.remote?.provider !== 'imap') {
          throw new Error(
            `Attachment "${attachment.name}" has no content to send. Remove it or attach the file again.`,
          )
        }
        return this.getAttachmentContent(
          // getAttachmentContent only reads the attachment argument.
          undefined as unknown as MailMessage,
          attachment,
        )
      }),
    )
    const totalBytes = totalAttachmentBytes(resolved)
    if (totalBytes > GMAIL_ATTACHMENT_LIMIT_BYTES) {
      throw new Error(
        `Attachments total ${formatAttachmentBytes(
          totalBytes,
        )} — the 25 MB limit applies. Remove some attachments and try again.`,
      )
    }
    return resolved.map(attachment => {
      const base64 = attachmentContentToBase64(attachment)
      if (base64 === null) {
        throw new Error(
          `Attachment "${attachment.name}" could not be encoded for sending.`,
        )
      }
      return {
        name: attachment.name,
        mimeType: attachment.mimeType,
        base64,
      }
    })
  }

  private async draftRaw(draft: Draft, messageId?: string): Promise<string> {
    const cc = draft.cc ?? []
    const bcc = draft.bcc ?? []
    const format = (contacts: MailContact[]): string =>
      contacts
        .map(contact =>
          contact.name && contact.name !== contact.email
            ? `${contact.name} <${contact.email}>`
            : contact.email,
        )
        .join(', ')
    const threadMessages = (this.store?.messages ?? []).filter(message => message.threadId === draft.threadId && !message.isDraft).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    const references = [...new Set(threadMessages.flatMap(message => [...(message.references ?? []), ...(message.messageIdHeader ? [message.messageIdHeader] : [])]))]
    const inReplyTo = draft.sourceMessageId ? threadMessages.find(message => message.id === draft.sourceMessageId)?.messageIdHeader ?? references.at(-1) : references.at(-1)
    return buildMimeMessage({
      headerLines: [
        `Date: ${new Date().toUTCString()}`,
        ...(messageId ? [`Message-ID: ${messageId}`] : []),
        ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${references.join(' ')}`] : []),
        `From: ${this.options.email}`,
        `To: ${format(draft.to)}`,
        ...(cc.length ? [`Cc: ${format(cc)}`] : []),
        ...(bcc.length ? [`Bcc: ${format(bcc)}`] : []),
        `Subject: ${draft.subject}`,
      ],
      body: draft.body,
      ...(draft.bodyHtml ? { bodyHtml: draft.bodyHtml } : {}),
      attachments: await this.resolveOutgoingAttachments(draft.attachments),
    })
  }

  private draftsFolderPath(): string {
    const drafts = this.folderByRole('drafts')
    if (!drafts) throw new Error('No Drafts folder on this account.')
    return drafts.path
  }

  /** UID out of a provider draft id, or null when the id is not one of ours. */
  private static draftUid(providerDraftId: string): number | null {
    const uid = Number(providerDraftId.replace(/^imap_draft_/, ''))
    return Number.isInteger(uid) && uid > 0 ? uid : null
  }

  async getAttachmentContent(
    _message: MailMessage,
    attachment: Attachment,
  ): Promise<Attachment> {
    if (attachment.content) return attachment
    const remote =
      attachment.remote?.provider === 'imap' ? attachment.remote : undefined
    if (!remote || !this.options.imap.fetchAttachment) {
      throw new Error('This attachment cannot be downloaded.')
    }
    const fetched = await this.options.imap.fetchAttachment(
      remote.folderPath,
      remote.uid,
      remote.partId,
    )
    return {
      ...attachment,
      content: `data:${fetched.contentType};base64,${fetched.base64}`,
    }
  }

  async createDraft(draft: Draft): Promise<string> {
    const path = this.draftsFolderPath()
    const raw = await this.draftRaw(draft)
    let uid: number | void
    try { uid = await this.options.imap.append(path, raw) } catch (error) {
      throw new MailDraftSaveUncertain(`The account did not confirm the draft save. Check its Drafts folder before retrying. (${error instanceof Error ? error.message : 'Connection failed'})`)
    }
    if (typeof uid !== 'number') {
      throw new MailDraftSaveUncertain(
        'This server did not report the stored draft’s id (APPENDUID), so PureMail cannot update or delete it later. The draft is kept locally.',
      )
    }
    return `imap_draft_${uid}`
  }

  /**
   * IMAP has no edit: the old message is replaced by a new one. Append first,
   * delete second — the reverse order loses the draft entirely if the append
   * then fails.
   */
  async updateDraft(
    providerDraftId: string,
    draft: Draft,
  ): Promise<string | { providerDraftId: string; warning?: string; staleProviderDraftIds?: string[]; attachments?: Attachment[] }> {
    const path = this.draftsFolderPath()
    const previousUid = ImapMailProvider.draftUid(providerDraftId)
    // IMAP replacement deletes the UID attachment references point at.
    // Keep the fetched bytes locally before removing that message.
    const attachments = await Promise.all(draft.attachments.map(async attachment => {
      if (attachment.content || attachment.remote?.provider !== 'imap') return attachment
      const hydrated = await this.getAttachmentContent(undefined as unknown as MailMessage, attachment)
      const { remote: _remote, ...local } = hydrated
      return local
    }))
    const raw = await this.draftRaw({ ...draft, attachments })
    let uid: number | void
    try { uid = await this.options.imap.append(path, raw) } catch (error) {
      throw new MailDraftSaveUncertain(`The account did not confirm the draft save. Check its Drafts folder before retrying. (${error instanceof Error ? error.message : 'Connection failed'})`)
    }
    if (typeof uid !== 'number') {
      throw new MailDraftSaveUncertain('This server did not report the updated draft’s id. Check Drafts before retrying.')
    }
    if (previousUid !== null && this.options.imap.deleteMessage) {
      try { await this.options.imap.deleteMessage(path, previousUid) } catch {
        return { attachments, providerDraftId: `imap_draft_${uid}`, staleProviderDraftIds: [...(draft.staleProviderDraftIds ?? []), providerDraftId], warning: 'Your edited draft was saved, but the previous account copy could not be removed. Older copies in Drafts must not be sent.' }
      }
    }
    // IMAP has no edit: the stored draft was REPLACED. Report the new id
    // so the caller re-points the local record at it.
    return attachments.some((attachment, index) => attachment !== draft.attachments[index])
      ? { providerDraftId: `imap_draft_${uid}`, attachments }
      : `imap_draft_${uid}`
  }

  /**
   * The account's Drafts folder, as id pairs. IMAP has no draft objects — a
   * draft is a message in a folder — so the "draft id" is its UID and the
   * message id is the one this provider mints for the same UID.
   */
  async listDrafts(): Promise<ProviderDraftRef[]> {
    const drafts = this.folderByRole('drafts')
    if (!drafts) return []
    const envelopes = await this.options.imap.fetchMessages(drafts.path)
    return envelopes.map(envelope => ({
      providerDraftId: `imap_draft_${envelope.uid}`,
      messageId: `imap_msg_${drafts.path}_${envelope.uid}`,
      threadId: this.threadIdForDraftUid(drafts.path, envelope.uid),
    }))
  }

  /** The thread this stored draft was filed under, when we know of one. */
  private threadIdForDraftUid(folderPath: string, uid: number): string {
    for (const [threadId, locations] of this.locations) {
      if (
        locations.some(
          location => location.folder === folderPath && location.uid === uid,
        )
      ) {
        return threadId
      }
    }
    return `imap_thread_draft_${uid}`
  }

  async deleteDraft(providerDraftId: string): Promise<void> {
    const uid = ImapMailProvider.draftUid(providerDraftId)
    if (uid === null) return
    if (!this.options.imap.deleteMessage) {
      throw new Error('This account’s transport cannot delete messages.')
    }
    await this.options.imap.deleteMessage(this.draftsFolderPath(), uid)
  }

  async testConnection(): Promise<{ receiving: string; sending: string }> {
    const bounded = async (check: Promise<unknown>): Promise<unknown> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([check, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Connection test timed out after 32 seconds.')), 32_000)
        })])
      } finally { if (timer) clearTimeout(timer) }
    }
    const [incoming, outgoing] = await Promise.allSettled([
      bounded(this.options.imap.listFolders()),
      bounded(this.options.smtp.verify ? this.options.smtp.verify() : Promise.reject(new Error('Outgoing connection testing is unavailable in this version.'))),
    ])
    const result = (value: PromiseSettledResult<unknown>, success: string) => value.status === 'fulfilled'
      ? success : `Failed: ${value.reason instanceof Error ? value.reason.message : String(value.reason)}`
    return { receiving: result(incoming, 'IMAP connection verified'), sending: result(outgoing, 'SMTP authentication verified; no test email sent') }
  }

  async send(input: SendDraftInput): Promise<MailMessage> {
    const messageId = input.draft.sendMessageId ?? `<puremail-${crypto.randomUUID()}@${this.options.email.split('@')[1] || 'localhost'}>`
    let raw: string
    try { raw = await this.draftRaw(input.draft, messageId) } catch (error) {
      throw new MailSendError(`Message not sent: ${error instanceof Error ? error.message : 'Attachments could not be prepared.'}`, 'not_sent')
    }
    const warnings: string[] = []
    const recipients = [
      ...input.draft.to,
      ...(input.draft.cc ?? []),
      ...(input.draft.bcc ?? []),
    ].map(contact => contact.email)
    const submission = await this.options.smtp.send(raw, this.options.email, recipients)
    const rejectedRecipients = submission?.rejected ?? []
    if (rejectedRecipients.length) warnings.push(`Sent to the accepted recipients, but the mail server rejected: ${rejectedRecipients.join(', ')}. Do not resend the original message; write separately to these addresses after correcting them.`)
    // Some SMTP services file Sent themselves; only append a missing copy.
    const sent = this.folderByRole('sent')
    let sentCopyPresent = false
    if (sent) {
      try {
        const copies = await this.options.imap.fetchMessages(sent.path, 1, undefined, undefined, { name: 'Message-ID', value: messageId })
        if (!copies.some(copy => copy.messageId === messageId)) await this.options.imap.append(sent.path, raw)
        sentCopyPresent = true
      } catch {
        warnings.push('The server accepted this message, but saving its IMAP Sent copy failed. Do not resend it.')
      }
    } else warnings.push('The server accepted this message, but no Sent folder was available to save its copy. Do not resend it.')
    for (const draftId of new Set([input.draft.providerDraftId, ...(input.draft.staleProviderDraftIds ?? [])].filter((id): id is string => Boolean(id)))) {
      try { await this.deleteDraft(draftId) } catch {
        warnings.push('The server accepted this message, but its old Drafts copy could not be removed. Do not resend the draft.')
      }
    }
    return {
      messageIdHeader: messageId,
      deliveryAccepted: true,
      sentCopyPresent,
      ...(!sentCopyPresent ? { sentCopyMime: raw } : {}),
      ...(rejectedRecipients.length ? { deliveryRejectedRecipients: rejectedRecipients } : {}),
      ...(warnings.length ? { deliveryWarnings: warnings } : {}),
      id: `imap_sent_${Date.now()}`,
      threadId: input.threadId,
      from: { name: this.options.name ?? 'Me', email: this.options.email },
      to: input.draft.to,
      cc: input.draft.cc ?? [],
      bcc: input.draft.bcc ?? [],
      subject: input.draft.subject,
      body: input.draft.body,
      ...(input.draft.bodyHtml ? { bodyHtml: input.draft.bodyHtml } : {}),
      receivedAt: new Date().toISOString(),
      attachments: input.draft.attachments,
      read: true,
    }
  }

  repairSentRecord(message: MailMessage): Promise<MailMessage> {
    if (!message.deliveryAccepted || !message.messageIdHeader) return Promise.reject(new Error('This message has no confirmed send receipt. Check Sent before any retry.'))
    const key = message.messageIdHeader
    const existing = this.sentRepairJobs.get(key)
    if (existing) return existing
    const job = this.repairAcceptedCopies(message).finally(() => this.sentRepairJobs.delete(key))
    this.sentRepairJobs.set(key, job)
    return job
  }

  private async repairAcceptedCopies(message: MailMessage): Promise<MailMessage> {
    const sent = this.folderByRole('sent')
    if (!sent) throw new Error('No Sent folder is available on this account.')
    const copies = await this.options.imap.fetchMessages(sent.path, 1, undefined, undefined, { name: 'Message-ID', value: message.messageIdHeader! })
    if (!copies.some(copy => copy.messageId === message.messageIdHeader)) {
      const format = (contacts: MailContact[]) => contacts.map(contact => contact.name && contact.name !== contact.email ? `${contact.name} <${contact.email}>` : contact.email).join(', ')
      const raw = message.sentCopyMime ?? buildMimeMessage({
        headerLines: [
          `Date: ${new Date(message.receivedAt).toUTCString()}`,
          `Message-ID: ${message.messageIdHeader}`,
          `From: ${this.options.email}`,
          `To: ${format(message.to)}`,
          ...(message.cc?.length ? [`Cc: ${format(message.cc)}`] : []),
          ...(message.bcc?.length ? [`Bcc: ${format(message.bcc)}`] : []),
          `Subject: ${message.subject}`,
          ...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
          ...(message.references?.length ? [`References: ${message.references.join(' ')}`] : []),
        ],
        body: message.body,
        ...(message.bodyHtml ? { bodyHtml: message.bodyHtml } : {}),
        attachments: await this.resolveOutgoingAttachments(message.attachments),
      })
      // If APPEND's acknowledgement is lost, the next repair searches this
      // stable Message-ID again before appending. SMTP is never involved.
      await this.options.imap.append(sent.path, raw)
    }
    const warnings = (message.deliveryWarnings ?? []).filter(warning => !warning.includes('IMAP Sent copy') && !warning.includes('no Sent folder') && !warning.includes('old Drafts copy'))
    for (const draftId of new Set(message.sentDraftProviderIds ?? (message.sentDraftProviderId ? [message.sentDraftProviderId] : []))) {
      const uid = ImapMailProvider.draftUid(draftId)
      if (uid === null) continue
      try {
        const remaining = await this.options.imap.fetchMessages(this.draftsFolderPath(), 1, undefined, undefined, undefined, [uid])
        if (remaining.some(copy => copy.uid === uid)) await this.deleteDraft(draftId)
      } catch { warnings.push('The server accepted this message, but its old Drafts copy could not be removed. Do not resend the draft.') }
    }
    return { ...message, sentCopyPresent: true, sentCopyMime: undefined, deliveryWarnings: warnings.length ? [...new Set(warnings)] : undefined }
  }

  /**
   * Server-side search past the local window — the agent tool
   * `searchAllMail` lights up off this method's presence, exactly as it
   * does for Gmail. IMAP SEARCH TEXT runs across every folder main-side;
   * hits carry no body, so the snippet stays empty rather than fabricated.
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
    if (!this.options.imap.searchAll) {
      throw new Error(
        'This account’s transport cannot search server-side; only locally synced mail is searchable.',
      )
    }
    if (!query.trim()) return []
    await this.options.imap.connect()
    const hits = await this.options.imap.searchAll(query.trim(), limit)
    const seenThreadIds = new Set<string>()
    const results: Array<{
      threadId: string
      subject: string
      from: string
      date: string
      snippet: string
      inLocalWindow: boolean
    }> = []
    for (const hit of hits) {
      const localMessage = this.store?.messages.find(
        message => message.id === `imap_msg_${hit.folderPath}_${hit.uid}` ||
          (Boolean(hit.messageId) && normalizeMessageId(message.messageIdHeader) === normalizeMessageId(hit.messageId)),
      )
      const threadId =
        localMessage?.threadId ??
        `imap_thread_remote_${encodeURIComponent(hit.messageId ?? `${hit.folderPath}:${hit.uid}`)}`
      // Virtual mirrors (Proton's All Mail holds a copy of everything)
      // return the same message once per folder; one row per thread.
      if (seenThreadIds.has(threadId)) continue
      seenThreadIds.add(threadId)
      if (!localMessage) this.remoteHits.set(threadId, hit)
      results.push({
        threadId,
        subject: hit.subject || '(no subject)',
        from: hit.from?.email ?? '',
        date: hit.date,
        snippet: '',
        inLocalWindow: Boolean(localMessage),
      })
    }
    return results
  }

  async search(query: string): Promise<
    Array<{
      id: string
      type: 'thread' | 'message' | 'task' | 'attachment'
      title: string
    }>
  > {
    if (!this.store || !query.trim()) return []
    return searchMailAndTasks(this.store, query).map(result => ({ ...result }))
  }
}
