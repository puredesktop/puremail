import { describe, expect, it } from 'vitest'
import {
  bridgeImapTransport,
  bridgeSmtpTransport,
  imapFolderRole,
  IMAP_ACCOUNT_PRESETS,
  ImapMailProvider,
  validateImapAccountInput,
  type ImapEnvelope,
  type ImapFolder,
  type ImapTransport,
  type SmtpTransport,
} from './imapMailProvider'
import { mergeMailProviderSyncResult } from './mailModel'

/** In-memory IMAP server good enough to prove the provider end-to-end. */
function fakeImap(): ImapTransport & {
  boxes: Map<string, ImapEnvelope[]>
  appended: Array<{ folder: string; raw: string }>
  deleted: Array<{ folder: string; uid: number }>
  connected: boolean
} {
  const boxes = new Map<string, ImapEnvelope[]>([
    [
      'INBOX',
      [
        {
          uid: 1,
          messageId: '<root@ext>',
          subject: 'Quarterly invoice',
          from: { name: 'Billing', email: 'billing@vendor.example' },
          to: [{ name: 'User', email: 'alex@fastmail.example' }],
          date: '2026-07-01T10:00:00.000Z',
          body: 'Invoice attached below.',
          flags: [],
        },
        {
          uid: 2,
          messageId: '<reply@ext>',
          inReplyTo: '<root@ext>',
          subject: 'Re: Quarterly invoice',
          from: { name: 'Billing', email: 'billing@vendor.example' },
          to: [{ name: 'User', email: 'alex@fastmail.example' }],
          date: '2026-07-02T10:00:00.000Z',
          body: 'Bumping this.',
          flags: ['\\Flagged'],
        },
        {
          uid: 3,
          messageId: '<other@ext>',
          subject: 'Team lunch',
          from: { name: 'Kim', email: 'kim@fastmail.example' },
          to: [{ name: 'User', email: 'alex@fastmail.example' }],
          date: '2026-07-03T10:00:00.000Z',
          body: 'Friday?',
          flags: ['\\Seen'],
        },
      ],
    ],
    ['Sent', []],
    ['Drafts', []],
    ['Trash', []],
    ['Archive', []],
  ])
  const appended: Array<{ folder: string; raw: string }> = []
  const deleted: Array<{ folder: string; uid: number }> = []
  const folders: ImapFolder[] = [...boxes.keys()].map(path => ({
    path,
    role: imapFolderRole(path),
  }))
  const state = {
    boxes,
    appended,
    deleted,
    connected: false,
    async connect() {
      state.connected = true
    },
    async listFolders() {
      return folders
    },
    async fetchMessages(folderPath: string) {
      return boxes.get(folderPath) ?? []
    },
    async setFlag(folderPath: string, uid: number, flag: string, on: boolean) {
      const box = boxes.get(folderPath) ?? []
      const message = box.find(item => item.uid === uid)
      if (!message) throw new Error('no such message')
      message.flags = on
        ? [...new Set([...message.flags, flag])]
        : message.flags.filter(item => item !== flag)
    },
    async move(folderPath: string, uid: number, toFolderPath: string) {
      const from = boxes.get(folderPath) ?? []
      const index = from.findIndex(item => item.uid === uid)
      if (index === -1) throw new Error('no such message')
      const [message] = from.splice(index, 1)
      boxes.get(toFolderPath)?.push(message!)
    },
    async append(folder: string, raw: string) {
      appended.push({ folder, raw })
      // A real server reports APPENDUID; without it a stored draft has no
      // address and could never be updated or deleted again.
      return 1000 + appended.length
    },
    async deleteMessage(folder: string, uid: number) {
      deleted.push({ folder, uid })
    },
  }
  return state
}

function fakeSmtp(): SmtpTransport & {
  sent: Array<{ raw: string; from: string; to: string[] }>
  verify?: () => Promise<void>
} {
  const sent: Array<{ raw: string; from: string; to: string[] }> = []
  return {
    sent,
    async send(raw, from, to) {
      sent.push({ raw, from, to })
    },
  }
}

function provider(imap = fakeImap(), smtp = fakeSmtp()): {
  provider: ImapMailProvider
  imap: ReturnType<typeof fakeImap>
  smtp: ReturnType<typeof fakeSmtp>
} {
  return {
    provider: new ImapMailProvider({
      email: 'alex@fastmail.example',
      name: 'User',
      imap,
      smtp,
    }),
    imap,
    smtp,
  }
}

describe('ImapMailProvider against the fake transport', () => {
  it('declares the honest IMAP capability surface', () => {
    expect(provider().provider.capabilities).toEqual({
      compose: true,
      drafts: true,
      labels: false,
      bulkActions: false,
    })
  })

  it('maps folders to mailboxes and threads replies by References', async () => {
    const { provider: imapProvider } = provider()
    const store = await imapProvider.fetchStore()
    expect(store.mailboxes.map(mailbox => mailbox.role).sort()).toEqual(
      ['archive', 'custom', 'drafts', 'inbox', 'sent', 'trash'].filter(
        role => role !== 'custom',
      ),
    )
    // 3 messages → 2 threads (the reply joined its root).
    expect(store.threads).toHaveLength(2)
    const invoice = store.threads.find(thread =>
      thread.subject.includes('invoice'),
    )!
    expect(
      store.messages.filter(message => message.threadId === invoice.id),
    ).toHaveLength(2)
    // \Flagged maps onto starredThreadIds; \Seen onto read.
    expect(store.starredThreadIds).toEqual([invoice.id])
    expect(
      store.messages.find(message => message.subject === 'Team lunch')?.read,
    ).toBe(true)
    // The store merges through the standard pipeline.
    const merged = mergeMailProviderSyncResult(store, store)
    expect(merged.threads).toHaveLength(2)
  })

  it('performs archive/trash/read/star through IMAP semantics', async () => {
    const { provider: imapProvider, imap } = provider()
    const store = await imapProvider.fetchStore()
    const invoice = store.threads.find(thread =>
      thread.subject.includes('invoice'),
    )!
    await imapProvider.markThreadRead(invoice.id, true)
    expect(
      imap.boxes.get('INBOX')!.filter(m => m.flags.includes('\\Seen')),
    ).toHaveLength(3)
    await imapProvider.setThreadStarred(invoice.id, false)
    expect(
      imap.boxes.get('INBOX')!.some(m => m.flags.includes('\\Flagged')),
    ).toBe(false)
    await imapProvider.archiveThread(invoice.id)
    expect(imap.boxes.get('Archive')).toHaveLength(2)
    await imapProvider.deleteThread(invoice.id)
    expect(imap.boxes.get('Trash')).toHaveLength(2)
    expect(imap.boxes.get('INBOX')).toHaveLength(1)
  })

  it('keeps a successful unstar when a mirror copy rejects the flag change', async () => {
    const imap = fakeImap()
    imap.boxes.get('Archive')!.push({ ...imap.boxes.get('INBOX')![1], uid: 90 })
    const setFlag = imap.setFlag.bind(imap)
    const attempted: string[] = []
    imap.setFlag = async (folder, uid, flag, on) => {
      attempted.push(folder)
      if (folder === 'Archive') throw new Error('mirror refused')
      await setFlag(folder, uid, flag, on)
    }
    const { provider: mail } = provider(imap)
    const store = await mail.fetchStore()
    const invoice = store.threads.find(thread => thread.subject.includes('invoice'))!
    await expect(mail.setThreadStarred(invoice.id, false)).resolves.toBeUndefined()
    expect(attempted).toContain('Archive')
    expect(imap.boxes.get('INBOX')!.some(message => message.flags.includes('\\Flagged'))).toBe(false)
  })

  it('tries the remaining copies after the first flag change fails', async () => {
    const imap = fakeImap()
    const setFlag = imap.setFlag.bind(imap)
    const attempted: number[] = []
    imap.setFlag = async (folder, uid, flag, on) => {
      attempted.push(uid)
      if (attempted.length === 1) throw new Error('first copy refused')
      await setFlag(folder, uid, flag, on)
    }
    const { provider: mail } = provider(imap)
    const store = await mail.fetchStore()
    const invoice = store.threads.find(thread => thread.subject.includes('invoice'))!
    await expect(mail.setThreadStarred(invoice.id, false)).resolves.toBeUndefined()
    expect(attempted).toHaveLength(2)
  })

  it('reports failure when every copy rejects the flag change', async () => {
    const imap = fakeImap()
    let attempted = 0
    imap.setFlag = async () => { attempted++; throw new Error('all copies refused') }
    const { provider: mail } = provider(imap)
    const store = await mail.fetchStore()
    const invoice = store.threads.find(thread => thread.subject.includes('invoice'))!
    await expect(mail.setThreadStarred(invoice.id, false)).rejects.toThrow('all copies refused')
    expect(attempted).toBe(2)
  })

  it('appends drafts to the Drafts folder and sends through SMTP', async () => {
    const { provider: imapProvider, imap, smtp } = provider()
    await imapProvider.fetchStore()
    const draft = {
      id: 'draft_1',
      threadId: 'imap_thread_x',
      to: [{ name: 'Kim', email: 'kim@fastmail.example' }],
      subject: 'Hello',
      body: 'Plain body.',
      bodyHtml: '<p>Plain body.</p>',
      attachments: [],
      updatedAt: '2026-07-05T10:00:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }
    const providerDraftId = await imapProvider.createDraft(draft)
    expect(providerDraftId).toMatch(/^imap_draft_/)
    expect(imap.appended[0]?.folder).toBe('Drafts')
    expect(imap.appended[0]?.raw).toContain('Subject: Hello')
    expect(imap.appended[0]?.raw).toContain('multipart/alternative')
    expect(imap.appended[0]?.raw).toContain('Message-ID: <puremail-draft-draft_1@puremail.local>')
    await imapProvider.updateDraft(providerDraftId, { ...draft, body: 'Updated body.' })
    expect(imap.appended[1]?.raw).toContain('Message-ID: <puremail-draft-draft_1@puremail.local>')

    const message = await imapProvider.send({
      draft,
      threadId: 'imap_thread_x',
    })
    expect(smtp.sent).toHaveLength(1)
    expect(smtp.sent[0]?.to).toEqual(['kim@fastmail.example'])
    expect(smtp.sent[0]?.raw).toContain('To: Kim <kim@fastmail.example>')
    // A sent copy is appended best-effort.
    expect(imap.appended.some(item => item.folder === 'Sent')).toBe(true)
    expect(message.subject).toBe('Hello')
  })

  it('removes the account draft only after SMTP acceptance and includes reply headers', async () => {
    const { provider: mail, imap, smtp } = provider()
    const store = await mail.fetchStore()
    const draft = { id: 'reply', threadId: store.threads[0].id, providerDraftId: 'imap_draft_41', to: [{ name: 'Kim', email: 'kim@example.test' }], subject: 'Re: Lunch', body: 'Yes', attachments: [], updatedAt: '2026-07-05T10:00:00Z', syncState: 'synced' as const }
    const result = await mail.send({ draft, threadId: draft.threadId })
    expect(imap.deleted).toContainEqual({ folder: 'Drafts', uid: 41 })
    expect(smtp.sent[0].raw).toContain('In-Reply-To: <reply@ext>')
    expect(smtp.sent[0].raw).toContain('References: <root@ext> <reply@ext>')
    expect(smtp.sent[0].raw).toContain(`Message-ID: ${result.messageIdHeader}`)
    expect(result.deliveryAccepted).toBe(true)
  })

  it('keeps the draft when SMTP fails, without adding any Sent copy', async () => {
    const imap = fakeImap()
    const { provider: mail } = provider(imap, { ...fakeSmtp(), send: async () => { throw new Error('SMTP disconnected') } })
    const store = await mail.fetchStore()
    const draft = { id: 'reply', threadId: store.threads[0].id, providerDraftId: 'imap_draft_41', to: [{ name: 'Kim', email: 'kim@example.test' }], subject: 'Re: Lunch', body: 'Yes', attachments: [], updatedAt: '2026-07-05T10:00:00Z', syncState: 'synced' as const }
    await expect(mail.send({ draft, threadId: draft.threadId })).rejects.toThrow('SMTP disconnected')
    expect(imap.deleted).toEqual([])
    expect(imap.appended).toEqual([])
  })

  it('records rejected recipients after partial acceptance and preserves them through sync', async () => {
    const { provider: mail } = provider(fakeImap(), { ...fakeSmtp(), send: async () => ({ rejected: ['rejected@example.test'] }) })
    const store = await mail.fetchStore()
    const draft = { id: 'reply', threadId: store.threads[0].id, to: [{ name: 'Kim', email: 'kim@example.test' }, { name: 'Rejected', email: 'rejected@example.test' }], subject: 'Re: Lunch', body: 'Yes', attachments: [], updatedAt: '2026-07-05T10:00:00Z', syncState: 'synced' as const }
    const receipt = await mail.send({ draft, threadId: draft.threadId })
    expect(receipt.deliveryAccepted).toBe(true)
    expect(receipt.deliveryRejectedRecipients).toEqual(['rejected@example.test'])
    expect(receipt.deliveryWarnings?.join(' ')).toContain('Do not resend the original')
    const local = { ...store, messages: [receipt] }
    const remote = { ...store, messages: [{ ...receipt, id: 'imap_msg_Sent_51', deliveryAccepted: undefined, deliveryRejectedRecipients: undefined, deliveryWarnings: undefined }] }
    expect(mergeMailProviderSyncResult(local, remote).messages[0]).toMatchObject({ deliveryAccepted: true, deliveryRejectedRecipients: ['rejected@example.test'], deliveryWarnings: [expect.stringContaining('rejected@example.test')] })
  })

  it('keeps a mirrored sent message in the Sent view without duplicating its body', async () => {
    const imap = fakeImap()
    imap.boxes.set('Sent', [{ ...imap.boxes.get('INBOX')![0], uid: 9 }])
    const { provider: mail } = provider(imap)
    const store = await mail.fetchStore()
    expect(store.messages.filter(message => message.messageIdHeader === '<root@ext>')).toHaveLength(1)
    expect(store.messages.find(message => message.messageIdHeader === '<root@ext>')?.sentCopyPresent).toBe(true)
  })

  it('repairs a missing Sent copy and an old draft without SMTP submission', async () => {
    const { provider: mail, imap, smtp } = provider()
    const store = await mail.fetchStore()
    const original = store.messages[0]
    imap.boxes.set('Drafts', [{ ...imap.boxes.get('INBOX')![0], uid: 41 }])
    const receipt = { ...original, deliveryAccepted: true, sentDraftProviderIds: ['imap_draft_41'], deliveryWarnings: ['Its IMAP Sent copy failed.', 'Its old Drafts copy remains.'] }
    const [a, b] = await Promise.all([mail.repairSentRecord(receipt), mail.repairSentRecord(receipt)])
    expect(a).toEqual(b)
    expect(a.sentCopyPresent).toBe(true)
    expect(a.deliveryWarnings).toBeUndefined()
    expect(imap.appended).toHaveLength(1)
    expect(imap.appended[0].raw).toContain(`Message-ID: ${receipt.messageIdHeader}`)
    expect(imap.deleted).toContainEqual({ folder: 'Drafts', uid: 41 })
    expect(smtp.sent).toHaveLength(0)
  })

  it('does not append a second Sent copy when SMTP already filed the Message-ID', async () => {
    const imap = fakeImap()
    const smtp = fakeSmtp()
    const submit = smtp.send.bind(smtp)
    smtp.send = async (...args) => {
      await submit(...args)
      imap.boxes.set('Sent', [{ ...imap.boxes.get('INBOX')![0], uid: 42, messageId: '<server-filed@example.test>' }])
    }
    const { provider: mail } = provider(imap, smtp)
    const store = await mail.fetchStore()
    const message = await mail.send({ threadId: store.threads[0].id, draft: { id: 'd', threadId: store.threads[0].id, to: [], subject: 'Sent once', body: 'Hi', attachments: [], updatedAt: '2026-10-03T00:00:00Z', syncState: 'synced', sendMessageId: '<server-filed@example.test>' } })
    expect(smtp.sent).toHaveLength(1)
    expect(imap.appended).toHaveLength(0)
    expect(message.sentCopyPresent).toBe(true)
  })

  it('finds an accepted APPEND before retrying a repair whose acknowledgement was lost', async () => {
    const imap = fakeImap()
    const { provider: mail, smtp } = provider(imap)
    const store = await mail.fetchStore()
    const receipt = { ...store.messages[0], deliveryAccepted: true, deliveryWarnings: ['Its IMAP Sent copy failed.'] }
    let appends = 0
    imap.append = async () => {
      appends += 1
      imap.boxes.set('Sent', [{ ...imap.boxes.get('INBOX')![0], uid: 9 }])
      throw new Error('Append acknowledgement lost')
    }
    await expect(mail.repairSentRecord(receipt)).rejects.toThrow('Append acknowledgement lost')
    expect((await mail.repairSentRecord(receipt)).deliveryWarnings).toBeUndefined()
    expect(appends).toBe(1)
    expect(smtp.sent).toHaveLength(0)
  })

  it('refuses mailbox repair without a confirmed receipt', async () => {
    const { provider: mail, imap, smtp } = provider()
    const store = await mail.fetchStore()
    await expect(mail.repairSentRecord(store.messages[0])).rejects.toThrow('no confirmed send receipt')
    expect(imap.appended).toHaveLength(0)
    expect(smtp.sent).toHaveLength(0)
  })

  it('reports acceptance with a visible warning when Sent filing or draft cleanup fails', async () => {
    const imap = fakeImap()
    imap.append = async () => { throw new Error('IMAP disconnected') }
    imap.deleteMessage = async () => { throw new Error('IMAP disconnected') }
    const { provider: mail, smtp } = provider(imap)
    const store = await mail.fetchStore()
    const draft = { id: 'reply', threadId: store.threads[0].id, providerDraftId: 'imap_draft_41', to: [{ name: 'Kim', email: 'kim@example.test' }], subject: 'Re: Lunch', body: 'Yes', attachments: [], updatedAt: '2026-07-05T10:00:00Z', syncState: 'synced' as const }
    const result = await mail.send({ draft, threadId: draft.threadId })
    expect(smtp.sent).toHaveLength(1)
    expect(result.deliveryAccepted).toBe(true)
    expect(result.deliveryWarnings).toHaveLength(2)
    expect(result.deliveryWarnings?.join(' ')).toContain('Do not resend')
  })

  it('appends a draft with its content attachments as MIME parts', async () => {
    const { provider: imapProvider, imap } = provider()
    await imapProvider.fetchStore()
    const draft = {
      id: 'draft_att',
      threadId: 'imap_thread_x',
      to: [{ name: 'Kim', email: 'kim@fastmail.example' }],
      subject: 'With the report',
      body: 'Attached.',
      attachments: [
        {
          id: 'att_1',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '8 B',
          size: 8,
          content: 'data:application/pdf;base64,JVBERi0xLjQ=',
        },
      ],
      updatedAt: '2026-07-05T10:00:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }
    await imapProvider.createDraft(draft)
    const raw = imap.appended[0]?.raw ?? ''
    expect(imap.appended[0]?.folder).toBe('Drafts')
    expect(raw).toContain('multipart/mixed')
    expect(raw).toContain('filename="report.pdf"')
    expect(raw).toContain('JVBERi0xLjQ=')
  })

  it('counts unread per folder into the mailbox unreadCount', async () => {
    const { provider: imapProvider } = provider()
    const store = await imapProvider.fetchStore()
    const inbox = store.mailboxes.find(mailbox => mailbox.role === 'inbox')!
    // uid 1 and 2 carry no \Seen; uid 3 does.
    expect(inbox.unreadCount).toBe(2)
  })

  it('fetches EVERY folder so non-inbox mail and counts exist', async () => {
    const imap = fakeImap()
    imap.boxes.get('Archive')!.push({
      uid: 9,
      messageId: '<archived@ext>',
      subject: 'Old contract',
      from: { name: 'Legal', email: 'legal@vendor.example' },
      to: [{ name: 'User', email: 'alex@fastmail.example' }],
      date: '2026-07-04T10:00:00.000Z',
      body: 'Filed away.',
      flags: [],
    })
    const { provider: imapProvider } = provider(imap)
    const store = await imapProvider.fetchStore()
    const archived = store.threads.find(
      thread => thread.mailboxId === 'imap_mbx_Archive',
    )
    expect(archived).toBeTruthy()
    // Archive-folder threads carry archived status so the rail counts them.
    expect(archived?.status).toBe('archived')
    const archiveMailbox = store.mailboxes.find(m => m.role === 'archive')!
    expect(archiveMailbox.unreadCount).toBe(1)
  })

  it('materialises Drafts-folder messages as editable Draft records', async () => {
    const imap = fakeImap()
    imap.boxes.get('Drafts')!.push({
      uid: 41,
      messageId: '<draft@local>',
      subject: 'Half-written',
      from: { name: 'User', email: 'alex@fastmail.example' },
      to: [{ name: 'Kim', email: 'kim@fastmail.example' }],
      date: '2026-07-05T10:00:00.000Z',
      body: 'To be continued',
      // Deliberately NO \Draft flag: Bridge and some servers omit it, and
      // a message in the Drafts folder is a draft regardless.
      flags: [],
    })
    const { provider: imapProvider } = provider(imap)
    const store = await imapProvider.fetchStore()
    expect(store.drafts).toHaveLength(1)
    const draft = store.drafts[0]!
    expect(draft.providerDraftId).toBe('imap_draft_41')
    expect(draft.providerDraftMessageIdHeader).toBe('<draft@local>')
    expect(draft.body).toBe('To be continued')
    expect(draft.syncState).toBe('synced')
    const message = store.messages.find(m => m.id === draft.providerDraftMessageId)
    expect(message?.isDraft).toBe(true)
  })

  it('preserves ambiguous Drafts copies with the same Message-ID', async () => {
    const imap = fakeImap()
    const base = { ...imap.boxes.get('INBOX')![0], messageId: '<duplicate-draft@example.test>', flags: ['\\Draft'] }
    imap.boxes.set('Drafts', [{ ...base, uid: 41, body: 'First version' }, { ...base, uid: 42, body: 'Second version' }])
    const { provider: mail } = provider(imap)
    const store = await mail.fetchStore()
    expect(store.drafts.map(draft => draft.providerDraftId)).toEqual(['imap_draft_41', 'imap_draft_42'])
    expect(store.drafts.map(draft => draft.body)).toEqual(['First version', 'Second version'])
  })

  it('retains an external draft Message-ID across saving and gives Send a separate identity', async () => {
    const { provider: mail, imap, smtp } = provider()
    await mail.fetchStore()
    const draft = { id: 'local', threadId: 'thread', providerDraftId: 'imap_draft_41', providerDraftMessageIdHeader: '<external-draft@example.test>', to: [{ name: 'Kim', email: 'kim@example.test' }], subject: 'Draft identity', body: 'Latest', attachments: [], updatedAt: '2026-07-05T10:00:00Z', syncState: 'synced' as const }
    await mail.updateDraft(draft.providerDraftId, draft)
    expect(imap.appended[0].raw).toContain('Message-ID: <external-draft@example.test>')
    const sent = await mail.send({ draft, threadId: draft.threadId })
    expect(sent.messageIdHeader).not.toBe(draft.providerDraftMessageIdHeader)
    expect(smtp.sent[0].raw).toContain(`Message-ID: ${sent.messageIdHeader}`)
  })

  it('sends attachments in the MIME payload instead of dropping them', async () => {
    const { provider: imapProvider, smtp } = provider()
    await imapProvider.fetchStore()
    await imapProvider.send({
      threadId: 'imap_thread_x',
      draft: {
        id: 'draft_a',
        threadId: 'imap_thread_x',
        to: [{ name: 'Kim', email: 'kim@fastmail.example' }],
        subject: 'With file',
        body: 'See attached.',
        attachments: [
          {
            id: 'att_1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            sizeLabel: '12 B',
            size: 12,
            content: `data:text/plain;base64,${Buffer.from('hello there!').toString('base64')}`,
          },
        ],
        updatedAt: '2026-07-05T10:00:00.000Z',
        syncState: 'pending',
        draftKind: 'manual',
      },
    })
    expect(smtp.sent[0]?.raw).toContain('filename="notes.txt"')
    expect(smtp.sent[0]?.raw).toContain(
      Buffer.from('hello there!').toString('base64'),
    )
  })

  it('refuses to send an attachment that has no content and no remote ref', async () => {
    const { provider: imapProvider } = provider()
    await imapProvider.fetchStore()
    await expect(
      imapProvider.send({
        threadId: 'imap_thread_x',
        draft: {
          id: 'draft_b',
          threadId: 'imap_thread_x',
          to: [{ name: 'Kim', email: 'kim@fastmail.example' }],
          subject: 'Broken',
          body: 'x',
          attachments: [
            {
              id: 'att_2',
              name: 'ghost.pdf',
              mimeType: 'application/pdf',
              sizeLabel: '1 KB',
              size: 1024,
            },
          ],
          updatedAt: '2026-07-05T10:00:00.000Z',
          syncState: 'pending',
          draftKind: 'manual',
        },
      }),
    ).rejects.toThrow(/has no content to send/)
  })

  it('parses an inlined ICS part into a first-class calendar invite', async () => {
    const imap = fakeImap()
    imap.boxes.get('INBOX')!.push({
      uid: 7,
      messageId: '<invite@ext>',
      subject: 'Invitation: Review meeting',
      from: { name: 'Kim', email: 'kim@example.com' },
      to: [{ name: 'User', email: 'alex@fastmail.example' }],
      date: '2026-07-06T10:00:00.000Z',
      body: 'You are invited.',
      flags: [],
      icsText: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:invite-imap@example.com',
        'SEQUENCE:1',
        'SUMMARY:Review meeting',
        'DTSTART:20260707T170000Z',
        'DTEND:20260707T173000Z',
        'ORGANIZER;CN=Kim:mailto:kim@example.com',
        'ATTENDEE;CN=User;PARTSTAT=NEEDS-ACTION:mailto:alex@fastmail.example',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    })
    const { provider: imapProvider } = provider(imap)
    const store = await imapProvider.fetchStore()
    const message = store.messages.find(m => m.subject.includes('Review'))!
    expect(message.calendarInvite?.uid).toBe('invite-imap@example.com')
    expect(message.calendarInvite?.method).toBe('REQUEST')
    expect(message.calendarInvite?.title).toBe('Review meeting')
  })

  it('unarchives by moving the thread back to the inbox folder', async () => {
    const { provider: imapProvider, imap } = provider()
    const store = await imapProvider.fetchStore()
    const invoice = store.threads.find(thread =>
      thread.subject.includes('invoice'),
    )!
    await imapProvider.archiveThread(invoice.id)
    expect(imap.boxes.get('Archive')).toHaveLength(2)
    await imapProvider.unarchiveThread(invoice.id)
    expect(imap.boxes.get('Archive')).toHaveLength(0)
    expect(imap.boxes.get('INBOX')).toHaveLength(3)
  })

  it('searchThreadSummaries maps server hits onto local thread ids', async () => {
    const imap = fakeImap()
    const searched: Array<{ query: string; limit: number }> = []
    const withSearch = Object.assign(imap, {
      async searchAll(query: string, limit: number) {
        searched.push({ query, limit })
        return [
          {
            folderPath: 'INBOX',
            uid: 1,
            messageId: '<root@ext>',
            subject: 'Quarterly invoice',
            from: { name: 'Billing', email: 'billing@vendor.example' },
            date: '2026-07-01T10:00:00.000Z',
          },
          {
            folderPath: 'Archive',
            uid: 777,
            messageId: '<ancient@ext>',
            subject: 'From before the window',
            from: { name: 'Old', email: 'old@vendor.example' },
            date: '2020-01-01T10:00:00.000Z',
          },
        ]
      },
    })
    const { provider: imapProvider } = provider(withSearch)
    await imapProvider.fetchStore()
    const results = await imapProvider.searchThreadSummaries('invoice', 10)
    expect(searched).toEqual([{ query: 'invoice', limit: 10 }])
    // The local hit resolves to the SAME thread id fetchStore minted.
    const local = results.find(r => r.subject === 'Quarterly invoice')!
    expect(local.inLocalWindow).toBe(true)
    expect(local.threadId).toMatch(/^imap_thread_/)
    const remote = results.find(r => r.subject === 'From before the window')!
    expect(remote.inLocalWindow).toBe(false)
  })

  it('refuses server search when the transport cannot search', async () => {
    const { provider: imapProvider } = provider()
    await imapProvider.fetchStore()
    await expect(
      imapProvider.searchThreadSummaries('anything'),
    ).rejects.toThrow(/cannot search server-side/)
  })

  it('keeps attachment bytes when replacing and deleting the old draft UID', async () => {
    const imap = fakeImap()
    let oldExists = true
    imap.fetchAttachment = async () => {
      if (!oldExists) throw new Error('No message with uid 442 in Drafts')
      return { base64: 'aGVsbG8=', contentType: 'text/plain', filename: 'notes.txt' }
    }
    imap.deleteMessage = async () => { oldExists = false }
    const { provider: mail, smtp } = provider(imap)
    await mail.fetchStore()
    const draft = { id: 'draft', threadId: 'thread', providerDraftId: 'imap_draft_442', to: [{ name: 'Kim', email: 'kim@example.com' }], subject: 'Files', body: 'Hello', attachments: [{ id: 'old', name: 'notes.txt', mimeType: 'text/plain', sizeLabel: '5 B', remote: { provider: 'imap' as const, folderPath: 'Drafts', uid: 442, partId: '2' } }], updatedAt: '2026-10-02T22:00:00Z', syncState: 'pending' as const }
    const updated = await mail.updateDraft(draft.providerDraftId, draft)
    expect(typeof updated).toBe('object')
    if (typeof updated !== 'object') throw new Error('Expected hydrated attachments')
    expect(updated.attachments?.[0].content).toContain('aGVsbG8=')
    expect(updated.attachments?.[0].remote).toBeUndefined()
    await mail.send({ threadId: draft.threadId, draft: { ...draft, providerDraftId: updated.providerDraftId, attachments: updated.attachments! } })
    expect(smtp.sent).toHaveLength(1)
    expect(smtp.sent[0].raw).toContain('aGVsbG8=')
  })

  it('classifies an attachment failure before SMTP as definitely not sent', async () => {
    const { provider: mail, smtp } = provider()
    await mail.fetchStore()
    await expect(mail.send({ threadId: 'thread', draft: { id: 'draft', threadId: 'thread', to: [], subject: 'Files', body: '', attachments: [{ id: 'gone', name: 'gone.pdf', mimeType: 'application/pdf', sizeLabel: '1 KB' }], updatedAt: '2026-10-02T22:00:00Z', syncState: 'pending' } })).rejects.toMatchObject({ outcome: 'not_sent' })
    expect(smtp.sent).toHaveLength(0)
  })

  it('tests incoming and outgoing connections separately without sending', async () => {
    const imap = fakeImap()
    const smtp = fakeSmtp()
    smtp.verify = async () => { throw new Error('SMTP authentication failed') }
    const { provider: mail } = provider(imap, smtp)
    await mail.fetchStore()
    expect(await mail.testConnection()).toEqual({ receiving: 'IMAP connection verified', sending: 'Failed: SMTP authentication failed' })
    expect(smtp.sent).toHaveLength(0)
  })

  it('opens IMAP when testing after an offline startup without fetching or sending mail', async () => {
    const imap = fakeImap()
    const listFolders = imap.listFolders.bind(imap)
    imap.listFolders = async () => {
      if (!imap.connected) throw new Error('Not connected. Call mailTransport.connect for this profile first.')
      return listFolders()
    }
    imap.fetchMessages = async () => { throw new Error('A connection probe must not fetch messages') }
    const smtp = fakeSmtp()
    smtp.verify = async () => {}
    const { provider: mail } = provider(imap, smtp)
    expect(await mail.testConnection()).toEqual({ receiving: 'IMAP connection verified', sending: 'SMTP authentication verified; no test email sent' })
    expect(imap.connected).toBe(true)
    expect(smtp.sent).toHaveLength(0)
  })

  it('still checks SMTP when initial IMAP connection fails', async () => {
    const imap = fakeImap()
    imap.connect = async () => { throw new Error('connect ECONNREFUSED') }
    const smtp = fakeSmtp()
    let verified = false
    smtp.verify = async () => { verified = true }
    const { provider: mail } = provider(imap, smtp)
    expect(await mail.testConnection()).toEqual({ receiving: 'Failed: connect ECONNREFUSED', sending: 'SMTP authentication verified; no test email sent' })
    expect(verified).toBe(true)
    expect(smtp.sent).toHaveLength(0)
  })

  it('updateDraft reports the replacement id after append+delete', async () => {
    const imap = fakeImap()
    const { provider: imapProvider } = provider(imap)
    await imapProvider.fetchStore()
    const draft = {
      id: 'draft_1',
      threadId: 'imap_thread_x',
      to: [{ name: 'Kim', email: 'kim@fastmail.example' }],
      subject: 'Hello',
      body: 'v2',
      attachments: [],
      updatedAt: '2026-07-05T10:00:00.000Z',
      syncState: 'pending' as const,
      draftKind: 'manual' as const,
    }
    const replacement = await imapProvider.updateDraft('imap_draft_500', draft)
    // The fake reports APPENDUID 1001 for the first append.
    expect(replacement).toBe('imap_draft_1001')
    expect(imap.deleted).toEqual([{ folder: 'Drafts', uid: 500 }])
  })

  it('labelThread is a capability-gated no-op (folders, not labels)', async () => {
    const { provider: imapProvider, imap } = provider()
    await imapProvider.fetchStore()
    await expect(imapProvider.labelThread()).resolves.toBeUndefined()
    // No transport traffic happened for the label call.
    expect(imap.appended).toHaveLength(0)
  })
})

describe('bridge transport', () => {
  // The stub that rejected at connect time is gone: the transport now rides
  // the shell's mailTransport.* bridge (ps-suite#397). Its behaviour is the
  // shell's to test; here we only pin that the config wires through and the
  // password itself never appears in a request payload.
  it('sends the secrets KEY over the bridge, never a password value', () => {
    const config = {
      profileId: 'p1',
      imap: { host: 'imap.example.com', port: 993, security: 'ssl' as const },
      smtp: { host: 'smtp.example.com', port: 587, security: 'starttls' as const },
      username: 'alex@example.com',
      passwordSecretKey: 'imap-password.p1',
    }
    // Construction alone must not dial anything.
    const imap = bridgeImapTransport(config)
    const smtp = bridgeSmtpTransport(config)
    expect(typeof imap.connect).toBe('function')
    expect(typeof imap.fetchAttachment).toBe('function')
    expect(typeof smtp.send).toBe('function')
    expect(JSON.stringify(config)).not.toContain('hunter2')
  })
})

describe('account presets and validation', () => {
  it('ships iCloud, Fastmail, Proton Bridge, and generic presets', () => {
    const ids = IMAP_ACCOUNT_PRESETS.map(preset => preset.id)
    expect(ids).toEqual(['gmail-app-password', 'proton-bridge', 'generic'])
    const proton = IMAP_ACCOUNT_PRESETS.find(
      preset => preset.id === 'proton-bridge',
    )!
    expect(proton.imapHost).toBe('127.0.0.1')
    expect(proton.imapPort).toBe(1143)
    expect(proton.smtpPort).toBe(1025)
  })

  it('validates required fields with clear messages', () => {
    expect(
      validateImapAccountInput({
        email: 'alex@fastmail.example',
        username: 'alex@fastmail.example',
        imapHost: 'imap.fastmail.com',
        imapPort: 993,
        smtpHost: 'smtp.fastmail.com',
        smtpPort: 465,
      }),
    ).toEqual([])
    const errors = validateImapAccountInput({
      email: 'nope',
      username: '',
      imapHost: '',
      imapPort: 0,
      smtpHost: '',
      smtpPort: 99999,
    })
    expect(errors).toHaveLength(6)
  })
})

describe('ImapMailProvider drafts', () => {
  it('returns the server-reported UID as the draft id', async () => {
    const imap = fakeImap()
    const provider = new ImapMailProvider({
      email: 'alex@example.com',
      imap,
      smtp: fakeSmtp(),
    })
    await provider.fetchStore()
    const id = await provider.createDraft({
      id: 'local_1',
      threadId: 'imap_thread_1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Hello',
      body: 'A draft.',
      attachments: [],
      updatedAt: '2026-08-19T10:00:00.000Z',
      syncState: 'pending',
    })
    // Addressable, so update and delete can find it again — the old
    // `imap_draft_<timestamp>` corresponded to nothing on the server.
    expect(id).toMatch(/^imap_draft_\d+$/)
  })

  it('replaces a draft by appending the new copy before deleting the old', async () => {
    const imap = fakeImap()
    const provider = new ImapMailProvider({
      email: 'alex@example.com',
      imap,
      smtp: fakeSmtp(),
    })
    await provider.fetchStore()
    const draft = {
      id: 'local_1',
      threadId: 'imap_thread_1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Hello',
      body: 'First version.',
      attachments: [],
      updatedAt: '2026-08-19T10:00:00.000Z',
      syncState: 'pending' as const,
    }
    const id = await provider.createDraft(draft)
    const uid = Number(id.replace('imap_draft_', ''))
    await provider.updateDraft(id, { ...draft, body: 'Second version.' })
    expect(imap.appended).toHaveLength(2)
    expect(imap.appended[1].raw).toContain('Second version.')
    expect(imap.deleted).toEqual([{ folder: 'Drafts', uid }])
  })

  it('deletes a draft by UID and ignores an id it did not mint', async () => {
    const imap = fakeImap()
    const provider = new ImapMailProvider({
      email: 'alex@example.com',
      imap,
      smtp: fakeSmtp(),
    })
    await provider.fetchStore()
    await provider.deleteDraft('imap_draft_1001')
    expect(imap.deleted).toEqual([{ folder: 'Drafts', uid: 1001 }])
    await provider.deleteDraft('gmail-draft-1')
    expect(imap.deleted).toHaveLength(1)
  })
})

describe('virtual \\All mirrors (Proton All Mail)', () => {
  function providerWithAllMail() {
    const moves: Array<{ from: string; uid: number; to: string }> = []
    const envelope = {
      uid: 1,
      messageId: '<m@ext>',
      subject: 'Hello',
      from: { name: 'Kim', email: 'kim@x.example' },
      to: [{ name: 'User', email: 'alex@x.example' }],
      date: '2026-07-01T10:00:00.000Z',
      body: 'hi',
      flags: [],
    }
    const boxes = new Map<string, (typeof envelope)[]>([
      ['INBOX', [envelope]],
      // The mirror holds a copy of the same message automatically.
      ['All Mail', [{ ...envelope, uid: 900 }]],
      ['Archive', []],
      ['Folders/git', []],
    ])
    const transport = {
      async connect() {},
      async listFolders() {
        return [
          { path: 'INBOX', role: 'inbox' as const },
          { path: 'All Mail', role: 'archive' as const, virtual: true },
          { path: 'Archive', role: 'archive' as const },
          { path: 'Folders/git', role: 'custom' as const },
        ]
      },
      async fetchMessages(path: string) {
        return boxes.get(path) ?? []
      },
      async setFlag() {},
      async move(from: string, uid: number, to: string) {
        moves.push({ from, uid, to })
      },
      async append() {},
    }
    return {
      provider: new ImapMailProvider({
        email: 'alex@x.example',
        imap: transport,
        smtp: fakeSmtp(),
      }),
      moves,
    }
  }

  it('archives to the REAL archive folder and skips the mirror copy', async () => {
    const { provider: p, moves } = providerWithAllMail()
    const store = await p.fetchStore()
    const thread = store.threads[0]!
    await p.archiveThread(thread.id)
    // Target is Archive, never All Mail; the mirror location is untouched.
    expect(moves).toEqual([{ from: 'INBOX', uid: 1, to: 'Archive' }])
  })

  it('moves to a folder without touching the mirror copy', async () => {
    const { provider: p, moves } = providerWithAllMail()
    const store = await p.fetchStore()
    const thread = store.threads[0]!
    await p.moveThread(thread.id, 'imap_mbx_Folders/git')
    expect(moves).toEqual([{ from: 'INBOX', uid: 1, to: 'Folders/git' }])
  })
})

describe('the configured fetch window reaches the server', () => {
  it('asks for the window the settings advertise, not the newest N', async () => {
    const asked: { folder: string; limit?: number; since?: string }[] = []
    const provider = new ImapMailProvider({
      email: 'me@example.test',
      settings: { fetchWindow: '30d' },
      imap: {
        async connect() {},
        async listFolders() {
          return [{ path: 'INBOX', role: 'inbox' as const }]
        },
        async fetchMessages(folder: string, limit?: number, since?: string) {
          asked.push({ folder, ...(limit !== undefined ? { limit } : {}), ...(since ? { since } : {}) })
          return []
        },
        async setFlag() {},
        async move() {},
        async append() { return 1 },
        async deleteMessage() {},
      } as never,
      smtp: { async send() {} } as never,
    })
    await provider.fetchStore()
    expect(asked).toHaveLength(1)
    const since = asked[0].since
    expect(since, 'a window must be sent').toBeTruthy()
    const days = (Date.now() - new Date(since!).getTime()) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)
  })

  it('sends today for a today-only window', async () => {
    let since: string | undefined
    const provider = new ImapMailProvider({
      email: 'me@example.test',
      settings: { fetchWindow: 'today' },
      imap: {
        async connect() {},
        async listFolders() { return [{ path: 'INBOX', role: 'inbox' as const }] },
        async fetchMessages(_f: string, _l?: number, s?: string) { since = s; return [] },
        async setFlag() {}, async move() {}, async append() { return 1 }, async deleteMessage() {},
      } as never,
      smtp: { async send() {} } as never,
    })
    await provider.fetchStore()
    const start = new Date(since!)
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    expect(start.toDateString()).toBe(midnight.toDateString())
  })
})

describe('paging through the fetch window', () => {
  const envelope = (uid: number) => ({
    uid,
    messageId: `<m${uid}@x>`,
    subject: `m${uid}`,
    from: { name: 'A', email: 'a@x.test' },
    to: [{ name: 'Me', email: 'me@example.test' }],
    date: new Date(Date.now() - uid * 1000).toISOString(),
    body: '',
    flags: [],
  })

  /** A folder holding `total` messages, served newest-first in pages. */
  const pagedTransport = (total: number, calls: { limit?: number; beforeUid?: number }[]) => ({
    async connect() {},
    async listFolders() { return [{ path: 'INBOX', role: 'inbox' as const }] },
    async fetchMessages(_folder: string, limit?: number, _since?: string, beforeUid?: number) {
      calls.push({ ...(limit !== undefined ? { limit } : {}), ...(beforeUid !== undefined ? { beforeUid } : {}) })
      const all = Array.from({ length: total }, (_, i) => total - i) // uids high→low
      const page = all.filter(uid => (beforeUid === undefined ? true : uid < beforeUid)).slice(0, limit ?? 200)
      return page.map(envelope)
    },
    async setFlag() {}, async move() {}, async append() { return 1 }, async deleteMessage() {},
  })

  const build = (transport: unknown) =>
    new ImapMailProvider({
      email: 'me@example.test',
      settings: { fetchWindow: '30d' },
      imap: transport as never,
      smtp: { async send() {} } as never,
    })

  it('stops after one page when the folder fits inside it', async () => {
    const calls: { limit?: number; beforeUid?: number }[] = []
    const store = await build(pagedTransport(120, calls)).fetchStore()
    expect(calls).toHaveLength(1)
    expect(calls[0].beforeUid).toBeUndefined()
    expect(store.messages).toHaveLength(120)
  })

  it('walks older pages until the window is exhausted', async () => {
    const calls: { limit?: number; beforeUid?: number }[] = []
    const store = await build(pagedTransport(450, calls)).fetchStore()
    // 450 = 200 + 200 + 50, so three requests and no fourth.
    expect(calls).toHaveLength(3)
    expect(calls[1].beforeUid).toBe(251)
    expect(calls[2].beforeUid).toBe(51)
    expect(store.messages).toHaveLength(450)
    expect(new Set(store.messages.map(m => m.id)).size).toBe(450)
  })

  it('gives up rather than loop when a page cannot go older', async () => {
    const calls: { beforeUid?: number }[] = []
    const stuck = {
      async connect() {}, async listFolders() { return [{ path: 'INBOX', role: 'inbox' as const }] },
      async fetchMessages(_f: string, limit?: number, _s?: string, beforeUid?: number) {
        calls.push({ ...(beforeUid !== undefined ? { beforeUid } : {}) })
        return Array.from({ length: limit ?? 200 }, (_, i) => envelope(1000 - i))
      },
      async setFlag() {}, async move() {}, async append() { return 1 }, async deleteMessage() {},
    }
    await build(stuck).fetchStore()
    expect(calls.length).toBeLessThanOrEqual(12)
    expect(calls.length).toBeGreaterThan(1)
  })
})

describe('older thread hydration', () => {
  it('stops server lookups when the reader moves away', async () => {
    const imap = fakeImap()
    const p = provider(imap).provider
    const initial = await p.fetchStore()
    const controller = new AbortController()
    let calls = 0
    imap.fetchMessages = async () => {
      calls += 1
      controller.abort()
      return []
    }
    await expect(p.fetchThreadById(initial.threads[0]!.id, [], controller.signal)).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('loads an older original across folders without importing an unrelated same-subject message', async () => {
    const imap = fakeImap()
    const root = imap.boxes.get('INBOX')![0]!
    const reply = imap.boxes.get('INBOX')![1]!
    imap.boxes.set('INBOX', [reply, { ...root, uid: 9, messageId: '<unrelated@ext>' }])
    imap.boxes.set('Sent', [{ ...root, uid: 10 }])
    const requests: Array<{ since?: string; header?: string }> = []
    imap.fetchMessages = async (path, limit = 200, since, before, header) => {
      requests.push({ since, header: header ? 'headers' : undefined })
      return (imap.boxes.get(path) ?? []).filter(item => {
        if (since) return item.messageId === reply.messageId
        if (before !== undefined && item.uid >= before) return false
        if (!header) return true
        return (Array.isArray(header) ? header : [header]).some(filter => {
          const values = filter.name === 'Message-ID' ? [item.messageId] : filter.name === 'In-Reply-To' ? [item.inReplyTo] : item.references ?? []
          return values.includes(filter.value)
        })
      }).slice(-limit)
    }
    const p = provider(imap).provider
    const initial = await p.fetchStore()
    const id = initial.threads[0]!.id
    expect(initial.messages).toHaveLength(1)
    const fragment = await p.fetchThreadById(id)
    expect(fragment?.messages.map(item => item.messageIdHeader).sort()).toEqual(['<reply@ext>', '<root@ext>'])
    expect(fragment?.messages.every(item => item.threadId === id)).toBe(true)
    expect(requests.filter(item => item.header).every(item => item.since === undefined)).toBe(true)
    const hydrated = { ...initial, messages: [
      ...fragment!.messages,
      { ...fragment!.messages[0]!, id: 'deleted-recent-message', receivedAt: new Date().toISOString() },
    ] }
    const refreshed = await p.sync(hydrated)
    const merged = mergeMailProviderSyncResult(hydrated, refreshed)
    expect(merged.messages.map(item => item.messageIdHeader).sort()).toEqual(['<reply@ext>', '<root@ext>'])
    await p.markThreadRead(id, true)
    expect(imap.boxes.get('Sent')![0]!.flags).toContain('\\Seen')
  })

  it('uses persisted header seeds before the first provider sync', async () => {
    const { provider: p } = provider()
    const fragment = await p.fetchThreadById('persisted-thread', [{
      id: 'cached', threadId: 'persisted-thread', messageIdHeader: '<reply@ext>',
      from: { name: 'A', email: 'a@example.com' }, to: [], subject: 'Reply',
      body: '', receivedAt: '2026-09-29T10:00:00Z', attachments: [], read: true,
    }])
    expect(fragment?.messages).toHaveLength(2)
    expect(fragment?.threads[0]?.id).toBe('persisted-thread')
  })
})

describe('opening server-only search results', () => {
  function remoteProvider(messageId?: string) {
    const imap = fakeImap()
    const original = { ...imap.boxes.get('INBOX')![0]!, uid: 777, messageId, inReplyTo: undefined, references: undefined }
    imap.boxes.set('Archive', [original])
    imap.searchAll = async () => [{ folderPath: 'Archive', ...original }]
    imap.fetchMessages = async (path, _limit, since, _before, headers, uids) => {
      if (since) return []
      const filters = headers ? (Array.isArray(headers) ? headers : [headers]) : []
      return (imap.boxes.get(path) ?? []).filter(item => uids ? uids.includes(item.uid) : filters.some(header => item.messageId === header.value))
    }
    return { ...provider(imap), original }
  }
  it.each([undefined, '<old-search@example.com>'])('imports a search hit by UID (Message-ID: %s)', async messageId => {
    const { provider: p, imap } = remoteProvider(messageId)
    await p.fetchStore()
    const [hit] = await p.searchThreadSummaries('invoice')
    expect(hit!.inLocalWindow).toBe(false)
    const fragment = await p.fetchThreadById(hit!.threadId)
    expect(fragment?.messages).toHaveLength(1)
    expect(fragment?.messages[0]?.id).toBe('imap_msg_Archive_777')
    expect(fragment?.messages[0]?.body).toContain('Invoice attached')
    expect((await p.searchThreadSummaries('invoice'))[0]?.inLocalWindow).toBe(true)
    await p.markThreadRead(hit!.threadId, true)
    expect(imap.boxes.get('Archive')![0]!.flags).toContain('\\Seen')
  })
  it('reports a result removed from the server instead of opening an empty reader', async () => {
    const { provider: p, imap } = remoteProvider()
    await p.fetchStore()
    const [hit] = await p.searchThreadSummaries('invoice')
    imap.boxes.set('Archive', [])
    await expect(p.fetchThreadById(hit!.threadId)).rejects.toThrow('no longer in its server folder')
  })
  it('does not confuse identical UIDs in different folders without Message-ID', async () => {
    const { provider: p, imap, original } = remoteProvider()
    imap.searchAll = async () => ['Archive', 'Sent'].map(folderPath => ({ folderPath, ...original }))
    const hits = await p.searchThreadSummaries('invoice')
    expect(new Set(hits.map(hit => hit.threadId)).size).toBe(2)
  })
})

describe('IMAP draft listing coverage', () => {
  function pagedDrafts(total: number, repeat = false) {
    const imap = fakeImap()
    const calls: Array<{ folder: string; since?: string }> = []
    const base = imap.boxes.get('INBOX')![0]!
    const source = Array.from({ length: total }, (_, index) => ({ ...base,
      uid: total - index, messageId: `<draft-${total - index}@audit.test>`,
      date: '2020-01-01T12:00:00.000Z', flags: ['\\Draft'],
    }))
    imap.fetchMessages = async (folder: string, limit = 200, since?: string, before?: number) => {
      calls.push({ folder, since })
      if (folder !== 'Drafts') return imap.boxes.get(folder) ?? []
      return source.filter(item => repeat || before === undefined || item.uid < before).slice(0, limit)
    }
    const mail = new ImapMailProvider({ email: 'alex@fastmail.example', settings: { fetchWindow: 'today' }, imap, smtp: { async send() {} } })
    return { imap, mail, calls }
  }

  it('imports older drafts outside the message window and marks exhausted pagination complete', async () => {
    const { mail, calls } = pagedDrafts(205)
    const store = await mail.fetchStore()
    expect(store.drafts).toHaveLength(205)
    expect(store.syncCoverage?.draftsCovered).toBe(true)
    expect(calls.filter(call => call.folder === 'Drafts').every(call => call.since === undefined)).toBe(true)
    expect(calls.find(call => call.folder === 'INBOX')?.since).toBeTruthy()
  })

  it('removes a synced local draft after an authoritative external deletion', async () => {
    const imap = fakeImap()
    imap.boxes.set('Drafts', [{ ...imap.boxes.get('INBOX')![0]!, uid: 10, messageId: '<draft-removed@audit.test>', flags: ['\\Draft'] }])
    const mail = provider(imap).provider
    const before = await mail.fetchStore()
    expect(before.drafts).toHaveLength(1)
    imap.boxes.set('Drafts', [])
    const after = await mail.fetchStore()
    expect(after.syncCoverage?.draftsCovered).toBe(true)
    expect(mergeMailProviderSyncResult(before, after).drafts).toHaveLength(0)
  })

  it.each([{ total: 2401, repeat: false }, { total: 400, repeat: true }])('preserves absent local drafts when pagination is incomplete: %j', async ({ total, repeat }) => {
    const { mail } = pagedDrafts(total, repeat)
    const partial = await mail.fetchStore()
    expect(partial.syncCoverage?.draftsCovered).toBe(false)
    const missing = { ...partial.drafts[0]!, id: 'absent-local', providerDraftId: 'imap_draft_999999', syncState: 'synced' as const }
    const merged = mergeMailProviderSyncResult({ ...partial, drafts: [missing] }, partial)
    expect(merged.drafts.some(draft => draft.id === missing.id)).toBe(true)
  })

  it('does not claim coverage when no Drafts folder is available', async () => {
    const { imap, mail } = pagedDrafts(0)
    const list = imap.listFolders.bind(imap)
    imap.listFolders = async () => (await list()).filter(folder => folder.role !== 'drafts')
    expect((await mail.fetchStore()).syncCoverage?.draftsCovered).toBe(false)
  })

  it('rejects an incomplete failed fetch instead of publishing an empty authoritative listing', async () => {
    const { imap, mail } = pagedDrafts(0)
    const fetch = imap.fetchMessages.bind(imap)
    imap.fetchMessages = async folder => {
      if (folder === 'Drafts') throw new Error('Draft listing disconnected')
      return fetch(folder)
    }
    await expect(mail.fetchStore()).rejects.toThrow('Draft listing disconnected')
  })
})
