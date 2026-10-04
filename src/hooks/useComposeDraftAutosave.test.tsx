// @vitest-environment happy-dom
import {
  act,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  useComposeDraftAutosave,
  type ComposeDraftSnapshot,
} from './useComposeDraftAutosave'
import { useMailStorePersistence } from './useMailStorePersistence'
import { writePersistedMailStore } from '../lib/mailPersistence'
import { emptyMailStore } from '../lib/mailModel'
import type { MailStore } from '../types'
import type { ComposeReplyContext } from '../lib/replyCompose'
vi.mock('../lib/mailPersistence', () => ({
  writePersistedMailStore: vi.fn(async () => ({
    draftsWritten: true,
    cacheWritten: true,
  })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(writePersistedMailStore).mockClear()
})
afterEach(() => vi.useRealTimers())

async function fixture() {
  const root = createRoot(document.createElement('div'))
  let store!: MailStore
  let context!: ComposeReplyContext | null
  let setStore!: Dispatch<SetStateAction<MailStore>>
  let setSnapshot!: Dispatch<SetStateAction<ComposeDraftSnapshot>>
  let setActive!: Dispatch<SetStateAction<boolean>>
  let setPending!: Dispatch<SetStateAction<boolean>>
  function Harness() {
    const [current, update] = useState(emptyMailStore)
    const [currentContext, updateContext] =
      useState<ComposeReplyContext | null>(null)
    const [snapshot, updateSnapshot] = useState<ComposeDraftSnapshot>({
      to: 'mira@example.test',
      cc: '',
      bcc: '',
      subject: 'Work in progress',
      body: 'First version',
      bodyHtml: '<p>First version</p>',
      attachments: [],
    })
    const [active, updateActive] = useState(true)
    const [pending, updatePending] = useState(false)
    const storeRef = useRef(current)
    storeRef.current = current
    store = current
    context = currentContext
    setStore = update
    setSnapshot = updateSnapshot
    setActive = updateActive
    setPending = updatePending
    useComposeDraftAutosave({
      active,
      pending,
      session: 1,
      signature: '',
      context: currentContext,
      quote: null,
      snapshot,
      storeRef,
      setStore: update,
      setContext: updateContext,
    })
    useMailStorePersistence(current)
    return null
  }
  await act(async () => root.render(<Harness />))
  return {
    read: () => store,
    context: () => context,
    edit: (body: string) =>
      act(async () =>
        setSnapshot(value => ({ ...value, body, bodyHtml: `<p>${body}</p>` })),
      ),
    subject: (subject: string) =>
      act(async () => setSnapshot(value => ({ ...value, subject }))),
    modify: (change: (store: MailStore) => MailStore) =>
      act(async () => setStore(change)),
    close: () => act(async () => setActive(false)),
    pending: () => act(async () => setPending(true)),
    tick: (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms)),
    unmount: () => act(async () => root.unmount()),
  }
}

it('persists an open composer without Close and updates the same draft after further typing', async () => {
  const f = await fixture()
  try {
    await f.tick(350)
    const id = f.read().drafts[0].id
    expect(f.context()?.draftId).toBe(id)
    await f.tick(600)
    expect(
      vi.mocked(writePersistedMailStore).mock.calls.at(-1)?.[0].drafts[0].body,
    ).toBe('First version')
    await f.edit('Latest version')
    await f.tick(350)
    await f.tick(600)
    expect(f.read().drafts).toHaveLength(1)
    expect(f.read().drafts[0]).toMatchObject({ id, body: 'Latest version' })
    expect(f.read().threads).toHaveLength(1)
    expect(
      vi.mocked(writePersistedMailStore).mock.calls.at(-1)?.[0].drafts[0].body,
    ).toBe('Latest version')
    await f.subject('Updated subject')
    await f.tick(350)
    expect(f.read().threads[0]).toMatchObject({
      subject: 'Updated subject',
      summary: 'Latest version',
    })
  } finally {
    await f.unmount()
  }
})

it('does not turn provider bookkeeping into another edit or remote save loop', async () => {
  const f = await fixture()
  try {
    await f.tick(350)
    await f.modify(store => ({
      ...store,
      drafts: store.drafts.map(d => ({
        ...d,
        syncState: 'synced',
        providerDraftId: 'imap_draft_17',
      })),
    }))
    await f.tick(3000)
    expect(f.read().drafts[0]).toMatchObject({
      syncState: 'synced',
      providerDraftId: 'imap_draft_17',
    })
  } finally {
    await f.unmount()
  }
})

it.each(['discard', 'send'] as const)(
  'does not resurrect a draft consumed by %s while an autosave was pending',
  async action => {
    const f = await fixture()
    try {
      await f.tick(350)
      await f.edit('Typing before action')
      if (action === 'send') await f.pending()
      else await f.close()
      await f.modify(store => ({ ...store, drafts: [] }))
      await f.tick(3000)
      expect(f.read().drafts).toHaveLength(0)
    } finally {
      await f.unmount()
    }
  },
)

it.each(['uncertain', 'conflict', 'sync-conflict'] as const)(
  'preserves a draft with %s state while the composer is still open',
  async state => {
    const f = await fixture()
    try {
      await f.tick(350)
      await f.modify(store => ({
        ...store,
        drafts: store.drafts.map(d => ({
          ...d,
          ...(state === 'uncertain'
            ? { sendState: 'uncertain' as const }
            : state === 'sync-conflict'
            ? { syncState: 'conflict' as const }
            : {
                providerConflict: {
                  body: 'Remote edit',
                  subject: d.subject,
                  to: d.to,
                  cc: [],
                  bcc: [],
                  bodyHtml: '',
                  attachments: [],
                  updatedAt: d.updatedAt,
                },
              }),
        })),
      }))
      await f.edit('Later unsent edit')
      await f.tick(1000)
      expect(f.read().drafts[0].body).toBe('First version')
      if (state === 'uncertain')
        expect(f.read().drafts[0].sendState).toBe('uncertain')
      else if (state === 'sync-conflict')
        expect(f.read().drafts[0].syncState).toBe('conflict')
      else expect(f.read().drafts[0].providerConflict?.body).toBe('Remote edit')
    } finally {
      await f.unmount()
    }
  },
)
