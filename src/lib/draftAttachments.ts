import type { Attachment } from '../types'
import {
  attachmentByteSize,
  attachmentSizeStatus,
  formatAttachmentBytes,
  GMAIL_ATTACHMENT_LIMIT_BYTES,
} from './mailAttachments'

/**
 * The rules for changing a draft's attachment list, as pure decisions the
 * agent tools and their tests share. The UI applies the same size status
 * (`attachmentSizeStatus`) — it warns and lets the user decide, because a
 * person can see the total and remove something; the agent is refused
 * outright, because a tool that quietly leaves a draft unsendable is worse
 * than one that says no.
 */

/** Files are named by their last path segment, on either separator. */
export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/** POSIX `/…` or Windows `C:\…` — anything else is relative to nowhere. */
export function isAbsoluteFilePath(path: string): boolean {
  return /^\//.test(path) || /^[a-zA-Z]:[\\/]/.test(path)
}

export interface AttachmentAdditionSkip {
  name: string
  reason: string
}

export type AttachmentAdditionPlan =
  | {
      status: 'ok'
      /** The draft's list with the additions appended, in order. */
      attachments: Attachment[]
      added: Attachment[]
      skipped: AttachmentAdditionSkip[]
      totalBytes: number
      limitBytes: number
    }
  | {
      status: 'over_limit'
      totalBytes: number
      limitBytes: number
      /** Which incoming files would be new (after dedupe), for the message. */
      wouldAdd: Attachment[]
    }
  | {
      status: 'nothing_to_add'
      skipped: AttachmentAdditionSkip[]
    }

function sameFile(a: Attachment, b: Attachment): boolean {
  if (a.name !== b.name) return false
  const sizeA = attachmentByteSize(a)
  const sizeB = attachmentByteSize(b)
  return sizeA !== null && sizeB !== null && sizeA === sizeB
}

/**
 * Decide what appending `incoming` to `existing` would do. Duplicates (same
 * name and byte size, against the draft or earlier in the batch) are skipped
 * with a note rather than attached twice; a total over the sending limit
 * refuses the WHOLE batch — nothing is appended — so the draft never ends
 * up in a state the user cannot send.
 */
export function planAttachmentAdditions(
  existing: Attachment[],
  incoming: Attachment[],
  limitBytes = GMAIL_ATTACHMENT_LIMIT_BYTES,
): AttachmentAdditionPlan {
  const added: Attachment[] = []
  const skipped: AttachmentAdditionSkip[] = []
  for (const candidate of incoming) {
    const duplicateOf =
      existing.find(item => sameFile(item, candidate)) ??
      added.find(item => sameFile(item, candidate))
    if (duplicateOf) {
      skipped.push({
        name: candidate.name,
        reason: `Already on the draft as "${duplicateOf.name}" (${formatAttachmentBytes(
          attachmentByteSize(duplicateOf) ?? 0,
        )}); not added twice.`,
      })
      continue
    }
    added.push(candidate)
  }
  if (added.length === 0) return { status: 'nothing_to_add', skipped }
  const attachments = [...existing, ...added]
  const totalBytes = attachmentSizeStatus(attachments).totalBytes
  if (totalBytes > limitBytes) {
    return { status: 'over_limit', totalBytes, limitBytes, wouldAdd: added }
  }
  return { status: 'ok', attachments, added, skipped, totalBytes, limitBytes }
}

export type AttachmentRemovalPlan =
  | { status: 'ok'; removed: Attachment; remaining: Attachment[] }
  | { status: 'not_found' }
  | { status: 'ambiguous'; matches: Attachment[] }

/**
 * Pick the one attachment to remove: by id when given, else by exact name,
 * then case-insensitive name. Two attachments sharing the name is refused
 * as ambiguous — the caller asks for the id — rather than removing the
 * first one found.
 */
export function planAttachmentRemoval(
  attachments: Attachment[],
  target: { attachmentId?: string; name?: string },
): AttachmentRemovalPlan {
  let matches: Attachment[] = []
  if (target.attachmentId) {
    matches = attachments.filter(item => item.id === target.attachmentId)
  } else if (target.name) {
    const wanted = target.name.trim()
    matches = attachments.filter(item => item.name === wanted)
    if (matches.length === 0) {
      const lower = wanted.toLowerCase()
      matches = attachments.filter(item => item.name.toLowerCase() === lower)
    }
  }
  if (matches.length === 0) return { status: 'not_found' }
  if (matches.length > 1) return { status: 'ambiguous', matches }
  const removed = matches[0]!
  return {
    status: 'ok',
    removed,
    remaining: attachments.filter(item => item.id !== removed.id),
  }
}

/** The compact shape both tools return for each attachment. */
export function attachmentSummary(attachment: Attachment): {
  id: string
  name: string
  mimeType: string
  size: number | null
} {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachmentByteSize(attachment),
  }
}
