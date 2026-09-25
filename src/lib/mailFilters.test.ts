import { describe, expect, it } from 'vitest'
import { demoMailStore } from './mailStoreData'

const NOW = new Date('2026-06-21T12:00:00.000Z')
import {
  addMailFilter,
  clearFilterRunMarkers,
  composeFilterQuery,
  ensureMailLabel,
  fileThreadToBox,
  runMailFilters,
  setMailFilterEnabled,
} from './mailFilters'
import type { MailStore } from '../types'

function baseStore(): MailStore {
  const store = demoMailStore()
  return {
    ...store,
    settings: { ...store.settings, fetchWindow: '30d' as const },
  }
}

function accountId(store: MailStore): string {
  return store.accounts[0]!.id
}

function inboxThread(store: MailStore) {
  const thread = store.threads.find(t => t.status === 'inbox')
  expect(thread).toBeDefined()
  return thread!
}

describe('mailFilters', () => {
  it('files a matched thread: label + archive with the remote mutation', () => {
    let store = baseStore()
    const target = inboxThread(store)
    const sender = target.participants[0]!.email
    store = addMailFilter(store, {
      name: 'File sender',
      query: `from:${sender}`,
      actions: { labelName: 'Receipts', skipInbox: true },
    }).store

    const result = runMailFilters(store, accountId(store), {
      threadIds: [target.id],
      now: NOW,
    })
    const filed = result.store.threads.find(t => t.id === target.id)!
    expect(filed.labels).toContain('Receipts')
    expect(filed.status).toBe('archived')
    // A box is a home: the thread lives in the box's custom mailbox, so it
    // is neither in the inbox nor in Archive.
    const box = result.store.mailboxes.find(
      m => m.role === 'custom' && m.name === 'Receipts',
    )
    expect(box).toBeDefined()
    expect(filed.mailboxId).toBe(box!.id)
    expect(filed.filteredBy).toEqual(['File sender'])
    expect(filed.filterRunAt).toBeTruthy()
    expect(result.mutations).toContainEqual({
      kind: 'archive',
      threadId: target.id,
    })
    // The label was created locally on first use.
    expect(
      result.store.labels.some(label => label.name === 'Receipts'),
    ).toBe(true)
    // Hit accounting.
    expect(result.store.filters?.[0]?.hitCount).toBe(1)
    expect(result.totalHits).toBe(1)
  })

  it('never runs twice on the same thread unless explicitly retroactive', () => {
    let store = baseStore()
    const target = inboxThread(store)
    store = addMailFilter(store, {
      name: 'Mark read',
      query: `from:${target.participants[0]!.email}`,
      actions: { markRead: true },
    }).store

    const first = runMailFilters(store, accountId(store), {
      threadIds: [target.id],
      now: NOW,
    })
    const second = runMailFilters(first.store, accountId(first.store), {
      threadIds: [target.id],
      now: NOW,
    })
    expect(second.totalHits).toBe(0)
    expect(second.mutations).toEqual([])

    const retro = runMailFilters(first.store, accountId(first.store), {
      threadIds: [target.id],
      includeAlreadyRun: true,
      now: NOW,
    })
    expect(retro.totalHits).toBe(1)
  })

  it('stamps non-matching candidates too, and skips disabled rules', () => {
    let store = baseStore()
    const target = inboxThread(store)
    const added = addMailFilter(store, {
      name: 'Never matches',
      query: 'from:nobody@nowhere.invalid',
      actions: { markRead: true },
    })
    store = setMailFilterEnabled(added.store, added.rule.id, false)

    const result = runMailFilters(store, accountId(store), {
      threadIds: [target.id],
      now: NOW,
    })
    const stamped = result.store.threads.find(t => t.id === target.id)!
    expect(stamped.filterRunAt).toBeTruthy()
    expect(stamped.filteredBy).toBeUndefined()
    expect(result.totalHits).toBe(0)
  })

  it('rule order cannot hide threads from later rules', () => {
    let store = baseStore()
    const target = inboxThread(store)
    const sender = target.participants[0]!.email
    store = addMailFilter(store, {
      name: 'Archive first',
      query: `from:${sender}`,
      actions: { skipInbox: true },
    }).store
    store = addMailFilter(store, {
      name: 'Label second',
      query: `from:${sender}`,
      actions: { labelName: 'AlsoThis' },
    }).store

    const result = runMailFilters(store, accountId(store), {
      threadIds: [target.id],
      now: NOW,
    })
    const thread = result.store.threads.find(t => t.id === target.id)!
    // Rule 1 archived it; rule 2 still labelled it.
    expect(thread.status).toBe('archived')
    expect(thread.labels).toContain('AlsoThis')
    expect(thread.filteredBy).toEqual(['Archive first', 'Label second'])
  })

  it('ensureMailLabel reuses existing labels case-insensitively', () => {
    const store = baseStore()
    const first = ensureMailLabel(store, 'Reading')
    const second = ensureMailLabel(first.store, 'reading')
    expect(second.label.id).toBe(first.label.id)
    expect(second.store.labels.length).toBe(first.store.labels.length)
  })
})

describe('suggestMailFilters', () => {
  it('suggests a rule for a repeatedly archived sender, unless covered', async () => {
    const { suggestMailFilters } = await import('./mailFilters')
    let store = baseStore()
    const account = accountId(store)
    const sender = { name: 'Newsletter Bot', email: 'news@example.com' }
    const template = store.threads[0]!
    const archived = Array.from({ length: 3 }, (_, index) => ({
      ...template,
      id: `sugg-${index}`,
      participants: [sender],
      status: 'archived' as const,
    }))
    store = { ...store, threads: [...store.threads, ...archived] }

    const suggestions = suggestMailFilters(store, account)
    expect(suggestions[0]).toMatchObject({
      senderEmail: 'news@example.com',
      archivedCount: 3,
      suggestedQuery: 'from:news@example.com',
    })

    // An enabled filter covering the sender silences the suggestion.
    const covered = addMailFilter(store, {
      name: 'News',
      query: 'from:news@example.com',
      actions: { skipInbox: true },
    }).store
    expect(
      suggestMailFilters(covered, account).some(
        item => item.senderEmail === 'news@example.com',
      ),
    ).toBe(false)
  })
})

describe('unseen arrivals', () => {
  it('badges only what arrived after the user last looked', async () => {
    const { markQuerySeen, unseenArrivalCount } = await import('./mailQuery')
    let store = baseStore()
    const account = accountId(store)
    const target = inboxThread(store)
    const query = `from:${target.participants[0]!.email}`

    // Never visited: the badge falls back to unread, because a view is only
    // stamped as seen when you navigate to it — so on a real account nothing
    // is stamped and an arrivals-only badge never once appears. Read
    // everything and it goes quiet again.
    const allRead = {
      ...store,
      messages: store.messages.map(message => ({ ...message, read: true })),
    }
    expect(unseenArrivalCount(allRead, account, query, NOW)).toBe(0)

    // Visited, then a new arrival lands after the visit.
    store = markQuerySeen(store, query, NOW)
    const later = new Date(NOW.getTime() + 60_000).toISOString()
    store = {
      ...store,
      threads: store.threads.map(thread =>
        thread.id === target.id
          ? { ...thread, lastMessageAt: later }
          : thread,
      ),
    }
    const afterArrival = new Date(NOW.getTime() + 120_000)
    expect(unseenArrivalCount(store, account, query, afterArrival)).toBe(1)

    // Looking again clears it.
    store = markQuerySeen(store, query, afterArrival)
    expect(unseenArrivalCount(store, account, query, afterArrival)).toBe(0)
  })

  it('relocates legacy archive-filed threads into their box on the next run', () => {
    let store = baseStore()
    const target = inboxThread(store)
    const archiveMailbox = store.mailboxes.find(m => m.role === 'archive')!
    store = addMailFilter(store, {
      name: 'github',
      query: 'from:no-such-sender@nowhere.example',
      actions: { labelName: 'github', skipInbox: true },
    }).store
    // Simulate the pre-box build: archived + labelled + audit marker.
    store = {
      ...store,
      threads: store.threads.map(t =>
        t.id === target.id
          ? {
              ...t,
              status: 'archived' as const,
              mailboxId: archiveMailbox.id,
              labels: [...t.labels, 'github'],
              filteredBy: ['github'],
              filterRunAt: '2026-06-20T00:00:00.000Z',
            }
          : t,
      ),
    }
    const result = runMailFilters(store, accountId(store), { now: NOW })
    const box = result.store.mailboxes.find(
      m => m.role === 'custom' && m.name === 'github',
    )
    expect(box).toBeDefined()
    const moved = result.store.threads.find(t => t.id === target.id)!
    expect(moved.mailboxId).toBe(box!.id)
    // Local relocation only — nothing new goes to the provider.
    expect(result.mutations).toEqual([])
  })

  it('re-files a thread when a new message arrives after the last run', () => {
    let store = baseStore()
    const target = inboxThread(store)
    const sender = target.participants[0]!.email
    store = addMailFilter(store, {
      name: 'github',
      query: `from:${sender}`,
      actions: { labelName: 'github', skipInbox: true },
    }).store
    const first = runMailFilters(store, accountId(store), {
      threadIds: [target.id],
      now: NOW,
    })
    const filedBox = first.store.mailboxes.find(
      m => m.role === 'custom' && m.name === 'github',
    )!
    expect(
      first.store.threads.find(t => t.id === target.id)!.mailboxId,
    ).toBe(filedBox.id)

    // Gmail returns the thread to the inbox when a reply arrives.
    const inboxMailbox = store.mailboxes.find(m => m.role === 'inbox')!
    const replied = {
      ...first.store,
      threads: first.store.threads.map(t =>
        t.id === target.id
          ? {
              ...t,
              status: 'inbox' as const,
              mailboxId: inboxMailbox.id,
              lastMessageAt: '2026-06-21T13:00:00.000Z',
            }
          : t,
      ),
    }
    // Unchanged threads stay run-once; the replied thread re-files.
    const second = runMailFilters(replied, accountId(replied), {
      now: new Date('2026-06-21T14:00:00.000Z'),
    })
    const refiled = second.store.threads.find(t => t.id === target.id)!
    expect(refiled.mailboxId).toBe(filedBox.id)
    expect(refiled.status).toBe('archived')
    expect(second.mutations).toContainEqual({
      kind: 'archive',
      threadId: target.id,
    })
  })

  it('fileThreadToBox files one thread manually with filter semantics', () => {
    const store = baseStore()
    const target = inboxThread(store)
    const filed = fileThreadToBox(
      store,
      accountId(store),
      target.id,
      'Receipts',
    )
    const box = filed.store.mailboxes.find(
      m => m.role === 'custom' && m.name === 'Receipts',
    )
    expect(box).toBeDefined()
    const thread = filed.store.threads.find(t => t.id === target.id)!
    expect(thread.mailboxId).toBe(box!.id)
    expect(thread.status).toBe('archived')
    expect(thread.labels).toContain('Receipts')
    expect(filed.mutations).toEqual([
      { kind: 'archive', threadId: target.id },
    ])
    // No rule was created.
    expect(filed.store.filters ?? []).toEqual(store.filters ?? [])
  })

  it('plain skip-inbox without a box name still archives to Archive', () => {
    let store = baseStore()
    const target = inboxThread(store)
    const sender = target.participants[0]!.email
    store = addMailFilter(store, {
      name: 'Mute sender',
      query: `from:${sender}`,
      actions: { skipInbox: true },
    }).store
    const result = runMailFilters(store, accountId(store), {
      threadIds: [target.id],
      now: NOW,
    })
    const filed = result.store.threads.find(t => t.id === target.id)!
    const archiveMailbox = result.store.mailboxes.find(
      m => m.role === 'archive',
    )!
    expect(filed.status).toBe('archived')
    expect(filed.mailboxId).toBe(archiveMailbox.id)
  })
})

describe('real account folders (IMAP) in the filter engine', () => {
  function storeWithRealFolder(): MailStore {
    const store = baseStore()
    return {
      ...store,
      mailboxes: [
        ...store.mailboxes,
        {
          id: 'imap_mbx_git',
          accountId: accountId(store),
          name: 'git',
          role: 'custom' as const,
          unreadCount: 0,
        },
      ],
    }
  }

  it('a box rule naming a real folder MOVES on the server, no archive', () => {
    const store = storeWithRealFolder()
    const thread = inboxThread(store)
    const sender = store.messages.find(m => m.threadId === thread.id)!.from
      .email
    const added = addMailFilter(store, {
      name: 'git mail',
      query: `from:${sender}`,
      actions: { labelName: 'git', skipInbox: true },
    })
    const run = runMailFilters(added.store, accountId(store), { now: NOW })
    const moved = run.store.threads.find(t => t.id === thread.id)!
    expect(moved.mailboxId).toBe('imap_mbx_git')
    expect(
      run.mutations.filter(m => m.threadId === thread.id),
    ).toEqual([{ kind: 'move', threadId: thread.id, mailboxId: 'imap_mbx_git' }])
  })

  it('fileThreadToBox with a real folder name emits a move mutation', () => {
    const store = storeWithRealFolder()
    const thread = inboxThread(store)
    const filed = fileThreadToBox(store, accountId(store), thread.id, 'Git')
    expect(filed.mutations).toEqual([
      { kind: 'move', threadId: thread.id, mailboxId: 'imap_mbx_git' },
    ])
    // No look-alike local label was invented for the real folder.
    expect(
      filed.store.labels.some(label => label.name.toLowerCase() === 'git'),
    ).toBe(false)
  })

  it('a box rule with no matching real folder keeps archive semantics', () => {
    const store = baseStore()
    const thread = inboxThread(store)
    const sender = store.messages.find(m => m.threadId === thread.id)!.from
      .email
    const added = addMailFilter(store, {
      name: 'receipts',
      query: `from:${sender}`,
      actions: { labelName: 'Receipts', skipInbox: true },
    })
    const run = runMailFilters(added.store, accountId(store), { now: NOW })
    expect(
      run.mutations.filter(m => m.threadId === thread.id),
    ).toEqual([{ kind: 'archive', threadId: thread.id }])
  })
})

describe('composeFilterQuery', () => {
  it('composes sender, domain, subject, and attachment conditions', () => {
    expect(
      composeFilterQuery({ senderEmail: 'a@news.example', scope: 'sender' }),
    ).toBe('from:a@news.example')
    expect(
      composeFilterQuery({ senderEmail: 'a@news.example', scope: 'domain' }),
    ).toBe('from:nytimes.com')
    expect(
      composeFilterQuery({
        senderEmail: 'a@news.example',
        scope: 'domain',
        subjectContains: 'daily briefing',
        hasAttachment: true,
      }),
    ).toBe('from:nytimes.com subject:"daily briefing" has:attachment')
  })
})

describe('clearFilterRunMarkers', () => {
  it('voids markers only on the named threads', () => {
    const store = baseStore()
    const [a, b] = store.threads
    const stamped: MailStore = {
      ...store,
      threads: store.threads.map(t =>
        t.id === a!.id || t.id === b!.id
          ? { ...t, filterRunAt: '2026-06-21T10:00:00.000Z' }
          : t,
      ),
    }
    const cleared = clearFilterRunMarkers(stamped, [a!.id])
    expect(
      cleared.threads.find(t => t.id === a!.id)?.filterRunAt,
    ).toBeUndefined()
    expect(cleared.threads.find(t => t.id === b!.id)?.filterRunAt).toBe(
      '2026-06-21T10:00:00.000Z',
    )
    expect(clearFilterRunMarkers(stamped, [])).toBe(stamped)
  })
})
