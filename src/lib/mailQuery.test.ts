import { describe, expect, it } from 'vitest'
import {
  buildMailQuery,
  countThreadQuery,
  deleteMailView,
  parseMailQuery,
  resolveThreadQuery,
  saveMailView,
  unseenArrivalCount,
  withQueryTerm,
} from './mailQuery'
import { demoMailStore, demoMailStoreForNow } from './mailModel'
import type { MailMessage, MailStore, MailThread } from '../types'

const NOW = '2026-06-21T12:00:00.000Z'

function accountId(store: MailStore): string {
  return store.accounts[0].id
}

/** Demo store with a wide fetch window so nothing is clipped by the horizon. */
function baseStore(): MailStore {
  const store = demoMailStore()
  return {
    ...store,
    settings: { ...store.settings, fetchWindow: '30d' as const },
  }
}

describe('mail query parsing', () => {
  it('parses operators, negation, sort and limit, leaving the rest as text', () => {
    const query = parseMailQuery(
      'in:inbox -from:bot@example.com subject:"launch copy" sort:oldest limit:25 rollout',
    )

    expect(query.sort).toBe('oldest')
    expect(query.limit).toBe(25)
    expect(query.text).toBe('rollout')
    expect(query.terms).toEqual([
      { field: 'in', value: 'inbox', negated: false },
      { field: 'from', value: 'bot@example.com', negated: true },
      { field: 'subject', value: 'launch copy', negated: false },
    ])
  })

  it('keeps unknown operators and invalid values as free text', () => {
    const query = parseMailQuery('filename:report.pdf is:banana sort:sideways')

    expect(query.terms).toHaveLength(0)
    expect(query.sort).toBe('newest')
    expect(query.text).toContain('filename:report.pdf')
    expect(query.text).toContain('is:banana')
    expect(query.text).toContain('sort:sideways')
  })

  it('round-trips through build and parse', () => {
    const input =
      'in:archive -label:"Receipts" has:attachment is:unread older_than:30d sort:oldest limit:10 invoice'
    const once = buildMailQuery(parseMailQuery(input))
    const twice = buildMailQuery(parseMailQuery(once))

    expect(twice).toBe(once)
    expect(parseMailQuery(once).terms).toEqual(parseMailQuery(input).terms)
  })

  it('replaces and removes single-valued terms', () => {
    expect(withQueryTerm('in:inbox is:unread', 'in', 'archive')).toBe(
      'in:archive is:unread',
    )
    expect(withQueryTerm('is:unread', 'label', 'Receipts')).toBe(
      'is:unread label:Receipts',
    )
  })
})

describe('resolveThreadQuery', () => {
  it('scopes to the account and excludes trash unless a mailbox is named', () => {
    const store = baseStore()
    const trashMailbox = store.mailboxes.find(
      mailbox => mailbox.role === 'trash',
    )!
    const trashed: MailThread = {
      ...store.threads[0],
      id: 'thread_trashed',
      subject: 'Deleted thing',
      mailboxId: trashMailbox.id,
    }
    const withTrash = { ...store, threads: [trashed, ...store.threads] }

    const defaultScope = resolveThreadQuery(
      withTrash,
      accountId(store),
      '',
      NOW,
    )
    expect(defaultScope.threads.map(t => t.id)).not.toContain('thread_trashed')

    const explicit = resolveThreadQuery(
      withTrash,
      accountId(store),
      'in:trash',
      NOW,
    )
    expect(explicit.threads.map(t => t.id)).toContain('thread_trashed')
  })

  it('returns nothing without an account', () => {
    const store = baseStore()
    expect(resolveThreadQuery(store, undefined, '', NOW).total).toBe(0)
  })

  it('matches every thread holding an unsent draft, failed ones included', () => {
    const store = baseStore()
    const [first, second, third] = store.threads
    const draft = (
      id: string,
      threadId: string,
      qaStatus: 'ready' | 'failed',
      sentAt?: string,
    ) => ({
      id,
      threadId,
      to: [],
      subject: 'Re: something',
      body: qaStatus === 'ready' ? 'ready body' : '',
      attachments: [],
      updatedAt: NOW,
      syncState: 'pending' as const,
      source: 'auto' as const,
      draftKind: 'auto_reply' as const,
      qaStatus,
      ...(sentAt ? { sentAt } : {}),
    })
    const withDrafts: MailStore = {
      ...store,
      // A failed draft is still a draft. Hiding it is how a draft an agent
      // reported writing became findable nowhere at all.
      drafts: [
        draft('d1', first.id, 'ready'),
        draft('d2', second.id, 'failed'),
        draft('d3', third.id, 'ready', NOW),
      ],
    }

    const resolved = resolveThreadQuery(
      withDrafts,
      accountId(store),
      'is:draft',
      NOW,
    )
    const ids = resolved.threads.map(thread => thread.id)
    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
    // Sent: no longer a draft anywhere.
    expect(ids).not.toContain(third.id)
  })

  it('resolves in:Drafts to the same threads as is:draft', () => {
    const store = baseStore()
    const [first] = store.threads
    const withDrafts: MailStore = {
      ...store,
      drafts: [
        {
          id: 'draft_reply_1',
          threadId: first.id,
          to: [],
          subject: 'Re: something',
          body: 'a reply in progress',
          attachments: [],
          updatedAt: NOW,
          syncState: 'pending',
          source: 'manual',
          draftKind: 'manual',
        },
      ],
    }
    const byFolder = resolveThreadQuery(
      withDrafts,
      accountId(store),
      'in:Drafts',
      NOW,
    )
    const byFlag = resolveThreadQuery(
      withDrafts,
      accountId(store),
      'is:draft',
      NOW,
    )
    expect(byFolder.threads.map(thread => thread.id)).toEqual([first.id])
    expect(byFolder.threads.map(thread => thread.id)).toEqual(
      byFlag.threads.map(thread => thread.id),
    )
    // The conversation is still in the inbox — a draft does not move it.
    expect(byFolder.threads[0].mailboxId).toBe(
      store.mailboxes.find(mailbox => mailbox.role === 'inbox')!.id,
    )
  })

  it('filters by mailbox, negation, and free text together', () => {
    const store = baseStore()
    const inbox = store.mailboxes.find(mailbox => mailbox.role === 'inbox')!
    const all = resolveThreadQuery(store, accountId(store), 'in:inbox', NOW)
    expect(all.threads.length).toBeGreaterThan(0)
    expect(all.threads.every(t => t.mailboxId === inbox.id)).toBe(true)

    const sender = all.threads[0].participants[0]?.email
    if (sender) {
      const without = resolveThreadQuery(
        store,
        accountId(store),
        `in:inbox -from:${sender}`,
        NOW,
      )
      expect(without.total).toBeLessThan(all.total)
    }
  })

  it('matches free text against participant names, not just addresses', () => {
    const store = baseStore()
    const all = resolveThreadQuery(store, accountId(store), 'in:inbox', NOW)
    const named = all.threads.find(t => (t.participants[0]?.name ?? '').length > 3)
    expect(named).toBeDefined()
    const nameWord = named!.participants[0]!.name.split(/\s+/)[0]!.toLowerCase()
    const byName = resolveThreadQuery(store, accountId(store), nameWord, NOW)
    expect(byName.threads.some(t => t.id === named!.id)).toBe(true)
  })

  it('honours is:unread and its negation as complements', () => {
    const store = baseStore()
    const all = resolveThreadQuery(store, accountId(store), 'in:inbox', NOW)
    const unread = resolveThreadQuery(
      store,
      accountId(store),
      'in:inbox is:unread',
      NOW,
    )
    const notUnread = resolveThreadQuery(
      store,
      accountId(store),
      'in:inbox -is:unread',
      NOW,
    )

    expect(unread.total + notUnread.total).toBe(all.total)
  })

  it('applies relative date windows', () => {
    const store = baseStore()
    const recent: MailThread = {
      ...store.threads[0],
      id: 'thread_recent',
      lastMessageAt: '2026-06-21T09:00:00.000Z',
    }
    const old: MailThread = {
      ...store.threads[0],
      id: 'thread_old',
      lastMessageAt: '2026-06-01T09:00:00.000Z',
    }
    const withBoth = {
      ...store,
      threads: [recent, old, ...store.threads.slice(1)],
    }

    const newer = resolveThreadQuery(
      withBoth,
      accountId(store),
      'newer_than:2d',
      NOW,
    )
    const older = resolveThreadQuery(
      withBoth,
      accountId(store),
      'older_than:2d',
      NOW,
    )

    expect(newer.threads.map(t => t.id)).toContain('thread_recent')
    expect(newer.threads.map(t => t.id)).not.toContain('thread_old')
    expect(older.threads.map(t => t.id)).toContain('thread_old')
    expect(older.threads.map(t => t.id)).not.toContain('thread_recent')
  })

  it('sorts newest first by default and reverses for sort:oldest', () => {
    const store = baseStore()
    const newest = resolveThreadQuery(store, accountId(store), '', NOW)
    const oldest = resolveThreadQuery(
      store,
      accountId(store),
      'sort:oldest',
      NOW,
    )

    expect(newest.entries.length).toBeGreaterThan(1)
    expect(oldest.entries.map(e => e.thread.id)).toEqual(
      [...newest.entries].reverse().map(e => e.thread.id),
    )
  })

  it('caps results with limit but reports the full total', () => {
    const store = baseStore()
    const all = resolveThreadQuery(store, accountId(store), '', NOW)
    expect(all.total).toBeGreaterThan(1)

    const capped = resolveThreadQuery(store, accountId(store), 'limit:1', NOW)
    expect(capped.threads).toHaveLength(1)
    expect(capped.total).toBe(all.total)
  })

  it('groups threads sharing a gmail thread id into one conversation', () => {
    const store = baseStore()
    const base = store.threads[0]
    const a: MailThread = {
      ...base,
      id: 'thread_conv_a',
      gmailThreadId: 'gmail_conv',
      lastMessageAt: '2026-06-20T10:00:00.000Z',
    }
    const b: MailThread = {
      ...base,
      id: 'thread_conv_b',
      gmailThreadId: 'gmail_conv',
      lastMessageAt: '2026-06-20T11:00:00.000Z',
    }
    const message: MailMessage = {
      ...store.messages[0],
      id: 'msg_conv_b',
      threadId: 'thread_conv_b',
      receivedAt: '2026-06-20T11:00:00.000Z',
    }
    const withConv = {
      ...store,
      threads: [a, b],
      messages: [message],
    }

    const result = resolveThreadQuery(withConv, accountId(store), '', NOW)
    expect(result.total).toBe(1)
    expect(result.entries[0].threads).toHaveLength(2)
    expect(result.entries[0].thread.id).toBe('thread_conv_b')
  })

  it('counts what the rail renders, so badges and rows agree', () => {
    const store = baseStore()
    const result = resolveThreadQuery(store, accountId(store), 'in:inbox', NOW)

    expect(countThreadQuery(store, accountId(store), 'in:inbox', NOW)).toBe(
      result.entries.length,
    )
  })

  it('reports the canonical query it resolved', () => {
    const store = baseStore()
    const result = resolveThreadQuery(
      store,
      accountId(store),
      '  in:inbox    is:unread  ',
      NOW,
    )
    expect(result.query).toBe('in:inbox is:unread')
  })
})

describe('saved views', () => {
  it('saves, replaces by name, and deletes named queries', () => {
    const store = baseStore()

    const saved = saveMailView(store, ' Newsletter purge ', 'label:news  sort:oldest')
    expect(saved.savedViews).toHaveLength(1)
    expect(saved.savedViews?.[0]).toMatchObject({
      name: 'Newsletter purge',
      query: 'label:news sort:oldest',
    })

    // Same name saves over the existing view rather than duplicating it.
    const replaced = saveMailView(saved, 'newsletter PURGE', 'label:news is:read')
    expect(replaced.savedViews).toHaveLength(1)
    expect(replaced.savedViews?.[0].query).toBe('label:news is:read')

    const removed = deleteMailView(replaced, replaced.savedViews![0].id)
    expect(removed.savedViews).toHaveLength(0)
  })

  it('ignores a blank name', () => {
    const store = baseStore()
    expect(saveMailView(store, '   ', 'in:inbox').savedViews ?? []).toHaveLength(
      0,
    )
  })
})

describe('demo mailbox seeding', () => {
  it('shifts the frozen demo dates so a fresh boot lands inside the fetch window', () => {
    const now = new Date('2027-03-01T12:00:00.000Z')
    const seeded = demoMailStoreForNow(now)

    expect(seeded.threads.length).toBeGreaterThan(0)
    // Everything the resolver would clip must now be inside the horizon.
    const visible = resolveThreadQuery(
      seeded,
      seeded.accounts[0].id,
      '',
      now,
    )
    expect(visible.total).toBeGreaterThan(0)

    const newest = Math.max(
      ...seeded.threads.map(thread => Date.parse(thread.lastMessageAt)),
    )
    expect(newest).toBeLessThan(now.getTime())
    expect(now.getTime() - newest).toBeLessThan(2 * 60 * 60 * 1000)
  })

  it('leaves demoMailStore itself frozen so tests stay deterministic', () => {
    const a = demoMailStore()
    const b = demoMailStore()
    expect(a.threads.map(t => t.lastMessageAt)).toEqual(
      b.threads.map(t => t.lastMessageAt),
    )
    expect(a.threads[0].lastMessageAt).toMatch(/^2026-/)
  })
})

describe('fetch window', () => {
  it('clips to the fetch window when the query says nothing about time', () => {
    const store = demoMailStore()
    const old: MailThread = {
      ...store.threads[0],
      id: 'thread_ancient',
      lastMessageAt: '2026-04-01T09:00:00.000Z',
    }
    const withOld = {
      ...store,
      threads: [old, ...store.threads],
      settings: { ...store.settings, fetchWindow: '7d' as const },
    }

    const plain = resolveThreadQuery(withOld, store.accounts[0].id, '', NOW)
    expect(plain.threads.map(t => t.id)).not.toContain('thread_ancient')
  })

  it('lets a query reach past the window when it states its own time scope', () => {
    const store = demoMailStore()
    const old: MailThread = {
      ...store.threads[0],
      id: 'thread_ancient',
      lastMessageAt: '2026-04-01T09:00:00.000Z',
    }
    const withOld = {
      ...store,
      threads: [old, ...store.threads],
      settings: { ...store.settings, fetchWindow: '7d' as const },
    }

    // Previously this could never return anything: the 7-day display
    // horizon was applied before the operator was considered.
    const older = resolveThreadQuery(
      withOld,
      store.accounts[0].id,
      'older_than:30d',
      NOW,
    )
    expect(older.threads.map(t => t.id)).toContain('thread_ancient')

    const before = resolveThreadQuery(
      withOld,
      store.accounts[0].id,
      'before:2026-05-01',
      NOW,
    )
    expect(before.threads.map(t => t.id)).toContain('thread_ancient')
  })
})

describe('unseen arrivals per mailbox', () => {
  it('counts arrivals for the exact query strings the nav rows use', () => {
    const store = baseStore()
    const inbox = store.mailboxes.find(mailbox => mailbox.role === 'inbox')!
    const sent = store.mailboxes.find(mailbox => mailbox.role === 'sent')!
    // The nav builds `in:<mailbox name>`; the seen-stamp is keyed on the
    // canonical form of that same string. If the two ever drift, every badge
    // silently reads zero — which is how the system mailboxes looked before
    // they had one at all.
    const seen: MailStore = {
      ...store,
      querySeenAt: {
        [`in:${inbox.name}`]: '2020-01-01T00:00:00.000Z',
        [`in:${sent.name}`]: '2020-01-01T00:00:00.000Z',
        'is:starred': '2020-01-01T00:00:00.000Z',
      },
    }
    const id = accountId(store)
    expect(
      unseenArrivalCount(seen, id, `in:${inbox.name}`, NOW),
    ).toBeGreaterThan(0)
    // A stamp after everything present means nothing new.
    expect(
      unseenArrivalCount(
        { ...store, querySeenAt: { [`in:${inbox.name}`]: NOW } },
        id,
        `in:${inbox.name}`,
        NOW,
      ),
    ).toBe(0)
  })

  it('falls back to unread for a view the user has never opened', () => {
    const store = baseStore()
    const inbox = store.mailboxes.find(mailbox => mailbox.role === 'inbox')!
    const id = accountId(store)
    const query = `in:${inbox.name}`
    // Nothing is stamped on a fresh account, so an arrival-only count is zero
    // for every folder — a badge that never once appears. This is the case
    // the user actually sees first.
    expect(store.querySeenAt).toBeUndefined()

    const allRead: MailStore = {
      ...store,
      messages: store.messages.map(message => ({ ...message, read: true })),
    }
    expect(unseenArrivalCount(allRead, id, query, NOW)).toBe(0)

    const someUnread: MailStore = {
      ...store,
      messages: store.messages.map((message, index) =>
        index === 0 ? { ...message, read: false } : { ...message, read: true },
      ),
    }
    expect(unseenArrivalCount(someUnread, id, query, NOW)).toBe(1)

    // Once the view has been opened, arrivals take over: the user has seen
    // what is there, unread or not.
    expect(
      unseenArrivalCount(
        { ...someUnread, querySeenAt: { [query]: NOW } },
        id,
        query,
        NOW,
      ),
    ).toBe(0)
  })
})
