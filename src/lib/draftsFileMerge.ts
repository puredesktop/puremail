import type { Draft, MailMessage, MailRun, MailStore } from '../types'

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
 *    changed: sent beats unsent, an uncertain send beats an edit, a draft's
 *    maker beats a copy imported from the account, then the later edit time. Provider bookkeeping does not move `updatedAt`, which is
 *    why edit time alone cannot decide.
 * 4. A tombstone yields to a real edit made after it, and to a record new to
 *    the copy holding it (a provider listing it again, an id made again).
 */

export interface Tombstone {
  id: string
  deletedAt: string
  /** 'discarded' is a person's or a discard request's action; 'removed' is any other removal. */
  reason: 'discarded' | 'removed'
}

/** Long enough for any copy left open; a stale copy past this only re-adds a record. */
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 3600_000

type Stamped = { id: string; updatedAt: string; sentAt?: string; sendState?: string; importedFromProvider?: boolean }

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

/** Both changed: which one stays. Ties keep memory, the copy doing the saving. */
function winner<T extends Stamped>(memory: T, disk: T): T {
  if (Boolean(memory.sentAt) !== Boolean(disk.sentAt)) return memory.sentAt ? memory : disk
  if ((memory.sendState === 'uncertain') !== (disk.sendState === 'uncertain')) return memory.sendState === 'uncertain' ? memory : disk
  // A copy that only knows a draft from the account's listing has it on a made-up thread.
  if (Boolean(memory.importedFromProvider) !== Boolean(disk.importedFromProvider)) return memory.importedFromProvider ? disk : memory
  return time(disk.updatedAt) > time(memory.updatedAt) ? disk : memory
}

/** The tombstone covers this record unless it was really changed afterwards. */
function outlives(record: Stamped, tombstone: Tombstone, baseline: string | undefined): boolean {
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
  now: string
}): RecordMerge<T> {
  const { baseline, memory, disk, discards, now } = input
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
      if (outlives(record, tombstone, held)) {
        tombstones.delete(record.id)
      } else if (onDisk && outlives(onDisk, tombstone, held)) {
        tombstones.delete(record.id)
        merged.push(onDisk)
        arrived.push(onDisk)
        continue
      } else {
        removed.push(tombstone)
        continue
      }
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
    const kept = mine === held ? onDisk : winner(record, onDisk)
    merged.push(kept)
    if (kept === onDisk) arrived.push(onDisk)
  }

  for (const [id, held] of baseline) {
    if (memoryIds.has(id)) continue
    // This copy held it and no longer does: this copy deleted it.
    const discardedAt = discards?.get(id)
    const tombstone: Tombstone =
      tombstones.get(id) ?? { id, deletedAt: discardedAt ?? now, reason: discardedAt ? 'discarded' : 'removed' }
    const onDisk = diskById.get(id)
    if (onDisk && outlives(onDisk, tombstone, held)) {
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
    const tombstone = tombstones.get(record.id)
    if (tombstone && !outlives(record, tombstone, undefined)) continue
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

/** What another copy saved, for this copy to take into its memory. */
export interface DraftsFileChanges {
  drafts: Draft[]
  removedDrafts: Tombstone[]
  runs: MailRun[]
  removedRuns: Tombstone[]
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
    // Edited here since the snapshot that merge was made from: this edit stays,
    // and the next save decides.
    return time(record.updatedAt) > time(newer.updatedAt) ? record : newer
  })
  return [...next, ...incoming.values()]
}

const withoutRemoved = <T extends Stamped>(current: T[], removed: readonly Tombstone[]): T[] => {
  if (removed.length === 0) return current
  const byId = new Map(removed.map(tombstone => [tombstone.id, tombstone]))
  return current.filter(record => {
    const tombstone = byId.get(record.id)
    return !tombstone || time(record.updatedAt) > time(tombstone.deletedAt)
  })
}

/** Take another copy's saves into this store. Same store when there are none. */
export function applyDraftsFileChanges(store: MailStore, changes: DraftsFileChanges): MailStore {
  if (!changes.drafts.length && !changes.removedDrafts.length && !changes.runs.length && !changes.removedRuns.length && !changes.sentReceipts.length) return store
  const recoverMissing = <T extends { id: string }>(held: T[], recovered: readonly T[] = []): T[] => {
    const ids = new Set(held.map(item => item.id))
    const missing = recovered.filter(item => !ids.has(item.id))
    return missing.length ? [...held, ...missing] : held
  }
  const heldMessages = new Set(store.messages.map(message => message.id))
  return {
    ...store,
    accounts: recoverMissing(store.accounts, changes.recovery?.accounts),
    mailboxes: recoverMissing(store.mailboxes, changes.recovery?.mailboxes),
    threads: recoverMissing(store.threads, changes.recovery?.threads),
    drafts: withoutRemoved(upsertNewer(store.drafts, changes.drafts), changes.removedDrafts),
    runs: withoutRemoved(upsertNewer(store.runs ?? [], changes.runs), changes.removedRuns),
    messages: [...store.messages, ...changes.sentReceipts.filter(message => !heldMessages.has(message.id))],
  }
}
