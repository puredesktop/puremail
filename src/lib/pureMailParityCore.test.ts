// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { demoMailStore } from '../test/mailFixtures'
import type { MailMessage, MailStore, MailThread } from '../types'
import {
  buildFollowUpNudgeText,
  clearRepliedFollowUpReminders,
  dismissFollowUpReminder,
  dueFollowUpReminders,
  scheduleFollowUpReminder,
} from './followUpRadar'
import {
  G_CHORD_DESTINATIONS,
  mailCommandForKey,
  mailGChordDestinationForKey,
} from './mailCommands'
import {
  buildEmlFromMessage,
  buildMarkdownFromThread,
  safeExportFilename,
} from './mailExport'
import {
  addMailFilter,
  runMailFilters,
  updateMailFilter,
} from './mailFilters'
import { buildMimeMessage } from './mailMime'
import {
  inspectMailPrivacy,
  parseAuthenticationResults,
  parseMessageImportance,
  sanitizeRawHeaders,
  stripTrackingPixels,
} from './mailPrivacyShield'
import {
  parseByteSize,
  parseMailQuery,
  resolveThreadQuery,
} from './mailQuery'
import {
  applyScreenerDecision,
  applyScreenerDecisionWithEffects,
  isNewsletterThread,
  isPaperTrailThread,
  unscreenedSendersInStore,
} from './mailScreener'
import {
  DEFAULT_SNIPPETS,
  deleteSnippet,
  matchSnippets,
  renderSnippet,
  upsertSnippet,
} from './mailSnippets'
import { compactPersistedMessage, emptyMailStore } from './mailStoreData'
import { migratePersistedMailStore } from './mailStoreMigration'
import {
  applyBulkTriageAction,
  archiveMutedRepliedThreads,
  archiveMutedRepliedThreadsWithIds,
  bulkTriageActionSummary,
  queuedActionForBulkTriage,
  toggleMuteThread,
  togglePinThread,
  toggleVipSender,
} from './mailTriage'
import { enqueueMailAction } from './mailActionQueue'
import {
  executeOneClickUnsubscribe,
  parseListUnsubscribe,
  supportsOneClickUnsubscribe,
  unsubscribeCandidatesForStore,
} from './mailUnsubscribe'
import { mailHtmlHasRemoteImages, sanitizeMailHtml } from './sanitizeMailHtml'
import { archiveThread, deleteThread } from './mailModel'
import { formatMimeAddressList } from './mailMime'
import { filterThreadsByListFilter, MAIL_LIST_FILTERS } from './mailListFilters'
import { buildSenderProfile } from './senderIntelligence'
import {
  applyStoreFileChanges,
  mergeStoreFile,
  storeBaselineOf,
} from './storeFileMerge'
import {
  buildScheduleSendPresets,
  buildSnoozePresets,
  parseNaturalDateTime,
} from './timePresets'
import { GmailMailProvider } from './gmailMailProvider'
import { ImapMailProvider, type ImapEnvelope, type ImapTransport, type SmtpTransport } from './imapMailProvider'

const NOW = '2026-06-21T12:00:00.000Z'

function makeBaseStore(): MailStore {
  const store = demoMailStore()
  return {
    ...store,
    settings: { ...store.settings, fetchWindow: '30d' },
  }
}

describe('Additive persistence, migration, and 3-way merge', () => {
  it('initializes new Wave 1 collections in emptyMailStore and migration', () => {
    const empty = emptyMailStore()
    expect(empty.vipSenders).toEqual([])
    expect(empty.mutedThreadIds).toEqual([])
    expect(empty.screenerDecisions).toEqual({})
    expect(empty.followUpReminders).toEqual([])
    expect(empty.snippets).toEqual([])
    expect(empty.contactGroups).toEqual([])

    const migrated = migratePersistedMailStore({
      ...empty,
      vipSenders: ['ceo@example.com', 123 as unknown as string],
      screenerDecisions: {
        'news@example.com': {
          email: 'news@example.com',
          destination: 'feed',
          decidedAt: NOW,
        },
        bad: { email: 'bad@example.com', destination: 'invalid' } as never,
      },
      followUpReminders: [
        {
          id: 'r1',
          threadId: 't1',
          accountId: 'a1',
          remindAt: NOW,
          createdAt: NOW,
          cancelOnReply: true,
          updatedAt: NOW,
        },
        { bad: true } as never,
      ],
    })
    expect(migrated.vipSenders).toEqual(['ceo@example.com'])
    expect(Object.keys(migrated.screenerDecisions ?? {})).toEqual([
      'news@example.com',
    ])
    expect(migrated.followUpReminders).toHaveLength(1)
  })

  it('strips prototype-polluting keys during 3-way merge and resolves screenerDecisions by timestamp', () => {
    const baselineStore = emptyMailStore()
    const baseline = storeBaselineOf(baselineStore)

    const disk = JSON.parse(
      JSON.stringify({
        ...baselineStore,
        screenerDecisions: {
          'a@example.com': {
            email: 'a@example.com',
            destination: 'feed',
            decidedAt: '2026-06-21T10:00:00.000Z',
            updatedAt: '2026-06-21T10:00:00.000Z',
          },
          constructor: { email: 'evil', destination: 'inbox', decidedAt: NOW },
          prototype: { email: 'evil', destination: 'inbox', decidedAt: NOW },
        },
      }),
    ) as Record<string, unknown>
    Object.defineProperty(
      disk.screenerDecisions as Record<string, unknown>,
      '__proto__',
      {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
      },
    )

    const memory = {
      ...baselineStore,
      screenerDecisions: {
        'a@example.com': {
          email: 'a@example.com',
          destination: 'paper_trail',
          decidedAt: '2026-06-21T09:00:00.000Z',
          updatedAt: '2026-06-21T09:00:00.000Z',
        },
        'b@example.com': {
          email: 'b@example.com',
          destination: 'inbox',
          decidedAt: '2026-06-21T11:00:00.000Z',
          updatedAt: '2026-06-21T11:00:00.000Z',
        },
      },
    } as unknown as Record<string, unknown>

    const result = mergeStoreFile({ baseline, memory, disk })
    const decisions = result.merged.screenerDecisions as Record<string, unknown>
    expect(Object.keys(decisions).sort()).toEqual([
      'a@example.com',
      'b@example.com',
    ])
    expect(
      (decisions['a@example.com'] as { destination: string }).destination,
    ).toBe('feed')
    expect(Object.prototype.hasOwnProperty.call(decisions, 'constructor')).toBe(
      false,
    )
    expect(Object.prototype.hasOwnProperty.call(decisions, 'prototype')).toBe(
      false,
    )

    const applied = applyStoreFileChanges(
      memory as unknown as MailStore,
      result.changes,
    )
    expect(applied.screenerDecisions?.['a@example.com']?.destination).toBe(
      'feed',
    )
    expect(applied.screenerDecisions?.['b@example.com']?.destination).toBe(
      'inbox',
    )
  })
})

describe('mailPrivacyShield', () => {
  it('parses SPF, DKIM, and DMARC verdicts from Authentication-Results and fallback headers', () => {
    expect(
      parseAuthenticationResults(
        'mx.google.com; dkim=pass header.i=@stripe.com; spf=pass smtp.mailfrom=stripe.com; dmarc=pass',
      ),
    ).toMatchObject({ spf: 'pass', dkim: 'pass', dmarc: 'pass' })

    expect(
      parseAuthenticationResults(
        'mx.example.com; dkim=fail; dmarc=none',
        'softfail (google.com: domain of transitioning sender)',
      ),
    ).toMatchObject({ spf: 'neutral', dkim: 'fail', dmarc: 'none' })

    expect(
      parseAuthenticationResults(
        undefined,
        'pass (domain ok)',
        'v=1; a=rsa-sha256; d=example.com; s=sel; b=abc123',
      ),
    ).toMatchObject({ spf: 'pass', dkim: 'neutral', dmarc: 'none' })
  })

  it('strips known tracker domains and 1x1/0x0/hidden external beacons while keeping real images', () => {
    const html = [
      '<p>Hello</p>',
      '<img src="https://us1.list-manage.com/track/open.php?u=1&id=2" width="10" height="10">',
      '<img src="https://t.sidekickopen81.com/e1t/o/abc">',
      '<img src="https://email.mixmax.com/api/track/v2/abc">',
      '<img src="https://r.superhuman.com/abc.gif">',
      '<img src="https://mailtrack.io/trace/mail/123.png">',
      '<img src="https://ct.sendgrid.net/wf/open?upn=xyz">',
      '<img src="https://trk.klclick.com/o/xyz">',
      '<img src="https://open.substack.com/o/xyz">',
      '<img src="https://e.customeriomail.com/e/o/xyz">',
      '<img src="https://via.intercom-mail.com/o?h=1">',
      '<img src="https://open.convertkit-mail2.com/xyz">',
      '<img src="https://analytics.random.example/px.gif" width="1" height="1">',
      '<img src="https://hidden.random.example/h.png" style="display:none">',
      '<img src="https://vis.random.example/v.png" style="visibility: hidden">',
      '<img src="https://cdn.example.com/hero.jpg" width="600" height="300">',
      '<img src="data:image/png;base64,iVBORw0KGgo=" width="1" height="1">',
    ].join('')

    const { html: cleaned, trackers } = stripTrackingPixels(html)
    expect(trackers.length).toBe(14)
    expect(trackers.filter(t => t.reason === 'known-tracker').length).toBe(11)
    expect(trackers.filter(t => t.reason === 'pixel-beacon').length).toBe(3)
    expect(cleaned).toContain('https://cdn.example.com/hero.jpg')
    expect(cleaned).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(cleaned).not.toContain('list-manage.com')
    expect(cleaned).not.toContain('r.superhuman.com')
    expect(cleaned).not.toContain('analytics.random.example')
  })

  it('detects phishing link warnings and sender mismatches', () => {
    const msg: MailMessage = {
      id: 'm1',
      threadId: 't1',
      from: { name: 'Bank Security', email: 'alerts@mybank.com' },
      replyTo: [{ name: 'Attacker', email: 'harvest@evil-phish.example' }],
      to: [{ name: 'Alex', email: 'alex@example.com' }],
      subject: 'Urgent verification',
      body: 'Click below',
      bodyHtml: [
        '<a href="https://evil-phish.example/login">https://mybank.com/verify</a>',
        '<a href="https://xn--pple-43d.com/id">Apple ID</a>',
        '<a href="http://198.51.100.12/login">Reset</a>',
        '<a href="javascript:alert(1)">Run</a>',
        '<a href="https://docs.mybank.com/help">https://mybank.com/help</a>',
      ].join(' '),
      receivedAt: NOW,
      attachments: [],
      read: false,
      rawHeaders: [
        {
          name: 'Authentication-Results',
          value: 'mx.example; spf=fail; dkim=fail; dmarc=fail',
        },
      ],
    }

    const report = inspectMailPrivacy(msg)
    expect(report.senderMismatch).toEqual({
      fromDomain: 'mybank.com',
      replyOrReturnDomain: 'evil-phish.example',
    })
    expect(report.auth).toMatchObject({
      spf: 'fail',
      dkim: 'fail',
      dmarc: 'fail',
    })
    expect(report.linkWarnings.map(w => w.reason)).toEqual([
      'domain-mismatch',
      'punycode',
      'ip-literal',
      'suspicious-scheme',
    ])
  })

  it('sanitizes raw headers (capping and stripping sensitive headers) and parses importance', () => {
    const raw = [
      { name: 'Cookie', value: 'secret=1' },
      { name: 'Authorization', value: 'Bearer xyz' },
      ...Array.from({ length: 70 }, (_, i) => ({
        name: `X-Header-${i}`,
        value: `val-${i}`,
      })),
    ]
    const clean = sanitizeRawHeaders(raw)
    expect(clean).toHaveLength(60)
    expect(clean.some(h => h.name === 'Cookie')).toBe(false)
    expect(clean.some(h => h.name === 'Authorization')).toBe(false)

    expect(parseMessageImportance('high')).toBe('high')
    expect(parseMessageImportance(undefined, '1 (Highest)')).toBe('high')
    expect(parseMessageImportance(undefined, '5 (Lowest)')).toBe('low')
    expect(parseMessageImportance('normal')).toBe('normal')
  })
})

describe('mailScreener', () => {
  it('classifies newsletters, paper trail receipts, and honors explicit screener overrides', () => {
    const thread: MailThread = {
      id: 't_news',
      accountId: 'acc_1',
      mailboxId: 'mb_inbox',
      subject: 'Weekly Digest #42',
      participants: [{ name: 'Substack', email: 'writer@substack.com' }],
      labels: [],
      status: 'inbox',
      priority: 'none',
      summary: 'Weekly notes',
      lastMessageAt: NOW,
      syncState: 'synced',
    }
    const msg: MailMessage = {
      id: 'm_news',
      threadId: 't_news',
      from: { name: 'Writer', email: 'writer@substack.com' },
      to: [{ name: 'Alex', email: 'alex@example.com' }],
      subject: 'Weekly Digest #42',
      body: 'Read more',
      receivedAt: NOW,
      attachments: [],
      listUnsubscribe: '<https://substack.com/unsub>',
      read: false,
    }

    expect(isNewsletterThread(thread, [msg])).toBe(true)
    expect(isPaperTrailThread(thread, [msg])).toBe(false)

    // Override to paper_trail
    const decisions = {
      'writer@substack.com': {
        email: 'writer@substack.com',
        destination: 'paper_trail' as const,
        decidedAt: NOW,
      },
    }
    expect(isNewsletterThread(thread, [msg], decisions)).toBe(false)
    expect(isPaperTrailThread(thread, [msg], decisions)).toBe(true)

    const receiptThread: MailThread = {
      ...thread,
      id: 't_rec',
      subject: 'Your Stripe Receipt #1049',
      participants: [{ name: 'Stripe', email: 'receipts@stripe.com' }],
    }
    const receiptMsg: MailMessage = {
      ...msg,
      id: 'm_rec',
      threadId: 't_rec',
      from: { name: 'Stripe', email: 'receipts@stripe.com' },
      subject: 'Your Stripe Receipt #1049',
      listUnsubscribe: '<https://stripe.com/unsub>',
    }
    expect(isPaperTrailThread(receiptThread, [receiptMsg])).toBe(true)
    expect(isNewsletterThread(receiptThread, [receiptMsg])).toBe(false)
  })

  it('finds unscreened senders (excluding self, VIP, decided, emailed) and blocks cleanly', () => {
    let store = makeBaseStore()
    const accountId = store.accounts[0]!.id
    const ownEmail = store.accounts[0]!.email
    const inboxId = store.mailboxes.find(m => m.role === 'inbox')!.id

    const firstSender = store.messages.find(
      m => m.from.email.toLowerCase() !== ownEmail.toLowerCase(),
    )!
    const secondSenderEmail = 'newperson@vendor.example'
    store = {
      ...store,
      vipSenders: [firstSender.from.email],
      threads: [
        ...store.threads,
        {
          id: 'thread_new_vendor',
          accountId,
          mailboxId: inboxId,
          subject: 'Invoice #9922',
          participants: [
            { name: 'Vendor Billing', email: secondSenderEmail },
            { name: 'Alex', email: ownEmail },
          ],
          labels: [],
          status: 'inbox',
          priority: 'none',
          summary: 'Attached invoice',
          lastMessageAt: NOW,
          syncState: 'synced',
        },
      ],
      messages: [
        ...store.messages,
        {
          id: 'msg_new_vendor',
          threadId: 'thread_new_vendor',
          from: { name: 'Vendor Billing', email: secondSenderEmail },
          to: [{ name: 'Alex', email: ownEmail }],
          subject: 'Invoice #9922',
          body: 'Please find attached invoice #9922.',
          receivedAt: NOW,
          attachments: [],
          read: false,
        },
      ],
    }

    const unscreened = unscreenedSendersInStore(store, accountId)
    expect(unscreened.some(s => s.email === firstSender.from.email.toLowerCase())).toBe(
      false,
    )
    const vendor = unscreened.find(s => s.email === secondSenderEmail)
    expect(vendor).toBeDefined()
    expect(vendor?.suggestedDestination).toBe('paper_trail')

    const blocked = applyScreenerDecision(
      store,
      secondSenderEmail,
      'blocked',
      'Vendor Billing',
      NOW,
    )
    expect(blocked.screenerDecisions?.[secondSenderEmail]?.destination).toBe(
      'blocked',
    )
    const trashedId = blocked.mailboxes.find(m => m.role === 'trash')!.id
    expect(
      blocked.threads.find(t => t.id === 'thread_new_vendor')?.mailboxId,
    ).toBe(trashedId)
    expect(
      unscreenedSendersInStore(blocked, accountId).some(
        s => s.email === secondSenderEmail,
      ),
    ).toBe(false)
  })
})

describe('mailSnippets', () => {
  it('ships 4 default snippets, renders template tokens, matches queries, and upserts/deletes', () => {
    expect(DEFAULT_SNIPPETS).toHaveLength(4)

    const rendered = renderSnippet(DEFAULT_SNIPPETS[1]!, {
      recipientName: 'Jane Doe',
      myName: 'Adam',
      subject: 'Q3 Roadmap',
      date: '2026-06-21',
    })
    expect(rendered.subject).toBe('Recap: Q3 Roadmap')
    expect(rendered.body).toContain('Hi Jane,')
    expect(rendered.body).toContain('2026-06-21')
    expect(rendered.body).toContain('Adam')

    expect(matchSnippets(DEFAULT_SNIPPETS, '/recap')[0]?.id).toBe(
      'snippet_meeting_recap',
    )
    expect(matchSnippets(DEFAULT_SNIPPETS, 'handoff')[0]?.id).toBe(
      'snippet_intro_handoff',
    )

    let store = emptyMailStore()
    store = upsertSnippet(
      store,
      {
        id: 'custom_1',
        title: 'Custom Reply',
        shortcut: '/thanks',
        body: 'Thanks {{first_name}}!',
      },
      NOW,
    )
    expect(store.snippets).toHaveLength(1)
    expect(store.snippets?.[0]?.shortcut).toBe('thanks')

    store = upsertSnippet(
      store,
      {
        id: 'custom_1',
        title: 'Updated Reply',
        shortcut: 'thanks',
        body: 'Updated!',
      },
      NOW,
    )
    expect(store.snippets).toHaveLength(1)
    expect(store.snippets?.[0]?.title).toBe('Updated Reply')

    store = deleteSnippet(store, 'custom_1')
    expect(store.snippets).toHaveLength(0)
  })
})

describe('mailExport', () => {
  it('builds valid RFC 5322 .eml with CRLF, HTML alternative, importance, and base64 attachment', () => {
    const message: MailMessage = {
      id: 'msg_export_1',
      threadId: 'thread_1',
      messageIdHeader: '<msg-1@example.com>',
      from: { name: 'Alice Smith', email: 'alice@example.com' },
      to: [{ name: 'Bob Jones', email: 'bob@example.com' }],
      subject: 'Quarterly Report',
      body: 'Plain body line 1\nLine 2',
      bodyHtml: '<p>Rich <strong>body</strong></p>',
      receivedAt: NOW,
      importance: 'high',
      attachments: [
        {
          id: 'att_1',
          name: 'report.txt',
          mimeType: 'text/plain',
          sizeLabel: '5 B',
          content: 'data:text/plain;base64,SGVsbG8=',
        },
      ],
      read: true,
    }
    const eml = buildEmlFromMessage(message)
    expect(eml).toContain('\r\n')
    expect(eml).toContain('From: Alice Smith <alice@example.com>\r\n')
    expect(eml).toContain('Subject: Quarterly Report\r\n')
    expect(eml).toContain('Importance: high\r\n')
    expect(eml).toContain('X-Priority: 1 (Highest)\r\n')
    expect(eml).toContain('multipart/mixed')
    expect(eml).toContain('multipart/alternative')
    expect(eml).toContain('SGVsbG8=')
  })

  it('builds a readable Markdown transcript and safe export filenames', () => {
    const store = makeBaseStore()
    const thread = store.threads[0]!
    const msgs = store.messages.filter(m => m.threadId === thread.id)
    const md = buildMarkdownFromThread(thread, msgs)
    expect(md).toContain(`# ${thread.subject}`)
    expect(md).toContain(`**Thread ID:** \`${thread.id}\``)
    expect(md).toContain(msgs[0]!.from.email)

    expect(safeExportFilename('Re: Q3 / Budget: Final?!', 'eml')).toBe(
      'Re-Q3-Budget-Final.eml',
    )
    expect(safeExportFilename('   ', 'md')).toBe('thread.md')
  })
})

describe('senderIntelligence', () => {
  it('aggregates sender profile counts, VIP, screener, auth, threads, and attachments', () => {
    const store = makeBaseStore()
    const ownEmail = store.accounts[0]!.email
    const targetEmail = 'mira@partner.example'
    const augmented: MailStore = {
      ...store,
      vipSenders: [targetEmail],
      screenerDecisions: {
        [targetEmail]: {
          email: targetEmail,
          destination: 'inbox',
          decidedAt: NOW,
          senderName: 'Mira Patel',
        },
      },
      threads: [
        ...store.threads,
        {
          id: 'thread_mira_1',
          accountId: store.accounts[0]!.id,
          mailboxId: store.mailboxes[0]!.id,
          subject: 'Partnership deck',
          participants: [
            { name: 'Mira Patel', email: targetEmail },
            { name: 'Alex', email: ownEmail },
          ],
          labels: [],
          status: 'inbox',
          priority: 'high',
          summary: 'Attached deck',
          lastMessageAt: '2026-06-21T10:00:00.000Z',
          syncState: 'synced',
        },
      ],
      messages: [
        ...store.messages,
        {
          id: 'msg_mira_in',
          threadId: 'thread_mira_1',
          from: { name: 'Mira Patel', email: targetEmail },
          to: [{ name: 'Alex', email: ownEmail }],
          subject: 'Partnership deck',
          body: 'Here is the deck.',
          receivedAt: '2026-06-20T09:00:00.000Z',
          authResults: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
          attachments: [
            {
              id: 'att_deck',
              name: 'deck.pdf',
              mimeType: 'application/pdf',
              sizeLabel: '1.2 MB',
              size: 1_200_000,
            },
          ],
          read: false,
        },
        {
          id: 'msg_mira_out',
          threadId: 'thread_mira_1',
          from: { name: 'Alex', email: ownEmail },
          to: [{ name: 'Mira Patel', email: targetEmail }],
          subject: 'Re: Partnership deck',
          body: 'Thanks Mira!',
          receivedAt: '2026-06-21T10:00:00.000Z',
          sentCopyPresent: true,
          attachments: [],
          read: true,
        },
      ],
    }

    const profile = buildSenderProfile(augmented, targetEmail, ownEmail)
    expect(profile.name).toBe('Mira Patel')
    expect(profile.domain).toBe('partner.example')
    expect(profile.receivedCount).toBe(1)
    expect(profile.sentCount).toBe(1)
    expect(profile.isVip).toBe(true)
    expect(profile.screenerDestination).toBe('inbox')
    expect(profile.latestAuth).toEqual({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
    })
    expect(profile.recentThreads[0]?.threadId).toBe('thread_mira_1')
    expect(profile.sharedAttachments[0]?.name).toBe('deck.pdf')
  })
})

describe('followUpRadar', () => {
  it('schedules, detects due, auto-clears on reply, dismisses, and builds nudge text', () => {
    let store = makeBaseStore()
    const accountId = store.accounts[0]!.id
    const thread = store.threads[0]!

    store = scheduleFollowUpReminder(
      store,
      {
        threadId: thread.id,
        accountId,
        remindAt: '2026-06-22T09:00:00.000Z',
        note: 'Check contract signature',
      },
      '2026-06-20T10:00:00.000Z',
    )
    expect(dueFollowUpReminders(store, Date.parse('2026-06-21T00:00:00.000Z'))).toHaveLength(0)
    expect(dueFollowUpReminders(store, Date.parse('2026-06-22T10:00:00.000Z'))).toHaveLength(1)

    // Inbound reply after createdAt cancels reminder
    const withReply: MailStore = {
      ...store,
      messages: [
        ...store.messages,
        {
          id: 'msg_inbound_reply',
          threadId: thread.id,
          from: { name: 'External', email: 'external@client.example' },
          to: [{ name: 'Alex', email: store.accounts[0]!.email }],
          subject: `Re: ${thread.subject}`,
          body: 'Signed and attached!',
          receivedAt: '2026-06-21T08:00:00.000Z',
          attachments: [],
          read: false,
        },
      ],
    }
    const cleared = clearRepliedFollowUpReminders(withReply, NOW)
    expect(dueFollowUpReminders(cleared, Date.parse('2026-06-25T00:00:00.000Z'))).toHaveLength(0)

    const manuallyDismissed = dismissFollowUpReminder(store, thread.id, NOW)
    expect(manuallyDismissed.followUpReminders?.[0]?.dismissedAt).toBe(NOW)

    const nudge = buildFollowUpNudgeText(thread, {
      id: 's1',
      threadId: thread.id,
      from: { name: 'Alex', email: store.accounts[0]!.email },
      to: [{ name: 'Jordan Lee', email: 'jordan@example.com' }],
      subject: `Re: ${thread.subject}`,
      body: 'Checking in',
      receivedAt: NOW,
      attachments: [],
      read: true,
    })
    expect(nudge).toContain('Hi Jordan,')
    expect(nudge).toContain(thread.subject.replace(/^Re:\s*/i, ''))
  })
})

describe('timePresets', () => {
  it('builds snooze and schedule-send presets and parses natural future dates', () => {
    const ref = new Date('2026-06-22T10:00:00') // Monday 10:00 AM local
    const snooze = buildSnoozePresets(ref)
    expect(snooze.map(p => p.id)).toEqual([
      'later_today',
      'tomorrow_morning',
      'this_weekend',
      'next_week',
      'next_month',
    ])
    for (const preset of snooze) {
      expect(Date.parse(preset.iso)).toBeGreaterThan(ref.getTime())
    }

    const send = buildScheduleSendPresets(ref)
    expect(send.map(p => p.id)).toEqual([
      'in_1_hour',
      'later_today',
      'tomorrow_morning',
      'monday_morning',
    ])
    for (const preset of send) {
      expect(Date.parse(preset.iso)).toBeGreaterThan(ref.getTime())
    }

    const tomorrow = parseNaturalDateTime('tomorrow at 3pm', ref)
    expect(tomorrow).not.toBeNull()
    expect(Date.parse(tomorrow!.iso)).toBeGreaterThan(ref.getTime())

    const past = parseNaturalDateTime('yesterday at 9am', ref)
    expect(past).toBeNull()
  })
})

describe('mailQuery Wave 1 operators and pinned sort', () => {
  it('parses byte sizes, filename:, folder: alias, and new is: flags', () => {
    expect(parseByteSize('500')).toBe(500)
    expect(parseByteSize('50k')).toBe(50 * 1024)
    expect(parseByteSize('2m')).toBe(2 * 1024 * 1024)
    expect(parseByteSize('1g')).toBe(1024 * 1024 * 1024)
    expect(parseByteSize('bogus')).toBeNull()

    const parsed = parseMailQuery(
      'folder:inbox larger:10k smaller:5m filename:invoice.pdf is:vip is:pinned',
    )
    expect(parsed.terms).toEqual([
      { field: 'in', value: 'inbox', negated: false },
      { field: 'larger', value: '10k', negated: false },
      { field: 'smaller', value: '5m', negated: false },
      { field: 'filename', value: 'invoice.pdf', negated: false },
      { field: 'is', value: 'vip', negated: false },
      { field: 'is', value: 'pinned', negated: false },
    ])
  })

  it('resolves larger/smaller, filename, vip/muted/pinned/awaiting/overdue/newsletter/receipt and sorts pinned first', () => {
    const base = makeBaseStore()
    const accountId = base.accounts[0]!.id
    const ownEmail = base.accounts[0]!.email
    const inboxId = base.mailboxes.find(m => m.role === 'inbox')!.id

    const bigThread: MailThread = {
      id: 'thread_big_vip',
      accountId,
      mailboxId: inboxId,
      subject: 'Your Amazon Receipt #123',
      participants: [{ name: 'VIP Sender', email: 'vip@corp.example' }],
      labels: [],
      status: 'inbox',
      priority: 'none',
      summary: 'Receipt attached',
      lastMessageAt: '2026-06-15T09:00:00.000Z', // older than other threads
      syncState: 'synced',
    }
    const awaitingThread: MailThread = {
      id: 'thread_awaiting_1',
      accountId,
      mailboxId: inboxId,
      subject: 'Proposal feedback',
      participants: [{ name: 'Client', email: 'client@acme.example' }],
      labels: [],
      status: 'waiting',
      priority: 'none',
      summary: 'Waiting on reply',
      lastMessageAt: '2026-06-10T09:00:00.000Z',
      syncState: 'synced',
    }
    const newsThread: MailThread = {
      id: 'thread_newsletter_1',
      accountId,
      mailboxId: inboxId,
      subject: 'Weekly Engineering Digest',
      participants: [{ name: 'Digest', email: 'news@substack.com' }],
      labels: [],
      status: 'inbox',
      priority: 'none',
      summary: 'Top stories',
      lastMessageAt: '2026-06-20T09:00:00.000Z',
      syncState: 'synced',
    }

    const store: MailStore = {
      ...base,
      vipSenders: ['vip@corp.example'],
      pinnedThreadIds: ['thread_big_vip'],
      mutedThreadIds: ['thread_newsletter_1'],
      threads: [...base.threads, bigThread, awaitingThread, newsThread],
      messages: [
        ...base.messages,
        {
          id: 'msg_big_vip',
          threadId: 'thread_big_vip',
          from: { name: 'VIP Sender', email: 'vip@corp.example' },
          to: [{ name: 'Alex', email: ownEmail }],
          subject: 'Your Amazon Receipt #123',
          body: 'Thanks for your order.',
          receivedAt: '2026-06-15T09:00:00.000Z',
          attachments: [
            {
              id: 'att_big',
              name: 'receipt-2026.pdf',
              mimeType: 'application/pdf',
              sizeLabel: '3 MB',
              size: 3 * 1024 * 1024,
            },
          ],
          read: true,
        },
        {
          id: 'msg_awaiting_1',
          threadId: 'thread_awaiting_1',
          from: { name: 'Alex', email: ownEmail },
          to: [{ name: 'Client', email: 'client@acme.example' }],
          subject: 'Proposal feedback',
          body: 'Can you review?',
          receivedAt: '2026-06-10T09:00:00.000Z',
          sentCopyPresent: true,
          attachments: [],
          read: true,
        },
        {
          id: 'msg_news_1',
          threadId: 'thread_newsletter_1',
          from: { name: 'Digest', email: 'news@substack.com' },
          to: [{ name: 'Alex', email: ownEmail }],
          subject: 'Weekly Engineering Digest',
          body: 'Top stories',
          receivedAt: '2026-06-20T09:00:00.000Z',
          listUnsubscribe: '<https://substack.com/unsub>',
          attachments: [],
          read: true,
        },
      ],
    }

    // Pinned thread sorts first despite older timestamp
    const inboxRes = resolveThreadQuery(store, accountId, 'folder:inbox', NOW)
    expect(inboxRes.threads[0]?.id).toBe('thread_big_vip')

    expect(
      resolveThreadQuery(store, accountId, 'larger:2m', NOW).threads.map(
        t => t.id,
      ),
    ).toEqual(['thread_big_vip'])
    expect(
      resolveThreadQuery(store, accountId, 'smaller:1m', NOW).threads.map(
        t => t.id,
      ),
    ).not.toContain('thread_big_vip')
    expect(
      resolveThreadQuery(store, accountId, 'filename:receipt-2026', NOW).threads.map(
        t => t.id,
      ),
    ).toEqual(['thread_big_vip'])
    expect(
      resolveThreadQuery(store, accountId, 'is:vip', NOW).threads.map(t => t.id),
    ).toEqual(['thread_big_vip'])
    expect(
      resolveThreadQuery(store, accountId, 'is:pinned', NOW).threads.map(
        t => t.id,
      ),
    ).toEqual(['thread_big_vip'])
    expect(
      resolveThreadQuery(store, accountId, 'is:muted', NOW).threads.map(
        t => t.id,
      ),
    ).toEqual(['thread_newsletter_1'])
    expect(
      resolveThreadQuery(store, accountId, 'is:newsletter', NOW).threads.map(
        t => t.id,
      ),
    ).toContain('thread_newsletter_1')
    expect(
      resolveThreadQuery(store, accountId, 'is:receipt', NOW).threads.map(
        t => t.id,
      ),
    ).toContain('thread_big_vip')
    expect(
      resolveThreadQuery(store, accountId, 'is:awaiting', NOW).threads.map(
        t => t.id,
      ),
    ).toContain('thread_awaiting_1')
    expect(
      resolveThreadQuery(store, accountId, 'is:overdue', NOW).threads.map(
        t => t.id,
      ),
    ).toContain('thread_awaiting_1')
  })
})

describe('mailTriage Wave 1 helpers', () => {
  it('toggles pin, mute, vip, auto-archives muted inbox threads, and supports bulk mute/pin/unstar', () => {
    let store = makeBaseStore()
    const tId = store.threads[0]!.id

    store = togglePinThread(store, tId)
    expect(store.pinnedThreadIds).toContain(tId)
    store = togglePinThread(store, tId)
    expect(store.pinnedThreadIds).not.toContain(tId)

    store = toggleMuteThread(store, tId)
    expect(store.mutedThreadIds).toContain(tId)
    const archivedMuted = archiveMutedRepliedThreads(store)
    expect(archivedMuted.threads.find(t => t.id === tId)?.status).toBe(
      'archived',
    )

    store = toggleVipSender(store, 'CEO@Example.COM')
    expect(store.vipSenders).toContain('ceo@example.com')
    store = toggleVipSender(store, 'ceo@example.com')
    expect(store.vipSenders).not.toContain('ceo@example.com')

    store = applyBulkTriageAction(store, [tId], { type: 'pin' })
    expect(store.pinnedThreadIds).toContain(tId)
    store = applyBulkTriageAction(store, [tId], { type: 'unpin' })
    expect(store.pinnedThreadIds).not.toContain(tId)

    store = applyBulkTriageAction(store, [tId], { type: 'star', starred: true })
    expect(store.starredThreadIds).toContain(tId)
    store = applyBulkTriageAction(store, [tId], { type: 'unstar' })
    expect(store.starredThreadIds).not.toContain(tId)

    store = applyBulkTriageAction(store, [tId], { type: 'unmute' })
    expect(store.mutedThreadIds).not.toContain(tId)

    expect(queuedActionForBulkTriage({ type: 'mute' })).toBeNull()
    expect(queuedActionForBulkTriage({ type: 'unpin' })).toBeNull()
    expect(queuedActionForBulkTriage({ type: 'pin' })).toBeNull()
    expect(queuedActionForBulkTriage({ type: 'unmute' })).toBeNull()
    expect(enqueueMailAction(store, 'mute', tId).queuedActions).toEqual(
      store.queuedActions,
    )
    expect(bulkTriageActionSummary({ type: 'pin' }, 2)).toBe('Pinned 2 threads.')
  })
})

describe('mailUnsubscribe RFC 8058 one-click', () => {
  it('parses List-Unsubscribe-Post, executes POST, and rejects private/non-https hosts', async () => {
    const targets = parseListUnsubscribe(
      '<https://lists.example.com/unsub?id=42>',
      'List-Unsubscribe=One-Click',
    )
    expect(targets.oneClick).toBe(true)
    expect(supportsOneClickUnsubscribe(targets)).toBe(true)

    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }))
    const res = await executeOneClickUnsubscribe(
      targets,
      fetchMock as unknown as typeof fetch,
    )
    expect(res).toEqual({ ok: true, status: 202 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lists.example.com/unsub?id=42',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    )

    // Private/localhost SSRF rejection
    expect(
      supportsOneClickUnsubscribe({
        https: 'https://127.0.0.1/unsub',
        oneClick: true,
      }),
    ).toBe(false)
    expect(
      supportsOneClickUnsubscribe({
        https: 'https://localhost/unsub',
        oneClick: true,
      }),
    ).toBe(false)
    const blocked = await executeOneClickUnsubscribe(
      { https: 'https://192.168.1.10/unsub', oneClick: true },
      fetchMock as unknown as typeof fetch,
    )
    expect(blocked.ok).toBe(false)
  })
})

describe('mailFilters expanded actions & updateMailFilter', () => {
  it('applies star, priority, mute, trash, createTask and updates rules', () => {
    const base = makeBaseStore()
    const accountId = base.accounts[0]!.id
    const target = base.threads[0]!

    const added = addMailFilter(base, {
      name: 'VIP escalation',
      query: `subject:"${target.subject}"`,
      actions: {
        star: true,
        priority: 'high',
        mute: true,
        createTask: true,
      },
    })
    const updated = updateMailFilter(added.store, added.rule.id, {
      name: 'Renamed VIP rule',
    })
    expect(updated.filters?.[0]?.name).toBe('Renamed VIP rule')

    const ran = runMailFilters(updated, accountId, {
      includeAlreadyRun: true,
      now: new Date(NOW),
    })
    expect(ran.store.starredThreadIds).toContain(target.id)
    expect(ran.store.mutedThreadIds).toContain(target.id)
    expect(
      ran.store.threads.find(t => t.id === target.id)?.priority,
    ).toBe('high')
    expect(
      ran.store.tasks.some(task => task.source.threadId === target.id),
    ).toBe(true)
    expect(ran.mutations).toContainEqual({ kind: 'star', threadId: target.id })

    // Trash action
    const trashRule = addMailFilter(base, {
      name: 'Auto trash',
      query: `subject:"${target.subject}"`,
      actions: { trash: true },
    })
    const trashed = runMailFilters(trashRule.store, accountId, {
      includeAlreadyRun: true,
      now: new Date(NOW),
    })
    const trashBoxId = trashed.store.mailboxes.find(m => m.role === 'trash')!.id
    expect(
      trashed.store.threads.find(t => t.id === target.id)?.mailboxId,
    ).toBe(trashBoxId)
    expect(trashed.mutations).toContainEqual({
      kind: 'trash',
      threadId: target.id,
    })
  })
})

describe('mailMime importance and read receipt', () => {
  it('emits Importance, X-Priority, and Disposition-Notification-To headers when requested', () => {
    const mime = buildMimeMessage({
      headerLines: [
        'From: Alice <alice@example.com>',
        'To: Bob <bob@example.com>',
        'Subject: Urgent note',
      ],
      body: 'Please read ASAP.',
      attachments: [],
      importance: 'high',
      requestReadReceipt: true,
    })
    expect(mime).toContain('Importance: high\r\n')
    expect(mime).toContain('X-Priority: 1 (Highest)\r\n')
    expect(mime).toContain(
      'Disposition-Notification-To: Alice <alice@example.com>\r\n',
    )
  })
})

describe('sanitizeMailHtml Wave 1 enhancements', () => {
  it('preserves <s> and <del> strikethrough tags and strips trackers even when allowRemoteImages is true', () => {
    const html =
      '<p><s>old</s> <del>removed</del></p>' +
      '<img src="https://r.superhuman.com/open.gif">' +
      '<img src="https://cdn.example.com/photo.png" width="400" height="300">'

    const clean = sanitizeMailHtml(html, {
      allowRemoteImages: true,
      stripTrackers: true,
    })
    expect(clean).toContain('<s>old</s>')
    expect(clean).toContain('<del>removed</del>')
    expect(clean).not.toContain('r.superhuman.com')
    expect(clean).toContain('https://cdn.example.com/photo.png')
  })
})

describe('mailCommands Wave 1 shortcuts and G-chords', () => {
  it('binds new triage shortcuts without breaking existing ones and exposes G_CHORD_DESTINATIONS', () => {
    expect(mailCommandForKey('h')).toBe('snooze')
    expect(mailCommandForKey('l')).toBe('label')
    expect(mailCommandForKey('v')).toBe('move')
    expect(mailCommandForKey('m')).toBe('mute')
    expect(mailCommandForKey('p')).toBe('pin')
    expect(mailCommandForKey('x')).toBe('select')
    expect(mailCommandForKey('z')).toBe('undo')
    expect(mailCommandForKey('?')).toBe('shortcuts-help')

    // Existing bindings still intact
    expect(mailCommandForKey('s')).toBe('snooze-follow-up')
    expect(mailCommandForKey('e')).toBe('archive')

    expect(G_CHORD_DESTINATIONS).toEqual({
      i: 'inbox',
      s: 'starred',
      h: 'snoozed',
      t: 'sent',
      d: 'drafts',
      a: 'archive',
      w: 'waiting',
      f: 'feed',
      p: 'paper_trail',
      c: 'screener',
    })
    expect(mailGChordDestinationForKey('F')).toBe('feed')
    expect(mailGChordDestinationForKey('q')).toBeNull()
  })
})

describe('Provider header extraction (Gmail & IMAP)', () => {
  it('extracts RFC 8058, authResults, returnPath, importance, and sanitized rawHeaders in Gmail provider', async () => {
    const jsonResp = (payload: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      body: JSON.stringify(payload),
    })
    const fetchMock = vi.fn(async (request: { url: string }) => {
      const { url } = request
      if (url.endsWith('/profile')) {
        return jsonResp({ emailAddress: 'alex@example.com' })
      }
      if (url.endsWith('/labels')) {
        return jsonResp({ labels: [] })
      }
      if (url.includes('/drafts')) {
        return jsonResp({ drafts: [] })
      }
      if (url.includes('/threads?')) {
        return jsonResp({ threads: [{ id: 't1' }] })
      }
      if (url.includes('/threads/t1')) {
        return jsonResp({
          id: 't1',
          messages: [
            {
              id: 'm1',
              threadId: 't1',
              internalDate: String(Date.parse(NOW)),
              labelIds: ['INBOX'],
              payload: {
                mimeType: 'text/plain',
                body: { data: btoa('Hello world') },
                headers: [
                  { name: 'From', value: 'Sender <sender@partner.example>' },
                  { name: 'To', value: 'alex@example.com' },
                  { name: 'Subject', value: 'Important Update' },
                  {
                    name: 'List-Unsubscribe',
                    value: '<https://partner.example/unsub>',
                  },
                  {
                    name: 'List-Unsubscribe-Post',
                    value: 'List-Unsubscribe=One-Click',
                  },
                  {
                    name: 'Authentication-Results',
                    value: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
                  },
                  { name: 'Return-Path', value: '<bounce@partner.example>' },
                  { name: 'Importance', value: 'high' },
                  { name: 'Cookie', value: 'should-be-stripped=1' },
                ],
              },
            },
          ],
        })
      }
      return jsonResp({}, 404)
    })

    const provider = new GmailMailProvider({
      email: 'alex@example.com',
      accessToken: async () => 'token',
      fetch: fetchMock,
    })
    const store = await provider.fetchStore()
    const msg = store.messages[0]!
    expect(msg.listUnsubscribePost).toBe('List-Unsubscribe=One-Click')
    expect(msg.authResults).toMatchObject({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
    })
    expect(msg.returnPath).toBe('<bounce@partner.example>')
    expect(msg.importance).toBe('high')
    expect(msg.rawHeaders?.some(h => h.name === 'Cookie')).toBe(false)
    expect(msg.rawHeaders?.some(h => h.name === 'Importance')).toBe(true)
  })

  it('extracts RFC 8058, authResults, returnPath, importance, and sanitized rawHeaders in IMAP provider', async () => {
    const envelope: ImapEnvelope = {
      uid: 101,
      messageId: '<imap-101@partner.example>',
      subject: 'Newsletter Issue',
      from: { name: 'Partner', email: 'news@partner.example' },
      to: [{ name: 'Alex', email: 'alex@example.com' }],
      date: NOW,
      body: 'Body text',
      flags: ['\\Seen'],
      listUnsubscribe: '<https://partner.example/unsub>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
      authenticationResults: 'mx.fastmail; spf=pass; dkim=pass; dmarc=pass',
      returnPath: '<bounces@partner.example>',
      importance: 'low',
      rawHeaders: [
        { name: 'From', value: 'news@partner.example' },
        { name: 'Set-Cookie', value: 'secret=1' },
      ],
    }

    const imap: ImapTransport = {
      connect: async () => {},
      listFolders: async () => [{ path: 'INBOX', role: 'inbox' }],
      fetchMessages: async () => [envelope],
      setFlag: async () => {},
      move: async () => {},
      append: async () => 1,
      deleteMessage: async () => {},
      fetchAttachment: async () => ({
        base64: '',
        contentType: 'application/octet-stream',
        filename: 'a.bin',
      }),
    }
    const smtp: SmtpTransport = {
      verify: async () => {},
      send: async () => undefined,
    }

    const provider = new ImapMailProvider({
      email: 'alex@example.com',
      name: 'Alex',
      imap,
      smtp,
    })
    const store = await provider.fetchStore()
    const msg = store.messages[0]!
    expect(msg.listUnsubscribePost).toBe('List-Unsubscribe=One-Click')
    expect(msg.authResults).toMatchObject({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
    })
    expect(msg.returnPath).toBe('<bounces@partner.example>')
    expect(msg.importance).toBe('low')
    expect(msg.rawHeaders?.some(h => h.name === 'Set-Cookie')).toBe(false)
    expect(msg.rawHeaders?.some(h => h.name === 'From')).toBe(true)
  })
})

describe('Adversarial security & correctness regression suite', () => {
  it('P0-1: hardens RFC 8058 POST options, SSRF URL rules, and blocks heuristic bodyLink promotion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    await executeOneClickUnsubscribe(
      { https: 'https://lists.example.com/unsub', oneClick: true },
      fetchMock as unknown as typeof fetch,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lists.example.com/unsub',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: expect.any(AbortSignal),
      }),
    )

    for (const unsafe of [
      'https://user:pass@lists.example.com/unsub',
      'https://lists.example.com:8443/unsub',
      'https://8.8.8.8/unsub',
      'https://127.1/unsub',
      'https://0x7f000001/unsub',
      'https://[::1]/unsub',
      'https://printer.local/unsub',
      'https://router.lan/unsub',
      'https://svc.home.arpa/unsub',
      'https://int.corp/unsub',
      'https://app.intranet./unsub',
    ]) {
      expect(supportsOneClickUnsubscribe({ https: unsafe, oneClick: true })).toBe(
        false,
      )
    }

    // Heuristic body link from msg1 must NOT combine with List-Unsubscribe-Post on msg2
    const base = makeBaseStore()
    const accountId = base.accounts[0]!.id
    const inboxId = base.mailboxes.find(m => m.role === 'inbox')!.id
    const store: MailStore = {
      ...base,
      threads: [
        {
          id: 't_heur',
          accountId,
          mailboxId: inboxId,
          subject: 'Promo',
          participants: [{ name: 'Promo', email: 'promo@shop.example' }],
          labels: [],
          status: 'inbox',
          priority: 'none',
          summary: '',
          lastMessageAt: NOW,
          syncState: 'synced',
        },
      ],
      messages: [
        {
          id: 'm_heur_1',
          threadId: 't_heur',
          from: { name: 'Promo', email: 'promo@shop.example' },
          to: [{ name: 'Alex', email: base.accounts[0]!.email }],
          subject: 'Promo 1',
          body: 'Visit https://shop.example/unsubscribe',
          receivedAt: NOW,
          attachments: [],
          read: true,
        },
        {
          id: 'm_heur_2',
          threadId: 't_heur',
          from: { name: 'Promo', email: 'promo@shop.example' },
          to: [{ name: 'Alex', email: base.accounts[0]!.email }],
          subject: 'Promo 2',
          body: 'Hello',
          listUnsubscribe: '<mailto:unsub@shop.example>',
          listUnsubscribePost: 'List-Unsubscribe=One-Click',
          receivedAt: NOW,
          attachments: [],
          read: true,
        },
      ],
    }
    const candidates = unsubscribeCandidatesForStore(store, accountId)
    expect(candidates[0]?.targets.oneClick).toBeUndefined()
  })

  it('P0-2: prevents Authentication-Results comment/param spoofing, DKIM-Signature spoofing, and fail->pass override', () => {
    // Attacker injects dkim=pass inside comment and property value, plus fails real dkim
    const spoofed = parseAuthenticationResults(
      'mx.google.com; spf=fail (dkim=pass dmarc=pass) smtp.mailfrom="spf=pass@evil.example"; dkim=fail; dkim=pass header.d=thirdparty.example',
    )
    expect(spoofed.spf).toBe('fail')
    expect(spoofed.dkim).toBe('fail')
    expect(spoofed.dmarc).toBe('none')

    // DKIM-Signature header must NEVER yield dkim=pass
    const dkimSigSpoof = parseAuthenticationResults(
      undefined,
      undefined,
      'v=1; dkim=pass; d=evil.example; b=abc',
    )
    expect(dkimSigSpoof.dkim).toBe('neutral')
  })

  it('P0-3: strips hidden/zero-size/srcset/CSS-background beacons before sanitization and preserves legitimate images', () => {
    const html = [
      '<p>Hello</p>',
      '<img src="https://beacon.example/a.gif" width="600" height="300" style="/* comment */ width: 1px; height: 1px">',
      '<img src="https://beacon.example/b.gif" style="opacity: 0.00">',
      '<img src="https://beacon.example/c.gif" style="visibility: hidden">',
      '<img src="https://beacon.example/d.gif" width="0" height="20">',
      '<img srcset="https://r.superhuman.com/px.gif 1x">',
      '<source srcset="https://open.substack.com/o/1 1x">',
      '<div style="background-image: url(https://t.sidekickopen81.com/e1t/o/abc)">hi</div>',
      '<img src="https://cdn.example.com/photo.jpg?ref=r.superhuman.com" width="400" height="300">',
    ].join('')

    const sanitized = sanitizeMailHtml(html, {
      allowRemoteImages: true,
      stripTrackers: true,
    })
    expect(sanitized).not.toContain('beacon.example')
    expect(sanitized).not.toContain('r.superhuman.com/px.gif')
    expect(sanitized).not.toContain('open.substack.com')
    expect(sanitized).not.toContain('sidekickopen81.com')
    // Non-tracker host whose query string mentions a tracker domain is NOT falsely stripped
    expect(sanitized).toContain('cdn.example.com/photo.jpg')

    // Tracker-only mail should not prompt "Load images" when stripTrackers is true
    const trackerOnly = '<p>Hi</p><img src="https://r.superhuman.com/open.gif">'
    expect(mailHtmlHasRemoteImages(trackerOnly, { stripTrackers: true })).toBe(
      false,
    )
  })

  it('P0-4 & P0-5: blocks MIME header injection and strips rawHeaders on persist while preserving in-memory on merge', () => {
    const mime = buildMimeMessage({
      headerLines: ['From: a@example.com'],
      body: 'hi',
      attachments: [],
      importance: 'high\r\nBcc: evil@attacker.example' as 'high',
    })
    expect(mime).not.toContain('evil@attacker.example')
    expect(mime).not.toContain('Importance:')

    expect(
      formatMimeAddressList([
        { name: 'Test', email: 'a@example.com>, <evil@attacker.example' },
      ]),
    ).not.toContain(', <evil@attacker.example')

    const compacted = compactPersistedMessage({
      id: 'm_hdr',
      threadId: 't_1',
      from: { name: 'A', email: 'a@example.com' },
      to: [],
      subject: 'Hi',
      body: 'Body',
      receivedAt: NOW,
      attachments: [],
      read: true,
      rawHeaders: [{ name: 'X-Test', value: '1' }],
    })
    expect(compacted.rawHeaders).toBeUndefined()

    const sensitive = sanitizeRawHeaders([
      { name: 'X-Session-Id', value: 'abc' },
      { name: 'X-Secret-Header', value: 'xyz' },
      { name: 'X-Custom-Token', value: 'tok' },
      { name: 'X-Long', value: 'a'.repeat(2000) },
    ])
    expect(sensitive).toHaveLength(1)
    expect(sensitive[0]!.name).toBe('X-Long')
    expect(sensitive[0]!.value.length).toBeLessThanOrEqual(1025)
  })

  it('P0-6: scopes archiveThread, deleteThread, screener block, and muted archive per account without affecting passive CC', () => {
    const base = emptyMailStore()
    const store: MailStore = {
      ...base,
      accounts: [
        { id: 'acc_1', provider: 'gmail', name: 'A1', email: 'a1@example.com', syncState: 'online' },
        { id: 'acc_2', provider: 'imap', name: 'A2', email: 'a2@example.com', syncState: 'online' },
      ],
      mailboxes: [
        { id: 'mb_1_in', accountId: 'acc_1', name: 'Inbox', role: 'inbox', unreadCount: 0 },
        { id: 'mb_1_ar', accountId: 'acc_1', name: 'Archive', role: 'archive', unreadCount: 0 },
        { id: 'mb_1_tr', accountId: 'acc_1', name: 'Trash', role: 'trash', unreadCount: 0 },
        { id: 'mb_2_in', accountId: 'acc_2', name: 'Inbox', role: 'inbox', unreadCount: 0 },
        { id: 'mb_2_ar', accountId: 'acc_2', name: 'Archive', role: 'archive', unreadCount: 0 },
        { id: 'mb_2_tr', accountId: 'acc_2', name: 'Trash', role: 'trash', unreadCount: 0 },
      ],
      threads: [
        {
          id: 't_acc2_in',
          accountId: 'acc_2',
          mailboxId: 'mb_2_in',
          subject: 'Account 2 msg',
          participants: [{ name: 'Spammer', email: 'spam@bad.example' }],
          labels: [],
          status: 'inbox',
          priority: 'none',
          summary: '',
          lastMessageAt: NOW,
          syncState: 'synced',
        },
        {
          id: 't_acc2_cc',
          accountId: 'acc_2',
          mailboxId: 'mb_2_in',
          subject: 'Passive CC',
          participants: [
            { name: 'Boss', email: 'boss@good.example' },
            { name: 'Spammer', email: 'spam@bad.example' },
          ],
          labels: [],
          status: 'inbox',
          priority: 'none',
          summary: '',
          lastMessageAt: NOW,
          syncState: 'synced',
        },
      ],
      messages: [
        {
          id: 'm_acc2_spam',
          threadId: 't_acc2_in',
          from: { name: 'Spammer', email: 'spam@bad.example' },
          to: [{ name: 'A2', email: 'a2@example.com' }],
          subject: 'Account 2 msg',
          body: 'Buy now',
          receivedAt: NOW,
          attachments: [],
          read: false,
        },
        {
          id: 'm_acc2_boss',
          threadId: 't_acc2_cc',
          from: { name: 'Boss', email: 'boss@good.example' },
          to: [{ name: 'A2', email: 'a2@example.com' }],
          cc: [{ name: 'Spammer', email: 'spam@bad.example' }],
          subject: 'Passive CC',
          body: 'Important',
          receivedAt: NOW,
          attachments: [],
          read: false,
        },
      ],
    }

    // archiveThread / deleteThread route to acc_2's own archive/trash, NOT acc_1's
    expect(
      archiveThread(store, 't_acc2_in').threads.find(t => t.id === 't_acc2_in')
        ?.mailboxId,
    ).toBe('mb_2_ar')
    expect(
      deleteThread(store, 't_acc2_in').threads.find(t => t.id === 't_acc2_in')
        ?.mailboxId,
    ).toBe('mb_2_tr')

    // Screener block affects ONLY `from` thread, NOT passive CC thread, and routes to acc_2 trash
    const blocked = applyScreenerDecisionWithEffects(
      store,
      'spam@bad.example',
      'blocked',
      'Spammer',
      NOW,
      'acc_2',
    )
    expect(blocked.affectedThreadIds).toEqual(['t_acc2_in'])
    expect(
      blocked.store.threads.find(t => t.id === 't_acc2_in')?.mailboxId,
    ).toBe('mb_2_tr')
    expect(
      blocked.store.threads.find(t => t.id === 't_acc2_cc')?.mailboxId,
    ).toBe('mb_2_in')

    // Muted archive routes to acc_2 archive
    const muted = archiveMutedRepliedThreadsWithIds(
      { ...store, mutedThreadIds: ['t_acc2_in'] },
      'acc_2',
    )
    expect(muted.archivedThreadIds).toEqual(['t_acc2_in'])
    expect(
      muted.store.threads.find(t => t.id === 't_acc2_in')?.mailboxId,
    ).toBe('mb_2_ar')
  })

  it('P1-7, P1-8, P1-9, P1-10: pinned sort respects sort/limit, filter rejects blank query & prioritizes trash, phishing catches userinfo & //, migration validates settings', () => {
    const base = makeBaseStore()
    const accountId = base.accounts[0]!.id
    const oldestThread = [...base.threads].sort((a, b) =>
      a.lastMessageAt.localeCompare(b.lastMessageAt),
    )[0]!
    const newestThread = [...base.threads].sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    )[0]!
    const pinnedOldest: MailStore = {
      ...base,
      pinnedThreadIds: [oldestThread.id],
    }

    // Default sort floats pinned first; limit:1 returns true newest (not pinned oldest)
    expect(
      resolveThreadQuery(pinnedOldest, accountId, '', NOW).threads[0]?.id,
    ).toBe(oldestThread.id)
    expect(
      resolveThreadQuery(pinnedOldest, accountId, 'limit:1', NOW).threads[0]?.id,
    ).toBe(newestThread.id)
    expect(
      resolveThreadQuery(pinnedOldest, accountId, 'sort:oldest', NOW).threads[0]
        ?.id,
    ).toBe(oldestThread.id)

    // Filter validation + trash precedence + mute archiving
    const f1 = addMailFilter(base, {
      name: 'Rule',
      query: `subject:"${newestThread.subject}"`,
      actions: { mute: true },
    })
    expect(
      updateMailFilter(f1.store, f1.rule.id, { query: '   ' }).filters?.[0]
        ?.query,
    ).toBe(`subject:"${newestThread.subject}"`)
    const mutedRan = runMailFilters(f1.store, accountId, {
      includeAlreadyRun: true,
      now: new Date(NOW),
    })
    expect(
      mutedRan.store.threads.find(t => t.id === newestThread.id)?.status,
    ).toBe('archived')
    expect(mutedRan.mutations).toContainEqual({
      kind: 'archive',
      threadId: newestThread.id,
    })

    // Phishing link warnings: userinfo & protocol-relative & 2-part TLD & google bounce vs evil@google.com
    const phishReport = inspectMailPrivacy({
      id: 'p1',
      threadId: 't1',
      from: { name: 'Co', email: 'info@company.co.il' },
      returnPath: '<spoof@google.com>',
      to: [],
      subject: 'Test',
      body: '',
      bodyHtml:
        '<a href="https://company.co.il@evil.example/login">Login</a> ' +
        '<a href="//192.0.2.5/x">Go</a> ' +
        '<a href="https://docs.company.co.il/a">https://company.co.il/a</a>',
      receivedAt: NOW,
      attachments: [],
      read: false,
    })
    expect(phishReport.senderMismatch).toEqual({
      fromDomain: 'company.co.il',
      replyOrReturnDomain: 'google.com',
    })
    expect(phishReport.linkWarnings.map(w => w.reason)).toEqual([
      'domain-mismatch',
      'ip-literal',
    ])

    // Migration validates settings & message importance & normalizes screener keys
    const migrated = migratePersistedMailStore({
      ...emptyMailStore(),
      settings: {
        ...emptyMailStore().settings,
        screenerEnabled: 'yes' as unknown as boolean,
        recentSearches: ['ok', 42 as unknown as string],
        replySignatureIdByAccount: {
          acc_1: 'sig_1',
          bad: 99 as unknown as string,
        },
      },
      screenerDecisions: {
        'UPPER@Example.COM': {
          email: 'UPPER@Example.COM',
          destination: 'feed',
          decidedAt: NOW,
        },
      },
      messages: [
        {
          id: 'm_imp',
          threadId: 't1',
          from: { name: 'A', email: 'a@example.com' },
          to: [],
          subject: 'Hi',
          body: 'Hi',
          receivedAt: NOW,
          attachments: [],
          read: true,
          importance: 'bogus' as 'high',
        },
      ],
    })
    expect(migrated.settings.screenerEnabled).toBeUndefined()
    expect(migrated.settings.recentSearches).toEqual(['ok'])
    expect(migrated.settings.replySignatureIdByAccount).toEqual({
      acc_1: 'sig_1',
    })
    expect(migrated.screenerDecisions?.['upper@example.com']?.email).toBe(
      'upper@example.com',
    )
    expect(migrated.messages[0]?.importance).toBeUndefined()
  })

  it('P2-12..18: timePresets clamping/reject, followUpRadar reschedule, mailExport safety, snippets defaults & HTML escape, mailListFilters', () => {
    // Jan 31 -> Feb 28 (non-leap year 2026)
    const jan31 = new Date(2026, 0, 31, 10, 0, 0)
    const nextMonth = buildSnoozePresets(jan31).find(p => p.id === 'next_month')!
    const parsedNextMonth = new Date(nextMonth.iso)
    expect(parsedNextMonth.getMonth()).toBe(1) // February
    expect(parsedNextMonth.getDate()).toBe(28)

    // Reject incidental prose match "may be later"
    expect(parseNaturalDateTime('may be later', jan31)).toBeNull()

    // followUpRadar invalid remindAt ignored, reschedule refreshes createdAt, nudge skips own email
    const base = makeBaseStore()
    expect(
      scheduleFollowUpReminder(base, {
        threadId: base.threads[0]!.id,
        accountId: base.accounts[0]!.id,
        remindAt: 'not-a-date',
      }),
    ).toBe(base)
    const firstSched = scheduleFollowUpReminder(
      base,
      {
        threadId: base.threads[0]!.id,
        accountId: base.accounts[0]!.id,
        remindAt: '2026-06-23T09:00:00.000Z',
      },
      '2026-06-20T09:00:00.000Z',
    )
    const resched = scheduleFollowUpReminder(
      firstSched,
      {
        threadId: base.threads[0]!.id,
        accountId: base.accounts[0]!.id,
        remindAt: '2026-06-25T09:00:00.000Z',
      },
      '2026-06-22T09:00:00.000Z',
    )
    expect(resched.followUpReminders?.[0]?.createdAt).toBe(
      '2026-06-22T09:00:00.000Z',
    )

    // mailExport short "true" attachment encoded cleanly as UTF-8 base64 & Windows reserved filename guarded
    const eml = buildEmlFromMessage({
      id: 'm_exp',
      threadId: 't_1',
      messageIdHeader: '<unclosed@example.com',
      from: { name: 'A', email: 'a@example.com' },
      to: [{ name: 'B', email: 'b@example.com' }],
      subject: 'Data',
      body: 'See attached',
      receivedAt: NOW,
      attachments: [
        {
          id: 'att_json',
          name: 'flag.json',
          mimeType: 'application/json',
          sizeLabel: '4 B',
          content: 'true',
        },
      ],
      read: true,
    })
    expect(eml).toContain('Message-ID: <unclosed@example.com>\r\n')
    expect(eml).toContain(btoa('true'))
    expect(safeExportFilename('CON', 'eml')).toBe('mail-CON.eml')
    expect(safeExportFilename(`${'a'.repeat(79)}.txt`, 'md')).toMatch(
      /[^.]\.md$/,
    )

    // mailSnippets: deleting a default snippet when store.snippets is undefined keeps the other 3; HTML escaping works
    const noSnippetsStore: MailStore = { ...emptyMailStore(), snippets: undefined }
    const afterDelete = deleteSnippet(noSnippetsStore, DEFAULT_SNIPPETS[0]!.id)
    expect(afterDelete.snippets).toHaveLength(3)
    const htmlRendered = renderSnippet(
      {
        id: 's_html',
        title: 'HTML',
        shortcut: 'h',
        body: 'Hi {{first_name}}',
        bodyHtml: '<p>Hi {{first_name}} about {{subject}}</p>',
        updatedAt: NOW,
      },
      { recipientName: '<img src=x>', subject: 'A & B' },
    )
    expect(htmlRendered.bodyHtml).toBe(
      '<p>Hi &lt;img about A &amp; B</p>',
    )

    // Reject duplicate shortcut and blank title
    const dupCheck = upsertSnippet(afterDelete, {
      title: 'Duplicate',
      shortcut: DEFAULT_SNIPPETS[1]!.shortcut,
      body: 'Body',
    })
    expect(dupCheck).toBe(afterDelete)
    expect(
      upsertSnippet(afterDelete, { title: '   ', shortcut: 'new', body: 'B' }),
    ).toBe(afterDelete)

    // mailListFilters: pre-indexed attachments and followUpReminders alignment
    const withReminder = scheduleFollowUpReminder(
      base,
      {
        threadId: base.threads[0]!.id,
        accountId: base.accounts[0]!.id,
        remindAt: '2020-01-01T00:00:00.000Z',
      },
      '2020-01-01T00:00:00.000Z',
    )
    const filteredFollowups = filterThreadsByListFilter(
      withReminder.threads,
      'followups',
      new Set(),
      withReminder,
    )
    expect(filteredFollowups.some(t => t.id === base.threads[0]!.id)).toBe(true)
    const followupsFilter = MAIL_LIST_FILTERS.find(f => f.id === 'followups')!
    expect(
      followupsFilter.count(withReminder, base.accounts[0]!.id),
    ).toBeGreaterThanOrEqual(1)
  })
})
