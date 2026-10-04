import { expect, it } from 'vitest'
import {
  createComposedDraftIdentity,
  createComposedMessageDraft,
  emptyMailStore,
  mergeMailProviderSyncResult,
} from './mailModel'
import { replacementMailThread } from './mailReaderSelection'
import type { MailStore } from '../types'

function fixture() {
  const account = {
    id: 'a',
    email: 'me@example.test',
    name: 'Me',
    provider: 'imap' as const,
    syncState: 'online' as const,
  }
  const thread = {
    id: 'thread_compose_local',
    accountId: 'a',
    mailboxId: 'sent',
    subject: 'Test',
    participants: [],
    labels: [],
    status: 'waiting' as const,
    priority: 'none' as const,
    summary: '',
    lastMessageAt: '2026-10-03T00:00:00Z',
    syncState: 'synced' as const,
  }
  const message = {
    id: 'local',
    threadId: thread.id,
    messageIdHeader: '<unique@example.test>',
    deliveryAccepted: true,
    from: { name: 'Me', email: account.email },
    to: [],
    subject: 'Test',
    body: 'Latest body',
    attachments: [],
    receivedAt: thread.lastMessageAt,
    read: true,
  }
  const local: MailStore = {
    ...emptyMailStore(),
    accounts: [account],
    mailboxes: [
      {
        id: 'sent',
        accountId: 'a',
        name: 'Sent',
        role: 'sent',
        unreadCount: 0,
      },
    ],
    threads: [thread],
    messages: [message],
  }
  const remote: MailStore = {
    ...local,
    threads: [{ ...thread, id: 'imap_thread_real' }],
    messages: [
      {
        ...message,
        id: 'imap_msg_Sent_7',
        threadId: 'imap_thread_real',
        deliveryAccepted: undefined,
      },
    ],
  }
  return { local, remote }
}

it('keeps simultaneous app-created messages distinct while replayed pure updaters use the same identity', () => {
  const now = '2026-10-03T00:00:00.000Z'
  const input = {
    to: [],
    subject: 'Created by another app',
    body: 'Writing',
    origin: 'agent' as const,
  }
  const a = createComposedMessageDraft(emptyMailStore(), input, now)
  const b = createComposedMessageDraft(a.store, input, now)
  expect(b.store.drafts).toHaveLength(2)
  expect(new Set(b.store.drafts.map(draft => draft.id)).size).toBe(2)
  const identity = createComposedDraftIdentity()
  expect(
    createComposedMessageDraft(emptyMailStore(), input, now, identity).draftId,
  ).toBe(
    createComposedMessageDraft(emptyMailStore(), input, now, identity).draftId,
  )
})

it('replaces an IMAP local sent thread once and keeps the reader on the confirmed send', () => {
  const { local, remote } = fixture()
  const merged = mergeMailProviderSyncResult(local, remote)
  expect(merged.threads.map(thread => thread.id)).toEqual(['imap_thread_real'])
  expect(merged.messages).toHaveLength(1)
  const withUnrelatedFirst = {
    ...merged,
    threads: [{ ...merged.threads[0], id: 'unrelated' }, ...merged.threads],
  }
  expect(
    replacementMailThread(local, withUnrelatedFirst, local.threads[0].id, 'a'),
  ).toBe('imap_thread_real')
})

it('retains a local conversation that still has an unsent draft', () => {
  const { local, remote } = fixture()
  local.drafts = [
    {
      id: 'unsent',
      threadId: local.threads[0].id,
      to: [],
      subject: 'Next reply',
      body: 'Unsent edits',
      attachments: [],
      updatedAt: '2026-10-03T00:01:00Z',
      syncState: 'pending',
    },
  ]
  const merged = mergeMailProviderSyncResult(local, remote)
  expect(merged.threads.map(thread => thread.id)).toContain(local.threads[0].id)
  expect(replacementMailThread(local, merged, local.threads[0].id, 'a')).toBe(
    local.threads[0].id,
  )
})

it('does not retain an empty local thread after its uncertain attempt is confirmed by Message-ID', () => {
  const { local, remote } = fixture()
  local.drafts = [
    {
      id: 'attempt',
      threadId: local.threads[0].id,
      to: [],
      subject: 'Test',
      body: 'Latest body',
      attachments: [],
      updatedAt: '2026-10-03T00:00:00Z',
      syncState: 'synced',
      sendState: 'uncertain',
      sendMessageId: local.messages[0].messageIdHeader,
    },
  ]
  const merged = mergeMailProviderSyncResult(local, remote)
  expect(merged.drafts).toHaveLength(0)
  expect(merged.threads.map(thread => thread.id)).toEqual(['imap_thread_real'])
})

it('prunes an empty composed thread left behind by an older sync', () => {
  const { local, remote } = fixture()
  local.messages = []
  expect(
    mergeMailProviderSyncResult(local, remote).threads.map(thread => thread.id),
  ).toEqual(['imap_thread_real'])
})

it('follows a confirmed imported IMAP draft onto its new server conversation', () => {
  const { local, remote } = fixture()
  const importedId = 'imap_thread_original_draft_rfc'
  local.threads[0].id = importedId
  local.messages[0].threadId = importedId
  const merged = mergeMailProviderSyncResult(local, remote)
  expect(merged.threads.map(thread => thread.id)).toEqual(['imap_thread_real'])
  expect(merged.messages).toHaveLength(1)
  expect(replacementMailThread(local, merged, importedId, 'a')).toBe('imap_thread_real')
})

it('removes an empty synced Sent shell persisted by an older imported-draft send', () => {
  const { local, remote } = fixture()
  local.threads[0].id = 'imap_thread_original_draft_rfc'
  local.messages = []
  expect(mergeMailProviderSyncResult(local, remote).threads.map(thread => thread.id)).toEqual(['imap_thread_real'])
})

it('preserves an imported conversation with a newer unsent reply', () => {
  const { local, remote } = fixture()
  const importedId = 'imap_thread_original_draft_rfc'
  local.threads[0].id = importedId
  local.messages[0].threadId = importedId
  local.drafts = [{ id: 'newer', threadId: importedId, to: [], subject: 'Next', body: 'Unsent', attachments: [], updatedAt: local.threads[0].lastMessageAt, syncState: 'pending' }]
  expect(mergeMailProviderSyncResult(local, remote).threads.map(thread => thread.id)).toContain(importedId)
})

it('preserves original conversation history when only its sent reply moves', () => {
  const { local, remote } = fixture()
  const importedId = 'imap_thread_original_draft_rfc'
  local.threads[0].id = importedId
  local.messages[0].threadId = importedId
  local.messages.push({ ...local.messages[0], id: 'source', messageIdHeader: '<source@example.test>', deliveryAccepted: undefined, body: 'Original message' })
  const merged = mergeMailProviderSyncResult(local, remote)
  expect(merged.threads.map(thread => thread.id)).toContain(importedId)
  expect(merged.messages.some(message => message.id === 'source')).toBe(true)
})

it.each(['pending', 'failed-fetch'] as const)('keeps an empty Sent placeholder with %s work', state => {
  const { local, remote } = fixture()
  const importedId = 'imap_thread_original_draft_rfc'
  local.threads[0].id = importedId
  local.messages = []
  if (state === 'pending') local.threads[0].syncState = 'pending'
  else remote.syncCoverage = { failedThreadIds: [importedId] }
  expect(mergeMailProviderSyncResult(local, remote).threads.map(thread => thread.id)).toContain(importedId)
})
