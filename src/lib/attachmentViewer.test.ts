import { describe, expect, it } from 'vitest'

import type { Attachment } from '../types'
import {
  attachmentCacheFileName,
  attachmentCacheKey,
  isViewerUnsupportedError,
  openAttachmentInViewerWindow,
  parentDirectoryPath,
  type OpenAttachmentInViewerDeps,
} from './attachmentViewer'

const PDF_DATA_URI = `data:application/pdf;base64,${btoa('%PDF-1.4 tiny')}`

function pdfAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att_1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    sizeLabel: '10 KB',
    content: PDF_DATA_URI,
    ...overrides,
  }
}

function deps(
  overrides: Partial<OpenAttachmentInViewerDeps> = {},
): OpenAttachmentInViewerDeps & {
  writes: Array<{ path: string; base64: string }>
  opens: Array<{ path: string; title?: string }>
} {
  const writes: Array<{ path: string; base64: string }> = []
  const opens: Array<{ path: string; title?: string }> = []
  return {
    writes,
    opens,
    resolve: async attachment => attachment,
    cacheDir: async () => '/stores/puremail-attachments',
    writeBinary: async (path, base64) => {
      writes.push({ path, base64 })
    },
    openViewer: async request => {
      opens.push(request)
    },
    ...overrides,
  }
}

describe('attachment cache naming', () => {
  it('is stable for the same message + attachment pair', () => {
    expect(attachmentCacheKey('msg_1', 'att_1')).toBe(
      attachmentCacheKey('msg_1', 'att_1'),
    )
  })

  it('differs across messages so same-named files never collide', () => {
    expect(attachmentCacheFileName('msg_1', 'att_1', 'report.pdf')).not.toBe(
      attachmentCacheFileName('msg_2', 'att_1', 'report.pdf'),
    )
  })

  it('always ends in .pdf exactly once, whatever the source name', () => {
    expect(attachmentCacheFileName('m', 'a', 'Report.PDF')).toMatch(
      /^[0-9a-f]{8}-Report\.pdf$/,
    )
    expect(attachmentCacheFileName('m', 'a', 'scan')).toMatch(
      /^[0-9a-f]{8}-scan\.pdf$/,
    )
  })

  it('sanitizes path separators out of mail-supplied names', () => {
    expect(attachmentCacheFileName('m', 'a', '../../etc/passwd.pdf')).not.toContain(
      '/',
    )
  })

  it('survives a name that sanitizes to nothing', () => {
    expect(attachmentCacheFileName('m', 'a', '')).toMatch(
      /^[0-9a-f]{8}-attachment\.pdf$/,
    )
  })
})

describe('parentDirectoryPath', () => {
  it('takes the directory of a POSIX path', () => {
    expect(parentDirectoryPath('/a/b/store.json')).toBe('/a/b')
  })
  it('handles Windows separators', () => {
    expect(parentDirectoryPath('C:\\data\\store.json')).toBe('C:\\data')
  })
  it('returns null for a bare name', () => {
    expect(parentDirectoryPath('store.json')).toBeNull()
  })
})

describe('isViewerUnsupportedError', () => {
  it('recognizes a renderer that predates the method', () => {
    expect(
      isViewerUnsupportedError('Method not allowed: viewer.openFileWindow'),
    ).toBe(true)
  })

  it('recognizes a main process older than its renderer', () => {
    expect(
      isViewerUnsupportedError(
        "Error invoking remote method 'shell:viewer:open-file-window': " +
          "No handler registered for 'shell:viewer:open-file-window'",
      ),
    ).toBe(true)
  })

  it('leaves ordinary failures alone', () => {
    expect(isViewerUnsupportedError('ENOENT: no such file')).toBe(false)
    expect(isViewerUnsupportedError('Could not decode the file.')).toBe(false)
  })
})

describe('openAttachmentInViewerWindow', () => {
  it('writes the cache file once and opens the viewer titled by file name', async () => {
    const d = deps()
    const result = await openAttachmentInViewerWindow('msg_1', pdfAttachment(), {
      ...d,
      written: new Set(),
    })
    expect(result.status).toBe('opened')
    expect(d.writes).toHaveLength(1)
    expect(d.writes[0].path).toMatch(
      /^\/stores\/puremail-attachments\/[0-9a-f]{8}-report\.pdf$/,
    )
    expect(d.opens).toEqual([{ path: d.writes[0].path, title: 'report.pdf' }])
  })

  it('skips the rewrite when the path was already written this session', async () => {
    const d = deps()
    const written = new Set<string>()
    await openAttachmentInViewerWindow('msg_1', pdfAttachment(), {
      ...d,
      written,
    })
    await openAttachmentInViewerWindow('msg_1', pdfAttachment(), {
      ...d,
      written,
    })
    expect(d.writes).toHaveLength(1)
    expect(d.opens).toHaveLength(2)
  })

  it('refuses non-PDF attachments', async () => {
    const d = deps()
    const result = await openAttachmentInViewerWindow(
      'msg_1',
      pdfAttachment({ name: 'notes.txt', mimeType: 'text/plain' }),
      d,
    )
    expect(result).toEqual({
      status: 'error',
      reason: 'Only PDF attachments open in the viewer.',
    })
    expect(d.writes).toHaveLength(0)
    expect(d.opens).toHaveLength(0)
  })

  it('reports unavailable when content cannot be resolved', async () => {
    const d = deps({ resolve: async () => null })
    expect(
      await openAttachmentInViewerWindow('msg_1', pdfAttachment(), d),
    ).toEqual({ status: 'unavailable' })
  })

  it('reports an error when no cache folder exists', async () => {
    const d = deps({ cacheDir: async () => null })
    const result = await openAttachmentInViewerWindow(
      'msg_1',
      pdfAttachment(),
      d,
    )
    expect(result.status).toBe('error')
    expect(d.opens).toHaveLength(0)
  })

  it('surfaces viewer failures as errors', async () => {
    const d = deps({
      openViewer: async () => {
        throw new Error('Unhandled bridge method: viewer.openFileWindow')
      },
    })
    const result = await openAttachmentInViewerWindow(
      'msg_1',
      pdfAttachment(),
      d,
    )
    expect(result).toEqual({
      status: 'error',
      reason: 'Unhandled bridge method: viewer.openFileWindow',
    })
  })
})
