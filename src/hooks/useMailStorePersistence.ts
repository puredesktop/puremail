import { useEffect, useRef, useState } from 'react'
import type { DraftsFileChanges } from '../lib/draftsFileMerge'
import { syncDraftsFile, syncStoreFile, writeDraftsFileBeforeUnload, writePersistedMailStore } from '../lib/mailPersistence'
import type { StoreFileChanges } from '../lib/storeFileMerge'
import type { MailStore } from '../types'

/** How long the store must sit still before it is written. */
const WRITE_DEBOUNCE_MS = 600

/** How often a copy of Mail takes what other copies saved to the drafts file. */
const DRAFTS_SYNC_MS = 15_000

/** The mailbox file is far larger, so a copy looks at it on every fourth look (a minute), and on focus. */
const STORE_FILE_EVERY = 4

export interface MailPersistFailure {
  /** True when even the small drafts file could not be written. */
  draftsLost: boolean
  message: string
}

/**
 * Persist the mail store to the shell's filesystem JSON store, debounced.
 *
 * This replaced a `useEffect` keyed on `[store]` that ran
 * `JSON.stringify(store)` into `localStorage` synchronously on every change.
 * Two things were wrong with that. A normal Gmail window serialises past the
 * ~5MB origin quota, after which every write threw and nothing local survived
 * a reload — the reason drafts an agent really did create came back "never
 * written". And because a draft body edit writes into the store, the whole
 * mailbox was re-serialised on the main thread on every keystroke.
 *
 * Writes are coalesced, run off the render path, and never overlap: a change
 * arriving mid-write schedules exactly one more write when it finishes.
 *
 * Several copies of Mail can run over one file (a window, a split, a mini app),
 * so both files are merged on every write (lib/draftsFileMerge.ts,
 * lib/storeFileMerge.ts) and what the others saved comes back through
 * `onDraftChanges` and `onStoreChanges`.
 */
export function useMailStorePersistence(store: MailStore, input: {
  /** The latest store at write time: a render can lag what was already saved. */
  readStore?: () => MailStore
  /** Take drafts other copies saved into this copy's store. */
  onDraftChanges?: (changes: DraftsFileChanges) => void
  /** Take what other copies saved to the mailbox file into this copy's store. */
  onStoreChanges?: (changes: StoreFileChanges) => void
} = {}): {
  persistFailure: MailPersistFailure | null
  /** Force an immediate write — used before the window goes away. */
  flush: () => Promise<void>
  flushForSend: (snapshot: MailStore) => Promise<void>
  /** Take what other copies saved, now. Resolves once this copy's store holds it. */
  syncDrafts: () => Promise<void>
} {
  const [persistFailure, setPersistFailure] =
    useState<MailPersistFailure | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store
  const inputRef = useRef(input)
  inputRef.current = input
  const latestStore = (): MailStore => inputRef.current.readStore?.() ?? storeRef.current
  const timerRef = useRef<number | null>(null)
  const writeTail = useRef<Promise<void>>(Promise.resolve())
  const writeNow = useRef((snapshot?: MailStore, requireDrafts = false): Promise<void> => {
    const next = writeTail.current.catch(() => {}).then(async () => {
      try {
        const result = await writePersistedMailStore(snapshot ?? latestStore())
        inputRef.current.onDraftChanges?.(result.draftChanges)
        inputRef.current.onStoreChanges?.(result.cacheChanges)
        if (result.draftsWritten && result.cacheWritten) setPersistFailure(null)
        else setPersistFailure({ draftsLost: !result.draftsWritten, message: result.error ?? 'The mail store could not be saved.' })
        if (requireDrafts && !result.draftsWritten) throw new Error('Draft delivery state could not be saved. Nothing was sent.')
      } catch (error) {
        setPersistFailure({ draftsLost: true, message: error instanceof Error ? error.message : 'The mail store could not be saved.' })
        if (requireDrafts) throw error
      }
    })
    writeTail.current = next
    return next
  })
  const syncNow = useRef((withStoreFile = false): Promise<void> => {
    const next = writeTail.current.catch(() => {}).then(async () => {
      try {
        const changes = await syncDraftsFile(latestStore())
        inputRef.current.onDraftChanges?.(changes)
        if (withStoreFile) inputRef.current.onStoreChanges?.(await syncStoreFile(latestStore()))
      } catch (error) {
        // The next write reports a real failure; a missed look changes nothing on disk.
        console.warn('[puremail] mail files could not be read:', error)
      }
    })
    writeTail.current = next
    return next
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void writeNow.current()
    }, WRITE_DEBOUNCE_MS)
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [store])

  // A debounced write that never lands is a lost draft. Flush on unload and
  // whenever the window is hidden, which is the last moment a desktop app is
  // reliably given.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const takeDirty = (): boolean => {
      if (timerRef.current === null) return false
      window.clearTimeout(timerRef.current)
      timerRef.current = null
      return true
    }
    const onUnload = (): void => {
      // Nothing to save means nothing to write: a copy going away must not
      // touch the file on its way out.
      if (!takeDirty()) return
      writeDraftsFileBeforeUnload(latestStore())
      void writeNow.current()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden' && takeDirty()) void writeNow.current()
    }
    const onFocus = (): void => { void syncNow.current(true) }
    let looks = 0
    const poll = window.setInterval(() => { looks += 1; void syncNow.current(looks % STORE_FILE_EVERY === 0) }, DRAFTS_SYNC_MS)
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return {
    persistFailure,
    flushForSend: async snapshot => {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
      await writeNow.current(snapshot, true)
    },
    flush: async () => {
      if (typeof window !== 'undefined' && timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      await writeNow.current()
    },
    syncDrafts: () => syncNow.current(),
  }
}
