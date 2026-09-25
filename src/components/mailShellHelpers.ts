import { replyStateChip, replyStateInStore } from '../lib/mailReplyState'
import {
  classifyDraftability,
  isGeneratedDraft,
  threadNeedsReply,
} from '../lib/mailModel'
import {
  attachmentFromBytes,
  resolveAttachmentMimeType,
} from '../lib/mailAttachments'
import type {
  Attachment,
  Draft,
  DraftKind,
  MailContact,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'

export type AiInstructionTarget = 'classifier' | 'drafting'
export type AiInstructionRisk = {
  summary: string
  technicalReference: string
}
export type PendingInstructionSave = {
  target: AiInstructionTarget
  value: string
  risks: AiInstructionRisk[]
}
export type PendingSendState = {
  id: string
  /** 'run' holds may stack: a send run queues one per Send & next. */
  target: 'compose' | 'reply' | 'run'
  draftId?: string
  label: string
}
export interface AttachmentPreviewState {
  name: string
  kind: 'image' | 'pdf' | 'text'
  imageUrl?: string
  /** Data URL for inline PDF preview. */
  pdfUrl?: string
  text?: string
}
export type ReplyImproveState = {
  originalBody: string
  suggestion?: string
  feedback: string
  pending?: boolean
  error?: string
}
/**
 * Muted, deterministic: the disc is an anchor for the eye travelling down
 * the list, not information, so the palette stays quiet and the same sender
 * always lands on the same colour. No image source exists, hence initials.
 */
const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: 'hsl(18 45% 90%)', fg: 'hsl(18 55% 32%)' },
  { bg: 'hsl(210 40% 90%)', fg: 'hsl(210 45% 32%)' },
  { bg: 'hsl(150 30% 88%)', fg: 'hsl(150 35% 26%)' },
  { bg: 'hsl(268 30% 91%)', fg: 'hsl(268 30% 36%)' },
  { bg: 'hsl(40 50% 88%)', fg: 'hsl(38 55% 30%)' },
  { bg: 'hsl(340 35% 91%)', fg: 'hsl(340 40% 34%)' },
  { bg: 'hsl(190 35% 88%)', fg: 'hsl(192 45% 28%)' },
  { bg: 'hsl(80 30% 88%)', fg: 'hsl(85 35% 26%)' },
]

export function senderAvatar(name: string): {
  initial: string
  bg: string
  fg: string
} {
  const trimmed = name.trim()
  const initial = trimmed ? trimmed[0].toUpperCase() : '?'
  let hash = 0
  for (const char of trimmed.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  const tone = AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
  return { initial, bg: tone.bg, fg: tone.fg }
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/**
 * The list's time column, the way mail clients have always read it: a
 * message from today shows its time, one from this year its date, an
 * older one date and year. Everything at once ("Sep 3, 6:07 PM") is the
 * widest string of the three on every row, and it was running off the
 * pane's right edge.
 */
export function formatThreadListTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
  }
  if (at.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(at)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(at)
}

/** The 3-letter tile in the attachment footer: the extension, lowercased. */
export function attachmentExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'file'
  return name.slice(dot + 1).toLowerCase().slice(0, 4)
}

/**
 * File → Attachment for the compose window's Attach button, drop and paste.
 * Reads the bytes and hands them to `attachmentFromBytes` — the same builder
 * the agent's addDraftAttachments uses — so a file attached by either path
 * is the same attachment.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch (error) {
    throw error instanceof Error ? error : new Error('Could not read attachment.')
  }
  return attachmentFromBytes(
    file.name,
    resolveAttachmentMimeType(file.name, bytes, file.type),
    bytes,
  )
}

/**
 * Clipboard pastes of screenshots arrive as anonymous "image.png" files —
 * give them distinct, sortable names before they become attachment chips.
 */
export function namedClipboardFile(file: File, index: number): File {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file
  const extension = file.type.split('/')[1]?.split('+')[0] || 'png'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return new File([file], `pasted-image-${stamp}-${index + 1}.${extension}`, {
    type: file.type,
  })
}

export function createComposeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function parseComposeRecipients(raw: string): MailContact[] {
  return raw
    .split(/[,\n;]/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const match = value.match(/^(.*?)<([^>]+)>$/)
      if (!match) return { name: value, email: value }
      const email = match[2].trim()
      const name = match[1]?.trim().replace(/^"|"$/g, '') || email
      return { name, email }
    })
}

export function formatContactsInput(contacts: MailContact[]): string {
  return contacts
    .map(contact =>
      contact.name && contact.name !== contact.email
        ? `${contact.name} <${contact.email}>`
        : contact.email,
    )
    .join(', ')
}

export function sentDraftRecipientSummary(draft: Draft): string {
  const to = formatContactsInput(draft.sentTo ?? draft.to)
  const cc = formatContactsInput(draft.sentCc ?? draft.cc ?? [])
  const bcc = formatContactsInput(draft.sentBcc ?? draft.bcc ?? [])
  return [to ? `to ${to}` : '', cc ? `cc ${cc}` : '', bcc ? `bcc ${bcc}` : '']
    .filter(Boolean)
    .join(' · ')
}

/**
 * What a message is from this account's point of view.
 *
 * A draft is written by you but has not gone anywhere, so it is neither sent
 * nor received. Deciding this from the From address alone made every draft
 * claim to be sent — including replies drafted by other tools, which read as
 * mail you had already sent to someone.
 */
export function messageDirectionForAccount(
  message: MailMessage,
  accountEmail?: string,
): 'incoming' | 'outgoing' | 'draft' {
  if (message.isDraft) return 'draft'
  const normalizedAccountEmail = accountEmail?.trim().toLowerCase()
  if (!normalizedAccountEmail) return 'incoming'
  return message.from.email.toLowerCase() === normalizedAccountEmail
    ? 'outgoing'
    : 'incoming'
}

export function normalizedThreadSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fw|fwd):\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function conversationKeyForThread(thread: MailThread): string {
  if (thread.gmailThreadId) {
    return `gmail:${thread.accountId}:${thread.gmailThreadId}`
  }
  const participants = thread.participants
    .map(contact => contact.email.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',')
  return [
    `account:${thread.accountId}`,
    `mailbox:${thread.mailboxId}`,
    `subject:${normalizedThreadSubject(thread.subject)}`,
    `people:${participants}`,
  ].join('|')
}

export function assessAiInstructionRisks(
  target: AiInstructionTarget,
  instructions: string,
): AiInstructionRisk[] {
  const normalized = instructions.toLowerCase()
  const risks: AiInstructionRisk[] = []
  const addRisk = (
    pattern: RegExp,
    summary: string,
    technicalReference: string,
  ): void => {
    if (pattern.test(normalized)) {
      risks.push({ summary, technicalReference })
    }
  }

  addRisk(
    /\b(ignore|bypass|override|disable|break|skip)\b.{0,80}\b(contract|schema|json|plain text|privacy|guardrail|instructions?|system prompt|previous|above)\b/i,
    'This appears to tell the AI to ignore protected product rules.',
    target === 'classifier'
      ? 'The classifier must still return the fixed Important/Other JSON schema and use the privacy-minimized payload.'
      : 'The draft agent must still return only a plain-text reply body and follow the reply-intent/redraft contract.',
  )
  addRisk(
    /\b(send|auto-send|autosend|deliver)\b.{0,80}\b(without|no|skip|bypass)\b.{0,80}\b(review|approval|confirm|permission)\b/i,
    'This sounds like it could let mail send without review.',
    'PureMail keeps QA/user approval as the send boundary; instructions should not weaken that.',
  )
  addRisk(
    /\b(invent|make up|fabricate|hallucinate|guess)\b.{0,80}\b(facts?|dates?|attachments?|commitments?|promises?|sources?|details?)\b/i,
    'This asks the AI to make up information.',
    'Drafting and classification should use supplied context only; missing details should be asked for or confirmed.',
  )
  addRisk(
    /\b(full email|entire email|whole thread|all html|attachments?|quoted history)\b.{0,80}\b(send|include|upload|share|use)\b/i,
    'This may ask PureMail to expose more email content than intended.',
    'The AI classifier is designed to use metadata, local signals, and a short excerpt, not full HTML, attachments, or quoted history.',
  )
  addRisk(
    /\b(always|never|all|every)\b.{0,80}\b(important|other|reply|draft)\b/i,
    'This may make the AI behave too broadly in everyday mail.',
    'Broad absolute rules can swamp the Important/Other split or produce drafts where a narrower rule would be safer.',
  )

  return risks
}

export function replyDraftTimestamp(draft: Draft): string {
  return draft.sentAt ?? draft.updatedAt
}

export function latestMessageForThread(messages: MailMessage[]): MailMessage | null {
  return (
    [...messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] ??
    null
  )
}

export function calendarHandoffErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Missing permission "filesystem"/i.test(message)) {
    return 'Calendar handoff permission is missing. Restart PureDesktop after enabling filesystem permission for PureMail and PureCalendar.'
  }
  return message || 'Could not open calendar handoff.'
}

export function isCalendarAttachment(attachment: Attachment): boolean {
  const mimeType = attachment.mimeType.toLowerCase()
  const name = attachment.name.toLowerCase()
  return mimeType === 'text/calendar' || name.endsWith('.ics')
}

export function draftKindLabel(kind: DraftKind): string {
  if (kind === 'assistant') return 'Assistant draft'
  if (kind === 'auto_reply') return 'Generated draft'
  return 'Manual draft'
}

/**
 * Where this draft actually lives, in the user's terms.
 *
 * A draft that has not reached the account is one machine failure away from
 * gone, and there was no way to tell: every draft read "saved <time>" whether
 * it had left the building or not.
 */
/**
 * Should opening this thread re-point the mailbox query at the thread's own
 * mailbox?
 *
 * Only when the thread is not already in the list. Clicking a row must never
 * change the list it came from — and since Drafts became a view over drafts,
 * a conversation listed there still lives in the inbox, so re-asserting its
 * mailbox rewrote `in:Drafts` to `in:Inbox` and threw the user back to the
 * inbox on every click. Reaching a thread from OUTSIDE the list (an agent's
 * openThread, a task's source email, a notification) still moves the view,
 * because otherwise the thread would be unreachable.
 */
export function openingThreadShouldRepointMailbox(
  entries: Array<{ threads: Array<{ id: string }> }>,
  threadId: string,
): boolean {
  return !entries.some(entry =>
    entry.threads.some(thread => thread.id === threadId),
  )
}

/**
 * The account's provider, named the way its owner would say it. Shared code
 * paths used to hardcode "Gmail" into 32 notices; on any other account every
 * one of them was false.
 */
export function providerName(
  provider: 'demo' | 'gmail' | 'imap' | undefined,
): string {
  if (provider === 'gmail') return 'Gmail'
  if (provider === 'imap') return 'your mail server'
  return 'this account'
}

export function draftSyncLabel(
  draft: Draft,
  providerName: string | null,
): { text: string; tone: 'ok' | 'pending' | 'failed' } {
  if (!providerName) {
    return { text: 'saved on this machine', tone: 'ok' }
  }
  if (draft.syncState === 'failed' || draft.syncState === 'conflict') {
    return { text: `not saved to ${providerName}`, tone: 'failed' }
  }
  if (draft.providerDraftId && draft.syncState === 'synced') {
    return { text: `saved to ${providerName}`, tone: 'ok' }
  }
  return { text: `saving to ${providerName}…`, tone: 'pending' }
}

export function threadReplyRequested(store: MailStore, thread: MailThread): boolean {
  return (
    threadNeedsReply(thread) && classifyDraftability(store, thread).draftable
  )
}

export function threadStatusLabel(
  store: MailStore,
  thread: MailThread,
  drafts: Draft[],
): string | null {
  const threadDrafts = drafts.filter(draft => draft.threadId === thread.id)
  if (threadDrafts.some(isGeneratedDraft)) return 'draft ready'
  const manualDrafts = threadDrafts.filter(draft => !isGeneratedDraft(draft))
  if (manualDrafts.some(draft => !draft.sentAt)) return 'reply open'
  if (manualDrafts.some(draft => draft.sentAt)) return 'reply sent'
  // "waiting" said only that the last move was yours. The reply state says
  // whether they came back, or how long they have not.
  const reply = replyStateChip(replyStateInStore(store, thread))
  if (reply) return reply.label
  if (threadReplyRequested(store, thread)) return 'reply requested'
  if (thread.status === 'inbox') return null
  return thread.status.replace(/_/g, ' ')
}

export function threadStatusTone(
  store: MailStore,
  thread: MailThread,
  drafts: Draft[],
): 'reply' | 'draft' | 'waiting' | 'overdue' | 'replied' | 'label' {
  const threadDrafts = drafts.filter(draft => draft.threadId === thread.id)
  if (threadDrafts.some(isGeneratedDraft)) return 'draft'
  if (threadDrafts.some(draft => !isGeneratedDraft(draft))) return 'reply'
  const reply = replyStateChip(replyStateInStore(store, thread))
  if (reply) return reply.tone
  if (threadReplyRequested(store, thread)) return 'reply'
  return 'label'
}

export function displayThreadLabels(
  store: MailStore,
  thread: MailThread,
  drafts: Draft[],
): string[] {
  const status = threadStatusLabel(store, thread, drafts)
  const hidden = new Set([
    status?.toLowerCase() ?? '',
    'needs reply',
    'reply requested',
    'reply open',
    'reply sent',
    'draft ready',
    'local draft',
    'in qa',
    'waiting',
    'in inbox',
    'inbox',
    'gmail',
    'synced',
    'sync synced',
    'high',
    'high priority',
  ])
  return thread.labels.filter(label => !hidden.has(label.toLowerCase()))
}

export function threadSyncLabel(thread: MailThread): string | null {
  // "sync pending" read as "not synced" sitting next to "Gmail inbox
  // synced." It actually means a local change (usually marking read) has
  // not been pushed yet, so say that instead.
  if (thread.syncState === 'pending') return 'unsent change'
  if (thread.syncState === 'failed') return 'sync failed'
  if (thread.syncState === 'conflict') return 'sync conflict'
  return null
}
