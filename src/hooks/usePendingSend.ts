import { useEffect, useRef, useState } from 'react'
import type { PendingSendState } from '../components/mailShellHelpers'

/**
 * The undo-send hold, extracted from PureMailShell (phase 3). One send may be
 * pending at a time; committing is delayed by the configured undo window and
 * an undo cancels the timer. Also tracks which drafts are mid-send so their
 * buttons can say so.
 *
 * First of the domain hooks the structural plan calls for — the pattern is:
 * state, refs and the effect move here; the component keeps only wiring.
 */
export function usePendingSend(input: {
  undoSendDelaySeconds: number | undefined
  setCommandNotice: (notice: string) => void
  /** Undo cancelled this hold: nothing left, and the record should say so. */
  onUndone?: (pending: PendingSendState) => void
}): {
  pendingSend: PendingSendState | null
  /**
   * Every hold still open, oldest first. Compose and reply allow one at a
   * time; a send run stacks one per Send & next so the reviewer never
   * waits for the previous hold to elapse.
   */
  pendingSends: PendingSendState[]
  sendingDraftIds: string[]
  /**
   * False when refused (another non-run hold is open, or this draft already
   * has one) — nothing was queued. `onStart` runs once it is accepted, before
   * the hold or, with no hold, before the commit.
   */
  schedulePendingSend: (
    pending: PendingSendState,
    commit: () => void,
    onStart?: () => void,
  ) => boolean
  /** False when that hold is no longer open: it cannot be undone any more. */
  undoPendingSend: (pendingId: string) => boolean
  markDraftSending: (draftId: string, sending: boolean) => void
  /** Read synchronously: a second approval must see the first before React renders. */
  holdForDraft: (draftId: string) => PendingSendState | undefined
  isDraftSending: (draftId: string) => boolean
} {
  const { undoSendDelaySeconds, setCommandNotice } = input
  const onUndoneRef = useRef(input.onUndone)
  onUndoneRef.current = input.onUndone
  const sendingRef = useRef(new Set<string>())
  const [pendingSend, setPendingSend] = useState<PendingSendState | null>(null)
  const [pendingSends, setPendingSends] = useState<PendingSendState[]>([])
  const [sendingDraftIds, setSendingDraftIds] = useState<string[]>([])
  const holdsRef = useRef<PendingSendState[]>([])
  const timeoutsRef = useRef<Record<string, number>>({})
  const dropPending = (pendingId: string): void => {
    holdsRef.current = holdsRef.current.filter(item => item.id !== pendingId)
    setPendingSend(current => (current?.id === pendingId ? null : current))
    setPendingSends(current => current.filter(item => item.id !== pendingId))
  }

  // A timer that outlives the mail surface must not fire into nothing.
  useEffect(
    () => () => {
      Object.values(timeoutsRef.current).forEach(timeoutId =>
        window.clearTimeout(timeoutId),
      )
    },
    [],
  )

  const schedulePendingSend = (
    pending: PendingSendState,
    commit: () => void,
    onStart?: () => void,
  ): boolean => {
    // One compose/reply hold at a time; run holds stack among themselves.
    const holds = holdsRef.current
    const stacks =
      pending.target === 'run' && holds.every(item => item.target === 'run')
    if (
      holds.some(item => item.id === pending.id || (pending.draftId && item.draftId === pending.draftId)) ||
      (pending.draftId && sendingRef.current.has(pending.draftId)) ||
      (holds.length > 0 && !stacks)
    ) {
      setCommandNotice('A send is already waiting. Undo it or let it finish.')
      return false
    }
    // Undo-send hold: configurable, default 10s; 0 sends now.
    const undoSeconds = undoSendDelaySeconds ?? 10
    onStart?.()
    if (undoSeconds === 0) {
      commit()
      return true
    }
    holdsRef.current = [...holds, pending]
    const timeoutId = window.setTimeout(() => {
      delete timeoutsRef.current[pending.id]
      dropPending(pending.id)
      commit()
    }, undoSeconds * 1000)
    timeoutsRef.current[pending.id] = timeoutId
    setPendingSend(pending)
    setPendingSends(current => [...current, pending])
    setCommandNotice(
      `${pending.label} queued. You have ${undoSeconds} seconds to undo.`,
    )
    return true
  }

  const undoPendingSend = (pendingId: string): boolean => {
    const pending = holdsRef.current.find(item => item.id === pendingId)
    if (!pending) {
      setCommandNotice('Too late to undo: this send had already left the hold.')
      return false
    }
    const timeoutId = timeoutsRef.current[pendingId]
    if (timeoutId) window.clearTimeout(timeoutId)
    delete timeoutsRef.current[pendingId]
    dropPending(pendingId)
    onUndoneRef.current?.(pending)
    setCommandNotice('Send cancelled.')
    return true
  }

  const markDraftSending = (draftId: string, sending: boolean): void => {
    if (sending) sendingRef.current.add(draftId)
    else sendingRef.current.delete(draftId)
    setSendingDraftIds(current =>
      sending
        ? current.includes(draftId)
          ? current
          : [...current, draftId]
        : current.filter(id => id !== draftId),
    )
  }

  return {
    pendingSend,
    pendingSends,
    sendingDraftIds,
    schedulePendingSend,
    undoPendingSend,
    markDraftSending,
    holdForDraft: draftId => holdsRef.current.find(item => item.draftId === draftId),
    isDraftSending: draftId => sendingRef.current.has(draftId),
  }
}
