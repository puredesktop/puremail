// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { prepareMailDrop } from './mailDrop'
import { sanitizeMailHtml } from './sanitizeMailHtml'
import { buildMimeMessage } from './mailMime'
import { attachmentContentToBase64 } from './mailAttachments'
const file = (name: string, mime: string) =>
  JSON.stringify({
    version: 1,
    kind: 'file',
    name,
    dataUrl: `data:${mime};base64,YWJj`,
  })
describe('Mail cross-app content', () => {
  it('inserts a citation and safe source link, escaping markup', async () => {
    const result = await prepareMailDrop(
      JSON.stringify({
        version: 1,
        kind: 'reference',
        reference: {
          id: '1',
          title: '<Ocean>',
          type: 'article-journal',
          authors: [{ family: 'Smith' }],
          year: 2024,
          doi: '10.1234/ocean',
        },
      }),
      vi.fn(),
    )
    expect(result.html).toContain('https://doi.org/10.1234/ocean')
    expect(result.html).toContain('Smith. (2024). &lt;Ocean&gt;')
    expect(result.attachments).toEqual([])
  })
  it('shares only name and contact fields, never notes or other person data', async () => {
    const result = await prepareMailDrop(
      JSON.stringify({
        version: 1,
        kind: 'contact',
        name: 'Ada',
        emails: ['ada@example.org'],
        phones: ['123'],
        links: ['https://example.org', 'javascript:bad'],
        notes: 'PRIVATE',
        org: 'Private customer',
        tags: ['secret'],
      }),
      vi.fn(),
    )
    expect(result.html).toContain(
      'Ada<br>ada@example.org<br>123<br>https://example.org',
    )
    expect(result.html).not.toMatch(/PRIVATE|secret|customer|javascript/)
  })
  it.each([
    ['image/png', 'img'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
  ])('embeds %s with attached bytes and MIME Content-ID', async (mime, tag) => {
    const result = await prepareMailDrop(file('sample', mime), vi.fn())
    const html = sanitizeMailHtml(result.html, { allowRemoteImages: true })
    expect(html).toContain(`<${tag}`)
    expect(html).toContain(`data:${mime};base64,YWJj`)
    const raw = buildMimeMessage({
      headerLines: ['Subject: Draft only'],
      body: 'Attached media',
      bodyHtml: html,
      attachments: result.attachments.map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
        base64: attachmentContentToBase64(a)!,
      })),
      boundary: 'test',
    })
    expect(raw).toContain('multipart/related')
    expect(raw).toContain('src="cid:pure-media-0@puremail.local"')
    expect(raw).toContain('Content-ID: <pure-media-0@puremail.local>')
    expect(raw).not.toContain('src="data:')
    expect(raw).toContain('YWJj')
  })
  it('keeps PDFs and ordinary files as attachments without inserting their content', async () => {
    for (const mime of ['application/pdf', 'text/csv', 'text/calendar']) {
      const result = await prepareMailDrop(file('document', mime), vi.fn())
      expect(result.html).toBe('')
      expect(result.attachments[0].mimeType).toBe(mime)
    }
  })
  it('rasterizes SVG after validation and retains its caption', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
    const rasterize = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const result = await prepareMailDrop(
      JSON.stringify({
        version: 1,
        name: 'chart.svg',
        alt: 'Chart',
        caption: 'Results',
        dataUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
      }),
      rasterize,
    )
    expect(rasterize).toHaveBeenCalledOnce()
    expect(result.attachments[0].mimeType).toBe('image/png')
    expect(result.html).toContain('Results')
  })
  it('rejects unsafe URLs, active SVGs, malformed and oversized transfers', async () => {
    await expect(
      prepareMailDrop(file('bad', 'text/html').replace('YWJj', '???'), vi.fn()),
    ).rejects.toThrow()
    await expect(
      prepareMailDrop('x'.repeat(24 * 1024 * 1024 + 1), vi.fn()),
    ).rejects.toThrow('large')
    const unsafe = btoa(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
    )
    await expect(
      prepareMailDrop(
        JSON.stringify({
          version: 1,
          name: 'bad.svg',
          alt: '',
          dataUrl: `data:image/svg+xml;base64,${unsafe}`,
        }),
        vi.fn(),
      ),
    ).rejects.toThrow('unsupported')
  })
  it('strips autoplay, script handlers and remote media URLs while retaining local controls', () => {
    const html = sanitizeMailHtml(
      '<video autoplay onplay="evil()" src="https://tracker.test/movie.mp4"></video><audio src="javascript:bad"></audio>',
    )
    expect(html).not.toMatch(/autoplay|onplay|https:|javascript:/)
    expect(html).toContain('controls')
    expect(html).toContain('preload="none"')
  })
})
