import { describe, expect, it } from 'vitest'
import type { Draft, MailMessage } from '../types'
import { openingThreadShouldRepointMailbox } from './mailShellHelpers'
import {
  buildThreadHistoryEntries,
  filterThreadHistory,
  groupThreadHistoryByMonth,
  isInviteNoticeBody,
  threadHistoryCounts,
  threadHistorySpan,
  visibleThreadHistory,
} from './threadHistory'

const ME = 'alex@business.example'

function message(
  id: string,
  from: string,
  receivedAt: string,
  body = 'hello there',
): MailMessage {
  return {
    id,
    threadId: 'thread_1',
    from: { name: from.split('@')[0], email: from },
    to: [{ name: 'User', email: ME }],
    subject: 'Re: Ketty',
    body,
    receivedAt,
    attachments: [],
    read: true,
  }
}

function draft(id: string, updatedAt: string, sentAt?: string): Draft {
  return {
    id,
    threadId: 'thread_1',
    to: [{ name: 'David', email: 'david@example.com' }],
    subject: 'Re: Ketty',
    body: 'Thinking Tuesday or Wednesday could work',
    attachments: [],
    updatedAt,
    syncState: 'pending',
    ...(sentAt ? { sentAt } : {}),
  }
}

const MESSAGES = [
  message('m_sent', ME, '2026-08-13T10:39:00Z'),
  message('m_recv_1', 'david@example.com', '2026-07-29T09:18:00Z'),
  message('m_recv_2', 'david@example.com', '2026-07-22T14:06:00Z'),
]
const DRAFTS = [draft('d_open', '2026-08-13T19:56:00Z')]

describe('buildThreadHistoryEntries', () => {
  it('merges messages and drafts newest first with direction from the account', () => {
    const entries = buildThreadHistoryEntries(MESSAGES, DRAFTS, ME, 'User')
    expect(entries.map(entry => entry.id)).toEqual([
      'd_open',
      'm_sent',
      'm_recv_1',
      'm_recv_2',
    ])
    expect(entries.map(entry => entry.state)).toEqual([
      'draft',
      'sent',
      'received',
      'received',
    ])
    expect(entries[0].sender).toBe('User')
  })

  it('keeps a provider draft a draft even though it is from me', () => {
    // The bug this pins: a reply drafted in Gmail (or by another client)
    // arrives as a message from my own address, and reading direction alone
    // made the timeline announce it as mail I had already sent.
    const entries = buildThreadHistoryEntries(
      [{ ...message('m_draft', ME, '2026-08-18T09:48:00Z'), isDraft: true }],
      [],
      ME,
    )
    expect(entries[0].state).toBe('draft')
    expect(entries[0].kind).toBe('draft')
  })

  it('treats a sent draft as sent mail, not a draft', () => {
    const entries = buildThreadHistoryEntries(
      [],
      [draft('d_sent', '2026-08-01T09:00:00Z', '2026-08-02T09:00:00Z')],
      ME,
    )
    expect(entries[0].state).toBe('sent')
    expect(entries[0].at).toBe('2026-08-02T09:00:00Z')
  })
})

describe('counts and filters', () => {
  const entries = buildThreadHistoryEntries(MESSAGES, DRAFTS, ME)

  it('counts add up to the total', () => {
    const counts = threadHistoryCounts(entries)
    expect(counts).toEqual({ all: 4, sent: 1, received: 2, drafts: 1 })
  })

  it('filters by state', () => {
    expect(filterThreadHistory(entries, 'received')).toHaveLength(2)
    expect(filterThreadHistory(entries, 'drafts')[0].id).toBe('d_open')
    expect(filterThreadHistory(entries, 'all')).toHaveLength(4)
  })
})

describe('visibleThreadHistory', () => {
  const entries = buildThreadHistoryEntries(MESSAGES, DRAFTS, ME)

  it('slices to the limit', () => {
    expect(visibleThreadHistory(entries, null, 2)).toHaveLength(2)
  })

  it('pins the current entry when the slice would drop it', () => {
    const rows = visibleThreadHistory(entries, 'm_recv_2', 2)
    expect(rows[0].id).toBe('m_recv_2')
    expect(rows).toHaveLength(3)
  })

  it('does not duplicate a current entry already in view', () => {
    const rows = visibleThreadHistory(entries, 'd_open', 2)
    expect(rows.filter(row => row.id === 'd_open')).toHaveLength(1)
    expect(rows).toHaveLength(2)
  })
})

describe('grouping and span', () => {
  const entries = buildThreadHistoryEntries(MESSAGES, DRAFTS, ME)
  const now = new Date('2026-08-15T12:00:00Z')

  it('groups consecutive months, naming the year only when it differs', () => {
    const groups = groupThreadHistoryByMonth(entries, { now })
    expect(groups.map(group => group.label)).toEqual(['AUGUST', 'JULY'])
    expect(groups[0].entries).toHaveLength(2)

    const older = groupThreadHistoryByMonth(
      buildThreadHistoryEntries(
        [message('m_old', ME, '2025-07-01T08:00:00Z')],
        [],
        ME,
      ),
      { now },
    )
    expect(older[0].label).toBe('JULY 2025')
  })

  it('spells the year out always in thread view mode', () => {
    const groups = groupThreadHistoryByMonth(entries, { now, alwaysYear: true })
    expect(groups[0].label).toBe('AUGUST 2026')
  })

  it('reports the oldest-to-newest span', () => {
    expect(threadHistorySpan(entries)).toBe('Jul 2026 – Aug 2026')
  })
})

describe('isInviteNoticeBody', () => {
  it('recognises the generated acceptance sentence', () => {
    expect(
      isInviteNoticeBody(
        'alex@business.example has accepted the invitation to "Hold the Date".',
      ),
    ).toBe(true)
    expect(isInviteNoticeBody('  ')).toBe(true)
  })

  it('leaves real prose alone', () => {
    expect(
      isInviteNoticeBody('Can call early next week if it works? Lemme know'),
    ).toBe(false)
  })
})

describe('opening a thread never changes the list it came from', () => {
  const entries = [
    { threads: [{ id: 'gmail_thread_x' }] },
    { threads: [{ id: 'gmail_thread_y' }, { id: 'gmail_thread_y2' }] },
  ]

  it('leaves the query alone for a thread already in view', () => {
    // Drafts lists a conversation for the draft it holds while the
    // conversation still lives in the inbox. Re-pointing at the thread's own
    // mailbox rewrote `in:Drafts` to `in:Inbox`, so clicking a draft threw
    // the user back to the inbox.
    expect(openingThreadShouldRepointMailbox(entries, 'gmail_thread_x')).toBe(
      false,
    )
  })

  it('follows a conversation member, not just the representative row', () => {
    expect(openingThreadShouldRepointMailbox(entries, 'gmail_thread_y2')).toBe(
      false,
    )
  })

  it('moves the view for a thread reached from outside the list', () => {
    // An agent's openThread, a task's source email, a notification: without
    // this the thread would be unreachable.
    expect(openingThreadShouldRepointMailbox(entries, 'gmail_thread_z')).toBe(
      true,
    )
    expect(openingThreadShouldRepointMailbox([], 'gmail_thread_x')).toBe(true)
  })
})
