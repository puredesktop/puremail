import { describe, expect, it } from 'vitest'
import {
  completeQaDraftRequest,
  createComposedMessageDraft,
  emptyMailStore,
  enqueueQaDraftRequest,
  isGeneratedDraft,
  isReadyQaDraft,
  persistableMailStore,
  pruneOrphanedDraftThreads,
  sendDraft,
} from './mailModel'
import { resolveThreadQuery } from './mailQuery'
import type { MailMessage, MailStore, MailThread } from '../types'

/**
 * The audit's reproductions, inverted.
 *
 * Each of these failed on the state PureMail was in before this work: they
 * asserted the bug, and passed. They now assert the behaviour that replaced
 * it, so the specific way each one went wrong cannot come back quietly.
 */

const ACCOUNT = {
  id: 'acc',
  provider: 'gmail' as const,
  name: 'User',
  email: 'alex@example.com',
  syncState: 'online' as const,
}

const MAILBOXES = [
  {
    id: 'mb_inbox',
    accountId: 'acc',
    name: 'Inbox',
    role: 'inbox' as const,
    unreadCount: 0,
  },
  {
    id: 'mb_sent',
    accountId: 'acc',
    name: 'Sent',
    role: 'sent' as const,
    unreadCount: 0,
  },
  {
    id: 'mb_drafts',
    accountId: 'acc',
    name: 'Drafts',
    role: 'drafts' as const,
    unreadCount: 0,
  },
]

const CONVERSATION: MailThread = {
  id: 'gmail_thread_x',
  accountId: 'acc',
  mailboxId: 'mb_inbox',
  subject: 'Launch copy',
  participants: [{ name: 'Mira', email: 'mira@example.com' }],
  labels: [],
  status: 'inbox',
  priority: 'none',
  summary: 'Can you approve the copy?',
  lastMessageAt: '2026-08-18T10:00:00.000Z',
  syncState: 'synced',
}

const INBOUND: MailMessage = {
  id: 'gmail_msg_1',
  threadId: 'gmail_thread_x',
  from: { name: 'Mira', email: 'mira@example.com' },
  to: [{ name: 'User', email: 'alex@example.com' }],
  subject: 'Launch copy',
  body: 'Can you approve the copy?',
  receivedAt: '2026-08-18T10:00:00.000Z',
  attachments: [],
  read: true,
}

function conversationStore(): MailStore {
  return {
    ...emptyMailStore(),
    accounts: [ACCOUNT],
    mailboxes: MAILBOXES,
    threads: [CONVERSATION],
    messages: [INBOUND],
  }
}

/** Draft a reply on the conversation and return the store plus the draft id. */
function draftReply(
  store: MailStore,
  body: string,
  requestId: string,
  at: string,
): { store: MailStore; draftId: string } {
  const queued = enqueueQaDraftRequest(
    store,
    'gmail_thread_x',
    'user_requested',
    at,
    { force: true, requestId },
  )
  const ready = completeQaDraftRequest(queued.store, requestId, body, at)
  const generated = ready.drafts.filter(
    draft => isGeneratedDraft(draft) && isReadyQaDraft(draft),
  )
  return { store: ready, draftId: generated[0].id }
}

describe('draft lifecycle (audit regressions)', () => {
  it('P3: asking twice improves the draft instead of erasing it', () => {
    const first = draftReply(
      conversationStore(),
      'Approved, shipping Friday.',
      'req1',
      '2026-08-18T11:00:00.000Z',
    )
    expect(first.store.drafts[0].body).toContain('Approved, shipping Friday.')

    // The second request finds the existing draft and rewrites it. The old
    // id was `autodraft_<threadId>` and reconstructible, so a lookup miss
    // rebuilt it and the collision overwrote the finished draft with an
    // empty placeholder.
    const second = enqueueQaDraftRequest(
      first.store,
      'gmail_thread_x',
      'user_requested',
      '2026-08-18T12:00:00.000Z',
      { force: true, requestId: 'req2' },
    )
    expect(second.store.drafts).toHaveLength(1)
    expect(second.store.drafts[0].id).toBe(first.draftId)
    expect(second.store.drafts[0].body).toContain('Approved, shipping Friday.')

    const improved = completeQaDraftRequest(
      second.store,
      'req2',
      'Approved. Shipping Friday, as discussed.',
      '2026-08-18T12:01:00.000Z',
    )
    expect(improved.drafts).toHaveLength(1)
    expect(improved.drafts[0].body).toContain('as discussed')
  })

  it('P3b: no draft is ever moved onto a synthetic thread', () => {
    const { store, draftId } = draftReply(
      conversationStore(),
      'Approved.',
      'req1',
      '2026-08-18T11:00:00.000Z',
    )
    expect(store.drafts[0].threadId).toBe('gmail_thread_x')
    expect(store.threads.map(thread => thread.id)).toEqual(['gmail_thread_x'])
    // ...so nothing can be orphaned by a prune, either.
    expect(pruneOrphanedDraftThreads(store)).toEqual(store)
    expect(draftId).toBeTruthy()
  })

  it('P6: sending a reply keeps its conversation and drops the draft', () => {
    const { store, draftId } = draftReply(
      conversationStore(),
      'Approved.',
      'req1',
      '2026-08-18T11:00:00.000Z',
    )
    const sent = sendDraft(store, draftId, '2026-08-18T11:05:00.000Z', {
      appendMessage: true,
      keepDraft: false,
      sentGmailMessageId: 'gmail-sent-1',
    })
    // The boot prune used to delete the thread a sent draft produced,
    // orphaning its message.
    const afterBoot = pruneOrphanedDraftThreads(sent)
    expect(afterBoot.threads.map(thread => thread.id)).toEqual([
      'gmail_thread_x',
    ])
    expect(afterBoot.drafts).toHaveLength(0)
    expect(
      afterBoot.messages.filter(
        message => message.threadId === 'gmail_thread_x',
      ),
    ).toHaveLength(2)
  })

  it('a conversation appears under Drafts while it holds one, and leaves on send', () => {
    const { store, draftId } = draftReply(
      conversationStore(),
      'Approved.',
      'req1',
      '2026-08-18T11:00:00.000Z',
    )
    const at = new Date('2026-08-18T11:10:00.000Z')
    const inDrafts = resolveThreadQuery(store, 'acc', 'in:Drafts', at)
    expect(inDrafts.threads.map(thread => thread.id)).toEqual([
      'gmail_thread_x',
    ])
    // ...and it never left the inbox to get there.
    const inInbox = resolveThreadQuery(store, 'acc', 'in:inbox', at)
    expect(inInbox.threads.map(thread => thread.id)).toEqual([
      'gmail_thread_x',
    ])

    const sent = sendDraft(store, draftId, '2026-08-18T11:05:00.000Z', {
      appendMessage: true,
      keepDraft: false,
      sentGmailMessageId: 'gmail-sent-1',
    })
    expect(resolveThreadQuery(sent, 'acc', 'in:Drafts', at).threads).toEqual([])
  })

  it('a composed message reaches Drafts and moves to Sent when sent', () => {
    const composed = createComposedMessageDraft(
      conversationStore(),
      {
        accountId: 'acc',
        to: [{ name: 'Mira', email: 'mira@example.com' }],
        subject: 'A new thing',
        body: 'Starting a fresh conversation.',
      },
      '2026-08-18T13:00:00.000Z',
    )
    const at = new Date('2026-08-18T13:10:00.000Z')
    expect(
      resolveThreadQuery(composed.store, 'acc', 'in:Drafts', at).threads.map(
        thread => thread.id,
      ),
    ).toContain(composed.threadId)

    const sent = sendDraft(
      composed.store,
      composed.draftId,
      '2026-08-18T13:05:00.000Z',
      { appendMessage: true, keepDraft: false, sentGmailMessageId: 'g-1' },
    )
    const thread = sent.threads.find(item => item.id === composed.threadId)!
    expect(thread.mailboxId).toBe('mb_sent')
    expect(
      resolveThreadQuery(sent, 'acc', 'in:Drafts', at).threads.map(
        item => item.id,
      ),
    ).not.toContain(composed.threadId)
  })

  it('P5: keeps the persisted mailbox compact without risking drafts', () => {
    // Rich provider HTML is restored by sync and may contain the same large
    // template/CSS payload thousands of times. Persist plain text for a fast,
    // readable startup cache while drafts remain losslessly separate.
    const html = `<div>${'x'.repeat(40 * 1024)}</div>`
    const threads: MailThread[] = []
    const messages: MailMessage[] = []
    for (let index = 0; index < 150; index += 1) {
      threads.push({ ...CONVERSATION, id: `gmail_thread_${index}` })
      messages.push({
        ...INBOUND,
        id: `gmail_msg_${index}`,
        threadId: `gmail_thread_${index}`,
        bodyHtml: html,
      })
    }
    const store: MailStore = {
      ...conversationStore(),
      threads,
      messages,
      drafts: [
        {
          id: 'draft_1',
          threadId: 'gmail_thread_0',
          to: [],
          subject: 'Re: Launch copy',
          body: 'A short reply.',
          attachments: [],
          updatedAt: '2026-08-18T11:00:00.000Z',
          syncState: 'pending',
        },
      ],
    }
    const persistable = persistableMailStore(store)
    const cacheBytes = JSON.stringify({
      ...persistable,
      drafts: [],
    }).length
    const draftBytes = JSON.stringify({ drafts: persistable.drafts }).length

    expect(cacheBytes).toBeLessThan(1024 * 1024)
    expect(persistable.messages.every(message => !message.bodyHtml)).toBe(true)
    // The drafts file stays tiny, so it lands even when the cache does not.
    expect(draftBytes).toBeLessThan(64 * 1024)
  })

  it('keeps HTML-only provider mail readable in the startup cache', () => {
    const store = conversationStore()
    store.messages = [
      {
        ...INBOUND,
        body: '',
        bodyHtml: '<style>.hidden { color: red }</style><p>Hello <b>there</b>.</p>',
      },
    ]

    const [persisted] = persistableMailStore(store).messages

    expect(persisted.bodyHtml).toBeUndefined()
    expect(persisted.body).toBe('Hello there .')
  })
})

describe('one reply draft per conversation', () => {
  it('createReplyDraft is only reached when the thread has none', () => {
    // The reuse itself lives in the shell (it needs the thread's draft list),
    // but the invariant it protects is testable here: two reply drafts on one
    // conversation both show under Drafts as the same row, so the second one
    // is invisible and buries the first.
    const store = conversationStore()
    const at = new Date('2026-08-18T12:00:00.000Z')
    const withTwo: MailStore = {
      ...store,
      drafts: [
        {
          id: 'draft_reply_1',
          threadId: 'gmail_thread_x',
          to: [],
          subject: 'Re: Launch copy',
          body: 'The one the user wrote.',
          attachments: [],
          updatedAt: '2026-08-18T11:00:00.000Z',
          syncState: 'pending',
        },
        {
          id: 'draft_reply_2',
          threadId: 'gmail_thread_x',
          to: [],
          subject: 'Re: Launch copy',
          body: '',
          attachments: [],
          updatedAt: '2026-08-18T11:30:00.000Z',
          syncState: 'pending',
        },
      ],
    }
    const rows = resolveThreadQuery(withTwo, 'acc', 'in:Drafts', at).threads
    expect(rows).toHaveLength(1)
    // One row, two drafts behind it — which is why Reply must open the
    // existing draft rather than mint another.
    expect(
      withTwo.drafts.filter(draft => draft.threadId === rows[0].id),
    ).toHaveLength(2)
  })
})
