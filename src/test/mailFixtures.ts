/** Frozen, synthetic mailbox fixtures. Never imported by the running app. */
import { parseCalendarInvite } from '../lib/mailCalendarInvite'
import { createFollowUpTask, createTaskFromThread, dateFromInput, DEFAULT_FOLLOW_UP_SETTINGS, DEFAULT_MAIL_FETCH_INTERVAL_MINUTES, DEFAULT_MAIL_FETCH_WINDOW, type DateInput } from '../lib/mailModel'
import type { MailStore, MailThread } from '../types'

/**
 * A tiny but fully valid one-page PDF (built by hand, 689 bytes) so the demo
 * mailbox exercises the real PDF path: inline preview and the detached
 * viewer window both need genuine bytes, not a placeholder.
 */
const demoDesignBriefPdf =
  'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2Jq' +
  'CjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2Jq' +
  'CjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIg' +
  'NzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAw' +
  'IFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNl' +
  'Rm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTQ0ID4+CnN0cmVh' +
  'bQpCVCAvRjEgMjQgVGYgNzIgNzAwIFRkIChQdXJlTWFpbCBkZW1vOiBkZXNpZ24gYnJpZWYpIFRq' +
  'IEVUCkJUIC9GMSAxMiBUZiA3MiA2NjAgVGQgKFRoaXMgUERGIGF0dGFjaG1lbnQgb3BlbnMgaW4g' +
  'YSBkZXRhY2hlZCB2aWV3ZXIgd2luZG93LikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAg' +
  'NgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAw' +
  'MCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAw' +
  'MDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjUwNgol' +
  'JUVPRgo='

export function demoMailStore(): MailStore {
  const planningInvite = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:pure-demo-planning@example.com',
    'SEQUENCE:0',
    'SUMMARY:Planning sync with Kim',
    'DESCRIPTION:Review launch planning and blockers.',
    'LOCATION:Zoom',
    'DTSTART:20260625T170000Z',
    'DTEND:20260625T173000Z',
    'ORGANIZER;CN=Kim:mailto:kim@example.com',
    'ATTENDEE;CN=User;PARTSTAT=NEEDS-ACTION:mailto:alex@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n')
  const planningUpdateInvite = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:pure-demo-planning@example.com',
    'SEQUENCE:1',
    'SUMMARY:Planning sync with Kim',
    'DESCRIPTION:Moved 30 minutes later.',
    'LOCATION:Zoom',
    'DTSTART:20260625T173000Z',
    'DTEND:20260625T180000Z',
    'ORGANIZER;CN=Kim:mailto:kim@example.com',
    'ATTENDEE;CN=User;PARTSTAT=NEEDS-ACTION:mailto:alex@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n')
  const cancelledInvite = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'METHOD:CANCEL',
    'BEGIN:VEVENT',
    'UID:pure-demo-cancelled@example.com',
    'SEQUENCE:2',
    'SUMMARY:Cancelled vendor check-in',
    'STATUS:CANCELLED',
    'DTSTART:20260626T160000Z',
    'DTEND:20260626T163000Z',
    'ORGANIZER;CN=Roger:mailto:roger@example.com',
    'ATTENDEE;CN=User;PARTSTAT=NEEDS-ACTION:mailto:alex@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n')
  const account = {
    id: 'acct_demo',
    provider: 'demo' as const,
    name: 'User',
    email: 'alex@example.com',
    syncState: 'online' as const,
  }
  const inbox = {
    id: 'mailbox_inbox',
    accountId: account.id,
    name: 'Inbox',
    role: 'inbox' as const,
    unreadCount: 3,
  }
  const sent = {
    id: 'mailbox_sent',
    accountId: account.id,
    name: 'Sent',
    role: 'sent' as const,
    unreadCount: 0,
  }
  const archive = {
    id: 'mailbox_archive',
    accountId: account.id,
    name: 'Archive',
    role: 'archive' as const,
    unreadCount: 0,
  }
  const trash = {
    id: 'mailbox_trash',
    accountId: account.id,
    name: 'Trash',
    role: 'trash' as const,
    unreadCount: 0,
  }
  const draftsMailbox = {
    id: 'mailbox_drafts',
    accountId: account.id,
    name: 'Drafts',
    role: 'drafts' as const,
    unreadCount: 0,
  }
  const threads: MailThread[] = [
    {
      id: 'thread_launch',
      accountId: account.id,
      mailboxId: inbox.id,
      subject: 'Launch copy and rollout notes',
      participants: [{ name: 'Mira', email: 'mira@example.com' }],
      labels: ['Launch', 'Needs reply'],
      status: 'inbox',
      priority: 'high',
      summary:
        'Mira needs confirmation on the public launch copy and rollout timing.',
      lastMessageAt: '2026-06-20T16:12:00.000Z',
      syncState: 'synced',
    },
    {
      id: 'thread_contract',
      accountId: account.id,
      mailboxId: inbox.id,
      subject: 'Contract renewal follow-up',
      participants: [{ name: 'Roger', email: 'roger@example.com' }],
      labels: ['Legal', 'Waiting'],
      status: 'waiting',
      priority: 'medium',
      summary: 'Roger asked for a clean summary before signing the renewal.',
      lastMessageAt: '2026-06-20T14:40:00.000Z',
      syncState: 'synced',
    },
    {
      id: 'thread_design',
      accountId: account.id,
      mailboxId: inbox.id,
      subject: 'Design review attachments',
      participants: [{ name: 'Nadia', email: 'nadia@example.com' }],
      labels: ['Review'],
      status: 'inbox',
      priority: 'low',
      summary:
        'Nadia sent revised screenshots and asked for a lightweight review.',
      lastMessageAt: '2026-06-19T22:05:00.000Z',
      syncState: 'synced',
    },
    {
      id: 'thread_calendar_invite',
      accountId: account.id,
      mailboxId: inbox.id,
      subject: 'Invitation: Planning sync with Kim',
      participants: [{ name: 'Kim', email: 'kim@example.com' }],
      labels: ['Calendar'],
      status: 'inbox',
      priority: 'medium',
      summary: 'Kim invited you to a planning sync on Thursday.',
      lastMessageAt: '2026-06-20T17:10:00.000Z',
      syncState: 'synced',
    },
    {
      id: 'thread_calendar_update',
      accountId: account.id,
      mailboxId: inbox.id,
      subject: 'Updated invitation: Planning sync with Kim',
      participants: [{ name: 'Kim', email: 'kim@example.com' }],
      labels: ['Calendar'],
      status: 'inbox',
      priority: 'medium',
      summary: 'Kim moved the planning sync 30 minutes later.',
      lastMessageAt: '2026-06-20T17:20:00.000Z',
      syncState: 'synced',
    },
    {
      id: 'thread_calendar_cancel',
      accountId: account.id,
      mailboxId: inbox.id,
      subject: 'Cancelled: Vendor check-in',
      participants: [{ name: 'Roger', email: 'roger@example.com' }],
      labels: ['Calendar'],
      status: 'inbox',
      priority: 'low',
      summary: 'Roger cancelled the vendor check-in.',
      lastMessageAt: '2026-06-20T17:35:00.000Z',
      syncState: 'synced',
    },
    {
      id: 'thread_sent_mira_launch',
      accountId: account.id,
      mailboxId: sent.id,
      subject: 'Re: Launch planning',
      participants: [{ name: 'Mira', email: 'mira@example.com' }],
      labels: ['Sent'],
      status: 'done',
      priority: 'none',
      summary: 'Prior sent reply to Mira used as local voice evidence.',
      lastMessageAt: '2026-06-18T18:10:00.000Z',
      syncState: 'synced',
    },
  ]
  return {
    accounts: [account],
    mailboxes: [inbox, sent, draftsMailbox, archive, trash],
    threads,
    taskLists: [
      { id: 'tasklist_mail', name: 'Mail follow-ups', source: 'mail' },
      { id: 'tasklist_personal', name: 'Personal tasks', source: 'personal' },
    ],
    labels: [
      { id: 'label_launch', name: 'Launch', color: '#4d9aa6' },
      { id: 'label_waiting', name: 'Waiting', color: '#c9952d' },
      { id: 'label_review', name: 'Review', color: '#7e8aa2' },
    ],
    messages: [
      {
        id: 'msg_launch_1',
        threadId: 'thread_launch',
        from: { name: 'Mira', email: 'mira@example.com' },
        to: [{ name: 'User', email: account.email }],
        subject: threads[0].subject,
        body: 'Can you approve the launch copy today? The team also needs a short internal note for rollout timing.',
        receivedAt: threads[0].lastMessageAt,
        attachments: [
          {
            id: 'att_launch',
            name: 'launch-copy.md',
            mimeType: 'text/markdown',
            sizeLabel: '12 KB',
          },
        ],
        read: false,
      },
      {
        id: 'msg_contract_1',
        threadId: 'thread_contract',
        from: { name: 'Roger', email: 'roger@example.com' },
        to: [{ name: 'User', email: account.email }],
        subject: threads[1].subject,
        body: 'Please send the risk summary before I sign. A concise answer is enough.',
        receivedAt: threads[1].lastMessageAt,
        attachments: [],
        read: true,
      },
      {
        id: 'msg_design_1',
        threadId: 'thread_design',
        from: { name: 'Nadia', email: 'nadia@example.com' },
        to: [{ name: 'User', email: account.email }],
        subject: threads[2].subject,
        body: 'The updated design pass is attached. Could you turn any issues into tasks?',
        receivedAt: threads[2].lastMessageAt,
        attachments: [
          {
            id: 'att_design',
            name: 'screens.zip',
            mimeType: 'application/zip',
            sizeLabel: '3.4 MB',
          },
          {
            id: 'att_design_brief',
            name: 'design-brief.pdf',
            mimeType: 'application/pdf',
            sizeLabel: '1 KB',
            content: demoDesignBriefPdf,
          },
        ],
        read: false,
      },
      {
        id: 'msg_calendar_invite_1',
        threadId: 'thread_calendar_invite',
        from: { name: 'Kim', email: 'kim@example.com' },
        to: [{ name: 'User', email: account.email }],
        subject: threads[3].subject,
        body: 'Please join the planning sync.',
        receivedAt: threads[3].lastMessageAt,
        attachments: [
          {
            id: 'att_invite_1',
            name: 'invite.ics',
            mimeType: 'text/calendar',
            sizeLabel: '2 KB',
            content: planningInvite,
          },
        ],
        calendarInvite: parseCalendarInvite(planningInvite) ?? undefined,
        read: false,
      },
      {
        id: 'msg_calendar_update_1',
        threadId: 'thread_calendar_update',
        from: { name: 'Kim', email: 'kim@example.com' },
        to: [{ name: 'User', email: account.email }],
        subject: threads[4].subject,
        body: 'Moving this 30 minutes later.',
        receivedAt: threads[4].lastMessageAt,
        attachments: [
          {
            id: 'att_invite_update',
            name: 'invite-update.ics',
            mimeType: 'text/calendar',
            sizeLabel: '2 KB',
            content: planningUpdateInvite,
          },
        ],
        calendarInvite: parseCalendarInvite(planningUpdateInvite) ?? undefined,
        read: false,
      },
      {
        id: 'msg_calendar_cancel_1',
        threadId: 'thread_calendar_cancel',
        from: { name: 'Roger', email: 'roger@example.com' },
        to: [{ name: 'User', email: account.email }],
        subject: threads[5].subject,
        body: 'Cancelling this one.',
        receivedAt: threads[5].lastMessageAt,
        attachments: [
          {
            id: 'att_invite_cancel',
            name: 'cancel.ics',
            mimeType: 'text/calendar',
            sizeLabel: '2 KB',
            content: cancelledInvite,
          },
        ],
        calendarInvite: parseCalendarInvite(cancelledInvite) ?? undefined,
        read: false,
      },
      {
        id: 'msg_sent_mira_launch_1',
        threadId: 'thread_sent_mira_launch',
        from: { name: 'User', email: account.email },
        to: [{ name: 'Mira', email: 'mira@example.com' }],
        subject: 'Re: Launch planning',
        body: [
          'Hi Mira,',
          '',
          'Thanks for pushing this forward. I’ll review the copy and send a short rollout note once I’ve checked the timing.',
          '',
          'Best,',
          'User',
        ].join('\n'),
        receivedAt: '2026-06-18T18:10:00.000Z',
        attachments: [],
        read: true,
      },
    ],
    tasks: [
      {
        ...createFollowUpTask(
          threads[1],
          '2026-06-24',
          '2026-06-20T15:00:00.000Z',
        ),
        syncState: 'synced',
      },
      {
        ...createTaskFromThread(
          threads[0],
          'Draft launch reply',
          '2026-06-20T16:20:00.000Z',
        ),
        syncState: 'synced',
      },
    ],
    drafts: [
      {
        id: 'draft_launch',
        threadId: 'thread_launch',
        to: [{ name: 'Mira', email: 'mira@example.com' }],
        subject: 'Re: Launch copy and rollout notes',
        body: 'Thanks. I am reviewing the launch copy now and will send the internal note after the final pass.',
        attachments: [],
        updatedAt: '2026-06-20T16:25:00.000Z',
        syncState: 'synced',
        source: 'auto',
        confidence: 'medium',
        provenance: [
          `Thread: ${threads[0].subject}`,
          `Summary: ${threads[0].summary}`,
          'Latest message from Mira: Can you approve the launch copy today? The team also needs a short internal note for rollout timing.',
          'Voice profile: 1 local sent message to Mira',
        ],
        voice: {
          engine: 'local-retrieval',
          recipientEmail: 'mira@example.com',
          recipientName: 'Mira',
          sampleCount: 1,
          confidence: 'medium',
          greeting: 'Hi Mira,',
          signoff: 'Best,\nUser',
          signals: [
            'opens with thanks',
            'uses direct next steps',
            'offers concrete follow-through',
          ],
          updatedAt: '2026-06-20T16:25:00.000Z',
        },
      },
    ],
    settings: {
      classificationMode: 'local',
      fetchWindow: DEFAULT_MAIL_FETCH_WINDOW,
      autoFetchEnabled: true,
      fetchIntervalMinutes: DEFAULT_MAIL_FETCH_INTERVAL_MINUTES,
      quotedHistoryOpenByDefault: false,
      remoteImages: { policy: 'ask', trustedSenders: [] },
      autoDraftVoiceEngine: 'local-retrieval',
      signature: 'Best,\nUser',
      followUp: { ...DEFAULT_FOLLOW_UP_SETTINGS },
      connectionProfiles: [
        {
          id: 'google-oauth',
          provider: 'google',
          label: 'Google Gmail OAuth',
          mode: 'oauth',
          status: 'ready',
          description: 'Uses the shared Google OAuth client and Gmail scopes.',
        },
        {
          id: 'gmail-app-password',
          provider: 'gmail-app-password',
          label: 'Gmail app password',
          mode: 'app-password',
          status: 'planned',
          description:
            'Fallback Gmail connection for accounts that cannot use OAuth.',
        },
        {
          id: 'imap-smtp',
          provider: 'imap-smtp',
          label: 'IMAP/SMTP',
          mode: 'manual',
          status: 'ready',
          description:
            'Manual provider profile for Proton Bridge and any custom IMAP/SMTP mail server, over the shell socket transport.',
        },
      ],
    },
  }
}

export function demoMailStoreForNow(now: DateInput = new Date()): MailStore {
  const seeded = demoMailStore()
  const latest = seeded.threads.reduce(
    (max, thread) => Math.max(max, Date.parse(thread.lastMessageAt)),
    0,
  )
  if (!Number.isFinite(latest) || latest <= 0) return seeded
  // Land the newest message an hour ago so it reads as "just arrived"
  // without being in the future.
  const shift = dateFromInput(now).getTime() - latest - 60 * 60 * 1000
  const shiftIso = (iso: string): string => {
    const ms = Date.parse(iso)
    return Number.isFinite(ms) ? new Date(ms + shift).toISOString() : iso
  }
  return {
    ...seeded,
    threads: seeded.threads.map(thread => ({
      ...thread,
      lastMessageAt: shiftIso(thread.lastMessageAt),
      ...(thread.snoozedUntil
        ? { snoozedUntil: shiftIso(thread.snoozedUntil) }
        : {}),
    })),
    messages: seeded.messages.map(message => ({
      ...message,
      receivedAt: shiftIso(message.receivedAt),
    })),
    drafts: seeded.drafts.map(draft => ({
      ...draft,
      updatedAt: shiftIso(draft.updatedAt),
    })),
    tasks: seeded.tasks.map(task => ({
      ...task,
      createdAt: shiftIso(task.createdAt),
      updatedAt: shiftIso(task.updatedAt),
    })),
  }
}

