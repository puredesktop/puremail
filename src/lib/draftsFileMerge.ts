import { confirmedSentCopy } from './mailDeliveryStatus'
import type { Draft, MailMessage, MailRun, MailStore, ScheduledSend, ScheduledSendStatus } from '../types'

/**
 * Merging `mail-drafts.json` when several copies of Mail run over one file.
 *
 * Every copy keeps its own memory and saves on its own clock, so a save can
 * never be "write what I hold": a copy with an older view would erase whatever
 * the others saved since. Saving merges record by record instead. The rules:
 *
 * 1. Absence never means deleted. A record on disk and not in memory arrived
 *    from another copy; a record in memory and not on disk is written back.
 * 2. A delete is a tombstone, written by the copy that deleted: it held the
 *    record when it last agreed with the file (the baseline) and now does not.
 * 3. A record only one side changed since the baseline takes that side. Both
 *    changed: sent beats unsent, a marker already in the file beats another
 *    attempt's (the conditional write decided which got there first, and the
 *    loser stops before the mail service), an uncertain send beats an edit, the record
 *    settling an attempt beats that attempt, an attempt under way beats an
 *    edit, a draft's maker beats a copy imported from the account, then the
 *    later edit time. Provider bookkeeping and send attempts do not move
 *    `updatedAt`, which is why edit time alone cannot decide.
 * 4. A tombstone yields to a real edit made after it, to a send that is held,
 *    preparing, submitting or unconfirmed unless a confirmed copy shows it went
 *    (the delete may be a stale copy's, whether or not this copy's baseline has
 *    the attempt yet), and to a record new to the copy holding it (a provider
 *    listing it again, an id made again).
 */

export interface Tombstone {
  id: string
  deletedAt: string
  /** 'discarded' is a person's or a discard request's action; 'removed' is any other removal. */
  reason: 'discarded' | 'removed'
}

/** Long enough for any copy left open; a stale copy past this only re-adds a record. */
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 3600_000

type Stamped = {
  id: string
  updatedAt: string
  sentAt?: string
  sendSupersedes?: string[]
  sendError?: string
  sendUncertainties?: Draft['sendUncertainties']
  sendState?: string
  importedFromProvider?: boolean
  sendAttempt?: { id: string; phase?: string }
  sendSettledAttemptId?: string
  sendMessageId?: string
}

/** Whether this record went: a confirmed copy names it, or carries the Message-ID it was submitted under. */
export function recordConfirmedSent(messages: MailMessage[], record: Pick<Stamped, 'id' | 'sendMessageId'>): boolean {
  return Boolean(confirmedSentCopy({ messages }, record.id)) ||
    Boolean(record.sendMessageId && messages.some(message => !message.isDraft && !message.optimistic && message.messageIdHeader === record.sendMessageId))
}

const inTheAir = (record: Stamped): boolean => Boolean(record.sendAttempt) || record.sendState === 'uncertain' || Boolean(record.sendUncertainties?.some(item => !item.checkedAt))

const time = (value: string | undefined): number => {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

/** cyrb53: a small fingerprint, so a copy need not hold every draft twice. */
export function recordFingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? ''
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`
}

export const baselineOf = (records: ReadonlyArray<{ id: string }>): Map<string, string> =>
  new Map(records.map(record => [record.id, recordFingerprint(record)]))

/** `record` ended the attempt `other` still shows. */
const settles = (record: Stamped, other: Stamped): boolean =>
  Boolean(other.sendAttempt) && record.sendSettledAttemptId === other.sendAttempt?.id

/** `newer` shows nothing that ended the attempt `record` holds: it was saved without knowing of it. */
const attemptStands = (record: Stamped, newer: Stamped): boolean =>
  Boolean(record.sendAttempt) && !newer.sendAttempt && !newer.sentAt && newer.sendState !== 'uncertain' && !settles(newer, record)

/** `first` holds a marker for an attempt `other` is not, and `other` did not end: that send may be leaving. */
const markedFirst = (first: Stamped, other: Stamped): boolean =>
  first.sendAttempt?.phase === 'submitting' && other.sendAttempt?.id !== first.sendAttempt.id && !settles(other, first)

/** Another copy read this send as may-have-gone, without naming an attempt this copy can match. */
const readAsUnconfirmed = (attempt: Stamped, reading: Stamped): boolean =>
  Boolean(attempt.sendAttempt) && !reading.sendAttempt && reading.sendState === 'uncertain'

/** Both changed: which one stays. Ties keep memory, the copy doing the saving. */
function winner<T extends Stamped>(memory: T, disk: T): T {
  if (Boolean(memory.sentAt) !== Boolean(disk.sentAt)) return memory.sentAt ? memory : disk
  if (markedFirst(disk, memory)) return disk
  const memoryId = memory.sendAttempt?.id ?? memory.sendSettledAttemptId
  const diskId = disk.sendAttempt?.id ?? disk.sendSettledAttemptId
  if (diskId && memory.sendSupersedes?.includes(diskId)) return memory
  if (memoryId && disk.sendSupersedes?.includes(memoryId)) return disk
  if ((memory.sendState === 'uncertain') !== (disk.sendState === 'uncertain')) return memory.sendState === 'uncertain' ? memory : disk
  if (settles(disk, memory)) return disk
  if (settles(memory, disk)) return memory
  if (readAsUnconfirmed(memory, disk)) return disk
  // The record of a send that may be leaving outlives an edit made without knowing of it.
  if (Boolean(memory.sendAttempt) !== Boolean(disk.sendAttempt)) return memory.sendAttempt ? memory : disk
  // A copy that only knows a draft from the account's listing has it on a made-up thread.
  if (Boolean(memory.importedFromProvider) !== Boolean(disk.importedFromProvider)) return memory.importedFromProvider ? disk : memory
  return time(disk.updatedAt) > time(memory.updatedAt) ? disk : memory
}

/** The tombstone covers this record unless it was really changed afterwards. */
function outlives(record: Stamped, tombstone: Tombstone, baseline: string | undefined, confirmed: (record: Stamped) => boolean = () => false): boolean {
  if (inTheAir(record)) return !confirmed(record)
  if (baseline !== undefined && recordFingerprint(record) === baseline) return false
  return Boolean(record.sentAt) || time(record.updatedAt) > time(tombstone.deletedAt)
}

/** On load: the file can carry a record an older build wrote back over a tombstone. */
export function withoutTombstoned<T extends Stamped>(records: T[], tombstones: readonly Tombstone[]): T[] {
  const byId = new Map(tombstones.map(tombstone => [tombstone.id, tombstone]))
  return records.filter(record => {
    const tombstone = byId.get(record.id)
    return !tombstone || outlives(record, tombstone, undefined)
  })
}

export interface RecordMerge<T> {
  merged: T[]
  tombstones: Tombstone[]
  /** Records another copy saved that this copy's memory lacks or holds older. */
  arrived: T[]
  /** Records this copy holds that another copy deleted. */
  removed: Tombstone[]
}

export function mergeRecords<T extends Stamped>(input: {
  baseline: ReadonlyMap<string, string>
  memory: readonly T[]
  disk: readonly T[]
  tombstones: readonly Tombstone[]
  /** Removals this copy knows were real discards, with when. */
  discards?: ReadonlyMap<string, string>
  /** A send that a confirmed copy shows went: only then does a delete end it. */
  confirmed?: (record: Stamped) => boolean
  now: string
}): RecordMerge<T> {
  const { baseline, memory, disk, discards, confirmed, now } = input
  const diskById = new Map(disk.map(record => [record.id, record]))
  const memoryIds = new Set(memory.map(record => record.id))
  const tombstones = new Map(input.tombstones.map(tombstone => [tombstone.id, tombstone]))
  const merged: T[] = []
  const arrived: T[] = []
  const removed: Tombstone[] = []

  for (const record of memory) {
    const onDisk = diskById.get(record.id)
    const held = baseline.get(record.id)
    const tombstone = tombstones.get(record.id)
    if (tombstone && held !== undefined) {
      if (outlives(record, tombstone, held, confirmed)) {
        tombstones.delete(record.id)
      } else if (onDisk && outlives(onDisk, tombstone, held, confirmed)) {
        tombstones.delete(record.id)
        merged.push(onDisk)
        arrived.push(onDisk)
        continue
      } else {
        removed.push(tombstone)
        continue
      }
    } else if (tombstone && inTheAir(record) && confirmed?.(record)) {
      removed.push(tombstone)
      continue
    } else if (tombstone) {
      // New to this copy: a provider listed it again, or the id was made again.
      tombstones.delete(record.id)
    }
    if (!onDisk) {
      merged.push(record)
      continue
    }
    const mine = recordFingerprint(record)
    const theirs = recordFingerprint(onDisk)
    if (mine === theirs || theirs === held) {
      merged.push(record)
      continue
    }
    // A write made without knowing of an attempt this copy still holds does not end it.
    const chosen = mine === held && !attemptStands(record, onDisk) ? onDisk : winner(record, onDisk)
    // A record winning the current attempt cannot erase another attempt's uncertainty.
    // The person's explicit check is monotonic for that identity; clocks do not order it.
    const outcomes = new Map<string, NonNullable<Draft['sendUncertainties']>[number]>()
    for (const entry of [...(onDisk.sendUncertainties ?? []), ...(record.sendUncertainties ?? [])]) {
      const previous = outcomes.get(entry.attemptId)
      outcomes.set(entry.attemptId, previous?.checkedAt ? previous : entry)
    }
    // A stale controller may not have read the later decision before its
    // provider callback. Its settled uncertainty still belongs to its own id.
    for (const other of [record, onDisk]) {
      const otherId = other.sendAttempt?.id ?? other.sendSettledAttemptId
      if (other.sendState === 'uncertain' && otherId && chosen.sendSupersedes?.includes(otherId)) {
        outcomes.set(otherId, { attemptId: otherId, reason: other.sendError || 'The earlier send was not confirmed. Check Sent.', ...(other.sendMessageId ? { messageId: other.sendMessageId } : {}) })
      }
    }
    const kept = outcomes.size ? { ...chosen, sendUncertainties: [...outcomes.values()] } : chosen
    merged.push(kept)
    if (recordFingerprint(kept) !== mine) arrived.push(kept)
  }

  for (const [id, held] of baseline) {
    if (memoryIds.has(id)) continue
    // This copy held it and no longer does: this copy deleted it.
    const discardedAt = discards?.get(id)
    const tombstone: Tombstone =
      tombstones.get(id) ?? { id, deletedAt: discardedAt ?? now, reason: discardedAt ? 'discarded' : 'removed' }
    const onDisk = diskById.get(id)
    if (onDisk && outlives(onDisk, tombstone, held, confirmed)) {
      tombstones.delete(id)
      merged.push(onDisk)
      arrived.push(onDisk)
    } else {
      tombstones.set(id, discardedAt ? { ...tombstone, reason: 'discarded' } : tombstone)
    }
  }

  // A discard of a record never written is still a discard.
  for (const [id, deletedAt] of discards ?? []) {
    if (!memoryIds.has(id) && !diskById.has(id) && !tombstones.has(id)) tombstones.set(id, { id, deletedAt, reason: 'discarded' })
  }

  for (const record of disk) {
    if (memoryIds.has(record.id) || baseline.has(record.id)) continue
    const discardedAt = discards?.get(record.id)
    if (discardedAt && !inTheAir(record)) {
      tombstones.set(record.id, { id: record.id, deletedAt: discardedAt, reason: 'discarded' })
      continue
    }
    const tombstone = tombstones.get(record.id)
    if (tombstone && !outlives(record, tombstone, undefined, confirmed)) continue
    tombstones.delete(record.id)
    merged.push(record)
    arrived.push(record)
  }

  const oldest = time(now) - TOMBSTONE_MAX_AGE_MS
  return {
    merged,
    tombstones: [...tombstones.values()].filter(tombstone => time(tombstone.deletedAt) >= oldest),
    arrived,
    removed,
  }
}

/** Delivery receipts only accumulate: a union, less what this copy dropped itself. */
export function mergeReceipts(input: {
  baseline: ReadonlySet<string>
  memory: readonly MailMessage[]
  disk: readonly MailMessage[]
}): { merged: MailMessage[]; arrived: MailMessage[] } {
  const ids = new Set(input.memory.map(message => message.id))
  const arrived = input.disk.filter(message => !ids.has(message.id) && !input.baseline.has(message.id))
  return { merged: [...input.memory, ...arrived], arrived }
}

/** A schedule only moves forward: the later status holds, so a stale copy cannot revive one that was stopped. */
const SCHEDULE_STAGE: Record<ScheduledSendStatus, number> = { scheduled: 0, sending: 1, sent: 2, cancelled: 2, failed: 2, unconfirmed: 2 }

/** A union by id, less what this copy dropped itself, each at its furthest status. */
export function mergeScheduledSends(input: {
  baseline: ReadonlySet<string>
  memory: readonly ScheduledSend[]
  disk: readonly ScheduledSend[]
}): { merged: ScheduledSend[]; arrived: ScheduledSend[] } {
  const diskById = new Map(input.disk.map(entry => [entry.id, entry]))
  const ids = new Set(input.memory.map(entry => entry.id))
  const fresh = input.disk.filter(entry => !ids.has(entry.id) && !input.baseline.has(entry.id))
  const further = input.memory.flatMap(entry => {
    const onDisk = diskById.get(entry.id)
    return onDisk && SCHEDULE_STAGE[onDisk.status] > SCHEDULE_STAGE[entry.status] ? [onDisk] : []
  })
  const furtherById = new Map(further.map(entry => [entry.id, entry]))
  return {
    merged: [...input.memory.map(entry => furtherById.get(entry.id) ?? entry), ...fresh],
    arrived: [...further, ...fresh],
  }
}

/** What another copy saved, for this copy to take into its memory. */
export interface DraftsFileChanges {
  drafts: Draft[]
  removedDrafts: Tombstone[]
  /** Exact reconstructed snapshots rejected by the writer, valid only until this copy edits them. */
  rejectedReceiptDrafts?: Array<{ id: string; fingerprint: string }>
  runs: MailRun[]
  removedRuns: Tombstone[]
  scheduledSends: ScheduledSend[]
  sentReceipts: MailMessage[]
  recovery?: Pick<MailStore, 'accounts' | 'mailboxes' | 'threads'>
}

const upsertNewer = <T extends Stamped>(current: T[], arrived: readonly T[]): T[] => {
  if (arrived.length === 0) return current
  const incoming = new Map(arrived.map(record => [record.id, record]))
  const next = current.map(record => {
    const newer = incoming.get(record.id)
    if (!newer) return record
    incoming.delete(record.id)
    // What stops a send here holds whatever the times: its own marker's `updatedAt` proves nothing.
    if (newer.sendSupersedes?.includes(record.sendAttempt?.id ?? record.sendSettledAttemptId ?? '') || settles(newer, record) || markedFirst(newer, record) || readAsUnconfirmed(record, newer)) return newer
    // Edited here since the snapshot that merge was made from: this edit stays,
    // and the next save decides. Likewise a send begun here since.
    return time(record.updatedAt) > time(newer.updatedAt) || attemptStands(record, newer) ? record : newer
  })
  return [...next, ...incoming.values()]
}

const withoutRemoved = <T extends Stamped>(current: T[], removed: readonly Tombstone[], confirmed: (record: Stamped) => boolean = () => false): T[] => {
  if (removed.length === 0) return current
  const byId = new Map(removed.map(tombstone => [tombstone.id, tombstone]))
  return current.filter(record => {
    const tombstone = byId.get(record.id)
    if (!tombstone) return true
    // A send begun here since that merge's snapshot stands, unless it went.
    if (confirmed(record)) return false
    return inTheAir(record) || time(record.updatedAt) > time(tombstone.deletedAt)
  })
}

/** Take another copy's saves into this store. Same store when there are none. */
export function applyDraftsFileChanges(store: MailStore, changes: DraftsFileChanges): MailStore {
  if (!changes.rejectedReceiptDrafts?.length && !changes.drafts.length && !changes.removedDrafts.length && !changes.runs.length && !changes.removedRuns.length && !changes.scheduledSends.length && !changes.sentReceipts.length) return store
  const recoverMissing = <T extends { id: string }>(held: T[], recovered: readonly T[] = []): T[] => {
    const ids = new Set(held.map(item => item.id))
    const missing = recovered.filter(item => !ids.has(item.id))
    return missing.length ? [...held, ...missing] : held
  }
  const heldMessages = new Set(store.messages.map(message => message.id))
  const rejected = new Map(changes.rejectedReceiptDrafts?.map(record => [record.id, record.fingerprint]))
  const currentDrafts = store.drafts.filter(record => rejected.get(record.id) !== recordFingerprint(record))
  const schedules = mergeScheduledSends({ baseline: new Set(), memory: store.scheduledSends ?? [], disk: changes.scheduledSends })
  return {
    ...store,
    accounts: recoverMissing(store.accounts, changes.recovery?.accounts),
    mailboxes: recoverMissing(store.mailboxes, changes.recovery?.mailboxes),
    threads: recoverMissing(store.threads, changes.recovery?.threads),
    drafts: withoutRemoved(upsertNewer(currentDrafts, changes.drafts), changes.removedDrafts, record => recordConfirmedSent([...store.messages, ...changes.sentReceipts], record)),
    runs: withoutRemoved(upsertNewer(store.runs ?? [], changes.runs), changes.removedRuns),
    scheduledSends: schedules.merged,
    messages: [...store.messages, ...changes.sentReceipts.filter(message => !heldMessages.has(message.id))],
  }
}
