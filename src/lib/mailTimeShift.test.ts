import { describe, expect, it } from 'vitest'
import { demoMailStore } from './mailModel'
import { bulkSnoozeThreads } from './mailTriage'
import { clearSnoozeReturnMarker, wakeDueSnoozes } from './mailSnooze'
import {
  activeScheduledSends,
  cancelScheduledSend,
  dueScheduledSends,
  markScheduledSend,
  scheduleSend,
} from './mailScheduledSend'
import {
  discardQueuedAction,
  enqueueMailAction,
  replayQueuedMailActions,
} from './mailActionQueue'
import {
  newlyArrivedThreads,
  shouldNotifyForSnoozeReturn,
} from './mailNotifications'
import type { MailNotificationPreferences, QueuedMailAction } from '../types'

const NOW = '2026-07-05T12:00:00.000Z'
const PAST = '2026-07-05T09:00:00.000Z'
const FUTURE = '2026-07-06T09:00:00.000Z'

describe('snooze wake transitions', () => {
  it('wakes due snoozes back into their return mailbox, marked as returned', () => {
    let store = bulkSnoozeThreads(
      demoMailStore(),
      ['thread_launch'],
      PAST,
      '2026-07-04T12:00:00.000Z',
    )
    const result = wakeDueSnoozes(store, NOW)
    expect(result.wokenThreadIds).toEqual(['thread_launch'])
    const thread = result.store.threads.find(
      item => item.id === 'thread_launch',
    )!
    expect(thread.status).toBe('inbox')
    expect(thread.mailboxId).toBe('mailbox_inbox')
    expect(thread.snoozedUntil).toBeUndefined()
    expect(thread.snoozeReturnedAt).toBe(NOW)
    expect(result.store.snoozes).toEqual([])

    // Idempotent: a second pass wakes nothing (boot catch-up safe).
    const again = wakeDueSnoozes(result.store, NOW)
    expect(again.wokenThreadIds).toEqual([])

    // The marker clears once the user opens the thread.
    const cleared = clearSnoozeReturnMarker(result.store, 'thread_launch')
    expect(
      cleared.threads.find(item => item.id === 'thread_launch')
        ?.snoozeReturnedAt,
    ).toBeUndefined()
  })

  it('leaves snoozes that are not yet due', () => {
    const store = bulkSnoozeThreads(demoMailStore(), ['thread_launch'], FUTURE)
    const result = wakeDueSnoozes(store, NOW)
    expect(result.wokenThreadIds).toEqual([])
    expect(
      result.store.threads.find(item => item.id === 'thread_launch')?.status,
    ).toBe('snoozed')
    expect(result.store.snoozes).toHaveLength(1)
  })

  it('boot catch-up wakes everything overdue in one pass', () => {
    const store = bulkSnoozeThreads(
      demoMailStore(),
      ['thread_launch', 'thread_contract'],
      PAST,
    )
    const result = wakeDueSnoozes(store, NOW)
    expect(result.wokenThreadIds.sort()).toEqual([
      'thread_contract',
      'thread_launch',
    ])
  })
})

describe('scheduled sends', () => {
  it('schedules, lists, dispatches due entries, and marks status', () => {
    let store = scheduleSend(
      demoMailStore(),
      { draftId: 'draft_x', threadId: 'thread_launch', sendAt: PAST },
      '2026-07-04T12:00:00.000Z',
    )
    store = scheduleSend(store, {
      draftId: 'draft_y',
      threadId: 'thread_contract',
      sendAt: FUTURE,
    })
    expect(activeScheduledSends(store)).toHaveLength(2)
    const due = dueScheduledSends(store, NOW)
    expect(due.map(entry => entry.draftId)).toEqual(['draft_x'])

    const sentId = due[0]!.id
    store = markScheduledSend(store, sentId, 'sent')
    expect(dueScheduledSends(store, NOW)).toEqual([])
    expect(
      store.scheduledSends?.find(entry => entry.id === sentId)?.status,
    ).toBe('sent')
  })

  it('cancel keeps the record but stops dispatch, and failures keep the error', () => {
    let store = scheduleSend(demoMailStore(), {
      draftId: 'draft_x',
      threadId: 'thread_launch',
      sendAt: PAST,
    })
    const id = store.scheduledSends![0]!.id
    store = cancelScheduledSend(store, id)
    expect(dueScheduledSends(store, NOW)).toEqual([])
    expect(store.scheduledSends![0]!.status).toBe('cancelled')

    let failing = scheduleSend(demoMailStore(), {
      draftId: 'draft_z',
      threadId: 'thread_launch',
      sendAt: PAST,
    })
    const failingId = failing.scheduledSends![0]!.id
    failing = markScheduledSend(failing, failingId, 'failed', 'offline')
    expect(failing.scheduledSends![0]).toMatchObject({
      status: 'failed',
      lastError: 'offline',
    })
  })
})

describe('offline action queue', () => {
  it('enqueues failures and replays them in order on reconnect', async () => {
    let store = enqueueMailAction(demoMailStore(), 'archive', 'thread_launch')
    store = enqueueMailAction(store, 'markRead', 'thread_contract', undefined)
    const calls: string[] = []
    const result = await replayQueuedMailActions(store, async action => {
      calls.push(`${action.type}:${action.threadId}`)
    })
    expect(calls).toEqual(['archive:thread_launch', 'markRead:thread_contract'])
    expect(result.replayedIds).toHaveLength(2)
    expect(result.store.queuedActions).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.stalled).toBeNull()
  })

  it('stops at the first still-failing action and preserves order', async () => {
    let store = enqueueMailAction(demoMailStore(), 'archive', 'thread_launch')
    store = enqueueMailAction(store, 'trash', 'thread_contract')
    store = enqueueMailAction(store, 'markRead', 'thread_design')
    const result = await replayQueuedMailActions(store, async action => {
      if (action.type === 'trash') throw new Error('still offline')
    })
    expect(result.replayedIds).toHaveLength(1)
    expect(result.stalled?.type).toBe('trash')
    expect(result.stalled?.attempts).toBe(1)
    expect(result.stalled?.lastError).toBe('still offline')
    expect(result.store.queuedActions?.map(action => action.type)).toEqual([
      'trash',
      'markRead',
    ])
  })

  it('surfaces conflicts for threads that vanished instead of dropping silently', async () => {
    let store = enqueueMailAction(demoMailStore(), 'archive', 'thread_gone')
    store = enqueueMailAction(store, 'archive', 'thread_launch')
    const result = await replayQueuedMailActions(store, async () => {})
    expect(result.conflicts.map(action => action.threadId)).toEqual([
      'thread_gone',
    ])
    expect(result.replayedIds).toHaveLength(1)
    expect(result.store.queuedActions).toEqual([])
  })

  it('supports manual discard from the queue list', () => {
    const store = enqueueMailAction(demoMailStore(), 'archive', 'thread_launch')
    const action = store.queuedActions![0]! as QueuedMailAction
    expect(discardQueuedAction(store, action.id).queuedActions).toEqual([])
  })
})

describe('notification gating', () => {
  const prefs = (
    overrides: Partial<MailNotificationPreferences> = {},
  ): MailNotificationPreferences => ({
    enabled: true,
    scope: 'important',
    ...overrides,
  })


  it('gates snooze-return notifications separately', () => {
    expect(shouldNotifyForSnoozeReturn(prefs(), NOW)).toBe(true)
    expect(
      shouldNotifyForSnoozeReturn(prefs({ notifyOnSnoozeReturn: false }), NOW),
    ).toBe(false)
    expect(
      shouldNotifyForSnoozeReturn(prefs({ enabled: false }), NOW),
    ).toBe(false)
  })

  it('detects newly arrived unread threads across a merge', () => {
    const before = demoMailStore()
    const after = {
      ...before,
      messages: [
        ...before.messages,
        {
          id: 'msg_new_1',
          threadId: 'thread_launch',
          from: { name: 'Mira', email: 'mira@example.com' },
          to: [{ name: 'User', email: 'alex@example.com' }],
          subject: 'New!',
          body: 'fresh',
          receivedAt: NOW,
          attachments: [],
          read: false,
        },
      ],
    }
    expect(newlyArrivedThreads(before, after).map(thread => thread.id)).toEqual(
      ['thread_launch'],
    )
    expect(newlyArrivedThreads(after, after)).toEqual([])
  })
})
