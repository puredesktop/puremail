/**
 * RFC 822 / MIME assembly for outgoing Gmail messages. Pure string logic so
 * the multipart structure is unit-testable without a provider.
 */

export interface MimeAttachmentPart {
  name: string
  mimeType: string
  /** Standard (padded) base64 of the attachment bytes. */
  base64: string
}

export interface MimeMessageInput {
  /** Pre-built address/subject/threading header lines, WITHOUT Content-Type or MIME-Version. */
  headerLines: string[]
  body: string
  /**
   * Sanitized HTML alternative (Phase M2 rich composer). When present the
   * message body becomes multipart/alternative with the plain text first,
   * so text-only clients read `body` and rich clients render the HTML.
   */
  bodyHtml?: string
  attachments: MimeAttachmentPart[]
  /** Injectable for deterministic tests. */
  boundary?: string
}

const MIME_LINE_LENGTH = 76

/** Wrap base64 payloads at 76 characters per RFC 2045. */
export function wrapBase64Lines(base64: string): string {
  const compact = base64.replace(/\s+/g, '')
  const lines: string[] = []
  for (let index = 0; index < compact.length; index += MIME_LINE_LENGTH) {
    lines.push(compact.slice(index, index + MIME_LINE_LENGTH))
  }
  return lines.join('\r\n')
}

function encodeMimeWord(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `=?UTF-8?B?${btoa(binary)}?=`
}

/**
 * Header-safe filename: newlines can never smuggle extra headers in, quotes
 * and backslashes are escaped, and non-ASCII names use an RFC 2047 encoded
 * word (what Gmail itself emits for unicode filenames).
 */
export function mimeFileName(name: string): string {
  const flattened =
    name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() || 'attachment'
  if (/^[ -~]*$/.test(flattened)) {
    return `"${flattened.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return `"${encodeMimeWord(flattened)}"`
}

function randomBoundary(): string {
  const noise = `${Date.now().toString(16)}${Math.random()
    .toString(16)
    .slice(2)}${Math.random().toString(16).slice(2)}`
  return `=_puremail_${noise}`
}

/** A boundary must not appear inside any part it delimits. */
export function generateMimeBoundary(
  contents: string[],
  candidate: () => string = randomBoundary,
): string {
  for (;;) {
    const boundary = candidate()
    if (!contents.some((content) => content.includes(boundary))) return boundary
  }
}

/** The text body part(s): plain text, or multipart/alternative with HTML. */
function bodyPartLines(
  input: Pick<MimeMessageInput, 'body' | 'bodyHtml'>,
  altBoundary: string | null,
): string[] {
  if (!input.bodyHtml || altBoundary === null) {
    return ['Content-Type: text/plain; charset=utf-8', '', input.body]
  }
  return [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    input.body,
    `--${altBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    input.bodyHtml,
    `--${altBoundary}--`,
  ]
}

/**
 * Build the raw RFC 822 message. Plain-text-only messages match the
 * historical shape byte for byte. A `bodyHtml` alternative produces
 * multipart/alternative (text first); attachments wrap everything in
 * multipart/mixed with base64 attachment parts.
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  // Composer previews use data URLs; email carries the same bytes as CID parts.
  const inline = new Map<number, string>()
  const html = input.bodyHtml?.replace(
    /src=("|')data:((?:image|video|audio)\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\1/gi,
    (whole, quote: string, mime: string, bytes: string) => {
      const index = input.attachments.findIndex(
        (part) =>
          part.mimeType === mime &&
          part.base64.replace(/\s+/g, '') === bytes.replace(/\s+/g, ''),
      )
      if (index < 0) return whole
      const cid = inline.get(index) || `pure-media-${index}@puremail.local`
      inline.set(index, cid)
      return `src=${quote}cid:${cid}${quote}`
    },
  )
  const bodyInput = { body: input.body, bodyHtml: html }
  const altBoundary = html
    ? input.boundary
      ? `${input.boundary}_alt`
      : generateMimeBoundary([input.body, html])
    : null
  let bodyLines = bodyPartLines(bodyInput, altBoundary)
  const partLines = (part: MimeAttachmentPart, cid?: string): string[] => {
    const fileName = mimeFileName(part.name)
    return [
      `Content-Type: ${
        part.mimeType || 'application/octet-stream'
      }; name=${fileName}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: ${
        cid ? 'inline' : 'attachment'
      }; filename=${fileName}`,
      ...(cid ? [`Content-ID: <${cid}>`] : []),
      '',
      wrapBase64Lines(part.base64),
    ]
  }
  const contents = [
    input.body,
    html || '',
    ...input.attachments.map((part) => part.base64),
  ]
  if (inline.size) {
    const related = input.boundary
      ? `${input.boundary}_related`
      : generateMimeBoundary(contents)
    const lines = [
      `Content-Type: multipart/related; boundary="${related}"`,
      '',
      `--${related}`,
      ...bodyLines,
    ]
    for (const [index, cid] of inline)
      lines.push(`--${related}`, ...partLines(input.attachments[index], cid))
    lines.push(`--${related}--`)
    bodyLines = lines
  }
  const attachments = input.attachments.filter((_, index) => !inline.has(index))
  if (!attachments.length) {
    if (!html)
      return [
        ...input.headerLines,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        input.body,
      ].join('\r\n')
    return [...input.headerLines, 'MIME-Version: 1.0', ...bodyLines].join(
      '\r\n',
    )
  }
  const boundary = input.boundary ?? generateMimeBoundary(contents)
  const lines = [
    ...input.headerLines,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...bodyLines,
  ]
  for (const part of attachments)
    lines.push(`--${boundary}`, ...partLines(part))
  lines.push(`--${boundary}--`, '')
  return lines.join('\r\n')
}
