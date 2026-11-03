import {
  readPlatformStorageJson,
  writePlatformStorageJson,
} from '../bridge/platformBridge'
import {
  compactPersistedDraft,
  emptyMailStore,
  parsePersistedMailStore,
  parsePersistedMailStoreValue,
  persistableMailStore,
} from './mailStoreData'
import {
  baselineOf,
  mergeReceipts,
  mergeRecords,
  mergeScheduledSends,
  recordConfirmedSent,
  recordFingerprint,
  withoutTombstoned,
  type DraftsFileChanges,
  type Tombstone,
} from './draftsFileMerge'
import {
  mergeStoreFile,
  NO_STORE_CHANGES,
  noUnseenChanges,
  storeBaselineOf,
  storeChangedSince,
  type StoreBaseline,
  type StoreFileChanges,
  type UnseenChanges,
} from './storeFileMerge'
import { draftAfterEarlierReceipt, hasUnconfirmedSendEvidence, RECEIPT_DRAFT_ID_PREFIX } from './mailDeliveryStatus'
import type { Draft, MailRun, MailStore, MailMessage, ScheduledSend } from '../types'

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
  /**
   * With the drafts they would send, in one write: a recovered or undone draft
   * and its stopped schedule cannot come apart if the cache write fails. Absent
   * in files written before this; the cache's copy is used then.
   */
  scheduledSends?: ScheduledSend[]
  /** Delivery confirmations survive a failed mailbox-cache write. */
  sentReceipts?: MailMessage[]
  recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'>
  /** Real deletes (draftsFileMerge.ts). Absence alone never means a delete. */
  draftTombstones?: Tombstone[]
  runTombstones?: Tombstone[]
  /** Names this store, so a shared folder can tell which desktop holds a draft. */
  storeId?: string
}

interface ParsedDraftsFile {
  drafts: Draft[]
  runs: MailRun[] | null
  scheduledSends: ScheduledSend[] | null
  sentReceipts: MailMessage[]
  recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'>
  draftTombstones: Tombstone[]
  runTombstones: Tombstone[]
  storeId?: string
}

const parseTombstones = (value: unknown): Tombstone[] =>
  Array.isArray(value)
    ? value.filter((item): item is Tombstone => Boolean(item) && typeof item.id === 'string' && typeof item.deletedAt === 'string')
    : []

function parseDraftsFile(value: unknown): ParsedDraftsFile | null {
  if (!value || typeof value !== 'object') return null
  const file = value as PersistedDraftsFile
  const drafts = file.drafts
  if (!Array.isArray(drafts)) return null
  if (drafts.some(draft => !draft || typeof draft !== 'object' || typeof draft.id !== 'string')) return null
  const draftTombstones = parseTombstones(file.draftTombstones)
  const runTombstones = parseTombstones(file.runTombstones)
  return {
    drafts: withoutTombstoned(drafts.filter(
      (draft): draft is Draft =>
        typeof draft === 'object' &&
        draft !== null &&
        typeof (draft as Draft).id === 'string',
    ).map(draft => draft.sendState === 'uncertain' && draft.sendError?.includes("shell:mailTransport:fetchAttachment")
      ? { ...draft, sendState: 'failed' as const, sendError: `Message not sent. An attachment could not be downloaded from its old Drafts copy. Open the draft and reattach the missing file. (${draft.sendError})` }
      : draft), draftTombstones),
    runs: Array.isArray(file.runs) ? withoutTombstoned(file.runs, runTombstones) : null,
    scheduledSends: Array.isArray(file.scheduledSends) ? file.scheduledSends : null,
    draftTombstones,
    runTombstones,
    ...(typeof file.storeId === 'string' ? { storeId: file.storeId } : {}),
    recovery: file.recovery && Array.isArray(file.recovery.accounts) && Array.isArray(file.recovery.mailboxes) && Array.isArray(file.recovery.threads) ? file.recovery : undefined,
    sentReceipts: Array.isArray(file.sentReceipts) ? file.sentReceipts.filter(message => message && typeof message.id === 'string' && message.deliveryAccepted === true) : [],
  }
}

/** Drafts (and runs, when the drafts file carries them) over the cache. */
function withDraftsFile(
  store: MailStore,
  draftsFile: ParsedDraftsFile | null,
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
  if (draftsFile.scheduledSends) merged.scheduledSends = draftsFile.scheduledSends
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
export function readPersistedMailStore(): Promise<{
  store: MailStore | null
  migratedFromLocalStorage: boolean
}> {
  return loadPersistedMailStore(true)
}

/**
 * The saved record as it is now, for a copy already running. Its baselines stay
 * put: moving them would make what it has not taken in yet read as its own
 * delete or older edit, and its next save would undo what another copy saved.
 */
export async function readSavedMailStore(): Promise<MailStore | null> {
  return (await loadPersistedMailStore(false)).store
}

async function loadPersistedMailStore(agree: boolean): Promise<{
  store: MailStore | null
  migratedFromLocalStorage: boolean
}> {
  let cached: MailStore | null = null
  let drafts: ParsedDraftsFile | null = null

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
    if (cached && agree) agreeWithStoreFile(cached)
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
  if (agree) agreeWithFile(drafts, draftsFile.value.version)

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

// ---------------------------------------------------------------- this copy

/**
 * What this running copy last agreed with the file on. A module holds it
 * because each running copy of Mail is its own JavaScript realm.
 */
const thisCopy = {
  storeId: '',
  file: null as ParsedDraftsFile | null,
  fileVersion: undefined as string | null | undefined,
  draftBaseline: new Map<string, string>(),
  runBaseline: new Map<string, string>(),
  scheduleBaseline: new Set<string>(),
  receiptBaseline: new Set<string>(),
  /** Discards not yet in the file, with when. */
  discards: new Map<string, string>(),
  /** Drafts that arrived from another copy moments ago, which may be pushing them to the provider itself. */
  arrivedUntil: new Map<string, number>(),
  /** What this copy last agreed with mail-store.json on. Null until it has read or written the file. */
  storeBaseline: null as StoreBaseline | null,
  storeUnseen: noUnseenChanges() as UnseenChanges,
}

function agreeWithStoreFile(file: unknown): void {
  thisCopy.storeBaseline = storeBaselineOf(file)
}

/** How long a draft from another copy is left for that copy to push to the provider. */
const ARRIVED_HOLD_MS = 60_000

function agreeWithFile(file: ParsedDraftsFile | null, version?: string | null): void {
  thisCopy.fileVersion = version
  thisCopy.file = file
  thisCopy.storeId = file?.storeId || thisCopy.storeId
  thisCopy.draftBaseline = baselineOf(file?.drafts ?? [])
  thisCopy.runBaseline = baselineOf(file?.runs ?? [])
  thisCopy.scheduleBaseline = new Set((file?.scheduledSends ?? []).map(entry => entry.id))
  thisCopy.receiptBaseline = new Set((file?.sentReceipts ?? []).map(message => message.id))
}

/** Tests only: a fresh running copy of this module's mail-store.json view, in a test that clears the files. */
export function forgetStoreFileForTest(): void {
  thisCopy.storeBaseline = null
  thisCopy.storeUnseen = noUnseenChanges()
}

/** Names this mail store (the file's, once written): which desktop holds a draft. */
export function draftsStoreId(): string {
  if (!thisCopy.storeId) thisCopy.storeId = crypto.randomUUID()
  return thisCopy.storeId
}

/** The person (or a discard request through Mail) threw this draft away. */
export function recordDraftDiscard(draftId: string, at: string = new Date().toISOString()): void {
  thisCopy.discards.set(draftId, at)
}

/** When this draft was really discarded in this store, if it was. */
export function draftDiscardedAt(draftId: string): string | undefined {
  const pending = thisCopy.discards.get(draftId)
  if (pending) return pending
  const tombstone = thisCopy.file?.draftTombstones.find(item => item.id === draftId)
  return tombstone?.reason === 'discarded' ? tombstone.deletedAt : undefined
}

/** Saved by another copy moments ago: that copy pushes it to the provider, or two account copies appear. */
export function draftHeldByAnotherCopy(draftId: string, now: number = Date.now()): boolean {
  const until = thisCopy.arrivedUntil.get(draftId)
  if (until === undefined) return false
  if (until > now) return true
  thisCopy.arrivedUntil.delete(draftId)
  return false
}

const NO_CHANGES: DraftsFileChanges = { drafts: [], removedDrafts: [], runs: [], removedRuns: [], scheduledSends: [], sentReceipts: [] }

/** The file's value for this store merged with what is on disk, and what arrived from other copies. */
function mergedDraftsFile(
  store: MailStore,
  disk: ParsedDraftsFile | null,
  now: string,
): { value: PersistedDraftsFile; changes: DraftsFileChanges } {
  const persistable = persistableMailStore(store)
  // A provider listing started before another copy pushed a draft does not
  // list it, and that drops the draft from this copy's memory moments after it
  // arrived. That is not this copy deleting it.
  const draftBaseline = new Map(thisCopy.draftBaseline)
  const nowMs = Date.parse(now)
  const heldInMemory = new Set(persistable.drafts.map(draft => draft.id))
  for (const id of draftBaseline.keys()) {
    if (!heldInMemory.has(id) && draftHeldByAnotherCopy(id, nowMs) && !thisCopy.discards.has(id)) draftBaseline.delete(id)
  }
  // Both cache and receipt compaction retain content identities. Older missing
  // evidence stays unknown; labels never stand in for attachment content.
  const receiptsOnFile = [...persistable.messages, ...(disk?.sentReceipts ?? [])]
  // Allow retry frees editing; a second approval need not exist when the first receipt arrives.
  const earlierReceipt = (record: Pick<Draft, 'id' | 'sendSupersedes' | 'sendSettledAttemptId'>) => receiptsOnFile.find(message =>
    message.deliveryAccepted && message.sentDraftId === record.id && message.sentAttemptId &&
    (record.sendSettledAttemptId === message.sentAttemptId || record.sendSupersedes?.includes(message.sentAttemptId)))
  const laterWords = new Map<string, Draft>()
  const fullDrafts = new Map(store.drafts.map(draft => [draft.id, draft]))
  const withEarlierReceipt = (record: Draft): Draft => {
    const receipt = earlierReceipt(record)
    if (!receipt) return record
    // The exact compacted representation of this copy's record can use its
    // full bytes. Never borrow across a different edit or attempt's evidence.
    const full = fullDrafts.get(record.id)
    const comparison = full && (record === full || JSON.stringify(compactPersistedDraft(full)) === JSON.stringify(record)) ? full : record
    const { evidence, later } = draftAfterEarlierReceipt(comparison, receipt)
    const discarded = later && (thisCopy.discards.has(later.id) || disk?.draftTombstones.some(tombstone => tombstone.id === later.id))
    if (later && !discarded && !persistable.drafts.some(draft => draft.id === later.id) && !disk?.drafts.some(draft => draft.id === later.id)) {
      const previous = laterWords.get(later.id)
      if (!previous || Date.parse(later.updatedAt) > Date.parse(previous.updatedAt)) laterWords.set(later.id, compactPersistedDraft(later))
    }
    return evidence
  }
  // A delayed sync/controller result can re-create this reserved id in memory
  // after another copy discarded it. It is a derived revision, not a provider
  // listing a draft again. Keep the general provider-id revival rule unchanged.
  const discardedRevisions = new Map((disk?.draftTombstones ?? []).filter(tombstone => tombstone.reason === 'discarded').map(tombstone => [tombstone.id, tombstone]))
  for (const [id, deletedAt] of thisCopy.discards) discardedRevisions.set(id, { id, deletedAt, reason: 'discarded' })
  const blockedRevisions: Tombstone[] = []
  const rejectedReceiptDrafts: NonNullable<DraftsFileChanges['rejectedReceiptDrafts']> = []
  const memoryDrafts = store.drafts.filter(record => {
    if (!record.id.startsWith(RECEIPT_DRAFT_ID_PREFIX) || record.sendAttempt || hasUnconfirmedSendEvidence(record)) return true
    const baseline = thisCopy.draftBaseline.get(record.id)
    const rebuilt = baseline === undefined || recordFingerprint(compactPersistedDraft(record)) === baseline
    if (!rebuilt) return true
    const tombstone = discardedRevisions.get(record.id)
    const confirmed = recordConfirmedSent(receiptsOnFile, record)
    if (!tombstone && !confirmed) return true
    blockedRevisions.push(tombstone ?? disk?.draftTombstones.find(item => item.id === record.id) ?? { id: record.id, deletedAt: now, reason: 'removed' })
    rejectedReceiptDrafts.push({ id: record.id, fingerprint: recordFingerprint(record) })
    return false
  })
  const drafts = mergeRecords<Draft>({
    baseline: draftBaseline,
    memory: memoryDrafts.map(withEarlierReceipt).map(compactPersistedDraft),
    disk: (disk?.drafts ?? []).map(withEarlierReceipt).map(compactPersistedDraft),
    tombstones: disk?.draftTombstones ?? [],
    discards: thisCopy.discards,
    confirmed: record => !earlierReceipt(record) && recordConfirmedSent(receiptsOnFile, record),
    now,
  })
  // Take the rejection back into this running copy too, not only onto disk.
  drafts.removed.push(...blockedRevisions.filter(tombstone => !drafts.removed.some(item => item.id === tombstone.id)))
  for (const later of laterWords.values()) { drafts.merged.push(later); drafts.arrived.push(later) }
  // Receipt stamping above is an application change too, even when both
  // preprocessed sides compare equal in the merge.
  for (const kept of drafts.merged) {
    const held = persistable.drafts.find(draft => draft.id === kept.id)
    if (held && recordFingerprint(held) !== recordFingerprint(kept) && !drafts.arrived.some(draft => draft.id === kept.id)) drafts.arrived.push(kept)
  }
  const runs = mergeRecords<MailRun>({
    baseline: thisCopy.runBaseline,
    memory: persistable.runs ?? [],
    disk: disk?.runs ?? [],
    tombstones: disk?.runTombstones ?? [],
    now,
  })
  const schedules = mergeScheduledSends({
    baseline: thisCopy.scheduleBaseline,
    memory: persistable.scheduledSends ?? [],
    disk: disk?.scheduledSends ?? [],
  })
  const receipts = mergeReceipts({
    baseline: thisCopy.receiptBaseline,
    memory: persistable.messages.filter(message => message.deliveryAccepted),
    disk: disk?.sentReceipts ?? [],
  })
  // A home for each kept draft and receipt: this copy's when it has one, else
  // the one the saving copy recorded. Other accounts in the file are not
  // carried forward, so a removed account does not come back through here.
  const homeIds = new Set([...drafts.merged.map(draft => draft.threadId), ...receipts.merged.map(message => message.threadId)])
  const heldThreadIds = new Set(persistable.threads.map(thread => thread.id))
  const borrowed = (disk?.recovery?.threads ?? []).filter(thread => homeIds.has(thread.id) && !heldThreadIds.has(thread.id))
  const borrowedAccountIds = new Set(borrowed.map(thread => thread.accountId))
  const heldAccountIds = new Set(persistable.accounts.map(account => account.id))
  const heldMailboxIds = new Set(persistable.mailboxes.map(mailbox => mailbox.id))
  const borrowedAccounts = (disk?.recovery?.accounts ?? []).filter(account => borrowedAccountIds.has(account.id) && !heldAccountIds.has(account.id))
  const borrowedMailboxes = (disk?.recovery?.mailboxes ?? []).filter(mailbox => borrowedAccountIds.has(mailbox.accountId) && !heldMailboxIds.has(mailbox.id))
  return {
    value: {
      drafts: drafts.merged,
      runs: runs.merged,
      scheduledSends: schedules.merged,
      recovery: {
        accounts: [...persistable.accounts, ...borrowedAccounts],
        mailboxes: [...persistable.mailboxes, ...borrowedMailboxes],
        threads: [...persistable.threads.filter(thread => homeIds.has(thread.id)), ...borrowed],
      },
      sentReceipts: receipts.merged.map(message => ({ ...message, ...(Array.isArray(message.attachments) ? { attachments: message.attachments.map(({ content: _content, ...attachment }) => attachment) } : {}) })),
      draftTombstones: drafts.tombstones,
      runTombstones: runs.tombstones,
      storeId: disk?.storeId || draftsStoreId(),
    },
    changes: {
      drafts: drafts.arrived,
      removedDrafts: drafts.removed,
      ...(rejectedReceiptDrafts.length ? { rejectedReceiptDrafts } : {}),
      runs: runs.arrived,
      removedRuns: runs.removed,
      scheduledSends: schedules.arrived,
      sentReceipts: receipts.arrived,
      ...(borrowed.length ? { recovery: { accounts: borrowedAccounts, mailboxes: borrowedMailboxes, threads: borrowed } } : {}),
    },
  }
}

/** Homes differ between copies with no draft changed, so a look alone does not rewrite the file for them. */
const sameContent = (value: PersistedDraftsFile, raw: unknown, ignoreHomes: boolean): boolean => {
  if (!raw || typeof raw !== 'object') return false
  const { recovery: myHomes, ...mine } = value
  const { recovery: theirHomes, ...theirs } = raw as PersistedDraftsFile
  return JSON.stringify(mine) === JSON.stringify(theirs) && (ignoreHomes || JSON.stringify(myHomes) === JSON.stringify(theirHomes))
}

async function readDraftsFile(): Promise<{ raw: unknown; file: ParsedDraftsFile | null; version?: string | null }> {
  const { value, version } = await readPlatformStorageJson({ appSlug: MAIL_APP_SLUG, fileName: MAIL_DRAFTS_FILE })
  const file = parseDraftsFile(value)
  if (value !== null && !file) throw new Error('Your saved drafts file could not be understood. It has not been changed.')
  return { raw: value, file, ...(version !== undefined ? { version } : {}) }
}

const MAX_MERGE_TRIES = 5

/** The cache as this copy would file it. Drafts, runs and schedules have their own file; a second copy here could disagree. */
const storeFileValue = (store: MailStore): Record<string, unknown> => ({ ...persistableMailStore(store), drafts: [], runs: [], scheduledSends: [] })

/**
 * Merge this copy into mail-store.json (storeFileMerge.ts) and write only if that
 * changes it; the write applies only if the file is still as read. A file that
 * cannot be read has nothing to merge with, and writing it repairs it, as boot
 * already treats an unreadable cache as gone.
 */
async function saveStoreFile(store: MailStore, look = false): Promise<StoreFileChanges> {
  const value = storeFileValue(store)
  if (!look && thisCopy.storeBaseline && !storeChangedSince(value, thisCopy.storeBaseline)) return NO_STORE_CHANGES
  for (let attempt = 0; attempt < MAX_MERGE_TRIES; attempt++) {
    let read: Awaited<ReturnType<typeof readPlatformStorageJson>>
    try {
      read = await readPlatformStorageJson({ appSlug: MAIL_APP_SLUG, fileName: MAIL_STORE_FILE })
    } catch (error) {
      if (look) throw error
      console.warn('[puremail] mailbox cache unreadable; writing it again:', error)
      await writePlatformStorageJson({ appSlug: MAIL_APP_SLUG, fileName: MAIL_STORE_FILE, value })
      agreeWithStoreFile(value)
      return NO_STORE_CHANGES
    }
    const disk = parsePersistedMailStoreValue(read.value) as unknown as Record<string, unknown> | null
    const { merged, changes, differs, unseen } = mergeStoreFile({
      baseline: thisCopy.storeBaseline ?? storeBaselineOf(null),
      memory: value,
      disk,
      unseen: thisCopy.storeUnseen,
    })
    if (differs) {
      const written = await writePlatformStorageJson({
        appSlug: MAIL_APP_SLUG,
        fileName: MAIL_STORE_FILE,
        value: merged,
        ...(read.version !== undefined ? { ifMatch: read.version } : {}),
      })
      if (written.conflict) continue
    }
    agreeWithStoreFile(merged)
    thisCopy.storeUnseen = unseen
    return changes
  }
  throw new Error('Other copies of Mail kept saving at the same moment. Your mail is safe here and will be saved on the next try.')
}

/** Take what other copies saved to mail-store.json, and write back anything the file lacks. */
export async function syncStoreFile(store: MailStore): Promise<StoreFileChanges> {
  return saveStoreFile(store, true)
}

/**
 * Read the file, merge this store into it record by record, and write only if
 * that changes it. The write applies only if the file is still as read: when
 * another copy saved in between, nothing is written and the merge runs again.
 */
async function saveDraftsFile(store: MailStore, ignoreHomes = false): Promise<DraftsFileChanges> {
  const now = new Date().toISOString()
  for (let attempt = 0; attempt < MAX_MERGE_TRIES; attempt++) {
    const { raw, file, version } = await readDraftsFile()
    const { value, changes } = mergedDraftsFile(store, file, now)
    if (sameContent(value, raw, ignoreHomes)) {
      agreeWithFile(file, version)
      thisCopy.discards.clear()
      return holdArrivals(changes)
    }
    const written = await writePlatformStorageJson({
      appSlug: MAIL_APP_SLUG,
      fileName: MAIL_DRAFTS_FILE,
      value,
      ...(version !== undefined ? { ifMatch: version } : {}),
    })
    if (written.conflict) continue
    agreeWithFile(parseDraftsFile(JSON.parse(JSON.stringify(value))), written.version)
    thisCopy.discards.clear()
    return holdArrivals(changes)
  }
  throw new Error('Other copies of Mail kept saving at the same moment. Your drafts are safe here and will be saved on the next try.')
}

function holdArrivals(changes: DraftsFileChanges): DraftsFileChanges {
  const until = Date.now() + ARRIVED_HOLD_MS
  for (const draft of changes.drafts) thisCopy.arrivedUntil.set(draft.id, until)
  return changes
}

/**
 * Take what other copies saved and write back anything the file lost. Runs on a
 * timer and before the executive share looks, so a copy left open never decides
 * anything from an old view. The mailbox cache is not touched.
 */
export async function syncDraftsFile(store: MailStore): Promise<DraftsFileChanges> {
  return saveDraftsFile(store, true)
}

/**
 * The page is going away: an awaited read may never come back, so merge with
 * the file as last read and conditionally write at once. A stale view must
 * never replace durable send evidence. No version means no safe exit write.
 */
export function writeDraftsFileBeforeUnload(store: MailStore): void {
  if (thisCopy.fileVersion === undefined) return
  const { value } = mergedDraftsFile(store, thisCopy.file, new Date().toISOString())
  void writePlatformStorageJson({ appSlug: MAIL_APP_SLUG, fileName: MAIL_DRAFTS_FILE, value, ifMatch: thisCopy.fileVersion }).catch(() => {})
}

/**
 * Persist the store. Drafts are written first and separately so a failure
 * writing the (much larger) mailbox cache cannot take the user's unsent mail
 * with it. Returns which halves failed rather than throwing, so the caller can
 * tell the user precisely what is at risk. Neither file is rewritten from this
 * copy's memory: `draftChanges` and `cacheChanges` are what other copies saved,
 * for the caller to take into memory.
 */
export async function writePersistedMailStore(store: MailStore): Promise<{
  draftsWritten: boolean
  cacheWritten: boolean
  error?: string
  draftChanges: DraftsFileChanges
  /** What other copies saved to mail-store.json, for the caller to take into memory. */
  cacheChanges: StoreFileChanges
}> {
  let draftChanges = NO_CHANGES
  let cacheChanges = NO_STORE_CHANGES
  let draftsWritten = false
  let cacheWritten = false
  let error: string | undefined

  try {
    draftChanges = await saveDraftsFile(store)
    draftsWritten = true
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  try {
    cacheChanges = await saveStoreFile(store)
    cacheWritten = true
  } catch (cause) {
    error = error ?? (cause instanceof Error ? cause.message : String(cause))
  }

  if (draftsWritten && cacheWritten) clearLegacyLocalStore()
  return { draftsWritten, cacheWritten, draftChanges, cacheChanges, ...(error ? { error } : {}) }
}
