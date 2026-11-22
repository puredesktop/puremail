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
  /** Optional message importance (`Importance` + `X-Priority` headers). */
  importance?: 'low' | 'normal' | 'high'
  /** Optional MDN read receipt request (`Disposition-Notification-To`). */
  requestReadReceipt?: boolean
  /** Explicit address for `Disposition-Notification-To` (defaults to From header). */
  readReceiptTo?: string
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

/** Strip CR/LF control characters to prevent RFC 5322 header injection. */
export function sanitizeMimeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\u0000]+/g, ' ').trim()
}

/**
 * Encode an unstructured RFC 5322 header value (such as Subject). Pure ASCII
 * values pass through after CR/LF sanitization; non-ASCII values use RFC 2047
 * UTF-8 Base64 encoded-words folded to the 75-character RFC 2047 §2 limit.
 */
export function encodeMimeHeaderValue(value: string): string {
  const clean = sanitizeMimeHeaderValue(value)
  if (!clean || /^[ -~]*$/.test(clean)) return clean
  // Max 45 UTF-8 bytes => 60 base64 chars + 12 chars framing = 72 chars <= 75.
  const encoder = new TextEncoder()
  const words: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const ch of clean) {
    const chBytes = encoder.encode(ch).length
    if (chunk && chunkBytes + chBytes > 45) {
      words.push(encodeMimeWord(chunk))
      chunk = ch
      chunkBytes = chBytes
    } else {
      chunk += ch
      chunkBytes += chBytes
    }
  }
  if (chunk) words.push(encodeMimeWord(chunk))
  return words.join('\r\n ')
}

/**
 * Format an address list for RFC 5322 headers (`To`, `Cc`, `Bcc`, `Reply-To`),
 * quoting display names containing specials (like commas), RFC 2047 encoding
 * non-ASCII display names, and stripping CR/LF to prevent header injection.
 */
export function formatMimeAddressList(
  contacts: Array<{ name?: string; email: string }>,
): string {
  return contacts
    .map(contact => {
      // eslint-disable-next-line no-control-regex
      const email = sanitizeMimeHeaderValue(contact.email).replace(/[<>,\s\r\n\u0000]+/g, '')
      if (!email || !email.includes('@')) return ''
      const name = sanitizeMimeHeaderValue(contact.name ?? '')
      if (!name || name === email) return email
      if (!/^[ -~]*$/.test(name)) {
        return `${encodeMimeHeaderValue(name)} <${email}>`
      }
      const needsQuoting = /[()<>@,;:\\".[\]]/.test(name)
      const safeName = needsQuoting
        ? `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : name
      return `${safeName} <${email}>`
    })
    .filter(Boolean)
    .join(', ')
}

/** Normalize bare LF / stray CR line endings to RFC 5322 CRLF. */
function normalizeCrlf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
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

/** The text body part(s): plain text, or multipart/alternative with HTML (optionally multipart/related for inline media). */
function bodyPartLines(
  input: Pick<MimeMessageInput, 'body' | 'bodyHtml'>,
  altBoundary: string | null,
  relatedPartLines?: string[],
): string[] {
  const body = normalizeCrlf(input.body)
  if (!input.bodyHtml || altBoundary === null) {
    return ['Content-Type: text/plain; charset=utf-8', '', body]
  }
  const htmlPart = relatedPartLines ?? [
    'Content-Type: text/html; charset=utf-8',
    '',
    normalizeCrlf(input.bodyHtml),
  ]
  return [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    `--${altBoundary}`,
    ...htmlPart,
    `--${altBoundary}--`,
  ]
}

/**
 * Build the raw RFC 822 message. Plain-text-only messages match the
 * historical shape byte for byte. A `bodyHtml` alternative produces
 * multipart/alternative (text first); inline CID media wraps the HTML part
 * inside multipart/related; non-inline attachments wrap everything in
 * multipart/mixed with base64 attachment parts.
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  // Sanitize header lines against accidental CR/LF injection while preserving
  // legitimate folded continuations (`\r\n ` / `\r\n\t`).
  const safeHeaders = input.headerLines.map(line =>
    line.replace(/\u0000/g, '').replace(/\r(?!\n[ \t])|\r?\n(?![ \t])/g, ' '),
  )
  const hasHeader = (name: string): boolean => {
    const prefix = `${name.toLowerCase()}:`
    return safeHeaders.some(line => line.toLowerCase().startsWith(prefix))
  }
  const importance =
    input.importance === 'low' ||
    input.importance === 'normal' ||
    input.importance === 'high'
      ? input.importance
      : undefined
  if (importance) {
    if (!hasHeader('Importance')) {
      safeHeaders.push(`Importance: ${importance}`)
    }
    if (!hasHeader('X-Priority')) {
      const xPriority =
        importance === 'high'
          ? '1 (Highest)'
          : importance === 'low'
            ? '5 (Lowest)'
            : '3 (Normal)'
      safeHeaders.push(`X-Priority: ${xPriority}`)
    }
  }
  if (input.requestReadReceipt && !hasHeader('Disposition-Notification-To')) {
    const fromHeader = safeHeaders
      .find(line => line.toLowerCase().startsWith('from:'))
      ?.slice(5)
      .trim()
    const notifyTo = sanitizeMimeHeaderValue(
      input.readReceiptTo ?? fromHeader ?? '',
    )
    if (notifyTo) {
      safeHeaders.push(`Disposition-Notification-To: ${notifyTo}`)
    }
  }
  // Composer previews use data URLs; email carries the same bytes as CID parts.
  const inline = new Map<number, string>()
  const html = input.bodyHtml?.replace(
    /src=("|')data:((?:image|video|audio)\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\1/gi,
    (whole, quote: string, mime: string, bytes: string) => {
      const normalizedMime = mime.toLowerCase()
      const index = input.attachments.findIndex(
        (part) =>
          part.mimeType.toLowerCase() === normalizedMime &&
          part.base64.replace(/\s+/g, '') === bytes.replace(/\s+/g, ''),
      )
      if (index < 0) return whole
      const cid = inline.get(index) || `pure-media-${index}@puremail.local`
      inline.set(index, cid)
      return `src=${quote}cid:${cid}${quote}`
    },
  )
  const partLines = (part: MimeAttachmentPart, cid?: string): string[] => {
    const fileName = mimeFileName(part.name)
    const safeMimeType =
      sanitizeMimeHeaderValue(part.mimeType || 'application/octet-stream') ||
      'application/octet-stream'
    return [
      `Content-Type: ${safeMimeType}; name=${fileName}`,
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
  let relatedLines: string[] | undefined
  if (inline.size && html) {
    const related = input.boundary
      ? `${input.boundary}_related`
      : generateMimeBoundary(contents)
    contents.push(related)
    relatedLines = [
      `Content-Type: multipart/related; boundary="${related}"`,
      '',
      `--${related}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      normalizeCrlf(html),
    ]
    for (const [index, cid] of inline) {
      relatedLines.push(
        `--${related}`,
        ...partLines(input.attachments[index], cid),
      )
    }
    relatedLines.push(`--${related}--`)
  }
  const bodyInput = { body: input.body, bodyHtml: html }
  const altBoundary = html
    ? input.boundary
      ? `${input.boundary}_alt`
      : generateMimeBoundary(contents)
    : null
  if (altBoundary) contents.push(altBoundary)
  const bodyLines = bodyPartLines(bodyInput, altBoundary, relatedLines)
  const attachments = input.attachments.filter((_, index) => !inline.has(index))
  if (!attachments.length) {
    if (!html)
      return [
        ...safeHeaders,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        normalizeCrlf(input.body),
      ].join('\r\n')
    return [...safeHeaders, 'MIME-Version: 1.0', ...bodyLines].join('\r\n')
  }
  const boundary = input.boundary ?? generateMimeBoundary(contents)
  contents.push(boundary)
  const lines = [
    ...safeHeaders,
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
