import { describe, expect, it } from 'vitest'
import { DemoMailProvider } from './demoMailProvider'
import {
  archiveThread,
  demoMailStore,
  updateDraftAttachments,
  updateDraftBody,
} from './mailModel'

describe('DemoMailProvider', () => {
  it('declares a minimal, local-only capability surface', () => {
    const provider = new DemoMailProvider()
    expect(provider.capabilities).toEqual({
      compose: true,
      drafts: true,
      labels: true,
      bulkActions: false,
    })
  })

  it('fetches a provider-shaped local store', async () => {
    const provider = new DemoMailProvider()
    const store = await provider.fetchStore()
    expect(store.accounts[0].provider).toBe('demo')
    expect(store.threads).toHaveLength(0)
    expect(store.messages).toHaveLength(0)
    expect(store.drafts).toHaveLength(0)
    expect(store.taskLists.some(list => list.source === 'mail')).toBe(true)
  })

  it('syncs pending local changes back to synced state', async () => {
    const provider = new DemoMailProvider(demoMailStore())
    const pending = archiveThread(await provider.fetchStore(), 'thread_launch')
    const pendingTaskId = pending.tasks[0].id
    pending.tasks = pending.tasks.map(task =>
      task.id === pendingTaskId
        ? { ...task, title: 'Offline follow-up edit', syncState: 'pending' }
        : task,
    )
    const synced = await provider.sync(pending)
    expect(
      synced.threads.find(thread => thread.id === 'thread_launch')?.syncState,
    ).toBe('synced')
    expect(synced.tasks.find(task => task.id === pendingTaskId)).toMatchObject({
      title: 'Offline follow-up edit',
      syncState: 'synced',
    })
  })

  it('archives through the provider with the same mailbox semantics as the model', async () => {
    const provider = new DemoMailProvider(demoMailStore())
    await provider.archiveThread('thread_launch')
    const next = await provider.fetchStore()
    const archived = next.threads.find(thread => thread.id === 'thread_launch')
    expect(archived?.status).toBe('archived')
    expect(archived?.mailboxId).toBe('mailbox_archive')
    expect(archived?.syncState).toBe('pending')
  })



  it('moves, labels, deletes, and marks read state through provider methods', async () => {
    const provider = new DemoMailProvider(demoMailStore())
    await provider.moveThread('thread_launch', 'mailbox_sent')
    await provider.labelThread('thread_launch', 'label_waiting')
    await provider.markThreadRead('thread_launch', true)
    await provider.deleteThread('thread_contract')
    const next = await provider.fetchStore()
    expect(
      next.threads.find(thread => thread.id === 'thread_launch')?.mailboxId,
    ).toBe('mailbox_sent')
    expect(
      next.threads.find(thread => thread.id === 'thread_launch')?.labels,
    ).toContain('Waiting')
    expect(
      next.messages
        .filter(message => message.threadId === 'thread_launch')
        .every(message => message.read),
    ).toBe(true)
    expect(
      next.threads.find(thread => thread.id === 'thread_contract')?.mailboxId,
    ).toBe('mailbox_trash')
  })

  it('sends and removes a draft through the provider boundary', async () => {
    const store = demoMailStore()
    const provider = new DemoMailProvider(store)
    const draft = updateDraftAttachments(
      {
        ...updateDraftBody(store.drafts[0], 'Sending this reply.'),
        cc: [{ name: 'Copy Person', email: 'copy@example.com' }],
        bcc: [{ name: 'Blind Person', email: 'blind@example.com' }],
      },
      [
        {
          id: 'att_boundary',
          name: 'boundary.txt',
          mimeType: 'text/plain',
          sizeLabel: '1 KB',
          content: 'boundary',
        },
      ],
    )
    const message = await provider.send({ draft, threadId: draft.threadId })
    const next = await provider.fetchStore()
    expect(message.body).toBe('Sending this reply.')
    expect(message.cc).toEqual([
      { name: 'Copy Person', email: 'copy@example.com' },
    ])
    expect(message.bcc).toEqual([
      { name: 'Blind Person', email: 'blind@example.com' },
    ])
    expect(message.attachments[0]?.name).toBe('boundary.txt')
    expect(next.drafts.find(item => item.id === draft.id)).toBeUndefined()
    expect(next.messages.find(item => item.id === message.id)).toBeTruthy()
  })

  it('searches threads and tasks without UI access to the demo store', async () => {
    const provider = new DemoMailProvider(demoMailStore())
    const results = await provider.search('launch')
    expect(results.some(result => result.type === 'thread')).toBe(true)
    expect(results.some(result => result.type === 'task')).toBe(true)
  })

  it('searches attachments without UI access to the demo store', async () => {
    const provider = new DemoMailProvider(demoMailStore())
    const results = await provider.search('screens')
    expect(results.some(result => result.type === 'attachment')).toBe(true)
  })
})
