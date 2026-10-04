import { describe, expect, it } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { archiveThread, markThreadRead } from './mailModel'
import { beginThreadReadSync } from './mailThreadReadSync'

describe('read-state acknowledgement', () => {
  function fixture() {
    const store = demoMailStore()
    const id = store.threads[0].id
    store.threads[0].syncState = 'synced'
    return { store, id }
  }

  it('clears only the successful read operation and retains the read messages', () => {
    const { store, id } = fixture()
    const operation = beginThreadReadSync(store, id, true)
    expect(operation.store.threads[0].syncState).toBe('pending')
    const acknowledged = operation.acknowledge(operation.store)
    expect(acknowledged.threads[0].syncState).toBe('synced')
    expect(acknowledged.messages.filter(message => message.threadId === id).every(message => message.read)).toBe(true)
  })

  it('cannot clear an archive started while the server was marking read', () => {
    const { store, id } = fixture()
    const operation = beginThreadReadSync(store, id, true)
    const archived = archiveThread(operation.store, id)
    expect(operation.acknowledge(archived)).toBe(archived)
    expect(archived.threads[0].syncState).toBe('pending')
  })

  it('cannot undo a later mark-unread operation', () => {
    const { store, id } = fixture()
    const operation = beginThreadReadSync(store, id, true)
    const unread = markThreadRead(operation.store, id, false)
    expect(operation.acknowledge(unread)).toBe(unread)
  })

  it.each(['pending', 'failed', 'conflict'] as const)('does not clear pre-existing %s work', syncState => {
    const { store, id } = fixture()
    store.threads[0].syncState = syncState
    const operation = beginThreadReadSync(store, id, true)
    expect(operation.acknowledge(operation.store)).toBe(operation.store)
  })

  it('can acknowledge while preserving a mutation to a different thread', () => {
    const { store, id } = fixture()
    const operation = beginThreadReadSync(store, id, true)
    const otherId = store.threads[1].id
    const concurrent = markThreadRead(operation.store, otherId, false)
    const acknowledged = operation.acknowledge(concurrent)
    expect(acknowledged.threads.find(thread => thread.id === id)?.syncState).toBe('synced')
    expect(acknowledged.threads.find(thread => thread.id === otherId)?.syncState).toBe('pending')
  })

  it('leaves a refreshed or replaced account/thread snapshot alone', () => {
    const { store, id } = fixture()
    const operation = beginThreadReadSync(store, id, true)
    const replacement = { ...operation.store, threads: operation.store.threads.map(thread => thread.id === id ? { ...thread, accountId: 'another-account' } : thread) }
    expect(operation.acknowledge(replacement)).toBe(replacement)
  })

  it('does not acknowledge a new unread message added during the request', () => {
    const { store, id } = fixture()
    const operation = beginThreadReadSync(store, id, true)
    const concurrent = { ...operation.store, messages: [...operation.store.messages, { ...operation.store.messages.find(message => message.threadId === id)!, id: 'new-arrival', read: false }] }
    expect(operation.acknowledge(concurrent)).toBe(concurrent)
  })
})
