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

describe('character references in mail text', () => {
  it('reads numeric and named references as the characters they stand for', async () => {
    const { stripHtmlToText } = await import('./mailTextUtils')
    expect(stripHtmlToText('OK &#8211; well &#8211; a week or so&#8217;s time &amp; more &ndash; caf&eacute; &#x2014; &quot;q&quot; &lt;b&gt;'))
      .toBe('OK – well – a week or so’s time & more – café — "q" <b>')
    // An unknown name and a code outside Unicode stay as written; the invisible ones go.
    expect(stripHtmlToText('a&bogus;b &#1114112; c&#8203;d')).toBe('a&bogus;b &#1114112; cd')
  })
  it('reads them in a plain-text body too, which the reader shows as it came', async () => {
    const { readerMailBody } = await import('./mailTextUtils')
    const body = readerMailBody({ id: 'm', body: 'OK &#8211; well &#8211; so&#8217;s time', bodyHtml: '', from: { name: 'S', email: 's@example.test' }, to: [], receivedAt: '2026-10-07T00:00:00Z' } as never)
    expect(body.visibleText).toBe('OK – well – so’s time')
  })
})
