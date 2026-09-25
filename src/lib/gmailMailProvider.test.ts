import { describe, expect, it, vi } from 'vitest'
import { formatAddressList, GmailMailProvider } from './gmailMailProvider'
import {
  mergeMailProviderSyncResult,
  reapplyLocalMailChangesSinceSnapshot,
  threadIsInsideFetchWindow,
} from './mailModel'

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  )
  return atob(padded)
}

function gmailThread(id = 'thread-1') {
  return {
    id,
    messages: [
      {
        id: 'msg-1',
        threadId: id,
        labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
        internalDate: String(Date.parse('2026-06-20T16:12:00.000Z')),
        snippet: 'Can you approve the launch copy today?',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Mira <mira@example.com>' },
            { name: 'To', value: 'User <alex@example.com>' },
            { name: 'Subject', value: 'Launch copy and rollout notes' },
            { name: 'Message-ID', value: '<msg-1@mail.example.com>' },
          ],
          body: { data: base64Url('Can you approve the launch copy today?') },
        },
      },
    ],
  }
}

function gmailThreadWithSubject(id: string, subject: string) {
  return {
    id,
    messages: [
      {
        id: `${id}-msg-1`,
        threadId: id,
        labelIds: ['INBOX'],
        internalDate: String(Date.parse('2026-06-20T16:12:00.000Z')),
        snippet: subject,
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: `${subject} <${id}@example.com>` },
            { name: 'To', value: 'User <alex@example.com>' },
            { name: 'Subject', value: subject },
          ],
          body: { data: base64Url(subject) },
        },
      },
    ],
  }
}

function gmailHtmlThread(id = 'thread-1') {
  return {
    id,
    messages: [
      {
        id: 'msg-1',
        threadId: id,
        labelIds: ['INBOX'],
        internalDate: String(Date.parse('2026-06-20T16:12:00.000Z')),
        snippet: 'HTML reservation message',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: 'Reserve <noreply@example.com>' },
            { name: 'To', value: 'User <alex@example.com>' },
            { name: 'Subject', value: 'Reservation details' },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              body: {
                data: base64Url(
                  '<details><summary>noise</summary>Raw fallback</details>',
                ),
              },
            },
            {
              mimeType: 'text/html',
              body: {
                data: base64Url(
                  '<p><strong>Reservation confirmed</strong></p><p>Arrive July 5.</p>',
                ),
              },
            },
          ],
        },
      },
    ],
  }
}

function gmailAttachmentThread(id = 'thread-1') {
  return {
    id,
    messages: [
      {
        id: 'msg-1',
        threadId: id,
        labelIds: ['INBOX'],
        internalDate: String(Date.parse('2026-06-20T16:12:00.000Z')),
        snippet: 'Attachment message',
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: 'Calendar <calendar@example.com>' },
            { name: 'To', value: 'User <alex@example.com>' },
            { name: 'Subject', value: 'Planning invite' },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: base64Url('See attached invite.') },
            },
            {
              mimeType: 'text/calendar',
              filename: 'planning.ics',
              body: {
                attachmentId: 'att-calendar',
                size: 128,
              },
            },
            {
              mimeType: 'application/pdf',
              filename: 'brief.pdf',
              body: {
                attachmentId: 'att-pdf',
                size: 2048,
              },
            },
          ],
        },
      },
    ],
  }
}

function createProvider(thread: unknown = gmailThread()) {
  const requests: Array<{ url: string; method?: string; body?: string }> = []
  const fetch = vi.fn(async request => {
    requests.push(request)
    const url = new URL(request.url)
    if (url.pathname.endsWith('/profile')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ emailAddress: 'alex@example.com' }),
      }
    }
    if (url.pathname.endsWith('/threads') && url.searchParams.has('q')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ threads: [{ id: 'thread-1' }] }),
      }
    }
    if (url.pathname.endsWith('/threads')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ threads: [{ id: 'thread-1' }] }),
      }
    }
    if (url.pathname.endsWith('/threads/thread-1')) {
      return { ok: true, status: 200, body: JSON.stringify(thread) }
    }
    if (url.pathname.endsWith('/messages/msg-1/attachments/att-calendar')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          data: base64Url('BEGIN:VCALENDAR\nSUMMARY:Planning\nEND:VCALENDAR'),
          size: 128,
        }),
      }
    }
    if (url.pathname.endsWith('/messages/msg-1/attachments/att-pdf')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          data: base64Url('%PDF-1.7 fake'),
          size: 2048,
        }),
      }
    }
    if (url.pathname.endsWith('/labels') && request.method === 'POST') {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'Label_new',
          name: JSON.parse(request.body ?? '{}').name,
        }),
      }
    }
    if (url.pathname.endsWith('/labels')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          labels: [
            { id: 'INBOX', name: 'INBOX', type: 'system' },
            {
              id: 'Label_7',
              name: 'Receipts',
              type: 'user',
              color: { backgroundColor: '#16a765' },
              messagesTotal: 12,
            },
            {
              id: 'Label_8',
              name: 'Hidden',
              type: 'user',
              labelListVisibility: 'labelHide',
            },
            { id: 'Label_bad', type: 'user' },
          ],
        }),
      }
    }
    if (url.pathname.endsWith('/drafts') && request.method === 'POST') {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'gmail-draft-1' }),
      }
    }
    if (url.pathname.endsWith('/drafts/gmail-draft-1')) {
      return { ok: true, status: 200, body: '{}' }
    }
    if (url.pathname.endsWith('/threads/thread-1/modify')) {
      return { ok: true, status: 200, body: '{}' }
    }
    if (url.pathname.endsWith('/threads/thread-1/trash')) {
      return { ok: true, status: 200, body: '{}' }
    }
    if (url.pathname.endsWith('/messages/send')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'sent-1', threadId: 'thread-1' }),
      }
    }
    throw new Error(`Unexpected Gmail request: ${request.url}`)
  })
  return {
    provider: new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
    }),
    requests,
  }
}

describe('GmailMailProvider', () => {
  it('declares only implemented capabilities', () => {
    const { provider } = createProvider()
    expect(provider.capabilities).toEqual({
      compose: true,
      drafts: true,
      labels: true,
      // Not implemented yet — flip only when the provider honours bulk
      // mutation remotely.
      bulkActions: false,
    })
  })


  it('follows Gmail inbox pagination instead of only loading the first page', async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = []
    const threadMap = new Map([
      ['thread-1', gmailThreadWithSubject('thread-1', 'First page thread')],
      ['thread-2', gmailThreadWithSubject('thread-2', 'Second page thread')],
    ])
    const fetch = vi.fn(async request => {
      requests.push(request)
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        const pageToken = url.searchParams.get('pageToken')
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(
            pageToken === 'page-2'
              ? { threads: [{ id: 'thread-2' }] }
              : {
                  threads: [{ id: 'thread-1' }],
                  nextPageToken: 'page-2',
                },
          ),
        }
      }
      const threadId = url.pathname.split('/').pop() ?? ''
      const thread = threadMap.get(threadId)
      if (thread) {
        return { ok: true, status: 200, body: JSON.stringify(thread) }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
    })

    const store = await provider.fetchStore()

    expect(store.threads.map(thread => thread.gmailThreadId)).toEqual([
      'thread-1',
      'thread-2',
    ])
    expect(
      requests.some(request => request.url.includes('pageToken=page-2')),
    ).toBe(true)
  })

  it('preserves Gmail html bodies for clean message rendering', async () => {
    const { provider } = createProvider(gmailHtmlThread())
    const store = await provider.fetchStore()

    expect(store.messages[0]).toMatchObject({
      body: '<details><summary>noise</summary>Raw fallback</details>',
      bodyHtml:
        '<p><strong>Reservation confirmed</strong></p><p>Arrive July 5.</p>',
    })
  })

  it('uses Gmail endpoints for archive, unarchive, unread, trash, search, and send', async () => {
    const { provider, requests } = createProvider()
    const store = await provider.fetchStore()
    const draft = {
      id: 'draft-1',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      cc: [{ name: 'Copy Person', email: 'copy@example.com' }],
      bcc: [{ name: 'Blind Person', email: 'blind@example.com' }],
      subject: 'Re: Launch copy and rollout notes',
      body: 'Approved.',
      attachments: [],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    await provider.archiveThread(store.threads[0]!.id)
    await provider.unarchiveThread(store.threads[0]!.id)
    await provider.markThreadRead(store.threads[0]!.id, false)
    await provider.deleteThread(store.threads[0]!.id)
    await provider.search('launch')
    const sent = await provider.send({ draft, threadId: draft.threadId })

    expect(sent.gmailMessageId).toBe('sent-1')
    expect(
      requests.some(
        request =>
          request.url.endsWith('/threads/thread-1/modify') &&
          request.body?.includes('removeLabelIds'),
      ),
    ).toBe(true)
    expect(
      requests.some(
        request =>
          request.url.endsWith('/threads/thread-1/modify') &&
          request.body?.includes('addLabelIds'),
      ),
    ).toBe(true)
    expect(
      requests.some(request => request.url.endsWith('/threads/thread-1/trash')),
    ).toBe(true)
    expect(
      requests.some(request => request.url.includes('/threads?q=launch')),
    ).toBe(true)
    expect(
      requests.some(request => request.url.endsWith('/messages/send')),
    ).toBe(true)
    const sendRequest = requests.find(request =>
      request.url.endsWith('/messages/send'),
    )
    const raw = JSON.parse(sendRequest?.body ?? '{}').raw
    const decoded = decodeBase64Url(raw)
    expect(decoded).toContain('Cc: Copy Person <copy@example.com>')
    expect(decoded).toContain('Bcc: Blind Person <blind@example.com>')
    expect(decoded).toContain('In-Reply-To: <msg-1@mail.example.com>')
    expect(decoded).toContain('References: <msg-1@mail.example.com>')
  })

  it('stars and unstars threads through the Gmail STARRED label', async () => {
    const { provider, requests } = createProvider()
    const fetched = await provider.fetchStore()
    expect(fetched.starredThreadIds).toEqual([])

    await provider.setThreadStarred('gmail_thread_thread-1', true)
    await provider.setThreadStarred('gmail_thread_thread-1', false)

    const starRequests = requests.filter(
      request =>
        request.url.endsWith('/threads/thread-1/modify') &&
        request.body?.includes('STARRED'),
    )
    expect(starRequests).toHaveLength(2)
    expect(starRequests[0]?.body).toBe(
      JSON.stringify({ addLabelIds: ['STARRED'] }),
    )
    expect(starRequests[1]?.body).toBe(
      JSON.stringify({ removeLabelIds: ['STARRED'] }),
    )
  })

  it('round-trips Gmail STARRED into starredThreadIds and through merge', async () => {
    const thread = gmailThread()
    thread.messages[0]!.labelIds.push('STARRED')
    const { provider } = createProvider(thread)
    const fetched = await provider.fetchStore()
    expect(fetched.starredThreadIds).toEqual(['gmail_thread_thread-1'])

    // The provider's report wins for threads the fetch covered; local-only
    // stars on uncovered threads survive the merge (issue #153 class).
    const local = {
      ...fetched,
      starredThreadIds: ['thread_local_only'],
    }
    const merged = mergeMailProviderSyncResult(local, fetched)
    expect(merged.starredThreadIds).toEqual([
      'gmail_thread_thread-1',
      'thread_local_only',
    ])
  })

  it('carries filters, saved views, local labels, seen markers, and thread run markers through merge (issue #153 class)', async () => {
    const thread = gmailThread()
    const { provider } = createProvider(thread)
    const fetched = await provider.fetchStore()
    const filterRule = {
      id: 'filter-1',
      name: 'Newsletters',
      query: 'from:news@example.com',
      actions: { labelName: 'Newsletters', skipInbox: true },
      enabled: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      hitCount: 3,
    }
    const localLabel = {
      id: 'local-label-1',
      name: 'Newsletters',
      color: '#8a8f98',
    }
    const localBox = {
      id: 'box-1',
      accountId: fetched.accounts[0]!.id,
      name: 'Newsletters',
      role: 'custom' as const,
      unreadCount: 0,
    }
    const savedView = {
      id: 'view-1',
      name: 'Newsletters',
      query: 'label:Newsletters',
      createdAt: '2026-06-01T00:00:00.000Z',
    }
    const local = {
      ...fetched,
      filters: [filterRule],
      savedViews: [savedView],
      querySeenAt: { 'label:newsletters': '2026-06-20T00:00:00.000Z' },
      labels: [...fetched.labels, localLabel],
      mailboxes: [...fetched.mailboxes, localBox],
      threads: fetched.threads.map(t => ({
        ...t,
        filterRunAt: '2026-06-20T00:00:00.000Z',
        filteredBy: ['filter-1'],
      })),
    }
    const merged = mergeMailProviderSyncResult(local, fetched)
    expect(merged.filters).toEqual([filterRule])
    expect(merged.savedViews).toEqual([savedView])
    expect(merged.querySeenAt).toEqual({
      'label:newsletters': '2026-06-20T00:00:00.000Z',
    })
    expect(merged.labels).toContainEqual(localLabel)
    expect(merged.mailboxes).toContainEqual(localBox)
    const refreshed = merged.threads.find(t => t.id === fetched.threads[0]!.id)
    expect(refreshed?.filterRunAt).toBe('2026-06-20T00:00:00.000Z')
    expect(refreshed?.filteredBy).toEqual(['filter-1'])
  })

  it('sends bodyHtml as a multipart/alternative raw payload', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    await provider.send({
      draft: {
        id: 'draft-html',
        threadId: 'gmail_thread_thread-1',
        to: [{ name: 'Mira', email: 'mira@example.com' }],
        subject: 'Rich',
        body: 'Plain fallback.',
        bodyHtml: '<p>Rich <b>body</b>.</p>',
        attachments: [],
        updatedAt: '2026-06-20T16:20:00.000Z',
        syncState: 'pending' as const,
        draftKind: 'manual' as const,
      },
      threadId: 'gmail_thread_thread-1',
    })
    const sendRequest = requests.find(request =>
      request.url.endsWith('/messages/send'),
    )
    const decoded = decodeBase64Url(JSON.parse(sendRequest?.body ?? '{}').raw)
    expect(decoded).toContain('multipart/alternative')
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8')
    expect(decoded).toContain('Content-Type: text/html; charset=utf-8')
    expect(decoded).toContain('Plain fallback.')
    expect(decoded).toContain('<p>Rich <b>body</b>.</p>')
  })

  it('creates, updates, and deletes Gmail drafts through the drafts API', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    const draft = {
      id: 'draft-remote',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Draft subject',
      body: 'Draft body.',
      attachments: [],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    const providerDraftId = await provider.createDraft(draft)
    expect(providerDraftId).toBe('gmail-draft-1')
    const createRequest = requests.find(
      request =>
        request.url.endsWith('/drafts') && request.method === 'POST',
    )
    const createPayload = JSON.parse(createRequest?.body ?? '{}')
    expect(createPayload.message.threadId).toBe('thread-1')
    const createdRaw = decodeBase64Url(createPayload.message.raw)
    expect(createdRaw).toContain('To: Mira <mira@example.com>')
    expect(createdRaw).toContain('Subject: Draft subject')
    expect(createdRaw).toContain('Draft body.')

    await provider.updateDraft(providerDraftId, {
      ...draft,
      body: 'Updated body.',
    })
    const updateRequest = requests.find(
      request =>
        request.url.endsWith('/drafts/gmail-draft-1') &&
        request.method === 'PUT',
    )
    expect(updateRequest).toBeTruthy()
    expect(
      decodeBase64Url(JSON.parse(updateRequest?.body ?? '{}').message.raw),
    ).toContain('Updated body.')

    await provider.deleteDraft(providerDraftId)
    expect(
      requests.some(
        request =>
          request.url.endsWith('/drafts/gmail-draft-1') &&
          request.method === 'DELETE',
      ),
    ).toBe(true)
  })

  it('carries content attachments in the draft raw it saves to Gmail', async () => {
    // What useDraftProviderSync pushes after addDraftAttachments: the draft
    // record with a data-URI attachment. The Gmail draft must hold the
    // bytes, or the agent's attachment exists only on this machine.
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    const draft = {
      id: 'draft-with-file',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'With the report',
      body: 'Attached.',
      attachments: [
        {
          id: 'att_1',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '8 B',
          size: 8,
          content: 'data:application/pdf;base64,JVBERi0xLjQ=',
        },
      ],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }
    const providerDraftId = await provider.createDraft(draft)
    const createRequest = requests.find(
      request => request.url.endsWith('/drafts') && request.method === 'POST',
    )
    const createdRaw = decodeBase64Url(
      JSON.parse(createRequest?.body ?? '{}').message.raw,
    )
    expect(createdRaw).toContain('multipart/mixed')
    expect(createdRaw).toContain('Content-Type: application/pdf')
    expect(createdRaw).toContain('filename="report.pdf"')
    expect(createdRaw).toContain('JVBERi0xLjQ=')

    // Removing it and re-syncing rewrites the draft without the part.
    await provider.updateDraft(providerDraftId, { ...draft, attachments: [] })
    const updateRequest = requests.find(
      request =>
        request.url.endsWith(`/drafts/${providerDraftId}`) &&
        request.method === 'PUT',
    )
    const updatedRaw = decodeBase64Url(
      JSON.parse(updateRequest?.body ?? '{}').message.raw,
    )
    expect(updatedRaw).not.toContain('report.pdf')
    expect(updatedRaw).not.toContain('multipart/mixed')
  })

  it('caches Gmail labels defensively and maps them onto the store', async () => {
    const thread = gmailThread()
    thread.messages[0]!.labelIds.push('Label_7')
    const { provider } = createProvider(thread)
    const store = await provider.fetchStore()

    // Hidden and malformed labels are skipped; system labels stay out of
    // the app-facing label list but user labels flow into both surfaces.
    expect(store.providerLabels?.map(label => label.id)).toEqual([
      'INBOX',
      'Label_7',
    ])
    expect(store.labels).toEqual([
      { id: 'Label_7', name: 'Receipts', color: '#16a765' },
    ])
    expect(store.threads[0]?.labels).toContain('Receipts')

    // The provider label metadata cache survives the sync merge.
    const merged = mergeMailProviderSyncResult(store, store)
    expect(merged.providerLabels?.map(label => label.id)).toEqual([
      'INBOX',
      'Label_7',
    ])
  })

  it('applies and removes provider labels through threads.modify', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()

    await provider.labelThread('gmail_thread_thread-1', 'Label_7')
    const apply = requests.find(
      request =>
        request.url.endsWith('/threads/thread-1/modify') &&
        request.body?.includes('Label_7'),
    )
    expect(apply?.body).toBe(JSON.stringify({ addLabelIds: ['Label_7'] }))

    await provider.unlabelThread('gmail_thread_thread-1', 'Label_7')
    const remove = requests.filter(
      request =>
        request.url.endsWith('/threads/thread-1/modify') &&
        request.body?.includes('Label_7'),
    )
    expect(remove[1]?.body).toBe(
      JSON.stringify({ removeLabelIds: ['Label_7'] }),
    )

    // App-local labels never hit the Gmail API.
    await provider.labelThread('gmail_thread_thread-1', 'label_review')
    expect(
      requests.some(request => request.body?.includes('label_review')),
    ).toBe(false)
  })

  it('creates labels through the labels API and caches the result', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    const created = await provider.createLabel('Invoices')
    expect(created).toMatchObject({ id: 'Label_new', name: 'Invoices' })
    const createRequest = requests.find(
      request =>
        request.url.endsWith('/labels') && request.method === 'POST',
    )
    expect(JSON.parse(createRequest?.body ?? '{}')).toMatchObject({
      name: 'Invoices',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    })
  })

  it('passes operator queries through to Gmail search verbatim', async () => {
    const { provider, requests } = createProvider()
    await provider.search('from:mira has:attachment "launch copy"')
    const searchRequest = requests.find(request =>
      request.url.includes('/threads?q='),
    )
    const query = new URL(searchRequest?.url ?? '').searchParams.get('q')
    expect(query).toBe('from:mira has:attachment "launch copy"')
  })

  it('captures List-Unsubscribe headers on parsed messages', async () => {
    const thread = gmailThread()
    thread.messages[0]!.payload.headers.push({
      name: 'List-Unsubscribe',
      value: '<mailto:unsub@list.example>, <https://list.example/u/1>',
    })
    const { provider } = createProvider(thread)
    const store = await provider.fetchStore()
    expect(store.messages[0]?.listUnsubscribe).toBe(
      '<mailto:unsub@list.example>, <https://list.example/u/1>',
    )
  })

  it('keeps a sync alive when individual thread fetches fail', async () => {
    const fetch = vi.fn(async (request: { url: string }) => {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            threads: [{ id: 'thread-ok' }, { id: 'thread-bad' }],
          }),
        }
      }
      if (url.pathname.endsWith('/threads/thread-ok')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(gmailThreadWithSubject('thread-ok', 'Kept')),
        }
      }
      if (url.pathname.endsWith('/threads/thread-bad')) {
        return { ok: false, status: 500, body: 'boom' }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
      // The 500 is retried by policy; skip real backoff waits in tests.
      retryOptions: { sleep: async () => {} },
    })

    const store = await provider.fetchStore()

    expect(store.threads.map(thread => thread.gmailThreadId)).toEqual([
      'thread-ok',
    ])
    expect(store.syncCoverage).toMatchObject({
      failedCount: 1,
      failedThreadIds: ['gmail_thread_thread-bad'],
    })
  })

  it('fails the sync outright when every thread fetch fails', async () => {
    const fetch = vi.fn(async (request: { url: string }) => {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ threads: [{ id: 'thread-1' }] }),
        }
      }
      return { ok: false, status: 401, body: 'expired' }
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
      retryOptions: { sleep: async () => {} },
    })

    await expect(provider.fetchStore()).rejects.toThrow('Gmail API error')
  })

  it('records a coverage horizon when the thread listing is truncated at the cap', async () => {
    const threadCount = 250
    const oldestDate = Date.parse('2026-06-01T08:00:00.000Z')
    const fetch = vi.fn(async (request: { url: string }) => {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            threads: Array.from({ length: threadCount }, (_, index) => ({
              id: `thread-${index}`,
            })),
            nextPageToken: 'more-threads-exist',
          }),
        }
      }
      const threadId = url.pathname.split('/').pop()?.split('?')[0] ?? ''
      const index = Number(threadId.replace('thread-', ''))
      if (Number.isFinite(index)) {
        const thread = gmailThreadWithSubject(threadId, `Thread ${index}`)
        thread.messages[0].internalDate = String(
          oldestDate + index * 60_000,
        )
        return { ok: true, status: 200, body: JSON.stringify(thread) }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
    })

    const store = await provider.fetchStore()

    expect(store.threads).toHaveLength(threadCount)
    // The cap cut the listing off, so coverage only reaches back to the
    // oldest thread actually fetched.
    expect(store.syncCoverage?.coveredFrom).toBe(
      new Date(oldestDate).toISOString(),
    )
  })

  it('fetches sent and trash threads into their own mailboxes', async () => {
    const threadDetails = new Map([
      [
        't-inbox',
        {
          id: 't-inbox',
          messages: [
            {
              id: 't-inbox-msg',
              threadId: 't-inbox',
              labelIds: ['INBOX', 'UNREAD'],
              internalDate: String(Date.parse('2026-06-20T16:12:00.000Z')),
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Mira <mira@example.com>' },
                  { name: 'To', value: 'User <alex@example.com>' },
                  { name: 'Subject', value: 'Inbox thread' },
                ],
                body: { data: base64Url('Can you review this?') },
              },
            },
          ],
        },
      ],
      [
        't-sent',
        {
          id: 't-sent',
          messages: [
            {
              id: 't-sent-msg',
              threadId: 't-sent',
              labelIds: ['SENT'],
              internalDate: String(Date.parse('2026-06-20T15:00:00.000Z')),
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Sam <sam@example.com>' },
                  { name: 'To', value: 'User <alex@example.com>' },
                  { name: 'Subject', value: 'Sent thread' },
                ],
                body: { data: base64Url('Can you send the notes?') },
              },
            },
          ],
        },
      ],
      [
        't-trash',
        {
          id: 't-trash',
          messages: [
            {
              id: 't-trash-msg',
              threadId: 't-trash',
              labelIds: ['TRASH'],
              internalDate: String(Date.parse('2026-06-20T14:00:00.000Z')),
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Spam <spam@example.com>' },
                  { name: 'To', value: 'User <alex@example.com>' },
                  { name: 'Subject', value: 'Trash thread' },
                ],
                body: { data: base64Url('Deleted mail.') },
              },
            },
          ],
        },
      ],
    ])
    const requests: Array<{ url: string }> = []
    const fetch = vi.fn(async request => {
      requests.push(request)
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        const label = url.searchParams.get('labelIds')
        const id =
          label === 'INBOX'
            ? 't-inbox'
            : label === 'SENT'
            ? 't-sent'
            : 't-trash'
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ threads: [{ id }] }),
        }
      }
      const threadId = url.pathname.split('/').pop() ?? ''
      const detail = threadDetails.get(threadId)
      if (detail) {
        return { ok: true, status: 200, body: JSON.stringify(detail) }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
    })

    const store = await provider.fetchStore()
    const byId = new Map(store.threads.map(thread => [thread.gmailThreadId, thread]))

    expect(byId.get('t-inbox')).toMatchObject({
      mailboxId: 'gmail_inbox',
      status: 'inbox',
      labels: ['Needs reply'],
    })
    expect(byId.get('t-sent')).toMatchObject({
      mailboxId: 'gmail_sent',
      status: 'waiting',
      // M3: placeholder 'Gmail' chip replaced by real provider labels.
      labels: [],
    })
    expect(byId.get('t-trash')).toMatchObject({
      mailboxId: 'gmail_trash',
      status: 'archived',
      // M3: placeholder 'Gmail' chip replaced by real provider labels.
      labels: [],
    })
    expect(
      requests.some(
        request =>
          request.url.includes('labelIds=TRASH') &&
          request.url.includes('includeSpamTrash=true'),
      ),
    ).toBe(true)
  })



  it('downloads remote Gmail attachment content on demand', async () => {
    const { provider, requests } = createProvider(gmailAttachmentThread())
    const store = await provider.fetchStore()
    const message = store.messages[0]!
    const calendar = message.attachments.find(
      attachment => attachment.name === 'planning.ics',
    )!
    const pdf = message.attachments.find(
      attachment => attachment.name === 'brief.pdf',
    )!

    expect(calendar.content).toBeUndefined()
    expect(calendar.remote).toMatchObject({
      provider: 'gmail',
      messageId: 'msg-1',
      attachmentId: 'att-calendar',
    })

    const downloadedCalendar = await provider.getAttachmentContent!(
      message,
      calendar,
    )
    const downloadedPdf = await provider.getAttachmentContent!(message, pdf)

    expect(downloadedCalendar.content).toContain('BEGIN:VCALENDAR')
    expect(downloadedCalendar.sizeLabel).toBe('1 KB')
    expect(downloadedPdf.content).toMatch(/^data:application\/pdf;base64,/)
    expect(downloadedPdf.sizeLabel).toBe('2 KB')
    expect(
      requests.some(request =>
        request.url.endsWith('/messages/msg-1/attachments/att-calendar'),
      ),
    ).toBe(true)
  })

  it('records exact attachment byte sizes from Gmail metadata', async () => {
    const { provider } = createProvider(gmailAttachmentThread())
    const store = await provider.fetchStore()
    const sizes = store.messages[0]!.attachments.map(
      attachment => attachment.size,
    )
    expect(sizes).toEqual([128, 2048])
  })

  it('sends locally attached files as multipart/mixed with base64 parts', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    const pdfBytes = Uint8Array.from({ length: 96 }, (_, index) => index)
    const pdfBase64 = btoa(String.fromCharCode(...pdfBytes))
    const draft = {
      id: 'draft-1',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Files attached',
      body: 'Both files attached.',
      attachments: [
        {
          id: 'att-local-1',
          name: 'summary.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '1 KB',
          content: `data:application/pdf;base64,${pdfBase64}`,
        },
        {
          id: 'att-local-2',
          name: 'notes.ics',
          mimeType: 'text/calendar',
          sizeLabel: '1 KB',
          content: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
        },
      ],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    await provider.send({ draft, threadId: draft.threadId })

    const sendRequest = requests.find(request =>
      request.url.endsWith('/messages/send'),
    )
    const decoded = decodeBase64Url(JSON.parse(sendRequest?.body ?? '{}').raw)
    const boundaryMatch = decoded.match(
      /Content-Type: multipart\/mixed; boundary="([^"]+)"/,
    )
    expect(boundaryMatch).not.toBeNull()
    const boundary = boundaryMatch![1]
    expect(decoded).toContain('MIME-Version: 1.0')
    expect(decoded).toContain('Both files attached.')
    expect(decoded).toContain(
      'Content-Disposition: attachment; filename="summary.pdf"',
    )
    expect(decoded).toContain(
      'Content-Disposition: attachment; filename="notes.ics"',
    )
    expect(decoded).toContain(`--${boundary}--`)
    // The PDF part decodes back to the exact original bytes.
    const parts = decoded.split(`--${boundary}`)
    const pdfPart = parts.find(part => part.includes('summary.pdf'))!
    const pdfPayload = pdfPart.split('\r\n\r\n')[1]!.replace(/\s+/g, '')
    expect(atob(pdfPayload)).toBe(String.fromCharCode(...pdfBytes))
    // The calendar part carries the text content base64-encoded.
    const icsPart = parts.find(part => part.includes('notes.ics'))!
    const icsPayload = icsPart.split('\r\n\r\n')[1]!.replace(/\s+/g, '')
    expect(atob(icsPayload)).toBe('BEGIN:VCALENDAR\nEND:VCALENDAR')
  })

  it('fetches remote-only attachment content before sending', async () => {
    const { provider, requests } = createProvider(gmailAttachmentThread())
    await provider.fetchStore()
    const draft = {
      id: 'draft-1',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Forwarding the brief',
      body: 'Forwarded.',
      attachments: [
        {
          id: 'att-remote-1',
          name: 'brief.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '2 KB',
          remote: {
            provider: 'gmail' as const,
            messageId: 'msg-1',
            attachmentId: 'att-pdf',
          },
        },
      ],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    await provider.send({ draft, threadId: draft.threadId })

    expect(
      requests.some(request =>
        request.url.endsWith('/messages/msg-1/attachments/att-pdf'),
      ),
    ).toBe(true)
    const sendRequest = requests.find(request =>
      request.url.endsWith('/messages/send'),
    )
    const decoded = decodeBase64Url(JSON.parse(sendRequest?.body ?? '{}').raw)
    expect(decoded).toContain(
      'Content-Disposition: attachment; filename="brief.pdf"',
    )
    const payload = decoded
      .split('Content-Disposition: attachment; filename="brief.pdf"')[1]!
      .split('\r\n\r\n')[1]!
      .split('\r\n--')[0]!
      .replace(/\s+/g, '')
    expect(atob(payload)).toBe('%PDF-1.7 fake')
  })

  it('refuses to send attachments that exceed the 25 MB Gmail limit', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    const draft = {
      id: 'draft-1',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Too big',
      body: 'Huge file.',
      attachments: [
        {
          id: 'att-huge',
          name: 'huge.bin',
          mimeType: 'application/octet-stream',
          sizeLabel: '26.0 MB',
          size: 26 * 1024 * 1024,
          content: 'data:application/octet-stream;base64,QUJD',
        },
      ],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    await expect(
      provider.send({ draft, threadId: draft.threadId }),
    ).rejects.toThrow(/25 MB/)
    expect(
      requests.some(request => request.url.endsWith('/messages/send')),
    ).toBe(false)
  })

  it('fails loudly when an attachment has no content and no remote ref', async () => {
    const { provider } = createProvider()
    await provider.fetchStore()
    const draft = {
      id: 'draft-1',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Broken attachment',
      body: 'Missing bytes.',
      attachments: [
        {
          id: 'att-empty',
          name: 'ghost.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '1 KB',
        },
      ],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    await expect(
      provider.send({ draft, threadId: draft.threadId }),
    ).rejects.toThrow(/ghost\.pdf/)
  })

  it('keeps attachment-free sends as plain text without multipart framing', async () => {
    const { provider, requests } = createProvider()
    await provider.fetchStore()
    const draft = {
      id: 'draft-1',
      threadId: 'gmail_thread_thread-1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Plain reply',
      body: 'No files here.',
      attachments: [],
      updatedAt: '2026-06-20T16:20:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }

    await provider.send({ draft, threadId: draft.threadId })

    const sendRequest = requests.find(request =>
      request.url.endsWith('/messages/send'),
    )
    const decoded = decodeBase64Url(JSON.parse(sendRequest?.body ?? '{}').raw)
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8')
    expect(decoded).not.toContain('multipart/mixed')
    expect(decoded.endsWith('\r\n\r\nNo files here.')).toBe(true)
  })
})

describe('GmailMailProvider refresh pipeline', () => {
  interface ScriptedRemote {
    inbox: string[]
    details: Record<string, unknown>
    broken: Set<string>
  }

  function scriptedMessage(options: {
    id: string
    threadId: string
    internalDate?: string
    subject?: string
    body?: string
  }) {
    return {
      id: options.id,
      threadId: options.threadId,
      labelIds: ['INBOX', 'UNREAD'],
      ...(options.internalDate !== undefined
        ? { internalDate: options.internalDate }
        : {}),
      snippet: options.body ?? 'body',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Mira <mira@example.com>' },
          { name: 'To', value: 'User <alex@example.com>' },
          { name: 'Subject', value: options.subject ?? 'Subject' },
          { name: 'Date', value: 'Sun, 28 Jun 2026 09:30:00 +0000' },
        ],
        body: { data: base64Url(options.body ?? 'body') },
      },
    }
  }

  function scriptedProvider(remote: ScriptedRemote) {
    const fetch = vi.fn(async (request: { url: string }) => {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        const label = url.searchParams.get('labelIds')
        const ids = label === 'INBOX' ? remote.inbox : []
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ threads: ids.map(id => ({ id })) }),
        }
      }
      const threadId = url.pathname.split('/').pop() ?? ''
      if (remote.broken.has(threadId)) {
        return { ok: false, status: 500, body: 'boom' }
      }
      const detail = remote.details[threadId]
      if (detail) {
        return { ok: true, status: 200, body: JSON.stringify(detail) }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    return new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
      // Broken threads answer 500 and are retried by policy; skip real waits.
      retryOptions: { sleep: async () => {} },
    })
  }

  it('surfaces a new message and a new thread through sync + merge + reapply', async () => {
    // Mirrors PureMailShell.refreshMail exactly: sync, merge into the current
    // store, then re-apply local in-flight changes. New provider mail must
    // survive the whole pipeline and stay visible in the rail's fetch window.
    const remote: ScriptedRemote = {
      inbox: ['thread-1'],
      details: {
        'thread-1': {
          id: 'thread-1',
          messages: [
            scriptedMessage({
              id: 'msg-1',
              threadId: 'thread-1',
              internalDate: String(Date.parse('2026-06-20T10:00:00.000Z')),
              subject: 'Existing thread',
            }),
          ],
        },
      },
      broken: new Set(),
    }
    const provider = scriptedProvider(remote)
    const bootStore = await provider.fetchStore()

    // Remote mailbox changes between fetches: a reply lands on thread-1, a
    // brand-new thread-2 arrives, and thread-3 lists but fails to fetch.
    remote.inbox = ['thread-3', 'thread-2', 'thread-1']
    remote.broken.add('thread-3')
    remote.details['thread-1'] = {
      id: 'thread-1',
      messages: [
        (remote.details['thread-1'] as { messages: unknown[] }).messages[0],
        scriptedMessage({
          id: 'msg-2',
          threadId: 'thread-1',
          internalDate: String(Date.parse('2026-06-28T09:00:00.000Z')),
          subject: 'Re: Existing thread',
          body: 'The new reply',
        }),
      ],
    }
    remote.details['thread-2'] = {
      id: 'thread-2',
      messages: [
        scriptedMessage({
          id: 'msg-3',
          threadId: 'thread-2',
          internalDate: String(Date.parse('2026-06-28T11:00:00.000Z')),
          subject: 'Brand new thread',
        }),
      ],
    }

    const nextStore = await provider.sync(bootStore)
    const merged = reapplyLocalMailChangesSinceSnapshot(
      mergeMailProviderSyncResult(bootStore, nextStore, '2026-06-28T12:00:00.000Z'),
      bootStore,
      bootStore,
    )

    const threadIds = merged.threads.map(thread => thread.id)
    expect(threadIds).toContain('gmail_thread_thread-1')
    expect(threadIds).toContain('gmail_thread_thread-2')
    expect(threadIds.filter(id => id === 'gmail_thread_thread-1')).toHaveLength(1)
    expect(
      merged.threads.find(thread => thread.id === 'gmail_thread_thread-1')
        ?.lastMessageAt,
    ).toBe('2026-06-28T09:00:00.000Z')
    const messageIds = merged.messages.map(message => message.id)
    expect(messageIds).toContain('gmail_msg_msg-2')
    expect(messageIds).toContain('gmail_msg_msg-3')
    // Both threads must remain visible through the rail's fetch-window filter.
    for (const id of ['gmail_thread_thread-1', 'gmail_thread_thread-2']) {
      const thread = merged.threads.find(item => item.id === id)
      expect(
        thread &&
          threadIsInsideFetchWindow(merged, thread, '2026-06-28T12:00:00.000Z'),
      ).toBe(true)
    }
    expect(merged.syncCoverage).toBeUndefined()
  })

  it('keeps a fetched thread visible in the rail when its message lacks internalDate', async () => {
    // Regression: a missing internalDate used to fall back to "now" (thread
    // pinned to the rail top); the epoch-0 replacement makes the thread fall
    // OUTSIDE every fetch window, so mailboxThreads filters it out of the
    // rail entirely — new mail silently disappears. The message carries an
    // RFC 822 Date header, which must be used instead.
    const remote: ScriptedRemote = {
      inbox: ['thread-nodate'],
      details: {
        'thread-nodate': {
          id: 'thread-nodate',
          messages: [
            scriptedMessage({
              id: 'msg-nodate',
              threadId: 'thread-nodate',
              subject: 'No internalDate',
            }),
          ],
        },
      },
      broken: new Set(),
    }
    const provider = scriptedProvider(remote)
    const store = await provider.fetchStore()

    const thread = store.threads.find(
      item => item.id === 'gmail_thread_thread-nodate',
    )
    expect(thread).toBeDefined()
    // Dated from the Date header, not epoch 0 and not "now".
    expect(thread?.lastMessageAt).toBe('2026-06-28T09:30:00.000Z')
    expect(
      thread &&
        threadIsInsideFetchWindow(store, thread, '2026-06-28T12:00:00.000Z'),
    ).toBe(true)
  })
})

describe('GmailMailProvider retry policy', () => {
  const emptyDraft = {
    id: 'draft-1',
    threadId: 'thread_compose_1',
    to: [{ name: 'Mira', email: 'mira@example.com' }],
    subject: 'Hello',
    body: 'Hi there.',
    attachments: [],
    updatedAt: '2026-06-20T16:20:00.000Z',
    syncState: 'pending' as const,
    draftKind: 'manual' as const,
  }

  it('retries a 429 on the list path and resolves once the server recovers', async () => {
    let profileCalls = 0
    const fetch = vi.fn(async (request: { url: string }) => {
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        profileCalls += 1
        if (profileCalls === 1) {
          return {
            ok: false,
            status: 429,
            headers: { 'retry-after': '0' },
            body: 'rate limited',
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ emailAddress: 'alex@example.com' }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        return { ok: true, status: 200, body: JSON.stringify({ threads: [] }) }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
      retryOptions: { sleep: async () => {} },
    })

    const store = await provider.fetchStore()

    expect(store.accounts[0]?.email).toBe('alex@example.com')
    expect(profileCalls).toBe(2)
  })

  it('retries a 401 once with a freshly read access token', async () => {
    const tokens = ['stale-token', 'fresh-token']
    let tokenReads = 0
    const authHeaders: string[] = []
    const fetch = vi.fn(
      async (request: { url: string; headers?: Record<string, string> }) => {
        const url = new URL(request.url)
        const auth = request.headers?.Authorization ?? ''
        if (url.pathname.endsWith('/profile')) {
          authHeaders.push(auth)
          if (auth !== 'Bearer fresh-token') {
            return { ok: false, status: 401, body: 'expired' }
          }
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ emailAddress: 'alex@example.com' }),
          }
        }
        if (url.pathname.endsWith('/threads')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ threads: [] }),
          }
        }
        throw new Error(`Unexpected Gmail request: ${request.url}`)
      },
    )
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => {
        const token = tokens[Math.min(tokenReads, tokens.length - 1)]!
        tokenReads += 1
        return token
      },
      fetch,
      retryOptions: { sleep: async () => {} },
    })

    const store = await provider.fetchStore()

    expect(store.accounts[0]?.email).toBe('alex@example.com')
    // The 401'd call was retried exactly once, with a re-read (fresh) token.
    expect(authHeaders.slice(0, 2)).toEqual([
      'Bearer stale-token',
      'Bearer fresh-token',
    ])
  })

  it('does not retry a send whose fetch throws (possible double-send)', async () => {
    const fetch = vi.fn(async (request: { url: string }) => {
      if (request.url.endsWith('/messages/send')) {
        throw new Error('socket hang up')
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
      retryOptions: { sleep: async () => {} },
    })

    await expect(
      provider.send({ draft: emptyDraft, threadId: emptyDraft.threadId }),
    ).rejects.toThrow('socket hang up')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('still retries a send the server rejected with 429 (nothing was sent)', async () => {
    let sendCalls = 0
    const fetch = vi.fn(async (request: { url: string }) => {
      if (request.url.endsWith('/messages/send')) {
        sendCalls += 1
        if (sendCalls === 1) {
          return { ok: false, status: 429, body: 'rate limited' }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ id: 'sent-1', threadId: 'thread-1' }),
        }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'test-token',
      fetch,
      retryOptions: { sleep: async () => {} },
    })

    const sent = await provider.send({
      draft: emptyDraft,
      threadId: emptyDraft.threadId,
    })

    expect(sent.gmailMessageId).toBe('sent-1')
    expect(sendCalls).toBe(2)
  })
})


describe('formatAddressList', () => {
  it('quotes display names containing commas so the list does not split', () => {
    // Synthetic regression case: commas in display names must be quoted.
    expect(
      formatAddressList([
        { name: 'Example, Casey C', email: 'casey@example.org' },
      ]),
    ).toBe('"Example, Casey C" <casey@example.org>')
  })

  it('quotes names with dots and leaves plain names bare', () => {
    expect(
      formatAddressList([
        { name: 'casey.example', email: 'casey@example.org' },
        { name: 'example person', email: 'alex@example.org' },
      ]),
    ).toBe('"casey.example" <casey@example.org>, example person <alex@example.org>')
  })

  it('escapes quotes and backslashes inside quoted names', () => {
    expect(
      formatAddressList([{ name: 'Jordan "Z" Example', email: 'z@example.org' }]),
    ).toBe('"Jordan \\"Z\\" Example" <z@example.org>')
  })

  it('B-encodes non-ASCII names instead of sending raw bytes', () => {
    const encoded = formatAddressList([
      { name: 'Éxample Üser', email: 'aegir@example.org' },
    ])
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <aegir@example.org>$/)
  })

  it('drops contacts with no usable address rather than emitting "<>"', () => {
    expect(
      formatAddressList([
        { name: 'Ghost', email: '' },
        { name: 'Real', email: 'real@example.org' },
      ]),
    ).toBe('Real <real@example.org>')
  })

  it('uses the bare address when the name repeats it', () => {
    expect(
      formatAddressList([{ name: 'a@example.org', email: 'a@example.org' }]),
    ).toBe('a@example.org')
  })
})

describe('GmailMailProvider drafts', () => {
  function draftMessage(id: string, threadId: string, subject: string) {
    return {
      id,
      threadId,
      labelIds: ['DRAFT'],
      internalDate: String(Date.parse('2026-08-18T10:00:00.000Z')),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'User <alex@example.com>' },
          { name: 'To', value: 'Mira <mira@example.com>' },
          { name: 'Subject', value: subject },
        ],
        body: { data: base64Url('Started this on my phone.') },
      },
    }
  }

  function draftProvider(options: { draftsFail?: boolean } = {}) {
    const requests: Array<{ url: string; method?: string; body?: string }> = []
    const threads = new Map<string, unknown>([
      [
        't-draft-only',
        { id: 't-draft-only', messages: [draftMessage('m-draft', 't-draft-only', 'A note to Mira')] },
      ],
      [
        't-conversation',
        {
          id: 't-conversation',
          messages: [
            {
              id: 'm-inbound',
              threadId: 't-conversation',
              labelIds: ['INBOX'],
              internalDate: String(Date.parse('2026-08-18T09:00:00.000Z')),
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'Mira <mira@example.com>' },
                  { name: 'To', value: 'User <alex@example.com>' },
                  { name: 'Subject', value: 'Launch copy' },
                ],
                body: { data: base64Url('Can you approve?') },
              },
            },
            draftMessage('m-reply-draft', 't-conversation', 'Re: Launch copy'),
          ],
        },
      ],
    ])
    const fetch = vi.fn(async (request: { url: string; method?: string; body?: string }) => {
      requests.push(request)
      const url = new URL(request.url)
      if (url.pathname.endsWith('/profile')) {
        return { ok: true, status: 200, body: JSON.stringify({ emailAddress: 'alex@example.com' }) }
      }
      if (url.pathname.endsWith('/labels')) {
        return { ok: true, status: 200, body: JSON.stringify({ labels: [] }) }
      }
      if (url.pathname.endsWith('/drafts') && request.method !== 'POST') {
        if (options.draftsFail) return { ok: false, status: 500, body: '{}' }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            drafts: [
              { id: 'r-1', message: { id: 'm-draft', threadId: 't-draft-only' } },
              { id: 'r-2', message: { id: 'm-reply-draft', threadId: 't-conversation' } },
            ],
          }),
        }
      }
      if (url.pathname.endsWith('/threads')) {
        const label = url.searchParams.get('labelIds')
        if (label === 'INBOX') {
          return { ok: true, status: 200, body: JSON.stringify({ threads: [{ id: 't-conversation' }] }) }
        }
        if (label === 'DRAFT') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ threads: [{ id: 't-draft-only' }, { id: 't-conversation' }] }),
          }
        }
        return { ok: true, status: 200, body: JSON.stringify({ threads: [] }) }
      }
      if (url.pathname.endsWith('/drafts/send')) {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'sent-1', threadId: 't-conversation' }) }
      }
      if (url.pathname.includes('/drafts/')) {
        return { ok: true, status: 200, body: '{}' }
      }
      const id = url.pathname.split('/').pop() ?? ''
      if (threads.has(id)) {
        return { ok: true, status: 200, body: JSON.stringify(threads.get(id)) }
      }
      throw new Error(`Unexpected Gmail request: ${request.url}`)
    })
    return {
      requests,
      provider: new GmailMailProvider({
        email: 'alex@example.com',
        accessToken: async () => 'test-token',
        fetch: fetch as never,
      }),
    }
  }

  it('lists the DRAFT label alongside inbox, sent and trash', async () => {
    const { provider, requests } = draftProvider()
    await provider.fetchStore()
    const listings = requests
      .map(request => new URL(request.url))
      .filter(url => url.pathname.endsWith('/threads'))
      .map(url => url.searchParams.get('labelIds'))
    expect(listings).toContain('DRAFT')
    expect(listings).toContain('INBOX')
  })

  it('files a draft-only thread in Drafts, not in Sent', async () => {
    const { provider } = draftProvider()
    const store = await provider.fetchStore()
    const thread = store.threads.find(item => item.gmailThreadId === 't-draft-only')!
    expect(thread.mailboxId).toBe('gmail_drafts')
  })

  it('turns remote drafts into editable Draft records', async () => {
    const { provider } = draftProvider()
    const store = await provider.fetchStore()
    const drafts = [...store.drafts].sort((a, b) =>
      (a.providerDraftId ?? '').localeCompare(b.providerDraftId ?? ''),
    )
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
      providerDraftId: 'r-1',
      providerDraftMessageId: 'gmail_msg_m-draft',
      threadId: 'gmail_thread_t-draft-only',
      subject: 'A note to Mira',
      body: 'Started this on my phone.',
      syncState: 'synced',
    })
    // The reply draft stays on the conversation it answers.
    expect(drafts[1].threadId).toBe('gmail_thread_t-conversation')
    expect(store.syncCoverage?.draftsCovered).toBe(true)
  })

  it('reports no draft coverage when the drafts listing fails', async () => {
    const { provider } = draftProvider({ draftsFail: true })
    const store = await provider.fetchStore()
    expect(store.drafts).toEqual([])
    // "We did not look" — never "there are none", which would delete the
    // user's synced drafts on the next merge.
    expect(store.syncCoverage?.draftsCovered).toBeUndefined()
  })

  it('sends a synced draft through drafts.send, updating it first', async () => {
    const { provider, requests } = draftProvider()
    const store = await provider.fetchStore()
    const draft = store.drafts.find(item => item.providerDraftId === 'r-2')!
    await provider.send({
      draft: { ...draft, body: 'Edited just before sending.' },
      threadId: draft.threadId,
    })
    const paths = requests.map(request => ({
      path: new URL(request.url).pathname,
      method: request.method,
      body: request.body,
    }))
    const update = paths.find(
      entry => entry.path.endsWith('/drafts/r-2') && entry.method === 'PUT',
    )
    expect(update).toBeTruthy()
    const sendCall = paths.find(entry => entry.path.endsWith('/drafts/send'))
    expect(sendCall?.body).toContain('r-2')
    // The Gmail draft is consumed by the send; messages.send would have left
    // it sitting in Drafts.
    expect(paths.some(entry => entry.path.endsWith('/messages/send'))).toBe(false)
  })
})
