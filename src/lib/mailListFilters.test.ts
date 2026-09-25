import { describe, expect, it } from 'vitest'
import {
  MAIL_LIST_FILTERS,
  filterThreadsByListFilter,
  unreadThreadIds,
} from './mailListFilters'
import type { MailStore, MailThread } from '../types'

const thread = (over: Partial<MailThread>): MailThread =>
  ({
    id: 't1',
    accountId: 'a1',
    mailboxId: 'm1',
    subject: 'S',
    participants: [],
    labels: [],
    status: 'inbox',
    priority: 'none',
    summary: '',
    lastMessageAt: '2026-08-15T00:00:00Z',
    syncState: 'synced',
    ...over,
  }) as MailThread

const me = { name: 'Me', email: 'me@example.com' }
const them = { name: 'Them', email: 'them@example.com' }
const LONG_AGO = '2026-08-15T00:00:00Z'
const JUST_NOW = new Date().toISOString()

const store = {
  accounts: [{ id: 'a1', email: 'me@example.com' }],
  threads: [
    thread({ id: 'a' }),
    thread({ id: 'b', priority: 'high' }),
    // Follow-ups are derived, not labelled: the last word was mine, to them,
    // and they have not come back. c is overdue; e was sent just now.
    thread({ id: 'c', status: 'waiting', lastMessageAt: LONG_AGO }),
    thread({ id: 'e', status: 'waiting', lastMessageAt: JUST_NOW }),
    thread({ id: 'd', accountId: 'other' }),
  ],
  messages: [
    { id: 'm-a', threadId: 'a', read: false, from: them, to: [me], receivedAt: LONG_AGO },
    { id: 'm-b', threadId: 'b', read: true, from: them, to: [me], receivedAt: LONG_AGO },
    { id: 'm-c', threadId: 'c', read: true, from: me, to: [them], receivedAt: LONG_AGO },
    { id: 'm-e', threadId: 'e', read: true, from: me, to: [them], receivedAt: JUST_NOW },
  ],
} as unknown as MailStore

describe('unreadThreadIds', () => {
  it('marks a thread unread when any message is unread', () => {
    expect([...unreadThreadIds(store)]).toEqual(['a'])
  })
})

describe('MAIL_LIST_FILTERS counts', () => {
  it('gives All no count, because it is a state not a tally', () => {
    expect(MAIL_LIST_FILTERS[0].count(store, 'a1')).toBe(0)
  })

  it('counts unread, priority and follow-ups within the account', () => {
    const by = (id: string) => MAIL_LIST_FILTERS.find(f => f.id === id)!
    expect(by('unread').count(store, 'a1')).toBe(1)
    expect(by('priority').count(store, 'a1')).toBe(1)
    expect(by('followups').count(store, 'a1')).toBe(1)
  })

  it('excludes other accounts from every count', () => {
    // The thread on "other" must never appear in this account's chips.
    const by = (id: string) => MAIL_LIST_FILTERS.find(f => f.id === id)!
    expect(by('priority').count(store, 'other')).toBe(0)
  })
})

describe('filterThreadsByListFilter', () => {
  const unread = unreadThreadIds(store)

  it('returns everything for All', () => {
    expect(filterThreadsByListFilter(store.threads, 'all', unread, store)).toHaveLength(5)
  })

  it('narrows to each view, and the count matches what the list shows', () => {
    for (const id of ['unread', 'priority'] as const) {
      const shown = filterThreadsByListFilter(
        store.threads.filter(t => t.accountId === 'a1'),
        id,
        unread,
        store,
      )
      const filter = MAIL_LIST_FILTERS.find(f => f.id === id)!
      expect(shown).toHaveLength(filter.count(store, 'a1'))
    }
  })

  it('Follow-ups lists everything still awaiting a reply, longest wait first, and badges only the overdue', () => {
    const shown = filterThreadsByListFilter(
      store.threads.filter(t => t.accountId === 'a1'),
      'followups',
      unread,
      store,
    )
    expect(shown.map(t => t.id)).toEqual(['c', 'e'])
    expect(MAIL_LIST_FILTERS.find(f => f.id === 'followups')!.count(store, 'a1')).toBe(1)
  })
})
