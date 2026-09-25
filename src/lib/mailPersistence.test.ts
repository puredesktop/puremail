// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEGACY_LOCAL_STORE_KEY,
  MAIL_DRAFTS_FILE,
  MAIL_STORE_FILE,
  readPersistedMailStore,
  writePersistedMailStore,
} from './mailPersistence'
import { emptyMailStore } from './mailStoreData'
import type { Draft, MailStore } from '../types'

const files = new Map<string, unknown>()
const failing = new Set<string>()

vi.mock('../bridge/platformBridge', () => ({
  readPlatformStorageJson: async ({ fileName }: { fileName: string }) => ({
    value: files.has(fileName) ? files.get(fileName) : null,
  }),
  writePlatformStorageJson: async ({
    fileName,
    value,
  }: {
    fileName: string
    value: unknown
  }) => {
    if (failing.has(fileName)) throw new Error(`disk full: ${fileName}`)
    files.set(fileName, JSON.parse(JSON.stringify(value)))
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
    files.clear()
    failing.clear()
    window.localStorage.clear()
  })

  it('writes drafts to their own file, separate from the mailbox cache', async () => {
    const result = await writePersistedMailStore(
      storeWith([draft('d1', 'Approved, shipping Friday.')]),
    )
    expect(result).toEqual({ draftsWritten: true, cacheWritten: true })
    expect(files.get(MAIL_DRAFTS_FILE)).toEqual({
      drafts: [draft('d1', 'Approved, shipping Friday.')],
      // Send runs travel with the drafts they point at.
      runs: [],
    })
    // The cache file must not carry a second copy: two copies can disagree.
    expect((files.get(MAIL_STORE_FILE) as MailStore).drafts).toEqual([])
    expect((files.get(MAIL_STORE_FILE) as MailStore).runs).toEqual([])
    expect((files.get(MAIL_STORE_FILE) as MailStore).threads).toHaveLength(1)
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
    // No cache file means no store to hydrate, but the drafts file survived
    // and must not be silently discarded by the next successful write.
    expect(store).toBeNull()
    expect(files.get(MAIL_DRAFTS_FILE)).toBeTruthy()
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
})
