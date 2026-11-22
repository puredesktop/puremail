import type { Attachment, MailMessage, MailThread } from '../types'
import {
  buildMimeMessage,
  encodeMimeHeaderValue,
  formatMimeAddressList,
  sanitizeMimeHeaderValue,
  type MimeAttachmentPart,
} from './mailMime'

function formatRfc2822Date(iso: string): string {
  const parsed = new Date(iso)
  if (!Number.isFinite(parsed.getTime())) {
    return new Date(0).toUTCString()
  }
  return parsed.toUTCString()
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function attachmentToMimePart(attachment: Attachment): MimeAttachmentPart | null {
  if (!attachment.content) return null
  // Only treat content as pre-encoded base64 when explicitly carrying a
  // `data:...;base64,` URI prefix; otherwise UTF-8 base64-encode cleanly so
  // short JSON/text payloads like `"true"` or `"null"` are never corrupted.
  const dataUriMatch = /^data:([^;,]+)?(?:;[^;,]+)*;base64,([\s\S]+)$/i.exec(
    attachment.content.trim(),
  )
  const base64 = dataUriMatch
    ? dataUriMatch[2]!.replace(/\s+/g, '')
    : utf8ToBase64(attachment.content)
  return {
    name: attachment.name || 'attachment',
    mimeType:
      dataUriMatch?.[1] || attachment.mimeType || 'application/octet-stream',
    base64,
  }
}

function normalizedMessageId(
  rawHeader: string | undefined,
  fallbackId: string,
): string {
  const cleaned = sanitizeMimeHeaderValue(rawHeader ?? '')
    .replace(/^[<\s]+|[>\s]+$/g, '')
    .replace(/[<>]/g, '')
  if (cleaned) return `<${cleaned}>`
  const safeFallback =
    fallbackId.replace(/[^a-zA-Z0-9._-]/g, '') || 'message'
  return `<${safeFallback}@puremail.local>`
}

export function buildEmlFromMessage(message: MailMessage): string {
  const headers: string[] = []
  const fromFormatted = formatMimeAddressList([message.from])
  if (fromFormatted) headers.push(`From: ${fromFormatted}`)

  const toFormatted = formatMimeAddressList(message.to ?? [])
  if (toFormatted) headers.push(`To: ${toFormatted}`)

  const ccFormatted = formatMimeAddressList(message.cc ?? [])
  if (ccFormatted) headers.push(`Cc: ${ccFormatted}`)

  const bccFormatted = formatMimeAddressList(message.bcc ?? [])
  if (bccFormatted) headers.push(`Bcc: ${bccFormatted}`)

  const replyToFormatted = formatMimeAddressList(message.replyTo ?? [])
  if (replyToFormatted) headers.push(`Reply-To: ${replyToFormatted}`)

  headers.push(`Date: ${formatRfc2822Date(message.receivedAt)}`)
  headers.push(
    `Subject: ${encodeMimeHeaderValue(message.subject || '(no subject)')}`,
  )
  headers.push(
    `Message-ID: ${normalizedMessageId(message.messageIdHeader, message.id)}`,
  )

  if (message.inReplyTo) {
    headers.push(`In-Reply-To: ${sanitizeMimeHeaderValue(message.inReplyTo)}`)
  }
  if (message.references?.length) {
    const refs = message.references
      .map(ref => sanitizeMimeHeaderValue(ref))
      .filter(Boolean)
      .join(' ')
    if (refs) headers.push(`References: ${refs}`)
  }

  const attachments = (message.attachments ?? [])
    .map(attachmentToMimePart)
    .filter((part): part is MimeAttachmentPart => part !== null)

  return buildMimeMessage({
    headerLines: headers,
    body: message.body ?? '',
    ...(message.bodyHtml ? { bodyHtml: message.bodyHtml } : {}),
    attachments,
    importance: message.importance,
  })
}

function formatContactMd(contact: { name: string; email: string }): string {
  const name = contact.name.trim()
  const email = contact.email.trim()
  if (!name || name.toLowerCase() === email.toLowerCase()) return email
  return `${name} <${email}>`
}

export function buildMarkdownFromThread(
  thread: MailThread,
  messages: MailMessage[],
): string {
  const sorted = [...messages]
    .filter(
      message =>
        message.threadId === thread.id ||
        messages.every(m => m.threadId !== thread.id),
    )
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))

  const lines: string[] = []
  lines.push(`# ${thread.subject || '(no subject)'}`)
  lines.push('')
  lines.push(`- **Thread ID:** \`${thread.id}\``)
  if (thread.participants.length > 0) {
    lines.push(
      `- **Participants:** ${thread.participants.map(formatContactMd).join(', ')}`,
    )
  }
  if (thread.labels.length > 0) {
    lines.push(`- **Labels:** ${thread.labels.join(', ')}`)
  }
  lines.push(`- **Messages:** ${sorted.length}`)
  if (sorted.length > 0) {
    const firstDate = sorted[0]!.receivedAt
    const lastDate = sorted[sorted.length - 1]!.receivedAt
    lines.push(
      firstDate === lastDate
        ? `- **Date:** ${firstDate}`
        : `- **Date range:** ${firstDate} — ${lastDate}`,
    )
  }

  for (const message of sorted) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push(`## ${formatContactMd(message.from)} — ${message.receivedAt}`)
    lines.push('')
    if (message.to.length > 0) {
      lines.push(`**To:** ${message.to.map(formatContactMd).join(', ')}`)
    }
    if (message.cc?.length) {
      lines.push(`**Cc:** ${message.cc.map(formatContactMd).join(', ')}`)
    }
    lines.push('')
    lines.push((message.body || '').trim() || '*(empty body)*')

    if (message.attachments.length > 0) {
      lines.push('')
      lines.push('**Attachments:**')
      for (const att of message.attachments) {
        const meta = [att.mimeType, att.sizeLabel].filter(Boolean).join(', ')
        lines.push(`- ${att.name}${meta ? ` (${meta})` : ''}`)
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}

const WINDOWS_RESERVED_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function safeExportFilename(
  subject: string | null | undefined,
  ext: 'eml' | 'md',
): string {
  const cleaned = String(subject ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^[.-]+|[.-]+$/g, '')

  let base = cleaned || (ext === 'eml' ? 'message' : 'thread')
  if (WINDOWS_RESERVED_BASENAME.test(base)) {
    base = `mail-${base}`
  }
  return `${base}.${ext}`
}
