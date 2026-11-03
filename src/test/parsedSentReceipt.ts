import { GmailMailProvider } from '../lib/gmailMailProvider'
import { ImapMailProvider, type ImapTransport } from '../lib/imapMailProvider'
import type { MailMessage } from '../types'

/** Real app parsers, with synthetic HTTP responses and IMAP envelopes only. */
export async function parsedSentReceipt(provider: 'gmail' | 'imap', html: boolean): Promise<MailMessage> {
  const body = 'Hello\nNext'
  const bodyHtml = html ? '<p>Hello</p>\n<p>Next</p>' : undefined
  switch (provider) {
    case 'gmail': {
      const encode = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const mail = new GmailMailProvider({
        email: 'me@example.test',
        accessToken: async () => 'synthetic-token',
        fetch: async ({ url }) => {
          if (url.endsWith('/profile')) {
            return { ok: true, status: 200, body: JSON.stringify({ emailAddress: 'me@example.test' }) }
          }
          if (!url.includes('/threads/receipt?format=full')) {
            throw new Error(`Unexpected synthetic request ${url}`)
          }
          const parts = [
            { mimeType: 'text/plain', body: { data: encode(` \n${body}\n `) } },
            ...(bodyHtml ? [{ mimeType: 'text/html', body: { data: encode(` \n${bodyHtml}\n `) } }] : []),
          ]
          const message = {
            id: 'received',
            threadId: 'receipt',
            labelIds: ['SENT'],
            internalDate: String(Date.now()),
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'From', value: 'me@example.test' },
                { name: 'To', value: 'ana@example.test' },
                { name: 'Subject', value: 'Letter' },
                { name: 'Message-ID', value: '<submitted-A>' },
              ],
              parts,
            },
          }
          return { ok: true, status: 200, body: JSON.stringify({ id: 'receipt', messages: [message] }) }
        },
      })
      return (await mail.fetchThreadById('gmail_thread_receipt'))!.messages[0]
    }
    case 'imap': {
      const imap: ImapTransport = {
        connect: async () => {},
        listFolders: async () => [{ path: 'Sent', role: 'sent' }],
        fetchMessages: async () => [{
          uid: 1,
          messageId: '<submitted-A>',
          subject: 'Letter',
          from: { name: 'Me', email: 'me@example.test' },
          to: [{ name: 'ana@example.test', email: 'ana@example.test' }],
          date: new Date().toISOString(),
          body,
          bodyHtml,
          flags: ['\\Seen'],
        }],
        setFlag: async () => {},
        move: async () => {},
        append: async () => { throw new Error('Unexpected synthetic append') },
      }
      const mail = new ImapMailProvider({
        email: 'me@example.test',
        imap,
        smtp: { send: async () => { throw new Error('Unexpected synthetic send') } },
      })
      return (await mail.fetchStore()).messages[0]
    }
  }
}
