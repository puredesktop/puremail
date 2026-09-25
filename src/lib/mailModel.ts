import {
  calendarDraftResourceId,
  type CalendarDraftIntent,
} from '@purescience/platform-ui/bridge/calendarDraftIntent'
import {
  calendarInviteResourceId,
  type CalendarInviteIntent,
  type CalendarInviteResponse,
} from '@purescience/platform-ui/bridge/calendarInviteIntent'
import { parseCalendarInvite } from './mailCalendarInvite'
import { attachmentTextContent } from './mailAttachments'
import type {
  Attachment,
  AutoDraftVoiceEngine,
  DraftCounterpartyResolution,
  DraftabilityDecision,
  Draft,
  DraftKind,
  EmailVoiceProfile,
  FollowUpSettings,
  MailFetchIntervalMinutes,
  MailFetchWindow,
  MailAccount,
  MailLearningRule,
  MailContact,
  MailMessage,
  MailStore,
  MailTask,
  MailTaskStatus,
  MailThread,
  MailThreadStatus,
  OwnerIdentityRegistry,
  QaDraftOrigin,
  QaDraftStatus,
  RedraftReason,
  RecipientVoiceProfile,
  ReplyIntent,
  SyncState,
  ThreadContextSummary,
} from '../types'
import {
  cleanMailMessageText,
  compactMailText,
  draftRegenerationIndex,
  sourceExcerptForDraft,
  stripHtmlToText,
} from './mailTextUtils'
export {
  blockRemoteImagesInMailHtml,
  demoMailStore,
  demoMailStoreForNow,
  emptyMailStore,
  parsePersistedMailStore,
  parsePersistedMailStoreValue,
  persistableMailStore,
} from './mailStoreData'
export {
  cleanMailMessageText,
  compactMailText,
  readerMailBody,
  stripHtmlToText,
} from './mailTextUtils'
export type { ReaderMailBody } from './mailTextUtils'

export type DateInput = Date | string

export const DEFAULT_FOLLOW_UP_SETTINGS: Required<FollowUpSettings> = {
  defaultDelayDays: 3,
  defaultMode: 'snooze_and_task',
  defaultTaskListId: 'tasklist_mail',
  statusCopy: 'Follow-up applied.',
  replyThresholdWorkingDays: 3,
}

export const DEFAULT_REPLY_DRAFTING_INSTRUCTIONS = [
  'Draft a useful reply to the latest inbound message using the supplied thread context, reply intent, person memory, and voice settings.',
  'Answer the actual ask first: who is asking, what they need, and what the user should provide or decide.',
  'Do not invent facts, dates, attachments, decisions, commitments, or work results. If something is missing, ask for it or say it will be confirmed.',
  'Respect the configured voice, greeting, signoff, tone, length, directness, and format without overriding the reply intent.',
  'When redrafting, preserve the same recipient, ask, facts, and owed response unless the user specifically changes them.',
].join('\n')

export const DEFAULT_MAIL_FETCH_WINDOW: MailFetchWindow = '7d'
export const DEFAULT_MAIL_FETCH_INTERVAL_MINUTES: MailFetchIntervalMinutes = 30
export const DEFAULT_EMAIL_VOICE_PROFILE: Omit<
  EmailVoiceProfile,
  'accountId' | 'updatedAt'
> = {
  id: 'voice_default',
  name: 'My email voice',
  tone: 'warm',
  lengthPreference: 'medium',
  directness: 'balanced',
  formattingPreference: 'paragraphs',
  greetingPreference: '',
  signoffPreference: '',
  avoidPhrases: [],
  examples: [],
}

export interface ReplyNeedClassification {
  needsReply: boolean
  confidence: 'low' | 'medium' | 'high'
  askType: ReplyIntent['askType']
  reason: string
}

export type InboxBulkRouteScope = 'thread' | 'sender' | 'domain' | 'subject'

export interface InboxBulkRouteResult {
  store: MailStore
  matchedCount: number
  rule?: MailLearningRule
}

export interface MailSyncSummary {
  synced: number
  pending: number
  failed: number
  conflict: number
}

export type MailSyncRecoveryAction = 'retry' | 'resolve'

export interface MailTaskSourceTarget {
  thread: MailThread
  message: MailMessage | null
}


export type SuppressedRestoreMode = 'one_off' | 'sender' | 'domain'

export interface SuppressionRescueStats {
  reason: string
  restores: number
  reviewRecommended: boolean
}

export function followUpSettingsForStore(
  store: Pick<MailStore, 'settings'>,
): Required<FollowUpSettings> {
  return {
    ...DEFAULT_FOLLOW_UP_SETTINGS,
    ...(store.settings.followUp ?? {}),
  }
}

export function replyDraftingInstructionsForStore(
  store: Pick<MailStore, 'settings'>,
): string {
  const instructions = store.settings.replyDraftingInstructions?.trim()
  return instructions || DEFAULT_REPLY_DRAFTING_INSTRUCTIONS
}

export function mailFetchWindowForStore(
  store: Pick<MailStore, 'settings'>,
): MailFetchWindow {
  return store.settings.fetchWindow ?? DEFAULT_MAIL_FETCH_WINDOW
}

export function autoFetchEnabledForStore(
  store: Pick<MailStore, 'settings'>,
): boolean {
  return store.settings.autoFetchEnabled ?? true
}

export function mailFetchIntervalMinutesForStore(
  store: Pick<MailStore, 'settings'>,
): MailFetchIntervalMinutes {
  return (
    store.settings.fetchIntervalMinutes ?? DEFAULT_MAIL_FETCH_INTERVAL_MINUTES
  )
}

export function mailFetchWindowLabel(window: MailFetchWindow): string {
  if (window === 'today') return 'today'
  return `last ${window.replace('d', ' days')}`
}

export function mailFetchWindowStartDate(
  window: MailFetchWindow,
  now: DateInput = new Date(),
): Date {
  const start = dateFromInput(now)
  if (window === 'today') {
    start.setHours(0, 0, 0, 0)
    return start
  }
  const days = Number.parseInt(window, 10)
  start.setDate(start.getDate() - days)
  return start
}

export function threadIsInsideFetchWindow(
  store: Pick<MailStore, 'settings'>,
  thread: Pick<MailThread, 'lastMessageAt'>,
  now: DateInput = new Date(),
): boolean {
  const cutoff = mailFetchWindowStartDate(mailFetchWindowForStore(store), now)
  return dateFromInput(thread.lastMessageAt).getTime() >= cutoff.getTime()
}

export function dateFromInput(input: DateInput): Date {
  return input instanceof Date ? new Date(input.getTime()) : new Date(input)
}

export function getThreadTasks(store: MailStore, threadId: string): MailTask[] {
  return store.tasks
    .filter(task => task.source.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function resolveMailTaskSourceTarget(
  store: MailStore,
  task: MailTask,
): MailTaskSourceTarget | null {
  const thread = store.threads.find(item => item.id === task.source.threadId)
  if (!thread) return null
  const message = task.source.messageId
    ? store.messages.find(
        item =>
          item.id === task.source.messageId &&
          item.threadId === task.source.threadId,
      ) ?? null
    : null
  return { thread, message }
}

export function createTaskFromThread(
  thread: MailThread,
  title = `Follow up: ${thread.subject}`,
  now = new Date().toISOString(),
): MailTask {
  return {
    id: `task_${thread.id}_${now.replace(/[^0-9]/g, '')}`,
    taskListId: 'tasklist_mail',
    title,
    notes: `Created from ${thread.subject}.`,
    status: 'open',
    priority: thread.priority === 'none' ? 'medium' : thread.priority,
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    source: {
      type: 'email',
      accountId: thread.accountId,
      threadId: thread.id,
      snippet: thread.summary,
      label: thread.subject,
    },
  }
}

export function createTaskFromMessage(
  thread: MailThread,
  message: MailMessage,
  title = `Reply to ${message.from.name || message.from.email}`,
  now = new Date().toISOString(),
): MailTask {
  const snippet = cleanMailMessageText(message).text.slice(0, 180)
  return {
    ...createTaskFromThread(thread, title, now),
    notes: `Created from ${message.from.name || message.from.email} in ${
      thread.subject
    }.`,
    source: {
      type: 'email',
      accountId: thread.accountId,
      threadId: thread.id,
      messageId: message.id,
      snippet: snippet || thread.summary,
      label: `${thread.subject} · ${message.from.name || message.from.email}`,
    },
  }
}

/**
 * The message a reply should target: the latest one NOT sent from the
 * account itself. Replying to your own latest message self-addresses the
 * draft as soon as you have answered once in the thread.
 */
export function latestInboundMessage(
  messages: MailMessage[],
  ownerEmail: string,
): MailMessage | null {
  const own = ownerEmail.trim().toLowerCase()
  const sorted = [...messages].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt),
  )
  return (
    sorted.find(
      message => !own || message.from.email.trim().toLowerCase() !== own,
    ) ??
    sorted[0] ??
    null
  )
}

/**
 * Reply-all recipients (Gmail semantics): the original sender in To, and
 * everyone else on the message (To + Cc, minus the account owner and the
 * sender) preserved as Cc so nobody silently drops off the conversation.
 */
export function replyAllRecipientsForMessage(
  message: MailMessage,
  ownerEmail: string,
): { to: MailContact[]; cc: MailContact[] } {
  const own = ownerEmail.trim().toLowerCase()
  const senderEmail = message.from.email.trim().toLowerCase()
  const cc: MailContact[] = []
  const seen = new Set([senderEmail, ...(own ? [own] : [])])
  for (const contact of [...message.to, ...(message.cc ?? [])]) {
    const email = contact.email.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    cc.push(contact)
  }
  return { to: [message.from], cc }
}

/**
 * Widen an existing reply draft to reply-all.
 *
 * Pressing Reply-all on a conversation that already has a draft used to
 * open that draft untouched, so the request was silently ignored: a draft
 * started with Reply (or generated for one) stayed addressed to the sender
 * alone, and the user watched "reply all" reply to one person.
 *
 * Widening is additive on purpose. Recipients the user typed are kept, and
 * nobody is ever removed — pressing Reply-all can only ever put more people
 * on the mail, never fewer, which is the direction that cannot lose a
 * conversation. Anyone already addressed stays where they are rather than
 * moving between To and Cc.
 */
export function widenDraftToReplyAll(
  draft: Draft,
  message: MailMessage | null,
  ownerEmail: string,
  now = new Date().toISOString(),
): Draft {
  if (!message) return draft
  const target = replyAllRecipientsForMessage(message, ownerEmail)
  const own = ownerEmail.trim().toLowerCase()
  const key = (contact: MailContact): string => contact.email.trim().toLowerCase()
  const addressed = new Set<string>([
    ...draft.to.map(key),
    ...(draft.cc ?? []).map(key),
    ...(draft.bcc ?? []).map(key),
    ...(own ? [own] : []),
  ])
  const missingTo = target.to.filter(contact => !addressed.has(key(contact)))
  missingTo.forEach(contact => addressed.add(key(contact)))
  const missingCc = target.cc.filter(contact => !addressed.has(key(contact)))
  if (missingTo.length === 0 && missingCc.length === 0) return draft
  return {
    ...draft,
    to: [...draft.to, ...missingTo],
    cc: [...(draft.cc ?? []), ...missingCc],
    updatedAt: now,
    syncState: 'pending',
  }
}

/**
 * Plain-reply recipients (Gmail semantics): just the sender. Replying to
 * your own sent message targets its original recipients instead, so the
 * draft never self-addresses.
 */
export function replyRecipientsForMessage(
  message: MailMessage,
  ownerEmail: string,
): { to: MailContact[]; cc: MailContact[] } {
  const own = ownerEmail.trim().toLowerCase()
  const senderEmail = message.from.email.trim().toLowerCase()
  if (own && senderEmail === own) {
    return { to: message.to, cc: [] }
  }
  return { to: [message.from], cc: [] }
}

export type ReplyDraftMode = 'reply' | 'reply_all'

export function createReplyDraft(
  thread: MailThread,
  message: MailMessage | null,
  signature = '',
  now = new Date().toISOString(),
  ownerEmail = '',
  mode: ReplyDraftMode = 'reply_all',
  /** Seeds the body above the signature; empty keeps today's blank reply. */
  initialBody = '',
): Draft {
  const subject = thread.subject.toLowerCase().startsWith('re:')
    ? thread.subject
    : `Re: ${thread.subject}`
  const recipients = message
    ? mode === 'reply_all'
      ? replyAllRecipientsForMessage(message, ownerEmail)
      : replyRecipientsForMessage(message, ownerEmail)
    : { to: thread.participants, cc: [] }
  const seeded = initialBody.trim()
  return {
    id: `draft_reply_${thread.id}_${now.replace(/[^0-9]/g, '')}`,
    threadId: thread.id,
    to: recipients.to,
    cc: recipients.cc,
    bcc: [],
    subject,
    body: signature ? `${seeded}\n\n${signature}` : seeded,
    attachments: [],
    updatedAt: now,
    syncState: 'pending',
    source: 'manual',
    draftKind: 'manual',
    provenance: seeded
      ? [
          `Created as a reply draft for "${thread.subject}".`,
          'Body seeded from an Ask answer; review before sending.',
        ]
      : [`Created as a reply draft for "${thread.subject}".`],
  }
}

function formatForwardHeader(message: MailMessage): string {
  const to = message.to
    .map(contact => contact.name || contact.email)
    .filter(Boolean)
    .join(', ')
  return [
    '---------- Forwarded message ---------',
    `From: ${message.from.name || message.from.email} <${message.from.email}>`,
    `Date: ${message.receivedAt}`,
    `Subject: ${message.subject}`,
    `To: ${to || 'Undisclosed recipients'}`,
  ].join('\n')
}

export interface ComposedMessageInput {
  accountId?: string
  attachments?: Attachment[]
  bcc?: MailContact[]
  body: string
  bodyHtml?: string
  cc?: MailContact[]
  /** Who wrote it: an agent's message is marked as such in the composer. */
  origin?: 'agent' | 'manual'
  subject: string
  to: MailContact[]
}

/**
 * A brand-new outgoing message: its own thread in Drafts with no inbound
 * message behind it. Replies are drafted against a thread the user already
 * has; this exists so an agent can compose fresh mail without pretending
 * it is answering something. Nothing sends — the draft lands in Drafts for
 * the user to review, edit, send or discard.
 */
export function createComposedMessageDraft(
  store: MailStore,
  input: ComposedMessageInput,
  now = new Date().toISOString(),
): { draftId: string; store: MailStore; threadId: string } {
  const account =
    store.accounts.find(item => item.id === input.accountId) ??
    store.accounts[0]
  const accountId = account?.id ?? 'local'
  const draftsMailboxId =
    store.mailboxes.find(
      mailbox => mailbox.role === 'drafts' && mailbox.accountId === accountId,
    )?.id ??
    store.mailboxes.find(mailbox => mailbox.role === 'drafts')?.id ??
    store.mailboxes[0]?.id ??
    ''
  const stamp = now.replace(/[^0-9]/g, '')
  const draftId = `draft_compose_${stamp}`
  // Deliberately NOT thread_draft_*: that prefix marks a re-homed reply
  // draft, and pruneOrphanedDraftThreads deletes those when their draft
  // goes. A composed message is its own conversation.
  const threadId = `thread_compose_${stamp}`
  const from: MailContact = {
    name: account?.name ?? 'Me',
    email: account?.email ?? '',
  }
  const cc = input.cc ?? []
  const bcc = input.bcc ?? []
  const subject = input.subject.trim() || '(no subject)'
  const byAgent = input.origin === 'agent'
  const thread: MailThread = {
    id: threadId,
    accountId,
    mailboxId: draftsMailboxId,
    subject,
    participants: [from, ...input.to, ...cc, ...bcc],
    labels: [],
    status: 'waiting',
    priority: 'none',
    summary: input.body.trim().slice(0, 160) || 'Draft message',
    lastMessageAt: now,
    syncState: 'pending',
  }
  const draft: Draft = {
    id: draftId,
    threadId,
    to: input.to,
    cc,
    bcc,
    subject,
    body: input.body,
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    attachments: input.attachments ?? [],
    updatedAt: now,
    syncState: 'pending',
    source: byAgent ? 'auto' : 'manual',
    draftKind: byAgent ? 'assistant' : 'manual',
    ...(byAgent ? { qaStatus: 'ready' as const } : {}),
    provenance: [
      byAgent
        ? 'Composed by an agent as a new message. Not sent.'
        : 'Created from Compose.',
    ],
  }
  return {
    draftId,
    threadId,
    store: {
      ...store,
      threads: [thread, ...store.threads],
      drafts: [...store.drafts, draft],
    },
  }
}

export function createForwardDraft(
  thread: MailThread,
  messages: MailMessage[],
  signature = '',
  now = new Date().toISOString(),
): Draft {
  const sortedMessages = [...messages].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt),
  )
  const latestMessage = sortedMessages[sortedMessages.length - 1] ?? null
  const subject = thread.subject.toLowerCase().startsWith('fwd:')
    ? thread.subject
    : `Fwd: ${thread.subject}`
  const forwardedBody = sortedMessages
    .map(message => {
      const cleaned = cleanMailMessageText(message).text || message.body
      return `${formatForwardHeader(message)}\n\n${cleaned}`
    })
    .join('\n\n')
  const bodyParts = [signature, forwardedBody || thread.summary].filter(
    part => part.trim().length > 0,
  )
  return {
    id: `draft_forward_${thread.id}_${now.replace(/[^0-9]/g, '')}`,
    threadId: thread.id,
    to: [],
    cc: [],
    bcc: [],
    subject,
    body: bodyParts.join('\n\n'),
    attachments: latestMessage?.attachments ?? [],
    updatedAt: now,
    syncState: 'pending',
    source: 'manual',
    draftKind: 'manual',
    provenance: [
      `Created as a forward draft for "${thread.subject}".`,
      ...(latestMessage
        ? [`Latest forwarded message: ${latestMessage.id}.`]
        : []),
    ],
  }
}

export function createCalendarDraftIntentFromThread(
  thread: MailThread,
  messages: MailMessage[],
  now = new Date().toISOString(),
): CalendarDraftIntent {
  const resourceId = calendarDraftResourceId(thread.accountId, thread.id)
  const latestMessage = messages
    .filter(message => message.threadId === thread.id)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]
  const descriptionParts = [
    thread.summary,
    latestMessage
      ? `Latest email from ${latestMessage.from.name}: ${latestMessage.body}`
      : '',
    `Source: ${thread.subject} (${thread.id})`,
  ].filter(Boolean)
  return {
    id: `calendar_draft_${thread.id}`,
    resourceId,
    sourceAppSlug: 'mail',
    source: {
      type: 'email',
      accountId: thread.accountId,
      threadId: thread.id,
      label: thread.subject,
      snippet: thread.summary,
    },
    title: thread.subject,
    description: descriptionParts.join('\n\n'),
    attendees: thread.participants.filter(
      participant => participant.email.trim().length > 0,
    ),
    linkedItems: [{ type: 'email', id: thread.id, label: thread.subject }],
    createdAt: now,
  }
}

export function calendarInviteForMessage(
  message: MailMessage,
): MailMessage['calendarInvite'] {
  if (message.calendarInvite) return message.calendarInvite
  const calendarAttachment = message.attachments.find(
    attachment =>
      attachment.mimeType.toLowerCase() === 'text/calendar' ||
      attachment.name.toLowerCase().endsWith('.ics'),
  )
  // Through the text decoder, not the raw field: a Gmail-fetched attachment
  // holds a base64 data: URI, which ICAL cannot parse. The demo's inline ICS
  // text passes through the decoder unchanged.
  const attachmentText = calendarAttachment
    ? attachmentTextContent(calendarAttachment)
    : null
  const attachmentInvite = attachmentText
    ? parseCalendarInvite(attachmentText) ?? undefined
    : undefined
  return attachmentInvite ?? inlineCalendarInviteForMessage(message)
}

function inlineCalendarInviteForMessage(
  message: MailMessage,
): MailMessage['calendarInvite'] {
  const rawBody = compactMailText(
    message.body || stripHtmlToText(message.bodyHtml),
  )
  const text = `${message.subject}\n${rawBody}`
  const hasMeetingLink =
    /https?:\/\/[^\s<>"']*zoom\.us\/j\/[^\s<>"']*/i.test(text) ||
    /\binviting you to a scheduled Zoom meeting\b/i.test(text)
  if (!hasMeetingLink) return undefined

  const timeZone = inlineInviteTimeZone(text)
  const startsAt = inlineInviteStart(text, message.receivedAt, timeZone)
  if (!startsAt) return undefined
  const endsAt = new Date(
    new Date(startsAt).getTime() + 60 * 60 * 1000,
  ).toISOString()
  const meetingUrl = text.match(
    /https?:\/\/[^\s<>"']*zoom\.us\/j\/[^\s<>"']*/i,
  )?.[0]
  const meetingId = text.match(/\bMeeting ID:\s*([0-9 ]+)/i)?.[1]?.trim()
  const passcode = text.match(/\bPasscode:\s*([^\s]+)/i)?.[1]?.trim()
  const title = cleanInlineInviteTitle(message.subject)
  const description = [
    rawBody,
    meetingUrl ? `Zoom: ${meetingUrl}` : '',
    meetingId ? `Meeting ID: ${meetingId}` : '',
    passcode ? `Passcode: ${passcode}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    uid: `inline-${message.id}`,
    method: 'REQUEST',
    sequence: 0,
    status: 'confirmed',
    title,
    description,
    location: meetingUrl ?? 'Zoom',
    startsAt,
    endsAt,
    timeZone,
    organizer: message.from,
    attendees: message.to.map(contact => ({
      ...contact,
      response: 'needsAction',
    })),
    rawSource: `inline:${rawBody}`,
  }
}

function cleanInlineInviteTitle(subject: string): string {
  const cleaned = subject
    .replace(/^(?:re|fw|fwd):\s*/i, '')
    .replace(/[.。…]+$/g, '')
    .trim()
  return cleaned || 'Calendar invite'
}

function inlineInviteTimeZone(text: string): string {
  if (/\b(?:UK|BST)\s*time\b/i.test(text)) return 'Europe/London'
  if (/\bGMT\s*time\b/i.test(text)) return 'Etc/GMT'
  if (/\bCET\s*time\b/i.test(text)) return 'Europe/Paris'
  if (/\bET\s*time\b/i.test(text)) return 'America/New_York'
  if (/\bPT\s*time\b/i.test(text)) return 'America/Los_Angeles'
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function inlineInviteStart(
  text: string,
  receivedAt: string,
  timeZone: string,
): string | null {
  const timeMatch = text.match(
    /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*(?:UK|BST|GMT|ET|PT|CET)\s*time)?/i,
  )
  if (!timeMatch) return null

  const base = datePartsInTimeZone(new Date(receivedAt), timeZone)
  const lowerText = text.toLowerCase()
  let offsetDays = 0
  if (/\btomorrow\b/i.test(text)) {
    offsetDays = 1
  } else {
    const weekdayOffset = inlineInviteWeekdayOffset(lowerText, base.weekday)
    if (weekdayOffset !== null) offsetDays = weekdayOffset
  }
  const baseDate = new Date(Date.UTC(base.year, base.month - 1, base.day))
  baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays)
  const hour12 = Number(timeMatch[1])
  const minute = Number(timeMatch[2] ?? '0')
  const meridiem = timeMatch[3].toLowerCase()
  const hour =
    meridiem === 'pm'
      ? hour12 === 12
        ? 12
        : hour12 + 12
      : hour12 === 12
      ? 0
      : hour12
  return zonedDateTimeToIso(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth() + 1,
    baseDate.getUTCDate(),
    hour,
    minute,
    timeZone,
  )
}

function inlineInviteWeekdayOffset(
  text: string,
  currentWeekday: number,
): number | null {
  const weekdays = [
    ['sunday', 'sun'],
    ['monday', 'mon'],
    ['tuesday', 'tue'],
    ['wednesday', 'wed'],
    ['thursday', 'thu'],
    ['friday', 'fri'],
    ['saturday', 'sat'],
  ]
  const index = weekdays.findIndex(names =>
    names.some(name => new RegExp(`\\b${name}\\b`, 'i').test(text)),
  )
  if (index < 0) return null
  const offset = (index - currentWeekday + 7) % 7
  return offset === 0 ? 7 : offset
}

function datePartsInTimeZone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date)
  const value = (type: string): string =>
    parts.find(part => part.type === type)?.value ?? ''
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    weekday: weekdays.indexOf(value('weekday')),
  }
}

function zonedDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute)
  let utc = wallTimeUtc
  for (let index = 0; index < 3; index += 1) {
    utc = wallTimeUtc - timeZoneOffsetMs(new Date(utc), timeZone)
  }
  return new Date(utc).toISOString()
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: string): string =>
    parts.find(part => part.type === type)?.value ?? '0'
  const asUtc = Date.UTC(
    Number(value('year')),
    Number(value('month')) - 1,
    Number(value('day')),
    Number(value('hour')),
    Number(value('minute')),
    Number(value('second')),
  )
  return asUtc - date.getTime()
}

export function createCalendarInviteIntentFromMessage(
  thread: MailThread,
  message: MailMessage,
  response?: CalendarInviteResponse,
  now = new Date().toISOString(),
  autoCreate = false,
): CalendarInviteIntent | null {
  const invite = calendarInviteForMessage(message)
  if (!invite) return null
  const resourceId = calendarInviteResourceId(
    thread.accountId,
    message.id,
    invite.uid,
  )
  return {
    id: `calendar_invite_${message.id}_${invite.uid.replace(
      /[^a-z0-9_-]/gi,
      '_',
    )}`,
    resourceId,
    sourceAppSlug: 'mail',
    source: {
      type: 'email',
      accountId: thread.accountId,
      threadId: thread.id,
      messageId: message.id,
      label: thread.subject,
      snippet: thread.summary,
    },
    uid: invite.uid,
    method: invite.method,
    sequence: invite.sequence,
    status: invite.status,
    title: invite.title,
    description: invite.description,
    location: invite.location,
    startsAt: invite.startsAt,
    endsAt: invite.endsAt,
    timeZone: invite.timeZone,
    organizer: invite.organizer,
    attendees: invite.attendees,
    recurrenceRule: invite.recurrenceRule,
    response,
    autoCreate,
    createdAt: now,
  }
}

/** How far back a mirrored invite's event may end and still be worth adding. */
const INVITE_MIRROR_HORIZON_MS = 24 * 60 * 60 * 1000

/**
 * The invites in this store that should flow into PureCalendar and have not
 * yet: parsed REQUEST/CANCEL invites whose event is current (ends within the
 * horizon or later — a first sync over an old mailbox must not import years
 * of stale meetings). Pure selection; the caller writes the intents and
 * records the keys. Only provider-parsed invites (`message.calendarInvite`)
 * qualify — the mirror is for accounts whose provider inlines the ICS, and
 * the heavyweight fallback parse has no place in a sync-time sweep.
 */
export function selectInviteMirrorCandidates(
  store: MailStore,
  now = new Date(),
): { intents: CalendarInviteIntent[]; keys: string[] } {
  const mirrored = new Set(store.mirroredInviteKeys ?? [])
  const horizon = now.getTime() - INVITE_MIRROR_HORIZON_MS
  const intents: CalendarInviteIntent[] = []
  const keys: string[] = []
  for (const message of store.messages) {
    const invite = message.calendarInvite
    if (!invite) continue
    if (invite.method !== 'REQUEST' && invite.method !== 'CANCEL') continue
    const key = `${invite.uid}#${invite.sequence}#${invite.method}`
    if (mirrored.has(key) || keys.includes(key)) continue
    const endsMs = Date.parse(invite.endsAt || invite.startsAt)
    if (Number.isFinite(endsMs) && endsMs < horizon) continue
    const thread = store.threads.find(item => item.id === message.threadId)
    if (!thread) continue
    const intent = createCalendarInviteIntentFromMessage(
      thread,
      message,
      undefined,
      now.toISOString(),
      true,
    )
    if (!intent) continue
    intents.push(intent)
    keys.push(key)
  }
  return { intents, keys }
}

/** Record mirrored invite keys, capped so the list cannot grow forever. */
export function withMirroredInviteKeys(
  store: MailStore,
  keys: string[],
): MailStore {
  if (keys.length === 0) return store
  return {
    ...store,
    mirroredInviteKeys: [
      ...(store.mirroredInviteKeys ?? []),
      ...keys,
    ].slice(-500),
  }
}

export function createFollowUpTask(
  thread: MailThread,
  dueAt: string,
  now = new Date().toISOString(),
): MailTask {
  return {
    ...createTaskFromThread(
      thread,
      `Follow up with ${thread.participants[0]?.name ?? 'recipient'}`,
      now,
    ),
    dueAt,
    status: 'waiting',
  }
}

export function updateTaskStatus(
  task: MailTask,
  status: MailTaskStatus,
  now = new Date().toISOString(),
): MailTask {
  return { ...task, status, updatedAt: now, syncState: 'pending' }
}

export function updateMailTask(
  task: MailTask,
  patch: Partial<
    Pick<
      MailTask,
      'taskListId' | 'title' | 'notes' | 'status' | 'priority' | 'dueAt'
    >
  >,
  now = new Date().toISOString(),
): MailTask {
  return {
    ...task,
    ...patch,
    dueAt: patch.dueAt === '' ? undefined : patch.dueAt,
    updatedAt: now,
    syncState: 'pending',
  }
}

export function deleteMailTask(store: MailStore, taskId: string): MailStore {
  return {
    ...store,
    tasks: store.tasks.filter(task => task.id !== taskId),
  }
}

export function attachDraftToTask(
  store: MailStore,
  draftId: string,
  now = new Date().toISOString(),
  /** When to come back to it — the composer's "Reply later" menu sets this. */
  dueAt?: string,
): { store: MailStore; task: MailTask | null; draft: Draft | null } {
  const draft = store.drafts.find(item => item.id === draftId)
  if (!draft) return { store, task: null, draft: null }
  const existingTask = draft.taskId
    ? store.tasks.find(task => task.id === draft.taskId) ?? null
    : null
  if (existingTask) return { store, task: existingTask, draft }

  const thread = store.threads.find(item => item.id === draft.threadId)
  if (!thread) return { store, task: null, draft }

  const latestMessage = latestMessageForThread(store, thread.id)
  const task = {
    ...(latestMessage
      ? createTaskFromMessage(
          thread,
          latestMessage,
          `Reply later: ${thread.subject}`,
          now,
        )
      : createTaskFromThread(thread, `Reply later: ${thread.subject}`, now)),
    notes: `Reply draft ${draft.id} is linked to this task.`,
    ...(dueAt ? { dueAt } : {}),
  }
  const linkedDraft = {
    ...draft,
    taskId: task.id,
    updatedAt: now,
    provenance: [...(draft.provenance ?? []), `Linked to task ${task.id}.`],
  }

  return {
    task,
    draft: linkedDraft,
    store: {
      ...store,
      drafts: store.drafts.map(item =>
        item.id === draft.id ? linkedDraft : item,
      ),
      tasks: [...store.tasks, task],
    },
  }
}

export function archiveThread(
  store: MailStore,
  threadId: string,
  archiveMailboxId = store.mailboxes.find(mailbox => mailbox.role === 'archive')
    ?.id,
): MailStore {
  const thread = store.threads.find(item => item.id === threadId)
  if (thread?.status === 'archived') return store
  return {
    ...store,
    threads: store.threads.map(thread =>
      thread.id === threadId
        ? {
            ...thread,
            archivedFromMailboxId:
              thread.status === 'archived'
                ? thread.archivedFromMailboxId
                : thread.mailboxId,
            archivedFromStatus:
              thread.status === 'archived'
                ? thread.archivedFromStatus
                : thread.status,
            mailboxId: archiveMailboxId ?? thread.mailboxId,
            status: 'archived',
            syncState: 'pending',
          }
        : thread,
    ),
  }
}

export function unarchiveThread(
  store: MailStore,
  threadId: string,
  inboxMailboxId = store.mailboxes.find(mailbox => mailbox.role === 'inbox')
    ?.id,
): MailStore {
  const validMailboxIds = new Set(store.mailboxes.map(mailbox => mailbox.id))
  const validStatuses = new Set<MailThreadStatus>([
    'inbox',
    'waiting',
    'done',
    'snoozed',
  ])
  return {
    ...store,
    threads: store.threads.map(thread => {
      if (thread.id !== threadId) return thread
      const restoredMailboxId =
        thread.archivedFromMailboxId &&
        validMailboxIds.has(thread.archivedFromMailboxId)
          ? thread.archivedFromMailboxId
          : inboxMailboxId ?? thread.mailboxId
      const restoredStatus =
        thread.archivedFromStatus &&
        validStatuses.has(thread.archivedFromStatus)
          ? thread.archivedFromStatus
          : 'inbox'
      return {
        ...thread,
        mailboxId: restoredMailboxId,
        status: restoredStatus,
        archivedFromMailboxId: undefined,
        archivedFromStatus: undefined,
        syncState: 'pending',
      }
    }),
  }
}

export function moveThread(
  store: MailStore,
  threadId: string,
  mailboxId: string,
): MailStore {
  return {
    ...store,
    threads: store.threads.map(thread =>
      thread.id === threadId
        ? { ...thread, mailboxId, syncState: 'pending' }
        : thread,
    ),
  }
}

/** Thread id prefixes minted by a mail provider, not by this app. */
const PROVIDER_THREAD_PREFIXES = ['gmail_thread_', 'imap_thread_']

/** Prefix of the synthetic thread that hosts a Drafts-filed draft. */
const FILED_DRAFT_THREAD_PREFIX = 'thread_draft_'

export function isFiledDraftThreadId(threadId: string): boolean {
  return threadId.startsWith(FILED_DRAFT_THREAD_PREFIX)
}

/**
 * Drop Drafts-filed threads that no longer host a draft. Such a thread only
 * exists to carry its draft, so once the draft is discarded (or regenerated
 * under a new id) it is an empty entry in Drafts that opens to "No message
 * selected" and cannot be got rid of. Reconstructing the id from the draft
 * id missed exactly that regenerated case, so membership is decided by what
 * the remaining drafts actually reference.
 */
export function pruneOrphanedDraftThreads(store: MailStore): MailStore {
  const hosted = new Set(
    store.drafts.filter(draft => !draft.sentAt).map(draft => draft.threadId),
  )
  // A send-run thread (`thread_run_*`) exists to carry its rendered draft;
  // once that draft is gone it stays only while a sent copy lives on it.
  const withMessages = new Set(store.messages.map(message => message.threadId))
  const threads = store.threads.filter(thread => {
    if (isFiledDraftThreadId(thread.id)) return hosted.has(thread.id)
    if (thread.id.startsWith('thread_run_')) {
      return hosted.has(thread.id) || withMessages.has(thread.id)
    }
    return true
  })
  return threads.length === store.threads.length ? store : { ...store, threads }
}

/**
 * Whether a thread exists at the provider. Threads this app creates locally
 * — a re-homed draft is `thread_draft_<draftId>` — were never known to
 * Gmail or IMAP, so asking the provider to trash one fails, and a delete
 * that requires the provider to succeed first can never remove it. Those
 * threads are deleted locally instead.
 */
export function isProviderThreadId(threadId: string): boolean {
  return PROVIDER_THREAD_PREFIXES.some(prefix => threadId.startsWith(prefix))
}

/**
 * Remove every account of a provider and the local mirror of its mailbox:
 * mailboxes, threads, messages, drafts, and all thread-keyed state. This is
 * what "deactivate" means for a synced account — the remote mailbox is
 * untouched, the local copy is gone. Tasks stay: they are user work items,
 * not mail data, and survive their source thread disappearing.
 */
export function removeProviderAccountData(
  store: MailStore,
  provider: MailAccount['provider'],
): MailStore {
  const removedAccountIds = new Set(
    store.accounts
      .filter(account => account.provider === provider)
      .map(account => account.id),
  )
  if (removedAccountIds.size === 0) return store
  const removedThreadIds = new Set(
    store.threads
      .filter(thread => removedAccountIds.has(thread.accountId))
      .map(thread => thread.id),
  )
  const keepThread = (threadId: string): boolean =>
    !removedThreadIds.has(threadId)
  return {
    ...store,
    accounts: store.accounts.filter(
      account => !removedAccountIds.has(account.id),
    ),
    mailboxes: store.mailboxes.filter(
      mailbox => !removedAccountIds.has(mailbox.accountId),
    ),
    threads: store.threads.filter(thread => keepThread(thread.id)),
    messages: store.messages.filter(message => keepThread(message.threadId)),
    drafts: store.drafts.filter(draft => keepThread(draft.threadId)),
    starredThreadIds: (store.starredThreadIds ?? []).filter(keepThread),
    pinnedThreadIds: (store.pinnedThreadIds ?? []).filter(keepThread),
    snoozes: (store.snoozes ?? []).filter(snooze =>
      keepThread(snooze.threadId),
    ),
    queuedActions: (store.queuedActions ?? []).filter(action =>
      keepThread(action.threadId),
    ),
    scheduledSends: (store.scheduledSends ?? []).filter(send =>
      keepThread(send.threadId),
    ),
    threadContextSummaries: (store.threadContextSummaries ?? []).filter(
      summary => keepThread(summary.threadId),
    ),
  }
}

export function deleteThread(
  store: MailStore,
  threadId: string,
  trashMailboxId = store.mailboxes.find(mailbox => mailbox.role === 'trash')
    ?.id,
): MailStore {
  return {
    ...store,
    threads: store.threads.map(thread =>
      thread.id === threadId
        ? {
            ...thread,
            mailboxId: trashMailboxId ?? thread.mailboxId,
            status: 'archived',
            syncState: 'pending',
          }
        : thread,
    ),
  }
}

export function labelThread(
  store: MailStore,
  threadId: string,
  labelId: string,
): MailStore {
  const label = store.labels.find(item => item.id === labelId)
  const labelName = label?.name ?? labelId
  return {
    ...store,
    threads: store.threads.map(thread =>
      thread.id === threadId && !thread.labels.includes(labelName)
        ? {
            ...thread,
            labels: [...thread.labels, labelName],
            syncState: 'pending',
          }
        : thread,
    ),
  }
}

export function markThreadRead(
  store: MailStore,
  threadId: string,
  read: boolean,
): MailStore {
  return {
    ...store,
    messages: store.messages.map(message =>
      message.threadId === threadId ? { ...message, read } : message,
    ),
    threads: store.threads.map(thread =>
      thread.id === threadId ? { ...thread, syncState: 'pending' } : thread,
    ),
  }
}

export function snoozeThread(
  store: MailStore,
  threadId: string,
  until: string,
): MailStore {
  return {
    ...store,
    threads: store.threads.map(thread =>
      thread.id === threadId
        ? {
            ...thread,
            status: 'snoozed',
            snoozedUntil: until,
            syncState: 'pending',
          }
        : thread,
    ),
  }
}

export function updateDraftBody(
  draft: Draft,
  body: string,
  now = new Date().toISOString(),
): Draft {
  return { ...draft, body, updatedAt: now, syncState: 'pending' }
}

export function mailSyncSummary(store: MailStore): MailSyncSummary {
  const summary: MailSyncSummary = {
    synced: 0,
    pending: 0,
    failed: 0,
    conflict: 0,
  }
  for (const item of [...store.threads, ...store.tasks, ...store.drafts]) {
    summary[item.syncState] += 1
  }
  return summary
}

function recoveredMailSyncState(
  syncState: SyncState,
  action: MailSyncRecoveryAction,
): SyncState {
  if (action === 'retry') {
    return syncState === 'failed' || syncState === 'conflict'
      ? 'pending'
      : syncState
  }
  return syncState === 'failed' || syncState === 'conflict'
    ? 'synced'
    : syncState
}

export function recoverMailThreadSync(
  store: MailStore,
  threadId: string,
  action: MailSyncRecoveryAction,
): MailStore {
  return {
    ...store,
    threads: store.threads.map(thread =>
      thread.id === threadId
        ? {
            ...thread,
            syncState: recoveredMailSyncState(thread.syncState, action),
          }
        : thread,
    ),
  }
}

export function recoverMailTaskSync(
  store: MailStore,
  taskId: string,
  action: MailSyncRecoveryAction,
): MailStore {
  return {
    ...store,
    tasks: store.tasks.map(task =>
      task.id === taskId
        ? { ...task, syncState: recoveredMailSyncState(task.syncState, action) }
        : task,
    ),
  }
}

export function recoverMailDraftSync(
  store: MailStore,
  draftId: string,
  action: MailSyncRecoveryAction,
): MailStore {
  return {
    ...store,
    drafts: store.drafts.map(draft =>
      draft.id === draftId
        ? {
            ...draft,
            syncState: recoveredMailSyncState(draft.syncState, action),
          }
        : draft,
    ),
  }
}

export function retryMailSyncFailures(store: MailStore): MailStore {
  return {
    ...store,
    threads: store.threads.map(thread => ({
      ...thread,
      syncState: recoveredMailSyncState(thread.syncState, 'retry'),
    })),
    tasks: store.tasks.map(task => ({
      ...task,
      syncState: recoveredMailSyncState(task.syncState, 'retry'),
    })),
    drafts: store.drafts.map(draft => ({
      ...draft,
      syncState: recoveredMailSyncState(draft.syncState, 'retry'),
    })),
  }
}

export function draftKindForDraft(draft: Draft): DraftKind {
  if (draft.draftKind) return draft.draftKind
  if (draft.source === 'auto') return 'auto_reply'
  return 'manual'
}

export function isGeneratedDraft(draft: Draft): boolean {
  return draftKindForDraft(draft) !== 'manual'
}

export function qaStatusForDraft(draft: Draft): QaDraftStatus | null {
  if (!isGeneratedDraft(draft)) return null
  return draft.qaStatus ?? 'ready'
}

export function isReadyQaDraft(draft: Draft): boolean {
  return qaStatusForDraft(draft) === 'ready'
}

export function qaDraftsForStore(store: MailStore): Draft[] {
  return store.drafts
    .filter(isGeneratedDraft)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function pendingQaDraftsForStore(store: MailStore): Draft[] {
  return qaDraftsForStore(store).filter(
    draft => draft.qaStatus === 'pending' || draft.qaStatus === 'failed',
  )
}

function createQaRequestId(threadId: string, now: string): string {
  return `qa_request_${threadId}_${now.replace(/[^0-9]/g, '')}`
}

/**
 * Generated-draft ids are unique, not reconstructible from the thread.
 *
 * They used to be `autodraft_<threadId>`. Anything that later asked for a
 * draft on that thread and failed to find the existing one rebuilt the same
 * id, and the id collision overwrote the finished draft with an empty
 * placeholder. An id nothing can guess turns "I lost track of the draft" into
 * a second draft — visible, recoverable — instead of a destroyed one.
 */
function createQaDraftId(threadId: string, now: string): string {
  const stamp = now.replace(/[^0-9]/g, '')
  const salt = Math.random().toString(36).slice(2, 8)
  return `autodraft_${threadId}_${stamp}_${salt}`
}

function createPendingQaDraft(
  store: MailStore,
  threadId: string,
  origin: QaDraftOrigin,
  now: string,
  options: {
    force?: boolean
    requestId?: string
    previousDraft?: Draft
    draftId?: string
  } = {},
): Draft | null {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) return null
  const account = store.accounts.find(item => item.id === thread.accountId)
  const latest = latestThreadMessage(store.messages, thread.id)
  const draftability = classifyDraftability(store, thread)
  const recipient = draftability.counterparty ?? latest?.from
  return {
    id:
      options.previousDraft?.id ??
      options.draftId ??
      createQaDraftId(threadId, now),
    threadId,
    to: recipient ? [recipient] : [],
    subject: `Re: ${thread.subject}`,
    body: options.previousDraft?.body ?? '',
    attachments: options.previousDraft?.attachments ?? [],
    updatedAt: now,
    syncState: 'pending',
    source: 'auto',
    draftKind: options.previousDraft?.draftKind ?? 'auto_reply',
    qaStatus: 'pending',
    qaOrigin: origin,
    qaRequestId: options.requestId ?? createQaRequestId(threadId, now),
    qaForced: options.force ?? options.previousDraft?.qaForced ?? false,
    confidence: options.previousDraft?.confidence,
    taskId: options.previousDraft?.taskId,
    memoryDisabled: options.previousDraft?.memoryDisabled,
    provenance: [
      ...(options.previousDraft?.provenance ?? []),
      `Queued for QA at ${now}.`,
      account?.email ? `Account: ${account.email}.` : '',
    ].filter(Boolean),
  }
}

export function enqueueQaDraftRequest(
  store: MailStore,
  threadId: string,
  origin: QaDraftOrigin,
  now = new Date().toISOString(),
  options: {
    force?: boolean
    requestId?: string
    previousDraftId?: string
    /**
     * The id the new draft must take. Callers that have to report the draft
     * back — the agent tools — mint it up front rather than fishing it out of
     * the resulting store, which is guesswork the moment two requests overlap.
     */
    draftId?: string
  } = {},
): { store: MailStore; requestId: string | null; draft: Draft | null } {
  const previousDraft = options.previousDraftId
    ? store.drafts.find(draft => draft.id === options.previousDraftId)
    : undefined
  const existing = store.drafts.find(
    draft => draft.threadId === threadId && isGeneratedDraft(draft),
  )
  const draft =
    previousDraft ??
    existing ??
    createPendingQaDraft(store, threadId, origin, now, {
      force: options.force,
      requestId: options.requestId,
      ...(options.draftId ? { draftId: options.draftId } : {}),
    })
  if (!draft) return { store, requestId: null, draft: null }
  const requestId =
    options.requestId ?? draft.qaRequestId ?? createQaRequestId(threadId, now)
  const nextDraft: Draft = {
    ...draft,
    qaStatus: 'pending',
    qaOrigin: origin,
    qaRequestId: requestId,
    qaForced: options.force ?? draft.qaForced ?? false,
    qaError: undefined,
    updatedAt: now,
    syncState: 'pending',
  }
  const hasDraft = store.drafts.some(item => item.id === nextDraft.id)
  return {
    store: {
      ...store,
      drafts: hasDraft
        ? store.drafts.map(item =>
            item.id === nextDraft.id ? nextDraft : item,
          )
        : [...store.drafts, nextDraft],
    },
    requestId,
    draft: nextDraft,
  }
}

export function updateDraftFields(
  draft: Draft,
  patch: Partial<
    Pick<
      Draft,
      | 'to'
      | 'cc'
      | 'bcc'
      | 'subject'
      | 'body'
      | 'attachments'
      | 'memoryDisabled'
    >
  >,
  now = new Date().toISOString(),
): Draft {
  return {
    ...draft,
    ...patch,
    updatedAt: now,
    syncState: 'pending',
  }
}

function senderDomain(email?: string): string {
  return email?.split('@')[1]?.toLowerCase().trim() ?? ''
}

function normalizePersonName(name?: string): string {
  return name?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
}

function emailAliasRoot(email: string): string {
  const normalized = normalizeEmail(email)
  const [local = '', domain = ''] = normalized.split('@')
  return `${local.split('+')[0]}@${domain}`
}

export function ownerIdentityRegistryForStore(
  store: MailStore,
): OwnerIdentityRegistry {
  const emails = new Set<string>()
  const names = new Set<string>()

  store.accounts.forEach(account => {
    if (account.email) emails.add(normalizeEmail(account.email))
    if (account.name) names.add(normalizePersonName(account.name))
  })

  store.settings.ownerIdentities?.emails?.forEach(email => {
    if (email) emails.add(normalizeEmail(email))
  })
  store.settings.ownerIdentities?.names?.forEach(name => {
    if (name) names.add(normalizePersonName(name))
  })

  return {
    emails: [...emails].filter(Boolean),
    names: [...names].filter(Boolean),
  }
}

function isOwnerEmail(email: string, registry: OwnerIdentityRegistry): boolean {
  const normalized = normalizeEmail(email)
  const aliasRoot = emailAliasRoot(normalized)
  return registry.emails.some(ownerEmail => {
    const normalizedOwner = normalizeEmail(ownerEmail)
    return (
      normalizedOwner === normalized ||
      emailAliasRoot(normalizedOwner) === aliasRoot
    )
  })
}

export function isOwnerContact(
  contact: MailContact | undefined,
  registry: OwnerIdentityRegistry,
): boolean {
  if (!contact) return false
  if (contact.email && isOwnerEmail(contact.email, registry)) return true
  const name = normalizePersonName(contact.name)
  return Boolean(name && registry.names.includes(name))
}

export function resolveDraftCounterparty(
  store: MailStore,
  thread: MailThread,
): DraftCounterpartyResolution {
  const registry = ownerIdentityRegistryForStore(store)
  const threadMessages = store.messages
    .filter(message => message.threadId === thread.id)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const counterpartyMessage = threadMessages.find(
    message => !isOwnerContact(message.from, registry),
  )
  const counterparty =
    counterpartyMessage?.from ??
    thread.participants.find(
      participant => !isOwnerContact(participant, registry),
    ) ??
    null
  const isOwnerOnly = !counterparty
  return {
    counterparty,
    isOwnerOnly,
    draftableRecipient: Boolean(
      counterparty && !isOwnerContact(counterparty, registry),
    ),
  }
}

function latestThreadMessage(
  messages: MailMessage[],
  threadId: string,
): MailMessage | undefined {
  return messages
    .filter(message => message.threadId === threadId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]
}

function activeLearningRules(store: MailStore): MailLearningRule[] {
  return (store.learningRules ?? []).filter(rule => rule.enabled)
}

function draftSuppressionRuleForMessage(
  store: MailStore,
  message: MailMessage | undefined,
): MailLearningRule | undefined {
  if (!message) return undefined
  const email = normalizeEmail(message.from.email)
  const domain = senderDomain(email)
  const subject = message.subject.toLowerCase()
  return activeLearningRules(store).find(rule => {
    if (rule.kind !== 'suppress_drafting' || rule.action !== 'suppress')
      return false
    if (rule.scope === 'sender') return normalizeEmail(rule.value) === email
    if (rule.scope === 'domain') return rule.value.toLowerCase() === domain
    if (rule.scope === 'subject_pattern') {
      return subject.includes(rule.value.toLowerCase())
    }
    return false
  })
}

function draftAllowRuleForMessage(
  store: MailStore,
  message: MailMessage | undefined,
): MailLearningRule | undefined {
  if (!message) return undefined
  const email = normalizeEmail(message.from.email)
  const domain = senderDomain(email)
  const subject = message.subject.toLowerCase()
  return activeLearningRules(store).find(rule => {
    if (rule.kind !== 'suppress_drafting' || rule.action !== 'allow')
      return false
    if (rule.scope === 'sender') return normalizeEmail(rule.value) === email
    if (rule.scope === 'domain') return rule.value.toLowerCase() === domain
    if (rule.scope === 'subject_pattern') {
      return subject.includes(rule.value.toLowerCase())
    }
    return false
  })
}

export function classifyDraftability(
  store: MailStore,
  thread: MailThread,
): DraftabilityDecision {
  const latest = latestThreadMessage(store.messages, thread.id)
  const counterparty = resolveDraftCounterparty(store, thread)
  const cleaned = cleanMailMessageText(latest)
  if (!counterparty.draftableRecipient) {
    return {
      draftable: false,
      reason: 'No counterparty other than you.',
      counterparty: null,
      isOwnerOnly: counterparty.isOwnerOnly,
      draftableRecipient: false,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  const registry = ownerIdentityRegistryForStore(store)
  if (latest && isOwnerContact(latest.from, registry)) {
    return {
      draftable: false,
      reason: 'Latest message is from you; no inbound reply is needed.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  const allowRule = draftAllowRuleForMessage(store, latest)
  const learnedRule = allowRule
    ? undefined
    : draftSuppressionRuleForMessage(store, latest)
  if (!allowRule && learnedRule) {
    return {
      draftable: false,
      reason: `Suppressed by learned ${learnedRule.scope} rule: ${learnedRule.value}.`,
      matchedRuleId: learnedRule.id,
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  const sender = latest?.from
  const senderEmail = normalizeEmail(sender?.email ?? '')
  const senderName = sender?.name.toLowerCase() ?? ''
  const domain = senderDomain(senderEmail)
  const text =
    `${thread.subject}\n${thread.summary}\n${cleaned.text}`.toLowerCase()

  if (
    !allowRule &&
    (senderEmail.startsWith('no-reply@') ||
      senderEmail.startsWith('noreply@') ||
      senderEmail.includes('notifications@') ||
      senderEmail.includes('notification@') ||
      senderName.includes('[bot]') ||
      senderEmail.includes('[bot]') ||
      senderEmail.endsWith('github.com') ||
      senderEmail.endsWith('replit.com') ||
      domain.includes('sendgrid.net'))
  ) {
    return {
      draftable: false,
      reason: `Automated sender ${
        senderEmail || senderName || 'unknown sender'
      }.`,
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  if (
    !allowRule &&
    /\b(auto-submitted|list-unsubscribe|unsubscribe|mailing list)\b/i.test(text)
  ) {
    return {
      draftable: false,
      reason: 'Bulk or automated mail signal.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  if (
    !allowRule &&
    /\b(receipt|invoice|payment|reservation|successfully published|published successful|security alert|verification code|calendar invite|invitation:|updated invitation:|cancelled:)\b/i.test(
      text,
    )
  ) {
    return {
      draftable: false,
      reason: 'Transactional notification; no personal reply expected.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  const commercialOutreachSignal =
    /\b(trial extension|your trial|best practices|configuration tips?|getting started|book (?:a )?(?:call|demo)|schedule (?:a )?(?:call|demo|time)|calendar link|connect with us|interested in (?:a|an|the|our|your)?|your team would be interested|your team can|get more from|learn more|free trial|sales team|demo)\b/i.test(
      text,
    ) || /https?:\/\/scheduler\./i.test(cleaned.text)
  const personalAccountAction =
    /\b(i changed|i updated|i fixed|i enabled|i increased|i sent|i attached|i introduced|copy me in|can you confirm|could you confirm|please confirm|does that work|is that ok)\b/i.test(
      text,
    )
  if (!allowRule && commercialOutreachSignal && !personalAccountAction) {
    return {
      draftable: false,
      reason:
        'Product or promotional announcement; no personal reply expected.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  if (
    !allowRule &&
    /\b(introducing|announcing|now in|new feature|product update|launch|marketplace|trial|best practices|configuration|api:|high-throughput|document processing|your team can now|starting today|available now|get started|learn more)\b/i.test(
      text,
    ) &&
    !/\b(can you|could you|please reply|let me know|do you approve|need your|needs confirmation|confirm|approve)\b/i.test(
      text,
    )
  ) {
    return {
      draftable: false,
      reason:
        'Product or promotional announcement; no personal reply expected.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  if (cleaned.text.length < 24) {
    return {
      draftable: false,
      reason: 'No substantive cleaned content to draft from.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  const asksForResponse =
    /\b(can you|could you|would you|can we|could we|would we|please reply|let me know|what do you think|do you approve|need your|needs confirmation|confirm|approve|does that work|would that work|is that ok|is that okay|are you ok with|are you okay with|should i|can i)\b/i.test(
      text,
    ) ||
    /\b(?:user|you|your)\b[^?]{0,120}\?/i.test(cleaned.text || thread.summary)

  if (!asksForResponse) {
    return {
      draftable: false,
      reason: 'No clear request for a response.',
      counterparty: counterparty.counterparty,
      isOwnerOnly: false,
      draftableRecipient: true,
      cleanedTextLength: cleaned.text.length,
      stripped: cleaned.stripped,
    }
  }

  return {
    draftable: true,
    reason: allowRule
      ? `Allowed by learned ${allowRule.scope} rule: ${allowRule.value}.`
      : 'Message appears to request a response.',
    ...(allowRule ? { matchedAllowRuleId: allowRule.id } : {}),
    counterparty: counterparty.counterparty,
    isOwnerOnly: false,
    draftableRecipient: true,
    cleanedTextLength: cleaned.text.length,
    stripped: cleaned.stripped,
  }
}


export function latestMessageForThread(
  store: MailStore,
  threadId: string,
): MailMessage | null {
  return (
    store.messages
      .filter(message => message.threadId === threadId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] ?? null
  )
}

export function draftSourceChangedSinceCreation(
  store: MailStore,
  draft: Draft,
): boolean {
  const latestMessage = latestMessageForThread(store, draft.threadId)
  if (!latestMessage) return false
  if (draft.sourceMessageId) return latestMessage.id !== draft.sourceMessageId
  return latestMessage.receivedAt > draft.updatedAt
}

export function updateDraftAttachments(
  draft: Draft,
  attachments: Attachment[],
  now = new Date().toISOString(),
): Draft {
  return { ...draft, attachments, updatedAt: now, syncState: 'pending' }
}

export function appendDraftAttachments(
  draft: Draft,
  attachments: Attachment[],
  now = new Date().toISOString(),
): Draft {
  if (!attachments.length) return draft
  return updateDraftAttachments(
    draft,
    [...draft.attachments, ...attachments],
    now,
  )
}

export function removeDraftAttachment(
  draft: Draft,
  attachmentId: string,
  now = new Date().toISOString(),
): Draft {
  return updateDraftAttachments(
    draft,
    draft.attachments.filter(attachment => attachment.id !== attachmentId),
    now,
  )
}

/**
 * True for a locally-appended send on a REAL provider thread that the server
 * has never confirmed with a message id. These are phantoms — a send that
 * either never left the machine or whose real synced copy supersedes it —
 * and must never persist or be shown as sent history. The structural check
 * (provider thread + local `msg_sent_` id + no confirmed id) also catches
 * legacy phantoms written before the `optimistic` flag existed.
 *
 * IMAP sends have no server-confirmed id at all (SMTP returns none), so
 * their local copy is ALWAYS a phantom here: the authoritative sent history
 * is the Sent folder the provider appends to, fetched on the next sync.
 * Covering only `gmail_thread_` would have re-grown the duplicate-sent bug
 * on every IMAP account, one provider later.
 */
export function isUnconfirmedGmailSend(message: MailMessage): boolean {
  return (
    (message.threadId.startsWith('gmail_thread_') ||
      message.threadId.startsWith('imap_thread_')) &&
    message.id.startsWith('msg_sent_') &&
    !message.gmailMessageId
  )
}

export function sendDraft(
  store: MailStore,
  draftId: string,
  now = new Date().toISOString(),
  options: {
    appendMessage?: boolean
    keepDraft?: boolean
    sentMessageId?: string
    /**
     * The provider-confirmed server (Gmail) message id for this send. Present
     * → the appended message is a CONFIRMED send that dedups against the real
     * synced copy. Absent → the appended message is marked `optimistic`: a
     * "Sending…" placeholder that is never persisted and must never be shown
     * as sent history.
     */
    sentGmailMessageId?: string
    sentWithoutReview?: boolean
    sentByAutomation?: boolean
    sentReviewBypassReason?: string
  } = {},
): MailStore {
  const draft = store.drafts.find(item => item.id === draftId)
  if (!draft) return store
  const thread = store.threads.find(item => item.id === draft.threadId)
  const account = thread
    ? store.accounts.find(item => item.id === thread.accountId)
    : store.accounts[0]
  const confirmedGmailId = options.sentGmailMessageId?.trim() || undefined
  const message: MailMessage = {
    id: `msg_sent_${draft.id}_${now.replace(/[^0-9]/g, '')}`,
    threadId: draft.threadId,
    ...(confirmedGmailId
      ? { gmailMessageId: confirmedGmailId }
      : { optimistic: true }),
    from: {
      name: account?.name ?? 'Me',
      email: account?.email ?? '',
    },
    to: draft.to,
    cc: draft.cc ?? [],
    bcc: draft.bcc ?? [],
    subject: draft.subject,
    body: draft.body,
    receivedAt: now,
    attachments: draft.attachments,
    read: true,
  }

  return {
    ...store,
    messages:
      options.appendMessage === false
        ? store.messages
        : [...store.messages, message],
    drafts: options.keepDraft
      ? store.drafts.map(item =>
          item.id === draftId
            ? {
                ...item,
                sentAt: now,
                sentTo: draft.to,
                sentCc: draft.cc ?? [],
                sentBcc: draft.bcc ?? [],
                sentMessageId: options.sentMessageId ?? message.id,
                sentWithoutReview: options.sentWithoutReview,
                sentByAutomation: options.sentByAutomation,
                sentReviewBypassReason: options.sentReviewBypassReason,
                syncState: 'synced',
                updatedAt: now,
              }
            : item,
        )
      : store.drafts.filter(item => item.id !== draftId),
    threads: store.threads.map(item => {
      if (item.id !== draft.threadId) return item
      const mailboxRole =
        store.mailboxes.find(mailbox => mailbox.id === item.mailboxId)?.role
      const sentMailboxId =
        mailboxRole === 'drafts'
          ? sentMailboxIdForAccount(store, item.accountId)
          : item.mailboxId
      return {
        ...item,
        mailboxId: sentMailboxId,
        lastMessageAt: now,
        status: 'waiting',
        syncState: 'pending',
      }
    }),
  }
}

/**
 * Message ids that an editable draft already stands for.
 *
 * A provider draft is delivered as a message inside its thread AND as a draft
 * record. Showing both puts the same unsent text on screen twice, one copy of
 * which cannot be edited or sent. The draft record wins; the message is
 * hidden.
 */
export function draftShadowedMessageIds(
  store: Pick<MailStore, 'drafts'>,
): Set<string> {
  return new Set(
    store.drafts
      .filter(draft => !draft.sentAt && draft.providerDraftMessageId)
      .map(draft => draft.providerDraftMessageId as string),
  )
}

export function threadNeedsReply(thread: MailThread): boolean {
  return (
    thread.labels.some(label => label.toLowerCase() === 'needs reply') ||
    (thread.status === 'inbox' && thread.priority === 'high')
  )
}

/**
 * Gate for the automatic draft queue. Unlike the label/priority heuristic in
 * threadNeedsReply (which drives UI badges), auto-drafting requires an active
 * inbox thread whose latest inbound message carries an actionable ask — a
 * provider "important" flag or a keyword-matched label alone is not enough.
 */
export function threadShouldAutoDraft(
  store: MailStore,
  thread: MailThread,
): boolean {
  if (thread.status !== 'inbox') return false
  if (!inboxMailboxIds(store).has(thread.mailboxId)) return false
  const replyNeed = classifyReplyNeed(store, thread)
  if (!replyNeed.needsReply) return false
  return (
    replyNeed.askType !== 'unclear' && replyNeed.askType !== 'acknowledgement'
  )
}

function threadHasNeedsReplyLabel(thread: MailThread): boolean {
  return thread.labels.some(label => label.toLowerCase() === 'needs reply')
}


export function classifyReplyNeed(
  store: MailStore,
  thread: MailThread,
): ReplyNeedClassification {
  const latest = latestThreadMessage(store.messages, thread.id)
  if (!latest) {
    return {
      needsReply: false,
      confidence: 'high',
      askType: 'unclear',
      reason: 'No latest message is available.',
    }
  }

  const registry = ownerIdentityRegistryForStore(store)
  if (isOwnerContact(latest.from, registry)) {
    return {
      needsReply: false,
      confidence: 'high',
      askType: 'unclear',
      reason: 'Latest message is from you.',
    }
  }

  const draftability = classifyDraftability(store, thread)
  if (!draftability.draftable) {
    return {
      needsReply: false,
      confidence: 'high',
      askType: 'unclear',
      reason: draftability.reason,
    }
  }

  const intent = deriveReplyIntentForThread(store, thread.id)
  const askType = intent?.askType ?? 'unclear'
  const actionableAsk = askType !== 'unclear' && askType !== 'acknowledgement'
  if (intent && actionableAsk) {
    return {
      needsReply: true,
      confidence: intent.confidence,
      askType,
      reason: intent.summary,
    }
  }

  if (threadHasNeedsReplyLabel(thread)) {
    return {
      needsReply: true,
      confidence: 'medium',
      askType,
      reason: 'Thread carries a Needs reply label.',
    }
  }

  return {
    needsReply: false,
    confidence: intent?.confidence ?? 'medium',
    askType,
    reason: intent?.summary ?? 'No clear request for a response.',
  }
}


function inboxMailboxIds(store: MailStore): Set<string> {
  return new Set(
    store.mailboxes
      .filter(mailbox => mailbox.role === 'inbox')
      .map(mailbox => mailbox.id),
  )
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}


function compactList(items: Array<string | undefined | null>): string[] {
  return [
    ...new Set(items.map(item => item?.trim()).filter(Boolean) as string[]),
  ]
}

export function emailVoiceProfileForStore(
  store: MailStore,
  accountId?: string,
  now = new Date().toISOString(),
): EmailVoiceProfile {
  const profiles = store.settings.emailVoiceProfiles ?? []
  const active =
    profiles.find(
      profile => profile.id === store.settings.activeEmailVoiceProfileId,
    ) ?? profiles.find(profile => !accountId || profile.accountId === accountId)
  if (active) return active

  return {
    ...DEFAULT_EMAIL_VOICE_PROFILE,
    accountId: accountId ?? store.accounts[0]?.id ?? 'default',
    signoffPreference:
      normalizeSignature(store.settings.signature) ??
      DEFAULT_EMAIL_VOICE_PROFILE.signoffPreference,
    updatedAt: now,
  }
}

function detectDeadlines(text: string): string[] {
  return compactList([
    ...Array.from(
      text.matchAll(
        /\b(?:by|before|on)\s+([A-Z][a-z]+day|today|tomorrow|next week|20\d{2}-\d{2}-\d{2})\b/g,
      ),
    ).map(match => match[0]),
    ...Array.from(
      text.matchAll(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/g,
      ),
    ).map(match => match[0]),
  ]).slice(0, 4)
}

function detectCommitments(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
  return sentences
    .filter(sentence =>
      /\b(i'?ll|we'?ll|can you|please|need|needs|promise|follow up|send|review|confirm|decide)\b/i.test(
        sentence,
      ),
    )
    .slice(0, 4)
}

/** Latest-message text with quoted history, forwards, and footers cut off. */
function freshMessageText(message: MailMessage | undefined | null): string {
  const raw = cleanMailMessageText(message).text
  if (!raw) return ''

  const cutPatterns = [
    /\bInformation Classification:/i,
    /^[-_\s]{6,}Forwarded message[-_\s]{6,}/im,
    /(?:^|\n)From:\s.+/im,
    /(?:^|\n)Sent:\s.+/im,
    /(?:^|\n)On .+ wrote:/im,
    /(?:^|\n)>.+/m,
  ]
  const cutAt = cutPatterns.reduce((best, pattern) => {
    const match = pattern.exec(raw)
    if (!match || match.index <= 0) return best
    return Math.min(best, match.index)
  }, raw.length)
  return compactMailText(raw.slice(0, cutAt))
}

function sourceQuoteForReplyIntent(
  message: MailMessage | undefined | null,
  thread: MailThread,
): string {
  const quote = freshMessageText(message)
  if (!quote) return thread.summary || 'No source message is available.'
  if (quote.length <= 420) return quote
  return `${quote.slice(0, 420).replace(/\s+\S*$/, '')}...`
}

const ASK_SENTENCE_PATTERN =
  /\b(can you|could you|please|need|needs|approve|approval|confirm|review|feedback|notes|send|share|attach|provide|meet|meeting|call|copy me in|copy you in|introduc|intro|let me know|does that work|is that ok)\b/i

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
}

function replyIntentSentences(text: string): string[] {
  const sentences = splitSentences(text)
  const matches = sentences.filter(sentence =>
    ASK_SENTENCE_PATTERN.test(sentence),
  )
  return (matches.length > 0 ? matches : sentences).slice(0, 3)
}

/**
 * The sentence most likely to carry the actual ask: a direct question first,
 * then the first request-keyword sentence. Classifying the ask type against
 * this sentence stops trailing pleasantries ("happy to jump on a call") from
 * hijacking the detected ask.
 */
function primaryAskSentence(text: string): string | null {
  const sentences = splitSentences(text)
  const question = sentences.find(
    sentence => sentence.endsWith('?') && sentence.length >= 8,
  )
  if (question) return question
  return (
    sentences.find(sentence => ASK_SENTENCE_PATTERN.test(sentence)) ?? null
  )
}

/** Direct questions in the fresh (unquoted) part of a message. */
export function replyQuestionsForThread(
  store: MailStore,
  threadId: string,
): string[] {
  const latest = latestThreadMessage(store.messages, threadId)
  return splitSentences(freshMessageText(latest))
    .filter(sentence => sentence.endsWith('?') && sentence.length >= 8)
    .slice(0, 5)
    .map(sentence =>
      sentence.length <= 240
        ? sentence
        : `${sentence.slice(0, 240).replace(/\s+\S*$/, '')}...`,
    )
}

function intentPhraseAfter(pattern: RegExp, text: string): string | null {
  const match = pattern.exec(text)
  if (!match?.[1]) return null
  return match[1].replace(/[.!?]+$/, '').trim()
}

function intentSummaryForContact(
  contact: MailContact | null | undefined,
): string {
  return contact?.name || contact?.email || 'The sender'
}

function deadlineTextForIntent(text: string): string | undefined {
  const match = text.match(
    /\b(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)|by\s+\w+\s+\d{1,2})\b/i,
  )
  return match?.[0]
}

function responseModeForAsk(
  askType: ReplyIntent['askType'],
  text: string,
): ReplyIntent['responseMode'] {
  if (askType === 'unclear') return 'unclear'
  if (askType === 'acknowledgement') return 'reply_only'
  if (askType === 'scheduling' || askType === 'introduction') {
    return 'needs_user_decision'
  }
  if (askType === 'approval') return 'needs_user_decision'
  if (
    /\b(prepare|draft|write|create|make|produce|put together|assemble|generate|build)\b/i.test(
      text,
    ) &&
    /\b(proposal|brief|summary|deck|document|doc|plan|report|response|note)\b/i.test(
      text,
    )
  ) {
    return 'needs_work'
  }
  if (
    /\b(check|look at|review|analy[sz]e|research|pull|find|compare|verify)\b/i.test(
      text,
    ) &&
    /\b(calendar|availability|numbers|data|file|document|doc|proposal|contract|report|latest|details|status)\b/i.test(
      text,
    )
  ) {
    return 'needs_work'
  }
  if (askType === 'review' || askType === 'task_request') return 'needs_work'
  if (
    /\b(i(?:'ll| will)|we(?:'ll| will)|promise|commit|send .* (?:by|tomorrow|next)|come back)\b/i.test(
      text,
    )
  ) {
    return 'creates_commitment'
  }
  return 'reply_only'
}

function neededOutputForIntent(
  askType: ReplyIntent['askType'],
  requestedAction: string,
  responseMode: ReplyIntent['responseMode'],
): string {
  if (responseMode === 'needs_work') {
    if (askType === 'scheduling') return 'availability or scheduling options'
    if (askType === 'review') return 'review notes suitable for a reply'
    if (askType === 'information') return 'the requested information'
    if (askType === 'task_request') return 'the requested work output'
    return requestedAction
  }
  if (responseMode === 'creates_commitment') {
    return 'a tracked commitment and a safe reply'
  }
  if (responseMode === 'needs_user_decision') {
    return 'a user decision before replying'
  }
  return 'a concise email reply'
}

function suggestedAppsForIntent(
  askType: ReplyIntent['askType'],
  text: string,
  responseMode: ReplyIntent['responseMode'],
): string[] {
  if (responseMode !== 'needs_work') return []
  return compactList([
    'assistant',
    /\b(calendar|availability|schedule|meeting|call)\b/i.test(text)
      ? 'calendar'
      : undefined,
    /\b(task|todo|follow up|commitment)\b/i.test(text) ? 'tasks' : undefined,
    /\b(file|attachment|document|doc|proposal|brief|report)\b/i.test(text)
      ? 'files'
      : undefined,
    /\b(research|find|source|latest|compare|verify)\b/i.test(text)
      ? 'research'
      : undefined,
    askType === 'review' || askType === 'information' ? 'mail' : undefined,
  ])
}

function reviewReasonForIntent(
  responseMode: ReplyIntent['responseMode'],
  confidence: ReplyIntent['confidence'],
): string | undefined {
  if (responseMode === 'needs_work') {
    return 'PureMail thinks work should be prepared before replying.'
  }
  if (responseMode === 'creates_commitment') {
    return 'PureMail thinks this may create a commitment or task.'
  }
  if (confidence === 'low') {
    return 'PureMail is not confident it found the right ask.'
  }
  if (confidence === 'medium') {
    return 'PureMail found a possible ask that may need confirmation.'
  }
  return undefined
}

interface AskSurfaceClassification {
  askType: ReplyIntent['askType']
  requestedAction: string
  owedResponse: string
  confidence: ReplyIntent['confidence']
  missingInformation: string[]
}

/**
 * Classify one candidate ask surface. `secondaryText` (all matched ask
 * sentences) is still scanned for complements like a requested note, so a
 * narrow primary sentence does not lose targets stated in the next sentence.
 */
function classifyAskSurface(
  surface: string,
  intentText: string,
  secondaryText: string,
  fallbackAction: string,
): AskSurfaceClassification {
  const missingInformation: string[] = []
  let askType: ReplyIntent['askType'] = 'unclear'
  let requestedAction = fallbackAction
  let owedResponse =
    'ask a concise clarifying question before making any commitment'
  let confidence: ReplyIntent['confidence'] = 'low'

  const approvalTarget =
    intentPhraseAfter(
      /\b(?:approve|approval|sign off|sign-off)\b\s+(?:the\s+)?(.+?)(?:\?|$)/i,
      surface,
    ) ||
    intentPhraseAfter(
      /\b(?:approve|approval|sign off|sign-off)\b\s+(?:the\s+)?(.+?)(?:\?|$)/i,
      secondaryText,
    ) ||
    intentPhraseAfter(
      /\b(?:confirm|confirmation)\b\s+(?:the\s+)?(.+?)(?:\?|$)/i,
      secondaryText,
    )
  const noteTarget =
    intentPhraseAfter(
      /\b(?:needs?|need)\s+(?:a|an|the)?\s*(.+?\b(?:note|summary|brief|update|answer|response)\b.*?)(?:[.!?]|$)/i,
      secondaryText,
    ) ||
    intentPhraseAfter(
      /\b(?:send|share|provide)\s+(?:a|an|the)?\s*(.+?)(?:[.!?]|$)/i,
      secondaryText,
    )

  if (/\b(meet|meeting|catch up|call|coffee|chat|talk|sync)\b/i.test(surface)) {
    askType = 'scheduling'
    const when = /\bnext friday\b/i.test(intentText)
      ? 'next Friday'
      : /\btomorrow\b/i.test(intentText)
      ? 'tomorrow'
      : /\btoday\b/i.test(intentText)
      ? 'today'
      : 'the proposed time'
    requestedAction = `confirm whether ${when} works or propose another time`
    owedResponse = 'state availability clearly and offer a next step'
    confidence = 'high'
  } else if (/\b(copy you in|copy me in|introduc|intro)\b/i.test(surface)) {
    askType = 'introduction'
    requestedAction = 'confirm whether an introduction or copy-in is okay'
    owedResponse = 'give explicit permission, decline, or ask for context'
    confidence = 'high'
  } else if (
    /\b(approve|approval|confirm|confirmation|sign off|sign-off)\b/i.test(
      surface,
    )
  ) {
    askType = 'approval'
    requestedAction = approvalTarget
      ? `approve or give review status for ${approvalTarget}`
      : 'approve, decline, or give review status'
    owedResponse =
      'give a clear yes/no/review status and do not invent approval if it is not known'
    confidence = approvalTarget ? 'high' : 'medium'
    missingInformation.push('actual approval decision')
    if (noteTarget) {
      requestedAction = `${requestedAction}; address ${noteTarget}`
      owedResponse = `${owedResponse}; also say how the requested note or information will be handled`
      missingInformation.push(noteTarget)
    }
  } else if (
    /\b(prepare|draft|write|create|make|produce|put together|assemble|generate|build)\b/i.test(
      surface,
    )
  ) {
    askType = 'task_request'
    requestedAction = noteTarget
      ? `prepare ${noteTarget}`
      : 'prepare the requested work'
    owedResponse =
      'produce the requested work output before drafting the final reply'
    confidence = 'high'
  } else if (/\b(review|feedback|notes|comment)\b/i.test(surface)) {
    askType = 'review'
    requestedAction = noteTarget
      ? `review or provide feedback on ${noteTarget}`
      : 'review the material and provide feedback'
    owedResponse = 'say what will be reviewed and when notes will come back'
    confidence = 'high'
  } else if (
    /\b(send|share|provide|attach|answer|tell me|let me know)\b/i.test(surface)
  ) {
    askType = 'information'
    requestedAction = noteTarget
      ? `provide ${noteTarget}`
      : 'provide the requested information'
    owedResponse =
      'provide the requested information only if available, otherwise ask for or promise to confirm the missing detail'
    missingInformation.push('requested information if not present in context')
    confidence = 'medium'
  } else if (
    /\b(done|received|thanks|thank you|fyi|for your records)\b/i.test(surface)
  ) {
    askType = 'acknowledgement'
    requestedAction = 'acknowledge receipt'
    owedResponse = 'briefly acknowledge receipt without adding commitments'
    confidence = 'medium'
  }

  return { askType, requestedAction, owedResponse, confidence, missingInformation }
}

export function deriveReplyIntentForThread(
  store: MailStore,
  threadId: string,
): ReplyIntent | null {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) return null
  const latest = latestThreadMessage(store.messages, threadId)
  const draftability = classifyDraftability(store, thread)
  const recipient = draftability.counterparty ?? latest?.from ?? null
  const asker = latest?.from ?? recipient
  const quote = sourceQuoteForReplyIntent(latest, thread)
  const intentText = `${thread.subject}\n${thread.summary}\n${quote}`
  const sourceSentences = replyIntentSentences(quote)
  const askText = sourceSentences.join(' ') || thread.summary || quote
  const askSurface = askText || intentText
  const sender = intentSummaryForContact(asker)
  const fallbackAction = thread.summary || 'respond to the message'

  // Classify against the primary ask sentence first so a trailing
  // "happy to jump on a call" cannot hijack the ask type; fall back to the
  // full ask surface when the primary sentence alone is unclear.
  const primaryAsk = primaryAskSentence(quote)
  let classification: AskSurfaceClassification = {
    askType: 'unclear',
    requestedAction: fallbackAction,
    owedResponse:
      'ask a concise clarifying question before making any commitment',
    confidence: quote.length >= 24 ? 'medium' : 'low',
    missingInformation: [],
  }
  for (const surface of compactList([primaryAsk ?? '', askSurface])) {
    const candidate = classifyAskSurface(
      surface,
      intentText,
      askText || intentText,
      fallbackAction,
    )
    if (candidate.askType !== 'unclear') {
      classification = candidate
      break
    }
  }
  const { askType, requestedAction, owedResponse, confidence } = classification
  const missingInformation = classification.missingInformation

  const responseMode = responseModeForAsk(askType, askSurface)
  const neededOutput = neededOutputForIntent(
    askType,
    requestedAction,
    responseMode,
  )
  const suggestedApps = suggestedAppsForIntent(
    askType,
    askSurface,
    responseMode,
  )
  const deadlineText = deadlineTextForIntent(askSurface)
  const reviewReason = reviewReasonForIntent(responseMode, confidence)

  return {
    threadId,
    sourceMessageId: latest?.id,
    asker,
    recipient,
    askText,
    askType,
    responseMode,
    requestedAction,
    owedResponse,
    neededOutput,
    suggestedApps,
    deadlineText,
    missingInformation: compactList(missingInformation),
    confidence,
    intentConfidence: confidence,
    reviewReason,
    quote,
    summary:
      askType === 'unclear'
        ? `${sender}'s request is unclear; the reply should ask a concise clarifying question.`
        : `${sender} asks to ${requestedAction}; the reply should ${owedResponse}.`,
  }
}

export function threadContextSummaryForThread(
  store: MailStore,
  threadId: string,
  now = new Date().toISOString(),
): ThreadContextSummary | null {
  const saved = store.threadContextSummaries?.find(
    summary => summary.threadId === threadId,
  )
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) return saved ?? null
  const messages = store.messages.filter(
    message => message.threadId === threadId,
  )
  const latest = latestThreadMessage(store.messages, threadId)
  const latestText = cleanMailMessageText(latest).text
  const combinedText = compactMailText(
    messages.map(message => cleanMailMessageText(message).text).join('\n'),
  )
  const attachmentsMentioned = compactList([
    ...messages.flatMap(message =>
      message.attachments.map(attachment => attachment.name),
    ),
    ...(combinedText.match(/\b(?:attached|attachment|link|url)\b/i)
      ? ['attachment or link mentioned']
      : []),
  ])
  const generated: ThreadContextSummary = {
    threadId,
    participants: thread.participants,
    currentAsk:
      detectCommitments(latestText)[0] ??
      thread.summary ??
      'Review the selected thread before drafting.',
    openCommitments: detectCommitments(combinedText),
    deadlines: detectDeadlines(combinedText),
    attachmentsMentioned,
    summary: thread.summary,
    updatedAt: now,
  }
  return saved ? { ...generated, ...saved } : generated
}

export function buildLocalQaDraftBody(
  store: MailStore,
  threadId: string,
): string {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) return ''
  const account = store.accounts.find(item => item.id === thread.accountId)
  const intent = deriveReplyIntentForThread(store, threadId)
  const senderName = account?.name?.split(' ')[0] || account?.name || 'User'
  const firstName =
    intent?.recipient?.name?.split(/\s+/)[0] ||
    intent?.asker?.name?.split(/\s+/)[0] ||
    ''

  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
  const deadlineSuffix = intent?.deadlineText ? ` ${intent.deadlineText}` : ''
  const cleanedTarget = (prefix: RegExp): string => {
    const action = intent?.requestedAction ?? ''
    if (!prefix.test(action)) return ''
    return action
      .replace(prefix, '')
      .split(';')[0]
      .replace(/[.!?]+$/, '')
      .trim()
  }
  const body =
    intent?.askType === 'approval'
      ? `Thanks for sending this through. I’ll review ${
          cleanedTarget(/^approve or give review status for\s+/i) || 'it'
        } and come back to you with a clear approval status${deadlineSuffix}.`
      : intent?.askType === 'review'
      ? `Thanks for sending this through. I’ll review ${
          cleanedTarget(/^review or provide feedback on\s+/i) || 'the material'
        } and come back with notes${deadlineSuffix}.`
      : intent?.askType === 'scheduling'
      ? `Thanks for the invite. I’ll check my calendar and ${
          intent.requestedAction || 'come back with whether that works'
        }.`
      : intent?.askType === 'information'
      ? `Thanks for sending this through. I’ll ${
          intent.requestedAction || 'pull together the details you asked for'
        } and get back to you${deadlineSuffix} rather than guessing now.`
      : intent?.askType === 'task_request'
      ? `Thanks for sending this through. I’ll ${
          intent.requestedAction || 'prepare the requested work'
        } and come back to you${deadlineSuffix}.`
      : intent?.askType === 'introduction'
      ? 'Thanks for checking. I’ll confirm whether that introduction is okay once I have the context.'
      : intent?.askType === 'acknowledgement'
      ? 'Thanks for sending this through. Received.'
      : 'Thanks for sending this through. Can you clarify what you need from me here?'

  return [greeting, '', body, '', `Best,`, senderName].join('\n')
}

function sentMailboxIds(store: MailStore): Set<string> {
  return new Set(
    store.mailboxes
      .filter(mailbox => mailbox.role === 'sent')
      .map(mailbox => mailbox.id),
  )
}

function sentMessagesForVoice(store: MailStore): MailMessage[] {
  const mailboxIds = sentMailboxIds(store)
  const sentThreadIds = new Set(
    store.threads
      .filter(thread => mailboxIds.has(thread.mailboxId))
      .map(thread => thread.id),
  )

  return store.messages
    .filter(message => sentThreadIds.has(message.threadId))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

function sentMessagesToRecipient(
  store: MailStore,
  recipientEmail: string,
): MailMessage[] {
  const normalizedRecipient = normalizeEmail(recipientEmail)

  return sentMessagesForVoice(store).filter(message =>
    message.to.some(
      person => normalizeEmail(person.email) === normalizedRecipient,
    ),
  )
}

function cleanedBodyForVoice(message: MailMessage): string {
  return cleanMailMessageText(message).text || message.body
}

const roleAddressLocalParts = new Set([
  'admin',
  'contact',
  'hello',
  'help',
  'info',
  'mail',
  'no-reply',
  'noreply',
  'notifications',
  'office',
  'sales',
  'support',
  'team',
])

function emailLocalPart(email: string): string {
  return normalizeEmail(email).split('@')[0]?.split('+')[0] ?? ''
}

function isRoleAddress(contact: MailContact): boolean {
  const localPart = emailLocalPart(contact.email)
  return roleAddressLocalParts.has(localPart)
}

function parseGreetingName(contact: MailContact): string | null {
  if (isRoleAddress(contact)) return null
  const name = contact.name.trim()
  if (!name || name.includes('@')) return null
  const firstToken = name
    .replace(/[<>"()]/g, ' ')
    .trim()
    .split(/\s+/)[0]
  if (!firstToken) return null
  if (!/^[A-Za-z][A-Za-z'.-]{0,38}$/.test(firstToken)) return null
  return firstToken
}

function safeGreetingForRecipient(contact: MailContact): string {
  const greetingName = parseGreetingName(contact)
  return greetingName ? `Hi ${greetingName},` : 'Hi there,'
}

function normalizeGreetingForRecipient(
  greeting: string | undefined,
  contact: MailContact,
): string {
  const trimmed = greeting?.trim()
  if (!trimmed) return safeGreetingForRecipient(contact)

  const greetingName = parseGreetingName(contact)
  if (!greetingName) return 'Hi there,'

  if (/^(hi|hey|hello|dear)\b/i.test(trimmed)) {
    const opener = /^(hey)\b/i.test(trimmed)
      ? 'Hey'
      : /^(hello)\b/i.test(trimmed)
      ? 'Hello'
      : /^(dear)\b/i.test(trimmed)
      ? 'Dear'
      : 'Hi'
    return `${opener} ${greetingName},`
  }

  if (/[—-]\s*$/.test(trimmed)) return `${greetingName} —`

  return safeGreetingForRecipient(contact)
}


function extractGreeting(
  messages: MailMessage[],
  recipient: MailContact,
): string {
  for (const message of messages) {
    const firstLine = cleanedBodyForVoice(message)
      .split('\n')
      .map(line => line.trim())
      .find(Boolean)
    if (
      firstLine &&
      (/^(hi|hey|hello|dear)\b/i.test(firstLine) || /[—-]\s*$/.test(firstLine))
    )
      return normalizeGreetingForRecipient(firstLine, recipient)
  }

  return safeGreetingForRecipient(recipient)
}

function extractSignoff(messages: MailMessage[], accountName: string): string {
  for (const message of messages) {
    const lines = cleanedBodyForVoice(message)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (
        /^(best|thanks|thank you|cheers|warmly|talk soon|appreciate it)[,.!?]?$/i.test(
          lines[index],
        )
      ) {
        const signature =
          lines[index + 1] && lines[index + 1].length < 40
            ? `\n${lines[index + 1]}`
            : ''
        return `${lines[index]}${signature}`
      }
    }
  }

  return `Best,\n${accountName}`
}

function normalizeSignature(signature?: string): string | undefined {
  const normalized = signature?.replace(/\\n/g, '\n').trim()
  return normalized ? normalized : undefined
}

function extractVoiceSignals(messages: MailMessage[]): string[] {
  const candidates = [
    { label: 'opens with thanks', pattern: /\bthanks for\b/i },
    { label: 'uses direct next steps', pattern: /\bi(?:'|’)ll\b|\bi will\b/i },
    {
      label: 'offers concrete follow-through',
      pattern: /\bonce i(?:'|’)ve\b|\bonce i have\b/i,
    },
    {
      label: 'keeps replies concise',
      pattern: /\bshort\b|\bconcise\b|\bclean\b/i,
    },
    {
      label: 'asks for missing judgment points',
      pattern: /\byour call\b|\bcan you\b|\blet me know\b/i,
    },
  ]

  return candidates
    .filter(candidate =>
      messages.some(message =>
        candidate.pattern.test(cleanedBodyForVoice(message)),
      ),
    )
    .map(candidate => candidate.label)
    .slice(0, 3)
}

function deterministicVoiceProfile(
  recipient: MailContact,
  accountName = 'User',
  now = new Date().toISOString(),
  signature?: string,
): RecipientVoiceProfile {
  return {
    engine: 'deterministic',
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    sampleCount: 0,
    confidence: 'low',
    greeting: safeGreetingForRecipient(recipient),
    signoff:
      normalizeSignature(signature) ??
      `Best,\n${accountName.split(' ')[0] ?? accountName}`,
    signals: [],
    notes: ['Generic deterministic draft; no local sent-mail voice evidence.'],
    updatedAt: now,
  }
}

export function inferRecipientVoiceProfile(
  store: MailStore,
  recipient: MailContact,
  accountName = 'User',
  now = new Date().toISOString(),
  signature?: string,
): RecipientVoiceProfile {
  const recipientSamples = sentMessagesToRecipient(store, recipient.email)
  const globalSamples =
    recipientSamples.length > 0 ? [] : sentMessagesForVoice(store)
  const samples = recipientSamples.length > 0 ? recipientSamples : globalSamples
  const sampleCount = samples.length
  const configuredSignature = normalizeSignature(signature)
  const usesRecipientSamples = recipientSamples.length > 0

  return {
    engine: 'local-retrieval',
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    sampleCount,
    confidence:
      usesRecipientSamples && sampleCount >= 3
        ? 'high'
        : sampleCount >= 1
        ? 'medium'
        : 'low',
    greeting:
      sampleCount > 0
        ? extractGreeting(samples, recipient)
        : safeGreetingForRecipient(recipient),
    signoff:
      configuredSignature ??
      (sampleCount > 0
        ? extractSignoff(samples, accountName)
        : `Best,\n${accountName}`),
    signals: (sampleCount > 0 ? extractVoiceSignals(samples) : []).slice(0, 3),
    sampleMessageIds: samples.slice(0, 5).map(message => message.id),
    notes:
      sampleCount > 0
        ? usesRecipientSamples
          ? [
              `Retrieved ${sampleCount} local sent message${
                sampleCount === 1 ? '' : 's'
              } for this recipient.`,
              `Greeting/sign-off inferred from cleaned sent mail.`,
            ]
          : [
              `No recipient-specific sent mail found; used ${sampleCount} cleaned sent message${
                sampleCount === 1 ? '' : 's'
              } for global greeting/sign-off style.`,
            ]
      : ['No local sent-mail voice signal yet; generic draft.'],
    updatedAt: now,
  }
}

export function createVoiceProfileForDraft(
  store: MailStore,
  recipient: MailContact,
  engine: AutoDraftVoiceEngine,
  accountName = 'User',
  now = new Date().toISOString(),
  signature?: string,
): RecipientVoiceProfile {
  return engine === 'local-retrieval'
    ? inferRecipientVoiceProfile(store, recipient, accountName, now, signature)
    : deterministicVoiceProfile(recipient, accountName, now, signature)
}

export function createAutoDraftForThread(
  thread: MailThread,
  messages: MailMessage[],
  accountName = 'User',
  now = new Date().toISOString(),
  voiceProfile?: RecipientVoiceProfile,
  recipientOverride?: MailContact | null,
  emailVoice?: EmailVoiceProfile,
  threadContext?: ThreadContextSummary | null,
  generatedBody?: string,
  replyIntent?: ReplyIntent | null,
): Draft | null {
  const body = generatedBody?.trim()
  if (!body) return null
  const latestMessage = messages
    .filter(message => message.threadId === thread.id)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]
  const recipient =
    recipientOverride ?? latestMessage?.from ?? thread.participants[0]
  const sourceExcerpt = sourceExcerptForDraft(latestMessage)
  const sourceLines = [
    `Thread: ${thread.subject}`,
    `Summary: ${thread.summary}`,
    latestMessage
      ? `Latest message from ${latestMessage.from.name}: ${
          sourceExcerpt || thread.summary
        }`
      : '',
    voiceProfile?.engine === 'deterministic'
      ? 'Voice engine: deterministic local template; no sent-mail retrieval used'
      : '',
    voiceProfile?.engine === 'local-retrieval' && voiceProfile.sampleCount > 0
      ? `Voice profile: ${voiceProfile.sampleCount} local sent message${
          voiceProfile.sampleCount === 1 ? '' : 's'
        } to ${voiceProfile.recipientName || voiceProfile.recipientEmail}`
      : '',
    voiceProfile?.engine === 'local-retrieval' && voiceProfile.sampleCount === 0
      ? 'Voice profile: no local sent messages retrieved; generic draft'
      : '',
    emailVoice ? `Used: My Voice (${emailVoice.name})` : '',
    threadContext ? 'Used: current thread summary' : '',
    replyIntent
      ? `Reply intent: ${replyIntent.requestedAction}; owed response: ${replyIntent.owedResponse}`
      : '',
  ].filter(Boolean)
  const opening = recipient
    ? normalizeGreetingForRecipient(
        emailVoice?.greetingPreference || voiceProfile?.greeting,
        recipient,
      )
    : 'Hi there,'
  const signoff =
    normalizeSignature(emailVoice?.signoffPreference) ??
    voiceProfile?.signoff ??
    `Best,\n${accountName}`
  const normalizedBody =
    body.includes('\n') || body.startsWith(opening)
      ? body
      : [opening, '', body, '', signoff].join('\n')

  return {
    id: `autodraft_${thread.id}`,
    threadId: thread.id,
    to: recipient ? [recipient] : [],
    subject: thread.subject.toLowerCase().startsWith('re:')
      ? thread.subject
      : `Re: ${thread.subject}`,
    body: normalizedBody,
    attachments: [],
    updatedAt: now,
    syncState: 'pending',
    source: 'auto',
    draftKind: 'auto_reply',
    confidence:
      voiceProfile?.confidence ??
      (thread.priority === 'high' ? 'medium' : 'low'),
    provenance: sourceLines,
    voice: voiceProfile,
  }
}

export function ensureAutoDraftForThread(
  store: MailStore,
  threadId: string,
  generatedBody?: string,
  now = new Date().toISOString(),
  options: {
    force?: boolean
    qaOrigin?: QaDraftOrigin
    qaRequestId?: string
    fallbackReason?: string
    redraftReason?: RedraftReason
    userFeedback?: string
    replyIntent?: ReplyIntent | null
    userConfirmedIntent?: boolean
  } = {},
): MailStore {
  const draft = createGeneratedDraftForThread(store, threadId, now, {
    generatedBody,
    force: options.force,
    qaOrigin: options.qaOrigin,
    qaRequestId: options.qaRequestId,
    fallbackReason: options.fallbackReason,
    redraftReason: options.redraftReason,
    userFeedback: options.userFeedback,
    replyIntent: options.replyIntent,
    userConfirmedIntent: options.userConfirmedIntent,
  })
  if (!draft) return store
  if (
    store.drafts.some(
      item => item.threadId === threadId && isGeneratedDraft(item),
    )
  )
    return store
  return {
    ...store,
    drafts: [...store.drafts, draft],
  }
}

export function createGeneratedDraftForThread(
  store: MailStore,
  threadId: string,
  now = new Date().toISOString(),
  options: {
    previousDraft?: Draft
    generatedBody?: string
    force?: boolean
    qaOrigin?: QaDraftOrigin
    qaRequestId?: string
    fallbackReason?: string
    redraftReason?: RedraftReason
    userFeedback?: string
    replyIntent?: ReplyIntent | null
    userConfirmedIntent?: boolean
  } = {},
): Draft | null {
  if (!options.generatedBody?.trim()) return null
  const rawSettings = store.settings as MailStore['settings'] & {
    localVoiceAutodraft?: boolean
  }
  const settings = {
    autoDraftVoiceEngine:
      rawSettings?.autoDraftVoiceEngine ??
      (rawSettings?.localVoiceAutodraft === false
        ? 'deterministic'
        : 'local-retrieval'),
    signature:
      rawSettings?.signature ??
      `Best,\n${store.accounts[0]?.name?.split(' ')[0] ?? 'User'}`,
  }
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread || (!options.force && !threadShouldAutoDraft(store, thread)))
    return null
  const draftability = classifyDraftability(store, thread)
  if (!options.force && !draftability.draftable) return null
  const account = store.accounts.find(item => item.id === thread.accountId)
  const recipient = draftability.counterparty ?? null
  const emailVoice = emailVoiceProfileForStore(store, thread.accountId, now)
  const threadContext = threadContextSummaryForThread(store, thread.id, now)
  const latest = latestMessageForThread(store, thread.id)
  const explicitReplyIntent = options.replyIntent
  const sourceChanged = Boolean(
    explicitReplyIntent
      ? options.previousDraft?.sourceMessageId &&
          explicitReplyIntent.sourceMessageId &&
          explicitReplyIntent.sourceMessageId !==
            options.previousDraft.sourceMessageId
      : options.previousDraft?.sourceMessageId &&
          latest &&
          latest.id !== options.previousDraft.sourceMessageId,
  )
  const replyIntent =
    explicitReplyIntent ??
    (options.previousDraft?.replyIntent && !sourceChanged
      ? options.previousDraft.replyIntent
      : deriveReplyIntentForThread(store, thread.id))
  const variationIndex = options.previousDraft
    ? draftRegenerationIndex(options.previousDraft) + 1
    : 0
  const voiceProfile = recipient
    ? createVoiceProfileForDraft(
        store,
        recipient,
        settings.autoDraftVoiceEngine,
        account?.name ?? 'User',
        now,
        settings.signature,
      )
    : undefined
  const draft = createAutoDraftForThread(
    thread,
    store.messages,
    account?.name ?? 'User',
    now,
    voiceProfile,
    recipient,
    emailVoice,
    threadContext,
    options.generatedBody,
    replyIntent,
  )
  if (!draft) return null
  const redraftReason =
    options.redraftReason ??
    (options.previousDraft ? 'retry_after_failure' : undefined)
  const redraftHistory =
    options.previousDraft && redraftReason
      ? [
          ...(options.previousDraft.redraftHistory ?? []),
          {
            at: now,
            reason: redraftReason,
            ...(options.userFeedback
              ? { userFeedback: options.userFeedback }
              : {}),
            sourceMessageId: replyIntent?.sourceMessageId ?? latest?.id,
            intentMode: sourceChanged
              ? ('rederived' as const)
              : ('reused' as const),
          },
        ]
      : options.previousDraft?.redraftHistory
  return {
    ...draft,
    id: options.previousDraft?.id ?? draft.id,
    taskId: options.previousDraft?.taskId,
    memoryDisabled: options.previousDraft?.memoryDisabled,
    attachments: options.previousDraft?.attachments ?? draft.attachments,
    qaStatus: 'ready',
    qaOrigin:
      options.qaOrigin ??
      options.previousDraft?.qaOrigin ??
      (options.force ? 'user_requested' : 'auto'),
    qaRequestId: options.qaRequestId ?? options.previousDraft?.qaRequestId,
    qaForced: options.force ?? options.previousDraft?.qaForced ?? false,
    qaError: undefined,
    replyIntent: replyIntent ?? undefined,
    sourceMessageId: replyIntent?.sourceMessageId ?? latest?.id,
    draftWarnings: compactList([
      ...(sourceChanged ? [] : options.previousDraft?.draftWarnings ?? []),
      ...(replyIntent?.missingInformation.length
        ? [`Missing information: ${replyIntent.missingInformation.join('; ')}`]
        : []),
      replyIntent?.confidence === 'low'
        ? 'Low-confidence reply intent; verify the ask before sending.'
        : undefined,
    ]),
    redraftCount: options.previousDraft
      ? (options.previousDraft.redraftCount ?? 0) + 1
      : 0,
    redraftHistory,
    provenance: [
      ...(draft.provenance ?? []),
      options.previousDraft?.memoryDisabled
        ? 'Skipped: memory disabled for this draft'
        : '',
      options.previousDraft ? `Regenerated draft at ${now}.` : '',
      options.previousDraft ? `Regeneration variation ${variationIndex}.` : '',
      options.previousDraft && sourceChanged
        ? 'Redrafted from updated thread context.'
        : '',
      options.fallbackReason ?? '',
    ].filter(Boolean),
  }
}

export function regenerateGeneratedDraft(
  store: MailStore,
  draftId: string,
  generatedBody?: string,
  now = new Date().toISOString(),
  options: {
    requestId?: string
    fallbackReason?: string
    redraftReason?: RedraftReason
    userFeedback?: string
    replyIntent?: ReplyIntent | null
    userConfirmedIntent?: boolean
  } = {},
): MailStore {
  const previousDraft = store.drafts.find(draft => draft.id === draftId)
  if (!previousDraft || !isGeneratedDraft(previousDraft)) return store
  const nextDraft = createGeneratedDraftForThread(
    store,
    previousDraft.threadId,
    now,
    {
      previousDraft,
      generatedBody,
      force: previousDraft.qaForced,
      qaOrigin: 'regenerate',
      qaRequestId: options.requestId ?? previousDraft.qaRequestId,
      fallbackReason: options.fallbackReason,
      redraftReason: options.redraftReason,
      userFeedback: options.userFeedback,
      replyIntent: options.replyIntent,
      userConfirmedIntent: options.userConfirmedIntent,
    },
  )
  if (!nextDraft) return store
  return {
    ...store,
    drafts: store.drafts.map(draft =>
      draft.id === draftId ? nextDraft : draft,
    ),
  }
}

export function completeQaDraftRequest(
  store: MailStore,
  requestId: string,
  generatedBody?: string,
  now = new Date().toISOString(),
  options: {
    fallbackReason?: string
    redraftReason?: RedraftReason
    userFeedback?: string
    replyIntent?: ReplyIntent | null
    userConfirmedIntent?: boolean
  } = {},
): MailStore {
  const pendingDraft = store.drafts.find(
    draft => draft.qaRequestId === requestId && isGeneratedDraft(draft),
  )
  if (!pendingDraft) return store
  if (pendingDraft.body.trim()) {
    return regenerateGeneratedDraft(
      store,
      pendingDraft.id,
      generatedBody,
      now,
      {
        requestId,
        fallbackReason: options.fallbackReason,
        redraftReason: options.redraftReason,
        userFeedback: options.userFeedback,
        replyIntent: options.replyIntent,
        userConfirmedIntent: options.userConfirmedIntent,
      },
    )
  }
  return ensureAutoDraftForThread(
    {
      ...store,
      drafts: store.drafts.filter(draft => draft.id !== pendingDraft.id),
    },
    pendingDraft.threadId,
    generatedBody,
    now,
    {
      force: pendingDraft.qaForced,
      qaOrigin: pendingDraft.qaOrigin,
      qaRequestId: requestId,
      fallbackReason: options.fallbackReason,
      redraftReason: options.redraftReason,
      userFeedback: options.userFeedback,
      replyIntent: options.replyIntent,
      userConfirmedIntent: options.userConfirmedIntent,
    },
  )
}

export function failQaDraftRequest(
  store: MailStore,
  requestId: string,
  error: string,
  now = new Date().toISOString(),
): MailStore {
  return {
    ...store,
    drafts: store.drafts.map(draft =>
      draft.qaRequestId === requestId && isGeneratedDraft(draft)
        ? {
            ...draft,
            qaStatus: 'failed',
            qaError: error,
            updatedAt: now,
            syncState: 'pending' as const,
          }
        : draft,
    ),
  }
}

function sentMailboxIdForAccount(
  store: MailStore,
  accountId: string,
): string {
  return (
    store.mailboxes.find(
      mailbox => mailbox.role === 'sent' && mailbox.accountId === accountId,
    )?.id ??
    store.mailboxes.find(mailbox => mailbox.role === 'sent')?.id ??
    store.mailboxes[0]?.id ??
    ''
  )
}


const PROVIDER_ASSIGNED_THREAD_LABELS = new Set(['Gmail', 'Needs reply'])

/** Thread states only the user sets; the provider cannot know them. */
const LOCAL_WORKFLOW_STATUSES = new Set<MailThreadStatus>([
  'archived',
  'snoozed',
  'done',
])

function mergeRefreshedThread(
  providerThread: MailThread,
  currentThread: MailThread | undefined,
): MailThread {
  if (!currentThread) return providerThread
  const hasNewMessage =
    providerThread.lastMessageAt !== currentThread.lastMessageAt
  // Archive, snooze and done are the USER'S verdict on a thread, and the
  // provider has no way to represent them for anything outside its inbox:
  // it files sent mail as `waiting` on every sync, so keying this on the
  // provider saying `inbox` threw away every archive of a sent thread the
  // moment the next sync ran. A verdict sticks until new mail arrives —
  // that, and only that, is the provider's to overrule. Trash (`archived`
  // from the provider) is remote truth and never fought.
  const keepsLocalWorkflowState =
    !hasNewMessage &&
    LOCAL_WORKFLOW_STATUSES.has(currentThread.status) &&
    providerThread.status !== currentThread.status &&
    providerThread.status !== 'archived'
  const localLabels = currentThread.labels.filter(
    label =>
      !PROVIDER_ASSIGNED_THREAD_LABELS.has(label) &&
      !providerThread.labels.includes(label),
  )
  return {
    ...providerThread,
    // Filter run markers are local bookkeeping: without carrying them, every
    // reload re-ran every filter over the whole mailbox.
    ...(currentThread.filterRunAt !== undefined
      ? { filterRunAt: currentThread.filterRunAt }
      : {}),
    ...(currentThread.filteredBy !== undefined
      ? { filteredBy: currentThread.filteredBy }
      : {}),
    ...(localLabels.length
      ? { labels: [...providerThread.labels, ...localLabels] }
      : {}),
    ...(keepsLocalWorkflowState
      ? {
          status: currentThread.status,
          mailboxId: currentThread.mailboxId,
          ...(currentThread.snoozedUntil !== undefined
            ? { snoozedUntil: currentThread.snoozedUntil }
            : {}),
          ...(currentThread.archivedFromMailboxId !== undefined
            ? { archivedFromMailboxId: currentThread.archivedFromMailboxId }
            : {}),
          ...(currentThread.archivedFromStatus !== undefined
            ? { archivedFromStatus: currentThread.archivedFromStatus }
            : {}),
        }
      : {}),
  }
}

/**
 * Merge starred state from a provider sync. Provider-covered threads take
 * the provider's star state (Gmail STARRED is the source of truth there);
 * threads the fetch did not cover keep their local star (issue #153
 * state-loss class). A provider that reports nothing (`undefined`) leaves
 * local state untouched.
 */
export function mergeStarredThreadIds(
  currentStore: Pick<MailStore, 'starredThreadIds'>,
  providerStore: Pick<MailStore, 'starredThreadIds' | 'threads'>,
): string[] | undefined {
  if (providerStore.starredThreadIds === undefined) {
    return currentStore.starredThreadIds
  }
  const covered = new Set(providerStore.threads.map(thread => thread.id))
  const keptLocal = (currentStore.starredThreadIds ?? []).filter(
    id => !covered.has(id),
  )
  const fromProvider = providerStore.starredThreadIds.filter(
    id => !keptLocal.includes(id),
  )
  return [...fromProvider, ...keptLocal]
}

/**
 * Reconcile local drafts against the provider's own.
 *
 * The merge used to hardcode `drafts: currentStore.drafts`, which made the
 * provider's opinion about drafts unrepresentable: a draft written in Gmail
 * could never arrive, and one sent or deleted there stayed here forever.
 *
 * The rules, in order of who wins and why:
 * - A local draft with unpushed edits (`syncState: 'pending'`) beats the
 *   provider's copy. The user's newer text is the point.
 * - Otherwise the provider's copy wins for drafts it knows about ONLY when
 *   it is newer by `updatedAt`, so an edit made on another device lands
 *   here while a stale round trip cannot blank what was just typed.
 * - A draft's `threadId` is never taken from the provider once it has one
 *   locally: the thread is where the user pressed Reply, and adopting the
 *   provider's (often synthetic, over IMAP) id moves the draft off the
 *   open conversation.
 * - A local draft the provider no longer lists was sent or discarded there,
 *   and goes — but only when the fetch actually listed drafts.
 * - A local draft with no `providerDraftId` has never been pushed and is
 *   never touched.
 */
export function mergeMailDrafts(
  currentDrafts: Draft[],
  providerDrafts: Draft[],
  draftsCovered: boolean,
): Draft[] {
  const providerById = new Map(
    providerDrafts
      .filter(draft => draft.providerDraftId)
      .map(draft => [draft.providerDraftId as string, draft]),
  )
  const merged: Draft[] = []
  const claimed = new Set<string>()

  for (const local of currentDrafts) {
    if (!local.providerDraftId) {
      merged.push(local)
      continue
    }
    const remote = providerById.get(local.providerDraftId)
    if (!remote) {
      // Sent or deleted at the provider — unless we never looked, in which
      // case dropping it would delete the user's draft over a failed request.
      if (draftsCovered && !local.sentAt) continue
      merged.push(local)
      continue
    }
    claimed.add(local.providerDraftId)
    if (local.syncState === 'pending' || local.syncState === 'failed') {
      merged.push(local)
      continue
    }
    // `syncState` alone is not enough to protect the user's text. A draft
    // pushed once and edited again can be read back mid-keystroke, and an
    // IMAP round trip can return the copy as first pushed. Taking the
    // provider's body then blanks what was just typed, so the provider
    // only wins when its copy is genuinely NEWER.
    if (remote.updatedAt <= local.updatedAt) {
      merged.push(local)
      continue
    }
    // Keep the local record's identity and PureMail-side metadata; take the
    // provider's content.
    merged.push({
      ...local,
      to: remote.to,
      ...(remote.cc ? { cc: remote.cc } : {}),
      subject: remote.subject,
      body: remote.body,
      ...(remote.bodyHtml ? { bodyHtml: remote.bodyHtml } : {}),
      // The thread is the user's anchor, not the provider's. A reply draft
      // belongs to the conversation Reply was pressed in; the provider's
      // copy lives in its Drafts folder and can carry a different (or
      // synthetic) thread id, especially over IMAP. Adopting it moved the
      // draft off the open thread, and the reply pane went to "No reply
      // selected" with the user's text apparently gone. Only take the
      // remote thread when this draft has never been anchored locally.
      threadId: local.threadId || remote.threadId,
      attachments: remote.attachments,
      updatedAt: remote.updatedAt,
      syncState: 'synced',
    })
  }

  for (const remote of providerDrafts) {
    if (!remote.providerDraftId || claimed.has(remote.providerDraftId)) continue
    merged.push(remote)
  }
  return merged
}

export function mergeMailProviderSyncResult(
  currentStore: MailStore,
  providerStore: MailStore,
  now: DateInput = new Date(),
): MailStore {
  const mergedSettings = {
    ...providerStore.settings,
    ...currentStore.settings,
  }
  const currentThreadsById = new Map(
    currentStore.threads.map(thread => [thread.id, thread]),
  )
  const providerThreadIds = new Set(
    providerStore.threads.map(thread => thread.id),
  )
  const providerAccountIds = new Set(
    providerStore.accounts.map(account => account.id),
  )
  const mailboxRolesById = new Map(
    [...currentStore.mailboxes, ...providerStore.mailboxes].map(mailbox => [
      mailbox.id,
      mailbox.role,
    ]),
  )

  // Refreshed threads keep local-only state the provider cannot know about:
  // manual/AI categorization, snooze/workflow status (until a new message
  // arrives), and user-applied labels.
  const refreshedThreads = providerStore.threads.map(providerThread =>
    mergeRefreshedThread(
      providerThread,
      currentThreadsById.get(providerThread.id),
    ),
  )

  // Threads absent from the provider fetch are kept when the fetch could not
  // have contained them: local non-inbox mailboxes (archive and local moves),
  // threads that aged out of the fetch window, threads the fetch attempted
  // but failed to retrieve, and threads past a truncated fetch's coverage
  // horizon. Only inbox threads the fetch demonstrably covered and did not
  // return were removed remotely and are dropped.
  const coverage = providerStore.syncCoverage
  const failedFetchThreadIds = new Set(coverage?.failedThreadIds ?? [])
  const coveredFromMs = coverage?.coveredFrom
    ? dateFromInput(coverage.coveredFrom).getTime()
    : null

  // A composed message starts life on a local thread. Once it is sent, the
  // provider gives that message a real thread, and both were kept — the same
  // message showing as two conversations in Sent, permanently, because a
  // carried non-inbox thread is never dropped. When the provider's copy of a
  // local thread's confirmed send arrives, the local thread has done its job.
  const providerGmailMessageIds = new Set(
    providerStore.messages
      .map(message => message.gmailMessageId)
      .filter((id): id is string => Boolean(id)),
  )
  const hostsUnsentDraft = new Set(
    currentStore.drafts
      .filter(draft => !draft.sentAt)
      .map(draft => draft.threadId),
  )
  const supersededLocalThreadIds = new Set(
    currentStore.threads
      .filter(
        thread =>
          !isProviderThreadId(thread.id) &&
          // Never drop a thread that still holds unsent mail.
          !hostsUnsentDraft.has(thread.id) &&
          currentStore.messages.some(
            message =>
              message.threadId === thread.id &&
              message.gmailMessageId &&
              providerGmailMessageIds.has(message.gmailMessageId),
          ),
      )
      .map(thread => thread.id),
  )

  const carriedThreads = currentStore.threads.filter(thread => {
    if (supersededLocalThreadIds.has(thread.id)) return false
    if (providerThreadIds.has(thread.id)) return false
    if (!providerAccountIds.has(thread.accountId)) return false
    const mailboxRole = mailboxRolesById.get(thread.mailboxId)
    if (mailboxRole && mailboxRole !== 'inbox') return true
    if (failedFetchThreadIds.has(thread.id)) return true
    if (
      coveredFromMs !== null &&
      dateFromInput(thread.lastMessageAt).getTime() < coveredFromMs
    ) {
      return true
    }
    return !threadIsInsideFetchWindow({ settings: mergedSettings }, thread, now)
  })
  const carriedThreadIds = new Set(carriedThreads.map(thread => thread.id))
  const carriedMessages = currentStore.messages.filter(
    message =>
      carriedThreadIds.has(message.threadId) &&
      !supersededLocalThreadIds.has(message.threadId),
  )

  return {
    ...providerStore,
    threads: [...refreshedThreads, ...carriedThreads],
    messages: [...providerStore.messages, ...carriedMessages],
    drafts: mergeMailDrafts(
      currentStore.drafts,
      providerStore.drafts,
      Boolean(providerStore.syncCoverage?.draftsCovered),
    ),
    tasks: currentStore.tasks,
    taskLists: currentStore.taskLists,
    learningRules: currentStore.learningRules,
    threadContextSummaries: currentStore.threadContextSummaries,
    // Local-only Phase M0 state the provider cannot know about: keep it
    // through every sync (issue #153 state-loss class). Stars are the
    // exception when the provider reports them (Gmail STARRED): see
    // mergeStarredThreadIds.
    storeVersion: currentStore.storeVersion,
    starredThreadIds: mergeStarredThreadIds(currentStore, providerStore),
    pinnedThreadIds: currentStore.pinnedThreadIds,
    snoozes: currentStore.snoozes,
    queuedActions: currentStore.queuedActions,
    scheduledSends: currentStore.scheduledSends,
    // Send runs are local workflow state; the provider has no idea.
    runs: currentStore.runs,
    notificationPreferences: currentStore.notificationPreferences,
    savedViews: currentStore.savedViews,
    filters: currentStore.filters,
    querySeenAt: currentStore.querySeenAt,
    aiTriage: currentStore.aiTriage,
    // Box mailboxes are local homes for filed threads; the provider only
    // knows its own system mailboxes.
    mailboxes: [
      ...providerStore.mailboxes,
      ...currentStore.mailboxes.filter(
        mailbox =>
          mailbox.role === 'custom' &&
          !providerStore.mailboxes.some(
            provided => provided.id === mailbox.id,
          ),
      ),
    ],
    // Label metadata is provider-owned: a fetch that returns it refreshes the
    // cache; otherwise the existing cache stands.
    providerLabels: providerStore.providerLabels ?? currentStore.providerLabels,
    // Provider-synced labels refresh from the fetch; locally created labels
    // (filter boxes) are unknown to the provider and must survive the merge.
    labels: [
      ...providerStore.labels,
      ...currentStore.labels.filter(
        label =>
          !providerStore.labels.some(
            provided =>
              provided.id === label.id ||
              provided.name.toLowerCase() === label.name.toLowerCase(),
          ),
      ),
    ],
    settings: mergedSettings,
    // Coverage metadata describes a single fetch; never carry it forward.
    syncCoverage: undefined,
  }
}

/**
 * A provider sync result is a snapshot taken when the fetch started; local
 * changes made while it was in flight (mark unread, a just-sent reply) must
 * not be reverted by merging that older snapshot. Given the store as it was
 * when the fetch started and the store at merge time, re-apply what changed
 * locally in between.
 */
export function reapplyLocalMailChangesSinceSnapshot(
  merged: MailStore,
  snapshot: MailStore,
  current: MailStore,
): MailStore {
  const snapshotMessagesById = new Map(
    snapshot.messages.map(message => [message.id, message]),
  )

  // Read-state toggled locally while the sync was in flight wins over the
  // stale snapshot; the provider call already updated the remote side.
  const readOverrides = new Map<string, boolean>()
  for (const message of current.messages) {
    const before = snapshotMessagesById.get(message.id)
    if (before && before.read !== message.read) {
      readOverrides.set(message.id, message.read)
    }
  }

  // Messages added locally during the sync (sent replies) cannot be in the
  // snapshot-based fetch; dropping them loses mail until the next fetch.
  const mergedMessageIds = new Set(merged.messages.map(message => message.id))
  const mergedGmailIds = new Set(
    merged.messages
      .map(message => message.gmailMessageId)
      .filter((id): id is string => Boolean(id)),
  )
  const addedMessages = current.messages.filter(
    message =>
      !snapshotMessagesById.has(message.id) &&
      !mergedMessageIds.has(message.id) &&
      !(message.gmailMessageId && mergedGmailIds.has(message.gmailMessageId)) &&
      // Never re-add an unconfirmed Gmail send: it is either a phantom or its
      // real synced copy is already in `merged`. Re-adding it is exactly what
      // made local "sent" copies linger forever alongside the real message.
      !isUnconfirmedGmailSend(message),
  )

  if (readOverrides.size === 0 && addedMessages.length === 0) return merged

  const latestAddedByThread = new Map<string, string>()
  for (const message of addedMessages) {
    const latest = latestAddedByThread.get(message.threadId)
    if (!latest || latest < message.receivedAt) {
      latestAddedByThread.set(message.threadId, message.receivedAt)
    }
  }

  return {
    ...merged,
    messages: [
      ...merged.messages.map(message => {
        const read = readOverrides.get(message.id)
        return read === undefined ? message : { ...message, read }
      }),
      ...addedMessages,
    ],
    threads: merged.threads.map(thread => {
      const latestAdded = latestAddedByThread.get(thread.id)
      return latestAdded && latestAdded > thread.lastMessageAt
        ? { ...thread, lastMessageAt: latestAdded }
        : thread
    }),
  }
}

/**
 * Discard unsent generated drafts so the auto-draft queue rebuilds from the
 * current classification and drafting logic. Drafts with an active work
 * request are kept — cancelling running assistant work is a separate action.
 */
export function searchMailAndTasks(
  store: MailStore,
  query: string,
): Array<{
  id: string
  type: 'thread' | 'message' | 'task' | 'attachment'
  title: string
}> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const contactMatches = (contact: MailContact): boolean =>
    [contact.name, contact.email].some(value =>
      value.toLowerCase().includes(needle),
    )
  const threads = store.threads
    .filter(thread =>
      [
        thread.subject,
        thread.summary,
        ...thread.labels,
        ...thread.participants.flatMap(contact => [
          contact.name,
          contact.email,
        ]),
      ].some(value => value.toLowerCase().includes(needle)),
    )
    .map(thread => ({
      id: thread.id,
      type: 'thread' as const,
      title: thread.subject,
    }))
  const messages = store.messages
    .filter(
      message =>
        [
          message.subject,
          cleanMailMessageText(message).text,
          message.from.name,
          message.from.email,
          ...message.to.flatMap(contact => [contact.name, contact.email]),
        ].some(value => value.toLowerCase().includes(needle)) ||
        contactMatches(message.from) ||
        message.to.some(contactMatches),
    )
    .map(message => ({
      id: message.id,
      type: 'message' as const,
      title: `${message.from.name || message.from.email}: ${message.subject}`,
    }))
  const tasks = store.tasks
    .filter(task =>
      [task.title, task.notes, task.source.label].some(value =>
        value.toLowerCase().includes(needle),
      ),
    )
    .map(task => ({ id: task.id, type: 'task' as const, title: task.title }))
  const attachments = store.messages
    .flatMap(message =>
      message.attachments.map(attachment => ({
        id: `${message.id}:${attachment.id}`,
        type: 'attachment' as const,
        title: attachment.name,
      })),
    )
    .filter(result => result.title.toLowerCase().includes(needle))
  return [...threads, ...messages, ...tasks, ...attachments]
}
