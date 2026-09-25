import type { Attachment } from '../types'

/**
 * Gmail rejects outgoing messages over 25 MB total. The warning threshold
 * gives people room to react before the hard block kicks in.
 */
export const GMAIL_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024
export const GMAIL_ATTACHMENT_WARN_BYTES = 20 * 1024 * 1024

const DATA_URI_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*),/

export function formatAttachmentBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`
  if (byteLength < 1024 * 1024) {
    return `${Math.max(1, Math.round(byteLength / 1024))} KB`
  }
  return `${(byteLength / 1024 / 1024).toFixed(1)} MB`
}

function base64ByteLength(base64: string): number {
  const trimmed = base64.replace(/\s+/g, '')
  if (!trimmed) return 0
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.floor((trimmed.length * 3) / 4) - padding
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

// ---- Building attachments from bytes -------------------------------------
// ONE builder for every way a file becomes an attachment: the compose
// window's Attach button, drop and paste (File → bytes) and the drawer
// agent's addDraftAttachments (bridge read → bytes) all end here, so the
// id, name, mime, size label and data-URI content are derived identically
// whichever door the file came in through.

const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  ics: 'text/calendar',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

export const OCTET_STREAM_MIME_TYPE = 'application/octet-stream'

/** Mime type by file extension; null when the extension is not known. */
export function mimeTypeForFileName(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return null
  return EXTENSION_MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}

function bytesStartWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

/**
 * Cheap magic-number sniff for the formats mail attachments usually are.
 * Only the first few bytes are looked at; null means "no opinion", and the
 * caller falls back to the extension map.
 */
export function sniffMimeType(bytes: Uint8Array): string | null {
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf'
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytesStartWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp'
  }
  if (bytesStartWith(bytes, [0x1f, 0x8b])) return 'application/gzip'
  // ZIP containers (docx/xlsx/pptx are zips too) — the extension map is
  // more specific, so the container type only wins when nothing else does.
  return null
}

/**
 * The mime type an attachment is filed under: a magic-number match first
 * (a ".jpg" that is really a PNG is still a PNG), then the extension map,
 * then whatever the source claimed, then octet-stream.
 */
export function resolveAttachmentMimeType(
  name: string,
  bytes: Uint8Array,
  claimed?: string | null,
): string {
  const sniffed = sniffMimeType(bytes)
  if (sniffed) return sniffed
  const byName = mimeTypeForFileName(name)
  if (byName) return byName
  const trimmed = claimed?.trim().toLowerCase()
  if (trimmed && trimmed !== OCTET_STREAM_MIME_TYPE) return trimmed
  return OCTET_STREAM_MIME_TYPE
}

/** The id an attachment gets when it is created locally from a file. */
export function attachmentIdForFileName(name: string, now = Date.now()): string {
  return `att_${now}_${name.replace(/[^a-z0-9_-]/gi, '_')}`
}

/**
 * Build a local (content-bearing) attachment from raw bytes. Content is a
 * data URI — the same shape FileReader.readAsDataURL produced when the
 * compose window was the only way in — so every consumer of `content`
 * (previews, MIME building, disk writes) sees one format.
 */
export function attachmentFromBytes(
  name: string,
  mimeType: string,
  bytes: Uint8Array,
  now = Date.now(),
): Attachment {
  const resolvedMime = mimeType.trim() || OCTET_STREAM_MIME_TYPE
  return {
    id: attachmentIdForFileName(name, now),
    name,
    mimeType: resolvedMime,
    sizeLabel: formatAttachmentBytes(bytes.length),
    size: bytes.length,
    content: `data:${resolvedMime};base64,${bytesToBase64(bytes)}`,
  }
}

function dataUriBase64(content: string): string | null {
  const match = content.match(DATA_URI_PATTERN)
  if (!match) return null
  if (!match[0].toLowerCase().includes(';base64,')) return null
  const raw = content.slice(match[0].length)
  const padding = raw.length % 4
  return padding ? `${raw}${'='.repeat(4 - padding)}` : raw
}

/**
 * Attachment content is either a data URI (binary attachments, local file
 * reads) or decoded plain text (Gmail text/calendar parts). Both normalise
 * to padded standard base64 for MIME parts and binary disk writes.
 */
export function attachmentContentToBase64(attachment: Attachment): string | null {
  if (!attachment.content) return null
  if (attachment.content.startsWith('data:')) {
    return dataUriBase64(attachment.content)
  }
  return bytesToBase64(utf8Bytes(attachment.content))
}

function parseSizeLabel(sizeLabel: string): number | null {
  const match = sizeLabel.trim().match(/^([\d.]+)\s*(B|KB|MB|GB)$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2].toUpperCase()
  const factor =
    unit === 'B' ? 1 : unit === 'KB' ? 1024 : unit === 'MB' ? 1024 * 1024 : 1024 * 1024 * 1024
  return Math.round(value * factor)
}

/**
 * Best-known byte size: the explicit size field (from Gmail part metadata or
 * File.size) wins, then bytes derivable from local content, then the display
 * label as a lossy fallback.
 */
export function attachmentByteSize(attachment: Attachment): number | null {
  if (typeof attachment.size === 'number' && attachment.size >= 0) {
    return attachment.size
  }
  if (attachment.content) {
    const base64 = dataUriBase64(attachment.content)
    if (base64 !== null) return base64ByteLength(base64)
    if (!attachment.content.startsWith('data:')) {
      return utf8Bytes(attachment.content).length
    }
  }
  return parseSizeLabel(attachment.sizeLabel)
}

export function attachmentDisplaySize(attachment: Attachment): string {
  const bytes = attachmentByteSize(attachment)
  return bytes === null ? attachment.sizeLabel : formatAttachmentBytes(bytes)
}

export function totalAttachmentBytes(attachments: Attachment[]): number {
  return attachments.reduce(
    (total, attachment) => total + (attachmentByteSize(attachment) ?? 0),
    0,
  )
}

export interface AttachmentSizeStatus {
  totalBytes: number
  totalLabel: string
  limitLabel: string
  nearLimit: boolean
  overLimit: boolean
}

export function attachmentSizeStatus(
  attachments: Attachment[],
): AttachmentSizeStatus {
  const totalBytes = totalAttachmentBytes(attachments)
  return {
    totalBytes,
    totalLabel: formatAttachmentBytes(totalBytes),
    limitLabel: '25 MB',
    nearLimit:
      totalBytes >= GMAIL_ATTACHMENT_WARN_BYTES &&
      totalBytes <= GMAIL_ATTACHMENT_LIMIT_BYTES,
    overLimit: totalBytes > GMAIL_ATTACHMENT_LIMIT_BYTES,
  }
}

export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mimeType.toLowerCase().startsWith('image/')
}

function isTextLikeMimeType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase()
  return (
    lower.startsWith('text/') ||
    lower.includes('json') ||
    lower.includes('xml') ||
    lower.includes('csv')
  )
}

export type AttachmentPreviewKind = 'image' | 'pdf' | 'text'

export function isPdfAttachment(attachment: Attachment): boolean {
  const mime = attachment.mimeType.toLowerCase()
  if (mime === 'application/pdf') return true
  // Filename fallback only when the sender supplied no useful mimetype.
  return (
    (mime === '' || mime === 'application/octet-stream') &&
    attachment.name.toLowerCase().endsWith('.pdf')
  )
}

export function attachmentPreviewKind(
  attachment: Attachment,
): AttachmentPreviewKind | null {
  if (isImageAttachment(attachment)) return 'image'
  if (isPdfAttachment(attachment)) return 'pdf'
  if (isTextLikeMimeType(attachment.mimeType)) return 'text'
  return null
}

/** Data URL for an inline PDF preview via <object>. */
export function attachmentPdfDataUrl(attachment: Attachment): string | null {
  if (!isPdfAttachment(attachment) || !attachment.content) return null
  if (attachment.content.startsWith('data:')) return attachment.content
  const base64 = attachmentContentToBase64(attachment)
  return base64 ? `data:application/pdf;base64,${base64}` : null
}

/** Data URL usable as an <img> src, for image previews. */
export function attachmentImageDataUrl(attachment: Attachment): string | null {
  if (!isImageAttachment(attachment) || !attachment.content) return null
  if (attachment.content.startsWith('data:')) return attachment.content
  const base64 = attachmentContentToBase64(attachment)
  return base64 ? `data:${attachment.mimeType};base64,${base64}` : null
}

/** Decoded text for text-like previews (handles data-URI wrapped text). */
export function attachmentTextContent(attachment: Attachment): string | null {
  if (!attachment.content) return null
  if (!attachment.content.startsWith('data:')) return attachment.content
  const base64 = dataUriBase64(attachment.content)
  if (base64 === null) return null
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(
      base64ToBytes(base64),
    )
  } catch {
    // Silence is correct: undecodable bytes only mean "no text preview";
    // the attachment itself stays downloadable.
    return null
  }
}

const ATTACHMENT_KIND_RULES: Array<{
  label: string
  test: (mimeType: string, name: string) => boolean
}> = [
  {
    label: 'Calendar',
    test: (mimeType, name) =>
      mimeType === 'text/calendar' || name.endsWith('.ics'),
  },
  { label: 'Image', test: mimeType => mimeType.startsWith('image/') },
  { label: 'PDF', test: mimeType => mimeType.includes('pdf') },
  {
    label: 'Archive',
    test: (mimeType, name) =>
      /zip|compressed|x-tar|gzip/.test(mimeType) ||
      /\.(zip|tar|gz|tgz|rar|7z)$/.test(name),
  },
  { label: 'Audio', test: mimeType => mimeType.startsWith('audio/') },
  { label: 'Video', test: mimeType => mimeType.startsWith('video/') },
  {
    label: 'Sheet',
    test: (mimeType, name) =>
      /spreadsheet|ms-excel/.test(mimeType) || /\.(csv|xlsx?|ods)$/.test(name),
  },
  {
    label: 'Doc',
    test: (mimeType, name) =>
      /msword|wordprocessing|rtf/.test(mimeType) ||
      /\.(docx?|odt|rtf)$/.test(name),
  },
  {
    label: 'Slides',
    test: (mimeType, name) =>
      /presentation|ms-powerpoint/.test(mimeType) || /\.(pptx?|odp)$/.test(name),
  },
  { label: 'Text', test: mimeType => isTextLikeMimeType(mimeType) },
]

/** Short type label for attachment chips — "Image", "PDF", "File", ... */
export function attachmentKindLabel(attachment: Attachment): string {
  const mimeType = attachment.mimeType.toLowerCase()
  const name = attachment.name.toLowerCase()
  return (
    ATTACHMENT_KIND_RULES.find(rule => rule.test(mimeType, name))?.label ??
    'File'
  )
}

/** Strip path separators and control characters so a mail-supplied name is a safe file name. */
export function safeAttachmentFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:]/g, '_')
    .trim()
  return cleaned || 'attachment'
}

/** "report.pdf" with { "report.pdf" } taken becomes "report (1).pdf". */
export function uniqueAttachmentFileName(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const safe = safeAttachmentFileName(name)
  if (!taken.has(safe)) return safe
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const extension = dot > 0 ? safe.slice(dot) : ''
  for (let counter = 1; ; counter += 1) {
    const candidate = `${stem} (${counter})${extension}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Extensions that are documents whatever the sender claimed their type was
 * (mail clients often label a .docx or .pdf as application/octet-stream).
 */
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'xml', 'json', 'txt',
  'md', 'rtf', 'odt', 'ods', 'odp', 'ppt', 'pptx', 'pages', 'numbers', 'key',
])

/**
 * What people mean by "the documents" in a message: PDFs, Word, Excel and
 * PowerPoint files and their open equivalents, and text data such as CSV,
 * XML and JSON. Not images (signature logos are images), calendar invites,
 * archives, audio or video.
 */
export function isDocumentAttachment(attachment: Attachment): boolean {
  const label = attachmentKindLabel(attachment)
  if (label === 'Calendar') return false
  if (['PDF', 'Doc', 'Sheet', 'Slides', 'Text'].includes(label)) return true
  const dot = attachment.name.lastIndexOf('.')
  return dot > 0 && DOCUMENT_EXTENSIONS.has(attachment.name.slice(dot + 1).toLowerCase())
}

export interface WriteAttachmentsDeps {
  /** Resolve remote-only content; return null when unrecoverable. */
  resolve: (attachment: Attachment) => Promise<Attachment | null>
  writeBinary: (path: string, base64: string) => Promise<void>
  /**
   * Names already in the folder. They count as taken, so a save never
   * overwrites a file that was there before it.
   */
  existingNames?: () => Promise<Iterable<string>>
}

export interface WrittenAttachment {
  id: string
  name: string
  /** The name on disk: the attachment's, made safe and unique in the folder. */
  fileName: string
  path: string
  mimeType: string
  size: number | null
}

export interface AttachmentWriteFailure {
  id: string
  name: string
  reason: string
}

export interface WriteAttachmentsResult {
  saved: WrittenAttachment[]
  failed: AttachmentWriteFailure[]
}

/** "/a/b/" + "c.pdf" → "/a/b/c.pdf", for either separator. */
export function joinFolderPath(folder: string, fileName: string): string {
  return `${folder.replace(/[\\/]+$/, '')}/${fileName}`
}

/**
 * Write attachments into one folder: resolve each one's bytes, give it a
 * safe name that is unique in the folder (never overwriting what is there),
 * and report what landed where and what could not be saved. The reader's
 * Save all and the saveAttachments agent tool both write through here.
 */
export async function writeAttachmentsToFolder(
  attachments: Attachment[],
  folder: string,
  deps: WriteAttachmentsDeps,
): Promise<WriteAttachmentsResult> {
  const taken = new Set<string>()
  if (deps.existingNames) {
    try {
      for (const name of await deps.existingNames()) taken.add(name)
    } catch {
      // A folder that does not exist yet has nothing in it to protect.
    }
  }
  const saved: WrittenAttachment[] = []
  const failed: AttachmentWriteFailure[] = []
  for (const attachment of attachments) {
    let resolved: Attachment | null = null
    try {
      resolved = await deps.resolve(attachment)
    } catch {
      resolved = null
    }
    if (!resolved?.content) {
      failed.push({ id: attachment.id, name: attachment.name, reason: 'Could not download it from the mail server.' })
      continue
    }
    const base64 = attachmentContentToBase64(resolved)
    if (base64 === null) {
      failed.push({ id: attachment.id, name: attachment.name, reason: 'Could not decode the file.' })
      continue
    }
    const fileName = uniqueAttachmentFileName(resolved.name, taken)
    taken.add(fileName)
    const path = joinFolderPath(folder, fileName)
    try {
      await deps.writeBinary(path, base64)
      saved.push({
        id: attachment.id,
        name: attachment.name,
        fileName,
        path,
        mimeType: resolved.mimeType,
        size: attachmentByteSize(resolved),
      })
    } catch (error) {
      failed.push({
        id: attachment.id,
        name: attachment.name,
        reason: error instanceof Error ? error.message : 'Could not write the file.',
      })
    }
  }
  return { saved, failed }
}

export interface SaveAllAttachmentsDeps extends WriteAttachmentsDeps {
  pickFolder: () => Promise<string | null>
}

export interface SaveAllAttachmentsResult {
  status: 'saved' | 'cancelled'
  folder?: string
  /** File names written, in order. */
  saved: string[]
  /** Attachment names that could not be saved. */
  failed: string[]
  written?: WriteAttachmentsResult
}

/**
 * "Save all": pick one folder, then write every attachment into it. IO is
 * injected so the orchestration (resolution failures, partial writes, name
 * dedup) is unit-testable.
 */
export async function saveAllAttachments(
  attachments: Attachment[],
  deps: SaveAllAttachmentsDeps,
): Promise<SaveAllAttachmentsResult> {
  const folder = await deps.pickFolder()
  if (!folder) return { status: 'cancelled', saved: [], failed: [] }
  const written = await writeAttachmentsToFolder(attachments, folder, deps)
  return {
    status: 'saved',
    folder,
    saved: written.saved.map(item => item.fileName),
    failed: written.failed.map(item => item.name),
    written,
  }
}
