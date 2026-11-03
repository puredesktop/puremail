// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetStoreFileForTest,
  LEGACY_LOCAL_STORE_KEY,
  MAIL_DRAFTS_FILE,
  MAIL_STORE_FILE,
  readPersistedMailStore,
  writePersistedMailStore,
  writeDraftsFileBeforeUnload,
} from './mailPersistence'
import { applyDraftsFileChanges } from './draftsFileMerge'
import { emptyMailStore } from './mailStoreData'
import type { Draft, MailStore, ScheduledSend } from '../types'

const files = new Map<string, unknown>()
const failing = new Set<string>()
const unreadable = new Set<string>()
let omitReadVersions = false
/** The shell's version token: the content, as near as a test needs. */
const versionOf = (fileName: string) => (files.has(fileName) ? JSON.stringify(files.get(fileName)) : null)
/** Run once just before the next conditional write applies: another copy saving in between. */
const beforeWrite = { run: null as (() => void) | null }

vi.mock('../bridge/platformBridge', () => ({
  readPlatformStorageJson: async ({ fileName }: { fileName: string }) => {
    if (unreadable.has(fileName)) throw new Error(`Cannot read ${fileName}`)
    return { value: files.has(fileName) ? files.get(fileName) : null, ...(omitReadVersions ? {} : { version: versionOf(fileName) }) }
  },
  writePlatformStorageJson: async ({
    fileName,
    value,
    ifMatch,
  }: {
    fileName: string
    value: unknown
    ifMatch?: string | null
  }) => {
    if (failing.has(fileName)) throw new Error(`disk full: ${fileName}`)
    const interleave = beforeWrite.run
    beforeWrite.run = null
    interleave?.()
    if (ifMatch !== undefined && ifMatch !== versionOf(fileName)) return { conflict: true, version: versionOf(fileName) }
    files.set(fileName, JSON.parse(JSON.stringify(value)))
    return { conflict: false, version: versionOf(fileName) }
  },
}))

function draft(id: string, body: string): Draft {
  return {
    id,
    threadId: 'thread_1',
    to: [{ name: 'Mira', email: 'mira@example.com' }],
    subject: 'Re: Launch copy',
    body,
    attachments: [],
    updatedAt: '2026-08-19T10:00:00.000Z',
    syncState: 'pending',
  }
}

function storeWith(drafts: Draft[]): MailStore {
  return {
    ...emptyMailStore(),
    accounts: [
      {
        id: 'acc',
        provider: 'gmail',
        name: 'User',
        email: 'alex@example.com',
        syncState: 'online',
      },
    ],
    threads: [
      {
        id: 'thread_1',
        accountId: 'acc',
        mailboxId: 'mb_inbox',
        subject: 'Launch copy',
        participants: [],
        labels: [],
        status: 'inbox',
        priority: 'none',
        summary: 'summary',
        lastMessageAt: '2026-08-19T09:00:00.000Z',
        syncState: 'synced',
      },
    ],
    drafts,
  }
}

describe('mail persistence', () => {
  beforeEach(() => {
  omitReadVersions = false;
    forgetStoreFileForTest()
    files.clear()
    failing.clear()
    unreadable.clear()
    window.localStorage.clear()
  })

  it('writes drafts to their own file, separate from the mailbox cache', async () => {
    const result = await writePersistedMailStore(
      storeWith([draft('d1', 'Approved, shipping Friday.')]),
    )
    expect(result).toMatchObject({ draftsWritten: true, cacheWritten: true })
    expect(result.error).toBeUndefined()
    expect(files.get(MAIL_DRAFTS_FILE)).toMatchObject({
      drafts: [draft('d1', 'Approved, shipping Friday.')],
      // Send runs travel with the drafts they point at.
      runs: [],
      // So do the schedules that would send them: one write, so they cannot disagree.
      scheduledSends: [],
      sentReceipts: [],
      recovery: { accounts: storeWith([]).accounts, mailboxes: storeWith([]).mailboxes, threads: storeWith([]).threads },
    })
    // The cache file must not carry a second copy: two copies can disagree.
    expect((files.get(MAIL_STORE_FILE) as MailStore).drafts).toEqual([])
    expect((files.get(MAIL_STORE_FILE) as MailStore).runs).toEqual([])
    expect((files.get(MAIL_STORE_FILE) as MailStore).scheduledSends).toEqual([])
    expect((files.get(MAIL_STORE_FILE) as MailStore).threads).toHaveLength(1)
  })

  it('restores a definite draft-save failure after the toast and mailbox cache are gone', async () => {
    const failed = { ...draft('d1', 'Keep my reply.'), syncState: 'failed' as const, providerSaveError: 'No message with uid 93 in Drafts.' }
    await writePersistedMailStore(storeWith([failed]))
    files.delete(MAIL_STORE_FILE)
    const restored = await readPersistedMailStore()
    expect(restored.store?.drafts[0]).toEqual(failed)
  })

  it('round-trips send runs through the drafts file, tolerating older files without them', async () => {
    const run = {
      id: 'run_1',
      name: 'October invite',
      accountId: 'acct_1',
      status: 'paused' as const,
      fieldMap: { email: { column: 'Email' } },
      noteSlot: true,
      items: [
        { draftId: 'd1', status: 'sent' as const, sentAt: '2026-09-02T10:00:00.000Z' },
        { draftId: 'd2', status: 'pending' as const },
        { notAnItem: true } as unknown as { draftId: string; status: 'pending' },
      ],
      cursor: 1,
      createdAt: '2026-09-02T09:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    }
    await writePersistedMailStore({ ...storeWith([draft('d1', 'x')]), runs: [run] })
    const { store } = await readPersistedMailStore()
    expect(store?.runs).toHaveLength(1)
    expect(store?.runs?.[0]).toMatchObject({ id: 'run_1', status: 'paused', cursor: 1 })
    // The malformed item was dropped; the run survived.
    expect(store?.runs?.[0]?.items.map(item => item.draftId)).toEqual(['d1', 'd2'])
    // An older drafts file (no runs key) loads with no runs, not a crash.
    files.set(MAIL_DRAFTS_FILE, { drafts: [draft('d1', 'Still here.')] })
    const older = await readPersistedMailStore()
    expect(older.store?.drafts).toHaveLength(1)
    expect(older.store?.runs ?? []).toEqual([])
  })

  it('keeps drafts when the mailbox cache write fails', async () => {
    failing.add(MAIL_STORE_FILE)
    const result = await writePersistedMailStore(
      storeWith([draft('d1', 'Unsent and irreplaceable.')]),
    )
    expect(result.draftsWritten).toBe(true)
    expect(result.cacheWritten).toBe(false)
    expect(result.error).toContain('disk full')
    expect(files.get(MAIL_DRAFTS_FILE)).toBeTruthy()
  })

  it('reads drafts back even when the mailbox cache file is missing', async () => {
    files.set(MAIL_DRAFTS_FILE, { drafts: [draft('d1', 'Still here.')] })
    const { store } = await readPersistedMailStore()
    // The drafts file is recoverable even without a mailbox cache.
    expect(store?.drafts[0].body).toBe('Still here.')
    expect(files.get(MAIL_DRAFTS_FILE)).toBeTruthy()
  })

  it('recovers drafts and send receipts when reading the mailbox cache rejects', async () => {
    const current = storeWith([draft('d1', 'Irreplaceable writing')])
    current.messages = [{ id: 'sent-confirmation', threadId: 'thread_1',
      subject: 'Sent once', body: 'Hello', receivedAt: '2026-10-03T00:00:00Z', read: true,
      from: { name: 'Me', email: 'me@example.test' }, to: [], attachments: [],
      deliveryAccepted: true, sentDraftId: 'already-sent' }]
    await writePersistedMailStore(current)
    unreadable.add(MAIL_STORE_FILE)
    const { store } = await readPersistedMailStore()
    expect(store?.drafts[0].body).toBe('Irreplaceable writing')
    expect(store?.messages[0]).toMatchObject({ deliveryAccepted: true, sentDraftId: 'already-sent' })
    expect(store?.threads).toHaveLength(1)
  })

  it('keeps the exact transmitted MIME when Sent filing fails, independently of the cache', async () => {
    const current = storeWith([])
    const raw = 'Message-ID: <accepted@example.test>\r\nSubject: With attachment\r\n\r\nExact sent bytes'
    current.messages = [{ id: 'accepted', threadId: 'thread_1', subject: 'With attachment', body: 'Exact sent bytes', receivedAt: '2026-10-03T00:00:00Z', read: true, from: {name:'Me',email:'me@example.test'}, to: [], attachments: [], deliveryAccepted:true, sentCopyPresent:false, sentCopyMime:raw }]
    failing.add(MAIL_STORE_FILE)
    await writePersistedMailStore(current)
    expect((await readPersistedMailStore()).store?.messages[0].sentCopyMime).toBe(raw)
  })

  it('refuses to start an empty writable mailbox when the drafts file cannot be read', async () => {
    await writePersistedMailStore(storeWith([draft('d1', 'Keep this writing')]))
    unreadable.add(MAIL_DRAFTS_FILE)
    await expect(readPersistedMailStore()).rejects.toThrow('drafts')
    expect((files.get(MAIL_DRAFTS_FILE) as { drafts: Draft[] }).drafts[0].body).toBe('Keep this writing')
  })

  it.each([{}, { drafts: 'invalid' }, { drafts: [draft('good', 'Keep me'), { body: 'Damaged entry' }] }])('refuses a malformed authoritative drafts file: %j', async value => {
    files.set(MAIL_STORE_FILE, storeWith([]))
    files.set(MAIL_DRAFTS_FILE, value)
    await expect(readPersistedMailStore()).rejects.toThrow('drafts')
    expect(files.get(MAIL_DRAFTS_FILE)).toEqual(value)
  })

  it('recovers accepted send receipts even when the mailbox cache cannot be written', async () => {
    const current = storeWith([])
    current.messages = [{ id: 'accepted', threadId: current.threads[0].id,
      subject: 'Sent once', body: 'Hello', receivedAt: '2026-10-02T22:00:00Z', read: true,
      from: { name: 'Me', email: 'me@example.com' }, to: [], attachments: [],
      deliveryAccepted: true, sentDraftId: 'already-sent', messageIdHeader: '<stable@example.com>' }]
    failing.add(MAIL_STORE_FILE)
    await writePersistedMailStore(current)
    const { store } = await readPersistedMailStore()
    expect(store?.messages[0]).toMatchObject({ deliveryAccepted: true, sentDraftId: 'already-sent', messageIdHeader: '<stable@example.com>' })
    expect(store?.threads).toHaveLength(1)
  })

  it('recovers a new draft conversation when the older cache survives a failed write', async () => {
    await writePersistedMailStore(storeWith([]))
    const newer = storeWith([{ ...draft('new', 'New writing'), threadId: 'new-thread' }])
    newer.threads = [{ ...newer.threads[0], id: 'new-thread', subject: 'New conversation' }]
    failing.add(MAIL_STORE_FILE)
    await writePersistedMailStore(newer)
    const { store } = await readPersistedMailStore()
    expect(store?.drafts[0].threadId).toBe('new-thread')
    expect(store?.threads.find(thread => thread.id === 'new-thread')?.subject).toBe('New conversation')
    expect(store?.threads.map(thread => thread.id)).toContain('thread_1')
    expect(store?.accounts).toHaveLength(1)
  })

  it('repairs historical attachment-preparation errors without clearing genuine send uncertainty', async () => {
    files.set(MAIL_STORE_FILE, storeWith([]))
    files.set(MAIL_DRAFTS_FILE, { drafts: [
      { ...draft('attachment', 'Keep body'), sendState: 'uncertain', sendError: "Error invoking remote method 'shell:mailTransport:fetchAttachment': No message with uid 442 in Drafts" },
      { ...draft('smtp', 'Keep body'), sendState: 'uncertain', sendError: 'SMTP socket timed out after submission' },
    ] })
    const { store } = await readPersistedMailStore()
    expect(store?.drafts[0]).toMatchObject({ sendState: 'failed' })
    expect(store?.drafts[0].sendError).toContain('reattach the missing file')
    expect(store?.drafts[1]).toMatchObject({ sendState: 'uncertain' })
  })

  it('round-trips a store through write and read', async () => {
    await writePersistedMailStore(storeWith([draft('d1', 'Round trip.')]))
    const { store, migratedFromLocalStorage } = await readPersistedMailStore()
    expect(migratedFromLocalStorage).toBe(false)
    expect(store?.threads).toHaveLength(1)
    expect(store?.drafts.map(item => item.body)).toEqual(['Round trip.'])
  })

  it('migrates the legacy localStorage blob once, then retires it', async () => {
    window.localStorage.setItem(
      LEGACY_LOCAL_STORE_KEY,
      JSON.stringify(storeWith([draft('d_legacy', 'From localStorage.')])),
    )
    const first = await readPersistedMailStore()
    expect(first.migratedFromLocalStorage).toBe(true)
    expect(first.store?.drafts.map(item => item.id)).toEqual(['d_legacy'])

    await writePersistedMailStore(first.store as MailStore)
    // The quota-hogging blob is released only after both files land.
    expect(window.localStorage.getItem(LEGACY_LOCAL_STORE_KEY)).toBeNull()

    const second = await readPersistedMailStore()
    expect(second.migratedFromLocalStorage).toBe(false)
    expect(second.store?.drafts.map(item => item.id)).toEqual(['d_legacy'])
  })

  it('prefers the drafts file over any drafts left in the cache file', async () => {
    files.set(MAIL_STORE_FILE, {
      ...storeWith([draft('stale', 'An older copy.')]),
    })
    files.set(MAIL_DRAFTS_FILE, { drafts: [draft('fresh', 'The real one.')] })
    const { store } = await readPersistedMailStore()
    expect(store?.drafts.map(item => item.id)).toEqual(['fresh'])
  })

  it('merges receipts by local, Gmail, and RFC ids without conflating anonymous messages', async () => {
    const base = { threadId: 'thread_1', subject: 'Sent', body: 'Hello', receivedAt: '2026-10-03T00:00:00Z', read: true, from: { name: 'Me', email: 'me@example.test' }, to: [], attachments: [] }
    const receipts = [
      { ...base, id: 'same-id', deliveryAccepted: true },
      { ...base, id: 'gmail-receipt', gmailMessageId: 'gmail-1', deliveryAccepted: true },
      { ...base, id: 'rfc-receipt', messageIdHeader: '<mail@example.test>', deliveryAccepted: true },
    ]
    files.set(MAIL_STORE_FILE, { ...storeWith([]), messages: [
      { ...base, id: 'same-id' },
      { ...base, id: 'gmail-cache', gmailMessageId: 'gmail-1' },
      { ...base, id: 'rfc-cache', messageIdHeader: '<mail@example.test>' },
      { ...base, id: 'unrelated' },
    ] })
    files.set(MAIL_DRAFTS_FILE, { drafts: [], sentReceipts: receipts })
    const { store } = await readPersistedMailStore()
    expect(store?.messages.map(message => message.id)).toEqual(['unrelated', 'same-id', 'gmail-receipt', 'rfc-receipt'])
  })
})

/**
 * Each running copy of Mail is its own JavaScript realm over one file. Fresh
 * module instances stand in for those realms: what one copy holds in memory
 * the other cannot see.
 */
describe('two running copies of Mail over one drafts file', () => {
  type Copy = typeof import('./mailPersistence')
  const openCopy = async (): Promise<{ copy: Copy; store: MailStore }> => {
    vi.resetModules()
    const copy = await import('./mailPersistence')
    const { store } = await copy.readPersistedMailStore()
    return { copy, store: store! }
  }
  const draftsOnDisk = (): Draft[] => (files.get(MAIL_DRAFTS_FILE) as { drafts: Draft[] }).drafts
  const ids = (drafts: Draft[]) => drafts.map(item => item.id).sort()

  beforeEach(async () => {
    files.clear()
    failing.clear()
    unreadable.clear()
    await writePersistedMailStore(storeWith([draft('old', 'kept')]))
  })

  it('keeps a reply saved by one copy when a copy with an older view saves', async () => {
    const a = await openCopy()
    const b = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('barbara', 'Dear Barbara')] })
    expect(ids(draftsOnDisk())).toEqual(['barbara', 'old'])

    // The second copy opens with its older view and saves that view.
    await b.copy.writePersistedMailStore(b.store)

    expect(ids(draftsOnDisk())).toEqual(['barbara', 'old'])
    expect(draftsOnDisk().find(item => item.id === 'barbara')?.body).toBe('Dear Barbara')
  })

  describe('sends and schedules', () => {
    const schedule = (status: ScheduledSend['status']): ScheduledSend => ({ id: 'later', draftId: 'old', threadId: 'thread_1', sendAt: '2026-11-03T09:00:00.000Z', createdAt: '2026-11-02T09:00:00.000Z', status })
    const scheduledOnDisk = (): ScheduledSend[] => (files.get(MAIL_DRAFTS_FILE) as { scheduledSends: ScheduledSend[] }).scheduledSends

    it('an older copy saving cannot restart a schedule another copy stopped', async () => {
      await writePersistedMailStore({ ...storeWith([draft('old', 'kept')]), scheduledSends: [schedule('scheduled')] })
      const a = await openCopy()
      const b = await openCopy()
      expect(b.store.scheduledSends).toEqual([schedule('scheduled')])
      await a.copy.writePersistedMailStore({ ...a.store, scheduledSends: [schedule('cancelled')] })

      const result = await b.copy.writePersistedMailStore(b.store)

      expect(scheduledOnDisk()).toEqual([schedule('cancelled')])
      expect(result.draftChanges.scheduledSends).toEqual([schedule('cancelled')])
      expect(applyDraftsFileChanges(b.store, result.draftChanges).scheduledSends).toEqual([schedule('cancelled')])
      // And it survives the reopening that decides whether it fires.
      expect((await openCopy()).store.scheduledSends).toEqual([schedule('cancelled')])
    })

    it('an edit from a copy that did not know of a send cannot erase the record of it', async () => {
      const attempt = { id: 'a1', phase: 'submitting' as const, approved: 'fingerprint', at: '2026-11-02T09:00:00.000Z' }
      const a = await openCopy()
      const b = await openCopy()
      await a.copy.writePersistedMailStore({ ...a.store, drafts: [{ ...a.store.drafts[0]!, sendAttempt: attempt }] })

      await b.copy.writePersistedMailStore({ ...b.store, drafts: [{ ...b.store.drafts[0]!, body: 'edited there', updatedAt: '2026-11-02T10:00:00.000Z' }] })

      expect(draftsOnDisk()[0]).toMatchObject({ id: 'old', body: 'kept', sendAttempt: attempt })
    })
  })

  it('hands the older copy what the other saved, so it stops holding an old view', async () => {
    const a = await openCopy()
    const b = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('barbara', 'Dear Barbara')] })
    const result = await b.copy.writePersistedMailStore(b.store)
    expect(result.draftChanges.drafts.map(item => item.id)).toEqual(['barbara'])
    expect(applyDraftsFileChanges(b.store, result.draftChanges).drafts.map(item => item.id).sort()).toEqual(['barbara', 'old'])
  })

  it('a real delete in one copy is not undone by another copy still holding it', async () => {
    const a = await openCopy()
    const b = await openCopy()
    a.copy.recordDraftDiscard('old')
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [] })
    expect(draftsOnDisk()).toEqual([])

    const result = await b.copy.writePersistedMailStore(b.store)

    expect(draftsOnDisk()).toEqual([])
    expect(result.draftChanges.removedDrafts.map(item => item.id)).toEqual(['old'])
    expect(applyDraftsFileChanges(b.store, result.draftChanges).drafts).toEqual([])
    const reopened = await openCopy()
    expect(reopened.store.drafts).toEqual([])
    expect(reopened.copy.draftDiscardedAt('old')).toBeTruthy()
  })

  it('an edit made after another copy deleted the draft brings it back', async () => {
    const a = await openCopy()
    const b = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [] })
    const later = new Date(Date.now() + 60_000).toISOString()
    await b.copy.writePersistedMailStore({ ...b.store, drafts: [{ ...draft('old', 'typed after the delete'), updatedAt: later }] })
    expect(draftsOnDisk().map(item => item.body)).toEqual(['typed after the delete'])
  })

  it('two edits to one draft: the later edit stays, whichever copy saves last', async () => {
    const a = await openCopy()
    const b = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [{ ...draft('old', 'newer words'), updatedAt: '2026-08-19T12:00:00.000Z' }] })
    await b.copy.writePersistedMailStore({ ...b.store, drafts: [{ ...draft('old', 'older words'), updatedAt: '2026-08-19T11:00:00.000Z' }] })
    expect(draftsOnDisk().map(item => item.body)).toEqual(['newer words'])
  })

  it('removing a draft in memory with no real discard is a removal, not a discard', async () => {
    const a = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [] })
    expect(a.copy.draftDiscardedAt('old')).toBeUndefined()
  })

  it('a copy that changed nothing does not rewrite the file', async () => {
    const a = await openCopy()
    await a.copy.writePersistedMailStore(a.store)
    const before = files.get(MAIL_DRAFTS_FILE)
    const b = await openCopy()
    await b.copy.syncDraftsFile(b.store)
    expect(files.get(MAIL_DRAFTS_FILE)).toBe(before)
  })

  it('writes back a draft the file lost without a tombstone', async () => {
    const a = await openCopy()
    // An older build, or a restored file, drops it with no tombstone: absence is not a delete.
    files.set(MAIL_DRAFTS_FILE, { drafts: [] })
    await a.copy.syncDraftsFile(a.store)
    expect(draftsOnDisk().map(item => item.id)).toEqual(['old'])
  })

  it('merges again when another copy saves between its read and its write', async () => {
    const a = await openCopy()
    const other = { ...(files.get(MAIL_DRAFTS_FILE) as object), drafts: [draft('old', 'kept'), draft('b-new', 'from B')] }
    beforeWrite.run = () => files.set(MAIL_DRAFTS_FILE, other)
    const result = await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('a-new', 'from A')] })
    expect(ids(draftsOnDisk())).toEqual(['a-new', 'b-new', 'old'])
    expect(result.draftChanges.drafts.map(item => item.id)).toEqual(['b-new'])
  })

  it('gives up without losing anything when other copies keep saving', async () => {
    const a = await openCopy()
    let n = 0
    const keepSaving = () => {
      files.set(MAIL_DRAFTS_FILE, { ...(files.get(MAIL_DRAFTS_FILE) as object), drafts: [draft('old', 'kept'), draft(`b-${++n}`, 'from B')] })
      beforeWrite.run = keepSaving
    }
    beforeWrite.run = keepSaving
    const result = await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('a-new', 'from A')] })
    beforeWrite.run = null
    expect(result.draftsWritten).toBe(false)
    const retried = await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('a-new', 'from A')] })
    expect(retried.draftsWritten).toBe(true)
    expect(ids(draftsOnDisk())).toContain('a-new')
  })

  it('keeps send runs and delivery receipts another copy saved', async () => {
    const a = await openCopy()
    const b = await openCopy()
    const run = { id: 'run_1', name: 'Run', accountId: 'acc', status: 'draft', fieldMap: {}, noteSlot: false, items: [], cursor: 0, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z' } as unknown as NonNullable<MailStore['runs']>[number]
    const receipt = { id: 'msg_sent_1', threadId: 'thread_1', deliveryAccepted: true, attachments: [], from: { name: '', email: 'a@b.c' }, to: [], subject: 's', body: 'b', receivedAt: '2026-08-19T10:00:00.000Z' } as unknown as MailStore['messages'][number]
    await a.copy.writePersistedMailStore({ ...a.store, runs: [run], messages: [receipt] })
    await b.copy.writePersistedMailStore(b.store)
    const file = files.get(MAIL_DRAFTS_FILE) as { runs: Array<{ id: string }>; sentReceipts: Array<{ id: string }> }
    expect(file.runs.map(item => item.id)).toEqual(['run_1'])
    expect(file.sentReceipts.map(item => item.id)).toEqual(['msg_sent_1'])
  })

  it('never overwrites a drafts file it cannot read or understand', async () => {
    const a = await openCopy()
    unreadable.add(MAIL_DRAFTS_FILE)
    const failed = await a.copy.writePersistedMailStore({ ...a.store, drafts: [] })
    expect(failed.draftsWritten).toBe(false)
    unreadable.clear()
    expect(ids(draftsOnDisk())).toEqual(['old'])
    files.set(MAIL_DRAFTS_FILE, { drafts: 'not a list' })
    const refused = await a.copy.writePersistedMailStore({ ...a.store, drafts: [] })
    expect(refused.draftsWritten).toBe(false)
    expect(files.get(MAIL_DRAFTS_FILE)).toEqual({ drafts: 'not a list' })
  })

  it('leaves a draft saved moments ago by another copy for that copy to push', async () => {
    const a = await openCopy()
    const b = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('barbara', 'Dear Barbara')] })
    await b.copy.syncDraftsFile(b.store)
    expect(b.copy.draftHeldByAnotherCopy('barbara')).toBe(true)
    expect(b.copy.draftHeldByAnotherCopy('barbara', Date.now() + 120_000)).toBe(false)
    expect(a.copy.draftHeldByAnotherCopy('barbara')).toBe(false)
  })

  it('a stale provider listing dropping a draft that just arrived is not a delete', async () => {
    const a = await openCopy()
    const b = await openCopy()
    const pushed = { ...draft('pushed', 'Dear Barbara'), providerDraftId: 'gmail_1', syncState: 'synced' as const }
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, pushed] })
    const arrived = applyDraftsFileChanges(b.store, await b.copy.syncDraftsFile(b.store))
    expect(ids(arrived.drafts)).toEqual(['old', 'pushed'])
    // B's listing began before A pushed, and mergeMailDrafts drops it as gone at the provider.
    const result = await b.copy.writePersistedMailStore({ ...arrived, drafts: arrived.drafts.filter(item => item.id !== 'pushed') })
    expect(ids(draftsOnDisk())).toEqual(['old', 'pushed'])
    expect(result.draftChanges.drafts.map(item => item.id)).toEqual(['pushed'])
  })

  it('a discard of a draft that just arrived is still a discard', async () => {
    const a = await openCopy()
    const b = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [...a.store.drafts, draft('barbara', 'Dear Barbara')] })
    const arrived = applyDraftsFileChanges(b.store, await b.copy.syncDraftsFile(b.store))
    b.copy.recordDraftDiscard('barbara')
    await b.copy.writePersistedMailStore({ ...arrived, drafts: arrived.drafts.filter(item => item.id !== 'barbara') })
    expect(ids(draftsOnDisk())).toEqual(['old'])
    expect(b.copy.draftDiscardedAt('barbara')).toBeTruthy()
  })

  it('one store id, whichever copy opened first', async () => {
    const a = await openCopy()
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [draft('x', 'y')] })
    const b = await openCopy()
    expect(b.copy.draftsStoreId()).toBe(a.copy.draftsStoreId())
  })
})

describe('two copies where the second only knows the draft from the provider listing', () => {
  it('stays one draft on its real thread, not a second record on a made-up one', async () => {
    const openCopy = async () => {
      vi.resetModules()
      const copy = await import('./mailPersistence')
      return { copy, store: (await copy.readPersistedMailStore()).store! }
    }
    files.clear(); failing.clear(); unreadable.clear()
    await writePersistedMailStore(storeWith([]))
    const a = await openCopy()
    const b = await openCopy()
    const made = { ...draft('draft_reply_exec-k', 'Dear Barbara'), providerDraftId: 'imap_draft_208', syncState: 'synced' as const, sourceMessageId: 'msg_1' }
    await a.copy.writePersistedMailStore({ ...a.store, drafts: [made] })
    // B opened before the draft was made, and its listing shows the account's copy.
    const imported = { ...made, threadId: 'imap_thread_synthetic', sourceMessageId: undefined, updatedAt: '2026-08-19T10:00:05.000Z', provenance: ['Written outside PureMail; synced from the account.'], importedFromProvider: true }
    await b.copy.writePersistedMailStore({ ...b.store, drafts: [imported] })
    const onDisk = (files.get(MAIL_DRAFTS_FILE) as { drafts: Draft[] }).drafts
    expect(onDisk.map(item => item.id)).toEqual(['draft_reply_exec-k'])
    expect(onDisk[0]).toMatchObject({ threadId: 'thread_1', sourceMessageId: 'msg_1' })
  })
})

it('a current fast exit uses its agreed version and saves the last words without an awaited read', async () => {
  const original = storeWith([draft('exit-current', 'Before')])
  await writePersistedMailStore(original)
  await readPersistedMailStore()
  writeDraftsFileBeforeUnload({ ...original, drafts: [draft('exit-current', 'Last words')] })
  await Promise.resolve()
  expect((files.get(MAIL_DRAFTS_FILE) as { drafts: Draft[] }).drafts[0]!.body).toBe('Last words')
})

it('a host without version evidence gets no unsafe fast exit write', async () => {
  const original = storeWith([draft('exit-no-version', 'Durable words')])
  await writePersistedMailStore(original)
  omitReadVersions = true
  await readPersistedMailStore()
  const before = JSON.stringify(files.get(MAIL_DRAFTS_FILE))
  writeDraftsFileBeforeUnload({ ...original, drafts: [draft('exit-no-version', 'Only here')] })
  await Promise.resolve()
  expect(JSON.stringify(files.get(MAIL_DRAFTS_FILE))).toBe(before)
})
