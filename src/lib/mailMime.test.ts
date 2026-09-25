import { describe, expect, it } from 'vitest'
import {
  buildMimeMessage,
  generateMimeBoundary,
  mimeFileName,
  wrapBase64Lines,
} from './mailMime'
import { base64ToBytes, bytesToBase64 } from './mailAttachments'

const HEADERS = [
  'To: Mira <mira@example.com>',
  'Subject: Launch copy',
]

describe('buildMimeMessage', () => {
  it('keeps the historical plain-text shape when there are no attachments', () => {
    const raw = buildMimeMessage({
      headerLines: HEADERS,
      body: 'Approved.',
      attachments: [],
    })
    expect(raw).toBe(
      [
        'To: Mira <mira@example.com>',
        'Subject: Launch copy',
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        'Approved.',
      ].join('\r\n'),
    )
  })

  it('builds multipart/mixed with a body part and base64 attachment parts', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, index) => index % 256)
    const raw = buildMimeMessage({
      headerLines: HEADERS,
      body: 'See attached.',
      attachments: [
        {
          name: 'data.bin',
          mimeType: 'application/octet-stream',
          base64: bytesToBase64(bytes),
        },
      ],
      boundary: 'test_boundary_123',
    })
    const lines = raw.split('\r\n')
    expect(lines).toContain('MIME-Version: 1.0')
    expect(lines).toContain(
      'Content-Type: multipart/mixed; boundary="test_boundary_123"',
    )
    expect(lines).toContain('Content-Type: text/plain; charset=utf-8')
    expect(lines).toContain('See attached.')
    expect(lines).toContain(
      'Content-Type: application/octet-stream; name="data.bin"',
    )
    expect(lines).toContain('Content-Transfer-Encoding: base64')
    expect(lines).toContain(
      'Content-Disposition: attachment; filename="data.bin"',
    )
    // Exactly two opening delimiters and one closing delimiter.
    expect(lines.filter(line => line === '--test_boundary_123')).toHaveLength(2)
    expect(
      lines.filter(line => line === '--test_boundary_123--'),
    ).toHaveLength(1)
    // Base64 payload lines respect the RFC 2045 76-character limit and
    // decode back to the original bytes.
    const encodingIndex = lines.indexOf('Content-Transfer-Encoding: base64')
    const payloadStart = lines.indexOf('', encodingIndex) + 1
    const payloadEnd = lines.indexOf('--test_boundary_123--', payloadStart)
    const payloadLines = lines.slice(payloadStart, payloadEnd)
    expect(payloadLines.length).toBeGreaterThan(1)
    for (const line of payloadLines) {
      expect(line.length).toBeLessThanOrEqual(76)
    }
    expect([...base64ToBytes(payloadLines.join(''))]).toEqual([...bytes])
  })

  it('includes one part per attachment', () => {
    const raw = buildMimeMessage({
      headerLines: HEADERS,
      body: 'Two files.',
      attachments: [
        { name: 'a.txt', mimeType: 'text/plain', base64: btoa('aaa') },
        { name: 'b.txt', mimeType: 'text/plain', base64: btoa('bbb') },
      ],
      boundary: 'b0undary',
    })
    const lines = raw.split('\r\n')
    expect(lines.filter(line => line === '--b0undary')).toHaveLength(3)
    expect(raw).toContain('filename="a.txt"')
    expect(raw).toContain('filename="b.txt"')
    expect(raw.trimEnd().endsWith('--b0undary--')).toBe(true)
  })


  it('builds multipart/alternative when a bodyHtml alternative is present', () => {
    const raw = buildMimeMessage({
      headerLines: HEADERS,
      body: 'Approved.',
      bodyHtml: '<p>Approved.</p>',
      attachments: [],
      boundary: 'outer_1',
    })
    const lines = raw.split('\r\n')
    expect(lines).toContain(
      'Content-Type: multipart/alternative; boundary="outer_1_alt"',
    )
    // Plain text first so text-only clients read it, then the HTML part.
    const textIndex = lines.indexOf('Content-Type: text/plain; charset=utf-8')
    const htmlIndex = lines.indexOf('Content-Type: text/html; charset=utf-8')
    expect(textIndex).toBeGreaterThan(-1)
    expect(htmlIndex).toBeGreaterThan(textIndex)
    expect(lines).toContain('<p>Approved.</p>')
    expect(lines).toContain('--outer_1_alt--')
  })

  it('nests the alternative inside multipart/mixed when attachments exist', () => {
    const raw = buildMimeMessage({
      headerLines: HEADERS,
      body: 'See attached.',
      bodyHtml: '<p>See <b>attached</b>.</p>',
      attachments: [
        { name: 'a.txt', mimeType: 'text/plain', base64: 'QUJD' },
      ],
      boundary: 'outer_2',
    })
    const lines = raw.split('\r\n')
    expect(lines).toContain(
      'Content-Type: multipart/mixed; boundary="outer_2"',
    )
    expect(lines).toContain(
      'Content-Type: multipart/alternative; boundary="outer_2_alt"',
    )
    const altClose = lines.indexOf('--outer_2_alt--')
    const attachmentPart = lines.indexOf(
      'Content-Disposition: attachment; filename="a.txt"',
    )
    expect(altClose).toBeGreaterThan(-1)
    expect(attachmentPart).toBeGreaterThan(altClose)
    expect(lines[lines.length - 2]).toBe('--outer_2--')
  })

  it('never picks a boundary that appears in a part', () => {
    let calls = 0
    const boundary = generateMimeBoundary(['body with collide_1 inside'], () => {
      calls += 1
      return calls === 1 ? 'collide_1' : 'fresh_2'
    })
    expect(boundary).toBe('fresh_2')
    expect(calls).toBe(2)
  })

  it('generates distinct random boundaries by default', () => {
    const first = generateMimeBoundary([])
    const second = generateMimeBoundary([])
    expect(first).toMatch(/^=_puremail_[0-9a-f]+$/)
    expect(first).not.toBe(second)
  })
})

describe('mimeFileName', () => {
  it('quotes plain ASCII names', () => {
    expect(mimeFileName('report.pdf')).toBe('"report.pdf"')
  })

  it('escapes quotes and backslashes', () => {
    expect(mimeFileName('we "said" back\\slash.txt')).toBe(
      '"we \\"said\\" back\\\\slash.txt"',
    )
  })

  it('flattens header-splitting newlines', () => {
    expect(mimeFileName('evil\r\nBcc: attacker@example.com.pdf')).toBe(
      '"evil Bcc: attacker@example.com.pdf"',
    )
  })

  it('encodes non-ASCII names as RFC 2047 words', () => {
    const encoded = mimeFileName('résumé.pdf')
    expect(encoded.startsWith('"=?UTF-8?B?')).toBe(true)
    expect(encoded.endsWith('?="')).toBe(true)
    const base64 = encoded.slice('"=?UTF-8?B?'.length, -'?="'.length)
    expect(new TextDecoder().decode(base64ToBytes(base64))).toBe('résumé.pdf')
  })

  it('falls back for empty names', () => {
    expect(mimeFileName('')).toBe('"attachment"')
  })
})

describe('wrapBase64Lines', () => {
  it('wraps long payloads at 76 characters without losing data', () => {
    const base64 = bytesToBase64(
      Uint8Array.from({ length: 200 }, (_, index) => index % 256),
    )
    const wrapped = wrapBase64Lines(base64)
    const lines = wrapped.split('\r\n')
    expect(lines.every(line => line.length <= 76)).toBe(true)
    expect(lines.join('')).toBe(base64)
  })

  it('leaves short payloads on one line', () => {
    expect(wrapBase64Lines('QUJD')).toBe('QUJD')
  })
})
