// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyDraftsFileChanges } from './draftsFileMerge'
import { existingExecutiveDraft, reportExecutiveDraftStates, takeExecutiveDiscards, parseDraftState, type ExecutiveShareFiles } from './executiveShare'
import { imapDraftMessageId } from './mailDeliveryStatus'
import { emptyMailStore, mergeMailProviderSyncResult } from './mailModel'
import type { Draft, MailAccount, MailStore, MailThread } from '../types'

const KEY = 'pure-science-cos-20261102-0450-1'
const LOCAL_ID = `draft_reply_exec-${KEY}`
const HEADER = imapDraftMessageId({ id: LOCAL_ID })
const ACCOUNT = { id: 'acc', provider: 'imap', name: 'Adam', email: 'adam@example.com', syncState: 'online' } as MailAccount
const thread = (id: string): MailThread => ({ id, accountId: 'acc', mailboxId: 'mb', subject: 's', participants: [], labels: [], status: 'inbox', priority: 'none', summary: '', lastMessageAt: '2026-11-02T22:00:00.000Z', syncState: 'synced' })

/** The team's reply as Mail made it, then as the account saved it. */
const local: Draft = {
  id: LOCAL_ID, threadId: 'thread_barbara', to: [{ name: 'Barbara', email: 'barbara@example.com' }], subject: 'Re: terms', body: 'Dear Barbara',
  attachments: [], updatedAt: '2026-11-02T22:02:53.000Z', syncState: 'pending', sourceMessageId: 'msg_barbara',
}
const pushed: Draft = { ...local, syncState: 'synced', providerDraftId: 'imap_draft_208' }
/** The same message as an IMAP listing reports it: its own id, a thread made from its headers. */
const listed: Draft = {
  ...local, id: 'imap_draft_208', threadId: 'imap_thread_puremaildraft', sourceMessageId: undefined, providerDraftId: 'imap_draft_208', providerDraftMessageId: 'imap_msg_Drafts_208',
  providerDraftMessageIdHeader: HEADER, updatedAt: '2026-11-02T22:02:55.000Z', syncState: 'synced', provenance: ['Written outside PureMail; synced from the account.'],
}

const store = (drafts: Draft[], threads = [thread('thread_barbara')]): MailStore => ({ ...emptyMailStore(), accounts: [ACCOUNT], threads, drafts })
const listing = (drafts: Draft[], covered = true): MailStore => ({
  ...store(drafts, [thread('imap_thread_puremaildraft'), thread('thread_barbara')]), syncCoverage: { draftsCovered: covered },
})
const ids = (value: MailStore) => value.drafts.map(item => item.id)

describe('a draft keeps its identity across provider sync', () => {
  it('a listing that began before the save does not show it, and that does not replace it', () => {
    // Pushed at 22:02:55, while a listing begun earlier was running.
    const afterStale = mergeMailProviderSyncResult(store([pushed]), listing([]))
    expect(ids(afterStale)).toEqual([LOCAL_ID])
    const afterNext = mergeMailProviderSyncResult(afterStale, listing([listed]))
    expect(ids(afterNext)).toEqual([LOCAL_ID])
    expect(afterNext.drafts[0]).toMatchObject({ threadId: 'thread_barbara', sourceMessageId: 'msg_barbara', providerDraftId: 'imap_draft_208' })
  })

  it('gone from two listings in a row is really gone at the provider', () => {
    const once = mergeMailProviderSyncResult(store([pushed]), listing([]))
    expect(ids(mergeMailProviderSyncResult(once, listing([])))).toEqual([])
  })

  it('a listing that could not cover drafts counts for nothing', () => {
    const once = mergeMailProviderSyncResult(store([pushed]), listing([], false))
    expect(ids(mergeMailProviderSyncResult(once, listing([])))).toEqual([LOCAL_ID])
  })

  it('a draft still pending is not flagged as lost by one stale listing', () => {
    const edited = { ...pushed, syncState: 'pending' as const, body: 'Dear Barbara, more' }
    const after = mergeMailProviderSyncResult(store([edited]), listing([]))
    expect(after.drafts[0]).toMatchObject({ syncState: 'pending', body: 'Dear Barbara, more' })
    expect(after.drafts[0].providerSaveUncertain).toBeFalsy()
  })

  it('a listing that lands before the save is acknowledged links to the draft, not a second record', () => {
    const after = mergeMailProviderSyncResult(store([local]), listing([listed]))
    expect(ids(after)).toEqual([LOCAL_ID])
    expect(after.drafts[0]).toMatchObject({ providerDraftId: 'imap_draft_208', threadId: 'thread_barbara', sourceMessageId: 'msg_barbara', body: 'Dear Barbara' })
  })

  it('a store without the draft imports it under the id its Message-ID names', () => {
    const after = mergeMailProviderSyncResult(store([]), listing([listed]))
    expect(ids(after)).toEqual([LOCAL_ID])
    expect(after.drafts[0].providerDraftId).toBe('imap_draft_208')
  })

  it('never makes two records with one id', () => {
    const older = { ...listed, id: 'imap_draft_207', providerDraftId: 'imap_draft_207', providerDraftMessageId: 'imap_msg_Drafts_207' }
    const after = mergeMailProviderSyncResult(store([]), listing([listed, older]))
    expect(new Set(ids(after)).size).toBe(2)
    expect(ids(after)).toContain(LOCAL_ID)
  })

  it('leaves a draft written elsewhere under its own id', () => {
    const elsewhere = { ...listed, providerDraftMessageIdHeader: '<abc@mail.example.com>' }
    expect(ids(mergeMailProviderSyncResult(store([]), listing([elsewhere])))).toEqual(['imap_draft_208'])
  })
})

describe('the executive share follows the draft, whatever its id', () => {
  const ROOT = '/org'
  const drafts = `${ROOT}/.appdata/executive/mail/drafts`
  const memory = (seed: Record<string, string>): { disk: Map<string, string>; files: ExecutiveShareFiles } => {
    const disk = new Map(Object.entries(seed))
    return { disk, files: {
      read: async path => disk.get(path) ?? null,
      write: async (path, text) => { disk.set(path, text) },
      list: async folder => [...disk.keys()].filter(path => path.startsWith(`${folder}/`)).map(path => path.slice(folder.length + 1)).filter(name => !name.includes('/')),
      rename: async (path, name) => { const value = disk.get(path); if (value === undefined) throw new Error('gone'); disk.delete(path); disk.set(`${path.slice(0, path.lastIndexOf('/'))}/${name}`, value) },
      remove: async path => { disk.delete(path) },
    } }
  }
  const taken = { [`${drafts}/taken/${KEY}.json`]: JSON.stringify({ key: KEY, draftId: LOCAL_ID, takenAt: '2026-11-02T22:02:53.000Z' }) }
  const NOW = Date.parse('2026-11-02T22:10:00.000Z')
  const state = (disk: Map<string, string>) => parseDraftState(disk.get(`${drafts}/state/${KEY}.json`) ?? null)

  it('finds a copy already imported under the provider’s id by its Message-ID', () => {
    expect(existingExecutiveDraft(store([listed]), KEY)?.id).toBe('imap_draft_208')
    expect(existingExecutiveDraft(store([listed, pushed]), KEY)?.id).toBe(LOCAL_ID)
    expect(existingExecutiveDraft(store([{ ...listed, providerDraftMessageIdHeader: '<abc@mail.example.com>' }]), KEY)).toBeNull()
  })

  it('reports the imported copy as the draft, not discarded and not missing', async () => {
    const { disk, files } = memory(taken)
    await reportExecutiveDraftStates({ files, root: ROOT, store: store([listed]), account: ACCOUNT, now: NOW, storeId: 'here' })
    expect(state(disk)).toMatchObject({ state: 'draft', draftId: 'imap_draft_208', body: 'Dear Barbara' })
  })

  it('finds it by provider id when the Message-ID says nothing, as Gmail does', async () => {
    const { disk, files } = memory({ ...taken, [`${drafts}/state/${KEY}.json`]: JSON.stringify({ v: 1, key: KEY, draftId: LOCAL_ID, state: 'draft', at: 'x', to: [], cc: [], subject: 's', body: 'b', version: 'v', providerDraftId: 'gmail_9' }) })
    const reimported = { ...listed, id: 'draft_gmail_9', providerDraftId: 'gmail_9', providerDraftMessageIdHeader: undefined }
    await reportExecutiveDraftStates({ files, root: ROOT, store: store([reimported]), account: ACCOUNT, now: NOW, storeId: 'here' })
    expect(state(disk)).toMatchObject({ state: 'draft', draftId: 'draft_gmail_9', providerDraftId: 'gmail_9' })
  })

  it('repairs a state an older build wrote as discarded', async () => {
    const { disk, files } = memory({ ...taken, [`${drafts}/state/${KEY}.json`]: JSON.stringify({ v: 1, key: KEY, draftId: LOCAL_ID, state: 'discarded', at: '2026-11-02T22:03:09.518Z', to: [], cc: [], subject: '', body: '', version: '' }) })
    await reportExecutiveDraftStates({ files, root: ROOT, store: store([listed]), account: ACCOUNT, now: NOW, storeId: 'here' })
    expect(state(disk)).toMatchObject({ state: 'draft', draftId: 'imap_draft_208' })
  })

  it('a store holding only an imported copy does not speak over the store that made the draft', async () => {
    const { disk, files } = memory(taken)
    await reportExecutiveDraftStates({ files, root: ROOT, store: store([pushed]), account: ACCOUNT, now: NOW, storeId: 'maker' })
    expect(state(disk)).toMatchObject({ draftId: LOCAL_ID, heldBy: 'maker' })
    await reportExecutiveDraftStates({ files, root: ROOT, store: store([listed]), account: ACCOUNT, now: NOW, storeId: 'other' })
    expect(state(disk)).toMatchObject({ draftId: LOCAL_ID, heldBy: 'maker' })
  })

  it('a No naming the imported copy discards that copy', async () => {
    const { disk, files } = memory({ [`${drafts}/discard/${KEY}.json`]: JSON.stringify({ v: 1, key: KEY, draftId: 'imap_draft_208' }) })
    const thrown: string[] = []
    const result = await takeExecutiveDiscards({ files, root: ROOT, store: store([listed]), instanceId: 'w1', now: NOW, discard: id => { thrown.push(id); return { ok: true } } })
    expect(result.refused).toEqual([])
    expect(thrown).toEqual(['imap_draft_208'])
    expect(state(disk)).toMatchObject({ state: 'discarded', discardedBy: 'request' })
  })
})

describe('applying another copy’s save does not change what identity it holds', () => {
  it('an imported copy of a draft another copy made becomes that draft', () => {
    const b = store([])
    const applied = applyDraftsFileChanges(b, { drafts: [pushed], removedDrafts: [], runs: [], removedRuns: [], scheduledSends: [], sentReceipts: [], recovery: { accounts: [], mailboxes: [], threads: [thread('thread_barbara')] } })
    expect(ids(applied)).toEqual([LOCAL_ID])
    expect(ids(mergeMailProviderSyncResult(applied, listing([listed])))).toEqual([LOCAL_ID])
  })
})
