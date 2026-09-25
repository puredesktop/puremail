import { useEffect, useRef, type RefObject } from 'react'

/**
 * Close an open popover/menu when the pointer goes down anywhere outside
 * its container. Mousedown, not click: the menu is gone before the outside
 * element's own click handler runs, matching native menu behavior.
 */
export function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  close: () => void,
): void {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: MouseEvent): void => {
      const node = ref.current
      if (
        node &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        closeRef.current()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [active, ref])
}
