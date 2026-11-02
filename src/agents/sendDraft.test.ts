import { describe, expect, it } from 'vitest'
import { demoMailStoreForNow } from '../test/mailFixtures'
import { sendDraft } from '../lib/mailModel'
import { draftEditVersion } from '../lib/mailDrawerDrafts'
import { AgentMailToolError, type MailAgentToolContext } from './catalog'
import { sendDraftHandler } from './handlers'
import type { Draft, MailStore } from '../types'

const NOW = new Date('2026-11-01T12:00:00.000Z')

function makeContext(undoSeconds = 0): MailAgentToolContext & { sent: Draft[] } {
  const store = demoMailStoreForNow(NOW)
  const sent: Draft[] = []
  const context: MailAgentToolContext & { sent: Draft[] } = {
    store,
    accountId: store.accounts[0]!.id,
    now: NOW,
    currentQuery: 'in:Inbox',
    selectedThread: null,
    showQuery: () => {},
    setStore: (updater: (store: MailStore) => MailStore) => { context.store = updater(context.store) },
    applyAction: () => {},
    listMailOperations: async () => [],
    addTaskForThread: () => {},
    requestDraftForThread: async () => { throw new Error('n/a') },
    noteAgentSearch: () => {},
    sendStoreDraft: (draft, options) => {
      sent.push(draft)
      if (undoSeconds > 0) return { ok: true, pendingId: `pending_${draft.id}`, undoSeconds }
      const at = NOW.toISOString()
      context.store = sendDraft(context.store, draft.id, at)
      options.onCommitted?.(`msg_sent_${draft.id}_${at.replace(/[^0-9]/g, '')}`)
      return { ok: true, pendingId: `pending_${draft.id}`, undoSeconds: 0 }
    },
    sent,
  }
  return context
}

function unsentDraft(context: MailAgentToolContext): Draft {
  const draft = context.store.drafts.find(item => !item.sentAt && item.to.length)
  if (!draft) throw new Error('the demo store has no unsent draft')
  return draft
}

const parse = (result: { content: string }): any => JSON.parse(result.content)

describe('sendDraft (a release)', () => {
  it('sends exactly the one draft, at the version the person saw', () => {
    const context = makeContext()
    const draft = unsentDraft(context)
    const out = parse(sendDraftHandler(context, { draftId: draft.id, version: draftEditVersion(draft) }))
    expect(context.sent.map(item => item.id)).toEqual([draft.id])
    expect(out).toMatchObject({ draftId: draft.id, subject: draft.subject, status: 'sent', undoSeconds: 0 })
    expect(out.sentMessageId).toMatch(new RegExp(`^msg_sent_${draft.id}_`))
  })

  it('says queued while the undo hold runs', () => {
    const context = makeContext(10)
    const draft = unsentDraft(context)
    expect(parse(sendDraftHandler(context, { draftId: draft.id }))).toMatchObject({ status: 'queued', undoSeconds: 10 })
  })

  it('refuses when the draft changed after it was approved', () => {
    const context = makeContext()
    const draft = unsentDraft(context)
    const version = draftEditVersion(draft)
    context.store = { ...context.store, drafts: context.store.drafts.map(item => (item.id === draft.id ? { ...item, body: `${item.body}\nEdited.` } : item)) }
    expect(() => sendDraftHandler(context, { draftId: draft.id, version })).toThrow('It changed after you approved it, so it was not sent. Look at it again.')
    expect(context.sent).toEqual([])
  })

  it('refuses a missing draft and one already sent', () => {
    const context = makeContext()
    expect(() => sendDraftHandler(context, { draftId: 'draft_nope' })).toThrow(AgentMailToolError)
    expect(() => sendDraftHandler(context, { draftId: 'draft_nope' })).toThrow('not in PureMail any more')
    const draft = unsentDraft(context)
    sendDraftHandler(context, { draftId: draft.id })
    expect(() => sendDraftHandler(context, { draftId: draft.id })).toThrow('This draft was sent already.')
    expect(context.sent).toHaveLength(1)
  })

  it('needs the send path', () => {
    const context = { ...makeContext(), sendStoreDraft: undefined }
    expect(() => sendDraftHandler(context, { draftId: 'x' })).toThrow('Sending is unavailable')
  })
})
