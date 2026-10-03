import { useEffect, useRef, useState } from 'react'
import { writePersistedMailStore } from '../lib/mailPersistence'
import type { MailStore } from '../types'

/** How long the store must sit still before it is written. */
const WRITE_DEBOUNCE_MS = 600

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
 */
export function useMailStorePersistence(store: MailStore): {
  persistFailure: MailPersistFailure | null
  /** Force an immediate write — used before the window goes away. */
  flush: () => Promise<void>
  flushForSend: (snapshot: MailStore) => Promise<void>
} {
  const [persistFailure, setPersistFailure] =
    useState<MailPersistFailure | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store
  const timerRef = useRef<number | null>(null)
  const writeTail = useRef<Promise<void>>(Promise.resolve())
  const writeNow = useRef((snapshot = storeRef.current, requireDrafts = false): Promise<void> => {
    const next = writeTail.current.catch(() => {}).then(async () => {
      try {
        const result = await writePersistedMailStore(snapshot)
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
    const flushIfDirty = (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      void writeNow.current()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushIfDirty()
    }
    window.addEventListener('beforeunload', flushIfDirty)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', flushIfDirty)
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
  }
}
