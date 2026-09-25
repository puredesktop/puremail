import type { Attachment } from '../types'
import {
  attachmentContentToBase64,
  isPdfAttachment,
  safeAttachmentFileName,
} from './mailAttachments'

/**
 * Opening a PDF attachment in the shell's detached viewer window
 * (`viewer.openFileWindow`) needs the bytes on disk first. They land in a
 * stable per-app cache folder next to the app's JSON stores, under a name
 * derived from message + attachment id, so reopening the same attachment
 * reuses the same path (and the shell re-fronts the same window) instead of
 * littering the cache with copies.
 */
export const ATTACHMENT_VIEWER_CACHE_DIR = 'puremail-attachments'

/**
 * Store file probed (never created — reading a missing store file still
 * returns its would-be path) purely to learn where the shell keeps this
 * app's data folder.
 */
export const ATTACHMENT_VIEWER_PROBE_FILE = 'puremail-viewer-cache.json'

/** djb2 over the identifying pair — short, stable, dependency-free. */
export function attachmentCacheKey(
  messageId: string,
  attachmentId: string,
): string {
  const input = `${messageId}:${attachmentId}`
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Cache file name for a PDF attachment: `<idhash>-<safe name>.pdf`. The
 * id hash keeps same-named attachments from different messages apart; the
 * `.pdf` extension is guaranteed because the shell's viewer allowlist is
 * extension-based.
 */
export function attachmentCacheFileName(
  messageId: string,
  attachmentId: string,
  name: string,
): string {
  const safe = safeAttachmentFileName(name)
  const stem = safe.toLowerCase().endsWith('.pdf') ? safe.slice(0, -4) : safe
  return `${attachmentCacheKey(messageId, attachmentId)}-${stem || 'attachment'}.pdf`
}

/** Parent directory of an absolute path handed back by the shell (either separator). */
export function parentDirectoryPath(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : null
}

/**
 * True when a failure means the running shell predates (or has not yet
 * loaded) `viewer.openFileWindow`. Apps update ahead of shells in this
 * suite, so this is a supported state, not an exception: the renderer
 * rejects an unknown method with "Method not allowed: …", and a shell whose
 * main process is older than its renderer rejects the IPC channel with
 * "No handler registered for 'shell:viewer:open-file-window'".
 */
export function isViewerUnsupportedError(reason: string): boolean {
  return (
    reason.includes('viewer.openFileWindow') ||
    reason.includes('shell:viewer:open-file-window') ||
    reason.includes('No handler registered')
  )
}

export interface OpenAttachmentInViewerDeps {
  /** Resolve remote-only content; null when unrecoverable (already reported). */
  resolve: (attachment: Attachment) => Promise<Attachment | null>
  /** Absolute path of the viewer cache folder, or null when unavailable. */
  cacheDir: () => Promise<string | null>
  writeBinary: (path: string, base64: string) => Promise<void>
  openViewer: (request: { path: string; title?: string }) => Promise<void>
  /** Session-local memo of cache paths already written, to skip rewrites. */
  written?: Set<string>
}

export type OpenAttachmentInViewerResult =
  | { status: 'opened'; path: string }
  /** Content resolution failed; `resolve` has already surfaced the error. */
  | { status: 'unavailable' }
  | { status: 'error'; reason: string }

/**
 * Materialize a PDF attachment into the viewer cache and hand it to the
 * shell's detached viewer window. IO is injected so the orchestration
 * (gating, cache naming, rewrite skipping, failure paths) is unit-testable.
 */
export async function openAttachmentInViewerWindow(
  messageId: string,
  attachment: Attachment,
  deps: OpenAttachmentInViewerDeps,
): Promise<OpenAttachmentInViewerResult> {
  if (!isPdfAttachment(attachment)) {
    return { status: 'error', reason: 'Only PDF attachments open in the viewer.' }
  }
  const resolved = await deps.resolve(attachment)
  if (!resolved?.content) return { status: 'unavailable' }
  const base64 = attachmentContentToBase64(resolved)
  if (base64 === null) {
    return { status: 'error', reason: 'Could not decode the file.' }
  }
  const dir = await deps.cacheDir()
  if (!dir) {
    return { status: 'error', reason: 'No attachment cache folder available.' }
  }
  const path = `${dir}/${attachmentCacheFileName(messageId, attachment.id, resolved.name)}`
  try {
    if (!deps.written?.has(path)) {
      await deps.writeBinary(path, base64)
      deps.written?.add(path)
    }
    await deps.openViewer({
      path,
      title: safeAttachmentFileName(resolved.name),
    })
  } catch (error) {
    return {
      status: 'error',
      reason:
        error instanceof Error ? error.message : 'Could not open the viewer.',
    }
  }
  return { status: 'opened', path }
}
