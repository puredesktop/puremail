import { describe, expect, it, vi } from 'vitest'
import { demoMailStoreForNow } from './mailModel'
import { MailDrawerDrafts } from './mailDrawerDrafts'

function fixture() {
  const store = demoMailStoreForNow(new Date('2026-09-10T12:00:00Z'))
  store.drafts = []
  const thread = store.threads.find(item => item.accountId === store.accounts[0].id)!
  return { store, threadId: thread.id, accountId: thread.accountId, requests: new MailDrawerDrafts() }
}

describe('drawer reply lifecycle', () => {
  it('prepares without writing, commits once and returns the actual unsent draft', () => {
    const f = fixture()
    const before = JSON.stringify(f.store)
    const prepared = f.requests.prepare(f.store, f.accountId, f.threadId, 'Decline politely')
    expect(prepared.context).toContain('Decline politely')
    expect(prepared.instructions).toContain('Reply intent')
    expect(JSON.stringify(f.store)).toBe(before)
    const result = f.requests.commit(f.store, f.accountId, prepared.requestId, 'Hello,\n\nI cannot attend.')
    expect(result.store.drafts).toHaveLength(1)
    expect(result.store.drafts[0]).toMatchObject({ id: result.receipt.draftId, threadId: f.threadId, body: 'Hello,\n\nI cannot attend.', syncState: 'pending' })
    expect(result.receipt).toMatchObject({ applied: true, persisted: false, sent: false })
    expect(() => f.requests.commit(result.store, f.accountId, prepared.requestId, 'Again')).toThrow('already committed')
  })
  it('improves in place and preserves provider identity, recipients and attachments', () => {
    const f = fixture()
    const p = f.requests.prepare(f.store, f.accountId, f.threadId)
    const first = f.requests.commit(f.store, f.accountId, p.requestId, 'Hi,\n\nFirst version.').store
    const draft = first.drafts[0]
    draft.providerDraftId = 'provider-draft'
    draft.providerDraftMessageId = 'provider-message'
    draft.cc = [{ name: 'CC', email: 'cc@example.com' }]
    draft.bodyHtml = '<p>Old body</p>'
    const next = f.requests.prepare(first, f.accountId, f.threadId)
    const updated = f.requests.commit(first, f.accountId, next.requestId, 'Hi,\n\nUpdated version.')
    expect(updated.store.drafts).toHaveLength(1)
    expect(updated.store.drafts[0]).toMatchObject({ id: draft.id, providerDraftId: 'provider-draft', providerDraftMessageId: 'provider-message', cc: draft.cc, to: draft.to, attachments: draft.attachments })
    expect(updated.store.drafts[0].bodyHtml).toBeUndefined()
    expect(updated.receipt.status).toBe('improved')
  })
  it.each(['edit', 'discard', 'sent', 'new-message', 'account', 'deleted-thread'])('rejects %s during preparation without changing the current store', change => {
    const f = fixture()
    const p = f.requests.prepare(f.store, f.accountId, f.threadId)
    const store = f.requests.commit(f.store, f.accountId, p.requestId, 'Hello,\n\nFirst draft.').store
    const next = f.requests.prepare(store, f.accountId, f.threadId)
    if (change === 'edit') store.drafts[0].body = 'User edit'
    if (change === 'discard') store.drafts = []
    if (change === 'sent') store.drafts[0].sentAt = new Date().toISOString()
    if (change === 'new-message') store.messages.push({ ...store.messages[0], threadId: f.threadId, id: 'new-message' })
    if (change === 'deleted-thread') store.threads = store.threads.filter(t => t.id !== f.threadId)
    const before = JSON.stringify(store)
    expect(() => f.requests.commit(store, change === 'account' ? 'other' : f.accountId, next.requestId, 'Late answer')).toThrow('changed')
    expect(JSON.stringify(store)).toBe(before)
  })
  it('invalidates cancelled and superseded requests', () => {
    const f = fixture()
    const first = f.requests.prepare(f.store, f.accountId, f.threadId)
    const second = f.requests.prepare(f.store, f.accountId, f.threadId)
    expect(() => f.requests.commit(f.store, f.accountId, first.requestId, 'Old')).toThrow('cancelled')
    f.requests.clear()
    expect(() => f.requests.commit(f.store, f.accountId, second.requestId, 'Old')).toThrow('cancelled')
    expect(f.store.drafts).toEqual([])
  })
  it('expires and rejects empty results without manufacturing fallback mail', () => {
    const f = fixture()
    const p = f.requests.prepare(f.store, f.accountId, f.threadId)
    expect(() => f.requests.commit(f.store, f.accountId, p.requestId, '```text\n```')).toThrow('nonempty')
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000)
    try { expect(() => f.requests.commit(f.store, f.accountId, p.requestId, 'Late')).toThrow('expired') } finally { clock.mockRestore() }
    expect(f.store.drafts).toEqual([])
  })
})
