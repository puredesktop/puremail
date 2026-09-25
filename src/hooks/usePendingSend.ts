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
}): {
  pendingSend: PendingSendState | null
  /**
   * Every hold still open, oldest first. Compose and reply allow one at a
   * time; a send run stacks one per Send & next so the reviewer never
   * waits for the previous hold to elapse.
   */
  pendingSends: PendingSendState[]
  sendingDraftIds: string[]
  /** False when refused (another non-run hold is open) — nothing was queued. */
  schedulePendingSend: (pending: PendingSendState, commit: () => void) => boolean
  undoPendingSend: (pendingId: string) => void
  markDraftSending: (draftId: string, sending: boolean) => void
} {
  const { undoSendDelaySeconds, setCommandNotice } = input
  const [pendingSend, setPendingSend] = useState<PendingSendState | null>(null)
  const [pendingSends, setPendingSends] = useState<PendingSendState[]>([])
  const [sendingDraftIds, setSendingDraftIds] = useState<string[]>([])
  const timeoutsRef = useRef<Record<string, number>>({})
  const dropPending = (pendingId: string): void => {
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
  ): boolean => {
    // One compose/reply hold at a time; run holds stack among themselves.
    const stacks = pending.target === 'run' && (!pendingSend || pendingSend.target === 'run')
    if (pendingSend && !stacks) {
      setCommandNotice('A send is already waiting. Undo it or let it finish.')
      return false
    }
    // Undo-send hold: configurable, default 10s; 0 sends now.
    const undoSeconds = undoSendDelaySeconds ?? 10
    if (undoSeconds === 0) {
      commit()
      return true
    }
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

  const undoPendingSend = (pendingId: string): void => {
    const timeoutId = timeoutsRef.current[pendingId]
    if (timeoutId) window.clearTimeout(timeoutId)
    delete timeoutsRef.current[pendingId]
    dropPending(pendingId)
    setCommandNotice('Send cancelled.')
  }

  const markDraftSending = (draftId: string, sending: boolean): void => {
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
  }
}
