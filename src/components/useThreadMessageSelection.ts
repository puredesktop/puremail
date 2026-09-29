import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/** Reconcile refreshed mail without navigating away from the reader's choice. */
export function useThreadMessageSelection(
  threadId: string | null,
  messages: ReadonlyArray<{ id: string }>,
  focusedMessageId: string | null,
): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const previousThreadId = useRef(threadId)
  useEffect(() => {
    const changedThread = previousThreadId.current !== threadId
    previousThreadId.current = threadId
    setSelectedId(current => {
      if (focusedMessageId && messages.some(message => message.id === focusedMessageId)) {
        return focusedMessageId
      }
      if (!changedThread && messages.some(message => message.id === current)) return current
      return messages[0]?.id ?? null
    })
  }, [threadId, messages, focusedMessageId])
  return [selectedId, setSelectedId]
}
