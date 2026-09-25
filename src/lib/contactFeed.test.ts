import { describe, expect, it } from 'vitest'
import { demoMailStore } from './mailStoreData'
import {
  isMachineEmail,
  selectContactFeedCandidates,
  withContactFeedKeys,
} from './contactFeed'

describe('contact feed candidates', () => {
  it('feeds real correspondents once, with best name and latest sighting', () => {
    const store = demoMailStore()
    const first = selectContactFeedCandidates(store)
    expect(first.entries.length).toBeGreaterThan(0)
    for (const entry of first.entries) {
      expect(entry.sourceApp).toBe('mail')
      expect(isMachineEmail(entry.contact.email)).toBe(false)
      // Never the account owner.
      expect(entry.contact.email).not.toBe(store.accounts[0]!.email)
    }
    // Recording the keys makes the next pass empty.
    const second = selectContactFeedCandidates(
      withContactFeedKeys(store, first.keys),
    )
    expect(second.entries).toHaveLength(0)
  })

  it('skips machine addresses entirely', () => {
    expect(isMachineEmail('notifications@github.com')).toBe(true)
    expect(isMachineEmail('mailer-daemon@x.example')).toBe(true)
    expect(isMachineEmail('kim@x.example')).toBe(false)
  })

  it('caps the recorded key list', () => {
    const store = withContactFeedKeys(
      { ...demoMailStore(), contactFeedKeys: [] },
      Array.from({ length: 4200 }, (_, index) => `k${index}`),
    )
    expect(store.contactFeedKeys).toHaveLength(4000)
  })
})

describe('encounters for PurePeople', () => {
  it('reports each thread with two or more other people once, and again only when it changes', async () => {
    const { selectEncounterCandidates, withEncounterFeedMarks } = await import('./contactFeed')
    const base = demoMailStore()
    const owner = base.accounts[0]!
    const thread = base.threads[0]!
    const template = base.messages.find(message => message.threadId === thread.id) ?? base.messages[0]!
    const message = { ...template, threadId: thread.id, subject: 'Peer review pilot', receivedAt: '2026-09-01T10:00:00.000Z',
      from: { name: 'Mira Example', email: 'Mira@Kestrel.example' }, to: [{ name: owner.name ?? '', email: owner.email }, { name: 'Priya', email: 'priya@meridian.example' }], cc: [{ name: 'Bot', email: 'notifications@tool.example' }] }
    const store = { ...base, messages: [message] }
    const first = selectEncounterCandidates(store)
    expect(first.entries).toEqual([{ id: `mail_${thread.id}`, kind: 'thread', sourceApp: 'mail', subject: thread.subject || 'Peer review pilot', at: '2026-09-01T10:00:00.000Z', emails: ['mira@kestrel.example', 'priya@meridian.example'], count: 1 }])
    const marked = withEncounterFeedMarks(store, first.marks)
    expect(selectEncounterCandidates(marked).entries).toHaveLength(0)
    // A new message on the thread sends it again, with the count.
    const grown = { ...marked, messages: [...marked.messages, { ...message, id: `${message.id}-2`, receivedAt: '2026-09-02T10:00:00.000Z' }] }
    expect(selectEncounterCandidates(grown).entries.map(entry => entry.count)).toEqual([2])
  })
  it('leaves out threads with one other person, and broadcasts', async () => {
    const { selectEncounterCandidates } = await import('./contactFeed')
    const store = demoMailStore()
    const template = store.messages[0]!
    const threadId = store.threads[0]!.id
    const crowd = Array.from({ length: 45 }, (_, i) => ({ name: `P${i}`, email: `p${i}@crowd.example` }))
    const single = { ...store, messages: [{ ...template, threadId, from: { name: 'One', email: 'one@x.example' }, to: [store.accounts[0]!], cc: [] }] }
    expect(selectEncounterCandidates(single).entries).toHaveLength(0)
    const broadcast = { ...store, messages: [{ ...template, threadId, to: crowd, cc: [] }] }
    expect(selectEncounterCandidates(broadcast).entries).toHaveLength(0)
  })
})
