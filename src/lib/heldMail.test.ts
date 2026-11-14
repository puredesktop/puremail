import { describe, expect, it } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { latestThreadFrom } from './heldMail'

describe('the latest thread from a person', () => {
  it('finds it by name or address, in any case', () => {
    const store = demoMailStore()
    const byName = latestThreadFrom(store, '  MIRA ')
    expect(byName?.who).toBe('Mira')
    expect(latestThreadFrom(store, 'mira@example.com')?.threadId).toBe(byName?.threadId)
  })

  it('takes the newest of their messages', () => {
    const store = demoMailStore()
    const mine = store.messages.filter(each => each.from.email === 'kim@example.com' && !each.isDraft).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    expect(mine.length).toBeGreaterThan(1)
    expect(latestThreadFrom(store, 'kim')?.messageId).toBe(mine[0]!.id)
  })

  it('does not count mail the person wrote, drafts, or the Trash', () => {
    const store = demoMailStore()
    const own = store.accounts[0]!.email
    expect(latestThreadFrom(store, own)).toBeNull()
    const trash = store.mailboxes.find(each => each.role === 'trash')!
    const inTrash = { ...store, threads: store.threads.map(each => ({ ...each, mailboxId: trash.id })) }
    expect(latestThreadFrom(inTrash, 'mira')).toBeNull()
    const draftsOnly = { ...store, messages: store.messages.map(each => ({ ...each, isDraft: true })) }
    expect(latestThreadFrom(draftsOnly, 'mira')).toBeNull()
  })

  it('names the others the words also fit', () => {
    const store = demoMailStore()
    const found = latestThreadFrom(store, 'example.com')
    expect(found?.alsoMatched.length).toBeGreaterThan(0)
    expect(latestThreadFrom(store, '')).toBeNull()
  })
})
