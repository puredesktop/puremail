// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { useExecutiveMailShare } from '../hooks/useExecutiveMailShare'
import { refusingSendsWhenHeld } from '../hooks/usePureMailAgentTools'
import { heldCopyFetchDue, heldCopySendRefusal, isTeamDraft } from '../lib/heldCopySends'
import { executiveDraftIds } from '../lib/executiveShare'
import { imapDraftMessageId } from '../lib/mailDeliveryStatus'
import { demoMailStore } from '../test/mailFixtures'
import { PureMailShell } from './PureMailShell'
import type { Draft, MailProvider, MailStore } from '../types'

const copy = vi.hoisted(() => ({ held: false }))
vi.mock('../lib/heldCopy', () => ({ isHeldCopy: () => copy.held, copyIsKnown: () => true, findOutIfHeld: async () => copy.held }))
vi.mock('../hooks/useExecutiveMailShare', () => ({ useExecutiveMailShare: vi.fn(() => ({ afterSync: vi.fn(), teamReads: {} })) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A provider that only records. It has no way to reach any server, so nothing here can really be sent. */
function recordingProvider() {
  const provider = {
    capabilities: { compose: true, drafts: true },
    fetchStore: vi.fn(),
    sync: vi.fn(async (store: MailStore) => store),
    send: vi.fn(async () => ({ id: 'recorded-send', threadId: 'thread', attachments: [] })),
    search: vi.fn(async () => []),
    labelThread: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    moveThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    markThreadRead: vi.fn(async () => undefined),
    createDraft: vi.fn(async () => 'provider-draft'),
    updateDraft: vi.fn(async () => undefined),
    deleteDraft: vi.fn(async () => undefined),
    listDrafts: vi.fn(async () => []),
  }
  return provider as typeof provider & MailProvider
}

const YESTERDAY = new Date(Date.now() - 24 * 3600_000).toISOString()
const baseDraft = (id: string, threadId: string): Draft => ({ id, threadId, to: [{ name: 'Mira', email: 'mira@example.com' }], subject: 'Hello', body: 'Words', attachments: [], updatedAt: YESTERDAY, syncState: 'pending' })

/** Everything that runs on its own once Mail opens: a due send, a queued action, a matching filter, a due snooze, a draft to push. */
function busyStore(lastSyncedAt?: string): MailStore {
  const store = demoMailStore()
  const threadId = store.threads[0].id
  return {
    ...store,
    drafts: [{ ...baseDraft('draft-due', threadId), syncState: 'synced', providerDraftId: 'p1' }, baseDraft('draft-to-push', threadId)],
    scheduledSends: [{ id: 'due', draftId: 'draft-due', threadId, sendAt: YESTERDAY, createdAt: YESTERDAY, status: 'scheduled' }],
    queuedActions: [{ id: 'q', type: 'archive', threadId, queuedAt: YESTERDAY, attempts: 0 }],
    filters: [{ id: 'f', name: 'Everything', query: 'in:inbox', actions: { skipInbox: true }, enabled: true, createdAt: YESTERDAY, hitCount: 0 }],
    snoozes: [{ threadId: store.threads[1].id, snoozedUntil: YESTERDAY, snoozedAt: YESTERDAY }],
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
  }
}

let root: Root | null = null
async function open(store: MailStore) {
  const provider = recordingProvider()
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root!.render(
    <AppFrame>
      <PureMailShell initialProvider="imap" mailProvider={provider} initialStore={store} initialNotice={null as never} />
    </AppFrame>,
  ))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1700)) })
  return provider
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(useExecutiveMailShare).mockClear()
})
const openHeld = (store: MailStore) => {
  copy.held = true
  document.documentElement.setAttribute('data-held-in-room', '')
  return open(store)
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-held-in-room')
  copy.held = false
})

describe('what runs on its own when Mail opens', () => {
  it('a normal tab does all of it (the proof that the held tests below test something)', async () => {
    copy.held = false
    const provider = await open(busyStore())
    expect(provider.send, 'the due send').toHaveBeenCalledTimes(1)
    expect(provider.sync, 'the boot fetch').toHaveBeenCalledTimes(1)
    expect(provider.createDraft, 'the draft push').toHaveBeenCalled()
    expect(provider.archiveThread, 'the filter and the queue').toHaveBeenCalled()
    expect(vi.mocked(useExecutiveMailShare).mock.calls.at(-1)?.[0].enabled).toBe(true)
  })

  it('a held copy sends nothing, pushes no drafts, runs no filters or queue, takes no team drafts, and does not double a tab\'s fetch', async () => {
    const provider = await openHeld(busyStore(new Date().toISOString()))
    expect(provider.send).not.toHaveBeenCalled()
    expect(provider.sync).not.toHaveBeenCalled()
    expect(provider.createDraft).not.toHaveBeenCalled()
    expect(provider.updateDraft).not.toHaveBeenCalled()
    expect(provider.archiveThread).not.toHaveBeenCalled()
    expect(provider.moveThread).not.toHaveBeenCalled()
    for (const [input] of vi.mocked(useExecutiveMailShare).mock.calls) expect(input.enabled).toBe(false)
  })

  it('with no tab keeping the mail fresh, a held copy brings mail in and still does nothing else', async () => {
    const provider = await openHeld(busyStore(YESTERDAY))
    expect(provider.sync).toHaveBeenCalledTimes(1)
    expect(provider.send).not.toHaveBeenCalled()
    expect(provider.createDraft).not.toHaveBeenCalled()
    expect(provider.archiveThread).not.toHaveBeenCalled()
    expect(provider.markThreadRead).not.toHaveBeenCalled()
  })
})

describe('what a held copy will send', () => {
  const store = { runs: [{ id: 'r', name: 'Run', accountId: 'a', status: 'active', fieldMap: {}, noteSlot: false, items: [{ draftId: 'run-item' }], cursor: 0, createdAt: '', updatedAt: '', template: { draftId: 'run-template' } }] } as unknown as MailStore

  it('a person\'s own message, by their own click', () => {
    expect(heldCopySendRefusal(store, { id: 'draft_compose_mine' })).toBeNull()
  })

  it('never the team\'s drafts, under the id made for them or brought back from the account\'s listing', () => {
    const ids = executiveDraftIds('key-1')
    expect(heldCopySendRefusal(store, { id: ids.draftId })).toMatch(/Nothing was sent/)
    expect(heldCopySendRefusal(store, { id: ids.replyDraftId })).toMatch(/Nothing was sent/)
    const header = imapDraftMessageId({ id: ids.replyDraftId })
    expect(isTeamDraft({ id: 'imap_draft_208', providerDraftMessageIdHeader: header })).toBe(true)
    expect(heldCopySendRefusal(store, { id: 'imap_draft_208', providerDraftMessageIdHeader: header })).toMatch(/Nothing was sent/)
    expect(isTeamDraft({ id: 'imap_draft_9', providerDraftMessageIdHeader: '<someone-else@example.com>' })).toBe(false)
  })

  it('never a send run\'s drafts', () => {
    expect(heldCopySendRefusal(store, { id: 'run-item' })).toMatch(/Send runs/)
    expect(heldCopySendRefusal(store, { id: 'run-template' })).toMatch(/Send runs/)
  })

  it('never for an agent: the sending tools refuse, and reading stays', async () => {
    const send = vi.fn(async () => 'sent')
    const read = vi.fn(async () => 'read')
    const handlers = { sendDraft: send, sendRunItem: send, createRun: send, resumeRun: send, renderRun: send, createRunFromDrafts: send, getMailContext: read, getRun: read }
    const held = refusingSendsWhenHeld(true, handlers)
    for (const name of ['sendDraft', 'sendRunItem', 'createRun', 'resumeRun', 'renderRun', 'createRunFromDrafts'] as const) {
      await expect(held[name]()).rejects.toThrow(/does not send mail or run send runs/)
    }
    expect(send).not.toHaveBeenCalled()
    await expect(held.getMailContext()).resolves.toBe('read')
    await expect(held.getRun()).resolves.toBe('read')
    expect(refusingSendsWhenHeld(false, handlers)).toBe(handlers)
  })
})

describe('when a held copy fetches', () => {
  const now = Date.parse('2026-11-02T12:00:00.000Z')
  it('not while a tab has synced within the interval', () => {
    expect(heldCopyFetchDue('2026-11-02T11:58:00.000Z', 5, now)).toBe(false)
    expect(heldCopyFetchDue('2026-11-02T11:53:30.000Z', 5, now)).toBe(false)
  })
  it('when nothing has synced for the interval and more, or ever', () => {
    expect(heldCopyFetchDue('2026-11-02T11:50:00.000Z', 5, now)).toBe(true)
    expect(heldCopyFetchDue(undefined, 5, now)).toBe(true)
  })
})
