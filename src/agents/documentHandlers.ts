import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  attachmentDisplaySize,
  attachmentKindLabel,
  formatAttachmentBytes,
  isDocumentAttachment,
  writeAttachmentsToFolder,
} from '../lib/mailAttachments'
import type { Attachment, MailMessage, MailThread } from '../types'
import {
  AgentMailToolError,
  optionalString,
  requireString,
  type MailAgentToolContext,
} from './catalog'

/**
 * Documents out of mail: a thread's attachments saved as files, and an
 * email (or a whole thread) saved as a PDF. Both write through the same
 * library functions as the reader's Save all and Save as PDF….
 */

function ok(payload: unknown): AgentToolHandlerResult {
  return { content: JSON.stringify(payload, null, 2) }
}

/** The Mail folder in the workspace, or a plain reason there is none. */
async function requireSaveFolder(context: MailAgentToolContext): Promise<string> {
  if (!context.saveFolder) {
    throw new AgentMailToolError('Saving files is unavailable in this session.')
  }
  try {
    return (await context.saveFolder()).replace(/[\\/]+$/, '')
  } catch (error) {
    throw new AgentMailToolError(
      `No workspace folder to save into: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function requireThread(
  context: MailAgentToolContext,
  threadId: string,
): Promise<{ thread: MailThread; messages: MailMessage[] }> {
  let thread = context.store.threads.find(item => item.id === threadId)
  let pool = context.store.messages
  if (!thread && context.importRemoteThread) {
    const fragment = await context.importRemoteThread(threadId)
    thread = fragment?.threads.find(item => item.id === threadId)
    if (fragment) pool = fragment.messages
  }
  if (!thread) {
    throw new AgentMailToolError(
      `No thread with id "${threadId}". Find it with listThreads or searchAllMail first.`,
    )
  }
  const messages = pool
    .filter(message => message.threadId === threadId && !message.isDraft)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  return { thread, messages }
}

function pickMessages(
  messages: MailMessage[],
  messageId: string | undefined,
): MailMessage[] {
  if (!messageId) return messages
  const message = messages.find(item => item.id === messageId)
  if (!message) {
    throw new AgentMailToolError(
      `No message "${messageId}" in this thread. getThread lists its message ids: ${messages
        .map(item => item.id)
        .join(', ')}.`,
    )
  }
  return [message]
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const raw = args[key]
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw.trim() ? [raw] : []
  return list
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

interface Candidate {
  message: MailMessage
  attachment: Attachment
}

/**
 * Every attachment in the chosen messages, newest message first. A file that
 * is forwarded down a thread arrives again in each reply; the same name and
 * size is one document, and the newest copy is kept.
 */
function attachmentCandidates(messages: MailMessage[]): Candidate[] {
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const message of [...messages].reverse()) {
    for (const attachment of message.attachments ?? []) {
      const key = `${attachment.name.toLowerCase()}|${attachmentDisplaySize(attachment)}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ message, attachment })
    }
  }
  return candidates
}

export async function saveAttachmentsHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  if (!context.writeBinaryFile) {
    throw new AgentMailToolError('Saving files is unavailable in this session.')
  }
  const threadId = requireString(args, 'threadId')
  const messageId = optionalString(args, 'messageId')
  const wanted = stringList(args, 'names')
  const only = optionalString(args, 'only') ?? (wanted.length ? 'all' : 'documents')
  if (only !== 'documents' && only !== 'all') {
    throw new AgentMailToolError('"only" is "documents" (PDF, Word, Excel, PowerPoint, CSV, XML and the like) or "all".')
  }

  const { thread, messages } = await requireThread(context, threadId)
  const folder = await requireSaveFolder(context)
  const candidates = attachmentCandidates(pickMessages(messages, messageId))
  if (candidates.length === 0) {
    return ok({
      threadId,
      subject: thread.subject,
      folder,
      saved: [],
      note: messageId ? 'That message has no attachments.' : 'No message in this thread has attachments.',
    })
  }

  let chosen = candidates
  if (wanted.length) {
    const matches = (candidate: Candidate, name: string): boolean =>
      candidate.attachment.id === name ||
      candidate.attachment.name.toLowerCase() === name.toLowerCase()
    const missing = wanted.filter(name => !candidates.some(candidate => matches(candidate, name)))
    if (missing.length) {
      throw new AgentMailToolError(
        `No attachment called ${missing.map(name => `"${name}"`).join(', ')}. This thread has: ${candidates
          .map(candidate => `"${candidate.attachment.name}"`)
          .join(', ')}.`,
      )
    }
    chosen = candidates.filter(candidate => wanted.some(name => matches(candidate, name)))
  }
  const skipped =
    only === 'documents' ? chosen.filter(candidate => !isDocumentAttachment(candidate.attachment)) : []
  chosen = chosen.filter(candidate => !skipped.includes(candidate))

  const messageOf = new Map(chosen.map(candidate => [candidate.attachment, candidate.message]))
  const written = await writeAttachmentsToFolder(
    chosen.map(candidate => candidate.attachment),
    folder,
    {
      resolve: async attachment => {
        if (attachment.content) return attachment
        const message = messageOf.get(attachment)
        if (!message || !context.resolveAttachment) return null
        return context.resolveAttachment(message, attachment)
      },
      writeBinary: context.writeBinaryFile,
      ...(context.listFolderNames
        ? { existingNames: () => context.listFolderNames!(folder) }
        : {}),
    },
  )

  if (written.saved.length) {
    context.recordOperation?.(
      'mail.attachments.save',
      `Saved ${written.saved.length} attachment${written.saved.length === 1 ? '' : 's'} from "${thread.subject}" to ${folder}.`,
    )
  }
  const candidateOf = new Map(chosen.map(candidate => [candidate.attachment.id, candidate]))
  return ok({
    threadId,
    subject: thread.subject,
    folder,
    saved: written.saved.map(item => {
      const candidate = candidateOf.get(item.id)
      return {
        name: item.name,
        path: item.path,
        type: candidate ? attachmentKindLabel(candidate.attachment) : undefined,
        size: item.size === null ? undefined : formatAttachmentBytes(item.size),
        ...(candidate
          ? { from: candidate.message.from.email, receivedAt: candidate.message.receivedAt }
          : {}),
      }
    }),
    ...(skipped.length
      ? {
          skipped: skipped.map(candidate => ({
            name: candidate.attachment.name,
            type: attachmentKindLabel(candidate.attachment),
            reason: 'not a document; pass only: "all" or name it in "names" to save it',
          })),
        }
      : {}),
    ...(written.failed.length ? { failed: written.failed.map(({ name, reason }) => ({ name, reason })) } : {}),
    note:
      'Saved into the Mail folder of the workspace as new files; nothing there was overwritten (a clash gets " (1)" added). Open or attach them by path.',
  })
}

export async function saveMessageAsPdfHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  if (!context.saveMailPdf) {
    throw new AgentMailToolError('Saving PDFs is unavailable in this session.')
  }
  const threadId = requireString(args, 'threadId')
  const messageId = optionalString(args, 'messageId')
  const { thread, messages } = await requireThread(context, threadId)
  const folder = await requireSaveFolder(context)
  const chosen = pickMessages(messages, messageId)
  if (chosen.length === 0) throw new AgentMailToolError('This thread has no messages to save.')

  let result: { path: string }
  try {
    result = await context.saveMailPdf({ subject: thread.subject, messages: chosen, folder })
  } catch (error) {
    throw new AgentMailToolError(
      `Could not save the PDF: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  context.recordOperation?.(
    'mail.export.pdf',
    `Saved "${thread.subject}" as a PDF: ${result.path}.`,
  )
  return ok({
    threadId,
    subject: thread.subject,
    path: result.path,
    messages: chosen.length,
    note: messageId
      ? 'The one message, with its headers and a list of its attachments. Attachments themselves are not inside the PDF; saveAttachments saves them as files.'
      : 'The whole thread, oldest message first, with each message\'s headers and a list of its attachments. Attachments themselves are not inside the PDF; saveAttachments saves them as files.',
  })
}
