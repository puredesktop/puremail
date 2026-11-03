// @vitest-environment happy-dom
import { attachmentReceiptHash } from './mailAttachmentIdentity'
import { parsedSentReceipt } from '../test/parsedSentReceipt'
import { compactPersistedMessage } from './mailStoreData'
import { draftEditVersion } from './mailDrawerDrafts'
import { updateDraftHandler } from '../agents/handlers'
import type { MailAgentToolContext } from '../agents/catalog'
import { lateReceiptAttachmentCases } from '../test/lateReceiptAttachments'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { draftDelivery, holdDraftForSend } from './mailDeliveryStatus'
import { createScheduledSendDispatcher } from '../hooks/useScheduledSends'
import { createMailDeliveryController } from './mailDelivery'
import { draftSendFingerprint } from './mailDrawerDrafts'
import { recoverInterruptedSends } from './mailRuns'
import { mergeMailProviderSyncResult } from './mailModel'
import { markScheduledSend, scheduleSend } from './mailScheduledSend'
import { createStoreDraftSender } from './mailSendRelease'
import type { Draft, MailMessage, MailProvider, MailStore, MailTask, ScheduledSend, QueuedMailAction } from '../types'

/**
 * Two running copies of Mail (a tab and a mini app) over the same files. Each copy is its own
 * load of the real modules, as each is its own JavaScript realm, and all of them use one fake
 * of the shell's store: JSON on disk, a version from the content, ifMatch checked at write.
 * No provider is involved anywhere here, so nothing can be sent.
 */
const files = new Map<string, string>()
const version = (raw: string) => createHash('sha256').update(raw).digest('hex').slice(0, 12)
let writes: string[] = []
/** Run once just before the next write applies: another copy saving in between. */
const beforeWrite = { run: null as (() => void) | null }

const shellStore = {
  readPlatformStorageJson: async ({ fileName }: { fileName: string }) => {
    const raw = files.get(fileName)
    return { path: `/fake/.appdata/${fileName}`, value: raw === undefined ? null : JSON.parse(raw), version: raw === undefined ? null : version(raw) }
  },
  writePlatformStorageJson: async ({ fileName, value, ifMatch }: { fileName: string; value: unknown; ifMatch?: string | null }) => {
    const interleave = beforeWrite.run
    beforeWrite.run = null
    interleave?.()
    const raw = files.get(fileName)
    if (ifMatch !== undefined && ifMatch !== (raw === undefined ? null : version(raw))) return { conflict: true, version: raw === undefined ? null : version(raw) }
    const next = JSON.stringify(value)
    files.set(fileName, next)
    writes.push(fileName)
    return { conflict: false, version: version(next) }
  },
}
vi.mock('../bridge/platformBridge', () => ({
  ...shellStore,
  fsCreateFolder: async () => '/fake',
  fsDelete: async () => undefined,
  fsWriteText: async () => undefined,
}))

const onDisk = (): MailStore => JSON.parse(files.get('mail-store.json') ?? 'null')
const task = (id: string, patch: Partial<MailTask> = {}): MailTask => ({
  id, taskListId: 'list', title: id, notes: '', status: 'open', priority: 'normal', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', syncState: 'local', source: { kind: 'manual' }, ...patch,
} as unknown as MailTask)
const scheduled = (id: string, status: ScheduledSend['status']): ScheduledSend => ({ id, draftId: `draft-${id}`, threadId: 'thread', sendAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-31T00:00:00.000Z', status })
const queued = (id: string): QueuedMailAction => ({ id, type: 'archive', threadId: 'thread', queuedAt: '2026-11-01T00:00:00.000Z', attempts: 0 })

/** Real modules, fresh for this copy. What another copy saved comes back to be taken in, as the running app does. */
async function openCopy() {
  vi.resetModules()
  const persistence = await import('./mailPersistence')
  const drafts = await import('./draftsFileMerge')
  const cache = await import('./storeFileMerge')
  const { store } = await persistence.readPersistedMailStore()
  const copy = {
    memory: store as MailStore,
    edit(update: (store: MailStore) => MailStore) { copy.memory = update(copy.memory) },
    async save() {
      const result = await persistence.writePersistedMailStore(copy.memory)
      expect(result.error).toBeUndefined()
      copy.memory = drafts.applyDraftsFileChanges(copy.memory, result.draftChanges)
      copy.memory = cache.applyStoreFileChanges(copy.memory, result.cacheChanges)
    },
    exit() { persistence.writeDraftsFileBeforeUnload(copy.memory) },
    async discard(id: string, persist = true) {
      persistence.recordDraftDiscard(id)
      copy.edit(store => ({ ...store, drafts: store.drafts.filter(draft => draft.id !== id) }))
      if (persist) await copy.save()
    },
    /** A copy left open looks for what the others saved, without having changed anything. */
    async look() {
      copy.memory = cache.applyStoreFileChanges(copy.memory, await persistence.syncStoreFile(copy.memory))
    },
  }
  return copy
}
async function seeded(patch: Partial<MailStore> = {}): Promise<void> {
  files.set('mail-store.json', JSON.stringify({ ...demoMailStore(), drafts: [], runs: [], tasks: [], scheduledSends: [], queuedActions: [], ...patch }))
}
const ids = (items: ReadonlyArray<{ id: string }> | undefined) => (items ?? []).map(item => item.id).sort()

describe('mail-store.json with two copies of Mail', () => {
  beforeEach(() => { files.clear(); writes = []; beforeWrite.run = null })

  it('a copy saving between the read and the write makes the merge run again', async () => {
    await seeded({ tasks: [task('one')] })
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, tasks: [...store.tasks, task('from-a')] }))
    beforeWrite.run = () => {
      const disk = onDisk()
      files.set('mail-store.json', JSON.stringify({ ...disk, tasks: [...disk.tasks, task('slipped-in')] }))
    }
    await a.save()
    expect(ids(onDisk().tasks)).toEqual(['from-a', 'one', 'slipped-in'])
    expect(ids(a.memory.tasks)).toEqual(['from-a', 'one', 'slipped-in'])
    b.edit(store => store)
  })

  it('adding different records in each copy keeps both', async () => {
    await seeded()
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, tasks: [...store.tasks, task('from-a')] }))
    await a.save()
    b.edit(store => ({ ...store, tasks: [...store.tasks, task('from-b')] }))
    await b.save()
    expect(ids(onDisk().tasks)).toEqual(['from-a', 'from-b'])
  })

  it('editing different records in each copy keeps both', async () => {
    await seeded({ tasks: [task('one'), task('two')] })
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, tasks: store.tasks.map(item => item.id === 'one' ? { ...item, title: 'edited by A' } : item) }))
    await a.save()
    b.edit(store => ({ ...store, tasks: store.tasks.map(item => item.id === 'two' ? { ...item, title: 'edited by B' } : item) }))
    await b.save()
    const titles = Object.fromEntries(onDisk().tasks.map(item => [item.id, item.title]))
    expect(titles).toEqual({ one: 'edited by A', two: 'edited by B' })
  })

  it('a record deleted in one copy is not brought back by another saving', async () => {
    await seeded({ tasks: [task('stays'), task('deleted')] })
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, tasks: store.tasks.filter(item => item.id !== 'deleted') }))
    await a.save()
    b.edit(store => ({ ...store, tasks: [...store.tasks, task('new-in-b')] }))
    await b.save()
    expect(ids(onDisk().tasks)).toEqual(['new-in-b', 'stays'])
    expect(ids(b.memory.tasks)).toEqual(['new-in-b', 'stays'])
    await b.save()
    expect(ids(onDisk().tasks)).toEqual(['new-in-b', 'stays'])
  })

  it('a record deleted here stays deleted when another copy still holds it unchanged', async () => {
    await seeded({ tasks: [task('stays'), task('deleted')] })
    const a = await openCopy(), b = await openCopy()
    b.edit(store => ({ ...store, tasks: store.tasks.filter(item => item.id !== 'deleted') }))
    await b.save()
    a.edit(store => ({ ...store, tasks: store.tasks.map(item => item.id === 'stays' ? { ...item, title: 'edited' } : item) }))
    await a.save()
    expect(ids(onDisk().tasks)).toEqual(['stays'])
    expect(onDisk().tasks[0].title).toBe('edited')
  })

  it('the same record edited in both keeps the newer edit, whichever saves last', async () => {
    await seeded({ tasks: [task('one'), task('two')] })
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, tasks: store.tasks.map(item => ({ ...item, title: item.id === 'one' ? 'newer' : 'older', updatedAt: item.id === 'one' ? '2026-11-02T12:00:00.000Z' : '2026-11-02T10:00:00.000Z' })) }))
    b.edit(store => ({ ...store, tasks: store.tasks.map(item => ({ ...item, title: item.id === 'one' ? 'older' : 'newer', updatedAt: item.id === 'one' ? '2026-11-02T10:00:00.000Z' : '2026-11-02T12:00:00.000Z' })) }))
    await a.save()
    await b.save()
    const titles = Object.fromEntries(onDisk().tasks.map(item => [item.id, item.title]))
    expect(titles).toEqual({ one: 'newer', two: 'newer' })
  })

  it('opening with an older snapshot and saving at once loses nothing', async () => {
    await seeded({ tasks: [task('edited'), task('deleted'), task('kept')], starredThreadIds: ['star-old'] })
    const stale = await openCopy()
    const a = await openCopy()
    a.edit(store => ({
      ...store,
      tasks: [...store.tasks.filter(item => item.id !== 'deleted').map(item => item.id === 'edited' ? { ...item, title: 'edited by A' } : item), task('added')],
      starredThreadIds: ['star-old', 'star-new'],
      settings: { ...store.settings, signature: 'from A' },
    }))
    await a.save()
    // The stale copy touches nothing of A's and saves straight away.
    stale.edit(store => ({ ...store, tasks: [...store.tasks, task('stale-adds')] }))
    await stale.save()
    const disk = onDisk()
    expect(ids(disk.tasks)).toEqual(['added', 'edited', 'kept', 'stale-adds'])
    expect(disk.tasks.find(item => item.id === 'edited')?.title).toBe('edited by A')
    expect(disk.starredThreadIds).toContain('star-new')
    expect(disk.settings.signature).toBe('from A')
  })

  it('opening with an older snapshot and changing nothing writes nothing over the other copy', async () => {
    await seeded({ tasks: [task('one')] })
    const stale = await openCopy()
    const a = await openCopy()
    a.edit(store => ({ ...store, tasks: [...store.tasks, task('from-a')], settings: { ...store.settings, signature: 'from A' } }))
    await a.save()
    await stale.save()
    expect(ids(onDisk().tasks)).toEqual(['from-a', 'one'])
    expect(onDisk().settings.signature).toBe('from A')
  })

  it('a scheduled send marked sent is never put back to scheduled, or it would go out twice', async () => {
    await seeded({ scheduledSends: [scheduled('due', 'scheduled')] })
    const tab = await openCopy(), held = await openCopy()
    tab.edit(store => ({ ...store, scheduledSends: store.scheduledSends!.map(entry => ({ ...entry, status: 'sent' as const })) }))
    await tab.save()
    held.edit(store => ({ ...store, starredThreadIds: ['anything'] }))
    await held.save()
    // Schedules live in the drafts file, with the drafts they would send.
    expect(JSON.parse(files.get('mail-drafts.json') ?? 'null').scheduledSends[0].status).toBe('sent')
    expect(onDisk().scheduledSends).toEqual([])
    // The next launch dispatches whatever the file says is still scheduled.
    const next = await openCopy()
    expect(next.memory.scheduledSends?.[0].status).toBe('sent')
  })

  it('a copy checking the saved record of a send does not lose what it has not taken in yet', async () => {
    await seeded({ tasks: [task('kept')] })
    const tab = await openCopy(), held = await openCopy()
    tab.edit(store => ({ ...store, tasks: [...store.tasks, task('from-tab')], drafts: [...store.drafts, { id: 'from-tab', threadId: 'thread', to: [], subject: '', body: 'words', attachments: [], updatedAt: '2026-11-01T00:00:00.000Z', syncState: 'pending' }] }))
    await tab.save()
    const persistence = await import('./mailPersistence')
    expect((await persistence.readSavedMailStore())?.drafts.map(item => item.id)).toEqual(['from-tab'])
    held.edit(store => ({ ...store, starredThreadIds: ['anything'] }))
    await held.save()
    expect(ids(onDisk().tasks)).toEqual(['from-tab', 'kept'])
    expect(JSON.parse(files.get('mail-drafts.json') ?? 'null').drafts.map((item: { id: string }) => item.id)).toEqual(['from-tab'])
    expect(ids(held.memory.tasks)).toEqual(['from-tab', 'kept'])
  })

  it('a queued action already replayed is not put back to replay again', async () => {
    await seeded({ queuedActions: [queued('archive-it')] })
    const tab = await openCopy(), held = await openCopy()
    tab.edit(store => ({ ...store, queuedActions: [] }))
    await tab.save()
    held.edit(store => ({ ...store, starredThreadIds: ['anything'] }))
    await held.save()
    expect(onDisk().queuedActions).toEqual([])
  })

  it('stars, seen times and settings merge item by item', async () => {
    await seeded({ starredThreadIds: ['both', 'a-removes'], querySeenAt: { 'in:inbox': '2026-11-01T00:00:00.000Z' } })
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, starredThreadIds: ['both', 'a-adds'], querySeenAt: { ...store.querySeenAt, 'in:sent': '2026-11-02T00:00:00.000Z' }, settings: { ...store.settings, signature: 'from A' } }))
    await a.save()
    b.edit(store => ({ ...store, starredThreadIds: [...store.starredThreadIds!, 'b-adds'], querySeenAt: { ...store.querySeenAt, 'in:trash': '2026-11-02T00:00:00.000Z' }, settings: { ...store.settings, fetchWindow: 'custom' } as unknown as MailStore['settings'] }))
    await b.save()
    const disk = onDisk()
    expect([...disk.starredThreadIds!].sort()).toEqual(['a-adds', 'b-adds', 'both'])
    expect(Object.keys(disk.querySeenAt!).sort()).toEqual(['in:inbox', 'in:sent', 'in:trash'])
    expect(disk.settings.signature).toBe('from A')
    expect((disk.settings as unknown as { fetchWindow: string }).fetchWindow).toBe('custom')
  })

  it('messages read and threads changed in one copy survive the other saving', async () => {
    await seeded()
    const a = await openCopy(), b = await openCopy()
    const message = a.memory.messages[0], thread = a.memory.threads[0]
    a.edit(store => ({ ...store, messages: store.messages.map(item => item.id === message.id ? { ...item, read: !item.read } : item), threads: store.threads.map(item => item.id === thread.id ? { ...item, subject: 'renamed in A' } : item) }))
    await a.save()
    b.edit(store => ({ ...store, labels: store.labels }))
    b.edit(store => ({ ...store, starredThreadIds: ['from-b'] }))
    await b.save()
    expect(onDisk().messages.find(item => item.id === message.id)?.read).toBe(!message.read)
    expect(onDisk().threads.find(item => item.id === thread.id)?.subject).toBe('renamed in A')
    expect(onDisk().starredThreadIds).toEqual(['from-b'])
  })

  it('a copy left open takes what another copy saved without changing anything itself', async () => {
    await seeded({ tasks: [task('one')] })
    const a = await openCopy(), b = await openCopy()
    a.edit(store => ({ ...store, tasks: [task('from-a')] }))
    await a.save()
    await b.look()
    expect(ids(b.memory.tasks)).toEqual(['from-a'])
    const version = files.get('mail-store.json')
    await b.look()
    expect(files.get('mail-store.json')).toBe(version)
  })

  it('a save with nothing changed since the copy last agreed with the file does not rewrite it', async () => {
    await seeded({ tasks: [task('one')] })
    const a = await openCopy()
    a.edit(store => ({ ...store, tasks: [task('two')] }))
    await a.save()
    writes = []
    await a.save()
    await a.save()
    expect(writes.filter(name => name === 'mail-store.json')).toEqual([])
  })
})

describe('the other whole-file stores, across frames that may not share a lock', () => {
  // Each copy is its own frame; a mini app nested in another app's frame may sit in another storage partition, where
  // navigator.locks is not the same lock. Reads and writes interleave here as they could then.
  beforeEach(() => {
    files.clear()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => Promise<unknown>) => run() } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('notes kept in two copies at the same moment are both kept (mail-annotations.json)', async () => {
    vi.resetModules()
    const a = await import('./readingRoomPersistence')
    vi.resetModules()
    const b = await import('./readingRoomPersistence')
    const add = (id: string) => (file: { byMessageId: Record<string, unknown> }) => ({ ...file, byMessageId: { ...file.byMessageId, [id]: { messageId: id, threadId: 't', subject: id, from: { name: 'Mira', email: 'mira@example.com' }, receivedAt: '2026-11-02T00:00:00.000Z', article: 'text', notes: [{ id: `note-${id}`, kind: 'private', quote: 'text', start: 0, end: 4, text: 'kept', createdAt: '2026-11-02T00:00:00.000Z' }], updatedAt: '2026-11-02T00:00:00.000Z' } } })
    await Promise.all([a.updateAnnotationsFile(add('from-a') as never), b.updateAnnotationsFile(add('from-b') as never)])
    const kept = JSON.parse(files.get('mail-annotations.json')!)
    expect(Object.keys(kept.byMessageId).sort()).toEqual(['from-a', 'from-b'])
  })

  it('triage decisions recorded in two copies at the same moment are both kept (mail-triage.json)', async () => {
    vi.resetModules()
    const a = await import('./triagePersistence')
    vi.resetModules()
    const b = await import('./triagePersistence')
    const add = (id: string) => (file: { version: 1; records: unknown[]; shadow: unknown[] }) => ({ file: { ...file, records: [...file.records, { threadId: id }] }, result: id })
    await Promise.all([a.updateTriageFile(add('from-a') as never), b.updateTriageFile(add('from-b') as never)])
    const kept = JSON.parse(files.get('mail-triage.json')!)
    expect(kept.records.map((record: { threadId: string }) => record.threadId).sort()).toEqual(['from-a', 'from-b'])
  })

  it('a compose request left while Mail takes the file stays queued (compose-intents.json)', async () => {
    vi.resetModules()
    const { takeComposeIntents } = await import('./composeIntents')
    const request = (email: string) => ({ to: [{ email }] })
    files.set('compose-intents.json', JSON.stringify({ entries: { a: request('mira@example.com') } }))
    beforeWrite.run = () => files.set('compose-intents.json', JSON.stringify({ entries: { a: request('mira@example.com'), b: request('sam@example.com') } }))
    expect(await takeComposeIntents()).toEqual([])
    expect(await takeComposeIntents()).toEqual(['mira@example.com', 'sam@example.com'])
    expect(JSON.parse(files.get('compose-intents.json')!).entries).toEqual({})
  })
})

describe('mail-drafts.json: a stale discard against a send', () => {
  beforeEach(() => { files.clear(); writes = []; beforeWrite.run = null })
  const draftsFile = () => JSON.parse(files.get('mail-drafts.json') ?? '{}') as { drafts: Draft[]; draftTombstones: Array<{ id: string }> }
  const attempt = (phase: 'held' | 'preparing' | 'submitting') => ({ id: 'attempt-1', phase, approved: 'x', at: '2026-11-02T10:00:00.000Z' })
  const threadId = () => demoMailStore().threads[0]!.id
  const plain = (): Draft => ({ id: 'letter', threadId: threadId(), to: [{ name: 'Ana', email: 'ana@example.test' }], cc: [], bcc: [], subject: 'Letter', body: 'Approved', attachments: [], updatedAt: '2026-11-02T09:00:00.000Z', syncState: 'pending' } as unknown as Draft)
  const onLetter = (copy: { edit: (update: (store: MailStore) => MailStore) => void }, patch: Partial<Draft>) => copy.edit(store => ({ ...store, drafts: store.drafts.map(item => (item.id === 'letter' ? { ...item, ...patch } : item)) }))
  /** A copy throwing the draft away from its old view, as the shell does: record the discard, drop the record. */
  const discard = async (persistence: Awaited<ReturnType<typeof openCopy>>) => {
    recordDiscard('letter')
    persistence.edit(store => ({ ...store, drafts: store.drafts.filter(item => item.id !== 'letter') }))
    await persistence.save()
  }
  let recordDiscard: (id: string) => void = () => {}
  const openOn = async () => {
    const copy = await openCopy()
    const { recordDraftDiscard } = await import('./mailPersistence')
    return { copy, record: recordDraftDiscard }
  }
  const start = async () => {
    await seeded()
    const a = await openOn()
    a.copy.edit(store => ({ ...store, drafts: [plain()] }))
    await a.copy.save()
    return a
  }
  const STATES: Array<[string, Partial<Draft>]> = [
    ['held', { sendAttempt: attempt('held') }],
    ['preparing', { sendAttempt: attempt('preparing') }],
    ['submitting', { sendAttempt: attempt('submitting'), sendState: 'uncertain', sendError: 'pending' }],
    ['unconfirmed', { sendState: 'uncertain', sendError: 'May have gone', sendSettledAttemptId: 'attempt-1' }],
  ]

  it.each(STATES)('%s, not yet saved when the other copy discarded: it stands in the file and in both copies', async (_name, patch) => {
    const a = await start()
    const b = await openOn()
    onLetter(a.copy, patch)
    recordDiscard = b.record
    await discard(b.copy)
    await a.copy.save()
    expect(draftsFile().drafts.find(item => item.id === 'letter')).toMatchObject(patch)
    expect(draftsFile().draftTombstones.map(item => item.id)).not.toContain('letter')
    expect(a.copy.memory.drafts.find(item => item.id === 'letter')).toMatchObject(patch)
    await b.copy.save()
    expect(b.copy.memory.drafts.find(item => item.id === 'letter')).toMatchObject(patch)
  })

  it.each(STATES)('%s, already in both baselines when a copy removed it: the saving copy keeps it and the remover gets it back', async (_name, patch) => {
    const a = await start()
    onLetter(a.copy, patch)
    await a.copy.save()
    const b = await openOn()
    expect(b.copy.memory.drafts.find(item => item.id === 'letter')).toMatchObject(patch)
    // A removal from a path with no guard of its own, or a build older than this one.
    b.copy.edit(store => ({ ...store, drafts: store.drafts.filter(item => item.id !== 'letter') }))
    await b.copy.save()
    await a.copy.save()
    expect(draftsFile().drafts.find(item => item.id === 'letter')).toMatchObject(patch)
    expect(draftsFile().draftTombstones.map(item => item.id)).not.toContain('letter')
    expect(a.copy.memory.drafts.find(item => item.id === 'letter')).toMatchObject(patch)
    await b.copy.save()
    expect(b.copy.memory.drafts.find(item => item.id === 'letter')).toMatchObject(patch)
    expect(draftDelivery(b.copy.memory, 'letter').state).not.toBe('none')
  })

  it('a confirmed send: the removal stands in every copy and the receipt is the answer', async () => {
    const a = await start()
    onLetter(a.copy, { sendAttempt: attempt('submitting'), sendState: 'uncertain', sendError: 'pending' })
    await a.copy.save()
    const b = await openOn()
    const receipt = { id: 'accepted', threadId: threadId(), from: { name: 'Me', email: 'me@example.test' }, to: [], subject: 'Letter', body: 'Approved', attachments: [], receivedAt: '2026-11-02T10:00:01.000Z', read: true, deliveryAccepted: true, sentDraftId: 'letter' } as unknown as MailStore['messages'][number]
    a.copy.edit(store => ({ ...store, drafts: store.drafts.filter(item => item.id !== 'letter'), messages: [...store.messages, receipt] }))
    await a.copy.save()
    await b.copy.save()
    expect(b.copy.memory.drafts.some(item => item.id === 'letter')).toBe(false)
    expect(draftDelivery(b.copy.memory, 'letter').state).toBe('submitted')
    await a.copy.save()
    expect(draftsFile().drafts.some(item => item.id === 'letter')).toBe(false)
  })

  it('a real discard of a free draft still removes it from the other copy, and says discarded', async () => {
    const a = await start()
    const b = await openOn()
    recordDiscard = b.record
    await discard(b.copy)
    expect(draftsFile().draftTombstones).toMatchObject([{ id: 'letter', reason: 'discarded' }])
    await a.copy.save()
    expect(a.copy.memory.drafts.some(item => item.id === 'letter')).toBe(false)
    expect(draftsFile().drafts.some(item => item.id === 'letter')).toBe(false)
  })
})

/**
 * Two copies, each with the real delivery controller wired to its own real save and take-in, as
 * the shell wires them, and one fake mail service between them: what reaches it is the only answer.
 */
describe('two copies sending over the real files', () => {
  beforeEach(() => { files.clear(); writes = []; beforeWrite.run = null })
  const threadId = () => demoMailStore().threads[0]!.id
  const letter = (patch: Partial<Draft> = {}): Draft => ({ id: 'letter', threadId: threadId(), to: [{ name: 'Ana', email: 'ana@example.test' }], cc: [], bcc: [], subject: 'Letter', body: 'Approved', attachments: [], updatedAt: '2026-11-02T09:00:00.000Z', syncState: 'pending', ...patch } as unknown as Draft)
  const accepted = (): MailMessage => ({ id: 'accepted', threadId: threadId(), from: { name: 'Me', email: 'me@example.test' }, to: [{ name: 'Ana', email: 'ana@example.test' }], subject: 'Letter', body: 'Approved', attachments: [], receivedAt: '2026-11-02T10:00:01.000Z', read: true } as unknown as MailMessage)
  const service = () => {
    const send = vi.fn(async (): Promise<MailMessage> => accepted())
    return { send, provider: { send } as unknown as MailProvider }
  }
  type Copy = Awaited<ReturnType<typeof openCopy>>
  const controller = (copy: Copy, prepare: (draft: Draft) => Promise<Draft> = async draft => ({ ...draft })) => createMailDeliveryController({ read: () => copy.memory, update: copy.edit, persist: async () => { await copy.save() }, prepare, release: () => {}, online: () => true })
  const record = (copy: Copy) => copy.memory.drafts.find(item => item.id === 'letter')
  /** Both copies open with the draft saved, and neither has anything the other lacks. */
  const twoCopies = async (patch: Partial<MailStore> = {}) => {
    await seeded()
    const a = await openCopy()
    a.edit(store => ({ ...store, drafts: [letter()], ...patch }))
    await a.save()
    const b = await openCopy()
    return { a, b }
  }
  const dispatcher = (copy: Copy, mail: ReturnType<typeof service>, notices: string[]) => {
    const going = new Set<string>()
    return createScheduledSendDispatcher({
      read: () => copy.memory, update: copy.edit, provider: () => mail.provider, online: () => true, localAccount: () => false, home: () => 'Fake',
      holdForDraft: () => undefined, isDraftSending: id => going.has(id), markDraftSending: (id, on) => { if (on) going.add(id); else going.delete(id) },
      deliver: (provider, draft) => controller(copy)(provider, draft), reportFailure: () => {}, notice: text => notices.push(text), record: () => {},
    })
  }
  const settle = async () => { for (let turn = 0; turn < 40; turn += 1) await new Promise(resolve => setTimeout(resolve, 0)) }

  it.each(['held', 'preparing', 'submitting', 'unconfirmed', 'receipt', 'stopped'] as const)('a stale exit cannot erase %s after its owner is interrupted without another save', async phase => {
    const scheduled = scheduleSend({ ...demoMailStore(), drafts: [letter()] }, { draftId: 'letter', threadId: threadId(), sendAt: '2026-11-02T08:00:00Z' })
    const { a, b } = await twoCopies({ scheduledSends: scheduled.scheduledSends })
    const mail = service()
    if (phase === 'receipt') await controller(a)(mail.provider, record(a)!)
    else a.edit(store => ({ ...store,
      drafts: store.drafts.map(draft => ({ ...draft, ...(phase === 'unconfirmed' ? { sendState: 'uncertain' as const, sendError: 'Unknown', sendSettledAttemptId: 'A' } : phase === 'stopped' ? { sendState: 'failed' as const, sendError: 'Undone', sendSettledAttemptId: 'A' } : { sendAttempt: { id: 'A', phase, approved: draftSendFingerprint(draft), at: '2026-11-02T10:00:00Z' } }) })),
      scheduledSends: store.scheduledSends!.map(entry => ({ ...entry, status: 'failed' as const, lastError: 'Stopped' })),
    }))
    await a.save()
    const durable = files.get('mail-drafts.json')
    b.edit(store => ({ ...store, drafts: [...store.drafts, letter({ id: 'later-words', subject: 'Later', body: 'Keep these words' })] }))
    b.exit() // no awaited read, and A never saves again
    await Promise.resolve()
    expect(files.get('mail-drafts.json')).toBe(durable)
    const calls = mail.send.mock.calls.length
    for (let n = 0; n < 3; n++) {
      const reopened = await openCopy()
      reopened.edit(store => recoverInterruptedSends(store))
      await reopened.save()
      for (const entry of reopened.memory.scheduledSends ?? []) dispatcher(reopened, mail, [])(entry.id)
      await settle()
      expect(draftDelivery(reopened.memory, 'letter').state).toBe(phase === 'receipt' ? 'submitted' : phase === 'stopped' ? 'not_submitted' : 'unconfirmed')
      expect(mail.send).toHaveBeenCalledTimes(calls)
    }
    // Normal Close/stash can await this merge, retaining words as well as evidence.
    await b.save()
    const reopened = await openCopy()
    expect(reopened.memory.drafts.find(draft => draft.id === 'later-words')?.body).toBe('Keep these words')
  })

  it.each(['before marker write', 'before marker acknowledgement', 'after dispatch'] as const)('stale exit %s, then interrupted owner: persisted marker blocks every reopen', async where => {
    const { a, b } = await twoCopies()
    const mail = service()
    let releaseSave!: () => void
    const bound = where === 'before marker write' ? { id: 'A-before-write', approved: draftSendFingerprint(record(a)!) } : undefined
    if (bound) {
      a.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendAttempt: { ...bound, at: '2026-11-02T10:00:00Z', phase: 'preparing' as const } })) }))
      await a.save()
    }
    let dispatched = false
    mail.send.mockImplementation(() => { dispatched = true; return new Promise(() => {}) })
    const deliver = createMailDeliveryController({ read: () => a.memory, update: a.edit, prepare: async draft => ({ ...draft }), persist: async () => { if (where === 'before marker write') await new Promise<void>(() => {}); await a.save(); if (where === 'before marker acknowledgement') await new Promise<void>(resolve => { releaseSave = resolve }) }, release: () => {}, online: () => true })
    void deliver(mail.provider, record(a)!, bound) // deliberately interrupted, no repair/settlement
    await settle()
    const durable = files.get('mail-drafts.json')
    expect(JSON.parse(durable!).drafts[0].sendAttempt.phase).toBe(where === 'before marker write' ? 'preparing' : 'submitting')
    expect(dispatched).toBe(where === 'after dispatch')
    b.exit()
    expect(files.get('mail-drafts.json')).toBe(durable)
    for (let n = 0; n < 3; n++) {
      const reopened = await openCopy()
      reopened.edit(store => recoverInterruptedSends(store))
      await reopened.save()
      expect(draftDelivery(reopened.memory, 'letter').state).toBe('unconfirmed')
      await expect(controller(reopened)(mail.provider, record(reopened)!)).rejects.toMatchObject({ outcome: 'uncertain' })
    }
    expect(mail.send).toHaveBeenCalledTimes(where === 'after dispatch' ? 1 : 0)
    expect(releaseSave === undefined).toBe(where !== 'before marker acknowledgement')
  })

  it.each(['held', 'preparing', 'submitting', 'undone', 'failed', 'uncertain'] as const)('a stale controller ends uncertain after the other copy has a newer %s decision: both identities survive the actual save and application', async phase => {
    const planned = scheduleSend({ ...demoMailStore(), drafts: [letter()] }, { draftId: 'letter', threadId: threadId(), sendAt: '2099-01-01T00:00:00Z' })
    const { a, b } = await twoCopies({ scheduledSends: planned.scheduledSends })
    const mail = service()
    let reject!: (error: Error) => void
    mail.send.mockImplementationOnce(() => new Promise((_resolve, refuse) => { reject = refuse }))
    const first = controller(a)(mail.provider, record(a)!).catch(error => error)
    await settle()
    const oldId = record(a)!.sendAttempt!.id
    await b.save()
    b.edit(store => recoverInterruptedSends(store))
    await b.save()
    // The person's explicit Sent check, then a fresh approval, in this other copy.
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendState: 'failed' as const, sendError: 'Checked Sent' })) }))
    b.edit(store => holdDraftForSend(store, 'letter', { id: 'B', approved: draftSendFingerprint(record(b)!), at: '1999-01-01T00:00:00Z' }))
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, ...(phase === 'held' || phase === 'preparing' || phase === 'submitting' ? { sendAttempt: { ...draft.sendAttempt!, phase } } : { sendAttempt: undefined, sendSettledAttemptId: 'B', ...(phase === 'undone' ? { sendUndoneAt: '1999-01-01T00:00:01Z' } : { sendState: phase, sendError: 'B outcome' }) }) })) }))
    await b.save()
    b.edit(store => ({ ...store, scheduledSends: store.scheduledSends!.map(entry => ({ ...entry, status: 'failed' as const, lastError: 'B stopped this schedule' })) }))
    await b.save()
    const newer = JSON.parse(JSON.stringify(record(b)!))
    const schedule = structuredClone(b.memory.scheduledSends)
    reject(new Error('A provider connection closed'))
    await first
    expect(record(a)).toMatchObject(newer)
    expect(record(a)!.sendUncertainties).toMatchObject([{ attemptId: oldId, reason: 'A provider connection closed' }])
    expect(draftDelivery(a.memory, 'letter').state).toBe('unconfirmed')
    await b.save()
    const reopened = await openCopy()
    expect(record(reopened)).toMatchObject(newer)
    expect(record(reopened)!.sendUncertainties).toMatchObject([{ attemptId: oldId, reason: 'A provider connection closed' }])
    expect(draftDelivery(reopened.memory, 'letter').state).toBe('unconfirmed')
    expect(reopened.memory.scheduledSends).toEqual(schedule)
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('a stale controller receives an older genuine receipt after a newer undone decision (different later words: %s): both remain durable', async differentWords => {
    const { a, b } = await twoCopies()
    const mail = service()
    let finish!: (message: MailMessage) => void
    mail.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = controller(a)(mail.provider, record(a)!)
    await settle()
    const oldId = record(a)!.sendAttempt!.id
    await b.save()
    b.edit(store => recoverInterruptedSends(store)); await b.save()
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendState: 'failed' as const, sendError: 'Checked Sent' })) }))
    if (differentWords) b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, body: 'Later words', subject: 'Later subject', bodyHtml: '<p><b>Later words</b></p>' })) }))
    b.edit(store => holdDraftForSend(store, 'letter', { id: 'B', approved: draftSendFingerprint(record(b)!), at: '1999-01-01T00:00:00Z' }))
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendAttempt: undefined, sendSettledAttemptId: 'B', sendUndoneAt: '1999-01-01T00:00:01Z' })) }))
    await b.save()
    finish(accepted()); await first
    const reopened = await openCopy()
    expect(record(reopened)).toMatchObject({ sendSettledAttemptId: 'B', sendUndoneAt: '1999-01-01T00:00:01Z' })
    expect(reopened.memory.messages.find(message => message.sentDraftId === 'letter')).toMatchObject({ sentAttemptId: oldId, deliveryAccepted: true })
    expect(draftDelivery(reopened.memory, 'letter').state).toBe('submitted')
    const later = reopened.memory.drafts.filter(draft => draft.id !== 'letter')
    expect(later).toHaveLength(differentWords ? 1 : 0)
    if (differentWords) expect(later[0]).toMatchObject({ body: 'Later words', subject: 'Later subject', bodyHtml: '<p><b>Later words</b></p>' })
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  describe.each([undefined, '<p>Approved</p>'])('receipt application with HTML %s', bodyHtml => {
    describe.each([true, false])('new approval after allowing retry: %s', approveAgain => {
      describe.each([false, true])('sender has taken in the edit before receipt: %s', caughtUp => {
        it.each(lateReceiptAttachmentCases)('two-copy receipt application: %s', async (_name, oldFiles, files, changed) => {
          const base = letter({ bodyHtml, attachments: oldFiles ?? files })
          const scheduled = scheduleSend({ ...demoMailStore(), drafts: [base] }, { draftId: 'letter', threadId: threadId(), sendAt: '2026-11-03T10:00:00Z' })
          const { a, b } = await twoCopies({ drafts: [base], scheduledSends: scheduled.scheduledSends })
          const mail = service()
          let finish!: (message: MailMessage) => void
          mail.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
          const first = controller(a)(mail.provider, record(a)!)
          await settle()
          const oldId = record(a)!.sendAttempt!.id
          await b.save()
          b.edit(store => recoverInterruptedSends(store)); await b.save()
          // Exact retry-button patch: permission to edit, with no implied approval.
          b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendUncertainties: draft.sendUncertainties?.map(entry => ({ ...entry, checkedAt: new Date().toISOString() })), sendState: 'failed' as const, sendError: 'You checked Sent and allowed another attempt. Open this draft to send it.' })) }))
          b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, attachments: files, updatedAt: new Date().toISOString() })) }))
          if (approveAgain) b.edit(store => holdDraftForSend(store, 'letter', { id: 'B', approved: draftSendFingerprint(record(b)!), at: '1999-01-01T00:00:00Z' }))
          if (approveAgain) b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendAttempt: undefined, sendState: 'failed' as const, sendError: 'Newer refusal', sendSettledAttemptId: 'B' })), scheduledSends: store.scheduledSends!.map(entry => ({ ...entry, status: 'failed' as const, lastError: 'Newer refusal' })) }))
          await b.save()
          const newerEvidence = { sendSettledAttemptId: record(b)!.sendSettledAttemptId, sendState: record(b)!.sendState, sendError: record(b)!.sendError }
          if (caughtUp) await a.save() // Ordinary drafts-file refresh before the service callback.
          finish({ ...accepted(), bodyHtml, attachments: oldFiles } as MailMessage); await first
          // Cache refresh is a legitimate application path too; it must retain the proof.
          await a.look(); await b.look()
          await b.save()
          for (let pass = 0; pass < 3; pass += 1) {
            const reopened = await openCopy()
            expect(record(reopened)).toMatchObject(newerEvidence)
            const receipt = reopened.memory.messages.find(message => message.sentDraftId === 'letter')!
            expect(receipt).toMatchObject({ sentAttemptId: oldId, deliveryAccepted: true })
            expect(receipt.attachments?.map(({ receiptContentHash: _hash, ...file }) => file)).toEqual(oldFiles?.map(({ content: _content, ...file }) => file))
            receipt.attachments?.forEach((file, index) => {
              if (file.receiptContentHash) expect(file.receiptContentHash).toBe(attachmentReceiptHash(oldFiles![index]))
            })
            expect(draftDelivery(reopened.memory, 'letter').state).toBe('submitted')
            expect(reopened.memory.scheduledSends![0]).toMatchObject(approveAgain ? { status: 'failed', lastError: 'Newer refusal' } : { status: 'unconfirmed' })
            const later = reopened.memory.drafts.filter(draft => draft.id !== 'letter')
            expect(later).toHaveLength(changed ? 1 : 0)
            if (changed) {
              expect(later[0]).toMatchObject({ subject: base.subject, to: base.to, body: base.body, attachments: files })
              expect(later[0].bodyHtml).toBe(bodyHtml)
              expect(later[0].sendAttempt).toBeUndefined()
              expect(draftDelivery(reopened.memory, later[0].id).state).toBe('none')
              expect(reopened.memory.scheduledSends!.some(entry => entry.draftId === later[0].id)).toBe(false)
            }
            await reopened.save()
          }
          expect(mail.send).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe.each(['gmail', 'imap'] as const)('receipt parsed by %s', provider => {
    describe.each(['plain', 'html', 'compacted html'] as const)('%s body', format => {
      it.each(['unchanged', 'body edit', 'recipient edit', 'To moved to Cc', 'Bcc added', 'HTML edit'] as const)('actual receipt sync preserves %s correctly', async change => {
        const html = format !== 'plain'
        const draft = letter({ to: [{ name: '', email: ' ANA@EXAMPLE.TEST ' }], body: ' \r\nHello\r\nNext\r\n ', bodyHtml: html ? ' \r\n<p>Hello</p>\r\n<p>Next</p>\r\n ' : undefined,
          sendState: 'failed', sendSettledAttemptId: 'B', sendSupersedes: ['A'], sendUncertainties: [{ attemptId: 'A', messageId: '<submitted-A>', reason: 'Unknown older send' }] })
        if (change === 'body edit') draft.body += 'Later words'
        if (change === 'recipient edit') draft.to = [{ name: '', email: 'other@example.test' }]
        if (change === 'To moved to Cc') { draft.cc = draft.to; draft.to = [] }
        if (change === 'Bcc added') draft.bcc = [{ name: '', email: 'private@example.test' }]
        if (change === 'HTML edit') draft.bodyHtml = '<p>Changed formatting and words</p>'
        const { a } = await twoCopies({ drafts: [draft] })
        let receipt = await parsedSentReceipt(provider, html)
        expect(receipt.to[0]).toEqual({ name: 'ana@example.test', email: 'ana@example.test' })
        if (format === 'compacted html') receipt = compactPersistedMessage({ ...receipt, deliveryAccepted: true })
        const sync = (store: MailStore) => mergeMailProviderSyncResult(store, { ...store, drafts: [], messages: [receipt] })
        a.edit(sync)
        expect(a.memory.drafts.filter(item => item.id !== 'letter')).toHaveLength(change === 'unchanged' ? 0 : 1)
        await a.save()
        for (let pass = 0; pass < 3; pass += 1) {
          const reopened = await openCopy()
          const later = reopened.memory.drafts.filter(item => item.id !== 'letter')
          expect(later).toHaveLength(change === 'unchanged' ? 0 : 1)
          if (later[0]) {
            expect(later[0]).toMatchObject({ body: draft.body, to: draft.to, cc: draft.cc, bcc: draft.bcc })
            expect(later[0].bodyHtml).toBe(draft.bodyHtml)
          }
          expect(reopened.memory.messages.some(message => message.deliveryAccepted && message.sentAttemptId === 'A')).toBe(true)
          reopened.edit(sync); await reopened.save()
        }
      })
    })
  })

  it('an agent edit of a known derived draft after another copy discarded it follows normal edit merging', async () => {
    const later = letter({ id: 'draft_compose_after_letter_A', body: 'Before', updatedAt: '2026-01-01T00:00:00Z' })
    const { a, b } = await twoCopies({ drafts: [later] })
    await a.discard(later.id)
    const context = { get store() { return b.memory }, editDraft: (id: string, patch: { body?: string }) => {
      b.edit(store => ({ ...store, drafts: store.drafts.map(draft => draft.id === id ? { ...draft, ...patch, updatedAt: '2099-01-01T00:00:00Z' } : draft) }))
      return { ok: true as const }
    } } as MailAgentToolContext
    updateDraftHandler(context, { draftId: later.id, expectedVersion: draftEditVersion(b.memory.drafts[0]), body: 'Real later agent edit' })
    await b.save()
    expect((await openCopy()).memory.drafts[0].body).toBe('Real later agent edit')
  })

  it('a pending discard before the first save beats a derived record another copy already saved', async () => {
    const later = letter({ id: 'draft_compose_after_letter_A' })
    const { a, b } = await twoCopies()
    a.edit(store => ({ ...store, drafts: [...store.drafts, later] }))
    b.edit(store => ({ ...store, drafts: [...store.drafts, later] })); await b.save()
    await a.discard(later.id)
    const reopened = await openCopy()
    expect(reopened.memory.drafts.some(draft => draft.id === later.id)).toBe(false)
    expect(JSON.parse(files.get('mail-drafts.json')!).draftTombstones).toContainEqual(expect.objectContaining({ id: later.id, reason: 'discarded' }))
  })

  it('a confirmed sent derived draft is not restored by a stale reconstruction', async () => {
    const earlier = letter({ body: 'Later words', sendSettledAttemptId: 'B', sendSupersedes: ['A'], sendUncertainties: [{ attemptId: 'A', messageId: '<submitted-A>', reason: 'Older unknown send' }] })
    const { a, b } = await twoCopies({ drafts: [earlier] })
    const receipt = { ...accepted(), messageIdHeader: '<submitted-A>' }
    const sync = (store: MailStore) => mergeMailProviderSyncResult(store, { ...store, drafts: [], messages: [receipt] })
    a.edit(sync); await a.save()
    const later = a.memory.drafts.find(draft => draft.id !== 'letter')!
    const mail = service()
    await controller(a)(mail.provider, later)
    b.edit(sync) // This copy has never agreed with the derived id on disk.
    for (let pass = 0; pass < 3; pass += 1) {
      await b.save()
      expect(b.memory.drafts.some(draft => draft.id === later.id)).toBe(false)
      expect((await openCopy()).memory.drafts.some(draft => draft.id === later.id)).toBe(false)
    }
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  describe.each([false, true])('a provider-sync result arrives after a discard (pending locally: %s)', pending => {
    it.each(lateReceiptAttachmentCases.slice(0, 3))('two-copy provider sync cannot resurrect %s', async (_name, oldFiles, replacement) => {
      const earlier = letter({
        attachments: replacement, updatedAt: '2099-01-01T00:00:00Z',
        sendState: 'failed', sendError: 'Checked Sent', sendSettledAttemptId: 'B', sendSupersedes: ['A'],
        sendUncertainties: [{ attemptId: 'A', messageId: '<submitted-A>', reason: 'Older confirmation missing' }],
      })
      const { a, b } = await twoCopies({ drafts: [earlier] })
      const receipt = { ...accepted(), messageIdHeader: '<submitted-A>', attachments: oldFiles }
      const sync = (store: MailStore) => mergeMailProviderSyncResult(store, { ...store, drafts: [], messages: [receipt] } as MailStore)
      // Capture the other/in-flight sync result before the discard, then apply it afterward.
      const delayed = sync(b.memory)
      a.edit(sync); await a.save()
      const later = a.memory.drafts.find(draft => draft.id !== 'letter')!
      expect(later.attachments).toEqual(replacement)
      expect(delayed.drafts.some(draft => draft.id === later.id)).toBe(true)
      await a.discard(later.id, !pending)
      const target = pending ? a : b
      target.edit(() => delayed)
      await target.save()
      expect(target.memory.drafts.some(draft => draft.id === later.id)).toBe(false)
      for (let pass = 0; pass < 3; pass += 1) {
        const reopened = await openCopy()
        expect(reopened.memory.drafts.some(draft => draft.id === later.id)).toBe(false)
        expect(reopened.memory.messages.some(message => message.deliveryAccepted && message.sentAttemptId === 'A')).toBe(true)
        expect(JSON.parse(files.get('mail-drafts.json')!).draftTombstones.some((t: { id: string; reason: string }) => t.id === later.id && t.reason === 'discarded')).toBe(true)
        await reopened.save()
      }
    })
  })

  it('allowing retry and editing words without another press also preserves an unsent draft', async () => {
    const { a, b } = await twoCopies()
    const mail = service()
    let finish!: (message: MailMessage) => void
    mail.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = controller(a)(mail.provider, record(a)!)
    await settle()
    await b.save()
    b.edit(store => recoverInterruptedSends(store)); await b.save()
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendUncertainties: draft.sendUncertainties?.map(entry => ({ ...entry, checkedAt: new Date().toISOString() })), sendState: 'failed' as const, sendError: 'You checked Sent and allowed another attempt. Open this draft to send it.' })) }))
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, body: 'Later words', updatedAt: new Date().toISOString() })) }))
    await b.save()
    finish(accepted()); await first // A has not looked or read B's edit before its callback.
    await b.save()
    for (let pass = 0; pass < 3; pass += 1) {
      const reopened = await openCopy()
      const later = reopened.memory.drafts.filter(draft => draft.id !== 'letter')
      expect(later).toHaveLength(1)
      expect(later[0].body).toBe('Later words')
      expect(draftDelivery(reopened.memory, later[0].id).state).toBe('none')
      await reopened.save()
    }
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it('persistence does not let an older receipt rewrite an already confirmed newer record', async () => {
    const newer = letter({ body: 'Newer confirmed words', sentAt: '2026-11-02T11:00:00Z', sentMessageId: 'confirmed-B', sendSettledAttemptId: 'B', sendSupersedes: ['A'] })
    const { a, b } = await twoCopies({ drafts: [newer], messages: [{ ...accepted(), id: 'confirmed-A', deliveryAccepted: true, sentDraftId: 'letter', sentAttemptId: 'A' }, { ...accepted(), id: 'confirmed-B', body: newer.body, receivedAt: newer.sentAt!, deliveryAccepted: true, sentDraftId: 'letter', sentAttemptId: 'B' }] })
    for (let pass = 0; pass < 3; pass += 1) {
      await a.save(); await b.save()
      const reopened = await openCopy()
      expect(record(reopened)).toEqual(newer)
      expect(reopened.memory.drafts).toHaveLength(1)
      expect(reopened.memory.messages.filter(message => message.sentAttemptId).map(message => message.sentAttemptId).sort()).toEqual(['A', 'B'])
    }
  })

  it('a stale third copy cannot resurrect a discarded replacement after the older receipt', async () => {
    const [_, oldFiles, replacement] = lateReceiptAttachmentCases[0]
    const { a, b } = await twoCopies({ drafts: [letter({ attachments: oldFiles! })] })
    const mail = service()
    let finish!: (message: MailMessage) => void
    mail.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = controller(a)(mail.provider, record(a)!)
    await settle()
    await b.save()
    b.edit(store => recoverInterruptedSends(store)); await b.save()
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, attachments: replacement, sendState: 'failed' as const, sendError: 'Checked Sent' })) }))
    b.edit(store => holdDraftForSend(store, 'letter', { id: 'B', approved: draftSendFingerprint(record(b)!), at: '1999-01-01T00:00:00Z' }))
    b.edit(store => ({ ...store, drafts: store.drafts.map(draft => ({ ...draft, sendAttempt: undefined, sendSettledAttemptId: 'B' })) }))
    await b.save()
    const stale = await openCopy() // holds replacement, but has never seen the receipt or later draft
    finish({ ...accepted(), attachments: oldFiles! }); await first
    const other = await openCopy()
    const later = other.memory.drafts.find(draft => draft.id !== 'letter')!
    expect(later.attachments).toEqual(replacement)
    await other.discard(later.id)
    for (let pass = 0; pass < 3; pass += 1) {
      await stale.save()
      expect(stale.memory.drafts.some(draft => draft.id === later.id)).toBe(false)
      const reopened = await openCopy()
      expect(reopened.memory.drafts.some(draft => draft.id === later.id)).toBe(false)
      expect(JSON.parse(files.get('mail-drafts.json')!).draftTombstones.some((t: { id: string }) => t.id === later.id)).toBe(true)
    }
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it('both copies dispatch one due schedule from the same view: one call, and the loser says nothing false', async () => {
    const store = scheduleSend({ ...demoMailStore(), drafts: [letter()] }, { draftId: 'letter', threadId: threadId(), sendAt: '2026-11-02T08:00:00.000Z' }, '2026-11-02T07:00:00.000Z')
    const { a, b } = await twoCopies({ scheduledSends: store.scheduledSends })
    const entry = a.memory.scheduledSends![0]!.id
    expect(b.memory.scheduledSends![0]!.status).toBe('scheduled')
    const mail = service()
    const notices: string[] = []
    dispatcher(a, mail, notices)(entry)
    dispatcher(b, mail, notices)(entry)
    await settle()
    expect(mail.send).toHaveBeenCalledTimes(1)
    await a.save(); await b.save(); await a.save()
    expect(draftDelivery(a.memory, 'letter').state).toBe('submitted')
    expect(draftDelivery(b.memory, 'letter').state).toBe('submitted')
    expect(record(a)).toBeUndefined()
    expect(record(b)).toBeUndefined()
    expect(b.memory.scheduledSends![0]!.status).toBe('sent')
    expect(notices.join()).not.toMatch(/failed/)
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a schedule\'s own dispatch, which stamps nothing', {}, undefined],
    ['a person\'s approved send, stamped later than the first copy\'s', { updatedAt: '2026-11-02T23:00:00.000Z' }, 'approved'],
  ])('%s, starting while another copy\'s marker is on file, stops before the mail service', async (_name, patch, bound) => {
    const { a, b } = await twoCopies()
    const mail = service()
    let finish!: (message: MailMessage) => void
    mail.send.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const first = controller(a)(mail.provider, record(a)!)
    await settle()
    expect(mail.send).toHaveBeenCalledTimes(1)
    const firstAttempt = JSON.parse(files.get('mail-drafts.json')!).drafts.find((item: Draft) => item.id === 'letter').sendAttempt
    expect(firstAttempt.phase).toBe('submitting')
    const attempt = bound ? { id: 'stale-window', approved: draftSendFingerprint(record(b)!) } : undefined
    if (bound) b.edit(store => ({ ...store, drafts: store.drafts.map(item => (item.id === 'letter' ? { ...item, ...patch, sendAttempt: { id: 'stale-window', phase: 'preparing' as const, approved: attempt!.approved, at: '2026-11-02T10:00:00.000Z' } } : item)) }))
    await expect(controller(b)(mail.provider, record(b)!, attempt)).rejects.toMatchObject({ superseded: true, outcome: 'not_sent' })
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(record(b)!.sendAttempt?.id).toBe(firstAttempt.id)
    expect(draftDelivery(b.memory, 'letter').state).toBe('submitting')
    finish(accepted())
    await first
    await b.save()
    expect(draftDelivery(b.memory, 'letter').state).toBe('submitted')
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unstamped', {}],
    ['stamped later than the removal', { updatedAt: '2099-01-01T00:00:00.000Z' }],
  ])('a stale copy sending a draft whose receipt is already on file, %s: no second call, and the draft goes', async (_name, patch) => {
    const { a, b } = await twoCopies()
    const mail = service()
    await controller(a)(mail.provider, record(a)!)
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(record(b)).toBeTruthy()
    b.edit(store => ({ ...store, drafts: store.drafts.map(item => (item.id === 'letter' ? { ...item, ...patch } : item)) }))
    await expect(controller(b)(mail.provider, record(b)!)).rejects.toMatchObject({ outcome: 'not_sent' })
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(record(b)).toBeUndefined()
    expect(draftDelivery(b.memory, 'letter').state).toBe('submitted')
  })

  it('a dispatch asleep in preparation, read as unconfirmed by the other copy: on waking it stops, and its own record shows nothing left', async () => {
    const store = scheduleSend({ ...demoMailStore(), drafts: [letter()] }, { draftId: 'letter', threadId: threadId(), sendAt: '2026-11-02T08:00:00.000Z' }, '2026-11-02T07:00:00.000Z')
    const { a, b } = await twoCopies({ scheduledSends: store.scheduledSends })
    const mail = service()
    const entry = b.memory.scheduledSends![0]!.id
    b.edit(current => markScheduledSend(current, entry, 'sending'))
    await b.save()
    let wake!: () => void
    const asleep = controller(b, draft => new Promise(resolve => { wake = () => resolve({ ...draft }) }))(mail.provider, record(b)!)
    await settle()
    await a.save()
    a.edit(current => recoverInterruptedSends(current))
    expect(draftDelivery(a.memory, 'letter').state).toBe('unconfirmed')
    await a.save()
    wake()
    await expect(asleep).rejects.toMatchObject({ outcome: 'not_sent' })
    expect(mail.send).not.toHaveBeenCalled()
    expect(draftDelivery(b.memory, 'letter').state).toBe('not_submitted')
    await a.save()
    expect(draftDelivery(a.memory, 'letter').state).toBe('not_submitted')
  })

  it('an approved send asleep in preparation, stamped as the sender stamps it, read as unconfirmed by the other copy: same', async () => {
    const { a, b } = await twoCopies()
    const mail = service()
    const approved = draftSendFingerprint(record(b)!)
    b.edit(store => ({ ...store, drafts: store.drafts.map(item => (item.id === 'letter' ? { ...item, updatedAt: '2099-01-01T00:00:00.000Z', sendAttempt: { id: 'asleep', phase: 'preparing' as const, approved, at: '2026-11-02T10:00:00.000Z' } } : item)) }))
    await b.save()
    let wake!: () => void
    const asleep = controller(b, draft => new Promise(resolve => { wake = () => resolve({ ...draft }) }))(mail.provider, record(b)!, { id: 'asleep', approved })
    await settle()
    await a.save()
    a.edit(current => recoverInterruptedSends(current))
    await a.save()
    wake()
    await expect(asleep).rejects.toMatchObject({ outcome: 'not_sent' })
    expect(mail.send).not.toHaveBeenCalled()
    expect(record(b)).toMatchObject({ sendState: 'failed', sendSettledAttemptId: 'asleep' })
  })

  it('a person\'s Send through the real sender, on a view with another copy\'s marker not yet read: one call', async () => {
    const { a, b } = await twoCopies()
    const mail = service()
    let finish!: (message: MailMessage) => void
    mail.send.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const first = controller(a)(mail.provider, record(a)!)
    await settle()
    const going = new Set<string>()
    const failed: string[] = []
    const send = createStoreDraftSender({
      read: () => b.memory, update: b.edit, provider: () => mail.provider, localAccount: () => false, canCompose: () => true, online: () => true, home: () => 'Fake', undoSeconds: () => 0,
      schedule: (_pending, commit, onStart) => { onStart?.(); commit(); return true }, holdForDraft: () => undefined, isDraftSending: id => going.has(id), markDraftSending: (id, on) => { if (on) going.add(id); else going.delete(id) },
      deliver: (provider, draft, attempt) => controller(b)(provider, draft, attempt), reportFailure: () => {}, notice: () => {}, record: () => {},
    })
    send(record(b)!, { onFailed: (_reason, outcome) => failed.push(outcome) })
    await settle()
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(failed).toEqual(['not_sent'])
    finish(accepted())
    await first
    await b.save()
    expect(draftDelivery(b.memory, 'letter').state).toBe('submitted')
  })
})
