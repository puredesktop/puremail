import { useEffect, useLayoutEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/** Breathing room between the panel and the window edges. */
const VIEWPORT_MARGIN = 8

/**
 * Position a dropdown against the viewport rather than its container.
 *
 * An absolutely-positioned panel is clipped by any ancestor with
 * `overflow: hidden`, and the mail sidebar is exactly that — a 288px pane
 * that hides its overflow. The mailbox menu is 268px wide and opens partway
 * along that pane, so a third of it was cut off, taking every row's count
 * with it: the menu looked truncated and countless at once, which is exactly
 * what it was.
 *
 * Fixed positioning escapes the clip. The trade is that fixed coordinates
 * have to be measured and kept up to date, which is what this does — on open,
 * on resize, and on any scroll that could move the trigger.
 */
export function useAnchoredPanel(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  options: { width: number } = { width: 268 },
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)
  const { width } = options

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined)
      return
    }
    const measure = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN
      setStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        // Clamped so a trigger near either edge still opens a panel that is
        // entirely on screen.
        left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
        // The room actually below the trigger, so the panel never runs off
        // the bottom either.
        maxHeight: Math.max(
          160,
          window.innerHeight - rect.bottom - 4 - VIEWPORT_MARGIN,
        ),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    // Capture phase: the trigger can move inside any scrolling ancestor, not
    // just the window.
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, triggerRef, width])

  // A panel measured before its fonts settle can be a few pixels out; one
  // re-measure on the next frame costs nothing and removes the jitter.
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setStyle(current =>
        current ? { ...current, top: rect.bottom + 4 } : current,
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, triggerRef])

  return style
}
