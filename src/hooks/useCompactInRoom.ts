import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'

function watchHeldInRoom(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-held-in-room'] })
  return () => observer.disconnect()
}

/**
 * True only while Mail is held in an entry of the room (heldInRoom.ts); beside it in
 * split view it is the whole app. Held counts from the first paint, before
 * the neighbour's name arrives, so the full app never flashes up in the box and
 * nothing done in those first moments lands in the person's full-app view.
 * Growing to the whole app, or any other neighbour, turns it off.
 */
export function useCompactInRoom(): boolean {
  const neighbour = useAdjacentApp()
  const held = useSyncExternalStore(watchHeldInRoom, () => document.documentElement.hasAttribute('data-held-in-room'))
  return neighbour ? neighbour.heldInRoom === true : held
}

/**
 * useState with a second value for the room. What the person does in the box
 * never touches the full app's value, and growing back reads that value
 * untouched, with nothing to restore. With compact off this is plain useState.
 */
export function useRoomSlot<T>(compact: boolean, whole: T, inRoom: T): [T, Dispatch<SetStateAction<T>>] {
  const wholeSlot = useState<T>(whole)
  const roomSlot = useState<T>(inRoom)
  return compact ? roomSlot : wholeSlot
}

const SCROLLERS = ['[data-mail-scroll]', '[data-reader-scroll]']

/** Puts the full app's list and reader back at the scroll position it left them. */
export function useRestoreWholeScroll(compact: boolean): void {
  const left = useRef(new Map<string, number>())
  const compactRef = useRef(compact)
  compactRef.current = compact
  useEffect(() => {
    const note = (event: Event): void => {
      if (compactRef.current || !(event.target instanceof Element)) return
      for (const selector of SCROLLERS) {
        if (event.target.matches(selector)) left.current.set(selector, event.target.scrollTop)
      }
    }
    document.addEventListener('scroll', note, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', note, { capture: true })
  }, [])
  const wasCompact = useRef(compact)
  useEffect(() => {
    const returned = wasCompact.current && !compact
    wasCompact.current = compact
    if (!returned) return
    // After the reader's own "new thread, back to the top" has run.
    const frame = requestAnimationFrame(() => {
      for (const [selector, top] of left.current) {
        document.querySelector(selector)?.scrollTo({ top })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [compact])
}
