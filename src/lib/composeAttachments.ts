import type { Attachment } from '../types'

/** Rebase store changes without undoing attachments edited in the composer. */
export function reconcileComposeAttachments(current: Attachment[], previous: Attachment[], next: Attachment[]): Attachment[] {
  const before = new Map(previous.map(item => [item.id, item]))
  const after = new Map(next.map(item => [item.id, item]))
  const currentIds = new Set(current.map(item => item.id))
  const kept = current.filter(item => !before.has(item.id) || after.has(item.id)).map(item => {
    const original = before.get(item.id)
    const updated = after.get(item.id)
    return original && updated && (item === original || JSON.stringify(item) === JSON.stringify(original))
      ? updated : item
  })
  const added = next.filter(item => !before.has(item.id) && !currentIds.has(item.id))
  const result = [...kept, ...added]
  return result.length === current.length && result.every((item, i) => item === current[i]) ? current : result
}

/** A stale editor snapshot must not replace bytes hydrated before IMAP UID removal. */
export function retainHydratedAttachments(snapshot: Attachment[], saved: Attachment[]): Attachment[] {
  return snapshot.map(item => {
    const hydrated = saved.find(candidate => candidate.id === item.id)
    if (item.remote?.provider !== 'imap' || item.content !== undefined ||
        !hydrated || hydrated.content === undefined || hydrated.remote ||
        hydrated.name !== item.name || hydrated.mimeType !== item.mimeType) return item
    const { remote: _remote, ...local } = item
    return { ...local, content: hydrated.content }
  })
}
