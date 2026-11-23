import {
  mailHub,
  type DailyBriefingPacket,
  type IngestedMailMessage,
  type MailHubClient,
  type MailScope,
  type MailSignal,
  type MailSignalKind,
  type MarkDraftSentInput,
  type StagedMailDraft,
  type VoiceProfile,
} from '@purescience/platform-ui/bridge/mailHub'
import { ownAddresses } from './mailReplyState'
import type {
  Mailbox,
  MailContact,
  MailMessage,
  MailStore,
  MailThread,
} from '../types'

// ---------------------------------------------------------------------------
// Source App & Signal Display Metadata
// ---------------------------------------------------------------------------

const SOURCE_APP_LABELS: Record<string, string> = {
  invoicing: 'PureInvoicing',
  pureinvoicing: 'PureInvoicing',
  outreach: 'PureOutreach',
  pureoutreach: 'PureOutreach',
  meet: 'PureMeet',
  puremeet: 'PureMeet',
  executive: 'PureExecutive',
  pureexecutive: 'PureExecutive',
  expenses: 'PureExpenses',
  pureexpenses: 'PureExpenses',
  redline: 'PureRedline',
  pureredline: 'PureRedline',
  sign: 'PureSign',
  puresign: 'PureSign',
  tasks: 'PureTasks',
  puretasks: 'PureTasks',
  projects: 'PureProjects',
  pureprojects: 'PureProjects',
  reader: 'PureReader',
  purereader: 'PureReader',
  people: 'PurePeople',
  purepeople: 'PurePeople',
  calendar: 'PureCalendar',
  purecalendar: 'PureCalendar',
  journal: 'PureJournal',
  purejournal: 'PureJournal',
  support: 'PureSupport',
  puresupport: 'PureSupport',
  mail: 'PureMail',
  puremail: 'PureMail',
}

export function formatSourceAppLabel(sourceApp: string): string {
  const trimmed = sourceApp.trim()
  if (!trimmed) return 'PureApp'
  const normalized = trimmed.toLowerCase().replace(/^plugin\./, '').replace(/[^a-z0-9]/g, '')
  if (SOURCE_APP_LABELS[normalized]) return SOURCE_APP_LABELS[normalized]
  if (/^Pure[A-Z]/.test(trimmed)) return trimmed
  const clean = trimmed.replace(/^plugin\./, '').replace(/[-_]+/g, ' ')
  return `Pure${clean.charAt(0).toUpperCase()}${clean.slice(1)}`
}

export type SignalChipTone = 'accent' | 'warn' | 'info' | 'success'

export interface SignalKindMeta {
  label: string
  defaultTargetApp: string
  tone: SignalChipTone
}

export const SIGNAL_KIND_META: Record<MailSignalKind, SignalKindMeta> = {
  receipt: {
    label: 'Receipt',
    defaultTargetApp: 'PureExpenses',
    tone: 'info',
  },
  invoice_payment: {
    label: 'Invoice Payment',
    defaultTargetApp: 'PureInvoicing',
    tone: 'success',
  },
  contractor_bill: {
    label: 'Contractor Bill',
    defaultTargetApp: 'PureExpenses',
    tone: 'warn',
  },
  contact_update: {
    label: 'Contact Update',
    defaultTargetApp: 'PurePeople',
    tone: 'info',
  },
  task_commitment: {
    label: 'Task Commitment',
    defaultTargetApp: 'PureTasks',
    tone: 'accent',
  },
  project_wait: {
    label: 'Waiting On',
    defaultTargetApp: 'PureProjects',
    tone: 'warn',
  },
  wait_resolved: {
    label: 'Blocker Resolved',
    defaultTargetApp: 'PureProjects',
    tone: 'success',
  },
  calendar_booking: {
    label: 'Calendar Booking',
    defaultTargetApp: 'PureCalendar',
    tone: 'info',
  },
  contract_redline: {
    label: 'Contract Redline',
    defaultTargetApp: 'PureRedline',
    tone: 'warn',
  },
  signing_request: {
    label: 'Signing Request',
    defaultTargetApp: 'PureSign',
    tone: 'accent',
  },
  peer_review: {
    label: 'Peer Review',
    defaultTargetApp: 'PureJournal',
    tone: 'info',
  },
  paper_share: {
    label: 'Paper Share',
    defaultTargetApp: 'PureReader',
    tone: 'info',
  },
  faq_pattern: {
    label: 'FAQ Pattern',
    defaultTargetApp: 'PureSupport',
    tone: 'info',
  },
}

export function getSignalDisplayMeta(signal: MailSignal): {
  label: string
  targetAppLabel: string
  tone: SignalChipTone
} {
  const meta = SIGNAL_KIND_META[signal.kind] ?? {
    label: signal.kind.replace(/_/g, ' '),
    defaultTargetApp: formatSourceAppLabel(signal.targetApp),
    tone: 'info' as const,
  }
  return {
    label: meta.label,
    targetAppLabel: signal.targetApp
      ? formatSourceAppLabel(signal.targetApp)
      : meta.defaultTargetApp,
    tone: meta.tone,
  }
}

export function signalsForThread(
  signals: readonly MailSignal[],
  threadId: string,
  messageIds: ReadonlySet<string>,
): MailSignal[] {
  return signals.filter(
    signal =>
      signal.status === 'pending' &&
      (signal.threadId === threadId || messageIds.has(signal.messageId)),
  )
}

export function groupSignalsByTargetApp(
  signals: readonly MailSignal[],
): Record<string, MailSignal[]> {
  const grouped: Record<string, MailSignal[]> = {}
  for (const signal of signals) {
    const appLabel = getSignalDisplayMeta(signal).targetAppLabel
    if (!grouped[appLabel]) grouped[appLabel] = []
    grouped[appLabel].push(signal)
  }
  return grouped
}

// ---------------------------------------------------------------------------
// Message Conversion & Incremental Deduplicated Sync
// ---------------------------------------------------------------------------

export function formatMailContactAddress(contact: MailContact | undefined): string {
  if (!contact) return ''
  const email = (contact.email ?? '').trim()
  const name = (contact.name ?? '').trim()
  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${name} <${email}>`
  }
  return email || name
}

export function resolveMessageScope(
  accountId: string | undefined,
  orgAccountIds?: ReadonlySet<string>,
): MailScope {
  if (accountId && orgAccountIds?.has(accountId)) {
    return 'organisation'
  }
  return 'personal'
}

export function storeOwnEmailSet(store: MailStore): Set<string> {
  return ownAddresses({
    email: store.accounts[0]?.email ?? '',
    emails: [
      ...store.accounts.map(account => account.email),
      ...(store.settings.ownerIdentities?.emails ?? []),
    ],
  })
}

function makeSnippet(text: string | undefined, max = 240): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

export function toIngestedMailMessage(
  message: MailMessage,
  options: {
    thread?: MailThread
    mailboxById?: ReadonlyMap<string, Mailbox>
    ownEmails: ReadonlySet<string>
    orgAccountIds?: ReadonlySet<string>
  },
): IngestedMailMessage {
  const { thread, mailboxById, ownEmails, orgAccountIds } = options
  const fromEmail = (message.from?.email ?? '').trim().toLowerCase()
  const mailbox = thread ? mailboxById?.get(thread.mailboxId) : undefined
  const isOutbound =
    (Boolean(fromEmail) && ownEmails.has(fromEmail)) ||
    mailbox?.role === 'sent'
  const headers: Record<string, string> = {}
  if (message.rawHeaders) {
    for (const h of message.rawHeaders) {
      if (h.name && h.value) headers[h.name.toLowerCase()] = h.value
    }
  }
  if (message.messageIdHeader) headers['message-id'] = message.messageIdHeader
  if (message.inReplyTo) headers['in-reply-to'] = message.inReplyTo
  if (message.listUnsubscribe) headers['list-unsubscribe'] = message.listUnsubscribe

  return {
    messageId: message.id,
    threadId: message.threadId,
    accountId: thread?.accountId,
    folder: mailbox?.role ?? mailbox?.name?.toLowerCase() ?? 'inbox',
    direction: isOutbound ? 'outbound' : 'inbound',
    scope: resolveMessageScope(thread?.accountId, orgAccountIds),
    from: formatMailContactAddress(message.from),
    to: (message.to ?? []).map(formatMailContactAddress).filter(Boolean),
    cc: (message.cc ?? []).map(formatMailContactAddress).filter(Boolean),
    subject: message.subject || thread?.subject || '(no subject)',
    date: message.receivedAt,
    text: message.body ?? '',
    snippet: makeSnippet(message.body),
    attachments: (message.attachments ?? []).map(att => ({
      filename: att.name,
      mimeType: att.mimeType,
      sizeBytes: att.size,
    })),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

export interface MailHubSyncTracker {
  ingestedMessageIds: Set<string>
  voiceSampleMessageIds: Set<string>
  recordedReplyMessageIds: Set<string>
}

export function createMailHubSyncTracker(): MailHubSyncTracker {
  return {
    ingestedMessageIds: new Set<string>(),
    voiceSampleMessageIds: new Set<string>(),
    recordedReplyMessageIds: new Set<string>(),
  }
}

export interface SyncStoreWithMailHubInput {
  store: MailStore
  tracker: MailHubSyncTracker
  client?: MailHubClient
  orgAccountIds?: ReadonlySet<string>
  batchSize?: number
}

export interface SyncStoreWithMailHubResult {
  skipped: boolean
  ingestedCount: number
  blockedByPrivacy: number
  voiceUpdated: boolean
  voiceSampleCount: number
  voiceProfile: VoiceProfile | null
  repliesRecorded: number
  extractedSignals: MailSignal[]
}

const DEFAULT_INGEST_BATCH_SIZE = 50
const MAX_VOICE_SAMPLES_PER_BATCH = 40

export async function syncStoreWithMailHub(
  input: SyncStoreWithMailHubInput,
): Promise<SyncStoreWithMailHubResult> {
  const client = input.client ?? mailHub
  if (!client.isAvailable()) {
    return {
      skipped: true,
      ingestedCount: 0,
      blockedByPrivacy: 0,
      voiceUpdated: false,
      voiceSampleCount: 0,
      voiceProfile: null,
      repliesRecorded: 0,
      extractedSignals: [],
    }
  }

  const { store, tracker, orgAccountIds } = input
  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_INGEST_BATCH_SIZE)
  const threadById = new Map(store.threads.map(thread => [thread.id, thread]))
  const mailboxById = new Map(store.mailboxes.map(mailbox => [mailbox.id, mailbox]))
  const ownEmails = storeOwnEmailSet(store)

  // Count non-draft messages per thread so we know which inbound messages are
  // replies on existing threads (thread has > 1 message or message has inReplyTo).
  const threadNonDraftCount = new Map<string, number>()
  const nonDraftMessages: MailMessage[] = []
  for (const message of store.messages) {
    if (message.isDraft || message.optimistic) continue
    nonDraftMessages.push(message)
    threadNonDraftCount.set(
      message.threadId,
      (threadNonDraftCount.get(message.threadId) ?? 0) + 1,
    )
  }

  const toIngest: IngestedMailMessage[] = []
  const newVoiceSamples: IngestedMailMessage[] = []
  const inboundReplyCandidates: MailMessage[] = []

  for (const message of nonDraftMessages) {
    const thread = threadById.get(message.threadId)
    const converted = toIngestedMailMessage(message, {
      thread,
      mailboxById,
      ownEmails,
      orgAccountIds,
    })

    if (!tracker.ingestedMessageIds.has(message.id)) {
      toIngest.push(converted)
    }

    if (
      converted.direction === 'outbound' &&
      !tracker.voiceSampleMessageIds.has(message.id) &&
      (converted.text?.trim().length ?? 0) >= 12
    ) {
      newVoiceSamples.push(converted)
    }

    if (
      converted.direction === 'inbound' &&
      !tracker.recordedReplyMessageIds.has(message.id) &&
      ((threadNonDraftCount.get(message.threadId) ?? 0) > 1 ||
        Boolean(message.inReplyTo))
    ) {
      inboundReplyCandidates.push(message)
    }
  }

  let ingestedCount = 0
  let blockedByPrivacy = 0
  const extractedSignals: MailSignal[] = []

  for (let i = 0; i < toIngest.length; i += batchSize) {
    const chunk = toIngest.slice(i, i + batchSize)
    try {
      const result = await client.ingestMessages(chunk)
      ingestedCount += result.ingested
      blockedByPrivacy += result.blockedByPrivacy
      if (result.signalsExtracted?.length) {
        extractedSignals.push(...result.signalsExtracted)
      }
      for (const item of chunk) {
        tracker.ingestedMessageIds.add(item.messageId)
      }
    } catch {
      // Leave un-ingested message IDs out of tracker so the next sync retries.
    }
  }

  let voiceUpdated = false
  let voiceSampleCount = 0
  let voiceProfile: VoiceProfile | null = null

  if (newVoiceSamples.length > 0) {
    const sampleBatch = newVoiceSamples
      .slice()
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, MAX_VOICE_SAMPLES_PER_BATCH)
    try {
      voiceProfile = await client.updateVoiceProfile(sampleBatch)
      setCachedHubVoiceProfile(voiceProfile)
      voiceUpdated = true
      voiceSampleCount = sampleBatch.length
      for (const sample of newVoiceSamples) {
        tracker.voiceSampleMessageIds.add(sample.messageId)
      }
    } catch {
      // Voice profile sync is best-effort; retry on next sync.
    }
  }

  let repliesRecorded = 0
  for (const reply of inboundReplyCandidates) {
    try {
      const matched = await client.recordReply({
        threadId: reply.threadId,
        ...(reply.inReplyTo ? { inReplyToMessageId: reply.inReplyTo } : {}),
        replyMessageId: reply.id,
        from: formatMailContactAddress(reply.from),
        receivedAt: reply.receivedAt,
      })
      tracker.recordedReplyMessageIds.add(reply.id)
      if (matched.length > 0) {
        repliesRecorded += matched.length
      }
    } catch {
      // Retry on next sync cycle.
    }
  }

  return {
    skipped: false,
    ingestedCount,
    blockedByPrivacy,
    voiceUpdated,
    voiceSampleCount,
    voiceProfile,
    repliesRecorded,
    extractedSignals,
  }
}

// ---------------------------------------------------------------------------
// Closed-Loop Outbox Draft Helpers
// ---------------------------------------------------------------------------

export interface HubComposeFields {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  bodyHtml: string
  threadId?: string
  hubDraftId: string
  hubSourceApp: string
  sourceAppLabel: string
  sourceLabel?: string
  followUpDays?: number
}

export function hubDraftToComposeFields(draft: StagedMailDraft): HubComposeFields {
  return {
    to: draft.to.join(', '),
    cc: (draft.cc ?? []).join(', '),
    bcc: (draft.bcc ?? []).join(', '),
    subject: draft.subject ?? '',
    body: draft.body ?? '',
    bodyHtml: draft.html ?? '',
    ...(draft.threadId ? { threadId: draft.threadId } : {}),
    hubDraftId: draft.id,
    hubSourceApp: draft.sourceApp,
    sourceAppLabel: formatSourceAppLabel(draft.sourceApp),
    ...(draft.sourceLabel ? { sourceLabel: draft.sourceLabel } : {}),
    ...(draft.followUpDays !== undefined ? { followUpDays: draft.followUpDays } : {}),
  }
}

export async function openHubDraft(
  draftId: string,
  client: MailHubClient = mailHub,
): Promise<StagedMailDraft | null> {
  if (!client.isAvailable()) return null
  try {
    return await client.markDraftOpened(draftId)
  } catch {
    return null
  }
}

export async function notifyHubDraftSent(
  input: MarkDraftSentInput,
  client: MailHubClient = mailHub,
): Promise<StagedMailDraft | null> {
  if (!client.isAvailable()) return null
  try {
    return await client.markDraftSent(input)
  } catch {
    return null
  }
}

export async function discardHubDraft(
  draftId: string,
  client: MailHubClient = mailHub,
): Promise<StagedMailDraft | null> {
  if (!client.isAvailable()) return null
  try {
    return await client.discardDraft(draftId)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Voice Profile Cache & Prompt Grounding
// ---------------------------------------------------------------------------

let cachedHubVoiceProfile: VoiceProfile | null = null

export function getCachedHubVoiceProfile(): VoiceProfile | null {
  return cachedHubVoiceProfile
}

export function setCachedHubVoiceProfile(profile: VoiceProfile | null): void {
  cachedHubVoiceProfile = profile
}

export function formatVoiceProfileForPrompt(
  profile: VoiceProfile | null | undefined,
): string {
  if (!profile) return ''
  const lines: string[] = []
  if (profile.promptSummary?.trim()) {
    lines.push(profile.promptSummary.trim())
  }
  if (profile.sampleCount > 0) {
    lines.push(
      `Observed style (${profile.sampleCount} sent emails): avg ${Math.round(
        profile.avgSentenceWords,
      )} words/sentence, directness ${Math.round(profile.directnessScore * 100)}%.`,
    )
  }
  if (profile.topGreetings?.length) {
    lines.push(`Common greetings: ${profile.topGreetings.slice(0, 3).join(', ')}`)
  }
  if (profile.topSignOffs?.length) {
    lines.push(`Common sign-offs: ${profile.topSignOffs.slice(0, 3).join(', ')}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Composite Intelligence Briefing (for fn_mailIntelligenceBriefing)
// ---------------------------------------------------------------------------

export interface MailIntelligenceBriefingInput {
  client?: MailHubClient
  scope?: MailScope
  limit?: number
  includeBriefingMarkdown?: boolean
  now?: Date
}

export interface MailIntelligenceBriefingData {
  hubAvailable: boolean
  generatedAt: string
  counts: {
    pendingOutboxDrafts: number
    pendingSignals: number
    dueFollowUps: number
    urgentItems: number
  }
  pendingDrafts: Array<{
    id: string
    sourceApp: string
    sourceAppLabel: string
    sourceLabel?: string
    to: string[]
    subject: string
    status: StagedMailDraft['status']
    followUpDays?: number
    createdAt: string
  }>
  signalsByTargetApp: Record<
    string,
    Array<{
      id: string
      kind: MailSignalKind
      label: string
      scope: MailScope
      threadId?: string
      messageId: string
      from: string
      subject: string
      summary: string
      confidence: number
      extractedAt: string
    }>
  >
  overdueFollowUps: Array<{
    id: string
    sourceApp: string
    sourceAppLabel: string
    to: string[]
    subject: string
    sentAt?: string
    followUpDueAt?: string
  }>
  voiceProfile: {
    sampleCount: number
    avgSentenceWords: number
    directnessScore: number
    topGreetings: string[]
    topSignOffs: string[]
    promptSummary: string
    updatedAt: string
  } | null
  briefing: {
    date: string
    summary: string
    sections: DailyBriefingPacket['sections']
    markdown?: string
  } | null
}

export async function buildMailIntelligenceBriefing(
  input: MailIntelligenceBriefingInput = {},
): Promise<MailIntelligenceBriefingData> {
  const client = input.client ?? mailHub
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 25)))
  const includeMarkdown = input.includeBriefingMarkdown !== false
  const hubAvailable = client.isAvailable()

  const [drafts, signals, dueFollowUps, voiceProfile] = await Promise.all([
    client.listDrafts({ status: 'pending', limit }).catch(() => [] as StagedMailDraft[]),
    client
      .listSignals({
        status: 'pending',
        ...(input.scope ? { scope: input.scope } : {}),
        limit,
      })
      .catch(() => [] as MailSignal[]),
    client.checkFollowUps(nowIso).catch(() => [] as StagedMailDraft[]),
    client.getVoiceProfile().catch(() => null as VoiceProfile | null),
  ])

  if (voiceProfile) {
    setCachedHubVoiceProfile(voiceProfile)
  }

  let briefingPacket: DailyBriefingPacket | null = null
  if (hubAvailable) {
    briefingPacket = await client
      .generateBriefing({
        ...(input.scope ? { scope: input.scope } : {}),
        now: nowIso,
      })
      .catch(() => null)
  }

  const groupedRaw = groupSignalsByTargetApp(signals)
  const signalsByTargetApp: MailIntelligenceBriefingData['signalsByTargetApp'] = {}
  for (const [appLabel, list] of Object.entries(groupedRaw)) {
    signalsByTargetApp[appLabel] = list.map(signal => ({
      id: signal.id,
      kind: signal.kind,
      label: getSignalDisplayMeta(signal).label,
      scope: signal.scope,
      ...(signal.threadId ? { threadId: signal.threadId } : {}),
      messageId: signal.messageId,
      from: signal.from,
      subject: signal.subject,
      summary: signal.summary,
      confidence: signal.confidence,
      extractedAt: signal.extractedAt,
    }))
  }

  return {
    hubAvailable,
    generatedAt: briefingPacket?.generatedAt ?? nowIso,
    counts: {
      pendingOutboxDrafts: drafts.length,
      pendingSignals: signals.length,
      dueFollowUps: dueFollowUps.length,
      urgentItems: briefingPacket?.counts.urgentItems ?? dueFollowUps.length,
    },
    pendingDrafts: drafts.map(draft => ({
      id: draft.id,
      sourceApp: draft.sourceApp,
      sourceAppLabel: formatSourceAppLabel(draft.sourceApp),
      ...(draft.sourceLabel ? { sourceLabel: draft.sourceLabel } : {}),
      to: draft.to,
      subject: draft.subject,
      status: draft.status,
      ...(draft.followUpDays !== undefined ? { followUpDays: draft.followUpDays } : {}),
      createdAt: draft.createdAt,
    })),
    signalsByTargetApp,
    overdueFollowUps: dueFollowUps.map(draft => ({
      id: draft.id,
      sourceApp: draft.sourceApp,
      sourceAppLabel: formatSourceAppLabel(draft.sourceApp),
      to: draft.to,
      subject: draft.subject,
      ...(draft.sentAt ? { sentAt: draft.sentAt } : {}),
      ...(draft.followUpDueAt ? { followUpDueAt: draft.followUpDueAt } : {}),
    })),
    voiceProfile: voiceProfile
      ? {
          sampleCount: voiceProfile.sampleCount,
          avgSentenceWords: voiceProfile.avgSentenceWords,
          directnessScore: voiceProfile.directnessScore,
          topGreetings: voiceProfile.topGreetings,
          topSignOffs: voiceProfile.topSignOffs,
          promptSummary: voiceProfile.promptSummary,
          updatedAt: voiceProfile.updatedAt,
        }
      : null,
    briefing: briefingPacket
      ? {
          date: briefingPacket.date,
          summary: briefingPacket.summary,
          sections: briefingPacket.sections,
          ...(includeMarkdown ? { markdown: briefingPacket.markdown } : {}),
        }
      : null,
  }
}
