import { recordFingerprint } from './draftsFileMerge'
import { compactPersistedMessage } from './mailStoreData'
import type { MailStore } from '../types'

/**
 * Merging `mail-store.json` when several copies of Mail run over one file.
 *
 * The file holds the mailbox cache and local workflow state: tasks, filters,
 * settings, stars, scheduled sends, queued provider actions. Writing it whole
 * from one copy's memory undoes what the others saved, and that can do real
 * harm: a scheduled send marked sent goes back to scheduled and goes out again
 * on the next launch; an action already replayed is queued to replay again.
 *
 * So a save is a three-way merge against what this copy last agreed with the
 * file on (the baseline). Each field is taken apart into entries: records by
 * id, strings by value, objects by key. Rules:
 *
 * 1. An entry only one side changed since the baseline takes that side.
 * 2. Both changed: the later `updatedAt` (or date, for a plain date value);
 *    otherwise this copy, whose save is the newer.
 * 3. An entry in the baseline and missing from either side was deleted, and
 *    stays deleted: there is no edit that brings it back.
 * 4. An entry not in the baseline is new, and is kept.
 *
 * Fields this file does not own (drafts, runs and scheduled sends live in
 * `mail-drafts.json`, see draftsFileMerge.ts) are never merged here.
 */

const NOT_HERE = new Set(['drafts', 'runs', 'scheduledSends', 'aiTriage', 'syncCoverage'])

type Entries = Map<string, { fingerprint: string; value: unknown }>
type Shape = { kind: 'records'; key: 'id' | 'threadId' } | { kind: 'strings' } | { kind: 'object' } | { kind: 'value' }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function shapeOf(value: unknown): Shape | null {
  if (value === undefined || value === null) return null
  if (isPlainObject(value)) return { kind: 'object' }
  if (!Array.isArray(value)) return { kind: 'value' }
  if (value.length === 0) return null
  if (value.every(item => typeof item === 'string')) return { kind: 'strings' }
  for (const key of ['id', 'threadId'] as const) {
    const unique = new Set(value.map(item => (isPlainObject(item) ? item[key] : undefined)))
    if (unique.size === value.length && [...unique].every(id => typeof id === 'string')) return { kind: 'records', key }
  }
  return { kind: 'value' }
}

/** The shape of a field, from whichever side says. Sides that disagree are one value. */
function fieldShape(memory: unknown, disk: unknown): Shape {
  const mine = shapeOf(memory)
  const theirs = shapeOf(disk)
  if (mine && theirs && JSON.stringify(mine) !== JSON.stringify(theirs)) return { kind: 'value' }
  return mine ?? theirs ?? { kind: 'value' }
}

function entriesOf(value: unknown, shape: Shape): Entries {
  const entries: Entries = new Map()
  if (shape.kind === 'records') {
    for (const item of (value ?? []) as Record<string, string>[]) entries.set(item[shape.key], { fingerprint: recordFingerprint(item), value: item })
  } else if (shape.kind === 'strings') {
    for (const item of (value ?? []) as string[]) entries.set(item, { fingerprint: '', value: item })
  } else if (shape.kind === 'object') {
    for (const [key, item] of Object.entries((value ?? {}) as Record<string, unknown>)) {
      if (item !== undefined) entries.set(key, { fingerprint: recordFingerprint(item), value: item })
    }
  }
  return entries
}

function rebuilt(entries: Iterable<unknown>, shape: Shape): unknown {
  if (shape.kind !== 'object') return [...entries]
  return Object.fromEntries(entries as Iterable<[string, unknown]>)
}

/** What this copy last agreed with the file on, field by field. */
export interface StoreBaseline {
  entries: Map<string, Map<string, string>>
  values: Map<string, string>
}

export function storeBaselineOf(store: unknown): StoreBaseline {
  const baseline: StoreBaseline = { entries: new Map(), values: new Map() }
  for (const [field, value] of Object.entries((store ?? {}) as Record<string, unknown>)) {
    if (NOT_HERE.has(field)) continue
    const shape = fieldShape(value, undefined)
    if (Array.isArray(value) && value.length === 0) {
      baseline.entries.set(field, new Map())
      continue
    }
    if (shape.kind === 'value') {
      baseline.values.set(field, recordFingerprint(value))
      continue
    }
    baseline.entries.set(field, new Map([...entriesOf(value, shape)].map(([key, entry]) => [key, entry.fingerprint])))
  }
  return baseline
}

/** Has this copy changed anything since it last agreed with the file? False means nothing to read or write. */
export function storeChangedSince(store: unknown, baseline: StoreBaseline): boolean {
  const now = storeBaselineOf(store)
  const sameEntries = (a: Map<string, string> = new Map(), b: Map<string, string> = new Map()): boolean =>
    a.size === b.size && [...a].every(([key, fingerprint]) => b.get(key) === fingerprint)
  for (const field of new Set([...now.entries.keys(), ...baseline.entries.keys()])) {
    if (!sameEntries(now.entries.get(field), baseline.entries.get(field))) return true
  }
  for (const field of new Set([...now.values.keys(), ...baseline.values.keys()])) {
    if (now.values.get(field) !== baseline.values.get(field)) return true
  }
  return false
}

const time = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && time(value) > 0

/** Both sides changed this entry since the baseline. True when the file's is the one to keep. */
function fileWins(mine: unknown, theirs: unknown): boolean {
  if (isDate(mine) && isDate(theirs)) return time(theirs) > time(mine)
  if (!isPlainObject(mine) || !isPlainObject(theirs)) return false
  return time(theirs.updatedAt) > time(mine.updatedAt)
}

export interface StoreFieldChanges {
  shape: Shape
  /** Taken from the file. `over`: what this copy held when the merge was made; absent when it held nothing. */
  upserts: { key: string; value: unknown; over?: string }[]
  /** Deleted by another copy. */
  removed: { key: string; over: string }[]
}

/** What another copy saved, for this copy to take into its memory. */
export interface StoreFileChanges {
  fields: Record<string, StoreFieldChanges>
  values: Record<string, unknown>
}

export const NO_STORE_CHANGES: StoreFileChanges = { fields: {}, values: {} }

/**
 * What arrived or was removed and this copy's memory has yet to show. A save can
 * run from a snapshot taken a moment before the last merge came back, and that
 * snapshot's lack of a record is not a delete (nor its holding one a new record).
 */
export interface UnseenChanges {
  arrived: Set<string>
  removed: Set<string>
}

export const noUnseenChanges = (): UnseenChanges => ({ arrived: new Set(), removed: new Set() })

export function mergeStoreFile(input: {
  baseline: StoreBaseline
  memory: Record<string, unknown>
  disk: Record<string, unknown> | null
  unseen?: UnseenChanges
}): {
  merged: Record<string, unknown>
  changes: StoreFileChanges
  /** The merge says something the file does not. False: nothing to write. */
  differs: boolean
  unseen: UnseenChanges
} {
  const { baseline, memory } = input
  const disk = input.disk ?? {}
  const unseen = { arrived: new Set(input.unseen?.arrived), removed: new Set(input.unseen?.removed) }
  const merged: Record<string, unknown> = {}
  const changes: StoreFileChanges = { fields: {}, values: {} }
  let differs = input.disk === null

  for (const field of new Set([...Object.keys(memory), ...Object.keys(disk)])) {
    if (NOT_HERE.has(field)) {
      if (field in memory) merged[field] = memory[field]
      else differs = true
      continue
    }
    const shape = fieldShape(memory[field], disk[field])
    if (shape.kind === 'value') {
      const mine = recordFingerprint(memory[field])
      const theirs = recordFingerprint(disk[field])
      const held = baseline.values.get(field) ?? recordFingerprint(undefined)
      let takeFile = false
      if (mine !== theirs) {
        if (mine === held) takeFile = true
        else if (theirs !== held) takeFile = fileWins(memory[field], disk[field])
      }
      const kept = takeFile ? disk[field] : memory[field]
      if (kept !== undefined) merged[field] = kept
      if (takeFile) changes.values[field] = kept
      else if (mine !== theirs) differs = true
      continue
    }

    const mine = entriesOf(memory[field], shape)
    const theirs = entriesOf(disk[field], shape)
    const held = baseline.entries.get(field) ?? new Map<string, string>()
    const kept = new Map<string, unknown>()
    const fieldChanges: StoreFieldChanges = { shape, upserts: [], removed: [] }
    const keep = (key: string, value: unknown): void => {
      kept.set(key, shape.kind === 'object' ? [key, value] : value)
    }

    for (const [key, entry] of mine) {
      const onDisk = theirs.get(key)
      const seenKey = `${field}\0${key}`
      unseen.arrived.delete(seenKey)
      if (!onDisk) {
        const removedHere = held.has(key) || unseen.removed.has(seenKey)
        if (removedHere) {
          // Another copy deleted it. It stays deleted.
          fieldChanges.removed.push({ key, over: entry.fingerprint })
          unseen.removed.add(seenKey)
        } else {
          keep(key, entry.value)
          differs = true
        }
        continue
      }
      if (entry.fingerprint === onDisk.fingerprint) {
        keep(key, entry.value)
        continue
      }
      const heldNow = held.get(key)
      let takeFile = false
      if (onDisk.fingerprint !== heldNow) {
        takeFile = entry.fingerprint === heldNow || fileWins(entry.value, onDisk.value)
      }
      if (takeFile) {
        keep(key, onDisk.value)
        fieldChanges.upserts.push({ key, value: onDisk.value, over: entry.fingerprint })
      } else {
        keep(key, entry.value)
        differs = true
      }
    }

    for (const [key, entry] of theirs) {
      if (mine.has(key)) continue
      const seenKey = `${field}\0${key}`
      unseen.removed.delete(seenKey)
      if (held.has(key) && !unseen.arrived.has(seenKey)) {
        // This copy held it and no longer does: this copy deleted it.
        differs = true
        continue
      }
      keep(key, entry.value)
      fieldChanges.upserts.push({ key, value: entry.value })
      unseen.arrived.add(seenKey)
    }

    merged[field] = rebuilt(kept.values(), shape)
    if (fieldChanges.upserts.length || fieldChanges.removed.length) changes.fields[field] = fieldChanges
  }
  return { merged, changes, differs, unseen }
}

/** A record as the file would hold it, for telling whether memory still holds what the merge saw. */
const asFiled = (field: string, value: unknown): unknown =>
  field === 'messages' ? compactPersistedMessage(value as MailStore['messages'][number]) : value

/** Take another copy's saves into this store. Same store when there are none. */
export function applyStoreFileChanges(store: MailStore, changes: StoreFileChanges): MailStore {
  const fieldNames = Object.keys(changes.fields)
  const valueNames = Object.keys(changes.values)
  if (fieldNames.length === 0 && valueNames.length === 0) return store
  const next = { ...store } as unknown as Record<string, unknown>
  for (const field of valueNames) next[field] = changes.values[field]
  for (const field of fieldNames) {
    const { shape, upserts, removed } = changes.fields[field]
    if (shape.kind === 'strings') {
      const held = new Set((next[field] ?? []) as string[])
      for (const item of removed) held.delete(item.key)
      for (const item of upserts) held.add(item.key)
      next[field] = [...held]
    } else if (shape.kind === 'object') {
      const held = { ...((next[field] ?? {}) as Record<string, unknown>) }
      for (const item of removed) delete held[item.key]
      for (const item of upserts) held[item.key] = item.value
      next[field] = held
    } else if (shape.kind === 'records') {
      const list = (next[field] ?? []) as Record<string, unknown>[]
      const position = new Map(list.map((record, index) => [record[shape.key] as string, index]))
      const gone = new Map(removed.map(item => [item.key, item.over]))
      const results = [...list]
      const added: Record<string, unknown>[] = []
      for (const item of upserts) {
        const at = position.get(item.key)
        if (at === undefined) {
          added.push(item.value as Record<string, unknown>)
          continue
        }
        // Edited here since the merge was made: this edit stays, and the next save decides.
        if (item.over === undefined || recordFingerprint(asFiled(field, results[at])) !== item.over) continue
        const incoming = item.value as Record<string, unknown>
        // The file holds plain text; the rich rendering in memory stays until the next sync replaces it.
        results[at] = field === 'messages' && !incoming.bodyHtml && results[at].bodyHtml ? { ...incoming, bodyHtml: results[at].bodyHtml } : incoming
      }
      next[field] = [
        ...results.filter(record => {
          const over = gone.get(record[shape.key] as string)
          return over === undefined || recordFingerprint(asFiled(field, record)) !== over
        }),
        ...added,
      ]
    }
  }
  return next as unknown as MailStore
}
