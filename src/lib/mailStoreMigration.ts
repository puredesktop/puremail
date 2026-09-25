import { isAiTriageVerdict } from './aiTriageState'
import type { MailAiTriageRecord } from '../types'
import type {
  MailNotificationPreferences,
  MailRun,
  MailStore,
  MailThreadSnooze,
  ProviderLabelMetadata,
  QueuedMailAction,
  ScheduledSend,
} from '../types'

/**
 * Persisted-store shape version.
 *
 * - (unversioned) — everything before Phase M0: no `storeVersion` field.
 * - 2 — Phase M0: starred/pinned thread state, snooze metadata, provider
 *   label cache, queued offline actions, scheduled sends, notification
 *   preferences.
 * - 3 — Drafts belong to the conversation they answer.
 *   (Send runs — `runs` — arrived without a bump: an absent field defaults
 *   to none, and older stores load unchanged.) Re-homed drafts
 *   (`thread_draft_*` synthetic threads) are reattached to their source
 *   conversation and the synthetic threads are dropped.
 *
 * Bump this ONLY together with a migration step in
 * `migratePersistedMailStore`. Migrations must be defensive (issue #153
 * state-loss class): unknown fields are preserved untouched, missing fields
 * are defaulted, malformed entries are dropped individually — a bad entry
 * must never discard the rest of the user's state.
 */
export const MAIL_STORE_VERSION = 3

export function defaultMailNotificationPreferences(): MailNotificationPreferences {
  return {
    enabled: true,
    scope: 'important',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function validEntries<T>(
  value: unknown,
  isValid: (entry: unknown) => entry is T,
): T[] {
  if (!Array.isArray(value)) return []
  return value.filter(isValid)
}

function isSnoozeEntry(entry: unknown): entry is MailThreadSnooze {
  return (
    isRecord(entry) &&
    typeof entry.threadId === 'string' &&
    typeof entry.snoozedUntil === 'string' &&
    typeof entry.snoozedAt === 'string'
  )
}

function isProviderLabelEntry(entry: unknown): entry is ProviderLabelMetadata {
  return (
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    (entry.type === 'system' || entry.type === 'user') &&
    typeof entry.updatedAt === 'string'
  )
}

function isQueuedActionEntry(entry: unknown): entry is QueuedMailAction {
  return (
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.type === 'string' &&
    typeof entry.threadId === 'string' &&
    typeof entry.queuedAt === 'string' &&
    typeof entry.attempts === 'number'
  )
}

function isScheduledSendEntry(entry: unknown): entry is ScheduledSend {
  return (
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.draftId === 'string' &&
    typeof entry.threadId === 'string' &&
    typeof entry.sendAt === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.status === 'string'
  )
}

function isRunEntry(entry: unknown): entry is MailRun {
  return (
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.accountId === 'string' &&
    typeof entry.status === 'string' &&
    Array.isArray(entry.items) &&
    isRecord(entry.fieldMap ?? {})
  )
}

/** Tolerant per-run normalization: bad items are dropped, not the run. */
function normalizedRun(run: MailRun): MailRun {
  return {
    ...run,
    fieldMap: isRecord(run.fieldMap) ? run.fieldMap : {},
    noteSlot: run.noteSlot === true,
    cursor: typeof run.cursor === 'number' && run.cursor >= 0 ? run.cursor : 0,
    items: run.items.filter(
      item =>
        isRecord(item) &&
        typeof item.draftId === 'string' &&
        typeof item.status === 'string',
    ),
  }
}

function normalizedNotificationPreferences(
  value: unknown,
): MailNotificationPreferences {
  const defaults = defaultMailNotificationPreferences()
  if (!isRecord(value)) return defaults
  return {
    // Preserve unknown sub-fields a newer or older build may have written
    // (e.g. the retired `soundEnabled` flag rides through untouched).
    ...(value as Partial<MailNotificationPreferences>),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    scope:
      value.scope === 'all' || value.scope === 'important' || value.scope === 'none'
        ? value.scope
        : defaults.scope,
  }
}

/**
 * Backfill snooze metadata for pre-M0 stores: threads already carried
 * `snoozedUntil`, but there was no snooze record. Existing records win;
 * synthesized entries only cover snoozed threads with no record.
 */
function backfilledSnoozes(store: MailStore, existing: MailThreadSnooze[]): MailThreadSnooze[] {
  const covered = new Set(existing.map(entry => entry.threadId))
  const synthesized = store.threads
    .filter(
      thread =>
        typeof thread.snoozedUntil === 'string' &&
        thread.snoozedUntil.length > 0 &&
        !covered.has(thread.id),
    )
    .map(
      (thread): MailThreadSnooze => ({
        threadId: thread.id,
        snoozedUntil: thread.snoozedUntil as string,
        // The original snooze time was never recorded pre-M0; the thread's
        // last activity is the closest defensible stand-in.
        snoozedAt: thread.lastMessageAt,
        returnMailboxId: thread.archivedFromMailboxId ?? thread.mailboxId,
        reason: 'manual',
      }),
    )
  return [...existing, ...synthesized]
}

/** Prefix of the synthetic thread that used to host a Drafts-filed draft. */
const FILED_DRAFT_THREAD_PREFIX = 'thread_draft_'

/**
 * Undo re-homing (store version 3).
 *
 * Drafts used to be moved onto a synthetic `thread_draft_*` thread so they
 * would appear under Drafts. That detached every draft from the conversation
 * it was answering — open the email you asked for a reply to and there was no
 * sign a reply existed. Drafts is a view over drafts now, so the synthetic
 * threads have no job left.
 *
 * Each re-homed draft goes back to the conversation it answers, identified by
 * its reply intent or its source message. A draft whose source cannot be
 * established keeps its synthetic thread rather than being orphaned — it is
 * still reachable, which is the property that matters.
 */
function reattachRehomedDrafts(store: MailStore): MailStore {
  const rehomed = store.drafts.filter(draft =>
    draft.threadId.startsWith(FILED_DRAFT_THREAD_PREFIX),
  )
  if (rehomed.length === 0) return store

  const threadIdByMessageId = new Map(
    store.messages.map(message => [message.id, message.threadId]),
  )
  const knownThreadIds = new Set(store.threads.map(thread => thread.id))
  const reattachedThreadIds = new Set<string>()

  const drafts = store.drafts.map(draft => {
    if (!draft.threadId.startsWith(FILED_DRAFT_THREAD_PREFIX)) return draft
    const source =
      draft.replyIntent?.threadId ??
      (draft.sourceMessageId
        ? threadIdByMessageId.get(draft.sourceMessageId)
        : undefined)
    if (!source || !knownThreadIds.has(source)) return draft
    reattachedThreadIds.add(draft.threadId)
    return { ...draft, threadId: source }
  })

  const stillHosting = new Set(
    drafts
      .filter(draft => draft.threadId.startsWith(FILED_DRAFT_THREAD_PREFIX))
      .map(draft => draft.threadId),
  )
  return {
    ...store,
    drafts,
    threads: store.threads.filter(
      thread =>
        !thread.id.startsWith(FILED_DRAFT_THREAD_PREFIX) ||
        stillHosting.has(thread.id),
    ),
    // Messages that belonged to a dropped synthetic thread (the local copy of
    // a send) would otherwise linger pointing at nothing.
    messages: store.messages.filter(
      message =>
        !reattachedThreadIds.has(message.threadId) &&
        (!message.threadId.startsWith(FILED_DRAFT_THREAD_PREFIX) ||
          stillHosting.has(message.threadId)),
    ),
  }
}

/**
 * Migrate a parsed persisted store (any historical shape) to the current
 * `MAIL_STORE_VERSION` shape. Idempotent: running it on an already-current
 * store is a no-op apart from re-validating entries.
 *
 * Defensive by design (issue #153): the input is spread first so fields this
 * build does not know about round-trip untouched; every new field is
 * defaulted when missing and entry-validated when present.
 */
function isAiTriageEntry(entry: unknown): entry is MailAiTriageRecord {
  return (
    isRecord(entry) &&
    typeof entry.threadId === 'string' &&
    typeof entry.accountId === 'string' &&
    typeof entry.messageId === 'string' &&
    typeof entry.seenAt === 'string' &&
    isAiTriageVerdict(entry.verdict) &&
    typeof entry.reason === 'string' &&
    typeof entry.subject === 'string' &&
    isRecord(entry.from) &&
    typeof entry.decidedAt === 'string' &&
    (entry.decidedBy === 'agent' || entry.decidedBy === 'user')
  )
}

export function migratePersistedMailStore(input: MailStore): MailStore {
  const store = reattachRehomedDrafts(input)
  const candidate = store as MailStore & Record<string, unknown>
  const snoozes = validEntries(candidate.snoozes, isSnoozeEntry)
  return {
    ...store,
    storeVersion: MAIL_STORE_VERSION,
    starredThreadIds: stringArray(candidate.starredThreadIds),
    pinnedThreadIds: stringArray(candidate.pinnedThreadIds),
    snoozes: backfilledSnoozes(store, snoozes),
    providerLabels: validEntries(candidate.providerLabels, isProviderLabelEntry),
    queuedActions: validEntries(candidate.queuedActions, isQueuedActionEntry),
    scheduledSends: validEntries(candidate.scheduledSends, isScheduledSendEntry),
    runs: validEntries(candidate.runs, isRunEntry).map(normalizedRun),
    aiTriage: validEntries(candidate.aiTriage, isAiTriageEntry),
    notificationPreferences: normalizedNotificationPreferences(
      candidate.notificationPreferences,
    ),
  }
}
