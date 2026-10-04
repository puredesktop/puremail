import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addNote,
  emptyAnnotationsFile,
  markReplyRequested,
  removeNote,
  setReplyIntent,
  setContext,
  updateNote,
  type AnnotationsFile,
  type KeptContext,
  type MessageIdentity,
  type MessageNote,
} from '../lib/readingRoom'
import { readAnnotationsFile, syncContextFile, updateAnnotationsFile } from '../lib/readingRoomPersistence'

export interface ReadingRoomStore {
  file: AnnotationsFile
  /** The latest file, for agent handlers that must not read a stale closure. */
  fileRef: React.MutableRefObject<AnnotationsFile>
  error: string | null
  addNote: (identity: MessageIdentity, note: MessageNote) => Promise<void>
  updateNote: (messageId: string, noteId: string, patch: Partial<Pick<MessageNote, 'text' | 'kind'>>) => Promise<void>
  removeNote: (messageId: string, noteId: string) => Promise<void>
  keepContext: (identity: MessageIdentity, context: KeptContext | undefined) => Promise<void>
  markReplyRequested: (messageId: string) => Promise<void>
  setReplyIntent: (identity: MessageIdentity, text: string) => Promise<void>
  recordContextUse: (messageIds: string[], by: string) => Promise<void>
}

const now = () => new Date().toISOString()

/**
 * The reading room's notes and kept context: loaded once, changed through
 * the locked file, and mirrored into the shared Markdown file whenever a
 * message's kept context (or a note it includes) changes.
 */
export function useReadingRoom(): ReadingRoomStore {
  const [file, setFile] = useState<AnnotationsFile>(emptyAnnotationsFile)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef(file)
  fileRef.current = file

  useEffect(() => {
    let cancelled = false
    readAnnotationsFile()
      .then(loaded => {
        if (!cancelled) setFile(loaded)
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const change = useCallback(async (messageId: string, fn: (file: AnnotationsFile) => AnnotationsFile, propagateFailure = false) => {
    const previousFile = fileRef.current.byMessageId[messageId]?.context?.file
    // Shown at once; the locked write re-applies the same change to what is on disk.
    setFile(current => fn(current))
    try {
      let saved = await updateAnnotationsFile(fn)
      const record = saved.byMessageId[messageId]
      if (record?.context || previousFile) {
        let path: string | undefined
        try {
          path = await syncContextFile(record, previousFile)
        } catch (cause) {
          // Never claim it is shared with every app when the file could not be written.
          if (record?.context?.scope === 'all') {
            saved = await updateAnnotationsFile(current => {
              const latest = current.byMessageId[messageId]
              if (!latest?.context) return current
              return { ...current, byMessageId: { ...current.byMessageId, [messageId]: { ...latest, context: { ...latest.context, scope: 'mail' } } } }
            })
          }
          setFile(saved)
          setError(`Kept for PureMail only: the shared file could not be written (${(cause instanceof Error ? cause.message : String(cause)).replace(/\.$/, '')}).`)
          return
        }
        if (record?.context && record.context.file !== path) {
          saved = await updateAnnotationsFile(current => {
            const latest = current.byMessageId[messageId]
            if (!latest?.context) return current
            return { ...current, byMessageId: { ...current.byMessageId, [messageId]: { ...latest, context: { ...latest.context, file: path } } } }
          })
        }
      }
      setFile(saved)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      if (propagateFailure) throw cause
    }
  }, [])

  return {
    file,
    fileRef,
    error,
    addNote: (identity, note) => change(identity.messageId, current => addNote(current, identity, note, now())),
    updateNote: (messageId, noteId, patch) => change(messageId, current => updateNote(current, messageId, noteId, patch, now())),
    removeNote: (messageId, noteId) => change(messageId, current => removeNote(current, messageId, noteId, now())),
    keepContext: (identity, context) => change(identity.messageId, current => setContext(current, identity, context, now())),
    markReplyRequested: messageId => change(messageId, current => markReplyRequested(current, messageId, now())),
    setReplyIntent: (identity, text) => change(identity.messageId, current => setReplyIntent(current, identity, text, now()), true),
    recordContextUse: async (messageIds, by) => {
      const at = now()
      const used = (current: AnnotationsFile) => {
        const byMessageId = { ...current.byMessageId }
        for (const id of messageIds) {
          const record = byMessageId[id]
          if (record?.context) byMessageId[id] = { ...record, context: { ...record.context, lastUsed: { by, at } } }
        }
        return { ...current, byMessageId }
      }
      setFile(used)
      await updateAnnotationsFile(used).then(setFile).catch(() => undefined)
    },
  }
}
