import type { MailContact, MailMessage } from '../types'
import {
  attachmentDisplaySize,
  joinFolderPath,
  safeAttachmentFileName,
  uniqueAttachmentFileName,
} from './mailAttachments'
import { sanitizeMailHtml } from './sanitizeMailHtml'

/**
 * An email, or a whole thread, as a PDF document. The page is built here as
 * plain HTML (a heading per message: who, to whom, when; then the body the
 * reader shows, sanitized the same way; then what was attached) and the
 * shell prints it with `render.printHtml`. The reader's "Save as PDF…" and
 * the saveMessageAsPdf agent tool both come through `saveMailAsPdf`.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function contactLabel(contact: MailContact): string {
  const name = contact.name?.trim()
  return name && name.toLowerCase() !== contact.email.toLowerCase()
    ? `${name} <${contact.email}>`
    : contact.email
}

const contactList = (contacts: MailContact[] | undefined): string =>
  (contacts ?? []).map(contactLabel).join(', ')

const dateLabel = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function plainTextHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.replace(/^\n+|\n+$/g, ''))
    .filter(paragraph => paragraph.trim().length > 0)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

const PRINT_STYLES = `
  @page { size: A4; margin: 16mm 15mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font: 10.5pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #16181d; }
  h1 { margin: 0 0 14pt; font-size: 16pt; line-height: 1.25; }
  .message { break-inside: auto; }
  .message + .message { margin-top: 18pt; padding-top: 14pt; border-top: 1px solid #c9ccd3; }
  .meta { width: 100%; margin: 0 0 10pt; border-collapse: collapse; font-size: 9.5pt; }
  .meta th { width: 44pt; padding: 1pt 8pt 1pt 0; text-align: left; vertical-align: top; font-weight: 600; color: #5c616b; }
  .meta td { padding: 1pt 0; word-break: break-word; }
  .body { overflow-wrap: anywhere; }
  .body img { max-width: 100%; height: auto; }
  .body table { max-width: 100% !important; }
  .body pre { white-space: pre-wrap; }
  .attachments { margin: 10pt 0 0; padding: 8pt 10pt; border: 1px solid #d9dce2; border-radius: 4pt; font-size: 9pt; }
  .attachments strong { display: block; margin-bottom: 2pt; }
  .attachments li { margin: 0; }
`

function messageHtml(message: MailMessage): string {
  const rows: Array<[string, string]> = [
    ['From', contactLabel(message.from)],
    ['To', contactList(message.to)],
    ...(message.cc?.length ? ([['Cc', contactList(message.cc)]] as Array<[string, string]>) : []),
    ['Date', dateLabel(message.receivedAt)],
    ['Subject', message.subject],
  ]
  const meta = rows
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')
  const body = message.bodyHtml?.trim()
    ? sanitizeMailHtml(message.bodyHtml, { allowRemoteImages: false })
    : plainTextHtml(message.body)
  const attachments = message.attachments.length
    ? `<div class="attachments"><strong>Attachments</strong><ul>${message.attachments
        .map(item => `<li>${escapeHtml(item.name)} · ${escapeHtml(attachmentDisplaySize(item))}</li>`)
        .join('')}</ul></div>`
    : ''
  return `<section class="message"><table class="meta">${meta}</table><div class="body">${body}</div>${attachments}</section>`
}

/** The complete HTML document the shell prints: oldest message first, as a thread reads. */
export function buildMailPdfHtml(input: { subject: string; messages: MailMessage[] }): string {
  const title = input.subject.trim() || '(no subject)'
  const messages = [...input.messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${messages.map(messageHtml).join('\n')}
</body>
</html>`
}

/** "Re: Q3 numbers" → "Re_ Q3 numbers.pdf", unique among the names already taken. */
export function mailPdfFileName(subject: string, taken: ReadonlySet<string> = new Set()): string {
  const stem = safeAttachmentFileName(subject.trim() || 'Email').slice(0, 120).trim() || 'Email'
  return uniqueAttachmentFileName(`${stem}.pdf`, taken)
}

export interface SaveMailPdfDeps {
  /** A folder the app may write scratch files to; the page is printed from there. */
  scratchDir: () => Promise<string | null>
  writeText: (path: string, text: string) => Promise<void>
  /** `render.printHtml`: prints the page and resolves to the PDF's path. */
  print: (request: { htmlPath: string; outputPath: string }) => Promise<string>
  readBinary: (path: string) => Promise<{ base64: string; truncated?: boolean; byteLength?: number }>
  writeBinary: (path: string, base64: string) => Promise<void>
  /** Names already in the target folder, so a save never overwrites one. */
  existingNames?: (folder: string) => Promise<Iterable<string>>
}

export type SaveMailPdfTarget = { folder: string } | { outputPath: string }

/**
 * Print messages to a PDF. With a folder, the file is named after the
 * subject and never overwrites a file already there; with an output path
 * (the save dialog's answer) it goes exactly there.
 */
export async function saveMailAsPdf(
  input: { subject: string; messages: MailMessage[] },
  target: SaveMailPdfTarget,
  deps: SaveMailPdfDeps,
): Promise<{ path: string }> {
  if (input.messages.length === 0) throw new Error('There is no message to save.')
  let outputPath: string
  if ('outputPath' in target) {
    outputPath = target.outputPath.toLowerCase().endsWith('.pdf')
      ? target.outputPath
      : `${target.outputPath}.pdf`
  } else {
    let taken = new Set<string>()
    if (deps.existingNames) {
      try {
        taken = new Set(await deps.existingNames(target.folder))
      } catch {
        // A folder that does not exist yet has nothing to overwrite.
      }
    }
    outputPath = joinFolderPath(target.folder, mailPdfFileName(input.subject, taken))
  }
  // Printed inside Mail's own scratch folder, then written where it belongs.
  // The print service leaves a working file beside whatever it prints and
  // records no owner for the PDF; writing the finished file through the
  // file bridge keeps the working file out of the user's folder and records
  // the PDF as one of Mail's app objects, which agents need to read it back.
  const scratch = await deps.scratchDir()
  if (!scratch) throw new Error('PureMail has no folder to prepare the PDF in.')
  const htmlPath = joinFolderPath(scratch, 'mail-print.html')
  await deps.writeText(htmlPath, buildMailPdfHtml(input))
  const printed = (await deps.print({ htmlPath, outputPath: joinFolderPath(scratch, 'mail-print.pdf') }))
    || joinFolderPath(scratch, 'mail-print.pdf')
  const pdf = await deps.readBinary(printed)
  if (pdf.truncated) throw new Error('The PDF is too large to save.')
  if (!pdf.base64 || pdf.byteLength === 0) throw new Error('The PDF came out empty.')
  await deps.writeBinary(outputPath, pdf.base64)
  return { path: outputPath }
}
