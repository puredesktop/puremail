import { describe, expect, it } from 'vitest'
import {
  attachmentByteSize,
  attachmentContentToBase64,
  attachmentDisplaySize,
  attachmentImageDataUrl,
  attachmentKindLabel,
  attachmentPreviewKind,
  attachmentSizeStatus,
  attachmentTextContent,
  base64ToBytes,
  bytesToBase64,
  formatAttachmentBytes,
  GMAIL_ATTACHMENT_LIMIT_BYTES,
  GMAIL_ATTACHMENT_WARN_BYTES,
  safeAttachmentFileName,
  totalAttachmentBytes,
  uniqueAttachmentFileName,
  attachmentPdfDataUrl,
  saveAllAttachments,
  attachmentFromBytes,
  attachmentIdForFileName,
  mimeTypeForFileName,
  OCTET_STREAM_MIME_TYPE,
  resolveAttachmentMimeType,
  sniffMimeType,
} from './mailAttachments'
import type { Attachment } from '../types'

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    sizeLabel: '2 KB',
    ...overrides,
  }
}

describe('attachment size accounting', () => {
  it('formats byte counts like the rest of the suite', () => {
    expect(formatAttachmentBytes(0)).toBe('0 B')
    expect(formatAttachmentBytes(512)).toBe('512 B')
    expect(formatAttachmentBytes(2048)).toBe('2 KB')
    expect(formatAttachmentBytes(1024 * 1024 * 1.5)).toBe('1.5 MB')
  })

  it('prefers the explicit size field over everything else', () => {
    expect(
      attachmentByteSize(attachment({ size: 12345, content: 'short' })),
    ).toBe(12345)
  })

  it('derives bytes from data-URI content', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5])
    const content = `data:application/pdf;base64,${bytesToBase64(bytes)}`
    expect(attachmentByteSize(attachment({ content }))).toBe(5)
  })

  it('derives bytes from plain-text content using UTF-8 length', () => {
    expect(
      attachmentByteSize(
        attachment({ mimeType: 'text/calendar', content: 'héllo' }),
      ),
    ).toBe(6)
  })

  it('falls back to parsing the size label', () => {
    expect(attachmentByteSize(attachment({ sizeLabel: '744 KB' }))).toBe(
      744 * 1024,
    )
    expect(attachmentByteSize(attachment({ sizeLabel: '1.5 MB' }))).toBe(
      Math.round(1.5 * 1024 * 1024),
    )
    expect(attachmentByteSize(attachment({ sizeLabel: 'unknown' }))).toBeNull()
  })

  it('shows the exact size when bytes are known', () => {
    expect(attachmentDisplaySize(attachment({ size: 2048 }))).toBe('2 KB')
    expect(attachmentDisplaySize(attachment({ sizeLabel: 'unknown' }))).toBe(
      'unknown',
    )
  })

  it('totals across attachments, ignoring unknown sizes', () => {
    expect(
      totalAttachmentBytes([
        attachment({ size: 1000 }),
        attachment({ id: 'att-2', size: 500 }),
        attachment({ id: 'att-3', sizeLabel: 'unknown' }),
      ]),
    ).toBe(1500)
  })

  it('flags the warning band below the limit and blocks above it', () => {
    const under = attachmentSizeStatus([attachment({ size: 1024 })])
    expect(under).toMatchObject({ nearLimit: false, overLimit: false })

    const warn = attachmentSizeStatus([
      attachment({ size: GMAIL_ATTACHMENT_WARN_BYTES }),
    ])
    expect(warn).toMatchObject({ nearLimit: true, overLimit: false })

    const atLimit = attachmentSizeStatus([
      attachment({ size: GMAIL_ATTACHMENT_LIMIT_BYTES }),
    ])
    expect(atLimit).toMatchObject({ nearLimit: true, overLimit: false })

    const over = attachmentSizeStatus([
      attachment({ size: GMAIL_ATTACHMENT_LIMIT_BYTES + 1 }),
    ])
    expect(over).toMatchObject({ nearLimit: false, overLimit: true })
    expect(over.limitLabel).toBe('25 MB')
  })
})

describe('attachment content conversion', () => {
  it('round-trips binary data-URI content to padded base64', () => {
    const bytes = Uint8Array.from({ length: 100 }, (_, index) => index)
    const unpadded = bytesToBase64(bytes).replace(/=+$/, '')
    const base64 = attachmentContentToBase64(
      attachment({ content: `data:image/png;base64,${unpadded}` }),
    )
    expect(base64).not.toBeNull()
    expect(base64!.length % 4).toBe(0)
    expect([...base64ToBytes(base64!)]).toEqual([...bytes])
  })

  it('encodes plain-text content as UTF-8 base64', () => {
    const base64 = attachmentContentToBase64(
      attachment({ mimeType: 'text/calendar', content: 'BEGIN:VCALENDAR é' }),
    )
    expect(base64).not.toBeNull()
    expect(
      new TextDecoder().decode(base64ToBytes(base64!)),
    ).toBe('BEGIN:VCALENDAR é')
  })

  it('returns null when there is no content', () => {
    expect(attachmentContentToBase64(attachment())).toBeNull()
  })

  it('decodes data-URI wrapped text for previews', () => {
    const content = `data:text/plain;base64,${bytesToBase64(
      new TextEncoder().encode('hello über'),
    )}`
    expect(
      attachmentTextContent(
        attachment({ mimeType: 'text/plain', content }),
      ),
    ).toBe('hello über')
    expect(
      attachmentTextContent(
        attachment({ mimeType: 'text/plain', content: 'raw text' }),
      ),
    ).toBe('raw text')
  })

  it('builds an image data URL from raw or data-URI content', () => {
    const dataUri = 'data:image/png;base64,AAAA'
    expect(
      attachmentImageDataUrl(
        attachment({ mimeType: 'image/png', content: dataUri }),
      ),
    ).toBe(dataUri)
    expect(
      attachmentImageDataUrl(attachment({ content: 'data:image/png;base64,AAAA' })),
    ).toBeNull()
  })
})

describe('attachment preview and kind detection', () => {
  it('detects preview kinds', () => {
    expect(
      attachmentPreviewKind(attachment({ mimeType: 'image/jpeg' })),
    ).toBe('image')
    expect(
      attachmentPreviewKind(attachment({ mimeType: 'text/plain' })),
    ).toBe('text')
    expect(
      attachmentPreviewKind(attachment({ mimeType: 'application/json' })),
    ).toBe('text')
    // M3: PDFs now preview inline via <object>.
    expect(
      attachmentPreviewKind(attachment({ mimeType: 'application/pdf' })),
    ).toBe('pdf')
  })

  it('labels attachment kinds for chips', () => {
    expect(attachmentKindLabel(attachment({ mimeType: 'image/png' }))).toBe(
      'Image',
    )
    expect(attachmentKindLabel(attachment())).toBe('PDF')
    expect(
      attachmentKindLabel(
        attachment({ name: 'invite.ics', mimeType: 'text/calendar' }),
      ),
    ).toBe('Calendar')
    expect(
      attachmentKindLabel(
        attachment({ name: 'bundle.zip', mimeType: 'application/zip' }),
      ),
    ).toBe('Archive')
    expect(
      attachmentKindLabel(
        attachment({ name: 'data.csv', mimeType: 'text/csv' }),
      ),
    ).toBe('Sheet')
    expect(
      attachmentKindLabel(
        attachment({ name: 'blob.bin', mimeType: 'application/octet-stream' }),
      ),
    ).toBe('File')
  })
})

describe('attachment file names', () => {
  it('strips path separators and control characters', () => {
    expect(safeAttachmentFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(safeAttachmentFileName('re\u0000port\n.pdf')).toBe('report.pdf')
    expect(safeAttachmentFileName('   ')).toBe('attachment')
  })

  it('uniquifies names against already-taken ones', () => {
    const taken = new Set(['report.pdf', 'report (1).pdf'])
    expect(uniqueAttachmentFileName('report.pdf', taken)).toBe(
      'report (2).pdf',
    )
    expect(uniqueAttachmentFileName('notes', new Set(['notes']))).toBe(
      'notes (1)',
    )
    expect(uniqueAttachmentFileName('fresh.txt', new Set())).toBe('fresh.txt')
  })
})

describe('saveAllAttachments orchestration (M3)', () => {
  const attachment = (name: string, content: string | null) => ({
    id: `att_${name}`,
    name,
    mimeType: 'application/pdf',
    sizeLabel: '1 KB',
    ...(content ? { content } : {}),
  })

  it('resolves, dedupes names, and reports saved/failed', async () => {
    const writes: Array<{ path: string }> = []
    const result = await saveAllAttachments(
      [
        attachment('report.pdf', 'data:application/pdf;base64,QUJD'),
        attachment('report.pdf', 'data:application/pdf;base64,REVG'),
        attachment('broken.pdf', null),
      ],
      {
        resolve: async item => (item.content ? item : null),
        pickFolder: async () => '/tmp/save-here',
        writeBinary: async path => {
          writes.push({ path })
        },
      },
    )
    expect(result.status).toBe('saved')
    expect(result.folder).toBe('/tmp/save-here')
    expect(result.saved).toHaveLength(2)
    expect(new Set(result.saved).size).toBe(2)
    expect(result.failed).toEqual(['broken.pdf'])
    expect(writes.every(write => write.path.startsWith('/tmp/save-here/'))).toBe(
      true,
    )
  })

  it('cancels cleanly when no folder is picked and survives write errors', async () => {
    const cancelled = await saveAllAttachments(
      [attachment('a.pdf', 'data:application/pdf;base64,QUJD')],
      {
        resolve: async item => item,
        pickFolder: async () => null,
        writeBinary: async () => {},
      },
    )
    expect(cancelled).toEqual({ status: 'cancelled', saved: [], failed: [] })

    const partial = await saveAllAttachments(
      [
        attachment('ok.pdf', 'data:application/pdf;base64,QUJD'),
        attachment('boom.pdf', 'data:application/pdf;base64,REVG'),
      ],
      {
        resolve: async item => item,
        pickFolder: async () => '/tmp/x',
        writeBinary: async path => {
          if (path.includes('boom')) throw new Error('disk full')
        },
      },
    )
    expect(partial.saved).toEqual(['ok.pdf'])
    expect(partial.failed).toEqual(['boom.pdf'])
  })
})

describe('attachment preview kinds (M3)', () => {
  it('classifies pdf attachments and builds pdf data urls', () => {
    const pdf = {
      id: 'a1',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeLabel: '1 KB',
      content: 'data:application/pdf;base64,QUJD',
    }
    expect(attachmentPreviewKind(pdf)).toBe('pdf')
    expect(attachmentPdfDataUrl(pdf)).toBe(
      'data:application/pdf;base64,QUJD',
    )
    expect(
      attachmentPreviewKind({
        id: 'a2',
        name: 'x.bin',
        mimeType: 'application/octet-stream',
        sizeLabel: '1 KB',
      }),
    ).toBeNull()
  })
})

describe('attachmentFromBytes — the one builder for local files', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

  it('derives id, size label, exact size and a data-URI content', () => {
    const built = attachmentFromBytes('report.pdf', 'application/pdf', PDF, 1234)
    expect(built.id).toBe('att_1234_report_pdf')
    expect(built.name).toBe('report.pdf')
    expect(built.mimeType).toBe('application/pdf')
    expect(built.size).toBe(8)
    expect(built.sizeLabel).toBe('8 B')
    expect(built.content).toBe(
      `data:application/pdf;base64,${bytesToBase64(PDF)}`,
    )
    // Round-trips through the same decoder the MIME builder uses.
    expect(base64ToBytes(attachmentContentToBase64(built)!)).toEqual(PDF)
    expect(attachmentByteSize(built)).toBe(8)
  })

  it('falls back to octet-stream when no mime type is given', () => {
    expect(attachmentFromBytes('x', '', new Uint8Array([1])).mimeType).toBe(
      OCTET_STREAM_MIME_TYPE,
    )
  })

  it('sanitises the id the same way the compose window always did', () => {
    expect(attachmentIdForFileName('My File (1).png', 7)).toBe(
      'att_7_My_File__1__png',
    )
  })
})

describe('mime detection', () => {
  it('maps common extensions and is case-insensitive', () => {
    expect(mimeTypeForFileName('a.PDF')).toBe('application/pdf')
    expect(mimeTypeForFileName('a.jpeg')).toBe('image/jpeg')
    expect(mimeTypeForFileName('a.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(mimeTypeForFileName('a.ics')).toBe('text/calendar')
    expect(mimeTypeForFileName('noext')).toBeNull()
    expect(mimeTypeForFileName('a.weird')).toBeNull()
    expect(mimeTypeForFileName('trailing.')).toBeNull()
  })

  it('sniffs the usual magic numbers and stays silent otherwise', () => {
    expect(sniffMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(
      'application/pdf',
    )
    expect(sniffMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(
      'image/png',
    )
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    )
    expect(sniffMimeType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe(
      'image/gif',
    )
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffMimeType(webp)).toBe('image/webp')
    expect(sniffMimeType(new Uint8Array([0x1f, 0x8b]))).toBe('application/gzip')
    expect(sniffMimeType(new Uint8Array([0x00, 0x01]))).toBeNull()
    expect(sniffMimeType(new Uint8Array([]))).toBeNull()
  })

  it('resolves: sniff beats extension beats the claimed type beats octet-stream', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    // A ".jpg" that is really a PNG is a PNG.
    expect(resolveAttachmentMimeType('photo.jpg', png, 'image/jpeg')).toBe(
      'image/png',
    )
    expect(
      resolveAttachmentMimeType('sheet.csv', new Uint8Array([0x61]), null),
    ).toBe('text/csv')
    expect(
      resolveAttachmentMimeType('mystery.xyz', new Uint8Array([0x61]), 'chemical/x-pdb'),
    ).toBe('chemical/x-pdb')
    expect(
      resolveAttachmentMimeType(
        'mystery.xyz',
        new Uint8Array([0x61]),
        'application/octet-stream',
      ),
    ).toBe(OCTET_STREAM_MIME_TYPE)
    expect(resolveAttachmentMimeType('mystery', new Uint8Array([0x61]))).toBe(
      OCTET_STREAM_MIME_TYPE,
    )
  })
})
