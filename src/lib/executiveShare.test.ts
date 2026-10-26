import { describe, expect, it } from 'vitest'
import { emptyMailStore } from './mailStoreData'
import {
  DIGEST_CURSOR_LIMIT,
  DIGEST_TEXT_LIMIT,
  DRAFT_CLAIM_STALE_MS,
  addExecutiveDraft,
  appendDigestLines,
  buildExecutiveDraft,
  checkDraftRequest,
  digestLinesFor,
  digestText,
  existingExecutiveDraft,
  isNeverReadAddress,
  isNeverReadPlace,
  localDay,
  parseDigestCursor,
  parseMailShare,
  serializeDigestCursor,
  sharedAccount,
  takeExecutiveDrafts,
  writeMailDigest,
  type ExecutiveShareFiles,
} from './executiveShare'
import type { MailAccount, MailMessage, MailStore, MailThread } from '../types'

const ROOT = '/org'
const MAIL = `${ROOT}/.appdata/executive/mail`
const ACCOUNT: MailAccount = { id: 'acct', provider: 'imap', name: 'Adam', email: 'adam@pure.science', syncState: 'online' }
const SHARE_JSON = JSON.stringify({
  v: 1,
  account: 'Adam@Pure.Science',
  since: '2026-10-26T00:00:00Z',
  neverRead: { senders: ['Private@Example.com'], domains: ['bank.example'], folders: ['Personal'] },
})
const share = parseMailShare(SHARE_JSON)!

function thread(id: string, mailboxId: string, labels: string[] = []): MailThread {
  return {
    id, accountId: 'acct', mailboxId, subject: `Subject ${id}`, participants: [], labels,
    status: 'inbox', priority: 'none', summary: '', lastMessageAt: '2026-10-26T12:00:00Z', syncState: 'synced',
  }
}

function message(id: string, threadId: string, patch: Partial<MailMessage> = {}): MailMessage {
  return {
    id, threadId, messageIdHeader: `<${id}@mail.example>`,
    from: { name: 'Ana Ruiz', email: 'ana@example.com' },
    to: [{ name: '', email: 'adam@pure.science' }],
    subject: 'Re: pilot terms', body: 'Hello Adam,\n\nThe terms are attached.',
    receivedAt: '2026-10-26T12:00:00Z', attachments: [], read: false, ...patch,
  }
}

function store(): MailStore {
  const base = emptyMailStore()
  return {
    ...base,
    accounts: [ACCOUNT],
    mailboxes: [
      { id: 'imap_mbx_INBOX', accountId: 'acct', name: 'INBOX', role: 'inbox', unreadCount: 0 },
      { id: 'imap_mbx_Sent', accountId: 'acct', name: 'Sent', role: 'sent', unreadCount: 0 },
      { id: 'imap_mbx_Drafts', accountId: 'acct', name: 'Drafts', role: 'drafts', unreadCount: 0 },
      { id: 'imap_mbx_Trash', accountId: 'acct', name: 'Trash', role: 'trash', unreadCount: 0 },
      { id: 'imap_mbx_Junk', accountId: 'acct', name: 'Junk', role: 'custom', unreadCount: 0 },
      { id: 'imap_mbx_INBOX/Personal', accountId: 'acct', name: 'Personal', role: 'custom', unreadCount: 0 },
    ],
    threads: [thread('t1', 'imap_mbx_INBOX', ['Needs reply'])],
    messages: [message('imap_msg_INBOX_1', 't1', {
      attachments: [{ id: 'a', name: 'terms.pdf', mimeType: 'application/pdf', sizeLabel: '178 KB', size: 182000 }],
    })],
  }
}

/** An in-memory shell: atomic writes, same-folder renames that refuse a taken name. */
function memoryFiles(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial))
  const files: ExecutiveShareFiles = {
    read: async path => disk.get(path) ?? null,
    write: async (path, content) => { disk.set(path, content) },
    list: async folder => [...disk.keys()]
      .filter(path => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/'))
      .map(path => path.slice(folder.length + 1))
      .filter(name => !name.startsWith('.')),
    rename: async (path, name) => {
      const content = disk.get(path)
      if (content === undefined) throw new Error('ENOENT')
      const target = `${path.slice(0, path.lastIndexOf('/'))}/${name}`
      if (disk.has(target)) throw new Error('A file with that name already exists')
      disk.delete(path)
      disk.set(target, content)
    },
    remove: async path => { disk.delete(path) },
  }
  return { disk, files }
}

describe('share file', () => {
  it('reads a version-1 share and normalises the never-read list', () => {
    expect(share).toEqual({
      account: 'Adam@Pure.Science',
      since: '2026-10-26T00:00:00Z',
      neverRead: { senders: ['private@example.com'], domains: ['bank.example'], folders: ['personal'] },
    })
    expect(parseMailShare(JSON.stringify({ v: 1, account: 'a@b.c', since: '2026-10-26T00:00:00Z' }))?.neverRead)
      .toEqual({ senders: [], domains: [], folders: [] })
  })

  it('is no share when missing, broken, another version, or without account or since', () => {
    expect(parseMailShare(null)).toBeNull()
    expect(parseMailShare('{')).toBeNull()
    expect(parseMailShare(JSON.stringify({ v: 2, account: 'a@b.c', since: '2026-10-26' }))).toBeNull()
    expect(parseMailShare(JSON.stringify({ v: 1, since: '2026-10-26' }))).toBeNull()
    expect(parseMailShare(JSON.stringify({ v: 1, account: 'a@b.c', since: 'soon' }))).toBeNull()
  })

  it('names a connected account only (case-insensitive, never the demo)', () => {
    expect(sharedAccount(store(), share)?.id).toBe('acct')
    expect(sharedAccount({ accounts: [{ ...ACCOUNT, provider: 'demo' }] }, share)).toBeNull()
    expect(sharedAccount({ accounts: [{ ...ACCOUNT, email: 'other@pure.science' }] }, share)).toBeNull()
    expect(sharedAccount(store(), null)).toBeNull()
  })
})

describe('never read', () => {
  it('matches exact senders, domains and their subdomains', () => {
    expect(isNeverReadAddress(share, 'PRIVATE@example.com')).toBe(true)
    expect(isNeverReadAddress(share, 'other@example.com')).toBe(false)
    expect(isNeverReadAddress(share, 'alerts@bank.example')).toBe(true)
    expect(isNeverReadAddress(share, 'alerts@mail.bank.example')).toBe(true)
    expect(isNeverReadAddress(share, 'alerts@notbank.example')).toBe(false)
  })

  it('matches a folder by path or last segment, and labels', () => {
    expect(isNeverReadPlace(share, 'INBOX/Personal', [])).toBe(true)
    expect(isNeverReadPlace(share, 'Personal', [])).toBe(true)
    expect(isNeverReadPlace(share, 'INBOX', ['personal'])).toBe(true)
    expect(isNeverReadPlace(share, 'INBOX', ['Work'])).toBe(false)
  })
})

describe('digest lines', () => {
  it('writes the contract line for a received message', () => {
    const [entry] = digestLinesFor(store(), share, ACCOUNT, new Set())
    expect(entry!.day).toBe(localDay('2026-10-26T12:00:00Z'))
    expect(entry!.line).toEqual({
      v: 1,
      id: '<imap_msg_INBOX_1@mail.example>',
      threadId: 't1',
      at: '2026-10-26T12:00:00Z',
      from: { name: 'Ana Ruiz', address: 'ana@example.com' },
      to: [{ name: '', address: 'adam@pure.science' }],
      cc: [],
      subject: 'Re: pilot terms',
      folder: 'INBOX',
      labels: ['Needs reply'],
      fromMe: false,
      text: 'Hello Adam,\n\nThe terms are attached.',
      attachments: [{ name: 'terms.pdf', kind: 'pdf', size: 182000 }],
    })
    expect(Object.keys(entry!.line)).toEqual(['v', 'id', 'threadId', 'at', 'from', 'to', 'cc', 'subject', 'folder', 'labels', 'fromMe', 'text', 'attachments'])
  })

  it('marks the account’s own sent mail fromMe, filed by its own folder', () => {
    const s = store()
    s.messages.push(message('imap_msg_Sent_9', 't1', {
      from: { name: 'Adam', email: 'adam@pure.science' }, to: [{ name: 'Ana', email: 'ana@example.com' }],
      receivedAt: '2026-10-26T13:00:00Z', body: 'I will send the deck by Friday.',
    }))
    const lines = digestLinesFor(s, share, ACCOUNT, new Set()).map(item => item.line)
    expect(lines.map(line => [line.folder, line.fromMe])).toEqual([['INBOX', false], ['Sent', true]])
  })

  it('uses the provider id when there is no Message-ID, and skips written ids', () => {
    const s = store()
    s.messages = [message('gmail_msg_1', 't1', { messageIdHeader: undefined })]
    expect(digestLinesFor(s, share, ACCOUNT, new Set())[0]!.line.id).toBe('gmail_msg_1')
    expect(digestLinesFor(s, share, ACCOUNT, new Set(['gmail_msg_1']))).toEqual([])
  })

  it('leaves out mail before since, drafts, trash, spam and other accounts', () => {
    const s = store()
    s.threads.push(thread('t2', 'imap_mbx_INBOX'), { ...thread('t3', 'imap_mbx_INBOX'), accountId: 'other' })
    s.messages = [
      message('imap_msg_INBOX_2', 't2', { receivedAt: '2026-10-25T23:59:59Z' }),
      message('imap_msg_Drafts_3', 't2', { isDraft: true }),
      message('imap_msg_INBOX_4', 't2', { isDraft: true }),
      message('imap_msg_Trash_5', 't2'),
      message('imap_msg_Junk_6', 't2'),
      message('imap_msg_INBOX_7', 't3'),
      message('local_8', 't2', { optimistic: true }),
    ]
    expect(digestLinesFor(s, share, ACCOUNT, new Set())).toEqual([])
  })

  it('never writes never-read mail, nor the account’s replies to it', () => {
    const s = store()
    s.threads.push(thread('t2', 'imap_mbx_INBOX', ['Personal']))
    s.messages = [
      message('imap_msg_INBOX_1', 't1', { from: { name: 'P', email: 'private@example.com' } }),
      message('imap_msg_INBOX_2', 't1', { from: { name: 'Bank', email: 'no-reply@cards.bank.example' } }),
      message('imap_msg_INBOX/Personal_3', 't1'),
      message('imap_msg_INBOX_4', 't2'),
      message('imap_msg_Sent_5', 't1', { from: { name: 'Adam', email: 'adam@pure.science' }, to: [{ name: '', email: 'private@example.com' }] }),
      message('imap_msg_INBOX_6', 't1', { body: 'Kept.' }),
    ]
    expect(digestLinesFor(s, share, ACCOUNT, new Set()).map(item => item.line.text)).toEqual(['Kept.'])
  })
})

describe('digest text', () => {
  it('strips quoted history and signatures', () => {
    const text = digestText(message('m', 't', {
      body: 'Thanks, signed copy Friday.\n\n-- \nAna Ruiz\nHead of Ops\n\nOn Mon, Oct 26, 2026 Adam wrote:\n> Can you send it?',
    }))
    expect(text).toBe('Thanks, signed copy Friday.')
  })

  it('reads HTML-only mail as plain text', () => {
    expect(digestText(message('m', 't', { body: '', bodyHtml: '<p>Hello&nbsp;<b>Adam</b></p><div class="gmail_quote">old</div>' })))
      .toBe('Hello Adam')
  })

  it('keeps at most 2000 characters', () => {
    const text = digestText(message('m', 't', { body: 'word '.repeat(1000) }))
    expect(text.length).toBeLessThanOrEqual(DIGEST_TEXT_LIMIT)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('cursor and day files', () => {
  it('keeps the last 5000 ids', () => {
    const ids = Array.from({ length: DIGEST_CURSOR_LIMIT + 10 }, (_, index) => `id${index}`)
    const parsed = parseDigestCursor(serializeDigestCursor(ids))
    expect(parsed).toHaveLength(DIGEST_CURSOR_LIMIT)
    expect(parsed[0]).toBe('id10')
    expect(JSON.parse(serializeDigestCursor(['a']))).toEqual({ v: 1, written: ['a'] })
    expect(parseDigestCursor('{')).toEqual([])
  })

  it('appends one JSON line per message', () => {
    const line = digestLinesFor(store(), share, ACCOUNT, new Set())[0]!.line
    const text = appendDigestLines('{"id":"x"}', [line])
    expect(text.split('\n')).toHaveLength(3)
    expect(JSON.parse(text.split('\n')[1]!)).toEqual(line)
  })
})

describe('writeMailDigest', () => {
  it('appends new messages once and keeps the cursor', async () => {
    const { disk, files } = memoryFiles()
    const s = store()
    const first = await writeMailDigest({ files, root: ROOT, store: s, share, account: ACCOUNT, instanceId: 'w1', now: 1000 })
    expect(first).toEqual({ written: 1 })
    const day = `${MAIL}/digest/${localDay('2026-10-26T12:00:00Z')}.jsonl`
    expect(disk.get(day)!.trim().split('\n')).toHaveLength(1)
    expect(parseDigestCursor(disk.get(`${MAIL}/cursor.json`)!)).toEqual(['<imap_msg_INBOX_1@mail.example>'])

    s.messages.push(message('imap_msg_INBOX_2', 't1', { receivedAt: '2026-10-26T14:00:00Z' }))
    expect(await writeMailDigest({ files, root: ROOT, store: s, share, account: ACCOUNT, instanceId: 'w1', now: 2000 }))
      .toEqual({ written: 1 })
    expect(disk.get(day)!.trim().split('\n')).toHaveLength(2)
    expect(await writeMailDigest({ files, root: ROOT, store: s, share, account: ACCOUNT, instanceId: 'w2', now: 3000 }))
      .toEqual({ written: 0 })
    expect([...disk.keys()].filter(path => path.includes('writing'))).toEqual([])
  })

  it('skips the round while another window holds the cursor, and recovers a dead lock', async () => {
    const { disk, files } = memoryFiles({ [`${MAIL}/cursor.json.writing-w9-1000`]: serializeDigestCursor([]) })
    expect(await writeMailDigest({ files, root: ROOT, store: store(), share, account: ACCOUNT, instanceId: 'w1', now: 2000 }))
      .toEqual({ written: 0, busy: true })
    expect(await writeMailDigest({ files, root: ROOT, store: store(), share, account: ACCOUNT, instanceId: 'w1', now: 1000 + 3 * 60_000 }))
      .toEqual({ written: 1 })
    expect([...disk.keys()].filter(path => path.includes('writing'))).toEqual([])
  })

  it('does not write a message already in the day file even when the cursor lost it', async () => {
    const line = digestLinesFor(store(), share, ACCOUNT, new Set())[0]!
    const day = `${MAIL}/digest/${line.day}.jsonl`
    const { disk, files } = memoryFiles({ [day]: appendDigestLines(null, [line.line]) })
    await writeMailDigest({ files, root: ROOT, store: store(), share, account: ACCOUNT, instanceId: 'w1', now: 1 })
    expect(disk.get(day)!.trim().split('\n')).toHaveLength(1)
  })
})

const DRAFT = {
  v: 1, key: 'cos-chase-fu-0003-1', account: 'adam@pure.science',
  to: [{ name: 'Ana Ruiz', address: 'ana@example.com' }], cc: [],
  subject: 'Re: pilot terms', body: 'Hello Ana,\n\nA polite chase.',
  inReplyTo: { threadId: 't1', messageId: '<imap_msg_INBOX_1@mail.example>' },
  why: 'Ana promised the signed terms by Friday.',
}

describe('draft requests', () => {
  it('accepts a valid draft', () => {
    const checked = checkDraftRequest(JSON.stringify(DRAFT), DRAFT.key, share)
    expect(checked.ok && checked.request).toMatchObject({
      key: DRAFT.key, to: [{ name: 'Ana Ruiz', email: 'ana@example.com' }], cc: [], body: DRAFT.body,
      inReplyTo: DRAFT.inReplyTo, why: DRAFT.why,
    })
  })

  it.each([
    ['not json', '{', 'not valid JSON'],
    ['wrong version', JSON.stringify({ ...DRAFT, v: 2 }), 'version 1'],
    ['key mismatch', JSON.stringify({ ...DRAFT, key: 'other-key' }), 'does not match'],
    ['unknown account', JSON.stringify({ ...DRAFT, account: 'someone@else.example' }), 'mailbox shared with the executive team is'],
    ['no recipients', JSON.stringify({ ...DRAFT, to: [] }), 'no one to send it to'],
    ['bad address', JSON.stringify({ ...DRAFT, to: [{ name: 'X', address: 'not-an-address' }] }), '"not-an-address" is not an email address'],
    ['bad cc', JSON.stringify({ ...DRAFT, cc: [{ address: 'a@b' }] }), 'is not an email address'],
    ['empty body', JSON.stringify({ ...DRAFT, body: '  \n' }), 'no body'],
  ])('refuses %s with a plain why', (_name, raw, why) => {
    const checked = checkDraftRequest(raw, DRAFT.key, share)
    expect(checked.ok).toBe(false)
    expect(!checked.ok && checked.why).toContain(why)
  })
})

describe('building the draft', () => {
  it('makes a reply in the thread, unsent and pending the usual draft save', () => {
    const s = store()
    const checked = checkDraftRequest(JSON.stringify(DRAFT), DRAFT.key, share)
    if (!checked.ok) throw new Error(checked.why)
    const built = buildExecutiveDraft(s, ACCOUNT, checked.request, { signature: 'Adam', now: '2026-10-27T09:00:00Z' })
    expect(built.inThread).toBe(true)
    expect(built.thread).toBeNull()
    expect(built.draft).toMatchObject({
      id: 'draft_reply_exec-cos-chase-fu-0003-1', threadId: 't1', subject: 'Re: pilot terms',
      to: [{ name: 'Ana Ruiz', email: 'ana@example.com' }], body: 'Hello Ana,\n\nA polite chase.\n\nAdam',
      syncState: 'pending', draftKind: 'manual', sourceMessageId: 'imap_msg_INBOX_1',
    })
    expect(built.draft.sentAt).toBeUndefined()
    const next = addExecutiveDraft(s, built)
    expect(existingExecutiveDraft(next, DRAFT.key)?.id).toBe(built.draft.id)
    expect(addExecutiveDraft(next, built)).toBe(next)
  })

  it('finds the thread by Message-ID when the thread id is unknown', () => {
    const checked = checkDraftRequest(JSON.stringify({ ...DRAFT, inReplyTo: { threadId: 'gone', messageId: 'IMAP_MSG_INBOX_1@mail.example' } }), DRAFT.key, share)
    if (!checked.ok) throw new Error(checked.why)
    expect(buildExecutiveDraft(store(), ACCOUNT, checked.request).draft.threadId).toBe('t1')
  })

  it('makes a new message when the thread is not found', () => {
    const s = store()
    const checked = checkDraftRequest(JSON.stringify({ ...DRAFT, inReplyTo: { threadId: 'gone' } }), DRAFT.key, share)
    if (!checked.ok) throw new Error(checked.why)
    const built = buildExecutiveDraft(s, ACCOUNT, checked.request)
    expect(built.inThread).toBe(false)
    expect(built.thread).toMatchObject({ id: 'thread_compose_exec-cos-chase-fu-0003-1', accountId: 'acct', mailboxId: 'imap_mbx_Drafts' })
    expect(built.draft).toMatchObject({ id: 'draft_compose_exec-cos-chase-fu-0003-1', syncState: 'pending', subject: 'Re: pilot terms' })
    const next = addExecutiveDraft(s, built)
    expect(next.threads[0]!.id).toBe(built.thread!.id)
    expect(next.drafts).toHaveLength(1)
  })
})

describe('takeExecutiveDrafts', () => {
  const drafts = `${MAIL}/drafts`
  const save = (made: string[]) => (request: { key: string }) => {
    made.push(request.key)
    return { draftId: `draft-${request.key}` }
  }

  it('takes a valid draft, refuses a bad one, and ignores other files', async () => {
    const { disk, files } = memoryFiles({
      [`${drafts}/${DRAFT.key}.json`]: JSON.stringify(DRAFT),
      [`${drafts}/bad-0001.json`]: JSON.stringify({ ...DRAFT, key: 'bad-0001', body: '' }),
      [`${drafts}/README.txt`]: 'not a draft',
      [`${drafts}/UPPER.json`]: '{}',
    })
    const made: string[] = []
    const result = await takeExecutiveDrafts({ files, root: ROOT, share, instanceId: 'w1', save: save(made), now: Date.parse('2026-10-27T09:00:00Z') })
    expect(made).toEqual([DRAFT.key])
    expect(result).toEqual({
      taken: [{ key: DRAFT.key, draftId: `draft-${DRAFT.key}` }],
      refused: [{ key: 'bad-0001', why: 'The draft has no body.' }],
    })
    expect(JSON.parse(disk.get(`${drafts}/taken/${DRAFT.key}.json`)!)).toEqual({
      ...DRAFT, draftId: `draft-${DRAFT.key}`, takenAt: '2026-10-27T09:00:00.000Z',
    })
    expect(JSON.parse(disk.get(`${drafts}/refused/bad-0001.json`)!)).toMatchObject({ why: 'The draft has no body.', refusedAt: '2026-10-27T09:00:00.000Z' })
    expect(disk.has(`${drafts}/${DRAFT.key}.json`)).toBe(false)
    expect([...disk.keys()].filter(path => path.includes('taking'))).toEqual([])
    expect(disk.has(`${drafts}/README.txt`)).toBe(true)
  })

  it('ignores a key already handled, without overwriting the earlier record', async () => {
    const earlier = JSON.stringify({ ...DRAFT, why: 'The draft has no body.', refusedAt: 'then' })
    const { disk, files } = memoryFiles({
      [`${drafts}/${DRAFT.key}.json`]: JSON.stringify(DRAFT),
      [`${drafts}/refused/${DRAFT.key}.json`]: earlier,
      [`${drafts}/again-0001.json`]: JSON.stringify({ ...DRAFT, key: 'again-0001' }),
      [`${drafts}/taken/again-0001.json`]: '{}',
    })
    const made: string[] = []
    const result = await takeExecutiveDrafts({ files, root: ROOT, share, instanceId: 'w1', save: save(made), now: 5 })
    expect(made).toEqual([])
    expect(result.refused.map(item => item.why)).toEqual(['already handled', 'already handled'])
    expect(disk.get(`${drafts}/refused/${DRAFT.key}.json`)).toBe(earlier)
    expect(JSON.parse(disk.get(`${drafts}/refused/${DRAFT.key}.again-5.json`)!).why).toBe('already handled')
    expect(JSON.parse(disk.get(`${drafts}/refused/again-0001.json`)!).why).toBe('already handled')
  })

  it('leaves a file another window is taking, and picks it up once that claim is stale', async () => {
    const claimed = `${drafts}/${DRAFT.key}.json.taking-w9-1000`
    const { disk, files } = memoryFiles({ [claimed]: JSON.stringify(DRAFT) })
    const made: string[] = []
    await takeExecutiveDrafts({ files, root: ROOT, share, instanceId: 'w1', save: save(made), now: 2000 })
    expect(made).toEqual([])
    expect(disk.has(claimed)).toBe(true)
    await takeExecutiveDrafts({ files, root: ROOT, share, instanceId: 'w1', save: save(made), now: 1000 + DRAFT_CLAIM_STALE_MS + 1 })
    expect(made).toEqual([DRAFT.key])
    expect(disk.has(`${drafts}/taken/${DRAFT.key}.json`)).toBe(true)
  })

  it('two windows looking at once make one draft', async () => {
    const { files } = memoryFiles({ [`${drafts}/${DRAFT.key}.json`]: JSON.stringify(DRAFT) })
    const made: string[] = []
    await Promise.all([
      takeExecutiveDrafts({ files, root: ROOT, share, instanceId: 'w1', save: save(made), now: 10 }),
      takeExecutiveDrafts({ files, root: ROOT, share, instanceId: 'w2', save: save(made), now: 10 }),
    ])
    expect(made).toEqual([DRAFT.key])
  })

  it('refuses with the reason when the draft cannot be saved', async () => {
    const { disk, files } = memoryFiles({ [`${drafts}/${DRAFT.key}.json`]: JSON.stringify(DRAFT) })
    const result = await takeExecutiveDrafts({
      files, root: ROOT, share, instanceId: 'w1', now: 1,
      save: () => { throw new Error('the store is not ready') },
    })
    expect(result.refused[0]!.why).toBe('PureMail could not make the draft: the store is not ready')
    expect(disk.has(`${drafts}/refused/${DRAFT.key}.json`)).toBe(true)
  })
})
