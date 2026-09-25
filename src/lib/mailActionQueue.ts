import type {
  MailStore,
  QueuedMailAction,
  QueuedMailActionType,
} from '../types'

/**
 * Phase M4 offline queue: provider actions that failed (connectivity or
 * provider outage) persist in the M0 `queuedActions` field and replay in
 * order on the next successful sync or an explicit retry. Sends are
 * deliberately NOT queued for auto-replay — a send failure may mean the
 * provider already accepted the message, and replaying would double-send
 * (the same reasoning as the provider's no-retry-on-send policy); failed
 * sends stay in Drafts with an explicit notice instead.
 */
export function enqueueMailAction(
  store: MailStore,
  type: QueuedMailActionType,
  threadId: string,
  payload?: Record<string, unknown>,
  now = new Date().toISOString(),
): MailStore {
  const action: QueuedMailAction = {
    id: `queued_${type}_${threadId}_${now.replace(/[^0-9]/g, '')}_${
      (store.queuedActions ?? []).length
    }`,
    type,
    threadId,
    ...(payload ? { payload } : {}),
    queuedAt: now,
    attempts: 0,
  }
  return {
    ...store,
    queuedActions: [...(store.queuedActions ?? []), action],
  }
}

export function discardQueuedAction(
  store: MailStore,
  actionId: string,
): MailStore {
  return {
    ...store,
    queuedActions: (store.queuedActions ?? []).filter(
      action => action.id !== actionId,
    ),
  }
}

export interface QueueReplayResult {
  store: MailStore
  replayedIds: string[]
  /** Actions whose thread no longer exists locally: surfaced, not silent. */
  conflicts: QueuedMailAction[]
  /** First still-failing action, when the replay stopped early. */
  stalled: QueuedMailAction | null
}

/**
 * Replay the queue in order through `callFor`. Conflicts (the thread has
 * since disappeared locally — deleted remotely or aged out) are removed
 * from the queue and reported so the UI can surface them. The first
 * still-failing action stops the replay to preserve ordering; its attempt
 * count and error persist for the queue list.
 */
export async function replayQueuedMailActions(
  store: MailStore,
  callFor: (action: QueuedMailAction) => Promise<void>,
): Promise<QueueReplayResult> {
  const queue = [...(store.queuedActions ?? [])]
  const replayedIds: string[] = []
  const conflicts: QueuedMailAction[] = []
  let stalled: QueuedMailAction | null = null
  const remaining: QueuedMailAction[] = []
  for (let index = 0; index < queue.length; index += 1) {
    const action = queue[index]!
    const threadExists = store.threads.some(
      thread => thread.id === action.threadId,
    )
    if (!threadExists) {
      conflicts.push(action)
      continue
    }
    try {
      await callFor(action)
      replayedIds.push(action.id)
    } catch (error) {
      stalled = {
        ...action,
        attempts: action.attempts + 1,
        lastError:
          error instanceof Error ? error.message : 'Provider call failed.',
      }
      remaining.push(stalled, ...queue.slice(index + 1))
      break
    }
  }
  return {
    store: { ...store, queuedActions: remaining },
    replayedIds,
    conflicts,
    stalled,
  }
}
