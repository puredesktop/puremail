// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../types'
import { isDocumentAttachment, writeAttachmentsToFolder } from './mailAttachments'
import { buildMailPdfHtml, mailPdfFileName, saveMailAsPdf, type SaveMailPdfDeps } from './mailPdf'

const message = (id: string, receivedAt: string, extra: Partial<MailMessage> = {}): MailMessage => ({
  id,
  threadId: 't1',
  from: { name: 'Riley <Example>', email: 'riley@publisher.example' },
  to: [{ name: '', email: 'alex@business.example' }],
  subject: 'Q3 & rights',
  body: 'Line one\nline two\n\nSecond paragraph',
  receivedAt,
  attachments: [],
  read: true,
  ...extra,
})

describe('the PDF page', () => {
  it('lays the thread out oldest first, escaped, with bodies sanitized and attachments listed', () => {
    const html = buildMailPdfHtml({
      subject: 'Q3 & rights',
      messages: [
        message('b', '2026-07-22T09:00:00.000Z', {
          bodyHtml: '<p>Newer <b>reply</b></p><script>alert(1)</script>',
          attachments: [{ id: 'a', name: 'rights.xml', mimeType: 'application/xml', sizeLabel: '9 B', size: 9 }],
        }),
        message('a', '2026-07-20T09:00:00.000Z'),
      ],
    })
    expect(html).toContain('<h1>Q3 &amp; rights</h1>')
    expect(html).toContain('Riley &lt;Example&gt; &lt;riley@publisher.example&gt;')
    expect(html).toContain('<p>Line one<br>line two</p>')
    expect(html.indexOf('Second paragraph')).toBeLessThan(html.indexOf('Newer'))
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('rights.xml · 9 B')
  })

  it('is named after the subject and never takes a name already in the folder', () => {
    expect(mailPdfFileName('Re: Q3/Q4 numbers')).toBe('Re_ Q3_Q4 numbers.pdf')
    expect(mailPdfFileName('Report', new Set(['Report.pdf']))).toBe('Report (1).pdf')
    expect(mailPdfFileName('   ')).toBe('Email.pdf')
  })
})

describe('saving a PDF', () => {
  const deps = (overrides: Partial<SaveMailPdfDeps> = {}) => {
    const texts: string[] = []
    const printed: Array<{ htmlPath: string; outputPath: string }> = []
    const binaries: Array<{ path: string; base64: string }> = []
    const value: SaveMailPdfDeps = {
      scratchDir: async () => '/data/mail/puremail-scratch',
      writeText: async path => {
        texts.push(path)
      },
      print: async request => {
        printed.push(request)
        return request.outputPath
      },
      readBinary: async () => ({ base64: 'JVBERi0=', byteLength: 5 }),
      writeBinary: async (path, base64) => {
        binaries.push({ path, base64 })
      },
      existingNames: async () => ['Q3 & rights.pdf'],
      ...overrides,
    }
    return { value, texts, printed, binaries }
  }
  const input = { subject: 'Q3 & rights', messages: [message('a', '2026-07-20T09:00:00.000Z')] }

  it('prints inside the scratch folder, then writes the PDF into the folder under a new name', async () => {
    const { value, texts, printed, binaries } = deps()
    const { path } = await saveMailAsPdf(input, { folder: '/Users/developer/Docs' }, value)
    expect(texts).toEqual(['/data/mail/puremail-scratch/mail-print.html'])
    // The print service's working files stay in the scratch folder.
    expect(printed[0]).toEqual({
      htmlPath: '/data/mail/puremail-scratch/mail-print.html',
      outputPath: '/data/mail/puremail-scratch/mail-print.pdf',
    })
    expect(binaries).toEqual([{ path: '/Users/developer/Docs/Q3 & rights (1).pdf', base64: 'JVBERi0=' }])
    expect(path).toBe('/Users/developer/Docs/Q3 & rights (1).pdf')
  })

  it('goes exactly where the save dialog says, adding .pdf when missing', async () => {
    const { value, binaries } = deps()
    await saveMailAsPdf(input, { outputPath: '/Users/developer/thread' }, value)
    expect(binaries[0].path).toBe('/Users/developer/thread.pdf')
  })

  it('fails loudly when the PDF comes out empty, writing nothing', async () => {
    const { value, binaries } = deps({ readBinary: async () => ({ base64: '', byteLength: 0 }) })
    await expect(saveMailAsPdf(input, { folder: '/x' }, value)).rejects.toThrow(/empty/)
    expect(binaries).toEqual([])
  })
})

describe('attachments as documents', () => {
  const attachment = (name: string, mimeType: string) => ({ id: name, name, mimeType, sizeLabel: '1 KB' })

  it('counts PDFs, office files and text data, not images or invites', () => {
    expect(isDocumentAttachment(attachment('a.pdf', 'application/pdf'))).toBe(true)
    expect(isDocumentAttachment(attachment('a.docx', 'application/octet-stream'))).toBe(true)
    expect(isDocumentAttachment(attachment('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe(true)
    expect(isDocumentAttachment(attachment('a.xml', 'application/xml'))).toBe(true)
    expect(isDocumentAttachment(attachment('scan.pdf', 'application/octet-stream'))).toBe(true)
    expect(isDocumentAttachment(attachment('logo.png', 'image/png'))).toBe(false)
    expect(isDocumentAttachment(attachment('invite.ics', 'text/calendar'))).toBe(false)
    expect(isDocumentAttachment(attachment('files.zip', 'application/zip'))).toBe(false)
  })

  it('writes into a folder without overwriting what is there', async () => {
    const paths: string[] = []
    const result = await writeAttachmentsToFolder(
      [
        { ...attachment('a.pdf', 'application/pdf'), content: 'data:application/pdf;base64,QUJD' },
        { ...attachment('b.pdf', 'application/pdf') },
      ],
      '/out/',
      {
        resolve: async item => (item.content ? item : null),
        writeBinary: async path => {
          paths.push(path)
        },
        existingNames: async () => ['a.pdf'],
      },
    )
    expect(paths).toEqual(['/out/a (1).pdf'])
    expect(result.saved[0]).toMatchObject({ fileName: 'a (1).pdf', size: 3 })
    expect(result.failed).toEqual([expect.objectContaining({ name: 'b.pdf' })])
  })
})
