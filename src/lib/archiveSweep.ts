import type { MailMessage, MailWalkCursor } from '../types'
import { cleanMailMessageText } from './mailTextUtils'

/**
 * Going through a whole mailbox once, for any purpose: an archive sweep walks
 * every message on the server, keeps its place between runs, and sets aside
 * the ones that match what the caller asked for. The caller judges each one
 * and may have it saved as a file. It works past the local sync window and
 * never adds the old mail to the local store, which could not hold it.
 *
 * The app only matches words and senders the caller gave it. It makes no
 * judgment of its own: every keep or skip is the caller's.
 */

/** Characters one batch may use: under the shell's limit for one tool result. */
export const SWEEP_RESULT_BUDGET = 3700
/** Messages one batch returns at most, however short they are. */
export const SWEEP_MAX_BATCH = 8
/** The longest excerpt of one message a batch carries. */
export const SWEEP_TEXT_CAP = 420
/** The most of one message `readArchiveItem` returns. */
export const SWEEP_READ_CAP = 3400
/** Attempts to save a kept message before it is kept without its file. */
export const SWEEP_SAVE_ATTEMPTS = 2

export type SweepSave = 'auto' | 'pdf' | 'attachments' | 'both' | 'none'

export interface SweepRequest {
  name: string
  /** Any of these in the subject, body or a file name. None means no word test. */
  words?: string[]
  /** Any of these in the sender's address: an address, or a domain. */
  senders?: string[]
  /** Any of these in the subject or sender rules the message out. */
  exclude?: string[]
  /** Leave out bulk mail (a List-Unsubscribe header) that has no files. */
  skipBulk?: boolean
  /** ISO dates: only what arrived on or after `since` and before `before`. */
  since?: string
  before?: string
}

export interface SweepQueued {
  id: string
  at: string
  subject: string
  from: string
  /** How many times saving it has failed. */
  attempts?: number
}

export interface SweepKept {
  id: string
  at: string
  subject: string
  from: string
  note?: string
  files: string[]
  /** Why its file could not be saved. */
  saveFailed?: string
  by: 'person' | 'agent'
}

export interface ArchiveSweep extends SweepRequest {
  id: string
  createdAt: string
  updatedAt: string
  by: 'person' | 'agent'
  /** The next page; null before the first and after the last. */
  cursor: MailWalkCursor | null
  finished: boolean
  stopped: boolean
  /** Messages looked at, and a rough total when the server gives one. */
  scanned: number
  approxTotal?: number
  /** Copies of one message in several folders count once. */
  seen: string[]
  queue: SweepQueued[]
  kept: SweepKept[]
  skipped: number
}

export interface SweepFile {
  version: 1
  sweeps: ArchiveSweep[]
}

export interface SweepRow {
  id: string
  at: string
  subject: string
  from: string
  text: string
  cut?: true
  files?: string[]
  bulk?: true
}

export interface SweepDecision {
  id: string
  keep: boolean
  note?: string
  save?: SweepSave
}

const words = (list: string[] | undefined): string[] =>
  [...new Set((list ?? []).map(item => item.trim().toLowerCase()).filter(Boolean))]

export function newSweep(
  request: SweepRequest,
  by: 'person' | 'agent',
  now: Date = new Date(),
): ArchiveSweep {
  const name = request.name.trim()
  if (!name) throw new Error('A sweep needs a name.')
  const at = now.toISOString()
  for (const key of ['since', 'before'] as const) {
    if (request[key] && Number.isNaN(new Date(request[key]!).getTime())) {
      throw new Error(`"${key}" is not a date: ${request[key]}.`)
    }
  }
  return {
    id: `sweep_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    words: words(request.words),
    senders: words(request.senders),
    exclude: words(request.exclude),
    ...(request.skipBulk ? { skipBulk: true } : {}),
    ...(request.since ? { since: request.since } : {}),
    ...(request.before ? { before: request.before } : {}),
    createdAt: at,
    updatedAt: at,
    by,
    cursor: null,
    finished: false,
    stopped: false,
    scanned: 0,
    seen: [],
    queue: [],
    kept: [],
    skipped: 0,
  }
}

/** Words as a whole word or the start of one: "invoice" finds "invoices", not "reinvoiced". */
function hasWord(haystack: string, word: string): boolean {
  let from = 0
  for (;;) {
    const at = haystack.indexOf(word, from)
    if (at < 0) return false
    if (at === 0 || !/[\p{L}\p{N}]/u.test(haystack[at - 1]!)) return true
    from = at + 1
  }
}

function plainText(message: MailMessage): string {
  return cleanMailMessageText(message).text
}

/** Whether a message is one the sweep was asked to set aside. */
export function sweepMatches(
  sweep: Pick<ArchiveSweep, 'words' | 'senders' | 'exclude' | 'skipBulk' | 'since' | 'before'>,
  message: MailMessage,
): boolean {
  if (message.isDraft) return false
  if (sweep.since && message.receivedAt < new Date(sweep.since).toISOString()) return false
  if (sweep.before && message.receivedAt >= new Date(sweep.before).toISOString()) return false
  const files = message.attachments ?? []
  if (sweep.skipBulk && message.listUnsubscribe && files.length === 0) return false
  const sender = (message.from?.email ?? '').toLowerCase()
  const subject = (message.subject ?? '').toLowerCase()
  if ((sweep.exclude ?? []).some(word => sender.includes(word) || hasWord(subject, word))) return false
  const wanted = sweep.words ?? []
  const fromWanted = sweep.senders ?? []
  if (!wanted.length && !fromWanted.length) return true
  if (fromWanted.some(item => sender.includes(item))) return true
  if (!wanted.length) return false
  const haystack = `${subject}\n${files.map(file => file.name).join('\n').toLowerCase()}\n${plainText(message).toLowerCase()}`
  return wanted.some(word => hasWord(haystack, word))
}

/** The start of a message, then the places the sweep's words appear. */
export function sweepExcerpt(
  text: string,
  wanted: readonly string[],
  cap: number = SWEEP_TEXT_CAP,
): { text: string; cut: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= cap) return { text: flat, cut: false }
  const lower = flat.toLowerCase()
  const head = Math.min(120, Math.floor(cap / 3))
  const spans: Array<[number, number]> = [[0, head]]
  const room = 110
  for (const word of wanted) {
    const at = lower.indexOf(word, head)
    if (at >= 0) spans.push([Math.max(head, at - 30), Math.min(flat.length, at + room)])
  }
  spans.sort((a, b) => a[0] - b[0])
  let out = ''
  let end = 0
  for (const [from, to] of spans) {
    const start = Math.max(from, end)
    if (start >= to) continue
    const piece = flat.slice(start, to)
    const joined = `${out}${out && start > end ? ' … ' : ''}${piece}`
    if (joined.length > cap) {
      out = joined.slice(0, cap)
      end = to
      break
    }
    out = joined
    end = to
  }
  if (out.length <= head) out = flat.slice(0, cap)
  return { text: out, cut: true }
}

export function sweepRow(sweep: Pick<ArchiveSweep, 'words'>, id: string, message: MailMessage): SweepRow {
  const excerpt = sweepExcerpt(plainText(message), sweep.words ?? [])
  const files = (message.attachments ?? []).map(file => file.name)
  return {
    id,
    at: message.receivedAt,
    subject: message.subject ?? '(no subject)',
    from: message.from?.email ?? '',
    text: excerpt.text,
    ...(excerpt.cut ? { cut: true as const } : {}),
    ...(files.length ? { files } : {}),
    ...(message.listUnsubscribe ? { bulk: true as const } : {}),
  }
}

/** As many rows as fit one result, at least one. */
export function packSweepRows(rows: readonly SweepRow[]): SweepRow[] {
  const packed: SweepRow[] = []
  let used = 0
  for (const row of rows.slice(0, SWEEP_MAX_BATCH)) {
    const size = JSON.stringify(row).length + 6
    if (packed.length && used + size > SWEEP_RESULT_BUDGET) break
    packed.push(row)
    used += size
  }
  return packed
}

/** A short stable mark for a message, so a copy in another folder counts once. */
function mark(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(36)}${value.length.toString(36)}`
}

/** One page of the walk taken into the sweep. Nothing changes when the page is not the one it was waiting for. */
export function takeWalkPage(
  sweep: ArchiveSweep,
  page: {
    from: MailWalkCursor | null
    items: ReadonlyArray<{ id: string; message: MailMessage }>
    cursor: MailWalkCursor | null
    approxTotal?: number
  },
  now: Date = new Date(),
): { sweep: ArchiveSweep; added: string[] } {
  if (JSON.stringify(sweep.cursor) !== JSON.stringify(page.from)) return { sweep, added: [] }
  const seen = new Set(sweep.seen)
  const queued = new Set(sweep.queue.map(item => item.id))
  const decided = new Set(sweep.kept.map(item => item.id))
  const queue = [...sweep.queue]
  const added: string[] = []
  let scanned = sweep.scanned
  for (const { id, message } of page.items) {
    const key = mark(message.messageIdHeader?.trim() || id)
    if (seen.has(key)) continue
    seen.add(key)
    scanned += 1
    if (queued.has(id) || decided.has(id) || !sweepMatches(sweep, message)) continue
    queue.push({
      id,
      at: message.receivedAt,
      subject: message.subject ?? '(no subject)',
      from: message.from?.email ?? '',
    })
    added.push(id)
  }
  return {
    added,
    sweep: {
      ...sweep,
      cursor: page.cursor,
      finished: page.cursor === null,
      scanned,
      seen: [...seen],
      queue,
      updatedAt: now.toISOString(),
      ...(page.approxTotal && !sweep.approxTotal ? { approxTotal: page.approxTotal } : {}),
    },
  }
}

export interface SweepOutcome {
  id: string
  keep: boolean
  note?: string
  files?: string[]
  saveFailed?: string
}

/** Decisions applied. A kept message whose file failed stays queued until it has had its attempts. */
export function applySweepOutcomes(
  sweep: ArchiveSweep,
  outcomes: readonly SweepOutcome[],
  by: 'person' | 'agent',
  now: Date = new Date(),
): { sweep: ArchiveSweep; recorded: string[]; retry: string[]; unknown: string[] } {
  const queue = [...sweep.queue]
  const kept = [...sweep.kept]
  let skipped = sweep.skipped
  const recorded: string[] = []
  const retry: string[] = []
  const unknown: string[] = []
  for (const outcome of outcomes) {
    const at = queue.findIndex(item => item.id === outcome.id)
    if (at < 0) {
      unknown.push(outcome.id)
      continue
    }
    const item = queue[at]!
    if (outcome.keep && outcome.saveFailed && (item.attempts ?? 0) + 1 < SWEEP_SAVE_ATTEMPTS) {
      queue[at] = { ...item, attempts: (item.attempts ?? 0) + 1 }
      retry.push(item.id)
      continue
    }
    queue.splice(at, 1)
    recorded.push(item.id)
    if (!outcome.keep) {
      skipped += 1
      continue
    }
    kept.push({
      id: item.id,
      at: item.at,
      subject: item.subject,
      from: item.from,
      ...(outcome.note ? { note: outcome.note } : {}),
      files: outcome.files ?? [],
      ...(outcome.saveFailed ? { saveFailed: outcome.saveFailed } : {}),
      by,
    })
  }
  return {
    recorded,
    retry,
    unknown,
    sweep: { ...sweep, queue, kept, skipped, updatedAt: now.toISOString() },
  }
}

/** Where a sweep stands, in the words both the screen and the tools use. */
export function sweepProgress(sweep: ArchiveSweep): {
  status: 'stopped' | 'walking' | 'waiting' | 'done'
  said: string
} {
  const looked =
    sweep.approxTotal && !sweep.finished
      ? `${sweep.scanned.toLocaleString('en-US')} of about ${sweep.approxTotal.toLocaleString('en-US')} messages`
      : `${sweep.scanned.toLocaleString('en-US')} messages`
  const tally = `${sweep.kept.length.toLocaleString('en-US')} kept, ${sweep.skipped.toLocaleString('en-US')} skipped`
  if (sweep.stopped) return { status: 'stopped', said: `Stopped after ${looked}. ${tally}.` }
  if (sweep.finished && sweep.queue.length === 0) {
    return { status: 'done', said: `Went through all ${looked}. ${tally}.` }
  }
  if (sweep.finished) {
    return { status: 'waiting', said: `Went through all ${looked}. ${sweep.queue.length.toLocaleString('en-US')} still to decide. ${tally}.` }
  }
  return { status: 'walking', said: `Looked at ${looked}. ${sweep.queue.length.toLocaleString('en-US')} waiting to be decided. ${tally}.` }
}

export function parseSweepFile(value: unknown): SweepFile {
  if (value == null) return { version: 1, sweeps: [] }
  const file = value as SweepFile
  if (file.version !== 1 || !Array.isArray(file.sweeps)) throw new Error('Mail sweep file is invalid')
  return file
}
