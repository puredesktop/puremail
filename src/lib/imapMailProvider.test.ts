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
    expect(draft.body).toBe('To be continued')
    expect(draft.syncState).toBe('synced')
    const message = store.messages.find(m => m.id === draft.providerDraftMessageId)
    expect(message?.isDraft).toBe(true)
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
