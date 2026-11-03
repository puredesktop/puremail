import { describe, expect, it } from 'vitest'
import type { ImapEnvelope, ImapFolder, ImapTransport, SmtpTransport } from './imapMailProvider'
import { ImapMailProvider } from './imapMailProvider'

const envelope = (uid: number, over: Partial<ImapEnvelope> = {}): ImapEnvelope => ({
  uid,
  messageId: `<${uid}@x>`,
  subject: `Message ${uid}`,
  from: { name: '', email: 'a@x.example' },
  to: [],
  date: new Date(Date.UTC(2024, 0, uid)).toISOString(),
  body: 'Words',
  flags: ['\\Seen'],
  ...over,
})

function provider(folders: ImapFolder[], boxes: Record<string, ImapEnvelope[]>) {
  const calls: Array<{ folder: string; since?: string; beforeUid?: number; uids?: number[] }> = []
  const imap = {
    connect: async () => undefined,
    listFolders: async () => folders,
    fetchMessages: async (folder: string, limit = 50, since?: string, beforeUid?: number, _headers?: unknown, uids?: number[]) => {
      calls.push({ folder, since, beforeUid, uids })
      const all = boxes[folder] ?? []
      if (uids) return all.filter(item => uids.includes(item.uid))
      return all.filter(item => beforeUid === undefined || item.uid < beforeUid).sort((a, b) => b.uid - a.uid).slice(0, limit)
    },
  } as unknown as ImapTransport
  return { calls, mail: new ImapMailProvider({ email: 'me@x.example', imap, smtp: {} as SmtpTransport }) }
}

const INBOX: ImapFolder = { path: 'INBOX', role: 'inbox' }

describe('walking an IMAP mailbox', () => {
  it('reads an all-mail folder alone, flagged or only named so, to the end', async () => {
    for (const mirror of [{ path: 'Everything', role: 'custom', virtual: true }, { path: 'All Mail', role: 'custom' }] as ImapFolder[]) {
      const { mail, calls } = provider([INBOX, mirror], { [mirror.path]: [1, 2, 3, 4, 5].map(uid => envelope(uid)) })
      const seen: number[] = []
      let cursor = null as Awaited<ReturnType<typeof mail.walkMailbox>>['cursor']
      let total: number | undefined
      for (let page = 0; page < 10; page += 1) {
        const result = await mail.walkMailbox(cursor, { pageSize: 2 })
        total ??= result.approxTotal
        seen.push(...result.items.map(item => Number(item.id.split('_').pop())))
        cursor = result.cursor
        if (!cursor) break
      }
      expect(seen).toEqual([5, 4, 3, 2, 1])
      expect(cursor).toBeNull()
      expect(total).toBe(5)
      expect(calls.every(call => call.folder === mirror.path)).toBe(true)
      // The transport honours a paging cursor only with a date window.
      expect(calls.every(call => call.since)).toBe(true)
    }
  })

  it('reads every real folder when there is no all-mail folder, leaving out drafts, trash and spam', async () => {
    const folders: ImapFolder[] = [INBOX, { path: 'Sent', role: 'sent' }, { path: 'Drafts', role: 'drafts' }, { path: 'Trash', role: 'trash' }, { path: 'Spam', role: 'custom' }]
    const { mail } = provider(folders, { INBOX: [envelope(1)], Sent: [envelope(2)], Drafts: [envelope(3)], Trash: [envelope(4)], Spam: [envelope(5)] })
    const ids: string[] = []
    let cursor = null as Awaited<ReturnType<typeof mail.walkMailbox>>['cursor']
    for (let page = 0; page < 10; page += 1) {
      const result = await mail.walkMailbox(cursor, { pageSize: 5 })
      ids.push(...result.items.map(item => item.id))
      cursor = result.cursor
      if (!cursor) break
    }
    expect(ids).toEqual(['imap_msg_INBOX_1', 'imap_msg_Sent_2'])
  })

  it('reads one walked message back with its attachments, and says when it has gone', async () => {
    const { mail } = provider([INBOX], {
      INBOX: [envelope(7, { attachments: [{ partId: '2', filename: 'a.pdf', contentType: 'application/pdf', size: 10 }] })],
    })
    const found = await mail.readWalkedMessage('imap_msg_INBOX_7')
    expect(found?.message.attachments?.[0]).toMatchObject({ name: 'a.pdf', remote: { folderPath: 'INBOX', uid: 7, partId: '2' } })
    expect(await mail.readWalkedMessage('imap_msg_INBOX_8')).toBeNull()
  })
})
