import {
  readPlatformStorageJson,
  writePlatformStorageJson,
} from '../bridge/platformBridge'
import {
  emptyMailStore,
  parsePersistedMailStore,
  parsePersistedMailStoreValue,
  persistableMailStore,
} from './mailStoreData'
import type { Draft, MailRun, MailStore, MailMessage } from '../types'

export const MAIL_APP_SLUG = 'mail'

/**
 * Everything except drafts: the mailbox cache plus local workflow state.
 * Re-fetchable in the main, but expensive to lose.
 */
export const MAIL_STORE_FILE = 'mail-store.json'

/**
 * Drafts, alone, in their own file.
 *
 * Drafts are the only mail state a user cannot get back — a message can be
 * re-fetched, an unsent reply cannot. Giving them their own file means they do
 * not share a failure mode with the megabytes of message bodies beside them:
 * the draft write is small, goes first, and succeeds even when the cache write
 * does not.
 */
export const MAIL_DRAFTS_FILE = 'mail-drafts.json'

/** The pre-filesystem localStorage blob, read once and then retired. */
export const LEGACY_LOCAL_STORE_KEY = 'puremail.localStore.v2'

interface PersistedDraftsFile {
  drafts: Draft[]
  /**
   * Send runs ride with the drafts, not the cache: a run's statuses are
   * the user's work in progress, as unrecoverable as the drafts it points
   * at. Absent in files written before runs existed.
   */
  runs?: MailRun[]
  /** Delivery confirmations survive a failed mailbox-cache write. */
  sentReceipts?: MailMessage[]
  recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'>
}

function parseDraftsFile(
  value: unknown,
): { drafts: Draft[]; runs: MailRun[] | null; sentReceipts: MailMessage[]; recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'> } | null {
  if (!value || typeof value !== 'object') return null
  const file = value as PersistedDraftsFile
  const drafts = file.drafts
  if (!Array.isArray(drafts)) return null
  if (drafts.some(draft => !draft || typeof draft !== 'object' || typeof draft.id !== 'string')) return null
  return {
    drafts: drafts.filter(
      (draft): draft is Draft =>
        typeof draft === 'object' &&
        draft !== null &&
        typeof (draft as Draft).id === 'string',
    ).map(draft => draft.sendState === 'uncertain' && draft.sendError?.includes("shell:mailTransport:fetchAttachment")
      ? { ...draft, sendState: 'failed' as const, sendError: `Message not sent. An attachment could not be downloaded from its old Drafts copy. Open the draft and reattach the missing file. (${draft.sendError})` }
      : draft),
    runs: Array.isArray(file.runs) ? file.runs : null,
    recovery: file.recovery && Array.isArray(file.recovery.accounts) && Array.isArray(file.recovery.mailboxes) && Array.isArray(file.recovery.threads) ? file.recovery : undefined,
    sentReceipts: Array.isArray(file.sentReceipts) ? file.sentReceipts.filter(message => message && typeof message.id === 'string' && message.deliveryAccepted === true) : [],
  }
}

/** Drafts (and runs, when the drafts file carries them) over the cache. */
function withDraftsFile(
  store: MailStore,
  draftsFile: { drafts: Draft[]; runs: MailRun[] | null; sentReceipts: MailMessage[]; recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'> } | null,
): MailStore {
  if (!draftsFile) return store
  const receipts = draftsFile.sentReceipts
  const receiptIds = new Set(receipts.map(message => message.id))
  const gmailIds = new Set(receipts.map(message => message.gmailMessageId).filter(Boolean))
  const messageIds = new Set(receipts.map(message => message.messageIdHeader).filter(Boolean))
  const recoverMissing = <T extends { id: string }>(cached: T[], recovered: T[] = []): T[] => {
    const ids = new Set(cached.map(item => item.id))
    return [...cached, ...recovered.filter(item => !ids.has(item.id))]
  }
  const merged: MailStore = {
    ...store,
    // The draft write may be newer than a surviving cache. Restore missing
    // homes too, otherwise its successfully saved writing cannot be opened.
    accounts: recoverMissing(store.accounts, draftsFile.recovery?.accounts),
    mailboxes: recoverMissing(store.mailboxes, draftsFile.recovery?.mailboxes),
    threads: recoverMissing(store.threads, draftsFile.recovery?.threads),
    drafts: draftsFile.drafts,
    messages: [
      ...store.messages.filter(message => !receiptIds.has(message.id) &&
        !(message.gmailMessageId && gmailIds.has(message.gmailMessageId)) &&
        !(message.messageIdHeader && messageIds.has(message.messageIdHeader))),
      ...receipts,
    ],
  }
  if (draftsFile.runs) merged.runs = draftsFile.runs
  // The drafts file is raw JSON; run entries need the same tolerant pass
  // the cache gets.
  return draftsFile.runs ? parsePersistedMailStoreValue(merged) ?? merged : merged
}

function readLegacyLocalStore(): MailStore | null {
  if (typeof window === 'undefined') return null
  try {
    return parsePersistedMailStore(
      window.localStorage.getItem(LEGACY_LOCAL_STORE_KEY),
    )
  } catch (error) {
    console.warn('[puremail] legacy local store unreadable:', error)
    return null
  }
}

function clearLegacyLocalStore(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LEGACY_LOCAL_STORE_KEY)
  } catch {
    /* removal is a courtesy; a failure changes nothing */
  }
}

/**
 * Load the persisted store, preferring the filesystem files and falling back
 * to the legacy localStorage blob exactly once (which is then written to disk
 * and removed, so the quota it was occupying is released).
 *
 * Drafts always come from the drafts file when it exists, even if the cache
 * file is missing or unreadable: losing the mailbox cache costs a re-fetch,
 * losing drafts costs the user's writing.
 */
export async function readPersistedMailStore(): Promise<{
  store: MailStore | null
  migratedFromLocalStorage: boolean
}> {
  let cached: MailStore | null = null
  let drafts: { drafts: Draft[]; runs: MailRun[] | null; sentReceipts: MailMessage[]; recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'> } | null = null

  const [storeFile, draftsFile] = await Promise.allSettled([
    readPlatformStorageJson({
      appSlug: MAIL_APP_SLUG,
      fileName: MAIL_STORE_FILE,
    }),
    readPlatformStorageJson({
      appSlug: MAIL_APP_SLUG,
      fileName: MAIL_DRAFTS_FILE,
    }),
  ])
  if (storeFile.status === 'fulfilled') {
    cached = parsePersistedMailStoreValue(storeFile.value.value)
  } else {
    console.warn('[puremail] mailbox cache unreadable:', storeFile.reason)
  }
  // Only an absent file permits the legacy fallback. An unreadable drafts
  // file must stop boot: starting empty would let autosave overwrite it.
  if (draftsFile.status === 'rejected') {
    throw new Error('Your saved drafts could not be read. They have not been changed. Try again when storage is available.')
  }
  drafts = parseDraftsFile(draftsFile.value.value)
  if (draftsFile.value.value !== null && !drafts) {
    throw new Error('Your saved drafts file could not be understood. It has not been changed. Restore a readable copy, then try again.')
  }

  if (cached) {
    return {
      store: withDraftsFile(cached, drafts),
      migratedFromLocalStorage: false,
    }
  }

  const legacy = readLegacyLocalStore()
  if (!legacy) {
    // No cache file, but drafts may still be there — never drop them just
    // because the mailbox cache is missing.
    return { store: drafts ? withDraftsFile({ ...emptyMailStore(), ...drafts.recovery }, drafts) : null, migratedFromLocalStorage: false }
  }
  return {
    store: withDraftsFile(legacy, drafts),
    migratedFromLocalStorage: true,
  }
}

/**
 * Persist the store. Drafts are written first and separately so a failure
 * writing the (much larger) mailbox cache cannot take the user's unsent mail
 * with it. Returns which halves failed rather than throwing, so the caller can
 * tell the user precisely what is at risk.
 */
export async function writePersistedMailStore(store: MailStore): Promise<{
  draftsWritten: boolean
  cacheWritten: boolean
  error?: string
}> {
  const persistable = persistableMailStore(store)
  const sentReceipts = persistable.messages.filter(message => message.deliveryAccepted)
  const recoveryThreadIds = new Set([
    ...persistable.drafts.map(draft => draft.threadId),
    ...sentReceipts.map(message => message.threadId),
  ])
  let draftsWritten = false
  let cacheWritten = false
  let error: string | undefined

  try {
    await writePlatformStorageJson({
      appSlug: MAIL_APP_SLUG,
      fileName: MAIL_DRAFTS_FILE,
      value: {
        drafts: persistable.drafts,
        runs: persistable.runs ?? [],
        recovery: { accounts: persistable.accounts, mailboxes: persistable.mailboxes, threads: persistable.threads.filter(thread => recoveryThreadIds.has(thread.id)) },
        sentReceipts: sentReceipts.map(message => ({ ...message, attachments: message.attachments.map(({ content: _content, ...attachment }) => attachment) })),
      },
    })
    draftsWritten = true
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  try {
    await writePlatformStorageJson({
      appSlug: MAIL_APP_SLUG,
      fileName: MAIL_STORE_FILE,
      // Drafts live in their own file; keeping a second copy here would let
      // the two disagree after a partial write.
      value: { ...persistable, drafts: [], runs: [] },
    })
    cacheWritten = true
  } catch (cause) {
    error = error ?? (cause instanceof Error ? cause.message : String(cause))
  }

  if (draftsWritten && cacheWritten) clearLegacyLocalStore()
  return { draftsWritten, cacheWritten, ...(error ? { error } : {}) }
}
