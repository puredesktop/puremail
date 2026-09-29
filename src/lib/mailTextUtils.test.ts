import { describe, expect, it } from 'vitest'
import { readerMailBody } from './mailTextUtils'
import type { MailMessage } from '../types'

const message = (bodyHtml: string): MailMessage => ({
  id: 'm', threadId: 't', from: { name: 'A', email: 'a@example.com' },
  to: [], subject: 'Reply', body: '', bodyHtml, receivedAt: '2026-09-29T10:00:00Z', attachments: [], read: true,
})

describe('HTML history boundaries', () => {
  it('does not repeat the reply when HTML indentation changes the cleaned prefix', () => {
    const result = readerMailBody(message('<div>Hello Adam<br>  Thanks for this.</div><div class="gmail_quote">An earlier message.</div>'))
    expect(result.segments).toEqual([
      { type: 'text', text: 'Hello Adam\nThanks for this.' },
      { type: 'quote', text: 'An earlier message.', label: 'Quoted history' },
    ])
  })
  it('keeps signature text out of history and preserves it in the reply', () => {
    const result = readerMailBody(message('<p>Thank you!</p><p>Sender</p><p>https://example.com</p><blockquote type="cite">Original message.</blockquote>'))
    expect(result.visibleText).toContain('https://example.com')
    expect(result.segments.filter(part => part.type === 'quote').map(part => part.text)).toEqual(['Original message.'])
  })
})
