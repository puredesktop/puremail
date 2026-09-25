import type { AssignHandoff } from '@purescience/platform-ui/components/agents/AssistantHeaderControls'
import { isDocumentAttachment } from './mailAttachments'
import { contactLabel } from './mailPdf'
import { stripHtmlToText } from './mailTextUtils'
import type { Attachment, MailMessage, MailThread } from '../types'

/**
 * What Mail hands the shell when a new mission is made from here: the open
 * conversation as a document, and the documents attached to it. The shell
 * shows each as a chip in its composer; the person can leave any out.
 *
 * The email is written out as Markdown — one section per message with
 * who, to whom, when, then the body as text — so the mission can read it
 * without Mail. Attachments come as bytes; anything that is not a document
 * (signatures, inline images) stays behind, and past a size the rest is
 * left out too, named, rather than handed over half.
 */

/** Total bytes of attachments handed over before the rest are left out. */
export const MAX_HANDOFF_BYTES = 12 * 1024 * 1024

const dateLabel = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace('T', ' ').slice(0, 16)
}

/** A safe file stem from a subject: "Re: Q3/Q4 numbers" → "Re_ Q3_Q4 numbers". */
const stem = (subject: string): string =>
  (subject.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Email').slice(0, 80)

export function threadMarkdown(thread: MailThread, messages: MailMessage[]): string {
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const parts = ordered.map(message => {
    const to = (message.to ?? []).map(contactLabel).join(', ')
    const body = (message.bodyHtml?.trim() ? stripHtmlToText(message.bodyHtml) : message.body)
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const files = (message.attachments ?? []).map(item => `- ${item.name} (${item.sizeLabel})`).join('\n')
    return [
      `## ${contactLabel(message.from)} · ${dateLabel(message.receivedAt)}`,
      to ? `To: ${to}` : '',
      '',
      body || '(no text)',
      files ? `\nAttachments:\n${files}` : '',
    ]
      .filter(line => line !== '')
      .join('\n')
  })
  return `# ${thread.subject.trim() || '(no subject)'}\n\n${parts.join('\n\n---\n\n')}\n`
}

/** The base64 payload of a data: URL, or null when there is none. */
export function base64Of(content: string | undefined): string | null {
  if (!content) return null
  const comma = content.indexOf(',')
  if (!content.startsWith('data:') || comma === -1 || !content.slice(0, comma).includes(';base64')) return null
  return content.slice(comma + 1)
}

export interface HandoffDeps {
  /** Bytes for an attachment that is not held locally yet; null when unavailable. */
  resolve: (message: MailMessage, attachment: Attachment) => Promise<Attachment | null>
  maxBytes?: number
}

export async function buildThreadHandoff(
  thread: MailThread,
  messages: MailMessage[],
  deps: HandoffDeps,
): Promise<AssignHandoff> {
  const attachments: NonNullable<AssignHandoff['attachments']> = [
    {
      type: 'file',
      mimeType: 'text/markdown',
      name: `${stem(thread.subject)} — email.md`,
      source: { type: 'data', encoding: 'text', data: threadMarkdown(thread, messages) },
    },
  ]
  const budget = deps.maxBytes ?? MAX_HANDOFF_BYTES
  let used = 0
  const seen = new Set<string>()
  const leftOut: string[] = []
  for (const message of [...messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))) {
    for (const attachment of message.attachments ?? []) {
      if (!isDocumentAttachment(attachment)) continue
      const key = `${attachment.name.toLowerCase()}|${attachment.size ?? attachment.sizeLabel}`
      if (seen.has(key)) continue
      seen.add(key)
      const resolved = attachment.content ? attachment : await deps.resolve(message, attachment)
      const data = base64Of(resolved?.content)
      const bytes = data ? Math.floor((data.length * 3) / 4) : 0
      if (!data || used + bytes > budget) {
        leftOut.push(attachment.name)
        continue
      }
      used += bytes
      attachments.push({
        type: 'file',
        mimeType: resolved!.mimeType || 'application/octet-stream',
        name: attachment.name,
        source: { type: 'data', encoding: 'base64', data },
      })
    }
  }
  const count = attachments.length - 1
  const note = leftOut.length ? ` (${leftOut.length} left out)` : ''
  const source = count === 0 ? `this email${note}` : `this email and ${count} ${count === 1 ? 'attachment' : 'attachments'}${note}`
  return { attachments, source }
}

/**
 * The live supplier the header's pill calls. PureMailShell keeps it
 * pointed at whatever conversation is open; App hands it to the frame.
 */
export const assignHandoff: { current: (() => Promise<AssignHandoff | null>) | null } = { current: null }
