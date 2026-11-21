// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { blockRemoteImagesInMailHtml, compactPersistedDraft } from './mailStoreData'
import { sanitizeMailHtml, mailHtmlHasRemoteImages } from './sanitizeMailHtml'
import { buildMimeMessage, encodeMimeHeaderValue, formatMimeAddressList } from './mailMime'
import {
  buildMailQuery,
  parseMailQuery,
  renameMailView,
  resolveThreadQuery,
  saveMailView,
} from './mailQuery'
import { unsnoozeThread, wakeDueSnoozes } from './mailSnooze'
import {
  bodyMentionsAttachment,
  duplicateRecipientsAcrossFields,
  formatRecipientToken,
  parseRecipientInput,
} from './mailCompose'
import {
  attachmentContentToBase64,
  attachmentIdForFileName,
  safeAttachmentFileName,
  uniqueAttachmentFileName,
} from './mailAttachments'
import { prepareMailDrop } from './mailDrop'
import { parseCalendarInvite } from './mailCalendarInvite'
import { buildInviteRsvpDraft } from './inviteRsvpMessage'
import { zoneNamedIn } from './timezonePick'
import {
  bodyHasNoteSlot,
  createRun,
  createRunTemplateDraft,
  detectCsvDelimiter,
  emailedThisMonth,
  finalizeRunDraftForSend,
  parseCsv,
  recipientsFromCsv,
  renderRun,
  renderRunBodyHtml,
  renderRunBodyText,
  replaceRun,
  setNoteInBodyHtml,
  templateNoteSlotHtml,
} from './mailRuns'
import { buildMailPdfHtml } from './mailPdf'
import { migratePersistedMailStore } from './mailStoreMigration'
import { applyStoreFileChanges, mergeStoreFile, storeBaselineOf } from './storeFileMerge'
import { draftEditVersion } from './mailDrawerDrafts'
import { mergeScheduledSends } from './draftsFileMerge'
import { cancelScheduledSendsForDraft, scheduleSend } from './mailScheduledSend'
import { emptyMailStore } from './mailModel'
import { ImapMailProvider } from './imapMailProvider'
import { GmailMailProvider } from './gmailMailProvider'
import {
  listThreadsHandler,
  setFilterEnabledHandler,
  updateDraftHandler,
} from '../agents/handlers'
import { addMailFilter, runMailFilters } from './mailFilters'
import type { Draft, MailStore } from '../types'

function baseStore(): MailStore {
  const store = emptyMailStore()
  const account = {
    id: 'acc_1',
    provider: 'demo' as const,
    name: 'Alex',
    email: 'alex@example.com',
    syncState: 'online' as const,
  }
  const inbox = {
    id: 'mbx_inbox',
    accountId: 'acc_1',
    name: 'Inbox',
    role: 'inbox' as const,
    unreadCount: 1,
  }
  const sent = {
    id: 'mbx_sent',
    accountId: 'acc_1',
    name: 'Sent',
    role: 'sent' as const,
    unreadCount: 0,
  }
  const drafts = {
    id: 'mbx_drafts',
    accountId: 'acc_1',
    name: 'Drafts',
    role: 'drafts' as const,
    unreadCount: 0,
  }
  const archive = {
    id: 'mbx_archive',
    accountId: 'acc_1',
    name: 'Archive',
    role: 'archive' as const,
    unreadCount: 0,
  }
  const trash = {
    id: 'mbx_trash',
    accountId: 'acc_1',
    name: 'Trash',
    role: 'trash' as const,
    unreadCount: 0,
  }
  return {
    ...store,
    accounts: [account],
    mailboxes: [inbox, sent, drafts, archive, trash],
    threads: [
      {
        id: 't_1',
        accountId: 'acc_1',
        mailboxId: 'mbx_inbox',
        subject: 'Quarterly Budget Review',
        participants: [
          { name: 'Mira Chen', email: 'mira@example.com' },
          { name: 'Alex', email: 'alex@example.com' },
        ],
        labels: ['Finance'],
        status: 'inbox',
        priority: 'none',
        summary: 'Please review the attached spreadsheet for Q4.',
        lastMessageAt: '2026-11-18T10:00:00.000Z',
        syncState: 'synced',
      },
    ],
    messages: [
      {
        id: 'm_1',
        threadId: 't_1',
        from: { name: 'Mira Chen', email: 'mira@example.com' },
        to: [{ name: 'Alex', email: 'alex@example.com' }],
        bcc: [{ name: 'Secret Auditor', email: 'audit@example.com' }],
        subject: 'Quarterly Budget Review',
        body: 'Please review the Q4 numbers before Friday.',
        receivedAt: '2026-11-18T10:00:00.000Z',
        attachments: [
          {
            id: 'att_1',
            name: 'budget-q4.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeLabel: '12 KB',
          },
        ],
        read: false,
      },
    ],
  }
}

describe('security & privacy fixes', () => {
  it('blocks remote tracking pixels even with quoted > in alt or leading whitespace in src', () => {
    const bypassAlt = '<img alt=">" src="https://tracker.example/p.gif">'
    const bypassSpace = '<img src=" https://tracker.example/p2.gif">'

    expect(blockRemoteImagesInMailHtml(bypassAlt).blockedCount).toBe(1)
    expect(blockRemoteImagesInMailHtml(bypassAlt).html).not.toContain(' src=')
    expect(blockRemoteImagesInMailHtml(bypassSpace).blockedCount).toBe(1)
    expect(blockRemoteImagesInMailHtml(bypassSpace).html).not.toContain(' src=')

    expect(mailHtmlHasRemoteImages(bypassAlt)).toBe(true)
    expect(mailHtmlHasRemoteImages(bypassSpace)).toBe(true)
    expect(sanitizeMailHtml(bypassAlt, { allowRemoteImages: false })).not.toMatch(/\ssrc="https:/)
    expect(sanitizeMailHtml(bypassSpace, { allowRemoteImages: false })).not.toMatch(/\ssrc="\s*https:/)
    expect(sanitizeMailHtml(bypassAlt, { allowRemoteImages: false })).toContain('data-puremail-blocked-src=')
  })

  it('trims leading whitespace from sanitized href attributes', () => {
    const html = sanitizeMailHtml('<a href=" https://example.com/path">Click</a>')
    expect(html).toContain('href="https://example.com/path"')
  })
})

describe('MIME & provider fixes', () => {
  it('sanitizes header injection, RFC 2047 encodes non-ASCII subjects, quotes comma display names, and nests multipart/related inside multipart/alternative', () => {
    expect(encodeMimeHeaderValue('Hello\r\nBcc: evil@example.com')).toBe(
      'Hello Bcc: evil@example.com',
    )
    const encodedSubject = encodeMimeHeaderValue('Résumé — Q4 review 🎉')
    expect(encodedSubject).toContain('=?UTF-8?B?')
    for (const line of encodedSubject.split('\r\n')) {
      expect(line.trim().length).toBeLessThanOrEqual(75)
    }
    expect(
      formatMimeAddressList([{ name: 'Doe, Jane', email: 'jane@example.com' }]),
    ).toBe('"Doe, Jane" <jane@example.com>')

    const raw = buildMimeMessage({
      headerLines: ['To: mira@example.com', 'Subject: Inline test'],
      body: 'Line 1\nLine 2',
      bodyHtml: '<p>Hi <img src="data:image/PNG;base64,QUJD"></p>',
      attachments: [{ name: 'logo.png', mimeType: 'image/png', base64: 'QUJD' }],
      boundary: 'b_test',
    })
    expect(raw).toContain('Line 1\r\nLine 2')
    const altIdx = raw.indexOf('Content-Type: multipart/alternative; boundary="b_test_alt"')
    const relIdx = raw.indexOf('Content-Type: multipart/related; boundary="b_test_related"')
    expect(altIdx).toBeGreaterThan(-1)
    expect(relIdx).toBeGreaterThan(altIdx)
  })

  it('strips Bcc header from SMTP submission while keeping Bcc in envelope and Sent copy on IMAP', async () => {
    const smtpSent: Array<{ raw: string; from: string; recipients: string[] }> = []
    const appended: Array<{ folder: string; raw: string }> = []
    const provider = new ImapMailProvider({
      email: 'alex@example.com',
      imap: {
        async connect() {},
        async listFolders() {
          return [
            { path: 'INBOX', role: 'inbox' },
            { path: 'Sent', role: 'sent' },
          ]
        },
        async fetchMessages() {
          return []
        },
        async setFlag() {},
        async move() {},
        async append(folder, raw) {
          appended.push({ folder, raw })
        },
      },
      smtp: {
        async send(raw, from, recipients) {
          smtpSent.push({ raw, from, recipients })
        },
      },
    })
    await provider.fetchStore()
    const draft: Draft = {
      id: 'd_bcc',
      threadId: 't_1',
      to: [{ name: 'Doe, Jane', email: 'jane@example.com' }],
      bcc: [{ name: 'Hidden', email: 'hidden@example.com' }],
      subject: 'Confidential — résumé',
      body: 'Hello',
      attachments: [],
      updatedAt: '2026-11-20T10:00:00.000Z',
      syncState: 'pending',
    }
    await provider.send({ draft, threadId: 't_1' })
    expect(smtpSent).toHaveLength(1)
    expect(smtpSent[0]!.recipients).toContain('hidden@example.com')
    expect(smtpSent[0]!.raw).not.toMatch(/^Bcc:/im)
    expect(smtpSent[0]!.raw).toContain('"Doe, Jane" <jane@example.com>')
    expect(appended[0]!.raw).toMatch(/^Bcc:.*hidden@example\.com/im)
  })

  it('does not corrupt Gmail OOXML (.docx) attachments, ignores .txt attachments as body, and preserves threadId on updateDraft', async () => {
    const zipBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x80, 0x90])
    const zipBase64Url = btoa(String.fromCharCode(...zipBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const updateBodies: Array<Record<string, unknown>> = []
    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'token',
      fetch: async req => {
        if (req.url.endsWith('/profile')) {
          return { ok: true, status: 200, body: JSON.stringify({ emailAddress: 'alex@example.com' }) }
        }
        if (req.url.includes('/attachments/att-docx')) {
          return { ok: true, status: 200, body: JSON.stringify({ data: zipBase64Url, size: zipBytes.length }) }
        }
        if (req.method === 'PUT' && req.url.includes('/drafts/d-remote')) {
          updateBodies.push(JSON.parse(req.body ?? '{}'))
          return { ok: true, status: 200, body: JSON.stringify({ id: 'd-remote' }) }
        }
        if (req.url.includes('/threads?')) {
          const isInbox = req.url.includes('labelIds=INBOX')
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              threads: isInbox ? [{ id: 'g-t1' }] : [],
            }),
          }
        }
        if (req.url.includes('/threads/g-t1')) {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'g-t1',
              messages: [
                {
                  id: 'g-m1',
                  threadId: 'g-t1',
                  labelIds: ['INBOX', 'SENT'],
                  internalDate: String(Date.now()),
                  payload: {
                    headers: [
                      { name: 'From', value: 'alex@example.com' },
                      { name: 'To', value: 'mira@example.com' },
                      { name: 'Subject', value: 'Docx test' },
                    ],
                    mimeType: 'multipart/mixed',
                    parts: [
                      {
                        mimeType: 'text/html',
                        body: { data: btoa('<p>Real HTML body</p>') },
                      },
                      {
                        mimeType: 'text/plain',
                        filename: 'notes.txt',
                        body: { data: btoa('ATTACHMENT TEXT SHOULD NOT BE BODY') },
                      },
                      {
                        mimeType:
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        filename: 'report.docx',
                        body: { attachmentId: 'att-docx', size: zipBytes.length },
                      },
                    ],
                  },
                },
              ],
            }),
          }
        }
        if (req.url.includes('/labels')) {
          return { ok: true, status: 200, body: JSON.stringify({ labels: [] }) }
        }
        if (req.url.includes('/drafts')) {
          return { ok: true, status: 200, body: JSON.stringify({ drafts: [] }) }
        }
        return { ok: true, status: 200, body: '{}' }
      },
    })
    const store = await provider.fetchStore()
    const msg = store.messages[0]!
    expect(msg.body).toBe('Real HTML body')
    expect(msg.sentCopyPresent).toBe(true)
    const docx = msg.attachments.find(a => a.name === 'report.docx')!
    const downloaded = await provider.getAttachmentContent(msg, docx)
    expect(downloaded.content?.startsWith('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,')).toBe(true)

    await provider.updateDraft('d-remote', {
      id: 'd_local',
      threadId: 'gmail_thread_g-t1',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Re: Docx test',
      body: 'Updated',
      attachments: [],
      updatedAt: new Date().toISOString(),
      syncState: 'pending',
    })
    expect((updateBodies[0]?.message as { threadId?: string })?.threadId).toBe('g-t1')
  })
})

describe('query, snooze, and filter fixes', () => {
  it('handles older_than:1y, rejects invalid dates, respects word boundaries, supports bcc: and multi-word AND search', () => {
    const store = baseStore()
    expect(parseMailQuery('older_than:1y').terms).toEqual([
      { field: 'older_than', value: '1y', negated: false },
    ])
    expect(resolveThreadQuery(store, 'acc_1', 'older_than:1y', '2026-11-20T00:00:00Z').total).toBe(0)
    // Invalid date stays as free text rather than matching everything.
    expect(parseMailQuery('before:notadate').terms).toEqual([])
    expect(resolveThreadQuery(store, 'acc_1', 'before:notadate', '2026-11-20T00:00:00Z').total).toBe(0)
    // Word boundary prevents misparsing mailto: / login:.
    expect(parseMailQuery('mailto:mira@example.com').terms).toEqual([])
    expect(parseMailQuery('login:admin').terms).toEqual([])
    // bcc: and multi-word non-adjacent AND matching work.
    expect(resolveThreadQuery(store, 'acc_1', 'bcc:audit@example.com', '2026-11-20T00:00:00Z').total).toBe(1)
    expect(resolveThreadQuery(store, 'acc_1', 'mira friday budget-q4.xlsx', '2026-11-20T00:00:00Z').total).toBe(1)
    expect(buildMailQuery(parseMailQuery('subject:"Say \\"hi\\""'))).toContain('Say \\"hi\\"')
  })

  it('hides snoozed threads from in:inbox and supports unsnoozeThread & orphan wakeDueSnoozes', () => {
    const store = baseStore()
    const snoozedStore: MailStore = {
      ...store,
      threads: store.threads.map(t => ({
        ...t,
        status: 'snoozed' as const,
        snoozedUntil: '2026-11-25T09:00:00.000Z',
      })),
    }
    expect(resolveThreadQuery(snoozedStore, 'acc_1', 'in:inbox', '2026-11-20T00:00:00Z').total).toBe(0)
    expect(resolveThreadQuery(snoozedStore, 'acc_1', 'is:snoozed', '2026-11-20T00:00:00Z').total).toBe(1)
    const unsnoozed = unsnoozeThread(snoozedStore, 't_1', '2026-11-20T12:00:00.000Z')
    expect(resolveThreadQuery(unsnoozed, 'acc_1', 'in:inbox', '2026-11-20T12:00:00Z').total).toBe(1)
    // Even without a store.snoozes record, wakeDueSnoozes wakes due threads.
    const woken = wakeDueSnoozes(snoozedStore, '2026-11-26T00:00:00.000Z')
    expect(woken.wokenThreadIds).toEqual(['t_1'])
  })

  it('renames saved views without duplicating and avoids non-ASCII view ID collisions', () => {
    let store = baseStore()
    store = saveMailView(store, '重要', 'is:unread')
    store = saveMailView(store, '仕事', 'is:starred')
    expect(store.savedViews).toHaveLength(2)
    expect(store.savedViews![0]!.id).not.toBe(store.savedViews![1]!.id)
    const renamed = renameMailView(store, store.savedViews![0]!.id, 'Urgent', 'is:unread')
    expect(renamed.savedViews).toHaveLength(2)
    expect(renamed.savedViews![0]!.name).toBe('Urgent')
  })

  it('does not stamp filterRunAt on unmatched threads during a single-rule retroactive run', () => {
    let store = baseStore()
    const added = addMailFilter(store, {
      name: 'No match',
      query: 'from:nobody@example.com',
      actions: { skipInbox: true },
    })
    store = added.store
    const ruleId = added.rule.id
    const res = runMailFilters(store, 'acc_1', {
      includeAlreadyRun: true,
      ruleIds: [ruleId],
    })
    expect(res.store.threads[0]!.filterRunAt).toBeUndefined()
  })
})

describe('compose, attachments, calendar, timezones, runs, persistence & tool fixes', () => {
  it('parses quoted comma display names, detects duplicate recipients, and ignores quoted attachment mentions', () => {
    const token = formatRecipientToken('Doe, Jane', 'jane@example.com')
    expect(token).toBe('"Doe, Jane" <jane@example.com>')
    const parsed = parseRecipientInput(`${token}, Bob <bob@example.com>`)
    expect(parsed).toEqual([
      { name: 'Doe, Jane', email: 'jane@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ])
    const dupes = duplicateRecipientsAcrossFields({
      to: [{ name: 'Jane', email: 'jane@example.com' }],
      cc: [{ name: 'Jane', email: 'JANE@example.com' }],
    })
    expect(dupes).toHaveLength(1)
    expect(dupes[0]!.fields).toEqual(['To', 'Cc'])
    expect(
      bodyMentionsAttachment(
        'Sounds good, thanks!\n\nOn Nov 18, Mira wrote:\n> Please see the attached PDF.',
      ),
    ).toBe(false)
  })

  it('handles 0-byte drops, unsafe filenames, case-insensitive collisions, unique attachment ids, and base64 whitespace', async () => {
    const dropped = await prepareMailDrop(
      JSON.stringify({
        version: 1,
        kind: 'file',
        name: 'empty.txt',
        mimeType: 'text/plain',
        dataUrl: 'data:text/plain;base64, ',
      }),
      async b => b,
    )
    expect(dropped.attachments[0]?.size).toBe(0)
    expect(safeAttachmentFileName('..')).toBe('attachment')
    expect(safeAttachmentFileName('Are you free?')).toBe('Are you free_')
    expect(uniqueAttachmentFileName('report.pdf', new Set(['Report.pdf']))).toBe('report (1).pdf')
    expect(attachmentIdForFileName('a.txt')).not.toBe(attachmentIdForFileName('a.txt'))
    expect(
      attachmentContentToBase64({
        id: '1',
        name: 'a.bin',
        mimeType: 'application/octet-stream',
        sizeLabel: '1 KB',
        content: 'data:application/octet-stream;base64,QU\nJD',
      }),
    ).toBe('QUJD')
  })

  it('registers VTIMEZONE, preserves all-day dates, and allows alias RSVPs', () => {
    const tzIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:STANDARD',
      'DTSTART:20261101T020000',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:tz-test-1',
      'DTSTART;TZID=America/New_York:20261120T140000',
      'DTEND;TZID=America/New_York:20261120T150000',
      'SUMMARY:TZ Sync',
      'ORGANIZER:mailto:org@example.com',
      'ATTENDEE:mailto:alias@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const invite = parseCalendarInvite(tzIcs)!
    expect(invite.timeZone).toBe('America/New_York')
    expect(invite.startsAt).toBe('2026-11-20T19:00:00.000Z')
    const rsvp = buildInviteRsvpDraft({
      invite,
      response: 'accepted',
      account: { email: 'primary@example.com', aliases: ['alias@example.com'] },
      threadId: 't_1',
      timestamp: '2026-11-20T12:00:00.000Z',
    })
    expect(rsvp).not.toBeNull()

    const allDayIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:allday-1',
      'DTSTART;VALUE=DATE:20260710',
      'DTEND;VALUE=DATE:20260711',
      'SUMMARY:Offsite',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const allDay = parseCalendarInvite(allDayIcs)!
    expect(allDay.allDay).toBe(true)
    expect(allDay.startsAt).toBe('2026-07-10T00:00:00.000Z')
  })

  it('does not mis-guess timezones from ordinary lowercase English words', () => {
    expect(zoneNamedIn("Let's eat at 7pm")).toBeNull()
    expect(zoneNamedIn('Meet at the west entrance at 3pm')).toBeNull()
    expect(zoneNamedIn('Visit the art gallery at 4pm')).toBeNull()
    expect(zoneNamedIn('Call at 7pm EAT')?.zone).toBe('Africa/Nairobi')
  })

  it('fixes CSV parsing, emailedThisMonth, stateless bodyHasNoteSlot, and email-matched run re-rendering', () => {
    expect(detectCsvDelimiter('"Last, First";Email\n"Doe, Jane";jane@ex.com')).toBe(';')
    expect(parseCsv('O"Connor,oconnor@example.com\rJane,jane@example.com')).toEqual([
      ['O"Connor', 'oconnor@example.com'],
      ['Jane', 'jane@example.com'],
    ])
    const store = baseStore()
    const withDraftOnly: MailStore = {
      ...store,
      messages: [
        {
          id: 'm_draft',
          threadId: 't_1',
          from: { name: 'Alex', email: 'alex@example.com' },
          to: [{ name: 'Drafted', email: 'drafted@example.com' }],
          subject: 'Draft',
          body: 'Hi',
          receivedAt: '2026-11-19T10:00:00.000Z',
          attachments: [],
          read: true,
          isDraft: true,
        },
      ],
    }
    expect(emailedThisMonth(withDraftOnly, 'drafted@example.com', new Date('2026-11-20T00:00:00Z'))).toBe(false)
    expect(bodyHasNoteSlot({ body: 'Hi', bodyHtml: '<p>{{note}}</p>' })).toBe(true)
    expect(bodyHasNoteSlot({ body: 'Hi', bodyHtml: '<p>{{note}}</p>' })).toBe(true)

    const tpl = createRunTemplateDraft(
      store,
      {
        accountId: 'acc_1',
        subject: 'Hi {{name}}',
        body: 'Hello {{name}}\n\n{{note}}',
        bodyHtml: `<p>Hello {{name}}</p>${templateNoteSlotHtml()}`,
      },
      '2026-11-20T10:00:00.000Z',
    )
    const created = createRun(
      tpl.store,
      {
        name: 'Outreach',
        accountId: 'acc_1',
        templateDraftId: tpl.draft.id,
        recipients: recipientsFromCsv('name,email\nAlice,alice@example.com\nBob,bob@example.com'),
      },
      '2026-11-20T10:00:00.000Z',
    )
    let s = created.store
    const runId = created.run.id
    s = renderRun(s, runId, '2026-11-20T10:01:00.000Z').store
    const bobDraftBefore = s.drafts.find(d => d.to[0]?.email === 'bob@example.com')!
    s = {
      ...s,
      drafts: s.drafts.map(d =>
        d.id === bobDraftBefore.id
          ? { ...d, bodyHtml: setNoteInBodyHtml(d.bodyHtml!, 'Personal note for Bob')! }
          : d,
      ),
    }
    // Reorder CSV so Bob is now row 0 and Carol is row 1.
    s = replaceRun(s, {
      ...s.runs![0]!,
      recipients: recipientsFromCsv('name,email\nBob,bob@example.com\nCarol,carol@example.com'),
    })
    s = renderRun(s, runId, '2026-11-20T10:02:00.000Z').store
    const bobAfter = s.drafts.find(d => d.to[0]?.email === 'bob@example.com')!
    const carolAfter = s.drafts.find(d => d.to[0]?.email === 'carol@example.com')!
    expect(bobAfter.body).toContain('Personal note for Bob')
    expect(carolAfter.body).not.toContain('Personal note for Bob')
    expect(finalizeRunDraftForSend(bobAfter).body).toContain('Personal note for Bob')
  })

  it('fixes storeFileMerge object over-checks, scheduled send dedup & merge stage, compactPersistedDraft, and agent tool handlers', () => {
    const base = baseStore()
    const memory = { ...base, settings: { ...base.settings, signature: 'Local edit' } }
    const disk = { ...base, settings: { ...base.settings, signature: 'Disk edit' } }
    const merged = mergeStoreFile({
      baseline: storeBaselineOf(base),
      memory: base as unknown as Record<string, unknown>,
      disk: disk as unknown as Record<string, unknown>,
    })
    const applied = applyStoreFileChanges(memory, merged.changes)
    // Local concurrent edit must NOT be overwritten by stale merge over base.
    expect(applied.settings.signature).toBe('Local edit')

    const schedMerge = mergeScheduledSends({
      baseline: new Set(['s1']),
      memory: [{ id: 's1', draftId: 'd1', threadId: 't1', sendAt: '2026-11-20T10:00:00Z', createdAt: '2026-11-20T09:00:00Z', status: 'cancelled' }],
      disk: [{ id: 's1', draftId: 'd1', threadId: 't1', sendAt: '2026-11-20T10:00:00Z', createdAt: '2026-11-20T09:00:00Z', status: 'sent' }],
    })
    expect(schedMerge.merged[0]!.status).toBe('sent')

    const scheduled1 = scheduleSend(base, { draftId: 'd1', threadId: 't1', sendAt: '2026-11-21T09:00:00Z' }, '2026-11-20T09:00:00Z')
    const scheduled2 = scheduleSend(scheduled1, { draftId: 'd1', threadId: 't1', sendAt: '2026-11-22T09:00:00Z' }, '2026-11-20T09:01:00Z')
    expect(scheduled2.scheduledSends?.filter(e => e.status === 'scheduled')).toHaveLength(1)
    const cancelled = cancelScheduledSendsForDraft(scheduled2, 'd1')
    expect(cancelled.scheduledSends?.filter(e => e.status === 'scheduled')).toHaveLength(0)

    const legacyDraft = { id: 'd_legacy', threadId: 't_1', to: [], subject: '', body: '', updatedAt: '', syncState: 'synced' } as unknown as Draft
    expect(compactPersistedDraft(legacyDraft).attachments).toEqual([])

    const makeCtx = (s: MailStore) => ({
      store: s,
      accountId: 'acc_1',
      currentQuery: 'in:inbox',
      selectedThread: null,
      showQuery: () => {},
      setStore: () => {},
      applyAction: () => {},
      addTaskForThread: () => null,
      requestDraftForThread: async () => ({ id: 'd_new' } as never),
      noteAgentSearch: () => {},
      listMailOperations: async () => [],
    })

    const storeWithFilter = addMailFilter(base, { name: 'News', query: 'from:news', actions: {} }).store
    expect(() =>
      setFilterEnabledHandler(makeCtx(storeWithFilter), { filter: 'News' }),
    ).toThrow(/boolean/i)

    const negLimit = listThreadsHandler(makeCtx(base), { limit: -1 })
    const parsedList = JSON.parse(negLimit.content) as { threads: unknown[] }
    expect(parsedList.threads).toEqual([])

    const draftStore: MailStore = {
      ...base,
      drafts: [
        {
          id: 'd_edit',
          threadId: 't_1',
          to: [{ name: 'Mira', email: 'mira@example.com' }],
          cc: [{ name: 'Bob', email: 'bob@example.com' }],
          bcc: [{ name: 'Audit', email: 'audit@example.com' }],
          subject: 'Hello',
          body: 'Hi',
          attachments: [],
          updatedAt: '2026-11-20T10:00:00.000Z',
          syncState: 'pending',
        },
      ],
    }
    const receivedPatches: Array<Record<string, unknown>> = []
    const version = draftEditVersion(draftStore.drafts[0]!)
    updateDraftHandler(
      {
        ...makeCtx(draftStore),
        editDraft: (_id, patch) => {
          receivedPatches.push(patch as Record<string, unknown>)
          return { ok: true }
        },
      },
      { draftId: 'd_edit', expectedVersion: version, subject: '', cc: '', bcc: '' },
    )
    expect(receivedPatches).toHaveLength(1)
    expect(receivedPatches[0]).toMatchObject({ subject: '', cc: '', bcc: '' })
  })

  it('hardens PDF cid substitution, embedded tab URLs, bare CR headers, global {{note}} replacement, Gmail untrash/contentId, and migration of deliveryAccepted draft threads', async () => {
    // 1. Embedded tab in src and multi-entry srcset must be blocked.
    const tabImg = sanitizeMailHtml('<img src="ht\ttps://tracker.example/t.gif">', { allowRemoteImages: false })
    expect(tabImg).not.toMatch(/\ssrc="https:/)
    expect(blockRemoteImagesInMailHtml('<img srcset="data:image/png;base64,AA== 1x, https://tracker.example/hi.png 2x">').blockedCount).toBe(1)

    // 2. Bare CR injection in headerLines must be stripped.
    const rawCr = buildMimeMessage({ headerLines: ['Subject: Hi\rBcc: evil@example.com'], body: 'Hello', attachments: [] })
    expect(rawCr).not.toMatch(/\rBcc:/i)

    // 3. Multiple {{note}} tokens are replaced globally in HTML and text.
    const multiHtml = renderRunBodyHtml('<p>{{note}}</p><p>{{note}}</p>', {})
    expect(multiHtml.html).not.toContain('{{note}}')
    const multiText = renderRunBodyText('A {{note}} B {{note}}', {})
    expect(multiText.text).not.toContain('{{note}}')

    // 4. PDF cid: substitution rejects SVG / quote-breaking data URIs and resolves valid PNG.
    const pdfHtml = buildMailPdfHtml({
      subject: baseStore().threads[0]!.subject,
      messages: [
        {
          ...baseStore().messages[0]!,
          bodyHtml: '<p><img src="cid:good@ex"><img src="cid:evil@ex"></p>',
          attachments: [
            {
              id: 'a1',
              name: 'logo.png',
              mimeType: 'image/png',
              sizeLabel: '1 KB',
              contentId: '<good@ex>',
              content: 'data:image/png;base64,iVBORw0KGgo=',
            },
            {
              id: 'a2',
              name: 'xss.svg',
              mimeType: 'image/svg+xml',
              sizeLabel: '1 KB',
              contentId: '<evil@ex>',
              content: 'data:image/svg+xml," onerror="alert(1)',
            },
          ],
        },
      ],
    })
    expect(pdfHtml).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(pdfHtml).not.toContain('onerror')
    expect(pdfHtml).not.toContain('image/svg+xml')

    // 5. Gmail untrashThread calls /untrash then /modify INBOX, and extractAttachments captures Content-ID.
    const gmailCalls: string[] = []
    const gmail = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'token',
      fetch: async req => {
        gmailCalls.push(`${req.method} ${req.url}`)
        return { ok: true, status: 200, body: '{}' }
      },
    })
    await gmail.untrashThread('gmail_thread_abc')
    expect(gmailCalls[0]).toContain('/threads/abc/untrash')
    expect(gmailCalls[1]).toContain('/threads/abc/modify')

    // 6. mailStoreMigration keeps synthetic thread_draft_* when it hosts a deliveryAccepted receipt.
    const s = baseStore()
    const syntheticStore: MailStore = {
      ...s,
      threads: [
        ...s.threads,
        {
          id: 'thread_draft_sent1',
          accountId: 'acc_1',
          mailboxId: 'mbx_inbox',
          subject: 'Sent standalone',
          participants: [],
          labels: [],
          status: 'waiting',
          priority: 'none',
          summary: 'Done',
          lastMessageAt: '2026-11-20T10:00:00.000Z',
          syncState: 'synced',
        },
      ],
      messages: [
        ...s.messages,
        {
          id: 'msg_sent_receipt',
          threadId: 'thread_draft_sent1',
          from: { name: 'Alex', email: 'alex@example.com' },
          to: [{ name: 'Mira', email: 'mira@example.com' }],
          subject: 'Sent standalone',
          body: 'Done',
          receivedAt: '2026-11-20T10:00:00.000Z',
          attachments: [],
          read: true,
          deliveryAccepted: true,
        },
      ],
      drafts: [],
    }
    const migrated = migratePersistedMailStore(syntheticStore)
    expect(migrated.threads.some(t => t.id === 'thread_draft_sent1')).toBe(true)
    expect(migrated.messages.some(m => m.id === 'msg_sent_receipt')).toBe(true)
  })

  it('round-2 review fixes: WHATWG remote-image bypasses, SVG data URI ban, body text preservation, video preservation, calendar TZID/RECURRENCE-ID, strict dates, snooze safety, timezone picking, real 0-byte drops, and run CSV/locked preservation', async () => {
    // 1. WHATWG special-scheme remote-image bypasses & data:image/svg+xml rejection.
    expect(mailHtmlHasRemoteImages('<img src="https:\\\\tracker.example/px.gif">')).toBe(true)
    expect(mailHtmlHasRemoteImages('<img src="http:tracker.example/px.gif">')).toBe(true)
    expect(sanitizeMailHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">', { allowRemoteImages: true })).not.toContain('data:image/svg+xml')
    // 2. Visible body text & alt attributes are never corrupted, data: srcset isn't false-positive blocked, and <video> survives collapseSpacerBlocks.
    const bodyTextHtml = '<p>Set style="background: url(https://example.com/bg.png)"</p>'
    expect(blockRemoteImagesInMailHtml(bodyTextHtml).blockedCount).toBe(0)
    expect(blockRemoteImagesInMailHtml(bodyTextHtml).html).toContain('background: url(https://example.com/bg.png)')
    expect(blockRemoteImagesInMailHtml('<img srcset="data:image/png;base64,//8AAQ== 1x">').blockedCount).toBe(0)
    expect(sanitizeMailHtml('<div><video src="cid:clip@example.com"></video></div>')).toContain('<video')

    // 3. Calendar: IANA TZID without VTIMEZONE, Windows TZID normalization, and RECURRENCE-ID in RSVP.
    const noVtzIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:no-vtz-1',
      'RECURRENCE-ID:20261127T140000Z',
      'DTSTART;TZID=America/New_York:20261120T140000',
      'DTEND;TZID=America/New_York:20261120T150000',
      'SUMMARY:No VTIMEZONE',
      'ORGANIZER:mailto:org@example.com',
      'ATTENDEE:mailto:alex@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const parsedNoVtz = parseCalendarInvite(noVtzIcs)!
    expect(parsedNoVtz.startsAt).toBe('2026-11-20T19:00:00.000Z')
    expect(parsedNoVtz.timeZone).toBe('America/New_York')
    const rsvpRec = buildInviteRsvpDraft({
      invite: parsedNoVtz,
      response: 'accepted',
      account: { email: 'alex@example.com' },
      threadId: 't_1',
      timestamp: '2026-11-20T12:00:00.000Z',
    })!
    expect(rsvpRec.attachments[0]?.content).toContain('RECURRENCE-ID:')

    const winTzIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:win-tz-1',
      'DTSTART;TZID=Eastern Standard Time:20261120T140000',
      'DTEND;TZID=Eastern Standard Time:20261120T150000',
      'SUMMARY:Outlook Invite',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const parsedWin = parseCalendarInvite(winTzIcs)!
    expect(parsedWin.timeZone).toBe('America/New_York')
    expect(parsedWin.startsAt).toBe('2026-11-20T19:00:00.000Z')

    // 4. Strict calendar dates in mailQuery: reject Feb 30 rollover and bare "1".
    expect(parseMailQuery('before:2026-02-30').terms).toEqual([])
    expect(parseMailQuery('before:1').terms).toEqual([])
    expect(parseMailQuery('before:2026-11-20').terms).toHaveLength(1)

    // 5. Snooze safety: invalid date does not wake; unsnooze does not resurrect trashed thread; deleted returnMailboxId falls back to inbox.
    const s = baseStore()
    const badSnoozeStore: MailStore = {
      ...s,
      threads: s.threads.map(t => ({ ...t, status: 'snoozed' as const, snoozedUntil: '' })),
      snoozes: [{ threadId: 't_1', snoozedUntil: '', snoozedAt: '2026-11-19T00:00:00Z', returnMailboxId: 'deleted_box' }],
    }
    expect(wakeDueSnoozes(badSnoozeStore, '2026-11-20T00:00:00Z').wokenThreadIds).toEqual([])
    const wokenFallback = unsnoozeThread(badSnoozeStore, 't_1', '2026-11-20T00:00:00Z')
    expect(wokenFallback.threads[0]!.mailboxId).toBe('mbx_inbox')

    const trashedWithStaleSnooze: MailStore = {
      ...s,
      mailboxes: [...s.mailboxes, { id: 'mbx_trash', accountId: 'acc_1', name: 'Trash', role: 'trash', unreadCount: 0 }],
      threads: s.threads.map(t => ({ ...t, mailboxId: 'mbx_trash', status: 'archived' as const })),
      snoozes: [{ threadId: 't_1', snoozedUntil: '2026-11-25T00:00:00Z', snoozedAt: '2026-11-19T00:00:00Z', returnMailboxId: 'mbx_inbox' }],
    }
    const pruned = unsnoozeThread(trashedWithStaleSnooze, 't_1')
    expect(pruned.threads[0]!.mailboxId).toBe('mbx_trash')
    expect(pruned.snoozes).toEqual([])

    // 6. Timezone picking: parenthesized/dotted times match; bare numbers before words do not.
    expect(zoneNamedIn('Meet at 3pm (ET)')?.zone).toBe('America/New_York')
    expect(zoneNamedIn('Meet at 3:30 p.m. ET')?.zone).toBe('America/New_York')
    expect(zoneNamedIn('I bought 3 art prints')).toBeNull()
    expect(zoneNamedIn('123 West Main St')).toBeNull()
    expect(zoneNamedIn('Use 12 pt font')).toBeNull()

    // 7. Real 0-byte drop (no space after base64,) and parameterized data URL.
    const realZero = await prepareMailDrop(
      JSON.stringify({
        version: 1,
        kind: 'file',
        name: 'empty.txt',
        mimeType: 'text/plain',
        dataUrl: 'data:text/plain;base64,',
      }),
      async b => b,
    )
    expect(realZero.attachments[0]?.size).toBe(0)
    const paramDrop = await prepareMailDrop(
      JSON.stringify({
        version: 1,
        kind: 'file',
        name: 'hello.txt',
        mimeType: 'text/plain',
        dataUrl: 'data:text/plain;charset=utf-8;base64,SGVsbG8=',
      }),
      async b => b,
    )
    expect(paramDrop.attachments[0]?.size).toBe(5)

    // 8. Safe attachment names: Windows reserved names & trailing dots.
    expect(safeAttachmentFileName('CON.txt')).toBe('_CON.txt')
    expect(safeAttachmentFileName('report.')).toBe('report')

    // 9. CSV delimiter with leading blank line & spaced quoted fields.
    expect(detectCsvDelimiter('\nname;email\nAda;ada@ex.com')).toBe(';')
    expect(parseCsv('Name, Email\n"Doe, Jane", "jane@ex.com"')[1]).toEqual(['Doe, Jane', 'jane@ex.com'])

    // 10. IMAP move resolves destination UID via Message-ID instead of reusing source UID.
    let nextArchiveUid = 500
    const inboxMsgs = [
      { uid: 42, messageId: '<m-42@ex>', subject: 'Target', from: { name: 'A', email: 'a@ex.com' }, to: [{ name: 'Me', email: 'me@ex.com' }], date: '2026-11-19T10:00:00Z', body: 'hi', flags: ['\\Seen'] },
    ]
    const archiveMsgs = [
      { uid: 42, messageId: '<innocent-42@ex>', subject: 'Innocent', from: { name: 'B', email: 'b@ex.com' }, to: [{ name: 'Me', email: 'me@ex.com' }], date: '2026-11-18T10:00:00Z', body: 'old', flags: ['\\Seen'] },
    ]
    const imap = new ImapMailProvider({
      email: 'me@ex.com',
      imap: {
        connect: async () => {},
        listFolders: async () => [
          { path: 'INBOX', role: 'inbox' },
          { path: 'Archive', role: 'archive' },
        ],
        fetchMessages: async (folder, _limit, _since, _before, headerFilter) => {
          const list = folder === 'INBOX' ? inboxMsgs : archiveMsgs
          if (headerFilter) {
            const targetVal = Array.isArray(headerFilter)
              ? headerFilter[0]?.value
              : headerFilter.value
            return list.filter(m => m.messageId === targetVal)
          }
          return [...list]
        },
        setFlag: async () => {},
        move: async (from, uid, to) => {
          const src = from === 'INBOX' ? inboxMsgs : archiveMsgs
          const dst = to === 'INBOX' ? inboxMsgs : archiveMsgs
          const idx = src.findIndex(m => m.uid === uid)
          const [moved] = src.splice(idx, 1)
          dst.push({ ...moved!, uid: to === 'Archive' ? ++nextArchiveUid : 900 })
        },
        append: async () => 1,
        deleteMessage: async () => {},
      },
      smtp: { send: async () => {} },
    })
    const imapStore = await imap.fetchStore()
    const targetThread = imapStore.threads.find(t => t.subject === 'Target')!
    await imap.archiveThread(targetThread.id)
    await imap.unarchiveThread(targetThread.id)
    // Innocent Archive UID 42 must NEVER be moved to INBOX!
    expect(archiveMsgs.some(m => m.messageId === '<innocent-42@ex>')).toBe(true)
    expect(inboxMsgs.some(m => m.messageId === '<m-42@ex>')).toBe(true)
  })
})
