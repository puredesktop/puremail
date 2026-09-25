import { describe, expect, it } from 'vitest'
import { demoMailStore, mergeStarredThreadIds } from './mailModel'
import {
  applyBulkTriageAction,
  bulkArchiveThreads,
  bulkLabelThreads,
  bulkMarkThreadsRead,
  bulkMoveThreads,
  bulkSnoozeThreads,
  bulkTrashThreads,
  bulkTriageActionSummary,
  queuedActionForBulkTriage,
  setThreadStarred,
} from './mailTriage'
import type { MailStore } from '../types'

const INBOX_IDS = ['thread_launch', 'thread_contract', 'thread_design']

function threadById(store: MailStore, threadId: string) {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) throw new Error(`missing thread ${threadId}`)
  return thread
}

describe('star state', () => {
  it('adds and removes starred thread ids without duplicates', () => {
    let store = demoMailStore()
    store = setThreadStarred(store, 'thread_launch', true)
    store = setThreadStarred(store, 'thread_launch', true)
    expect(store.starredThreadIds).toEqual(['thread_launch'])

    store = setThreadStarred(store, 'thread_launch', false)
    expect(store.starredThreadIds).toEqual([])
  })

  it('returns the same store when the star state already matches', () => {
    const store = demoMailStore()
    expect(setThreadStarred(store, 'thread_launch', false)).toBe(store)
  })
})

describe('bulk triage actions on multiple threads', () => {
  it('archives several threads at once', () => {
    const store = bulkArchiveThreads(demoMailStore(), INBOX_IDS)
    for (const threadId of INBOX_IDS) {
      expect(threadById(store, threadId).status).toBe('archived')
      expect(threadById(store, threadId).syncState).toBe('pending')
    }
  })

  it('moves several threads to Trash', () => {
    const store = bulkTrashThreads(demoMailStore(), INBOX_IDS)
    for (const threadId of INBOX_IDS) {
      expect(threadById(store, threadId).mailboxId).toBe('mailbox_trash')
    }
  })

  it('marks several threads read and unread', () => {
    const read = bulkMarkThreadsRead(demoMailStore(), INBOX_IDS, true)
    for (const threadId of INBOX_IDS) {
      expect(
        read.messages
          .filter(message => message.threadId === threadId)
          .every(message => message.read),
      ).toBe(true)
    }
    const unread = bulkMarkThreadsRead(read, ['thread_launch'], false)
    expect(
      unread.messages
        .filter(message => message.threadId === 'thread_launch')
        .every(message => !message.read),
    ).toBe(true)
  })

  it('labels and moves several threads', () => {
    const base = demoMailStore()
    const label = base.labels[0]
    const labeled = bulkLabelThreads(base, INBOX_IDS, label.id)
    for (const threadId of INBOX_IDS) {
      expect(threadById(labeled, threadId).labels).toContain(label.name)
    }
    const moved = bulkMoveThreads(base, INBOX_IDS, 'mailbox_archive')
    for (const threadId of INBOX_IDS) {
      expect(threadById(moved, threadId).mailboxId).toBe('mailbox_archive')
    }
  })


  it('snoozes several threads and records return metadata', () => {
    const until = '2026-07-06T09:00:00.000Z'
    const now = '2026-07-05T13:00:00.000Z'
    const store = bulkSnoozeThreads(demoMailStore(), INBOX_IDS, until, now)
    for (const threadId of INBOX_IDS) {
      const thread = threadById(store, threadId)
      expect(thread.status).toBe('snoozed')
      expect(thread.snoozedUntil).toBe(until)
    }
    expect(store.snoozes).toHaveLength(INBOX_IDS.length)
    const record = store.snoozes?.find(
      entry => entry.threadId === 'thread_launch',
    )
    expect(record).toMatchObject({
      snoozedUntil: until,
      snoozedAt: now,
      returnMailboxId: 'mailbox_inbox',
      reason: 'manual',
    })
  })

  it('re-snoozing replaces the previous metadata record', () => {
    const first = bulkSnoozeThreads(
      demoMailStore(),
      ['thread_launch'],
      '2026-07-06T09:00:00.000Z',
    )
    const second = bulkSnoozeThreads(
      first,
      ['thread_launch'],
      '2026-07-08T09:00:00.000Z',
    )
    const records = (second.snoozes ?? []).filter(
      entry => entry.threadId === 'thread_launch',
    )
    expect(records).toHaveLength(1)
    expect(records[0]?.snoozedUntil).toBe('2026-07-08T09:00:00.000Z')
  })

  it('leaves unknown thread ids untouched', () => {
    const store = bulkArchiveThreads(demoMailStore(), ['thread_missing'])
    expect(store.threads).toEqual(demoMailStore().threads)
  })

  it('dispatches every action type through applyBulkTriageAction', () => {
    const base = demoMailStore()
    expect(
      threadById(
        applyBulkTriageAction(base, INBOX_IDS, { type: 'archive' }),
        'thread_launch',
      ).status,
    ).toBe('archived')
    expect(
      threadById(
        applyBulkTriageAction(base, INBOX_IDS, { type: 'trash' }),
        'thread_launch',
      ).mailboxId,
    ).toBe('mailbox_trash')
    expect(
      applyBulkTriageAction(base, INBOX_IDS, {
        type: 'snooze',
        snoozedUntil: '2026-07-06T09:00:00.000Z',
      }).snoozes,
    ).toHaveLength(INBOX_IDS.length)
  })
})

describe('provider-side bulk encoding', () => {
  it('maps triage actions onto queued provider action types', () => {
    expect(queuedActionForBulkTriage({ type: 'archive' })).toEqual({
      type: 'archive',
    })
    expect(queuedActionForBulkTriage({ type: 'read', read: true })).toEqual({
      type: 'markRead',
    })
    expect(queuedActionForBulkTriage({ type: 'read', read: false })).toEqual({
      type: 'markUnread',
    })
    expect(
      queuedActionForBulkTriage({ type: 'label', labelId: 'label_review' }),
    ).toEqual({ type: 'label', payload: { labelId: 'label_review' } })
    expect(
      queuedActionForBulkTriage({
        type: 'snooze',
        snoozedUntil: '2026-07-06T09:00:00.000Z',
      }),
    ).toEqual({
      type: 'snooze',
      payload: { snoozedUntil: '2026-07-06T09:00:00.000Z' },
    })
  })

  it('writes human summaries with counts', () => {
    expect(bulkTriageActionSummary({ type: 'archive' }, 1)).toBe(
      'Archived 1 thread.',
    )
    expect(bulkTriageActionSummary({ type: 'trash' }, 3)).toBe(
      'Moved 3 threads to Trash.',
    )
    expect(
      bulkTriageActionSummary({ type: 'read', read: false }, 2),
    ).toBe('Marked 2 threads unread.')
  })
})

describe('starred merge through provider sync', () => {
  it('prefers provider stars for covered threads and keeps local stars for uncovered ones', () => {
    const current = {
      starredThreadIds: ['thread_local_only', 'thread_covered_unstarred'],
    }
    const provider = {
      starredThreadIds: ['thread_covered_starred'],
      threads: [
        { id: 'thread_covered_starred' },
        { id: 'thread_covered_unstarred' },
      ] as MailStore['threads'],
    }
    expect(mergeStarredThreadIds(current, provider)).toEqual([
      'thread_covered_starred',
      'thread_local_only',
    ])
  })

  it('keeps local stars untouched when the provider reports nothing', () => {
    const current = { starredThreadIds: ['thread_local'] }
    expect(
      mergeStarredThreadIds(current, {
        starredThreadIds: undefined,
        threads: [] as MailStore['threads'],
      }),
    ).toEqual(['thread_local'])
  })
})
