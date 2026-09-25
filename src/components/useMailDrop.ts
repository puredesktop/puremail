import { useEffect, useRef, type RefObject } from 'react'
/** A draft-only target. The host supplies coordinates; Mail owns insertion and attachments. */
export function useMailDrop(
  editorRef: RefObject<HTMLDivElement | null>,
  identity: string | null | undefined,
  onDrop: (value: string, range: Range) => Promise<void>,
  onError: (message: string) => void,
) {
  const latest = useRef({ onDrop, onError })
  latest.current = { onDrop, onError }
  useEffect(() => {
    const marker = document.createElement('div')
    marker.hidden = true
    marker.dataset.mailDropIndicator = 'true'
    Object.assign(marker.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483647',
      width: '2px',
      background: '#26765d',
    })
    const label = document.createElement('span')
    label.textContent = 'Drop into draft'
    Object.assign(label.style, {
      position: 'absolute',
      top: '100%',
      left: '0',
      whiteSpace: 'nowrap',
      padding: '3px 7px',
      background: '#edf8f3',
      border: '1px solid #26765d',
      borderRadius: '5px',
      font: '12px system-ui',
      color: '#18513f',
    })
    marker.append(label)
    document.body.append(marker)
    const hide = () => {
      marker.hidden = true
    }
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        window.parent === window ||
        event.data?.type !== 'pure:asset-drag'
      )
        return
      const { phase, x, y, asset } = event.data
      if (phase === 'cancel') {
        hide()
        return
      }
      const editor = editorRef.current
      if (!editor || !Number.isFinite(x) || !Number.isFinite(y)) {
        hide()
        return
      }
      const box = editor.getBoundingClientRect(),
        hit = document.elementFromPoint(x, y)
      if (
        x < box.left ||
        x > box.right ||
        y < box.top ||
        y > box.bottom ||
        !hit ||
        !editor.contains(hit)
      ) {
        hide()
        return
      }
      const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null
      }
      let range = doc.caretRangeFromPoint?.(x, y)
      if (!range || !editor.contains(range.startContainer)) {
        range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
      }
      const rect = range.getBoundingClientRect()
      marker.hidden = false
      Object.assign(marker.style, {
        left: `${rect.width || rect.height ? rect.left : box.left + 8}px`,
        top: `${rect.height ? rect.top : box.top + 8}px`,
        height: `${Math.max(rect.height, 20)}px`,
      })
      if (phase === 'drop') {
        hide()
        if (typeof asset === 'string')
          void latest.current
            .onDrop(asset, range.cloneRange())
            .catch((error) =>
              latest.current.onError(
                error instanceof Error ? error.message : String(error),
              ),
            )
      }
    }
    window.addEventListener('message', receive)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('message', receive)
      window.removeEventListener('scroll', hide, true)
      marker.remove()
    }
  }, [editorRef, identity])
}
