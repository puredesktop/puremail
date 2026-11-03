// @vitest-environment happy-dom
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import { draftDelivery } from './mailDeliveryStatus'
import type { Draft, MailStore, MailTask, ScheduledSend, QueuedMailAction } from '../types'

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
