import { describe, expect, it } from 'vitest'
import {
  appendDraftAttachments,
  archiveThread,
  attachDraftToTask,
  blockRemoteImagesInMailHtml,
  latestInboundMessage,
  parsePersistedMailStore,
  createComposedMessageDraft,
  isFiledDraftThreadId,
  isProviderThreadId,
  pruneOrphanedDraftThreads,
  persistableMailStore,
  reapplyLocalMailChangesSinceSnapshot,
  replyAllRecipientsForMessage,
  replyRecipientsForMessage,
  buildLocalQaDraftBody,
  calendarInviteForMessage,
  classifyDraftability,
  cleanMailMessageText,
  completeQaDraftRequest,
  createAutoDraftForThread,
  createCalendarDraftIntentFromThread,
  createCalendarInviteIntentFromMessage,
  createFollowUpTask,
  createForwardDraft,
  createReplyDraft,
  createTaskFromMessage,
  createTaskFromThread,
  createVoiceProfileForDraft,
  deleteThread,
  deleteMailTask,
  deriveReplyIntentForThread,
  demoMailStore,
  emptyMailStore,
  enqueueQaDraftRequest,
  isGeneratedDraft,
  isReadyQaDraft,
  ensureAutoDraftForThread,
  followUpSettingsForStore,
  getThreadTasks,
  inferRecipientVoiceProfile,
  labelThread,
  mailSyncSummary,
  mergeMailDrafts,
  widenDraftToReplyAll,
  mergeMailProviderSyncResult,
  markThreadRead,
  moveThread,
  pendingQaDraftsForStore,
  qaDraftsForStore,
  regenerateGeneratedDraft,
  replyQuestionsForThread,
  failQaDraftRequest,
  readerMailBody,
  recoverMailDraftSync,
  recoverMailTaskSync,
  recoverMailThreadSync,
  resolveMailTaskSourceTarget,
  removeDraftAttachment,
  removeProviderAccountData,
  retryMailSyncFailures,
  selectInviteMirrorCandidates,
  withMirroredInviteKeys,
  searchMailAndTasks,
  sendDraft,
  isUnconfirmedGmailSend,
  snoozeThread,
  threadContextSummaryForThread,
  threadNeedsReply,
  updateDraftAttachments,
  updateDraftBody,
  updateDraftFields,
  updateMailTask,
  updateTaskStatus,
} from './mailModel'
import { parseCalendarInvite } from './mailCalendarInvite'
import type { MailMessage, MailStore } from '../types'

const TEST_LLM_DRAFT_BODY = 'I’m checking this now.'

/** Ready generated drafts, newest first (test-local view over live filters). */
function generatedDraftsForStore(store: MailStore) {
  return store.drafts
    .filter(draft => isGeneratedDraft(draft) && isReadyQaDraft(draft))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

describe('PureMail model', () => {
  it('creates thread-linked tasks with source context', () => {
    const store = demoMailStore()
    const task = createTaskFromThread(
      store.threads[0],
      'Confirm copy',
      '2026-06-20T10:00:00.000Z',
    )
    expect(task.taskListId).toBe('tasklist_mail')
    expect(task.source.type).toBe('email')
    expect(task.source.accountId).toBe('acct_demo')
    expect(task.source.threadId).toBe('thread_launch')
    expect(task.source.snippet).toContain('Mira')
    expect(task.source.label).toBe('Launch copy and rollout notes')
  })

  it('creates message-linked tasks with sender and message source context', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message = store.messages.find(item => item.id === 'msg_launch_1')!
    const task = createTaskFromMessage(
      thread,
      message,
      'Answer Mira',
      '2026-06-20T10:00:00.000Z',
    )

    expect(task.title).toBe('Answer Mira')
    expect(task.source.threadId).toBe('thread_launch')
    expect(task.source.messageId).toBe('msg_launch_1')
    expect(task.source.label).toContain('Mira')
    expect(task.source.snippet).toContain('approve the launch copy')
    expect(task.notes).toContain('Mira')
  })

  it('resolves task source links to the current thread and message when possible', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message = store.messages.find(item => item.id === 'msg_launch_1')!
    const task = createTaskFromMessage(thread, message)

    expect(resolveMailTaskSourceTarget(store, task)).toMatchObject({
      thread: { id: thread.id },
      message: { id: message.id },
    })
  })

  it('falls back to opening the source thread when a task message link is stale', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message = store.messages.find(item => item.id === 'msg_launch_1')!
    const task = createTaskFromMessage(thread, message)
    const withoutMessage = {
      ...store,
      messages: store.messages.filter(item => item.id !== message.id),
    }

    expect(resolveMailTaskSourceTarget(withoutMessage, task)).toMatchObject({
      thread: { id: thread.id },
      message: null,
    })
  })

  it('does not resolve task source links when the source thread is gone', () => {
    const store = demoMailStore()
    const task = store.tasks[0]
    const withoutThread = {
      ...store,
      threads: store.threads.filter(
        thread => thread.id !== task.source.threadId,
      ),
    }

    expect(resolveMailTaskSourceTarget(withoutThread, task)).toBeNull()
  })

  it('creates editable reply drafts from the latest source message', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message = store.messages.find(item => item.id === 'msg_launch_1')!
    const draft = createReplyDraft(
      thread,
      message,
      'Regards,\nAdam',
      '2026-06-20T10:00:00.000Z',
    )

    expect(draft.id).toBe('draft_reply_thread_launch_20260620100000000')
    expect(draft.threadId).toBe(thread.id)
    expect(draft.to).toEqual([message.from])
    expect(draft.subject).toBe(`Re: ${thread.subject}`)
    expect(draft.body).toContain('Regards')
    expect(draft.syncState).toBe('pending')
  })

  it('computes plain-reply vs reply-all recipients (Gmail semantics)', () => {
    const message = {
      id: 'm1',
      threadId: 't1',
      from: { name: 'Mira', email: 'mira@example.com' },
      to: [
        { name: 'User', email: 'alex@example.com' },
        { name: 'Kim', email: 'kim@example.com' },
      ],
      cc: [{ name: 'Lee', email: 'lee@example.com' }],
      subject: 's',
      body: 'b',
      receivedAt: '2026-06-20T10:00:00.000Z',
      attachments: [],
      read: true,
    }
    const plain = replyRecipientsForMessage(message, 'alex@example.com')
    expect(plain.to).toEqual([message.from])
    expect(plain.cc).toEqual([])

    const all = replyAllRecipientsForMessage(message, 'alex@example.com')
    expect(all.to).toEqual([message.from])
    expect(all.cc.map(contact => contact.email)).toEqual([
      'kim@example.com',
      'lee@example.com',
    ])
  })

  it('replying to your own sent message targets its original recipients', () => {
    const own = {
      id: 'm2',
      threadId: 't1',
      from: { name: 'User', email: 'alex@example.com' },
      to: [{ name: 'Kim', email: 'kim@example.com' }],
      subject: 's',
      body: 'b',
      receivedAt: '2026-06-20T10:00:00.000Z',
      attachments: [],
      read: true,
    }
    const plain = replyRecipientsForMessage(own, 'alex@example.com')
    expect(plain.to.map(contact => contact.email)).toEqual([
      'kim@example.com',
    ])
  })

  it('createReplyDraft honours the reply mode', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message = store.messages.find(item => item.id === 'msg_launch_1')!
    const plain = createReplyDraft(
      thread,
      message,
      '',
      '2026-06-20T10:00:00.000Z',
      'alex@example.com',
      'reply',
    )
    expect(plain.cc).toEqual([])
    const all = createReplyDraft(
      thread,
      message,
      '',
      '2026-06-20T10:00:00.000Z',
      'alex@example.com',
      'reply_all',
    )
    expect(all.to).toEqual([message.from])
  })

  it('createReplyDraft seeds an initial body above the signature', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message = store.messages.find(item => item.id === 'msg_launch_1')!
    const seeded = createReplyDraft(
      thread,
      message,
      'Best,\nAdam',
      '2026-06-20T10:00:00.000Z',
      'alex@example.com',
      'reply',
      'Here is the summary you asked for.',
    )
    expect(seeded.body).toBe(
      'Here is the summary you asked for.\n\nBest,\nAdam',
    )
    // And the no-body call is byte-for-byte what it was before the
    // parameter existed: signature only, preceded by the blank lines.
    const blank = createReplyDraft(
      thread,
      message,
      'Best,\nAdam',
      '2026-06-20T10:00:00.000Z',
      'alex@example.com',
      'reply',
    )
    expect(blank.body).toBe('\n\nBest,\nAdam')
  })

  it('creates forward drafts with source headers and no recipients', () => {
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_design')!
    const messages = store.messages.filter(item => item.threadId === thread.id)
    const draft = createForwardDraft(
      thread,
      messages,
      'Thanks,\nAdam',
      '2026-06-20T10:00:00.000Z',
    )

    expect(draft.id).toBe('draft_forward_thread_design_20260620100000000')
    expect(draft.threadId).toBe(thread.id)
    expect(draft.to).toEqual([])
    expect(draft.subject).toBe(`Fwd: ${thread.subject}`)
    expect(draft.body).toContain('Thanks,\nAdam')
    expect(draft.body).toContain('---------- Forwarded message ---------')
    expect(draft.body).toContain('From: Nadia')
    expect(draft.body).toContain('Subject: Design review attachments')
    expect(draft.body).toContain('updated design pass is attached')
    expect(draft.attachments.map(attachment => attachment.name)).toContain(
      'screens.zip',
    )
    expect(draft.provenance?.join(' ')).toContain('forward draft')
    expect(draft.syncState).toBe('pending')
  })

  it('creates calendar draft intents from email threads', () => {
    const store = demoMailStore()
    const thread = store.threads[0]
    const intent = createCalendarDraftIntentFromThread(
      thread,
      store.messages,
      '2026-06-20T10:00:00.000Z',
    )
    expect(intent.resourceId).toBe('draft-event:mail:acct_demo:thread_launch')
    expect(intent.title).toBe(thread.subject)
    expect(intent.source.threadId).toBe(thread.id)
    expect(intent.description).toContain(thread.summary)
    expect(intent.linkedItems).toEqual([
      { type: 'email', id: thread.id, label: thread.subject },
    ])
    expect(intent.attendees[0]?.email).toBe('mira@example.com')
    expect(intent.startsAt).toBeUndefined()
  })

  it('parses calendar invites from ICS attachments', () => {
    const invite = parseCalendarInvite(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:invite-test@example.com',
        'SEQUENCE:2',
        'SUMMARY:Review meeting',
        'DESCRIPTION:Talk through the plan.',
        'LOCATION:Zoom',
        'DTSTART:20260625T170000Z',
        'DTEND:20260625T173000Z',
        'ORGANIZER;CN=Kim:mailto:kim@example.com',
        'ATTENDEE;CN=Alex Example;PARTSTAT=NEEDS-ACTION:mailto:alex@example.com',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
    )

    expect(invite?.uid).toBe('invite-test@example.com')
    expect(invite?.method).toBe('REQUEST')
    expect(invite?.sequence).toBe(2)
    expect(invite?.title).toBe('Review meeting')
    expect(invite?.organizer?.email).toBe('kim@example.com')
    expect(invite?.attendees[0]?.response).toBe('needsAction')
  })

  it('creates calendar invite intents from detected email invites', () => {
    const store = demoMailStore()
    const message = store.messages.find(
      item => item.id === 'msg_calendar_invite_1',
    )!
    const thread = store.threads.find(item => item.id === message.threadId)!
    const invite = calendarInviteForMessage(message)
    const intent = createCalendarInviteIntentFromMessage(
      thread,
      message,
      'accepted',
      '2026-06-20T10:00:00.000Z',
    )

    expect(invite?.uid).toBe('pure-demo-planning@example.com')
    expect(intent?.resourceId).toBe(
      'calendar-invite:mail:acct_demo:msg_calendar_invite_1:pure-demo-planning%40example.com',
    )
    expect(intent?.response).toBe('accepted')
    expect(intent?.source.messageId).toBe(message.id)
    expect(intent?.title).toBe('Planning sync with Kim')
  })

  it('detects body-only Zoom invitations and opens them as calendar invites', () => {
    const message: MailMessage = {
      id: 'msg_inline_zoom_invite',
      threadId: 'thread_inline_zoom_invite',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Example planning call tomorrow',
      body: [
        'This synthetic event is at 2pm UK time.',
        '',
        'Cheers and speak then.',
        '',
        'Morgan',
        '',
        'Morgan Example is inviting you to a scheduled Zoom meeting.',
        'Join Zoom Meeting',
        'https://example.invalid/zoom.us/j/00000000000?pwd=example',
        '',
        'Meeting ID: 000 0000 0000',
        'Passcode: EXAMPLE',
      ].join('\n'),
      receivedAt: '2026-06-24T12:54:00.000Z',
      attachments: [],
      read: false,
    }
    const thread = {
      ...demoMailStore().threads[0],
      accountId: 'acct_example',
      id: 'thread_inline_zoom_invite',
      subject: message.subject,
      summary: 'Morgan sent Zoom details for tomorrow.',
    }

    const invite = calendarInviteForMessage(message)
    const intent = createCalendarInviteIntentFromMessage(
      thread,
      message,
      'accepted',
      '2026-06-24T13:00:00.000Z',
    )

    expect(invite).toMatchObject({
      uid: 'inline-msg_inline_zoom_invite',
      title: 'Example planning call tomorrow',
      location: 'https://example.invalid/zoom.us/j/00000000000?pwd=example',
      startsAt: '2026-06-25T13:00:00.000Z',
      endsAt: '2026-06-25T14:00:00.000Z',
      timeZone: 'Europe/London',
    })
    expect(invite?.description).toContain('Meeting ID: 000 0000 0000')
    expect(invite?.rawSource.startsWith('inline:')).toBe(true)
    expect(intent?.resourceId).toBe(
      'calendar-invite:mail:acct_example:msg_inline_zoom_invite:inline-msg_inline_zoom_invite',
    )
    expect(intent?.response).toBe('accepted')
  })

  it('selects tasks for the active thread', () => {
    const store = demoMailStore()
    expect(getThreadTasks(store, 'thread_launch')).toHaveLength(1)
    expect(getThreadTasks(store, 'thread_contract')).toHaveLength(1)
  })

  it('completes a task without changing its source mail thread', () => {
    const store = demoMailStore()
    const done = updateTaskStatus(
      store.tasks[0],
      'done',
      '2026-06-20T11:00:00.000Z',
    )
    expect(done.status).toBe('done')
    expect(done.source.threadId).toBe('thread_contract')
    expect(
      store.threads.find(thread => thread.id === done.source.threadId)?.status,
    ).toBe('waiting')
  })

  it('updates editable task detail while preserving source mail context', () => {
    const store = demoMailStore()
    const updated = updateMailTask(
      store.tasks[0],
      {
        title: 'Send contract answer',
        dueAt: '',
        notes: 'Confirm legal copy before replying.',
        status: 'waiting',
      },
      '2026-06-20T12:00:00.000Z',
    )

    expect(updated.title).toBe('Send contract answer')
    expect(updated.dueAt).toBeUndefined()
    expect(updated.notes).toContain('legal copy')
    expect(updated.status).toBe('waiting')
    expect(updated.updatedAt).toBe('2026-06-20T12:00:00.000Z')
    expect(updated.source).toEqual(store.tasks[0].source)
  })

  it('deletes a mail task without removing its source thread', () => {
    const store = demoMailStore()
    const task = store.tasks[0]
    const next = deleteMailTask(store, task.id)

    expect(next.tasks.some(item => item.id === task.id)).toBe(false)
    expect(
      next.threads.some(thread => thread.id === task.source.threadId),
    ).toBe(true)
  })

  it('attaches a reply draft to a source-linked task', () => {
    const store = demoMailStore()
    const draft = createReplyDraft(
      store.threads[0],
      store.messages.find(
        message => message.threadId === store.threads[0].id,
      ) ?? null,
      '',
      '2026-06-20T12:00:00.000Z',
    )
    const result = attachDraftToTask(
      { ...store, drafts: [draft] },
      draft.id,
      '2026-06-20T12:30:00.000Z',
    )

    expect(result.task?.title).toBe(`Reply later: ${store.threads[0].subject}`)
    expect(result.task?.source.threadId).toBe(store.threads[0].id)
    expect(result.task?.source.messageId).toBeTruthy()
    expect(result.draft?.taskId).toBe(result.task?.id)
    expect(result.store.tasks).toHaveLength(store.tasks.length + 1)
  })

  it('reuses an existing draft task link', () => {
    const store = demoMailStore()
    const draft = {
      ...createReplyDraft(store.threads[0], null, ''),
      taskId: store.tasks[0].id,
    }
    const result = attachDraftToTask({ ...store, drafts: [draft] }, draft.id)

    expect(result.task?.id).toBe(store.tasks[0].id)
    expect(result.store.tasks).toHaveLength(store.tasks.length)
  })

  it('creates follow-up tasks with due dates', () => {
    const store = demoMailStore()
    const task = createFollowUpTask(
      store.threads[0],
      '2026-06-25',
      '2026-06-20T10:00:00.000Z',
    )
    expect(task.status).toBe('waiting')
    expect(task.dueAt).toBe('2026-06-25')
  })

  it('searches emails and tasks with typed result kinds', () => {
    const results = searchMailAndTasks(demoMailStore(), 'launch')
    expect(results.some(result => result.type === 'thread')).toBe(true)
    expect(results.some(result => result.type === 'message')).toBe(true)
    expect(results.some(result => result.type === 'task')).toBe(true)
  })

  it('searches message senders, recipients, and body text', () => {
    const senderResults = searchMailAndTasks(
      demoMailStore(),
      'mira@example.com',
    )
    expect(
      senderResults.some(
        result => result.type === 'message' && result.id === 'msg_launch_1',
      ),
    ).toBe(true)

    const bodyResults = searchMailAndTasks(demoMailStore(), 'risk summary')
    expect(
      bodyResults.some(
        result => result.type === 'message' && result.id === 'msg_contract_1',
      ),
    ).toBe(true)
  })

  it('searches attachment names with typed result kinds', () => {
    const results = searchMailAndTasks(demoMailStore(), 'screens')
    expect(
      results.some(
        result =>
          result.type === 'attachment' && result.title === 'screens.zip',
      ),
    ).toBe(true)
  })

















  it('uses safe defaults for follow-up settings', () => {
    const defaults = followUpSettingsForStore({
      settings: {
        autoDraftVoiceEngine: 'local-retrieval',
        signature: 'Best',
      },
    })
    expect(defaults).toEqual({
      defaultDelayDays: 3,
      defaultMode: 'snooze_and_task',
      defaultTaskListId: 'tasklist_mail',
      statusCopy: 'Follow-up applied.',
      replyThresholdWorkingDays: 3,
    })

    const configured = followUpSettingsForStore({
      settings: {
        ...demoMailStore().settings,
        followUp: {
          defaultDelayDays: 1,
          defaultMode: 'task',
          defaultTaskListId: 'tasklist_mail',
        },
      },
    })
    expect(configured).toMatchObject({
      defaultDelayDays: 1,
      defaultMode: 'task',
      defaultTaskListId: 'tasklist_mail',
    })
  })

  it('archives a thread into the archive mailbox with pending sync', () => {
    const archived = archiveThread(demoMailStore(), 'thread_launch')
    const thread = archived.threads.find(item => item.id === 'thread_launch')
    expect(thread?.status).toBe('archived')
    expect(thread?.mailboxId).toBe('mailbox_archive')
    expect(thread?.archivedFromMailboxId).toBe('mailbox_inbox')
    expect(thread?.archivedFromStatus).toBe('inbox')
    expect(thread?.syncState).toBe('pending')
  })

  it('archives without changing read state', () => {
    const unreadStore = markThreadRead(demoMailStore(), 'thread_launch', false)
    const archived = archiveThread(unreadStore, 'thread_launch')
    expect(
      archived.messages
        .filter(message => message.threadId === 'thread_launch')
        .every(message => !message.read),
    ).toBe(true)
  })

  it('does not rewrite archive origin metadata on double archive', () => {
    const archived = archiveThread(demoMailStore(), 'thread_launch')
    const again = archiveThread(archived, 'thread_launch')
    const thread = again.threads.find(item => item.id === 'thread_launch')

    expect(again).toBe(archived)
    expect(thread?.archivedFromMailboxId).toBe('mailbox_inbox')
    expect(thread?.archivedFromStatus).toBe('inbox')
  })



  it('moves, labels, deletes, and marks read state as pending sync actions', () => {
    const store = demoMailStore()
    const moved = moveThread(store, 'thread_launch', 'mailbox_sent')
    expect(
      moved.threads.find(item => item.id === 'thread_launch')?.mailboxId,
    ).toBe('mailbox_sent')

    const labelled = labelThread(store, 'thread_design', 'label_launch')
    expect(
      labelled.threads.find(item => item.id === 'thread_design')?.labels,
    ).toContain('Launch')

    const deleted = deleteThread(store, 'thread_launch')
    expect(
      deleted.threads.find(item => item.id === 'thread_launch')?.mailboxId,
    ).toBe('mailbox_trash')

    const unread = markThreadRead(store, 'thread_contract', false)
    expect(
      unread.messages.find(item => item.threadId === 'thread_contract')?.read,
    ).toBe(false)
    expect(
      unread.threads.find(item => item.id === 'thread_contract')?.syncState,
    ).toBe('pending')
  })

  it('snoozes a thread with a follow-up date', () => {
    const snoozed = snoozeThread(demoMailStore(), 'thread_launch', '2026-06-25')
    const thread = snoozed.threads.find(item => item.id === 'thread_launch')
    expect(thread?.status).toBe('snoozed')
    expect(thread?.snoozedUntil).toBe('2026-06-25')
    expect(thread?.syncState).toBe('pending')
  })

  it('marks edited drafts as pending sync', () => {
    const store = demoMailStore()
    const draft = updateDraftBody(
      store.drafts[0],
      'Updated body',
      '2026-06-20T12:00:00.000Z',
    )
    expect(draft.body).toBe('Updated body')
    expect(draft.updatedAt).toBe('2026-06-20T12:00:00.000Z')
    expect(draft.syncState).toBe('pending')
  })


  it('carries Phase M0 local-only state through a provider sync (issue #153 class)', () => {
    const base = demoMailStore()
    const current = {
      ...base,
      storeVersion: 2,
      starredThreadIds: ['thread_launch'],
      pinnedThreadIds: ['thread_contract'],
      snoozes: [
        {
          threadId: 'thread_launch',
          snoozedUntil: '2026-07-10T09:00:00.000Z',
          snoozedAt: '2026-07-05T09:00:00.000Z',
          returnMailboxId: 'mailbox_inbox',
          reason: 'manual' as const,
        },
      ],
      providerLabels: [
        {
          id: 'Label_1',
          name: 'Receipts',
          type: 'user' as const,
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      queuedActions: [
        {
          id: 'queued_1',
          type: 'archive' as const,
          threadId: 'thread_launch',
          queuedAt: '2026-07-05T09:00:00.000Z',
          attempts: 1,
        },
      ],
      scheduledSends: [
        {
          id: 'sched_1',
          draftId: 'draft_1',
          threadId: 'thread_launch',
          sendAt: '2026-07-06T08:00:00.000Z',
          createdAt: '2026-07-05T09:00:00.000Z',
          status: 'scheduled' as const,
        },
      ],
      notificationPreferences: {
        enabled: false,
        scope: 'none' as const,
      },
    }
    // Provider fetch results never contain the local-only Phase M0 fields.
    const providerStore = demoMailStore()

    const merged = mergeMailProviderSyncResult(current, providerStore)

    expect(merged.storeVersion).toBe(2)
    expect(merged.starredThreadIds).toEqual(current.starredThreadIds)
    expect(merged.pinnedThreadIds).toEqual(current.pinnedThreadIds)
    expect(merged.snoozes).toEqual(current.snoozes)
    expect(merged.queuedActions).toEqual(current.queuedActions)
    expect(merged.scheduledSends).toEqual(current.scheduledSends)
    expect(merged.notificationPreferences).toEqual(
      current.notificationPreferences,
    )
    // Cached label metadata stands when the fetch brings none...
    expect(merged.providerLabels).toEqual(current.providerLabels)
    // ...and is refreshed when the provider returns a newer cache.
    const refreshed = mergeMailProviderSyncResult(current, {
      ...providerStore,
      providerLabels: [
        {
          id: 'Label_2',
          name: 'Travel',
          type: 'user' as const,
          updatedAt: '2026-07-05T10:00:00.000Z',
        },
      ],
    })
    expect(refreshed.providerLabels).toEqual([
      {
        id: 'Label_2',
        name: 'Travel',
        type: 'user',
        updatedAt: '2026-07-05T10:00:00.000Z',
      },
    ])
  })


  it('keeps local snooze state until a new message arrives', () => {
    const store = demoMailStore()
    const snoozedThread = {
      ...store.threads[0],
      status: 'snoozed' as const,
      snoozedUntil: '2026-06-28T09:00:00.000Z',
    }
    const current = {
      ...store,
      threads: [snoozedThread, ...store.threads.slice(1)],
    }
    const refreshedSame = {
      ...demoMailStore(),
      threads: demoMailStore().threads.map(thread => ({
        ...thread,
        status: 'inbox' as const,
      })),
    }

    const merged = mergeMailProviderSyncResult(current, refreshedSame)
    expect(merged.threads[0]).toMatchObject({
      status: 'snoozed',
      snoozedUntil: '2026-06-28T09:00:00.000Z',
    })

    const withNewMessage = {
      ...refreshedSame,
      threads: refreshedSame.threads.map((thread, index) =>
        index === 0
          ? { ...thread, lastMessageAt: '2026-06-27T10:00:00.000Z' }
          : thread,
      ),
    }
    const woken = mergeMailProviderSyncResult(current, withNewMessage)
    expect(woken.threads[0]?.status).toBe('inbox')
  })

  it('keeps a local archive of a SENT thread across sync — the provider files sent mail as waiting', () => {
    const store = demoMailStore()
    const archived = {
      ...store.threads[0],
      status: 'archived' as const,
      mailboxId: 'archive-box',
      archivedFromMailboxId: store.threads[0]!.mailboxId,
      archivedFromStatus: 'waiting' as const,
    }
    const current = { ...store, threads: [archived, ...store.threads.slice(1)] }
    // What a Gmail sync says about sent mail: never `inbox`, always `waiting`.
    const refreshed = {
      ...demoMailStore(),
      threads: demoMailStore().threads.map(thread => ({
        ...thread,
        status: 'waiting' as const,
      })),
    }

    const merged = mergeMailProviderSyncResult(current, refreshed)
    expect(merged.threads[0]).toMatchObject({
      status: 'archived',
      mailboxId: 'archive-box',
      archivedFromStatus: 'waiting',
    })

    // A reply lands: the provider's placement wins and the thread resurfaces.
    const withReply = {
      ...refreshed,
      threads: refreshed.threads.map((thread, index) =>
        index === 0
          ? { ...thread, status: 'inbox' as const, lastMessageAt: '2026-06-27T10:00:00.000Z' }
          : thread,
      ),
    }
    const resurfaced = mergeMailProviderSyncResult(current, withReply)
    expect(resurfaced.threads[0]?.status).toBe('inbox')
  })

  it('never keeps a local verdict over the provider moving a thread to trash', () => {
    const store = demoMailStore()
    const snoozed = { ...store.threads[0], status: 'snoozed' as const, snoozedUntil: '2026-06-28T09:00:00.000Z' }
    const current = { ...store, threads: [snoozed, ...store.threads.slice(1)] }
    const trashed = {
      ...demoMailStore(),
      threads: demoMailStore().threads.map((thread, index) =>
        index === 0 ? { ...thread, status: 'archived' as const } : thread,
      ),
    }
    expect(mergeMailProviderSyncResult(current, trashed).threads[0]?.status).toBe('archived')
  })

  it('carries archived and aged-out threads a provider refresh cannot contain', () => {
    const store = demoMailStore()
    const now = '2026-06-27T12:00:00.000Z'
    const archivedThread = {
      ...store.threads[0],
      id: 'thread_archived_locally',
      mailboxId: 'mailbox_archive',
      status: 'archived' as const,
    }
    const agedOutThread = {
      ...store.threads[0],
      id: 'thread_aged_out',
      lastMessageAt: '2026-06-01T08:00:00.000Z',
    }
    const removedRemotelyThread = {
      ...store.threads[0],
      id: 'thread_removed_remotely',
      lastMessageAt: '2026-06-26T08:00:00.000Z',
    }
    const otherAccountThread = {
      ...store.threads[0],
      id: 'thread_other_account',
      accountId: 'acct_gone',
    }
    const archivedMessage = {
      ...store.messages[0],
      id: 'msg_archived_locally',
      threadId: archivedThread.id,
    }
    const current = {
      ...store,
      settings: { ...store.settings, fetchWindow: '7d' as const },
      threads: [
        archivedThread,
        agedOutThread,
        removedRemotelyThread,
        otherAccountThread,
      ],
      messages: [archivedMessage],
    }
    const providerStore = {
      ...demoMailStore(),
      threads: [],
      messages: [],
    }

    const merged = mergeMailProviderSyncResult(current, providerStore, now)
    const mergedIds = merged.threads.map(thread => thread.id)

    expect(mergedIds).toContain('thread_archived_locally')
    expect(mergedIds).toContain('thread_aged_out')
    expect(mergedIds).not.toContain('thread_removed_remotely')
    expect(mergedIds).not.toContain('thread_other_account')
    expect(merged.messages.map(message => message.id)).toContain(
      'msg_archived_locally',
    )
  })

  it('merges user labels with refreshed provider labels', () => {
    const store = demoMailStore()
    const current = {
      ...store,
      threads: store.threads.map((thread, index) =>
        index === 0
          ? { ...thread, labels: ['Gmail', 'Client work'] }
          : thread,
      ),
    }
    const providerStore = {
      ...demoMailStore(),
      threads: demoMailStore().threads.map((thread, index) =>
        index === 0 ? { ...thread, labels: ['Needs reply'] } : thread,
      ),
    }

    const merged = mergeMailProviderSyncResult(current, providerStore)
    expect(merged.threads[0]?.labels).toEqual(['Needs reply', 'Client work'])
  })

  it('summarizes and recovers failed mail sync states', () => {
    const store = demoMailStore()
    const thread = { ...store.threads[0], syncState: 'conflict' as const }
    const task = { ...store.tasks[0], syncState: 'failed' as const }
    const draft = { ...store.drafts[0], syncState: 'failed' as const }
    const failedStore = {
      ...store,
      threads: [thread, ...store.threads.slice(1)],
      tasks: [task, ...store.tasks.slice(1)],
      drafts: [draft, ...store.drafts.slice(1)],
    }

    expect(mailSyncSummary(failedStore)).toMatchObject({
      conflict: 1,
      failed: 2,
    })

    expect(
      recoverMailThreadSync(failedStore, thread.id, 'retry').threads.find(
        item => item.id === thread.id,
      )?.syncState,
    ).toBe('pending')
    expect(
      recoverMailTaskSync(failedStore, task.id, 'resolve').tasks.find(
        item => item.id === task.id,
      )?.syncState,
    ).toBe('synced')
    expect(
      recoverMailDraftSync(failedStore, draft.id, 'retry').drafts.find(
        item => item.id === draft.id,
      )?.syncState,
    ).toBe('pending')

    const retriedAll = retryMailSyncFailures(failedStore)
    expect(
      retriedAll.threads.find(item => item.id === thread.id)?.syncState,
    ).toBe('pending')
    expect(retriedAll.tasks.find(item => item.id === task.id)?.syncState).toBe(
      'pending',
    )
    expect(
      retriedAll.drafts.find(item => item.id === draft.id)?.syncState,
    ).toBe('pending')
  })

  it('adds and removes draft attachments without mutating the draft body', () => {
    const store = demoMailStore()
    const attachment = {
      id: 'att_plan',
      name: 'plan.md',
      mimeType: 'text/markdown',
      sizeLabel: '2 KB',
      content: 'Plan body',
    }
    const attached = updateDraftAttachments(
      store.drafts[0],
      [attachment],
      '2026-06-20T12:00:00.000Z',
    )
    expect(attached.attachments).toEqual([attachment])
    expect(attached.body).toBe(store.drafts[0].body)
    expect(attached.syncState).toBe('pending')

    const removed = removeDraftAttachment(
      attached,
      attachment.id,
      '2026-06-20T12:05:00.000Z',
    )
    expect(removed.attachments).toEqual([])
    expect(removed.updatedAt).toBe('2026-06-20T12:05:00.000Z')
  })

  it('appends dropped draft attachments without replacing existing files', () => {
    const store = demoMailStore()
    const existing = {
      id: 'att_existing',
      name: 'existing.txt',
      mimeType: 'text/plain',
      sizeLabel: '1 KB',
      content: 'Existing',
    }
    const dropped = {
      id: 'att_drop',
      name: 'dropped.txt',
      mimeType: 'text/plain',
      sizeLabel: '2 KB',
      content: 'Dropped',
    }
    const draft = updateDraftAttachments(store.drafts[0], [existing])
    const updated = appendDraftAttachments(
      draft,
      [dropped],
      '2026-06-20T12:10:00.000Z',
    )

    expect(updated.attachments).toEqual([existing, dropped])
    expect(updated.body).toBe(draft.body)
    expect(updated.updatedAt).toBe('2026-06-20T12:10:00.000Z')
    expect(updated.syncState).toBe('pending')
  })

  it('sends draft attachments into the thread and removes the draft', () => {
    const store = demoMailStore()
    const attachment = {
      id: 'att_review',
      name: 'review.pdf',
      mimeType: 'application/pdf',
      sizeLabel: '42 KB',
    }
    const draft = updateDraftAttachments(
      updateDraftFields(store.drafts[0], {
        cc: [{ name: 'Copy Person', email: 'copy@example.com' }],
        bcc: [{ name: 'Blind Person', email: 'blind@example.com' }],
      }),
      [attachment],
      '2026-06-20T12:00:00.000Z',
    )
    const withDraft = {
      ...store,
      drafts: store.drafts.map(item => (item.id === draft.id ? draft : item)),
    }

    const sent = sendDraft(withDraft, draft.id, '2026-06-20T12:10:00.000Z')
    const sentMessage = sent.messages.find(message =>
      message.id.includes(draft.id),
    )
    expect(sentMessage?.attachments).toEqual([attachment])
    expect(sentMessage?.cc).toEqual([
      { name: 'Copy Person', email: 'copy@example.com' },
    ])
    expect(sentMessage?.bcc).toEqual([
      { name: 'Blind Person', email: 'blind@example.com' },
    ])
    expect(sent.drafts.find(item => item.id === draft.id)).toBeUndefined()
    expect(
      sent.threads.find(thread => thread.id === draft.threadId)?.status,
    ).toBe('waiting')
  })

  it('can keep a sent manual reply attached to its source thread', () => {
    const store = demoMailStore()
    const draft = updateDraftFields(store.drafts[0], {
      body: 'Sent reply body.',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      cc: [{ name: 'Copy Person', email: 'copy@example.com' }],
    })
    const withDraft = {
      ...store,
      drafts: store.drafts.map(item => (item.id === draft.id ? draft : item)),
    }

    const sent = sendDraft(withDraft, draft.id, '2026-06-20T12:10:00.000Z', {
      appendMessage: false,
      keepDraft: true,
      sentMessageId: 'gmail_msg_sent_1',
      sentWithoutReview: true,
      sentByAutomation: true,
      sentReviewBypassReason: 'Live Mail auto-send rule fired.',
    })
    const keptDraft = sent.drafts.find(item => item.id === draft.id)
    expect(keptDraft?.sentAt).toBe('2026-06-20T12:10:00.000Z')
    expect(keptDraft?.sentMessageId).toBe('gmail_msg_sent_1')
    expect(keptDraft?.sentWithoutReview).toBe(true)
    expect(keptDraft?.sentByAutomation).toBe(true)
    expect(keptDraft?.sentReviewBypassReason).toBe(
      'Live Mail auto-send rule fired.',
    )
    expect(keptDraft?.sentTo).toEqual([
      { name: 'Mira', email: 'mira@example.com' },
    ])
    expect(keptDraft?.sentCc).toEqual([
      { name: 'Copy Person', email: 'copy@example.com' },
    ])
    expect(sent.messages.find(message => message.id.includes(draft.id))).toBe(
      undefined,
    )
  })



  it('leaves a generated draft on the conversation it answers', () => {
    const base = demoMailStore()
    const queued = enqueueQaDraftRequest(
      { ...base, drafts: [] },
      'thread_launch',
      'user_requested',
      '2026-06-20T12:00:00.000Z',
      { force: true, requestId: 'qa_request_send_home' },
    )
    const ready = completeQaDraftRequest(
      queued.store,
      'qa_request_send_home',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:01:00.000Z',
    )
    const draft = generatedDraftsForStore(ready)[0]
    // No synthetic thread: a draft answering a conversation stays on it, and
    // reaches Drafts through the query rather than by being moved.
    expect(draft.threadId).toBe('thread_launch')
    expect(
      ready.threads.some(item => item.id.startsWith('thread_draft_')),
    ).toBe(false)

    const sent = sendDraft(ready, draft.id, '2026-06-20T12:30:00.000Z')
    const thread = sent.threads.find(item => item.id === 'thread_launch')!
    // The conversation does not move to Sent — the sent message lands on it.
    expect(thread.mailboxId).toBe('mailbox_inbox')
    expect(sent.drafts.some(item => item.id === draft.id)).toBe(false)
  })

  it('keeps a non-draft conversation thread in its own mailbox on sendDraft', () => {
    const store = demoMailStore()
    const draft = updateDraftFields(store.drafts[0], {
      body: 'Sent reply body.',
      to: [{ name: 'Mira', email: 'mira@example.com' }],
    })
    const withDraft = {
      ...store,
      drafts: store.drafts.map(item => (item.id === draft.id ? draft : item)),
    }

    const sent = sendDraft(withDraft, draft.id, '2026-06-20T12:10:00.000Z')
    const thread = sent.threads.find(item => item.id === draft.threadId)!
    expect(thread.mailboxId).toBe('mailbox_inbox')
  })

  it('detects threads that need a reply and prepares one auto-draft when enabled', () => {
    const store = {
      ...demoMailStore(),
      drafts: [],
    }

    expect(threadNeedsReply(store.threads[0])).toBe(true)

    const withDraft = ensureAutoDraftForThread(
      store,
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    expect(withDraft.drafts).toHaveLength(1)
    expect(withDraft.drafts[0].source).toBe('auto')
    expect(withDraft.drafts[0].provenance?.[0]).toContain('Launch copy')
    expect(withDraft.drafts[0].voice?.recipientEmail).toBe('mira@example.com')
    expect(withDraft.drafts[0].voice?.sampleCount).toBeGreaterThan(0)
    expect(withDraft.drafts[0].body).toContain('Hi Mira,')
    expect(withDraft.drafts[0].body).not.toContain('Based on the thread')
    expect(withDraft.drafts[0].body).not.toContain('I can take this forward')
    expect(withDraft.drafts[0].body).toContain('I’m checking this now.')
    expect(withDraft.drafts[0].provenance?.join(' ')).not.toContain(
      'Your call: confirm',
    )

    const unchanged = ensureAutoDraftForThread(
      withDraft,
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:05:00.000Z',
    )
    expect(unchanged.drafts).toHaveLength(1)
  })

  it('tracks pending, ready, and failed QA draft lifecycle in the draft store', () => {
    const queued = enqueueQaDraftRequest(
      { ...demoMailStore(), drafts: [] },
      'thread_launch',
      'user_requested',
      '2026-06-20T12:00:00.000Z',
      { force: true, requestId: 'qa_request_test' },
    )

    expect(queued.requestId).toBe('qa_request_test')
    expect(qaDraftsForStore(queued.store)).toHaveLength(1)
    expect(pendingQaDraftsForStore(queued.store)[0]).toMatchObject({
      threadId: 'thread_launch',
      qaStatus: 'pending',
      qaOrigin: 'user_requested',
      qaForced: true,
    })
    expect(generatedDraftsForStore(queued.store)).toHaveLength(0)

    const ready = completeQaDraftRequest(
      queued.store,
      'qa_request_test',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:01:00.000Z',
      {
        fallbackReason:
          'Local fallback used because agent key/model was unavailable.',
      },
    )
    expect(pendingQaDraftsForStore(ready)).toHaveLength(0)
    expect(generatedDraftsForStore(ready)[0]).toMatchObject({
      qaStatus: 'ready',
      qaOrigin: 'user_requested',
      qaForced: true,
    })
    expect(generatedDraftsForStore(ready)[0].provenance?.join(' ')).toContain(
      'Local fallback used because agent key/model was unavailable.',
    )

    const failedQueued = enqueueQaDraftRequest(
      { ...demoMailStore(), drafts: [] },
      'thread_launch',
      'auto',
      '2026-06-20T12:02:00.000Z',
      { requestId: 'qa_request_failed' },
    )
    const failed = failQaDraftRequest(
      failedQueued.store,
      'qa_request_failed',
      'No model configured.',
      '2026-06-20T12:03:00.000Z',
    )
    expect(pendingQaDraftsForStore(failed)[0]).toMatchObject({
      qaStatus: 'failed',
      qaError: 'No model configured.',
    })
    expect(generatedDraftsForStore(failed)).toHaveLength(0)
  })

  it('collapses Gmail quoted HTML history for reader display', () => {
    const message: MailMessage = {
      id: 'msg_quote_html',
      threadId: 'thread_quote_html',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Example document review',
      body: '',
      bodyHtml: [
        '<div>Current answer: the example document is ready for review.</div>',
        '<div class="gmail_attr">On Wed, User wrote:</div>',
        '<div class="gmail_quote">',
        '<div>* Individual</div>',
        '<div>* Please review this synthetic example.</div>',
        '</div>',
      ].join(''),
      receivedAt: '2026-06-24T12:00:00.000Z',
      attachments: [],
      read: false,
    }

    expect(cleanMailMessageText(message)).toMatchObject({
      text: 'Current answer: the example document is ready for review.',
    })
    expect(cleanMailMessageText(message).stripped).toContain(
      'gmail quoted attribution',
    )

    const readerBody = readerMailBody(message)
    expect(readerBody.hasCollapsedHistory).toBe(true)
    expect(readerBody.visibleText).not.toContain('* Individual')
    expect(readerBody.fullText).toContain('* Individual')
    expect(readerBody.segments).toEqual([
      {
        type: 'text',
        text: 'Current answer: the example document is ready for review.',
      },
      expect.objectContaining({
        label: 'Quoted history',
        type: 'quote',
      }),
    ])
  })

  it('uses Gmail quoted HTML boundaries even when a plain body is present', () => {
    const message: MailMessage = {
      id: 'msg_quote_html_with_plain',
      threadId: 'thread_quote_html_with_plain',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Example document review',
      body: [
        'Hi,',
        '',
        'Current answer: the example document is ready for review.',
        '',
        'Section A - earlier example notes.',
        'Section B - earlier example notes.',
      ].join('\n'),
      bodyHtml: [
        '<div>Hi,</div>',
        '<div>Current answer: the example document is ready for review.</div>',
        '<div class="gmail_attr">On Wed, User wrote:</div>',
        '<div class="gmail_quote">',
        '<div>Section A - earlier example notes.</div>',
        '<div>Section B - earlier example notes.</div>',
        '</div>',
      ].join(''),
      receivedAt: '2026-06-24T12:00:00.000Z',
      attachments: [],
      read: false,
    }

    const readerBody = readerMailBody(message)

    expect(readerBody.hasCollapsedHistory).toBe(true)
    expect(readerBody.visibleText).toBe(
      'Hi,\nCurrent answer: the example document is ready for review.',
    )
    expect(readerBody.fullText).toContain('On Wed, User wrote:')
    expect(readerBody.segments).toEqual([
      {
        type: 'text',
        text: 'Hi,\nCurrent answer: the example document is ready for review.',
      },
      expect.objectContaining({
        label: 'Quoted history',
        text: expect.stringContaining('Section B - earlier example notes.'),
        type: 'quote',
      }),
    ])
  })

  it('keeps a bulleted list visible instead of hiding it as a quote', () => {
    // Synthetic regression case: preserve a bulleted schedule in a message body.
    for (const marker of ['-', '*', '•']) {
      const message: MailMessage = {
        id: `msg_bullets_${marker}`,
        threadId: 'thread_bullets',
        from: { name: 'Example Riley', email: 'riley@example.com' },
        to: [{ name: 'Alex Example', email: 'alex@example.com' }],
        subject: 'RE: (no subject)',
        body: [
          'Hi User,',
          '',
          "The synthetic schedule contains the following slots:",
          '',
          `${marker} Monday 09:00-10:00`,
          `${marker} Tuesday 10:00-11:00`,
          `${marker} Wednesday 11:00-12:00`,
          '',
          'Best, Riley',
        ].join('\n'),
        receivedAt: '2026-08-24T23:00:00.000Z',
        attachments: [],
        read: false,
      }

      const readerBody = readerMailBody(message)

      expect(readerBody.hasCollapsedHistory).toBe(false)
      expect(readerBody.segments).toEqual([
        { type: 'text', text: readerBody.fullText },
      ])
      expect(readerBody.visibleText).toContain('Monday 09:00-10:00')
      expect(readerBody.visibleText).toContain('Wednesday 11:00-12:00')
      expect(readerBody.visibleText).toContain('Best, Riley')
    }
  })

  it('still collapses genuine quoted lines, with or without a space', () => {
    const message: MailMessage = {
      id: 'msg_real_quote',
      threadId: 'thread_real_quote',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Re: Pricing',
      body: [
        'Agreed on both counts.',
        '',
        '>What about the enterprise tier?',
        '>> It was in the earlier draft.',
        '',
        'Shipping it tomorrow.',
      ].join('\n'),
      receivedAt: '2026-06-24T12:00:00.000Z',
      attachments: [],
      read: false,
    }

    const readerBody = readerMailBody(message)

    expect(readerBody.hasCollapsedHistory).toBe(true)
    expect(readerBody.segments).toEqual([
      { type: 'text', text: 'Agreed on both counts.' },
      expect.objectContaining({ type: 'quote', label: 'Inline quote' }),
      { type: 'text', text: 'Shipping it tomorrow.' },
    ])
  })

  it('marks inline quote blocks at their position in reader display', () => {
    const message: MailMessage = {
      id: 'msg_inline_quote',
      threadId: 'thread_inline_quote',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Example document review',
      body: [
        'Yes, this framing works.',
        '',
        '> Individual',
        '',
        '> Teams',
        '',
        'Let’s talk through it tomorrow.',
      ].join('\n'),
      receivedAt: '2026-06-24T12:00:00.000Z',
      attachments: [],
      read: false,
    }

    const readerBody = readerMailBody(message)

    expect(readerBody.hasCollapsedHistory).toBe(true)
    expect(readerBody.visibleText).toBe(
      'Yes, this framing works.\n\nLet’s talk through it tomorrow.',
    )
    expect(readerBody.segments).toEqual([
      { type: 'text', text: 'Yes, this framing works.' },
      expect.objectContaining({
        label: 'Inline quote',
        text: '> Individual\n\n> Teams',
        type: 'quote',
      }),
      { type: 'text', text: 'Let’s talk through it tomorrow.' },
    ])
  })

  it('marks wrapped quote blocks without swallowing later reply text', () => {
    const message: MailMessage = {
      id: 'msg_wrapped_inline_quote',
      threadId: 'thread_wrapped_inline_quote',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Example document review',
      body: [
        'Recent reply.',
        '',
        '> Teams',
        'This wrapped quote line continues with pricing notes.',
        '',
        '> Enterprise',
        'This wrapped quote line continues too.',
        '',
        'Back to the current reply.',
      ].join('\n'),
      receivedAt: '2026-06-24T12:00:00.000Z',
      attachments: [],
      read: false,
    }

    const readerBody = readerMailBody(message)

    expect(readerBody.hasCollapsedHistory).toBe(true)
    expect(readerBody.visibleText).toBe(
      'Recent reply.\n\nBack to the current reply.',
    )
    expect(readerBody.segments).toEqual([
      { type: 'text', text: 'Recent reply.' },
      expect.objectContaining({
        label: 'Inline quote',
        text: expect.stringContaining(
          '> Teams\nThis wrapped quote line continues with pricing notes.',
        ),
        type: 'quote',
      }),
      { type: 'text', text: 'Back to the current reply.' },
    ])
  })

  it('treats recognized quoted history as terminal reader history', () => {
    const message: MailMessage = {
      id: 'msg_terminal_history',
      threadId: 'thread_terminal_history',
      from: { name: 'Morgan Example', email: 'morgan@example.com' },
      to: [{ name: 'Alex Example', email: 'alex@example.com' }],
      subject: 'Example document review',
      body: [
        'Recent reply.',
        '',
        'On Tue, User wrote:',
        '1. Section A - earlier example notes.',
        '2. Section B - earlier example notes.',
      ].join('\n'),
      receivedAt: '2026-06-24T12:00:00.000Z',
      attachments: [],
      read: false,
    }

    const readerBody = readerMailBody(message)

    expect(readerBody.hasCollapsedHistory).toBe(true)
    expect(readerBody.visibleText).toBe('Recent reply.')
    expect(readerBody.segments).toEqual([
      { type: 'text', text: 'Recent reply.' },
      expect.objectContaining({
        label: 'Quoted history',
        text: expect.stringContaining('2. Section B - earlier example notes.'),
        type: 'quote',
      }),
    ])
  })

  it('builds a local QA draft body when the agent model is unavailable', () => {
    const store = demoMailStore()
    const body = buildLocalQaDraftBody(store, 'thread_launch')

    expect(body).toContain('Thanks for sending this through.')
    expect(body).toContain('Best,')
    expect(body).toContain('User')
    expect(body).not.toContain('review can you approve')
  })

  it('derives a structured reply intent for approval plus requested note', () => {
    const store = demoMailStore()
    const intent = deriveReplyIntentForThread(store, 'thread_launch')

    expect(intent).toMatchObject({
      threadId: 'thread_launch',
      sourceMessageId: 'msg_launch_1',
      askType: 'approval',
      confidence: 'high',
    })
    expect(intent?.asker?.email).toBe('mira@example.com')
    expect(intent?.recipient?.email).toBe('mira@example.com')
    expect(intent?.requestedAction).toContain('approve')
    expect(intent?.requestedAction).toContain('internal note')
    expect(intent?.owedResponse).toContain('clear yes/no/review status')
    expect(intent?.missingInformation).toContain('actual approval decision')
    expect(intent?.quote).toContain('Can you approve the launch copy today?')
  })

  it('classifies by the primary ask, not a trailing call offer', () => {
    const base = demoMailStore()
    const thread = {
      ...base.threads[0],
      id: 'thread_budget_request',
      subject: 'Updated budget',
      summary: 'Priya asked for the updated budget.',
      participants: [{ name: 'Priya', email: 'priya@example.com' }],
    }
    const message: MailMessage = {
      id: 'msg_budget_request',
      threadId: thread.id,
      from: { name: 'Priya', email: 'priya@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: thread.subject,
      body: "Can you send over the updated budget? Happy to jump on a call if that's easier.",
      receivedAt: '2026-06-20T17:00:00.000Z',
      attachments: [],
      read: false,
    }
    const store = {
      ...base,
      threads: [thread, ...base.threads],
      messages: [message, ...base.messages],
      drafts: [],
    }
    const intent = deriveReplyIntentForThread(store, 'thread_budget_request')

    expect(intent?.askType).toBe('information')
    expect(intent?.requestedAction).toContain('updated budget')
  })

  it('extracts the direct questions from the latest fresh message text', () => {
    const base = demoMailStore()
    const thread = {
      ...base.threads[0],
      id: 'thread_two_questions',
      subject: 'Venue and headcount',
      summary: 'Two open questions about the event.',
      participants: [{ name: 'Lee', email: 'lee@example.com' }],
    }
    const message: MailMessage = {
      id: 'msg_two_questions',
      threadId: thread.id,
      from: { name: 'Lee', email: 'lee@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: thread.subject,
      body: [
        'Two things before Friday.',
        'Does the venue work for you?',
        'And how many people should we plan for?',
        'On Mon, Jun 15, Lee wrote:',
        '> Did you get my earlier note?',
      ].join('\n'),
      receivedAt: '2026-06-20T17:00:00.000Z',
      attachments: [],
      read: false,
    }
    const store = {
      ...base,
      threads: [thread, ...base.threads],
      messages: [message, ...base.messages],
      drafts: [],
    }

    expect(replyQuestionsForThread(store, 'thread_two_questions')).toEqual([
      'Does the venue work for you?',
      'And how many people should we plan for?',
    ])
  })

  it('references the requested work and deadline in local fallback drafts', () => {
    const base = demoMailStore()
    const thread = {
      ...base.threads[0],
      id: 'thread_fallback_task',
      subject: 'Board summary',
      summary: 'Sam asked for a board summary.',
      participants: [{ name: 'Sam', email: 'sam@example.com' }],
    }
    const message: MailMessage = {
      id: 'msg_fallback_task',
      threadId: thread.id,
      from: { name: 'Sam', email: 'sam@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: thread.subject,
      body: 'Can you prepare a short summary for the board by Friday?',
      receivedAt: '2026-06-20T17:00:00.000Z',
      attachments: [],
      read: false,
    }
    const store = {
      ...base,
      threads: [thread, ...base.threads],
      messages: [message, ...base.messages],
      drafts: [],
    }
    const body = buildLocalQaDraftBody(store, 'thread_fallback_task')

    expect(body).toContain('prepare')
    expect(body).toContain('by Friday')
    expect(body).not.toContain('Can you prepare')
  })

  it('classifies proposal preparation as work before reply', () => {
    const base = demoMailStore()
    const thread = {
      ...base.threads[0],
      id: 'thread_proposal_request',
      subject: 'Proposal for review workflow',
      summary: 'Sam asked User to prepare a proposal for the review workflow.',
      participants: [{ name: 'Sam', email: 'sam@example.com' }],
    }
    const message: MailMessage = {
      id: 'msg_proposal_request',
      threadId: thread.id,
      from: { name: 'Sam', email: 'sam@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: thread.subject,
      body: 'Can you prepare a proposal for the preprint review workflow by Friday?',
      receivedAt: '2026-06-20T17:00:00.000Z',
      attachments: [],
      read: false,
    }
    const store = {
      ...base,
      threads: [thread, ...base.threads],
      messages: [message, ...base.messages],
      drafts: [],
    }
    const intent = deriveReplyIntentForThread(store, 'thread_proposal_request')

    expect(intent?.responseMode).toBe('needs_work')
    expect(intent?.askType).toBe('task_request')
    expect(intent?.neededOutput).toBe('the requested work output')
    expect(intent?.suggestedApps).toEqual(
      expect.arrayContaining(['assistant', 'files']),
    )
    expect(intent?.deadlineText).toBe('by Friday')
    expect(intent?.reviewReason).toContain('work should be prepared')
  })

  it('stores reply intent on generated drafts and uses it for local fallback', () => {
    const store = demoMailStore()
    const withDraft = ensureAutoDraftForThread(
      { ...store, drafts: [] },
      'thread_launch',
      buildLocalQaDraftBody(store, 'thread_launch'),
      '2026-06-20T12:00:00.000Z',
    )
    const draft = withDraft.drafts[0]

    expect(draft.replyIntent).toMatchObject({
      askType: 'approval',
      sourceMessageId: 'msg_launch_1',
    })
    expect(draft.sourceMessageId).toBe('msg_launch_1')
    expect(draft.draftWarnings?.join(' ')).toContain('actual approval decision')
    expect(draft.body).toContain('approval status')
    expect(draft.body).not.toContain('review can you approve')
  })

  it('keeps completion metadata aligned with the generation intent snapshot', () => {
    const sourceStore = demoMailStore()
    const generationIntent = deriveReplyIntentForThread(
      sourceStore,
      'thread_launch',
    )
    const queued = enqueueQaDraftRequest(
      { ...sourceStore, drafts: [] },
      'thread_launch',
      'user_requested',
      undefined,
      { force: true, requestId: 'qa_request_snapshot' },
    ).store
    const newerMessage: MailMessage = {
      id: 'msg_launch_newer_review',
      threadId: 'thread_launch',
      from: { name: 'Mira', email: 'mira@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: 'Launch copy and rollout notes',
      body: 'Could you review the revised launch note and send feedback tomorrow?',
      receivedAt: '2026-06-20T16:20:00.000Z',
      attachments: [],
      read: false,
    }
    const completed = completeQaDraftRequest(
      {
        ...queued,
        messages: [newerMessage, ...queued.messages],
      },
      'qa_request_snapshot',
      'I’ll review it and come back with approval status.',
      '2026-06-20T16:25:00.000Z',
      { replyIntent: generationIntent },
    )
    const draft = generatedDraftsForStore(completed)[0]

    expect(draft.replyIntent).toEqual(generationIntent)
    expect(draft.sourceMessageId).toBe('msg_launch_1')
    expect(draft.replyIntent?.askType).toBe('approval')
  })

  it('does not mislabel explicit generation intent snapshots as rederived', () => {
    const initial = ensureAutoDraftForThread(
      {
        ...demoMailStore(),
        drafts: [],
      },
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    const draft = initial.drafts[0]
    const newerMessage: MailMessage = {
      id: 'msg_launch_newer_review',
      threadId: 'thread_launch',
      from: { name: 'Mira', email: 'mira@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: 'Launch copy and rollout notes',
      body: 'Could you review the revised launch note and send feedback tomorrow?',
      receivedAt: '2026-06-20T16:20:00.000Z',
      attachments: [],
      read: false,
    }
    const regenerated = regenerateGeneratedDraft(
      {
        ...initial,
        messages: [newerMessage, ...initial.messages],
      },
      draft.id,
      'I’ll review it and come back with approval status.',
      '2026-06-20T16:25:00.000Z',
      { replyIntent: draft.replyIntent },
    )
    const nextDraft = regenerated.drafts[0]

    expect(nextDraft.replyIntent).toEqual(draft.replyIntent)
    expect(nextDraft.redraftHistory?.[0]).toMatchObject({
      intentMode: 'reused',
      sourceMessageId: 'msg_launch_1',
    })
    expect(nextDraft.provenance?.join(' ')).not.toContain(
      'Redrafted from updated thread context.',
    )
  })





  it('updates thread context when selecting a different thread', () => {
    const store = demoMailStore()
    const launch = threadContextSummaryForThread(
      store,
      'thread_launch',
      '2026-06-20T12:00:00.000Z',
    )
    const design = threadContextSummaryForThread(
      store,
      'thread_design',
      '2026-06-20T12:01:00.000Z',
    )

    expect(launch?.threadId).toBe('thread_launch')
    expect(design?.threadId).toBe('thread_design')
    expect(launch?.summary).not.toBe(design?.summary)
    expect(design?.attachmentsMentioned).toContain('screens.zip')
  })


  it('regenerates generated drafts from current voice and person inputs', () => {
    const initial = ensureAutoDraftForThread(
      {
        ...demoMailStore(),
        drafts: [],
      },
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    const draft = {
      ...initial.drafts[0],
      attachments: [
        {
          id: 'att_existing',
          name: 'brief.pdf',
          mimeType: 'application/pdf',
          sizeLabel: '12 KB',
        },
      ],
      taskId: 'task_reply_later',
    }
    const voiceProfile = {
      id: 'voice_regen',
      accountId: 'acct_demo',
      name: 'Regeneration voice',
      tone: 'direct' as const,
      lengthPreference: 'short' as const,
      directness: 'direct' as const,
      formattingPreference: 'bullets' as const,
      greetingPreference: 'Hello',
      signoffPreference: 'Regards,\nAdam',
      avoidPhrases: [],
      examples: [],
      updatedAt: '2026-06-20T12:05:00.000Z',
    }
    const withVoice = {
      ...initial,
      drafts: [draft],
      settings: {
        ...initial.settings,
        emailVoiceProfiles: [voiceProfile],
        activeEmailVoiceProfileId: voiceProfile.id,
      },
    }

    const regenerated = regenerateGeneratedDraft(
      withVoice,
      draft.id,
      'Model-generated alternate reply.',
      '2026-06-20T12:10:00.000Z',
    )
    const nextDraft = regenerated.drafts[0]

    expect(nextDraft.id).toBe(draft.id)
    expect(nextDraft.taskId).toBe('task_reply_later')
    expect(nextDraft.attachments.map(attachment => attachment.name)).toEqual([
      'brief.pdf',
    ])
    expect(nextDraft.body).not.toBe(draft.body)
    expect(nextDraft.body).toContain('Model-generated alternate reply.')
    expect(nextDraft.replyIntent).toEqual(draft.replyIntent)
    expect(nextDraft.redraftCount).toBe(1)
    expect(nextDraft.redraftHistory?.[0]).toMatchObject({
      reason: 'retry_after_failure',
      intentMode: 'reused',
      sourceMessageId: 'msg_launch_1',
    })
    expect(nextDraft.provenance?.join(' ')).toContain(
      'Used: My Voice (Regeneration voice)',
    )
    expect(nextDraft.provenance?.join(' ')).toContain('Regenerated draft')
    expect(
      regenerated.messages.some(message => message.id.includes(draft.id)),
    ).toBe(false)

    const regeneratedAgain = regenerateGeneratedDraft(
      regenerated,
      draft.id,
      'Second model-generated alternate reply.',
      '2026-06-20T12:15:00.000Z',
    )
    expect(regeneratedAgain.drafts[0].body).not.toBe(nextDraft.body)
    expect(regeneratedAgain.drafts[0].replyIntent).toEqual(draft.replyIntent)
    expect(regeneratedAgain.drafts[0].redraftCount).toBe(2)
    expect(regeneratedAgain.drafts[0].provenance?.join(' ')).toContain(
      'Regeneration variation 2.',
    )
  })

  it('regeneration respects draft-level memory disable', () => {
    const withDraft = ensureAutoDraftForThread(
      {
        ...demoMailStore(),
        drafts: [],
      },
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    const draft = updateDraftFields(
      withDraft.drafts[0],
      { memoryDisabled: true },
      '2026-06-20T12:05:00.000Z',
    )
    const regenerated = regenerateGeneratedDraft(
      {
        ...withDraft,
        drafts: [draft],
      },
      draft.id,
      'Regenerated without memory.',
      '2026-06-20T12:10:00.000Z',
    )

    expect(regenerated.drafts[0].memoryDisabled).toBe(true)
    expect(regenerated.drafts[0].provenance?.join(' ')).toContain(
      'Skipped: memory disabled for this draft',
    )
  })

  it('records explicit redraft reasons and feedback', () => {
    const initial = ensureAutoDraftForThread(
      {
        ...demoMailStore(),
        drafts: [],
      },
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    const draft = initial.drafts[0]
    const regenerated = regenerateGeneratedDraft(
      initial,
      draft.id,
      'This version directly answers the ask.',
      '2026-06-20T12:10:00.000Z',
      {
        redraftReason: 'missing_ask',
        userFeedback: 'Answer the approval request directly.',
      },
    )

    expect(regenerated.drafts[0].replyIntent).toEqual(draft.replyIntent)
    expect(regenerated.drafts[0].redraftHistory?.[0]).toMatchObject({
      reason: 'missing_ask',
      userFeedback: 'Answer the approval request directly.',
      intentMode: 'reused',
    })
  })

  it('rederives reply intent when the source message changes before redraft', () => {
    const initial = ensureAutoDraftForThread(
      {
        ...demoMailStore(),
        drafts: [],
      },
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    const draft = initial.drafts[0]
    const newerMessage: MailMessage = {
      id: 'msg_launch_newer_review',
      threadId: 'thread_launch',
      from: { name: 'Mira', email: 'mira@example.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: 'Launch copy and rollout notes',
      body: 'Could you review the revised launch note and send feedback tomorrow?',
      receivedAt: '2026-06-20T16:20:00.000Z',
      attachments: [],
      read: false,
    }
    const withNewMessage = {
      ...initial,
      messages: [newerMessage, ...initial.messages],
    }
    const regenerated = regenerateGeneratedDraft(
      withNewMessage,
      draft.id,
      'I’ll review the revised launch note and send feedback tomorrow.',
      '2026-06-20T12:10:00.000Z',
    )
    const nextDraft = regenerated.drafts[0]

    expect(nextDraft.replyIntent?.sourceMessageId).toBe(
      'msg_launch_newer_review',
    )
    expect(nextDraft.replyIntent?.askType).toBe('review')
    expect(nextDraft.redraftHistory?.[0]).toMatchObject({
      intentMode: 'rederived',
      sourceMessageId: 'msg_launch_newer_review',
    })
    expect(nextDraft.draftWarnings?.join(' ')).not.toContain(
      'actual approval decision',
    )
    expect(nextDraft.provenance?.join(' ')).toContain(
      'Redrafted from updated thread context.',
    )
  })

  it('does not auto-draft automated notification mail', () => {
    const store = demoMailStore()
    const notificationThread = {
      ...store.threads.find(thread => thread.id === 'thread_launch')!,
      id: 'thread_replit_notification',
      subject: 'Publishing for Example App Successful',
      participants: [{ name: 'Replit', email: 'notifications@replit.com' }],
      summary:
        'Your application was successfully published to the following URLs.',
      labels: ['Needs reply'],
      priority: 'high' as const,
    }
    const notificationMessage: MailMessage = {
      id: 'msg_replit_notification',
      threadId: notificationThread.id,
      from: { name: 'Replit', email: 'notifications@replit.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: notificationThread.subject,
      body: 'Your application was successfully published.',
      receivedAt: '2026-06-21T20:37:00.000Z',
      attachments: [],
      read: false,
    }
    const noisy = {
      ...store,
      threads: [notificationThread, ...store.threads],
      messages: [notificationMessage, ...store.messages],
    }

    expect(classifyDraftability(noisy, notificationThread)).toMatchObject({
      draftable: false,
      reason: expect.stringContaining('Automated sender'),
    })
    expect(
      ensureAutoDraftForThread(
        noisy,
        notificationThread.id,
        TEST_LLM_DRAFT_BODY,
      ).drafts.some(draft => draft.threadId === notificationThread.id),
    ).toBe(false)
    const userRequested = ensureAutoDraftForThread(
      noisy,
      notificationThread.id,
      TEST_LLM_DRAFT_BODY,
      undefined,
      { force: true },
    )
    expect(
      generatedDraftsForStore(userRequested).some(
        draft => draft.threadId === notificationThread.id,
      ),
    ).toBe(true)
    const draft = generatedDraftsForStore(userRequested).find(
      item => item.threadId === notificationThread.id,
    )!
    expect(draft.qaForced).toBe(true)

    const regenerated = regenerateGeneratedDraft(
      userRequested,
      draft.id,
      'Forced regeneration should still work.',
      '2026-06-21T20:40:00.000Z',
    )
    expect(
      generatedDraftsForStore(regenerated).find(
        item => item.threadId === notificationThread.id,
      )?.body,
    ).toContain('Forced regeneration should still work.')
  })

  it('keeps product announcements out of QA drafts', () => {
    const store = demoMailStore()
    const announcementThread = {
      ...store.threads[0],
      id: 'thread_airtable_announcement',
      subject: "Airtable's AI assistant is now in Slack",
      participants: [
        { name: 'The Airtable Team', email: 'team@mail.airtable.com' },
      ],
      summary:
        'Now your Airtable data can be queried in Slack. Starting today, your team can ask questions.',
      labels: ['Needs reply'],
      priority: 'high' as const,
    }
    const announcementMessage: MailMessage = {
      id: 'msg_airtable_announcement',
      threadId: announcementThread.id,
      from: { name: 'The Airtable Team', email: 'team@mail.airtable.com' },
      to: [{ name: 'User', email: 'alex@example.com' }],
      subject: announcementThread.subject,
      body: 'Hey User, your team can now ask "How many open tasks are assigned to me?" right in Slack. Learn more.',
      receivedAt: '2026-06-21T20:38:00.000Z',
      attachments: [],
      read: false,
    }
    const withAnnouncement = {
      ...store,
      threads: [announcementThread, ...store.threads],
      messages: [announcementMessage, ...store.messages],
    }

    expect(
      classifyDraftability(withAnnouncement, announcementThread),
    ).toMatchObject({
      draftable: false,
      reason:
        'Product or promotional announcement; no personal reply expected.',
    })
    expect(
      ensureAutoDraftForThread(
        withAnnouncement,
        announcementThread.id,
        TEST_LLM_DRAFT_BODY,
      ).drafts.some(draft => draft.threadId === announcementThread.id),
    ).toBe(false)
    expect(
      ensureAutoDraftForThread(
        withAnnouncement,
        announcementThread.id,
        TEST_LLM_DRAFT_BODY,
        '2026-06-21T20:39:00.000Z',
        { force: true },
      ).drafts.some(draft => draft.threadId === announcementThread.id),
    ).toBe(true)
  })

  it('normalizes deterministic draft greetings to first names', () => {
    const store = demoMailStore()
    const thread = {
      ...store.threads[0],
      id: 'thread_ralph',
      subject: 'Coffee next Friday',
      summary: 'Riley wants to meet next Friday.',
    }
    const message: MailMessage = {
      ...store.messages[0],
      id: 'msg_ralph',
      threadId: 'thread_ralph',
      from: {
        name: 'Riley Example',
        email: 'riley@customer.example',
      },
      to: [{ name: 'Alex Example', email: 'alex@business.example' }],
      subject: 'Coffee next Friday',
      body: 'Hey User - thanks. I’d love to grab a coffee next Friday.',
    }
    const voice = createVoiceProfileForDraft(
      store,
      message.from,
      'deterministic',
      'Alex Example',
      '2026-06-20T12:00:00.000Z',
    )
    const draft = createAutoDraftForThread(
      thread,
      [message],
      'Alex Example',
      '2026-06-20T12:00:00.000Z',
      voice,
      message.from,
      undefined,
      undefined,
      TEST_LLM_DRAFT_BODY,
    )

    expect(draft?.body).toContain('Hi Riley,\n')
    expect(draft?.body).not.toContain('Hi Riley Example,')
  })

  it('uses a neutral greeting for role addresses and ambiguous names', () => {
    const store = demoMailStore()
    const profile = createVoiceProfileForDraft(
      store,
      { name: 'Support Team', email: 'support@example.com' },
      'deterministic',
      'Alex Example',
      '2026-06-20T12:00:00.000Z',
    )

    expect(profile.greeting).toBe('Hi there,')
  })

  it('uses the configured signature with local retrieval voice profiles', () => {
    const store = {
      ...demoMailStore(),
      drafts: [],
      settings: {
        autoDraftVoiceEngine: 'local-retrieval' as const,
        signature: 'Warmly,\nAdam',
      },
    }

    const withDraft = ensureAutoDraftForThread(
      store,
      'thread_launch',
      TEST_LLM_DRAFT_BODY,
      '2026-06-20T12:00:00.000Z',
    )
    expect(withDraft.drafts[0].voice?.engine).toBe('local-retrieval')
    expect(withDraft.drafts[0].voice?.sampleCount).toBe(1)
    expect(withDraft.drafts[0].body).toContain('Warmly,\nAdam')
  })

  it('learns salutation style from cleaned sent mail and applies it to the recipient', () => {
    const store = {
      ...demoMailStore(),
      messages: [
        ...demoMailStore().messages,
        {
          ...demoMailStore().messages[0],
          id: 'msg_sent_ralph_style',
          threadId: 'thread_sent_ralph_style',
          from: { name: 'Alex Example', email: 'alex@business.example' },
          to: [{ name: 'Riley Example', email: 'riley@customer.example' }],
          subject: 'Re: Coffee',
          body: 'Riley —\n\nGreat, Friday works.\n\nCheers,\nAdam',
          receivedAt: '2026-06-20T10:00:00.000Z',
        },
      ],
      threads: [
        ...demoMailStore().threads,
        {
          ...demoMailStore().threads[0],
          id: 'thread_sent_ralph_style',
          mailboxId: 'mailbox_sent',
          subject: 'Re: Coffee',
          summary: 'Prior sent reply to Riley.',
        },
      ],
    }
    const profile = inferRecipientVoiceProfile(
      store,
      { name: 'Riley Example', email: 'riley@customer.example' },
      'Alex Example',
      '2026-06-20T12:00:00.000Z',
    )

    expect(profile.greeting).toBe('Riley —')
    expect(profile.signoff).toBe('Cheers,\nAdam')
    expect(profile.notes?.join(' ')).toContain('Greeting/sign-off inferred')
  })


  it('selects voice engines through a stable draft profile API', () => {
    const store = demoMailStore()
    const deterministic = createVoiceProfileForDraft(
      store,
      { name: 'Mira', email: 'mira@example.com' },
      'deterministic',
      'Alex Example',
      '2026-06-20T12:00:00.000Z',
    )
    const retrieval = createVoiceProfileForDraft(
      store,
      { name: 'Mira', email: 'mira@example.com' },
      'local-retrieval',
      'Alex Example',
      '2026-06-20T12:00:00.000Z',
    )

    expect(deterministic.engine).toBe('deterministic')
    expect(deterministic.sampleCount).toBe(0)
    expect(retrieval.engine).toBe('local-retrieval')
    expect(retrieval.sampleCount).toBe(1)
  })

  it('creates a generated draft only for an explicit request', () => {
    const store = {
      ...demoMailStore(),
      drafts: [],
      settings: {
        autoDraftVoiceEngine: 'local-retrieval' as const,
        signature: 'Best,\nAdam',
      },
    }

    expect(
      ensureAutoDraftForThread(store, 'thread_launch', TEST_LLM_DRAFT_BODY)
        .drafts,
    ).toHaveLength(1)
  })

})

describe('PureMail reliability safeguards', () => {
  const remoteAttachment = {
    id: 'att_remote',
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    sizeLabel: '2 KB',
    content: 'data:application/pdf;base64,AAAA',
    remote: {
      provider: 'gmail' as const,
      messageId: 'm1',
      attachmentId: 'a1',
    },
  }

  it('keeps threads a fetch failed to retrieve or did not cover instead of treating them as deleted', () => {
    const store = demoMailStore()
    const now = '2026-06-27T12:00:00.000Z'
    const failedThread = {
      ...store.threads[0],
      id: 'thread_failed_fetch',
      lastMessageAt: '2026-06-26T08:00:00.000Z',
    }
    const pastHorizonThread = {
      ...store.threads[0],
      id: 'thread_past_horizon',
      lastMessageAt: '2026-06-22T08:00:00.000Z',
    }
    const removedRemotelyThread = {
      ...store.threads[0],
      id: 'thread_removed_remotely',
      lastMessageAt: '2026-06-26T09:00:00.000Z',
    }
    const current = {
      ...store,
      settings: { ...store.settings, fetchWindow: '7d' as const },
      threads: [failedThread, pastHorizonThread, removedRemotelyThread],
      messages: [],
    }
    const providerStore = {
      ...demoMailStore(),
      threads: [],
      messages: [],
      syncCoverage: {
        coveredFrom: '2026-06-25T00:00:00.000Z',
        failedThreadIds: ['thread_failed_fetch'],
        failedCount: 1,
      },
    }

    const merged = mergeMailProviderSyncResult(current, providerStore, now)
    const mergedIds = merged.threads.map(thread => thread.id)

    expect(mergedIds).toContain('thread_failed_fetch')
    expect(mergedIds).toContain('thread_past_horizon')
    expect(mergedIds).not.toContain('thread_removed_remotely')
    expect(merged.syncCoverage).toBeUndefined()
  })

  it('surfaces new provider mail even when coverage marks the fetch as truncated', () => {
    // Regression guard for "fetch runs but nothing new appears": a provider
    // result WITH syncCoverage must still replace the stale local copy of a
    // refreshed thread and add brand-new threads/messages.
    const store = demoMailStore()
    const now = '2026-06-27T12:00:00.000Z'
    const staleLocalThread = {
      ...store.threads[0],
      id: 'gmail_thread_existing',
      lastMessageAt: '2026-06-26T09:00:00.000Z',
      subject: 'Existing thread (stale local copy)',
    }
    const staleLocalMessage = {
      ...store.messages[0],
      id: 'gmail_msg_old',
      threadId: 'gmail_thread_existing',
      receivedAt: '2026-06-26T09:00:00.000Z',
    }
    const current = {
      ...store,
      settings: { ...store.settings, fetchWindow: '7d' as const },
      threads: [staleLocalThread],
      messages: [staleLocalMessage],
    }
    const refreshedThread = {
      ...staleLocalThread,
      lastMessageAt: '2026-06-27T10:00:00.000Z',
      subject: 'Existing thread (refreshed)',
    }
    const newMessage = {
      ...staleLocalMessage,
      id: 'gmail_msg_new',
      receivedAt: '2026-06-27T10:00:00.000Z',
    }
    const brandNewThread = {
      ...store.threads[0],
      id: 'gmail_thread_brand_new',
      lastMessageAt: '2026-06-27T11:00:00.000Z',
    }
    const brandNewMessage = {
      ...store.messages[0],
      id: 'gmail_msg_brand_new',
      threadId: 'gmail_thread_brand_new',
      receivedAt: '2026-06-27T11:00:00.000Z',
    }
    const providerStore = {
      ...demoMailStore(),
      threads: [refreshedThread, brandNewThread],
      messages: [staleLocalMessage, newMessage, brandNewMessage],
      syncCoverage: {
        coveredFrom: '2026-06-25T00:00:00.000Z',
        failedThreadIds: ['gmail_thread_unrelated_failure'],
        failedCount: 1,
      },
    }

    const merged = reapplyLocalMailChangesSinceSnapshot(
      mergeMailProviderSyncResult(current, providerStore, now),
      current,
      current,
    )

    const mergedExisting = merged.threads.filter(
      thread => thread.id === 'gmail_thread_existing',
    )
    expect(mergedExisting).toHaveLength(1)
    expect(mergedExisting[0]).toMatchObject({
      lastMessageAt: '2026-06-27T10:00:00.000Z',
      subject: 'Existing thread (refreshed)',
    })
    expect(merged.threads.map(thread => thread.id)).toContain(
      'gmail_thread_brand_new',
    )
    const messageIds = merged.messages.map(message => message.id)
    expect(messageIds).toContain('gmail_msg_new')
    expect(messageIds).toContain('gmail_msg_brand_new')
    expect(merged.syncCoverage).toBeUndefined()
  })

  it('does not let an epoch-0 coverage horizon resurrect remotely deleted threads', () => {
    // If a coveredFrom of 1970 (epoch-0 poisoning) ever reached the merge,
    // every local thread would sit "past the horizon" and deleted threads
    // would never drop — while a sane horizon must still drop them.
    const store = demoMailStore()
    const now = '2026-06-27T12:00:00.000Z'
    const removedRemotelyThread = {
      ...store.threads[0],
      id: 'gmail_thread_removed',
      lastMessageAt: '2026-06-26T09:00:00.000Z',
    }
    const current = {
      ...store,
      settings: { ...store.settings, fetchWindow: '7d' as const },
      threads: [removedRemotelyThread],
      messages: [],
    }
    const poisonedProviderStore = {
      ...demoMailStore(),
      threads: [],
      messages: [],
      syncCoverage: { coveredFrom: '1970-01-01T00:00:00.000Z' },
    }

    const merged = mergeMailProviderSyncResult(
      current,
      poisonedProviderStore,
      now,
    )

    expect(merged.threads.map(thread => thread.id)).not.toContain(
      'gmail_thread_removed',
    )
  })

  it('re-applies local read-state and sent messages that changed while a sync was in flight', () => {
    const snapshot = demoMailStore()
    const sentDuringSync: MailMessage = {
      id: 'gmail_msg_local_sent_1',
      threadId: 'thread_launch',
      gmailMessageId: 'local-sent-1',
      from: { name: 'Alex Example', email: 'alex@example.com' },
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Re: Launch copy and rollout notes',
      body: 'Sent while the sync was running.',
      receivedAt: '2026-06-27T12:00:00.000Z',
      attachments: [],
      read: true,
    }
    const current = {
      ...snapshot,
      messages: [
        ...snapshot.messages.map(message =>
          message.id === 'msg_contract_1'
            ? { ...message, read: false }
            : message,
        ),
        sentDuringSync,
      ],
    }
    const merged = demoMailStore()

    const result = reapplyLocalMailChangesSinceSnapshot(
      merged,
      snapshot,
      current,
    )

    expect(
      result.messages.find(message => message.id === 'msg_contract_1')?.read,
    ).toBe(false)
    expect(result.messages.map(message => message.id)).toContain(
      'gmail_msg_local_sent_1',
    )
    expect(
      result.threads.find(thread => thread.id === 'thread_launch')
        ?.lastMessageAt,
    ).toBe('2026-06-27T12:00:00.000Z')
  })

  it('does not duplicate a sent message the fetch already returned', () => {
    const snapshot = demoMailStore()
    const sentDuringSync: MailMessage = {
      id: 'gmail_msg_pending_send',
      threadId: 'thread_launch',
      gmailMessageId: 'sent-99',
      from: { name: 'Alex Example', email: 'alex@example.com' },
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      subject: 'Re: Launch copy and rollout notes',
      body: 'Sent while the sync was running.',
      receivedAt: '2026-06-27T12:00:00.000Z',
      attachments: [],
      read: true,
    }
    const current = { ...snapshot, messages: [...snapshot.messages, sentDuringSync] }
    const fetchedCopy: MailMessage = {
      ...sentDuringSync,
      id: 'gmail_msg_sent-99',
    }
    const merged = {
      ...demoMailStore(),
      messages: [...demoMailStore().messages, fetchedCopy],
    }

    const result = reapplyLocalMailChangesSinceSnapshot(
      merged,
      snapshot,
      current,
    )

    expect(
      result.messages.filter(message => message.gmailMessageId === 'sent-99'),
    ).toHaveLength(1)
  })

  it('returns the merged store untouched when nothing changed during the sync', () => {
    const snapshot = demoMailStore()
    const merged = demoMailStore()

    expect(
      reapplyLocalMailChangesSinceSnapshot(merged, snapshot, snapshot),
    ).toBe(merged)
  })

  it('persists attachment metadata and remote refs but never re-fetchable blob content', () => {
    const store = demoMailStore()
    const localAttachment = {
      id: 'att_local',
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeLabel: '1 KB',
      content: 'inline content',
    }
    const withBlobs = {
      ...store,
      syncCoverage: { failedCount: 1 },
      messages: [
        {
          ...store.messages[0],
          attachments: [remoteAttachment, localAttachment],
        },
        ...store.messages.slice(1),
      ],
      drafts: [
        { ...store.drafts[0], attachments: [remoteAttachment] },
        ...store.drafts.slice(1),
      ],
    }

    const persistable = persistableMailStore(withBlobs)

    expect(persistable.messages[0].attachments[0].content).toBeUndefined()
    expect(persistable.messages[0].attachments[0].remote).toEqual(
      remoteAttachment.remote,
    )
    expect(persistable.messages[0].attachments[1].content).toBe(
      'inline content',
    )
    expect(persistable.drafts[0].attachments[0].content).toBeUndefined()
    expect(persistable.syncCoverage).toBeUndefined()
    expect(withBlobs.messages[0].attachments[0].content).toBe(
      remoteAttachment.content,
    )
  })

  it('rejects malformed persisted stores instead of crashing boot', () => {
    expect(parsePersistedMailStore(null)).toBeNull()
    expect(parsePersistedMailStore('')).toBeNull()
    expect(parsePersistedMailStore('not json')).toBeNull()
    expect(parsePersistedMailStore('"just a string"')).toBeNull()
    expect(parsePersistedMailStore(JSON.stringify({ threads: [] }))).toBeNull()
    expect(
      parsePersistedMailStore(
        JSON.stringify({ ...demoMailStore(), messages: 'corrupt' }),
      ),
    ).toBeNull()
    expect(
      parsePersistedMailStore(
        JSON.stringify({ ...demoMailStore(), settings: null }),
      ),
    ).toBeNull()
  })

  it('drops malformed entries from persisted collections', () => {
    const clean = demoMailStore()
    const raw = JSON.stringify({
      ...clean,
      messages: [...clean.messages, null, 42, { noId: true }],
      drafts: [...clean.drafts, 'junk'],
    })

    const parsed = parsePersistedMailStore(raw)

    expect(parsed?.messages.map(message => message.id)).toEqual(
      clean.messages.map(message => message.id),
    )
    expect(parsed?.drafts).toHaveLength(clean.drafts.length)
  })

  it('reply targets the latest message not sent from the account', () => {
    const store = demoMailStore()
    const inbound = store.messages.find(
      message => message.id === 'msg_launch_1',
    )!
    const ownLater: MailMessage = {
      ...inbound,
      id: 'msg_own_reply',
      from: { name: 'Alex Example', email: 'alex@example.com' },
      receivedAt: '2026-06-27T09:00:00.000Z',
    }

    expect(
      latestInboundMessage([inbound, ownLater], 'alex@example.com')?.id,
    ).toBe('msg_launch_1')
    expect(latestInboundMessage([ownLater], 'alex@example.com')?.id).toBe(
      'msg_own_reply',
    )
    expect(latestInboundMessage([], 'alex@example.com')).toBeNull()
  })

  it('reply-all drafts keep the other recipients on Cc without the account owner', () => {
    // Phase M2 split reply into plain reply (sender only) and reply-all;
    // the keep-everyone-on-Cc guarantee now lives on the reply-all path,
    // which remains createReplyDraft's default for existing callers.
    const store = demoMailStore()
    const thread = store.threads.find(item => item.id === 'thread_launch')!
    const message: MailMessage = {
      ...store.messages.find(item => item.id === 'msg_launch_1')!,
      to: [
        { name: 'Alex Example', email: 'alex@example.com' },
        { name: 'Nadia', email: 'nadia@example.com' },
      ],
      cc: [
        { name: 'Roger', email: 'roger@example.com' },
        { name: 'Mira', email: 'mira@example.com' },
      ],
    }

    expect(replyAllRecipientsForMessage(message, 'alex@example.com')).toEqual({
      to: [{ name: 'Mira', email: 'mira@example.com' }],
      cc: [
        { name: 'Nadia', email: 'nadia@example.com' },
        { name: 'Roger', email: 'roger@example.com' },
      ],
    })

    const draft = createReplyDraft(
      thread,
      message,
      '',
      '2026-06-27T10:00:00.000Z',
      'alex@example.com',
    )
    expect(draft.to).toEqual([{ name: 'Mira', email: 'mira@example.com' }])
    expect(draft.cc).toEqual([
      { name: 'Nadia', email: 'nadia@example.com' },
      { name: 'Roger', email: 'roger@example.com' },
    ])
  })

  it('blocks remote images while leaving inline data images alone', () => {
    const result = blockRemoteImagesInMailHtml(
      '<p>hi</p><img src="https://tracker.example.com/p.gif" alt="">' +
        '<img src="data:image/png;base64,AAAA">' +
        '<img srcset="//tracker.example.com/2x.png 2x">',
    )

    expect(result.blockedCount).toBe(2)
    expect(result.html).not.toContain(' src="https://tracker.example.com/p.gif"')
    expect(result.html).toContain(
      'data-puremail-blocked-src="https://tracker.example.com/p.gif"',
    )
    expect(result.html).toContain(
      'data-puremail-blocked-srcset="//tracker.example.com/2x.png 2x"',
    )
    expect(result.html).toContain('src="data:image/png;base64,AAAA"')
  })

  it('drops style attributes that reference remote urls', () => {
    const result = blockRemoteImagesInMailHtml(
      '<div style="background:url(https://tracker.example.com/bg.png)">x</div>' +
        '<div style="color:red">y</div>',
    )

    expect(result.blockedCount).toBe(1)
    expect(result.html).not.toContain('tracker.example.com')
    expect(result.html).toContain('style="color:red"')
  })

  it('strips legacy background attributes that reference remote urls', () => {
    const result = blockRemoteImagesInMailHtml(
      '<table background="https://tracker.example.com/bg.gif"><tr><td>x</td></tr></table>',
    )

    expect(result.blockedCount).toBe(1)
    expect(result.html).not.toContain('tracker.example.com')
  })
})

describe('phantom sent-message protection', () => {
  const gmailPhantom = {
    id: 'msg_sent_draft1_20260702',
    threadId: 'gmail_thread_abc',
    from: { name: 'Me', email: 'me@x.test' },
    to: [{ name: 'Hong', email: 'hong@x.test' }],
    subject: 'Re: Invitation',
    body: 'hi',
    receivedAt: '2026-07-02T11:35:00.000Z',
    attachments: [],
    read: true,
  }

  it('flags a local send on a real Gmail thread with no confirmed id', () => {
    expect(isUnconfirmedGmailSend(gmailPhantom)).toBe(true)
    expect(
      isUnconfirmedGmailSend({ ...gmailPhantom, gmailMessageId: 'g1' }),
    ).toBe(false)
    expect(
      isUnconfirmedGmailSend({ ...gmailPhantom, threadId: 'local_thread_1' }),
    ).toBe(false)
    expect(
      isUnconfirmedGmailSend({ ...gmailPhantom, id: 'gmail_msg_real' }),
    ).toBe(false)
  })

  it('never persists a Gmail phantom', () => {
    const store = { ...demoMailStore(), messages: [gmailPhantom] }
    const persistable = persistableMailStore(store)
    expect(persistable.messages).toHaveLength(0)
  })

  it('purges a persisted Gmail phantom on load', () => {
    const withPhantom = { ...demoMailStore(), messages: [gmailPhantom] }
    const parsed = parsePersistedMailStore(JSON.stringify(withPhantom))
    expect(parsed?.messages.some(m => m.id === gmailPhantom.id)).toBe(false)
  })
})

describe('isProviderThreadId', () => {
  it('recognises threads the provider owns', () => {
    expect(isProviderThreadId('gmail_thread_18f0a')).toBe(true)
    expect(isProviderThreadId('imap_thread_42')).toBe(true)
  })

  it('treats a locally re-homed draft thread as local', () => {
    // Trashing one of these at Gmail 404s, which used to abort the whole
    // delete and leave the thread stuck in Drafts for good.
    expect(isProviderThreadId('thread_draft_abc123')).toBe(false)
  })
})

describe('selectInviteMirrorCandidates', () => {
  const NOW = new Date('2026-07-01T12:00:00.000Z')
  const inviteOn = (
    store: MailStore,
    messageIndex: number,
    invite: Partial<NonNullable<MailMessage['calendarInvite']>>,
  ): MailStore => ({
    ...store,
    messages: store.messages.map((message, index) =>
      index === messageIndex
        ? {
            ...message,
            // Cast: spreading a Partial widens required props to
            // `T | undefined` under strict spread typing; the helper only
            // ever overrides with complete values.
            calendarInvite: {
              uid: 'uid-1@example.com',
              method: 'REQUEST',
              sequence: 0,
              status: 'confirmed',
              title: 'Review',
              description: '',
              startsAt: '2026-07-02T17:00:00.000Z',
              endsAt: '2026-07-02T17:30:00.000Z',
              timeZone: 'UTC',
              attendees: [],
              ...invite,
            } as NonNullable<MailMessage['calendarInvite']>,
          }
        : message,
    ),
  })

  it('mirrors a current REQUEST once, keyed by uid#sequence#method', () => {
    const store = inviteOn(demoMailStore(), 0, {})
    const first = selectInviteMirrorCandidates(store, NOW)
    expect(first.intents).toHaveLength(1)
    expect(first.intents[0]?.autoCreate).toBe(true)
    expect(first.intents[0]?.response).toBeUndefined()
    expect(first.keys).toEqual(['uid-1@example.com#0#REQUEST'])
    const second = selectInviteMirrorCandidates(
      withMirroredInviteKeys(store, first.keys),
      NOW,
    )
    expect(second.intents).toHaveLength(0)
  })

  it('skips invites whose event ended before the horizon', () => {
    const store = inviteOn(demoMailStore(), 0, {
      startsAt: '2026-06-01T17:00:00.000Z',
      endsAt: '2026-06-01T17:30:00.000Z',
    })
    expect(selectInviteMirrorCandidates(store, NOW).intents).toHaveLength(0)
  })

  it('mirrors a CANCEL for a current event and skips REPLY invites', () => {
    const cancelled = inviteOn(demoMailStore(), 0, { method: 'CANCEL' })
    expect(
      selectInviteMirrorCandidates(cancelled, NOW).keys,
    ).toEqual(['uid-1@example.com#0#CANCEL'])
    const reply = inviteOn(demoMailStore(), 0, { method: 'REPLY' })
    expect(selectInviteMirrorCandidates(reply, NOW).intents).toHaveLength(0)
  })

  it('caps the recorded key list', () => {
    const store = withMirroredInviteKeys(
      { ...demoMailStore(), mirroredInviteKeys: [] },
      Array.from({ length: 600 }, (_, index) => `key-${index}`),
    )
    expect(store.mirroredInviteKeys).toHaveLength(500)
    expect(store.mirroredInviteKeys?.[0]).toBe('key-100')
  })
})

describe('removeProviderAccountData', () => {
  const storeWithGmail = (): MailStore => {
    const base = demoMailStore()
    const demoThread = base.threads[0]
    const gmailThread = { ...demoThread, id: 'gmail_thread_1', accountId: 'acct_gmail' }
    return {
      ...base,
      accounts: [
        ...base.accounts,
        {
          id: 'acct_gmail',
          provider: 'gmail',
          name: 'Gmail',
          email: 'alex@gmail.example',
          syncState: 'online',
        },
      ],
      mailboxes: [
        ...base.mailboxes,
        { id: 'gm_inbox', accountId: 'acct_gmail', name: 'Inbox', role: 'inbox', unreadCount: 1 },
      ],
      threads: [...base.threads, gmailThread],
      messages: [
        ...base.messages,
        { ...base.messages[0], id: 'gmail_msg_1', threadId: 'gmail_thread_1' },
      ],
      drafts: [
        ...base.drafts,
        { ...base.drafts[0], id: 'gmail_draft_1', threadId: 'gmail_thread_1' },
      ],
      starredThreadIds: ['gmail_thread_1', demoThread.id],
      queuedActions: [
        {
          id: 'qa_1',
          type: 'archive',
          threadId: 'gmail_thread_1',
          queuedAt: '2026-08-24T00:00:00.000Z',
          attempts: 0,
        },
      ],
    }
  }

  it('strips the account, its mailbox mirror, and thread-keyed state', () => {
    const store = storeWithGmail()
    const next = removeProviderAccountData(store, 'gmail')
    expect(next.accounts.some(account => account.provider === 'gmail')).toBe(false)
    expect(next.mailboxes.some(mailbox => mailbox.accountId === 'acct_gmail')).toBe(false)
    expect(next.threads.some(thread => thread.id === 'gmail_thread_1')).toBe(false)
    expect(next.messages.some(message => message.threadId === 'gmail_thread_1')).toBe(false)
    expect(next.drafts.some(draft => draft.threadId === 'gmail_thread_1')).toBe(false)
    expect(next.starredThreadIds).toEqual([store.threads[0].id])
    expect(next.queuedActions).toEqual([])
  })

  it('keeps other accounts and tasks untouched', () => {
    const store = storeWithGmail()
    const next = removeProviderAccountData(store, 'gmail')
    expect(next.accounts.length).toBe(store.accounts.length - 1)
    expect(next.threads.length).toBe(store.threads.length - 1)
    expect(next.tasks).toEqual(store.tasks)
  })

  it('is a no-op when no account of that provider exists', () => {
    const store = demoMailStore()
    expect(removeProviderAccountData(store, 'gmail')).toBe(store)
  })
})

describe('pruneOrphanedDraftThreads', () => {
  const filedThread = (id: string) => ({
    ...demoMailStore().threads[0],
    id,
    mailboxId: 'mb_drafts',
    subject: 'Let us catch up',
  })

  it('drops a filed draft thread once its draft is gone', () => {
    const base = demoMailStore()
    const store = {
      ...base,
      threads: [filedThread('thread_draft_old'), ...base.threads],
      drafts: [],
    }

    const pruned = pruneOrphanedDraftThreads(store)

    expect(pruned.threads.some(t => t.id === 'thread_draft_old')).toBe(false)
    expect(pruned.threads).toHaveLength(base.threads.length)
  })

  it('keeps a filed thread that still hosts an unsent draft', () => {
    const base = demoMailStore()
    const draft = createReplyDraft(base.threads[0], base.messages[0])
    const store = {
      ...base,
      threads: [filedThread('thread_draft_live'), ...base.threads],
      drafts: [{ ...draft, threadId: 'thread_draft_live' }],
    }

    expect(
      pruneOrphanedDraftThreads(store).threads.some(
        t => t.id === 'thread_draft_live',
      ),
    ).toBe(true)
  })

  it('never touches a provider thread', () => {
    const base = demoMailStore()
    const store = { ...base, drafts: [] }

    expect(pruneOrphanedDraftThreads(store).threads).toHaveLength(
      base.threads.length,
    )
  })
})

describe('createComposedMessageDraft', () => {
  const recipient = { name: 'Taylor', email: 'taylor@example.com' }

  it('creates an unsent draft on its own thread in Drafts', () => {
    const base = demoMailStore()
    const { draftId, store, threadId } = createComposedMessageDraft(base, {
      body: 'Are you free Tuesday?',
      origin: 'agent',
      subject: 'Coffee next week?',
      to: [recipient],
    })

    const draft = store.drafts.find(item => item.id === draftId)
    const thread = store.threads.find(item => item.id === threadId)
    const draftsMailbox = base.mailboxes.find(box => box.role === 'drafts')

    expect(draft?.sentAt).toBeUndefined()
    expect(draft?.to).toEqual([recipient])
    expect(thread?.mailboxId).toBe(draftsMailbox?.id)
  })

  it('answers no message, so the composer cannot call it a reply', () => {
    const { draftId, store } = createComposedMessageDraft(demoMailStore(), {
      body: 'Hello',
      origin: 'agent',
      subject: 'Hello',
      to: [recipient],
    })

    expect(
      store.drafts.find(item => item.id === draftId)?.sourceMessageId,
    ).toBeUndefined()
  })

  it('marks an agent-composed draft as assistant-authored', () => {
    const { draftId, store } = createComposedMessageDraft(demoMailStore(), {
      body: 'Hello',
      origin: 'agent',
      subject: 'Hello',
      to: [recipient],
    })
    const draft = store.drafts.find(item => item.id === draftId)

    expect(draft?.draftKind).toBe('assistant')
    expect(draft?.source).toBe('auto')
  })

  it('is not a filed reply thread, so the orphan sweep leaves it alone', () => {
    // thread_draft_* is the re-homed-reply prefix that
    // pruneOrphanedDraftThreads deletes; a composed message owns its thread.
    const { store, threadId } = createComposedMessageDraft(demoMailStore(), {
      body: 'Hello',
      origin: 'agent',
      subject: 'Hello',
      to: [recipient],
    })

    expect(isFiledDraftThreadId(threadId)).toBe(false)
    expect(
      pruneOrphanedDraftThreads(store).threads.some(t => t.id === threadId),
    ).toBe(true)
  })
})

describe('local compose threads after a send', () => {
  const account = {
    id: 'acc',
    provider: 'gmail' as const,
    name: 'User',
    email: 'alex@example.com',
    syncState: 'online' as const,
  }
  const mailboxes = [
    {
      id: 'mb_inbox',
      accountId: 'acc',
      name: 'Inbox',
      role: 'inbox' as const,
      unreadCount: 0,
    },
    {
      id: 'mb_sent',
      accountId: 'acc',
      name: 'Sent',
      role: 'sent' as const,
      unreadCount: 0,
    },
    {
      id: 'mb_drafts',
      accountId: 'acc',
      name: 'Drafts',
      role: 'drafts' as const,
      unreadCount: 0,
    },
  ]
  const localThread = {
    id: 'thread_compose_1',
    accountId: 'acc',
    mailboxId: 'mb_sent',
    subject: 'Hello',
    participants: [],
    labels: [],
    status: 'waiting' as const,
    priority: 'none' as const,
    summary: 'Hi Mira',
    lastMessageAt: '2026-08-18T10:05:00.000Z',
    syncState: 'pending' as const,
  }
  const localSend = {
    id: 'msg_sent_local',
    threadId: 'thread_compose_1',
    gmailMessageId: 'gmail-sent-1',
    from: { name: 'User', email: 'alex@example.com' },
    to: [{ name: 'Mira', email: 'mira@example.com' }],
    subject: 'Hello',
    body: 'Hi Mira',
    receivedAt: '2026-08-18T10:05:00.000Z',
    attachments: [],
    read: true,
  }
  const base = (): MailStore => ({
    ...emptyMailStore(),
    accounts: [account],
    mailboxes,
    threads: [localThread],
    messages: [localSend],
  })
  const providerStore = (): MailStore => ({
    ...emptyMailStore(),
    accounts: [account],
    mailboxes,
    threads: [
      {
        ...localThread,
        id: 'gmail_thread_real',
        syncState: 'synced',
        gmailThreadId: 'real',
      },
    ],
    messages: [
      { ...localSend, id: 'gmail_msg_real', threadId: 'gmail_thread_real' },
    ],
  })

  it('drops the local thread once the provider returns the same send', () => {
    const merged = mergeMailProviderSyncResult(
      base(),
      providerStore(),
      new Date('2026-08-18T10:10:00.000Z'),
    )
    expect(merged.threads.map(thread => thread.id)).toEqual([
      'gmail_thread_real',
    ])
    expect(
      merged.messages.some(message => message.threadId === 'thread_compose_1'),
    ).toBe(false)
  })

  it('keeps the local thread while it still holds an unsent draft', () => {
    const store = base()
    const withDraft: MailStore = {
      ...store,
      drafts: [
        {
          id: 'draft_local',
          threadId: 'thread_compose_1',
          to: [],
          subject: 'Hello again',
          body: 'A second message on the same local thread.',
          attachments: [],
          updatedAt: '2026-08-18T10:06:00.000Z',
          syncState: 'pending',
        },
      ],
    }
    const merged = mergeMailProviderSyncResult(
      withDraft,
      providerStore(),
      new Date('2026-08-18T10:10:00.000Z'),
    )
    expect(merged.threads.map(thread => thread.id)).toContain(
      'thread_compose_1',
    )
  })
})

describe('widening a reply draft to reply-all', () => {
  const message = {
    id: 'm1',
    threadId: 't1',
    from: { name: 'Riley', email: 'riley@example.com' },
    to: [
      { name: 'User', email: 'alex@business.example' },
      { name: 'Bryan', email: 'bryan@example.com' },
    ],
    cc: [{ name: 'Morgan', email: 'morgan@example.com' }],
    subject: 'RE: times',
    body: 'hi',
    receivedAt: '2026-08-25T09:00:00.000Z',
    attachments: [],
    read: true,
  } as MailStore['messages'][number]

  const senderOnlyDraft = {
    id: 'draft_1',
    threadId: 't1',
    to: [{ name: 'Riley', email: 'riley@example.com' }],
    cc: [],
    bcc: [],
    subject: 'RE: times',
    body: 'Sure.',
    attachments: [],
    updatedAt: '2026-08-25T09:05:00.000Z',
    syncState: 'synced' as const,
  }

  it('adds everyone the sender-only draft is missing', () => {
    // Reported live: Reply-all on a conversation that already had a reply
    // draft replied to the From address alone.
    const widened = widenDraftToReplyAll(
      senderOnlyDraft,
      message,
      'alex@business.example',
      '2026-08-25T10:00:00.000Z',
    )
    expect(widened.to.map(c => c.email)).toEqual(['riley@example.com'])
    expect(widened.cc?.map(c => c.email)).toEqual([
      'bryan@example.com',
      'morgan@example.com',
    ])
    expect(widened.syncState).toBe('pending')
  })

  it('never drops or reseats recipients the user already has', () => {
    const edited = {
      ...senderOnlyDraft,
      to: [
        { name: 'Riley', email: 'riley@example.com' },
        { name: 'Bryan', email: 'bryan@example.com' },
      ],
      cc: [{ name: 'Someone', email: 'someone@example.com' }],
    }
    const widened = widenDraftToReplyAll(
      edited,
      message,
      'alex@business.example',
      '2026-08-25T10:00:00.000Z',
    )
    // Bryan stays in To rather than being moved to Cc, and the
    // hand-added recipient survives.
    expect(widened.to.map(c => c.email)).toEqual([
      'riley@example.com',
      'bryan@example.com',
    ])
    expect(widened.cc?.map(c => c.email)).toEqual([
      'someone@example.com',
      'morgan@example.com',
    ])
  })

  it('never addresses the account owner', () => {
    const widened = widenDraftToReplyAll(
      senderOnlyDraft,
      message,
      'alex@business.example',
      '2026-08-25T10:00:00.000Z',
    )
    const all = [...widened.to, ...(widened.cc ?? [])].map(c => c.email)
    expect(all).not.toContain('alex@business.example')
  })

  it('is a no-op when everyone is already addressed', () => {
    const complete = {
      ...senderOnlyDraft,
      cc: [
        { name: 'Bryan', email: 'bryan@example.com' },
        { name: 'Morgan', email: 'morgan@example.com' },
      ],
    }
    expect(
      widenDraftToReplyAll(complete, message, 'alex@business.example'),
    ).toBe(complete)
  })
})

describe('merging provider drafts', () => {
  const local = (patch: Partial<MailStore['drafts'][number]> = {}) => ({
    id: 'draft_local',
    threadId: 'gmail_thread_x',
    to: [],
    subject: 'Re: Launch copy',
    body: 'Local text.',
    attachments: [],
    updatedAt: '2026-08-18T11:00:00.000Z',
    syncState: 'synced' as const,
    ...patch,
  })
  const remote = (patch: Partial<MailStore['drafts'][number]> = {}) => ({
    id: 'gmail_draft_r1',
    threadId: 'gmail_thread_x',
    to: [],
    subject: 'Re: Launch copy',
    body: 'Text from the other device.',
    providerDraftId: 'r1',
    attachments: [],
    updatedAt: '2026-08-18T12:00:00.000Z',
    syncState: 'synced' as const,
    ...patch,
  })

  it('never lets the provider re-key a reply draft off its thread', () => {
    // Reported live: started a reply, switched OS windows, came back to
    // "No reply selected" — the draft had been moved to the provider's
    // own thread id, so it no longer matched the open conversation.
    const merged = mergeMailDrafts(
      [local({ providerDraftId: 'r1', threadId: 'imap_thread_real' })],
      [remote({ threadId: 'thread_draft_stray' })],
      true,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.threadId).toBe('imap_thread_real')
  })

  it('does not let an older provider copy overwrite newer local text', () => {
    // The same window switch also blanked the body: the provider still
    // held the empty draft it was first pushed as, and a plain
    // provider-wins merge wrote that back over what had been typed.
    const merged = mergeMailDrafts(
      [
        local({
          providerDraftId: 'r1',
          body: 'Text the user just typed.',
          updatedAt: '2026-08-25T09:00:00.000Z',
        }),
      ],
      [remote({ body: '', updatedAt: '2026-08-25T08:00:00.000Z' })],
      true,
    )
    expect(merged[0]?.body).toBe('Text the user just typed.')
  })

  it('still takes a genuinely newer edit from another device', () => {
    const merged = mergeMailDrafts(
      [local({ providerDraftId: 'r1', updatedAt: '2026-08-25T08:00:00.000Z' })],
      [
        remote({
          body: 'Edited on the phone.',
          updatedAt: '2026-08-25T09:00:00.000Z',
        }),
      ],
      true,
    )
    expect(merged[0]?.body).toBe('Edited on the phone.')
  })

  it('adds drafts the provider has and we do not', () => {
    const merged = mergeMailDrafts([], [remote()], true)
    expect(merged.map(draft => draft.providerDraftId)).toEqual(['r1'])
  })

  it('takes the provider content for a synced draft', () => {
    const merged = mergeMailDrafts(
      [local({ providerDraftId: 'r1' })],
      [remote()],
      true,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('draft_local')
    expect(merged[0].body).toBe('Text from the other device.')
  })

  it('keeps unpushed local edits over the provider copy', () => {
    const merged = mergeMailDrafts(
      [local({ providerDraftId: 'r1', syncState: 'pending' })],
      [remote()],
      true,
    )
    expect(merged[0].body).toBe('Local text.')
  })

  it('drops a synced draft the provider no longer has', () => {
    const merged = mergeMailDrafts([local({ providerDraftId: 'r1' })], [], true)
    expect(merged).toEqual([])
  })

  it('keeps everything when the fetch did not list drafts', () => {
    const drafts = [local({ providerDraftId: 'r1' })]
    expect(mergeMailDrafts(drafts, [], false)).toEqual(drafts)
  })

  it('never touches a draft that has never been pushed', () => {
    const drafts = [local()]
    expect(mergeMailDrafts(drafts, [], true)).toEqual(drafts)
    expect(mergeMailDrafts(drafts, [remote()], true)).toHaveLength(2)
  })
})
