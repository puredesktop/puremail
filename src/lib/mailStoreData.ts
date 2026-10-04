/**
 * Empty mailbox initialization and store persistence, extracted from mailModel.ts (phase 3).
 * Imports from mailModel are call-time only, so the module cycle is inert.
 */
import {
  defaultMailNotificationPreferences,
  MAIL_STORE_VERSION,
  migratePersistedMailStore,
} from './mailStoreMigration'
import {
  DEFAULT_FOLLOW_UP_SETTINGS,
  DEFAULT_MAIL_FETCH_INTERVAL_MINUTES,
  DEFAULT_MAIL_FETCH_WINDOW,
  isUnconfirmedGmailSend,
  type DateInput,
} from './mailModel'
import { compactMailText, stripHtmlToText } from './mailTextUtils'
import type {
  Attachment,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'


export function demoMailStore(): MailStore { return emptyMailStore() }

function strippedPersistedAttachment(attachment: Attachment): Attachment {
  // Attachment blobs (base64 data-URIs) are what blow the ~5MB localStorage
  // quota and silently kill ALL persistence. Content that can be re-fetched
  // from the provider on demand is never persisted.
  if (!attachment.content || !attachment.remote) return attachment
  const { content: _content, ...rest } = attachment
  return rest
}

function compactPersistedMessage(message: MailMessage): MailMessage {
  const attachments = message.attachments.some(
    attachment => attachment.content && attachment.remote,
  )
    ? message.attachments.map(strippedPersistedAttachment)
    : message.attachments

  if (!message.bodyHtml) {
    return attachments === message.attachments
      ? message
      : { ...message, attachments }
  }

  // Provider HTML is a re-fetchable rendering alternative, and frequently
  // carries megabytes of email-template CSS per message. Keeping every copy
  // made the persisted mailbox exceed 100 MB and trapped startup behind the
  // iframe bridge while that object was parsed and cloned. Plain text keeps
  // the cached conversation readable; the next sync restores rich HTML in
  // memory. For HTML-only mail, derive text before dropping the alternative.
  const { bodyHtml: _bodyHtml, ...withoutHtml } = message
  const body = message.body.trim()
    ? message.body
    : compactMailText(stripHtmlToText(message.bodyHtml))
  return { ...withoutHtml, body, attachments }
}

/**
 * The store shape that goes into localStorage: attachment metadata and
 * remote refs only, never re-fetchable blob content, and no single-fetch
 * sync metadata.
 */
export function persistableMailStore(store: MailStore): MailStore {
  return {
    ...store,
    aiTriage: undefined,
    syncCoverage: undefined,
    messages: store.messages
      // Never persist an unconfirmed Gmail send. Persisting these is what let
      // a local "sent" copy survive reload as a permanent phantom labeled as
      // synced-from-Gmail. Authoritative sent history comes from Gmail sync.
      .filter(message => !isUnconfirmedGmailSend(message))
      .map(compactPersistedMessage),
    drafts: store.drafts.map(draft =>
      draft.attachments.some(
        attachment => attachment.content && attachment.remote,
      )
        ? {
            ...draft,
            attachments: draft.attachments.map(strippedPersistedAttachment),
          }
        : draft,
    ),
  }
}

const PERSISTED_STORE_ARRAY_FIELDS = [
  'accounts',
  'mailboxes',
  'threads',
  'messages',
  'tasks',
  'taskLists',
  'drafts',
  'labels',
] as const

/**
 * Parse a persisted local store, rejecting malformed blobs instead of letting
 * them crash the boot merge. Required collections must be arrays of objects;
 * anything else means the blob is unusable and boot starts clean.
 */
export function parsePersistedMailStore(raw: string | null): MailStore | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Silence is correct here: callers own the user-facing reaction to a
    // null parse (usePureMailBoot warns and boots empty).
    return null
  }
  return parsePersistedMailStoreValue(parsed)
}

/**
 * The same validation against an already-parsed value. The filesystem store
 * hands back parsed JSON, and re-stringifying a multi-megabyte mailbox just to
 * re-parse it is real time at boot.
 */
export function parsePersistedMailStoreValue(
  parsed: unknown,
): MailStore | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.settings !== 'object' || candidate.settings === null) {
    return null
  }
  for (const field of PERSISTED_STORE_ARRAY_FIELDS) {
    if (!Array.isArray(candidate[field])) return null
  }
  const store = candidate as unknown as MailStore
  // Migrate older persisted shapes to the current versioned shape before the
  // boot merge sees them (defaults new fields, preserves unknown ones).
  return migratePersistedMailStore({
    ...store,
    // Drop malformed entries instead of crashing every consumer that maps
    // over these collections.
    threads: store.threads.filter(entryIsRecordWithId),
    messages: store.messages
      .filter(entryIsRecordWithId)
      // Purge Gmail phantoms persisted by earlier builds: a local "sent" copy
      // on a real Gmail thread that Gmail never confirmed. These showed as
      // "Synced outgoing message from Gmail" for sends that never left the
      // machine. The authoritative sent history comes from the next Gmail sync.
      .filter(message => !isUnconfirmedGmailSend(message as MailMessage)),
    drafts: store.drafts.filter(entryIsRecordWithId),
    tasks: store.tasks.filter(entryIsRecordWithId),
  })
}

function entryIsRecordWithId(entry: unknown): boolean {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === 'string'
  )
}

const REMOTE_IMAGE_SRC_ATTR =
  /\s(src|srcset)\s*=\s*("(?:https?:)?\/\/[^"]*"|'(?:https?:)?\/\/[^']*')/gi
const REMOTE_BACKGROUND_ATTR =
  /\sbackground\s*=\s*("(?:https?:)?\/\/[^"]*"|'(?:https?:)?\/\/[^']*')/gi

/**
 * Rewrite remote image references in already-sanitized mail HTML so nothing
 * loads from the network by default (tracking pixels, read receipts). The
 * original URL is preserved in a data attribute for a "Load images" action.
 * Inline data: images are untouched — they are embedded, not remote.
 */
export function blockRemoteImagesInMailHtml(html: string): {
  html: string
  blockedCount: number
} {
  let blockedCount = 0
  const blocked = html
    .replace(/<(?:img|source)\b[^>]*>/gi, tag =>
      tag.replace(REMOTE_IMAGE_SRC_ATTR, (_match, attr: string, value) => {
        blockedCount += 1
        return ` data-puremail-blocked-${attr.toLowerCase()}=${value}`
      }),
    )
    // Legacy background attributes (body/table/td) also fetch remotely.
    .replace(REMOTE_BACKGROUND_ATTR, () => {
      blockedCount += 1
      return ''
    })
    // Style attributes can pull remote backgrounds; drop any style that
    // references a remote url() rather than trying to rewrite CSS.
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, (match, value: string) => {
      if (/url\(\s*(?:&quot;|["'])?\s*(?:https?:)?\/\//i.test(value)) {
        blockedCount += 1
        return ''
      }
      return match
    })
  return { html: blocked, blockedCount }
}

/** Compatibility entry point: new mailboxes start empty. */
export function demoMailStoreForNow(now: DateInput = new Date()): MailStore { void now; return emptyMailStore() }

/**
 * Merge a single-thread fragment fetched on demand (a searchAllMail result
 * the sync window never covered) into the store. Replace-by-id so importing
 * a thread twice cannot duplicate it. A unique account-scoped provider/RFC
 * identity also replaces its accepted local send receipt, preserving the
 * delivery and repair evidence until the provider confirms the Sent copy.
 */
export function mergeThreadFragment(
  store: MailStore,
  fragment: { threads: MailThread[]; messages: MailMessage[] },
): MailStore {
  const threadIds = new Set(fragment.threads.map(thread => thread.id))
  const messageIds = new Set(fragment.messages.map(message => message.id))
  const accounts = new Map(store.threads.map(thread => [thread.id, thread.accountId]))
  const incomingAccounts = new Map(fragment.threads.map(thread => [thread.id, thread.accountId]))
  const keys = (message: MailMessage, account: string | undefined): string[] => !account || message.isDraft || message.optimistic ? [] : [
    ...(message.gmailMessageId ? [JSON.stringify([account, 'gmail', message.gmailMessageId])] : []),
    ...(message.messageIdHeader ? [JSON.stringify([account, 'rfc', message.messageIdHeader])] : []),
  ]
  const receipts = new Map<string, Set<MailMessage>>()
  for (const message of store.messages) {
    if (!message.deliveryAccepted) continue
    for (const key of keys(message, accounts.get(message.threadId))) {
      const matches = receipts.get(key) ?? new Set<MailMessage>()
      matches.add(message)
      receipts.set(key, matches)
    }
  }
  const incomingCounts = new Map<string, number>()
  for (const message of fragment.messages) for (const key of keys(message, incomingAccounts.get(message.threadId) ?? accounts.get(message.threadId))) {
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1)
  }
  const replacedReceipts = new Set<string>()
  const candidatesByMessage = fragment.messages.map(message => {
    const candidates = new Set<MailMessage>()
    const identities = keys(message, incomingAccounts.get(message.threadId) ?? accounts.get(message.threadId))
    // Reused/malformed identity headers must never consume a different receipt.
    if (identities.some(key => incomingCounts.get(key) !== 1)) return undefined
    for (const key of identities) for (const receipt of receipts.get(key) ?? []) candidates.add(receipt)
    if (candidates.size !== 1) return undefined
    const [receipt] = candidates
    return receipt
  })
  const candidateCounts = new Map<MailMessage, number>()
  for (const receipt of candidatesByMessage) if (receipt) candidateCounts.set(receipt, (candidateCounts.get(receipt) ?? 0) + 1)
  const messages = fragment.messages.map((message, index) => {
    const receipt = candidatesByMessage[index]
    if (!receipt || candidateCounts.get(receipt) !== 1) return message
    replacedReceipts.add(receipt.id)
    const warnings = [...(receipt.deliveryWarnings ?? []), ...(message.deliveryWarnings ?? [])]
      .filter(warning => !message.sentCopyPresent || !warning.includes('IMAP Sent copy'))
    const sentCopyPresent = message.sentCopyPresent || receipt.sentCopyPresent
    const rejected = [...new Set([...(receipt.deliveryRejectedRecipients ?? []), ...(message.deliveryRejectedRecipients ?? [])])]
    const draftProviderIds = [...new Set([...(receipt.sentDraftProviderIds ?? []), ...(message.sentDraftProviderIds ?? [])])]
    return {
      ...message,
      read: receipt.read,
      deliveryAccepted: true,
      sentCopyPresent,
      sentCopyMime: sentCopyPresent ? undefined : receipt.sentCopyMime ?? message.sentCopyMime,
      sentDraftId: receipt.sentDraftId ?? message.sentDraftId,
      sentDraftProviderId: receipt.sentDraftProviderId ?? message.sentDraftProviderId,
      sentDraftProviderIds: draftProviderIds.length ? draftProviderIds : undefined,
      deliveryRejectedRecipients: rejected.length ? rejected : undefined,
      deliveryWarnings: warnings.length ? [...new Set(warnings)] : undefined,
      ...(receipt.bcc?.length ? { bcc: receipt.bcc } : {}),
    }
  })
  return {
    ...store,
    threads: [
      ...store.threads.filter(thread => !threadIds.has(thread.id)),
      ...fragment.threads,
    ],
    messages: [
      ...store.messages.filter(message => !messageIds.has(message.id) && !replacedReceipts.has(message.id)),
      ...messages,
    ],
  }
}

export function emptyMailStore(): MailStore {
  return {
    storeVersion: MAIL_STORE_VERSION,
    accounts: [], mailboxes: [], taskLists: [], threads: [], messages: [], tasks: [], drafts: [], labels: [],
    settings: {
      classificationMode: 'local', fetchWindow: DEFAULT_MAIL_FETCH_WINDOW,
      autoFetchEnabled: true, fetchIntervalMinutes: DEFAULT_MAIL_FETCH_INTERVAL_MINUTES,
      quotedHistoryOpenByDefault: false, remoteImages: { policy: 'ask', trustedSenders: [] },
      autoDraftVoiceEngine: 'local-retrieval', signature: '',
      followUp: { ...DEFAULT_FOLLOW_UP_SETTINGS }, connectionProfiles: [],
    },
    threadContextSummaries: [], learningRules: [], starredThreadIds: [], pinnedThreadIds: [],
    snoozes: [], providerLabels: [], queuedActions: [], scheduledSends: [],
    notificationPreferences: defaultMailNotificationPreferences(),
  }
}
