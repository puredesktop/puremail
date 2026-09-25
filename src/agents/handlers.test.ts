import { draftEditVersion } from '../lib/mailDrawerDrafts'
import { describe, expect, it } from 'vitest'
import { demoMailStoreForNow } from '../lib/mailModel'
import { buildMailProposal, MailProposalError } from '../lib/mailProposal'
import { PUREMAIL_AGENT_TOOL_NAMES, AgentMailToolError } from './catalog'
import type { MailAgentToolContext } from './catalog'
import {
  addDraftAttachmentsHandler,
  removeDraftAttachmentHandler,
  createFilterHandler,
  openThreadHandler,
  createMailTaskHandler,
  searchAllMailHandler,
  deleteFilterHandler,
  deleteViewHandler,
  composeMessageHandler,
  discardDraftHandler,
  draftReplyHandler,
  getDraftHandler,
  listDraftsHandler,
  updateDraftHandler,
  fileThreadHandler,
  listBoxesHandler,
  setFilterEnabledHandler,
  getMailContextHandler,
  getThreadHandler,
  listThreadsHandler,
  listViewsHandler,
  applyMailActionHandler,
  markThreadsReadHandler,
  saveViewHandler,
  showQueryHandler,
} from './handlers'
import type { Attachment, Draft, MailStore } from '../types'
import { bytesToBase64 } from '../lib/mailAttachments'

const NOW = new Date('2026-07-24T12:00:00.000Z')

function makeContext(
  overrides: Partial<MailAgentToolContext> = {},
): MailAgentToolContext & {
  shown: string[]
  proposals: unknown[]
  tasks: unknown[]
  draftRequests: string[]
  agentSearches: Array<{ query: string; total: number }>
} {
  const store = demoMailStoreForNow(NOW)
  const shown: string[] = []
  const proposals: unknown[] = []
  const tasks: unknown[] = []
  const draftRequests: string[] = []
  const agentSearches: Array<{ query: string; total: number }> = []
  const context = {
    store,
    accountId: store.accounts[0].id,
    now: NOW,
    currentQuery: 'in:Inbox',
    selectedThread: store.threads[0],
    showQuery: (query: string) => shown.push(query),
    setStore: (updater: (store: MailStore) => MailStore) => {
      context.store = updater(context.store)
    },
    applyAction: (proposal: unknown) => proposals.push(proposal),
    listMailOperations: async () => [],
    addTaskForThread: (threadId: string, title: string) =>
      tasks.push({ threadId, title }),
    requestDraftForThread: async (threadId: string) => {
      draftRequests.push(threadId)
      return { status: 'prepared' as const, requestId: `request_for_${threadId}`, threadId, accountId: store.accounts[0].id, instructions: 'Write a reply', context: 'Thread context' }
    },
    noteAgentSearch: (search: { query: string; total: number }) =>
      agentSearches.push(search),
    shown,
    proposals,
    tasks,
    draftRequests,
    agentSearches,
    ...overrides,
  }
  return context
}

function parse(result: { content: string }): any {
  return JSON.parse(result.content)
}

function generatedDraft(threadId: string, overrides: Partial<Draft> = {}): Draft {
  return {
    id: `autodraft_${threadId}`,
    threadId,
    to: [{ name: 'Someone', email: 'someone@example.com' }],
    subject: 'Re: something',
    body: 'Generated draft body for review.',
    attachments: [],
    updatedAt: '2026-07-24T11:00:00.000Z',
    syncState: 'pending',
    source: 'auto',
    draftKind: 'auto_reply',
    qaStatus: 'ready',
    ...overrides,
  }
}

describe('agent tool catalog', () => {
  it('declares exactly the tools plugin.json advertises', async () => {
    const manifest = (
      await import('../../plugin.json', { with: { type: 'json' } })
    ).default as { app: { agents: { tools: Array<{ name: string }> } } }
    const declared = manifest.app.agents.tools.map(tool => tool.name).sort()

    // A name in one list but not the other is the exact failure mode that
    // makes an agent's call hang for 90s and then error.
    expect([...PUREMAIL_AGENT_TOOL_NAMES].sort()).toEqual(declared)
  })

  it('gives every tool an inputSchema the shell will actually forward', async () => {
    const manifest = (
      await import('../../plugin.json', { with: { type: 'json' } })
    ).default as {
      app: {
        agents: {
          tools: Array<{
            name: string
            inputSchema?: { type?: string }
            requiresApproval?: boolean
          }>
        }
      }
    }
    for (const tool of manifest.app.agents.tools) {
      // The shell reads `inputSchema`; three tools once shipped declaring
      // `parameters` instead, so the model saw no argument schema at all,
      // called searchAllMail with no args and gave up on the error.
      expect(tool.inputSchema?.type, `${tool.name} has no inputSchema`).toBe(
        'object',
      )
      expect(
        typeof tool.requiresApproval,
        `${tool.name} does not state requiresApproval`,
      ).toBe('boolean')
    }
  })

  it('declares the move action in proposeAction where the model reads it', async () => {
    const manifest = (
      await import('../../plugin.json', { with: { type: 'json' } })
    ).default as unknown as {
      app: {
        agents: {
          tools: Array<{
            name: string
            inputSchema?: {
              properties?: Record<string, { enum?: string[] }>
            }
          }>
        }
      }
    }
    const propose = manifest.app.agents.tools.find(
      tool => tool.name === 'applyMailAction',
    )
    expect(propose?.inputSchema?.properties?.action?.enum).toContain('move')
    expect(propose?.inputSchema?.properties?.mailboxName).toBeDefined()
    // Star rides the same enum: the UI and both providers already support
    // setThreadStarred, so the tool must offer it too.
    expect(propose?.inputSchema?.properties?.action?.enum).toContain('star')
    expect(propose?.inputSchema?.properties?.action?.enum).toContain('unstar')
  })
})

describe('read tools', () => {
  it('reports the query the user is actually looking at', () => {
    const context = makeContext()
    const result = parse(getMailContextHandler(context))

    expect(result.currentQuery).toBe('in:Inbox')
    expect(result.visibleThreadCount).toBeGreaterThan(0)
    expect(result.account.email).toBe('alex@example.com')
  })

  it('lists threads for a query with the canonical query and full total', () => {
    const context = makeContext()
    const result = parse(
      listThreadsHandler(context, { query: 'in:Inbox is:unread' }),
    )

    // Every agent search is recorded so the client can show what was run.
    expect(context.agentSearches).toEqual([
      { query: 'in:Inbox is:unread', total: result.total },
    ])
    expect(result.query).toBe('in:Inbox is:unread')
    // Coverage is always stated; the warning only when a time scope is named.
    expect(result.localCoverage).toMatch(/synced locally/)
    expect(result.coverageWarning).toBeUndefined()
    expect(result.returned).toBe(result.threads.length)
    expect(result.threads.every((t: { unread: boolean }) => t.unread)).toBe(
      true,
    )
  })

  it('warns when a query names a time scope the local store cannot cover', () => {
    const context = makeContext()
    const result = parse(
      listThreadsHandler(context, { query: 'from:dnb.com newer_than:28d' }),
    )
    // "The last 4 weeks" over a 7-day local store silently returned one week
    // and read as complete. The warning is the agent's cue to say so.
    expect(result.coverageWarning).toMatch(/locally synced/)
  })

  it('caps with limit while still reporting the true total', () => {
    const context = makeContext()
    const all = parse(listThreadsHandler(context, { query: 'in:Inbox' }))
    const capped = parse(
      listThreadsHandler(context, { query: 'in:Inbox', limit: 1 }),
    )

    expect(capped.threads).toHaveLength(1)
    expect(capped.total).toBe(all.total)
  })

  it('returns snippets by default and bodies on request', async () => {
    const context = makeContext()
    const threadId = context.store.threads[0].id
    const brief = parse(await getThreadHandler(context, { threadId }))
    const full = parse(
      await getThreadHandler(context, { threadId, includeBodies: true }),
    )

    expect(brief.messages[0].snippet).toBeTruthy()
    expect(brief.messages[0].body).toBeUndefined()
    expect(full.messages[0].body).toBeTruthy()
  })

  it('rejects an unknown thread id with a usable message', async () => {
    const context = makeContext()
    await expect(
      getThreadHandler(context, { threadId: 'nope' }),
    ).rejects.toThrow(AgentMailToolError)
  })

  it('surfaces the unsent draft on the thread', async () => {
    const context = makeContext()
    const threadId = context.store.threads[0].id
    context.store = {
      ...context.store,
      drafts: [
        ...context.store.drafts.filter(draft => draft.threadId !== threadId),
        generatedDraft(threadId),
      ],
    }
    const brief = parse(await getThreadHandler(context, { threadId }))
    const full = parse(
      await getThreadHandler(context, { threadId, includeBodies: true }),
    )

    expect(brief.draft.status).toBe('ready')
    expect(brief.draft.snippet).toBeTruthy()
    expect(brief.draft.body).toBeUndefined()
    expect(brief.draft.note).toMatch(/awaiting user review/)
    expect(full.draft.body).toBe('Generated draft body for review.')
  })

  it('reports a stuck generated draft instead of hiding it', async () => {
    const context = makeContext()
    const threadId = context.store.threads[0].id
    context.store = {
      ...context.store,
      drafts: [
        ...context.store.drafts.filter(draft => draft.threadId !== threadId),
        generatedDraft(threadId, {
          body: '',
          qaStatus: 'failed',
          qaError: 'Model unavailable.',
        }),
      ],
    }
    const result = parse(await getThreadHandler(context, { threadId }))

    // The exact failure this guards: draftReply reported "draft_exists"
    // while every read surface showed nothing, so the claim was unfalsifiable.
    expect(result.draft.status).toBe('failed')
    expect(result.draft.error).toBe('Model unavailable.')
    expect(result.draft.note).toMatch(/retry/)
  })

  it('fetches a thread from Gmail on demand when it is not local', async () => {
    const remoteThread = {
      id: 'gmail_thread_ancient',
      accountId: 'acct_gmail',
      mailboxId: 'gmail_archive',
      subject: 'Your Order Confirmation with Dun & Bradstreet',
      summary: 'Order summary',
      participants: [{ name: 'D&B', email: 'e.email@directory.example' }],
      labels: [],
      status: 'open',
      priority: 'normal',
      lastMessageAt: '2026-05-02T09:00:00.000Z',
    }
    const remoteMessage = {
      id: 'gmail_msg_ancient',
      threadId: 'gmail_thread_ancient',
      from: { name: 'D&B', email: 'e.email@directory.example' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: 'Your Order Confirmation with Dun & Bradstreet',
      body: 'Thank you for your order.',
      receivedAt: '2026-05-02T09:00:00.000Z',
      attachments: [],
      read: true,
    }
    const imports: string[] = []
    const context = makeContext({
      importRemoteThread: async (threadId: string) => {
        imports.push(threadId)
        return {
          threads: [remoteThread] as never,
          messages: [remoteMessage] as never,
        }
      },
    })

    const result = parse(
      await getThreadHandler(context, { threadId: 'gmail_thread_ancient' }),
    )

    expect(imports).toEqual(['gmail_thread_ancient'])
    expect(result.importedFromGmail).toBe(true)
    expect(result.subject).toMatch(/Order Confirmation/)
    expect(result.messages).toHaveLength(1)
  })

  it('says "locally or in Gmail" when even the on-demand fetch finds nothing', async () => {
    const context = makeContext({
      importRemoteThread: async () => null,
    })
    await expect(
      getThreadHandler(context, { threadId: 'nope' }),
    ).rejects.toThrow(/locally or in Gmail/)
  })
})

describe('showQuery', () => {
  it('points the user rail at the query and says how many it covers', () => {
    const context = makeContext()
    const result = parse(showQueryHandler(context, { query: 'is:starred' }))

    expect(context.shown).toEqual(['is:starred'])
    expect(result.shown).toBe('is:starred')
    expect(typeof result.total).toBe('number')
  })

  it('requires a query', () => {
    const context = makeContext()
    expect(() => showQueryHandler(context, {})).toThrow(AgentMailToolError)
  })
})

describe('saved views', () => {
  it('saves a view and lists it back with a live count', () => {
    const context = makeContext()
    saveViewHandler(context, { name: 'Unread inbox', query: 'in:Inbox is:unread' })

    const listed = parse(listViewsHandler(context))
    expect(listed.views).toHaveLength(1)
    expect(listed.views[0]).toMatchObject({
      name: 'Unread inbox',
      query: 'in:Inbox is:unread',
    })
    expect(listed.views[0].matches).toBeGreaterThan(0)
  })
})

describe('searchAllMail', () => {
  it('reaches Gmail with the query and relays the remote-result caveat', async () => {
    const remote = [
      {
        threadId: 'gmail_thread_old',
        subject: 'Your Order Confirmation with Dun & Bradstreet',
        from: 'e.email@directory.example',
        date: '2026-05-02T09:00:00.000Z',
        snippet: 'Thank you for your order.',
        inLocalWindow: false,
      },
    ]
    const calls: Array<{ query: string; limit: number }> = []
    const context = makeContext({
      searchAllMail: async (query: string, limit: number) => {
        calls.push({ query, limit })
        return remote
      },
    })
    const result = parse(
      await searchAllMailHandler(context, { query: 'from:dnb.com' }),
    )

    expect(calls).toEqual([{ query: 'from:dnb.com', limit: 20 }])
    expect(result.results).toEqual(remote)
    // Without importRemoteThread the caveat says results cannot be opened.
    expect(result.note).toMatch(/cannot be opened with getThread/)
  })

  it('says plainly that it needs a connected account', async () => {
    const context = makeContext()
    await expect(
      searchAllMailHandler(context, { query: 'from:dnb.com' }),
    ).rejects.toThrow(/connected provider account/)
  })

  it('offers the getThread import only when the provider can import', async () => {
    const context = makeContext({
      searchAllMail: async () => [],
      importRemoteThread: async () => null,
    })
    const result = parse(
      await searchAllMailHandler(context, { query: 'from:dnb.com' }),
    )
    expect(result.note).toMatch(/getThread will fetch them from the server/)
  })
})

describe('deleteView', () => {
  it('deletes a saved view by name, case-insensitively', () => {
    const context = makeContext()
    saveViewHandler(context, { name: 'Unread inbox', query: 'is:unread' })
    const result = parse(
      deleteViewHandler(context, { name: 'unread INBOX' }),
    )

    expect(result.deleted).toBe('Unread inbox')
    expect(parse(listViewsHandler(context)).views).toHaveLength(0)
  })

  it('names the existing views when asked to delete one that is not there', () => {
    const context = makeContext()
    expect(() => deleteViewHandler(context, { name: 'nope' })).toThrow(
      AgentMailToolError,
    )
  })
})

describe('draftReply', () => {
  it('requests a draft for the named thread and reports the outcome', async () => {
    const context = makeContext()
    const threadId = context.store.threads[1].id
    const result = parse(await draftReplyHandler(context, { threadId }))

    expect(context.draftRequests).toEqual([threadId])
    expect(result.status).toBe('prepared')
    // The contract the tool exists under: it must say nothing sends itself.
    expect(result.note).toMatch(/no draft was written/)
  })

  it('falls back to the selected thread', async () => {
    const context = makeContext()
    await draftReplyHandler(context, {})
    expect(context.draftRequests).toEqual([context.store.threads[0].id])
  })

  it('rejects an unknown thread id', async () => {
    const context = makeContext()
    await expect(
      draftReplyHandler(context, { threadId: 'nope' }),
    ).rejects.toThrow(AgentMailToolError)
  })
})

describe('composeMessage', () => {
  function contextWithCompose() {
    const composed: Array<Record<string, string>> = []
    const context = makeContext({
      composeNewMessage: input => {
        composed.push({ ...input })
        return { draftId: 'draft_new', threadId: 'thread_new' }
      },
    })
    return { composed, context }
  }

  it('composes a new message rather than a reply', async () => {
    const { composed, context } = contextWithCompose()
    const result = parse(
      await composeMessageHandler(context, {
        to: 'Taylor Example <taylor@example.com>',
        subject: 'Coffee next week?',
        body: 'Are you free Tuesday?',
      }),
    )

    expect(composed).toHaveLength(1)
    expect(composed[0].subject).toBe('Coffee next week?')
    expect(result.threadId).toBe('thread_new')
    // The contract every drafting tool carries.
    expect(result.note).toMatch(/nothing sends without them/i)
    // It must NOT have gone through the reply path.
    expect(context.draftRequests).toEqual([])
  })

  it('carries cc and bcc when given', async () => {
    const { composed, context } = contextWithCompose()
    await composeMessageHandler(context, {
      to: 'a@example.com',
      subject: 'Hello',
      body: 'Hi',
      cc: 'b@example.com',
      bcc: 'c@example.com',
    })

    expect(composed[0].cc).toBe('b@example.com')
    expect(composed[0].bcc).toBe('c@example.com')
  })

  it('requires a recipient, a subject and a body', async () => {
    const { context } = contextWithCompose()
    await expect(
      composeMessageHandler(context, { subject: 'x', body: 'y' }),
    ).rejects.toThrow(AgentMailToolError)
    await expect(
      composeMessageHandler(context, { to: 'a@b.c', body: 'y' }),
    ).rejects.toThrow(AgentMailToolError)
    await expect(
      composeMessageHandler(context, { to: 'a@b.c', subject: 'x' }),
    ).rejects.toThrow(AgentMailToolError)
  })

  it('says so when the surface cannot compose', async () => {
    const context = makeContext()
    await expect(
      composeMessageHandler(context, {
        to: 'a@b.c',
        subject: 'x',
        body: 'y',
      }),
    ).rejects.toThrow(AgentMailToolError)
  })
})

describe('applyMailAction', () => {
  it('hands the resolved batch to the apply path and reports it applied', () => {
    const context = makeContext()

    const result = parse(
      applyMailActionHandler(context, {
        query: 'in:Inbox is:unread',
        action: 'archive',
        rationale: 'Clearing read newsletters',
      }),
    )

    expect(result.status).toBe('applied')
    expect(result.threadCount).toBeGreaterThan(0)
    // The handler resolves the query and delegates; the shell's triage
    // path applies it and the ledger records it.
    expect(context.proposals).toHaveLength(1)
  })

  it('refuses a query that matches nothing rather than applying an empty batch', () => {
    const store = demoMailStoreForNow(NOW)
    expect(() =>
      buildMailProposal(
        store,
        store.accounts[0].id,
        { query: 'from:nobody@nowhere.example', action: 'archive' },
        NOW,
      ),
    ).toThrow(MailProposalError)
  })

  it('requires a label name for label actions and rejects unknown labels', () => {
    const store = demoMailStoreForNow(NOW)
    const account = store.accounts[0].id

    expect(() =>
      buildMailProposal(store, account, { query: '', action: 'label' }, NOW),
    ).toThrow(/labelName/)

    expect(() =>
      buildMailProposal(
        store,
        account,
        { query: '', action: 'label', labelName: 'Nonexistent' },
        NOW,
      ),
    ).toThrow(/No label named/)
  })

  it('maps star and unstar onto the shared star triage action', () => {
    const store = demoMailStoreForNow(NOW)
    const account = store.accounts[0].id
    expect(
      buildMailProposal(store, account, { query: 'in:Inbox', action: 'star' }, NOW)
        .action,
    ).toEqual({ type: 'star', starred: true })
    expect(
      buildMailProposal(
        store,
        account,
        { query: 'in:Inbox', action: 'unstar' },
        NOW,
      ).action,
    ).toEqual({ type: 'star', starred: false })
  })

  it('resolves a label name to its id', () => {
    const store = demoMailStoreForNow(NOW)
    const label = store.labels[0]
    const proposal = buildMailProposal(
      store,
      store.accounts[0].id,
      { query: '', action: 'label', labelName: label.name },
      NOW,
    )

    expect(proposal.action).toEqual({ type: 'label', labelId: label.id })
  })

  it('covers every thread in a conversation, not just the visible row', () => {
    const store = demoMailStoreForNow(NOW)
    const proposal = buildMailProposal(
      store,
      store.accounts[0].id,
      { query: 'in:Inbox', action: 'archive' },
      NOW,
    )
    const inboxThreads = store.threads.filter(thread => {
      const mailbox = store.mailboxes.find(m => m.id === thread.mailboxId)
      return mailbox?.role === 'inbox'
    })

    expect(proposal.threadIds.length).toBe(inboxThreads.length)
  })

  it('resolves a mailbox name for move proposals and rejects unknown ones', () => {
    const store = demoMailStoreForNow(NOW)
    const account = store.accounts[0].id
    const target = store.mailboxes.find(m => m.role === 'archive')!

    const proposal = buildMailProposal(
      store,
      account,
      { query: 'in:Inbox', action: 'move', mailboxName: target.name },
      NOW,
    )
    expect(proposal.action).toEqual({ type: 'move', mailboxId: target.id })

    expect(() =>
      buildMailProposal(store, account, { query: 'in:Inbox', action: 'move' }, NOW),
    ).toThrow(/mailboxName/)
    expect(() =>
      buildMailProposal(
        store,
        account,
        { query: 'in:Inbox', action: 'move', mailboxName: 'Nowhere' },
        NOW,
      ),
    ).toThrow(/No mailbox named/)
  })

  it('rejects a snooze without a valid timestamp', () => {
    const store = demoMailStoreForNow(NOW)
    expect(() =>
      buildMailProposal(
        store,
        store.accounts[0].id,
        { query: '', action: 'snooze', snoozedUntil: 'next tuesday' },
        NOW,
      ),
    ).toThrow(/not a valid timestamp/)
  })
})

describe('createMailTask', () => {
  it('falls back to the selected thread when none is given', () => {
    const context = makeContext()
    createMailTaskHandler(context, { title: 'Reply to Mira' })

    expect(context.tasks).toEqual([
      { threadId: context.store.threads[0].id, title: 'Reply to Mira' },
    ])
  })

  it('errors when there is no thread to attach to', () => {
    const context = makeContext({ selectedThread: null })
    expect(() =>
      createMailTaskHandler(context, { title: 'Orphan task' }),
    ).toThrow(AgentMailToolError)
  })
})

describe('filters and boxes lifecycle', () => {
  it('deleteFilter and setFilterEnabled complete the rule lifecycle', () => {
    const context = makeContext()
    createFilterHandler(context, {
      name: 'github',
      query: 'from:notifications@github.com',
      labelName: 'github',
      fileIntoBox: true,
    })
    expect(context.store.filters).toHaveLength(1)

    setFilterEnabledHandler(context, { filter: 'github', enabled: false })
    expect(context.store.filters?.[0]?.enabled).toBe(false)

    deleteFilterHandler(context, { filter: 'github' })
    expect(context.store.filters).toHaveLength(0)

    expect(() =>
      deleteFilterHandler(context, { filter: 'github' }),
    ).toThrow(AgentMailToolError)
  })

  it('fileThread MOVES to a real account folder instead of labelling', async () => {
    const context = makeContext()
    const moves: Array<{ threadId: string; mailboxId: string }> = []
    context.moveThreadToMailbox = async (threadId, mailboxId) => {
      moves.push({ threadId, mailboxId })
    }
    // A provider-real mailbox, as the IMAP provider mints them.
    context.store = {
      ...context.store,
      mailboxes: [
        ...context.store.mailboxes,
        {
          id: 'imap_mbx_git',
          accountId: context.accountId!,
          name: 'git',
          role: 'custom' as const,
          unreadCount: 0,
        },
      ],
    }
    const target = context.store.threads.find(t => t.status === 'inbox')!
    const payload = parse(
      await fileThreadHandler(context, { threadId: target.id, box: 'Git' }),
    )
    expect(moves).toEqual([{ threadId: target.id, mailboxId: 'imap_mbx_git' }])
    expect(payload.note).toMatch(/on the mail server/)
    // No local label-box was invented for it.
    expect(
      context.store.mailboxes.filter(m => m.name.toLowerCase() === 'git'),
    ).toHaveLength(1)

    const listed = parse(listBoxesHandler(context))
    expect(
      listed.boxes.find((b: { name: string }) => b.name === 'git')?.kind,
    ).toBe('account_folder')
  })

  it('fileThread homes a thread in its box and reports it via listBoxes', async () => {
    const context = makeContext()
    const target = context.store.threads.find(t => t.status === 'inbox')!
    const payload = parse(
      await fileThreadHandler(context, { threadId: target.id, box: 'Receipts' }),
    )
    expect(payload.box).toBe('Receipts')

    const box = context.store.mailboxes.find(
      m => m.role === 'custom' && m.name === 'Receipts',
    )
    expect(box).toBeDefined()
    const filed = context.store.threads.find(t => t.id === target.id)!
    expect(filed.mailboxId).toBe(box!.id)
    expect(filed.status).toBe('archived')

    const listed = parse(listBoxesHandler(context))
    expect(
      listed.boxes.some(
        (b: { name: string; threads: number }) =>
          b.name === 'Receipts' && b.threads >= 1,
      ),
    ).toBe(true)
  })


  it('openThread opens a known thread and rejects unknown ids', () => {
    const context = makeContext()
    const opened: Array<{ threadId: string; messageId?: string | null }> = []
    ;(context as MailAgentToolContext).openThreadInReader = (
      threadId,
      messageId,
    ) => opened.push({ threadId, messageId })
    const target = context.store.threads[0]!
    const payload = parse(openThreadHandler(context, { threadId: target.id }))
    expect(payload.threadId).toBe(target.id)
    expect(opened).toEqual([{ threadId: target.id, messageId: null }])
    expect(() =>
      openThreadHandler(context, { threadId: 'thread_nope' }),
    ).toThrow(AgentMailToolError)
  })

  it('draftReply forwards instructions to the drafting context', async () => {
    const context = makeContext()
    const briefs: Array<string | undefined> = []
    context.requestDraftForThread = async (
      _threadId: string,
      brief?: string,
    ) => {
      briefs.push(brief)
      return { status: 'prepared' as const, requestId: 'request_1', threadId: _threadId, accountId: context.accountId!, instructions: '', context: '' }
    }
    await draftReplyHandler(context, {
      threadId: context.store.threads[0]!.id,
      instructions: 'decline politely',
    })
    expect(briefs).toEqual(['decline politely'])
  })

  it('draftReply reports preparation without claiming a draft exists', async () => {
    const context = makeContext()
    const threadId = context.store.threads[0]!.id
    const payload = parse(await draftReplyHandler(context, { threadId }))
    expect(payload.status).toBe('prepared')
    expect(payload.requestId).toBe(`request_for_${threadId}`)
    expect(payload.draftId).toBeUndefined()
    expect(payload.applied).toBe(false)
  })

  it('draftReply reports a failure as a failure', async () => {
    const context = makeContext()
    context.requestDraftForThread = async () => { throw new Error('thread changed') }
    await expect(draftReplyHandler(context, { threadId: context.store.threads[0]!.id })).rejects.toThrow('thread changed')
  })

  it('listDrafts and getDraft read back what was written, failures included', () => {
    const context = makeContext()
    const threadId = context.store.threads[0]!.id
    context.store = {
      ...context.store,
      drafts: [
        {
          id: 'draft_ready',
          threadId,
          to: [{ name: 'Mira', email: 'mira@example.com' }],
          subject: 'Re: Launch copy',
          body: 'Approved, shipping Friday.',
          attachments: [],
          updatedAt: '2026-08-19T12:00:00.000Z',
          syncState: 'synced',
          providerDraftId: 'r1',
          draftKind: 'auto_reply',
          qaStatus: 'ready',
        },
        {
          id: 'draft_failed',
          threadId,
          to: [],
          subject: 'Re: Launch copy',
          body: '',
          attachments: [],
          updatedAt: '2026-08-19T11:00:00.000Z',
          syncState: 'pending',
          draftKind: 'auto_reply',
          qaStatus: 'failed',
          qaError: 'model unavailable',
        },
      ],
    }
    const list = parse(listDraftsHandler(context, {}))
    expect(list.total).toBe(2)
    const states = list.drafts.map((draft: { state: string }) => draft.state)
    expect(states).toContain('not_sent')
    expect(states).toContain('failed')
    expect(list.drafts[0].savedToAccount).toBe(true)

    const one = parse(getDraftHandler(context, { draftId: 'draft_ready' }))
    expect(one.body).toBe('Approved, shipping Friday.')
    expect(() => getDraftHandler(context, { draftId: 'nope' })).toThrow(
      AgentMailToolError,
    )
  })

  it('updateDraft rewrites in place instead of making a second draft', () => {
    const context = makeContext()
    const threadId = context.store.threads[0]!.id
    const edits: Array<{ draftId: string; patch: Record<string, unknown> }> = []
    context.store = {
      ...context.store,
      drafts: [
        {
          id: 'draft_1',
          threadId,
          to: [],
          subject: 'Re: Launch copy',
          body: 'First take.',
          attachments: [],
          updatedAt: '2026-08-19T12:00:00.000Z',
          syncState: 'pending',
        },
      ],
    }
    context.editDraft = (draftId: string, patch: Record<string, unknown>) => {
      edits.push({ draftId, patch })
      return { ok: true as const }
    }
    const payload = parse(
      updateDraftHandler(context, {
        expectedVersion: draftEditVersion(context.store.drafts[0]),
        draftId: 'draft_1',
        body: 'Shorter take.',
      }),
    )
    expect(edits).toEqual([
      { draftId: 'draft_1', patch: { body: 'Shorter take.' } },
    ])
    expect(payload.changed).toEqual(['body'])
    expect(() =>
      updateDraftHandler(context, { draftId: 'draft_1', expectedVersion: draftEditVersion(context.store.drafts[0]) }),
    ).toThrow(AgentMailToolError)
  })

  it('discardDraft refuses a draft that has already been sent', () => {
    const context = makeContext()
    const threadId = context.store.threads[0]!.id
    context.store = {
      ...context.store,
      drafts: [
        {
          id: 'draft_sent',
          threadId,
          to: [],
          subject: 'Re: Launch copy',
          body: 'Gone already.',
          attachments: [],
          updatedAt: '2026-08-19T12:00:00.000Z',
          syncState: 'synced',
          sentAt: '2026-08-19T12:05:00.000Z',
        },
      ],
    }
    context.discardDraft = () => ({ ok: true as const })
    expect(() =>
      discardDraftHandler(context, { draftId: 'draft_sent' }),
    ).toThrow(AgentMailToolError)
  })
})


describe('draft attachments', () => {
  const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  function contextWithDraft(attachments: Attachment[] = []) {
    const files: Record<string, { bytes: Uint8Array; mimeType?: string }> = {
      '/Users/developer/Pure/report.pdf': { bytes: PDF_BYTES, mimeType: 'application/pdf' },
      '/Users/developer/Pure/photo.png': { bytes: PNG_BYTES, mimeType: 'image/png' },
      '/Users/developer/Pure/notes.xyz': { bytes: new Uint8Array([0x61, 0x62]) },
    }
    const reads: Array<{ path: string; maxBytes: number }> = []
    const writes: Array<{ draftId: string; attachments: Attachment[]; summary: string }> = []
    const context = makeContext({
      readAttachmentFile: async (path, maxBytes) => {
        reads.push({ path, maxBytes })
        const file = files[path]
        if (!file) throw new Error('ENOENT: no such file')
        return {
          base64: bytesToBase64(file.bytes),
          byteLength: file.bytes.length,
          truncated: file.bytes.length > maxBytes,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        }
      },
      setDraftAttachments: (draftId, next, summary) => {
        writes.push({ draftId, attachments: next, summary })
        context.store = {
          ...context.store,
          drafts: context.store.drafts.map(draft =>
            draft.id === draftId ? { ...draft, attachments: next } : draft,
          ),
        }
        return { ok: true as const }
      },
    })
    const threadId = context.store.threads[0]!.id
    context.store = {
      ...context.store,
      drafts: [
        {
          id: 'draft_1',
          threadId,
          to: [{ name: 'Mira', email: 'mira@example.com' }],
          subject: 'Re: Launch copy',
          body: 'Here is the file.',
          attachments,
          updatedAt: '2026-08-19T12:00:00.000Z',
          syncState: 'pending',
        },
      ],
    }
    return { context, reads, writes }
  }

  it('attaches files the way the compose window does and reports the result', async () => {
    const { context, reads, writes } = contextWithDraft()
    const payload = parse(
      await addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/report.pdf', '/Users/developer/Pure/photo.png'],
      }),
    )
    expect(payload.added.map((item: { name: string }) => item.name)).toEqual([
      'report.pdf',
      'photo.png',
    ])
    expect(payload.added[0].mimeType).toBe('application/pdf')
    expect(payload.added[1].mimeType).toBe('image/png')
    expect(payload.added[0].size).toBe(8)
    expect(payload.total).toBe('16 B')
    expect(payload.limit).toBe('25.0 MB')
    expect(payload.attachmentCount).toBe(2)
    expect(payload.note).toMatch(/sent only when the user sends/i)
    // Reads ask for the whole file, not the shell's 5 MB preview cap.
    expect(reads[0]!.maxBytes).toBeGreaterThan(25 * 1024 * 1024)
    // One write, carrying the ledger line.
    expect(writes).toHaveLength(1)
    expect(writes[0]!.summary).toMatch(/Attached "report.pdf", "photo.png"/)
    const stored = context.store.drafts[0]!.attachments
    expect(stored).toHaveLength(2)
    expect(stored[0]!.content).toBe(
      `data:application/pdf;base64,${bytesToBase64(PDF_BYTES)}`,
    )
    // getDraft now shows them, with ids the remove tool can use.
    const draft = parse(getDraftHandler(context, { draftId: 'draft_1' }))
    expect(draft.attachments.map((item: { name: string }) => item.name)).toEqual([
      'report.pdf',
      'photo.png',
    ])
  })

  it('sniffs the mime type when the file has an unknown extension and no claim', async () => {
    const { context } = contextWithDraft()
    const payload = parse(
      await addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/notes.xyz'],
      }),
    )
    expect(payload.added[0].mimeType).toBe('application/octet-stream')
  })

  it('refuses relative paths, missing files, unknown drafts and sent drafts', async () => {
    const { context, writes } = contextWithDraft()
    await expect(
      addDraftAttachmentsHandler(context, { draftId: 'draft_1', paths: ['report.pdf'] }),
    ).rejects.toThrow(/absolute/i)
    await expect(
      addDraftAttachmentsHandler(context, { draftId: 'draft_1', paths: [] }),
    ).rejects.toThrow(AgentMailToolError)
    await expect(
      addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/missing.pdf'],
      }),
    ).rejects.toThrow(/Could not read/)
    await expect(
      addDraftAttachmentsHandler(context, {
        draftId: 'nope',
        paths: ['/Users/developer/Pure/report.pdf'],
      }),
    ).rejects.toThrow(/listDrafts/)
    context.store = {
      ...context.store,
      drafts: context.store.drafts.map(draft => ({
        ...draft,
        sentAt: '2026-08-19T13:00:00.000Z',
      })),
    }
    await expect(
      addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/report.pdf'],
      }),
    ).rejects.toThrow(/already been sent/)
    expect(writes).toEqual([])
  })

  it('refuses the whole batch over the sending limit, naming total and limit', async () => {
    const big: Attachment = {
      id: 'att_big',
      name: 'big.zip',
      mimeType: 'application/zip',
      sizeLabel: '25.0 MB',
      size: 25 * 1024 * 1024,
    }
    const { context, writes } = contextWithDraft([big])
    await expect(
      addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/report.pdf'],
      }),
    ).rejects.toThrow(/would total 25\.0 MB, over the 25\.0 MB sending limit/)
    expect(writes).toEqual([])
    expect(context.store.drafts[0]!.attachments).toHaveLength(1)
  })

  it('refuses a single file the shell had to truncate', async () => {
    const { context, writes } = contextWithDraft()
    context.readAttachmentFile = async () => ({
      base64: '',
      truncated: true,
      byteLength: 30 * 1024 * 1024,
    })
    await expect(
      addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/report.pdf'],
      }),
    ).rejects.toThrow(/30\.0 MB.*over the 25\.0 MB sending limit on its own/)
    expect(writes).toEqual([])
  })

  it('skips a file already on the draft instead of attaching it twice', async () => {
    const { context, writes } = contextWithDraft()
    await addDraftAttachmentsHandler(context, {
      draftId: 'draft_1',
      paths: ['/Users/developer/Pure/report.pdf'],
    })
    const payload = parse(
      await addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/report.pdf', '/Users/developer/Pure/photo.png'],
      }),
    )
    expect(payload.added.map((item: { name: string }) => item.name)).toEqual(['photo.png'])
    expect(payload.skipped[0].name).toBe('report.pdf')
    expect(payload.skipped[0].reason).toMatch(/not added twice/)
    expect(context.store.drafts[0]!.attachments).toHaveLength(2)

    const again = parse(
      await addDraftAttachmentsHandler(context, {
        draftId: 'draft_1',
        paths: ['/Users/developer/Pure/report.pdf'],
      }),
    )
    expect(again.added).toEqual([])
    expect(again.note).toMatch(/nothing changed/i)
    // Two real writes; the all-duplicate call wrote nothing.
    expect(writes).toHaveLength(2)
  })

  it('removes by id, by unique name, and refuses ambiguity', async () => {
    const { context, writes } = contextWithDraft()
    await addDraftAttachmentsHandler(context, {
      draftId: 'draft_1',
      paths: ['/Users/developer/Pure/report.pdf', '/Users/developer/Pure/photo.png'],
    })
    const [pdf] = context.store.drafts[0]!.attachments
    const byId = parse(
      removeDraftAttachmentHandler(context, {
        draftId: 'draft_1',
        attachmentId: pdf!.id,
      }),
    )
    expect(byId.removed.name).toBe('report.pdf')
    expect(byId.remaining.map((item: { name: string }) => item.name)).toEqual(['photo.png'])
    expect(writes.at(-1)!.summary).toMatch(/Removed "report.pdf"/)

    const byName = parse(
      removeDraftAttachmentHandler(context, { draftId: 'draft_1', name: 'photo.png' }),
    )
    expect(byName.remaining).toEqual([])
    expect(byName.total).toBe('0 B')

    expect(() =>
      removeDraftAttachmentHandler(context, { draftId: 'draft_1', name: 'photo.png' }),
    ).toThrow(/no attachments/)
    expect(() =>
      removeDraftAttachmentHandler(context, { draftId: 'draft_1' }),
    ).toThrow(/attachmentId/)

    context.store = {
      ...context.store,
      drafts: context.store.drafts.map(draft => ({
        ...draft,
        attachments: [
          { id: 'a1', name: 'dup.pdf', mimeType: 'application/pdf', sizeLabel: '1 KB', size: 1024 },
          { id: 'a2', name: 'dup.pdf', mimeType: 'application/pdf', sizeLabel: '2 KB', size: 2048 },
        ],
      })),
    }
    expect(() =>
      removeDraftAttachmentHandler(context, { draftId: 'draft_1', name: 'dup.pdf' }),
    ).toThrow(/2 attachments are named "dup.pdf"; pass attachmentId/)
    expect(() =>
      removeDraftAttachmentHandler(context, { draftId: 'draft_1', attachmentId: 'zzz' }),
    ).toThrow(/It has: "dup.pdf" \(a1\)/)
  })

  it('is unavailable without the shell hooks', async () => {
    const context = makeContext()
    await expect(
      addDraftAttachmentsHandler(context, { draftId: 'x', paths: ['/a'] }),
    ).rejects.toThrow(/unavailable/)
    expect(() =>
      removeDraftAttachmentHandler(context, { draftId: 'x', attachmentId: 'y' }),
    ).toThrow(/unavailable/)
  })
})

describe('drawer prepare and commit protocol', () => {
  it('completes through tools without nesting inference and rejects stale edits', async () => {
    const { MailDrawerDrafts } = await import('../lib/mailDrawerDrafts')
    const { commitReplyDraftHandler } = await import('./handlers')
    const context = makeContext()
    context.store.drafts = []
    const requests = new MailDrawerDrafts()
    context.requestDraftForThread = async (threadId, brief) => requests.prepare(context.store, context.accountId, threadId, brief)
    context.commitReplyDraft = (requestId, body) => {
      const result = requests.commit(context.store, context.accountId, requestId, body)
      context.store = result.store
      return result.receipt
    }
    const prepared = parse(await draftReplyHandler(context, { threadId: context.store.threads[0].id }))
    expect(context.store.drafts).toEqual([])
    const committed = parse(commitReplyDraftHandler(context, { requestId: prepared.requestId, body: 'Hello,\n\nI will check and reply tomorrow.' }))
    const readback = parse(getDraftHandler(context, { draftId: committed.draftId }))
    expect(readback.body).toContain('I will check')
    expect(readback.state).toBe('not_sent')
    const edited: string[] = []
    context.editDraft = () => { edited.push('called'); return { ok: true } }
    context.store.drafts[0].body = 'A newer user edit'
    expect(() => updateDraftHandler(context, { draftId: committed.draftId, expectedVersion: readback.version, body: 'Stale response' })).toThrow('draft changed')
    expect(edited).toEqual([])
    expect(() => commitReplyDraftHandler(context, { requestId: prepared.requestId, body: 'Duplicate' })).toThrow('already committed')
  })
})

describe('markThreadsRead', () => {
  const setup = () => {
    const calls: Array<{ threadIds: string[]; read: boolean }> = []
    const context = makeContext({
      setThreadsRead: (threadIds, read) => calls.push({ threadIds, read }),
    })
    const unread = context.store.threads.find(thread =>
      context.store.messages.some(message => message.threadId === thread.id && !message.read),
    )!
    const read = context.store.threads.find(thread =>
      context.store.messages.filter(message => message.threadId === thread.id).every(message => message.read),
    )!
    return { calls, context, unread, read }
  }

  it('marks named threads unread through the triage path, skipping ones already unread', () => {
    const { calls, context, unread, read } = setup()
    const result = parse(
      markThreadsReadHandler(context, { threadIds: [read.id, unread.id], read: false }),
    )
    expect(calls).toEqual([{ threadIds: [read.id], read: false }])
    expect(result.changed).toEqual([{ id: read.id, subject: read.subject }])
    expect(result.alreadyThere).toEqual([{ id: unread.id, subject: unread.subject }])
  })

  it('accepts a single threadId and marks it read', () => {
    const { calls, context, unread } = setup()
    markThreadsReadHandler(context, { threadId: unread.id, read: true })
    expect(calls).toEqual([{ threadIds: [unread.id], read: true }])
  })

  it('refuses unknown threads and a missing read flag before changing anything', () => {
    const { calls, context, unread } = setup()
    expect(() => markThreadsReadHandler(context, { threadIds: ['nope'], read: false })).toThrow(/"nope"/)
    expect(() => markThreadsReadHandler(context, { threadIds: [unread.id] })).toThrow(/"read" is required/)
    expect(() => markThreadsReadHandler(context, { read: false })).toThrow(/"threadIds" is required/)
    expect(calls).toEqual([])
  })
})
