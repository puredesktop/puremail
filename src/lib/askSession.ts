/**
 * State for the reader's Ask panel.
 *
 * Kept out of the component for two reasons. It is the part with the bugs
 * worth testing — an answer must never appear under a thread it was not
 * asked about — and those bugs are about ordering, which is far easier to
 * assert on a plain reducer than through a rendered component.
 *
 * Two distinct failures are guarded here:
 *
 *  1. Switching threads must clear what is on screen.
 *  2. A response that arrives *after* a switch must not land. Clearing state
 *     alone does not prevent this: the promise from the previous thread is
 *     still in flight and will happily resolve into the new thread's panel.
 *
 * Every request therefore carries an AskRef naming the thread and the entry
 * it belongs to, and a response is only applied when that ref is still
 * current.
 */

export type AskEntryKind = 'question' | 'summary'

export type AskEntryStatus = 'pending' | 'answered' | 'failed'

export interface AskEntry {
  id: string
  kind: AskEntryKind
  /** What the user asked, shown above the answer so a transcript reads back. */
  question: string
  answer: string
  /** Only ever populated for summaries; each becomes an "Add task" row. */
  actionItems: string[]
  status: AskEntryStatus
}

export interface AskSession {
  threadId: string
  entries: AskEntry[]
  /** Monotonic; names the next entry so ids cannot collide within a thread. */
  nextId: number
}

/** Identifies one in-flight request. Held by the caller across the await. */
export interface AskRef {
  threadId: string
  entryId: string
}

export function emptyAskSession(threadId: string): AskSession {
  return { threadId, entries: [], nextId: 1 }
}

/**
 * The session to use for `threadId`. Returns an empty session when the thread
 * changed, so callers can apply this unconditionally on render or on change.
 */
export function askSessionForThread(
  session: AskSession,
  threadId: string,
): AskSession {
  return session.threadId === threadId ? session : emptyAskSession(threadId)
}


export function beginAsk(
  session: AskSession,
  question: string,
  kind: AskEntryKind = 'question',
): { session: AskSession; ref: AskRef } {
  const entryId = `ask-${session.nextId}`
  const entry: AskEntry = {
    id: entryId,
    kind,
    question,
    answer: '',
    actionItems: [],
    status: 'pending',
  }
  return {
    session: {
      ...session,
      entries: [...session.entries, entry],
      nextId: session.nextId + 1,
    },
    ref: { threadId: session.threadId, entryId },
  }
}

/**
 * Whether a response for `ref` should be dropped. Stale once the session has
 * moved to another thread, or once the entry is gone (cleared transcript).
 */
export function isStaleAsk(session: AskSession, ref: AskRef): boolean {
  if (session.threadId !== ref.threadId) return true
  return !session.entries.some(entry => entry.id === ref.entryId)
}

function settleAsk(
  session: AskSession,
  ref: AskRef,
  patch: Partial<AskEntry>,
): AskSession {
  if (isStaleAsk(session, ref)) return session
  return {
    ...session,
    entries: session.entries.map(entry =>
      entry.id === ref.entryId ? { ...entry, ...patch } : entry,
    ),
  }
}

export function resolveAsk(
  session: AskSession,
  ref: AskRef,
  answer: string,
  actionItems: string[] = [],
): AskSession {
  return settleAsk(session, ref, { answer, actionItems, status: 'answered' })
}

export function failAsk(
  session: AskSession,
  ref: AskRef,
  message: string,
): AskSession {
  return settleAsk(session, ref, { answer: message, status: 'failed' })
}

/** True while any request is outstanding, for the panel's progress line. */
export function askSessionBusy(session: AskSession): boolean {
  return session.entries.some(entry => entry.status === 'pending')
}

/** Newest first: the freshest answer sits next to the input. */
export function askEntriesNewestFirst(session: AskSession): AskEntry[] {
  return [...session.entries].reverse()
}
