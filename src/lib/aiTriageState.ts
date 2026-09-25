import type {
  MailAiTriageRecord,
  MailAiTriageVerdict,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'

/**
 * The state half of AI triage, importing nothing but types. The query
 * resolver asks "is this thread triaged?" of every thread it filters, and
 * must not pull in the feed and report code, which itself resolves queries.
 *
 * A thread is triaged when a decision exists AND nothing has arrived since
 * the message it was made against. A new message reopens it; the old record
 * stays, so the next batch can say what was decided before.
 */

export const AI_TRIAGE_VERDICTS: readonly MailAiTriageVerdict[] = [
  'needs_reply',
  'important',
  'fyi',
  'noise',
]

/** How each verdict reads to a person. */
export const AI_TRIAGE_LABELS: Record<MailAiTriageVerdict, string> = {
  needs_reply: 'needs reply',
  important: 'important',
  fyi: 'FYI',
  noise: 'noise',
}

export function isAiTriageVerdict(value: unknown): value is MailAiTriageVerdict {
  return (
    typeof value === 'string' &&
    (AI_TRIAGE_VERDICTS as readonly string[]).includes(value)
  )
}

/** A message that was actually delivered: not a draft, not an optimistic send. */
export function isDeliveredMessage(message: MailMessage): boolean {
  return !message.isDraft && !message.optimistic
}

// The store is replaced wholesale on every change, so indexes keyed on it
// are invalidated automatically and never leak.
const recordIndexes = new WeakMap<MailStore, Map<string, MailAiTriageRecord>>()
const latestIndexes = new WeakMap<MailStore, Map<string, MailMessage>>()

/** The decision on record for a thread, whether or not it is still current. */
export function aiTriageRecordFor(
  store: MailStore,
  threadId: string,
): MailAiTriageRecord | null {
  let index = recordIndexes.get(store)
  if (!index) {
    index = new Map((store.aiTriage ?? []).map(record => [record.threadId, record]))
    recordIndexes.set(store, index)
  }
  return index.get(threadId) ?? null
}

/** The newest delivered message in a thread. */
export function latestDeliveredMessage(
  store: MailStore,
  threadId: string,
): MailMessage | null {
  let index = latestIndexes.get(store)
  if (!index) {
    index = new Map()
    for (const message of store.messages) {
      if (!isDeliveredMessage(message)) continue
      const current = index.get(message.threadId)
      if (!current || message.receivedAt > current.receivedAt) {
        index.set(message.threadId, message)
      }
    }
    latestIndexes.set(store, index)
  }
  return index.get(threadId) ?? null
}

/** The decision that still stands: made against the thread's latest message. */
export function aiTriageCurrent(
  store: MailStore,
  thread: Pick<MailThread, 'id'>,
): MailAiTriageRecord | null {
  const record = aiTriageRecordFor(store, thread.id)
  if (!record) return null
  const latest = latestDeliveredMessage(store, thread.id)
  if (!latest) return null
  return latest.id === record.messageId
    ? record
    : null
}
