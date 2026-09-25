import { useEffect, useRef, useState } from 'react'

/** How long typing must pause before the body reaches the store. */
const COMMIT_DEBOUNCE_MS = 400

/**
 * Holds the composer's body locally between keystrokes.
 *
 * The reply composer used to write every keystroke straight into the mail
 * store, which then re-serialised the whole mailbox to persist it — megabytes
 * of JSON per keypress on the main thread. Compose already kept its body in
 * local state until save; this gives the reader the same shape.
 *
 * The buffer defers to the store whenever the stored body changes underneath
 * it (an AI rewrite, an undo, a regenerate), so those still land in the
 * textarea immediately. Only the user's own typing is held back, and only
 * until they pause, blur, or switch drafts.
 */
export function useDraftBodyBuffer(input: {
  draftId: string | null
  storedBody: string
  commit: (draftId: string, body: string) => void
}): {
  value: string
  setValue: (body: string) => void
  /** Commits anything buffered and returns it, so a caller acting on the
   *  draft right now (Send) can use the body the user just typed rather than
   *  the store's copy, which React has not committed yet. */
  flush: () => { draftId: string; value: string } | null
} {
  const { draftId, storedBody, commit } = input
  const [buffer, setBuffer] = useState<{ draftId: string; value: string } | null>(
    null,
  )
  const commitRef = useRef(commit)
  commitRef.current = commit
  const bufferRef = useRef(buffer)
  bufferRef.current = buffer
  /** The last value this hook itself pushed into the store. */
  const committedRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = (): void => {
    if (typeof window === 'undefined' || timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const flush = (): { draftId: string; value: string } | null => {
    clearTimer()
    const pending = bufferRef.current
    if (!pending) return null
    committedRef.current = pending.value
    commitRef.current(pending.draftId, pending.value)
    return pending
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  // A store-side change that is not the echo of our own commit wins: the AI
  // assist writes into the draft, and the user must see that, not their stale
  // buffer.
  useEffect(() => {
    const pending = bufferRef.current
    if (!pending) return
    if (pending.draftId !== draftId) {
      setBuffer(null)
      return
    }
    if (storedBody !== committedRef.current && storedBody !== pending.value) {
      clearTimer()
      setBuffer(null)
    }
  }, [storedBody, draftId])

  // Switching away from a draft, or unmounting the composer, must not drop
  // what was typed a moment ago.
  useEffect(
    () => () => {
      flushRef.current()
    },
    [draftId],
  )

  return {
    value:
      buffer && draftId && buffer.draftId === draftId ? buffer.value : storedBody,
    setValue: (body: string) => {
      if (!draftId) return
      setBuffer({ draftId, value: body })
      clearTimer()
      if (typeof window === 'undefined') {
        committedRef.current = body
        commitRef.current(draftId, body)
        return
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        committedRef.current = body
        commitRef.current(draftId, body)
      }, COMMIT_DEBOUNCE_MS)
    },
    flush,
  }
}
