import { data } from '@purescience/platform-ui/bridge/apps/data/api'
import type { MailStore } from '../types'
import { ownerIdentityRegistryForStore } from './mailModel'

/**
 * PureMail's half of the suite contact feed: derive the people the user
 * actually corresponds with from the synced mailbox and hand them to
 * PurePeople. Each entry is a row in People's `contactFeed` collection;
 * People merges it and deletes it after committing the contact changes.
 *
 * The contract is duplicated from purepeople (apps can't import each
 * other); keep the two in step.
 */
export interface OutgoingContactFeedEntry {
  id: string
  sourceApp: 'mail'
  seenAt: string
  contact: { email: string; name?: string }
  context?: string
}

export async function publishContactFeed(entries: OutgoingContactFeedEntry[]): Promise<void> {
  await Promise.all(entries.map(entry => data.set('people', {
    collection: 'contactFeed', key: entry.id, value: entry,
  })))
}

/** Feed entries per sweep — a first sync over a big mailbox trickles out. */
const FEED_BATCH_LIMIT = 250

/** Addresses that are machines, not people. Mirrors purepeople's filter. */
export function isMachineEmail(email: string): boolean {
  return /no-?reply|do-?not-?reply|notifications?@|mailer-daemon|postmaster@|bounce/i.test(
    email,
  )
}

/**
 * The correspondents in this store not yet fed to PurePeople: real people
 * (machine addresses and the user's own identities excluded) from every
 * non-trash/spam message, one entry per address carrying the best name and
 * the latest sighting. Pure selection; the caller writes the entries and
 * records the keys.
 */
export function selectContactFeedCandidates(
  store: MailStore,
  now = new Date(),
): { entries: OutgoingContactFeedEntry[]; keys: string[] } {
  const fed = new Set(store.contactFeedKeys ?? [])
  const ownerEmails = new Set(
    ownerIdentityRegistryForStore(store).emails.map(email =>
      email.trim().toLowerCase(),
    ),
  )
  const excludedMailboxes = new Set(
    store.mailboxes
      .filter(mailbox => mailbox.role === 'trash' || /spam|junk/i.test(mailbox.name))
      .map(mailbox => mailbox.id),
  )
  const excludedThreads = new Set(
    store.threads
      .filter(thread => excludedMailboxes.has(thread.mailboxId))
      .map(thread => thread.id),
  )

  const best = new Map<
    string,
    { name: string; seenAt: string; context?: string }
  >()
  for (const message of store.messages) {
    if (excludedThreads.has(message.threadId)) continue
    const contacts = [message.from, ...message.to, ...(message.cc ?? [])]
    for (const contact of contacts) {
      const email = contact.email.trim().toLowerCase()
      if (!email || !email.includes('@')) continue
      if (isMachineEmail(email)) continue
      if (ownerEmails.has(email)) continue
      if (fed.has(email)) continue
      const name =
        contact.name && contact.name.trim().toLowerCase() !== email
          ? contact.name.trim()
          : ''
      const current = best.get(email)
      if (!current) {
        best.set(email, {
          name,
          seenAt: message.receivedAt,
          context: message.subject,
        })
        continue
      }
      if (message.receivedAt > current.seenAt) {
        current.seenAt = message.receivedAt
        current.context = message.subject
      }
      if (!current.name && name) current.name = name
    }
  }

  const entries: OutgoingContactFeedEntry[] = []
  const keys: string[] = []
  for (const [email, info] of best) {
    if (entries.length >= FEED_BATCH_LIMIT) break
    entries.push({
      id: `mail_${email}`,
      sourceApp: 'mail',
      seenAt: info.seenAt || now.toISOString(),
      contact: { email, ...(info.name ? { name: info.name } : {}) },
      ...(info.context ? { context: info.context.slice(0, 120) } : {}),
    })
    keys.push(email)
  }
  return { entries, keys }
}

/** Record fed addresses, capped so the list cannot grow forever. */
export function withContactFeedKeys(
  store: MailStore,
  keys: string[],
): MailStore {
  if (keys.length === 0) return store
  return {
    ...store,
    contactFeedKeys: [...(store.contactFeedKeys ?? []), ...keys].slice(-4000),
  }
}

/**
 * PureMail's half of PurePeople's connections: for each thread, who was on
 * it besides the user. People draws "who knows whom" from these (two people
 * on the same thread are connected); it only reads them. One row per thread
 * in People's `encounters` collection, keyed by thread, re-written when the
 * thread gains messages or people. Duplicated contract; keep in step with
 * purepeople's EncounterRecord.
 */
export interface OutgoingEncounter {
  id: string
  kind: 'thread'
  sourceApp: 'mail'
  subject?: string
  at: string
  /** Everyone on the thread except the user and machine senders, lowercased. */
  emails: string[]
  count: number
}

export async function publishEncounters(entries: OutgoingEncounter[]): Promise<void> {
  await Promise.all(entries.map(entry => data.set('people', {
    collection: 'encounters', key: entry.id, value: entry,
  })))
}

/** Threads with more people than this are broadcasts; People ignores them too. */
const ENCOUNTER_MAX_PEOPLE = 40
const ENCOUNTER_BATCH_LIMIT = 250
const ENCOUNTER_MARKS_CAP = 6000

/**
 * The threads whose participants People has not seen yet (or that changed
 * since): at least two people other than the user, trash and spam left out.
 * Pure selection; the caller writes the entries and records the marks.
 */
export function selectEncounterCandidates(
  store: MailStore,
): { entries: OutgoingEncounter[]; marks: Record<string, string> } {
  const done = store.encounterFeedMarks ?? {}
  const owner = new Set(ownerIdentityRegistryForStore(store).emails.map(email => email.trim().toLowerCase()))
  const excludedMailboxes = new Set(store.mailboxes.filter(mailbox => mailbox.role === 'trash' || /spam|junk/i.test(mailbox.name)).map(mailbox => mailbox.id))
  const threads = new Map(store.threads.filter(thread => !excludedMailboxes.has(thread.mailboxId)).map(thread => [thread.id, thread]))
  const byThread = new Map<string, { emails: Set<string>; at: string; count: number; subject?: string }>()
  for (const message of store.messages) {
    const thread = threads.get(message.threadId)
    if (!thread) continue
    let row = byThread.get(thread.id)
    if (!row) byThread.set(thread.id, row = { emails: new Set(), at: message.receivedAt, count: 0, subject: thread.subject || message.subject })
    row.count++
    if (message.receivedAt > row.at) row.at = message.receivedAt
    for (const contact of [message.from, ...message.to, ...(message.cc ?? [])]) {
      const email = contact.email.trim().toLowerCase()
      if (email.includes('@') && !owner.has(email) && !isMachineEmail(email)) row.emails.add(email)
    }
  }
  const entries: OutgoingEncounter[] = []
  const marks: Record<string, string> = {}
  for (const [threadId, row] of byThread) {
    if (entries.length >= ENCOUNTER_BATCH_LIMIT) break
    if (row.emails.size < 2 || row.emails.size > ENCOUNTER_MAX_PEOPLE) continue
    const mark = `${row.count}|${row.at}|${row.emails.size}`
    if (done[threadId] === mark) continue
    entries.push({ id: `mail_${threadId}`, kind: 'thread', sourceApp: 'mail', ...(row.subject ? { subject: row.subject.slice(0, 120) } : {}), at: row.at, emails: [...row.emails].sort(), count: row.count })
    marks[threadId] = mark
  }
  return { entries, marks }
}

/** Record sent threads, keeping the newest marks when over the cap. */
export function withEncounterFeedMarks(store: MailStore, marks: Record<string, string>): MailStore {
  if (!Object.keys(marks).length) return store
  const merged = Object.entries({ ...(store.encounterFeedMarks ?? {}), ...marks })
  const kept = merged.length > ENCOUNTER_MARKS_CAP ? merged.sort((a, b) => (a[1].split('|')[1] ?? '').localeCompare(b[1].split('|')[1] ?? '')).slice(-ENCOUNTER_MARKS_CAP) : merged
  return { ...store, encounterFeedMarks: Object.fromEntries(kept) }
}
