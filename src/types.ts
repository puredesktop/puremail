export type MailThreadStatus =
  | 'inbox'
  | 'waiting'
  | 'done'
  | 'archived'
  | 'snoozed'
export type MailTaskStatus = 'open' | 'waiting' | 'done' | 'dismissed'
export type MailPriority = 'none' | 'low' | 'medium' | 'high'
export type SyncState = 'synced' | 'pending' | 'failed' | 'conflict'
export type AutoDraftVoiceEngine = 'deterministic' | 'local-retrieval'
export type DraftKind =
  | 'manual'
  | 'auto_reply'
  | 'live_mail'
  | 'assistant'
  /** Rendered from a send run's template for one recipient row. */
  | 'run'
  /** The template a send run renders its drafts from. */
  | 'run_template'
export type QaDraftStatus = 'pending' | 'ready' | 'failed'
export type QaDraftOrigin =
  | 'auto'
  | 'user_requested'
  | 'suppressed_restore'
  | 'regenerate'
  | 'live_mail'
  | 'assistant'
export type ReplyIntentAskType =
  | 'approval'
  | 'review'
  | 'information'
  | 'scheduling'
  | 'introduction'
  | 'task_request'
  | 'acknowledgement'
  | 'unclear'
export type ReplyResponseMode =
  | 'reply_only'
  | 'needs_work'
  | 'creates_commitment'
  | 'needs_user_decision'
  | 'unclear'
export type RedraftReason =
  | 'bad_content'
  | 'wrong_tone'
  | 'too_long'
  | 'too_short'
  | 'missing_ask'
  | 'user_instruction'
  | 'retry_after_failure'
export type MailLearningRuleKind = 'suppress_drafting' | 'route_inbox'
export type MailLearningRuleScope = 'sender' | 'domain' | 'subject_pattern'
/**
 * The providers PureMail offers before release. The longer list (iCloud,
 * Fastmail, Yahoo/AOL, Outlook/Graph, BYO-OAuth, JMAP) was trimmed
 * 2026-08-19: nothing shipped should promise a connector nobody has
 * committed to supporting. Persisted profiles with a retired value are
 * ignored by the settings drawer rather than crashing anything.
 */
export type MailConnectionProvider =
  | 'google'
  | 'gmail-app-password'
  | 'imap-smtp'
  | 'proton-bridge'

export type MailConnectionMode =
  | 'oauth'
  | 'app-password'
  | 'manual'
  | 'bridge'
  | 'planned'
export type MailConnectionStatus = 'ready' | 'planned'

export interface MailConnectionEndpoint {
  host?: string
  port?: number
  security?: 'ssl' | 'starttls' | 'none'
  /** Login for this endpoint; SMTP may differ from IMAP (e.g. Proton Bridge). */
  username?: string
}

export interface MailConnectionProfile {
  id: string
  email?: string
  hasSmtpPassword?: boolean
  provider: MailConnectionProvider
  label: string
  mode: MailConnectionMode
  status: MailConnectionStatus
  description: string
  endpoint?: {
    imap?: MailConnectionEndpoint
    smtp?: MailConnectionEndpoint
  }
}

export interface MailContact {
  name: string
  email: string
}

export interface MailAccount {
  id: string
  provider: 'demo' | 'gmail' | 'imap'
  name: string
  email: string
  syncState: 'online' | 'syncing' | 'offline' | 'error'
}

export interface OwnerIdentitySettings {
  emails?: string[]
  names?: string[]
}

export interface Mailbox {
  id: string
  accountId: string
  name: string
  role: 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'custom'
  unreadCount: number
}

export interface Attachment {
  id: string
  name: string
  mimeType: string
  sizeLabel: string
  /** Exact byte size when known (Gmail part metadata or local File.size). */
  size?: number
  content?: string
  remote?:
    | {
        provider: 'gmail'
        messageId: string
        attachmentId: string
      }
    | {
        provider: 'imap'
        folderPath: string
        uid: number
        partId: string
      }
}

export interface MailCalendarInvite {
  uid: string
  method: 'REQUEST' | 'REPLY' | 'CANCEL' | 'PUBLISH'
  sequence: number
  status: 'confirmed' | 'tentative' | 'cancelled'
  title: string
  description: string
  location?: string
  startsAt: string
  endsAt: string
  timeZone: string
  organizer?: MailContact
  attendees: Array<
    MailContact & {
      response: 'accepted' | 'declined' | 'tentative' | 'needsAction'
    }
  >
  recurrenceRule?: string
  rawSource: string
}

export interface MailMessage {
  id: string
  threadId: string
  gmailMessageId?: string
  /**
   * A locally-appended send the provider has not confirmed with a server
   * message id yet. Optimistic messages are ephemeral: shown as "Sending…",
   * never persisted, and replaced by the real synced message. Never render
   * one as sent history or claim it came from Gmail.
   */
  optimistic?: boolean
  /**
   * The message is an unsent draft. Authorship is not the same as delivery:
   * a draft you wrote is from you, so anything deciding "sent" from the From
   * address alone will call a draft sent — which is how an unsent reply came
   * to be displayed as SENT, in a thread, with a received time.
   */
  isDraft?: boolean
  /** RFC 5322 Message-ID header, used for In-Reply-To/References on replies. */
  messageIdHeader?: string
  from: MailContact
  /** RFC 5322 Reply-To: where the sender asked replies to go, when set. */
  replyTo?: MailContact[]
  to: MailContact[]
  cc?: MailContact[]
  bcc?: MailContact[]
  subject: string
  body: string
  bodyHtml?: string
  receivedAt: string
  attachments: Attachment[]
  calendarInvite?: MailCalendarInvite
  /** Raw RFC 2369 List-Unsubscribe header, when the sender provided one. */
  listUnsubscribe?: string
  read: boolean
}

export interface MailLabel {
  id: string
  name: string
  color: string
}

export interface MailThread {
  id: string
  accountId: string
  mailboxId: string
  gmailThreadId?: string
  subject: string
  participants: MailContact[]
  labels: string[]
  status: MailThreadStatus
  priority: MailPriority
  summary: string
  lastMessageAt: string
  archivedFromMailboxId?: string
  archivedFromStatus?: MailThreadStatus
  snoozedUntil?: string
  /** Set when a snooze wakes; cleared when the user opens the thread. */
  snoozeReturnedAt?: string
  /** Stamped once the filter engine has seen this thread (run marker). */
  filterRunAt?: string
  /** Names of the rules that acted on this thread — the audit trail. */
  filteredBy?: string[]
  syncState: SyncState
}

export interface TaskSource {
  type: 'email'
  accountId: string
  threadId: string
  messageId?: string
  snippet: string
  label: string
}

export interface TaskList {
  id: string
  name: string
  source: 'mail' | 'personal'
}

export interface MailTask {
  id: string
  taskListId: string
  title: string
  notes: string
  status: MailTaskStatus
  priority: MailPriority
  dueAt?: string
  createdAt: string
  updatedAt: string
  syncState: SyncState
  source: TaskSource
}

export interface Draft {
  id: string
  threadId: string
  to: MailContact[]
  cc?: MailContact[]
  bcc?: MailContact[]
  subject: string
  body: string
  /**
   * Sanitized rich-text body (Phase M2 composer). When present it is sent
   * as the text/html alternative; `body` stays the plain-text source of
   * truth for search, previews, and text-only clients.
   */
  bodyHtml?: string
  /** Provider-side draft id (Gmail drafts API) when the draft is synced. */
  providerDraftId?: string
  /**
   * The store message this draft came in as, for a draft synced FROM the
   * provider. A Gmail draft arrives twice — once as a DRAFT-labelled message
   * inside its thread, once as this record — and the message must be hidden,
   * or the thread shows the same unsent text twice, one copy of it inert.
   */
  providerDraftMessageId?: string
  attachments: Attachment[]
  updatedAt: string
  syncState: SyncState
  source?: 'manual' | 'auto'
  draftKind?: DraftKind
  qaStatus?: QaDraftStatus
  qaOrigin?: QaDraftOrigin
  qaRequestId?: string
  qaForced?: boolean
  qaError?: string
  replyIntent?: ReplyIntent
  memoryDisabled?: boolean
  sourceMessageId?: string
  draftWarnings?: string[]
  redraftCount?: number
  redraftHistory?: RedraftHistoryEntry[]
  confidence?: 'low' | 'medium' | 'high'
  provenance?: string[]
  voice?: RecipientVoiceProfile
  taskId?: string
  sentAt?: string
  sentTo?: MailContact[]
  sentCc?: MailContact[]
  sentBcc?: MailContact[]
  sentMessageId?: string
  sentWithoutReview?: boolean
  sentByAutomation?: boolean
  sentReviewBypassReason?: string
  /** The send run this draft belongs to (template or rendered item). */
  runId?: string
}

export interface DraftabilityDecision {
  draftable: boolean
  reason: string
  matchedRuleId?: string
  matchedAllowRuleId?: string
  restoredByExampleId?: string
  counterparty?: MailContact | null
  isOwnerOnly?: boolean
  draftableRecipient?: boolean
  cleanedTextLength?: number
  stripped?: string[]
}

export interface SuppressedDraftCandidate {
  thread: MailThread
  latestMessage?: MailMessage
  draftability: DraftabilityDecision
  matchedRule?: MailLearningRule
}

export interface OwnerIdentityRegistry {
  emails: string[]
  names: string[]
}

export interface DraftCounterpartyResolution {
  counterparty: MailContact | null
  isOwnerOnly: boolean
  draftableRecipient: boolean
}

export interface CleanedMailText {
  text: string
  stripped: string[]
}

export interface RecipientVoiceProfile {
  engine: AutoDraftVoiceEngine
  recipientEmail: string
  recipientName: string
  sampleCount: number
  confidence: 'low' | 'medium' | 'high'
  greeting: string
  signoff: string
  signals: string[]
  sampleMessageIds?: string[]
  notes?: string[]
  updatedAt: string
}

export interface ReplyIntent {
  threadId: string
  sourceMessageId?: string
  asker: MailContact | null
  recipient: MailContact | null
  askText: string
  askType: ReplyIntentAskType
  responseMode: ReplyResponseMode
  requestedAction: string
  owedResponse: string
  neededOutput: string
  suggestedApps: string[]
  deadlineText?: string
  missingInformation: string[]
  confidence: 'low' | 'medium' | 'high'
  intentConfidence?: 'low' | 'medium' | 'high'
  reviewReason?: string
  quote: string
  summary: string
}

export interface RedraftHistoryEntry {
  at: string
  reason: RedraftReason
  userFeedback?: string
  sourceMessageId?: string
  intentMode: 'reused' | 'rederived'
}

export type EmailVoiceTone = 'warm' | 'direct' | 'concise' | 'formal' | 'casual'
export type EmailVoiceLengthPreference = 'short' | 'medium' | 'detailed'
export type EmailVoiceDirectness = 'gentle' | 'balanced' | 'direct'
export type EmailVoiceFormattingPreference = 'paragraphs' | 'bullets' | 'mixed'
export interface EmailVoiceProfile {
  id: string
  accountId: string
  name: string
  tone: EmailVoiceTone
  lengthPreference: EmailVoiceLengthPreference
  directness: EmailVoiceDirectness
  formattingPreference: EmailVoiceFormattingPreference
  greetingPreference: string
  signoffPreference: string
  avoidPhrases: string[]
  examples: string[]
  updatedAt: string
}

export interface ThreadContextSummary {
  threadId: string
  participants: MailContact[]
  currentAsk: string
  openCommitments: string[]
  deadlines: string[]
  attachmentsMentioned: string[]
  summary: string
  updatedAt: string
}

export interface MailLearningRule {
  id: string
  kind: MailLearningRuleKind
  scope: MailLearningRuleScope
  value: string
  action: 'suppress' | 'allow' | 'important' | 'other'
  enabled: boolean
  createdAt: string
  provenance: string
}

/** What the AI decided a thread needs. */
export type MailAiTriageVerdict = 'needs_reply' | 'important' | 'fyi' | 'noise'

/**
 * One AI triage decision about one thread, made against its latest message.
 * A newer message makes the thread untriaged again; the record stays as
 * history. Subject and sender are kept so the report still reads after the
 * thread has left the sync window.
 */
export interface MailAiTriageRecord {
  threadId: string
  accountId: string
  /** The latest delivered message the decision was made against. */
  messageId: string
  seenAt: string
  verdict: MailAiTriageVerdict
  reason: string
  /** The concrete next step, for needs_reply and important. */
  action?: string
  subject: string
  from: MailContact
  decidedAt: string
  decidedBy: 'agent' | 'user' | 'model'
  confidence?: number
  model?: string
  provider?: 'typesafe' | 'local'
  /** The assistant's verdict when the user changed it. */
  correctedFrom?: MailAiTriageVerdict
}

export interface FollowUpSettings {
  defaultDelayDays: 1 | 2 | 3 | 7
  defaultMode: 'snooze' | 'task' | 'snooze_and_task'
  defaultTaskListId?: string
  statusCopy?: string
  /**
   * Working days without a reply before a sent thread counts as overdue —
   * what the Follow-ups filter counts. Absent means 3.
   */
  replyThresholdWorkingDays?: 1 | 2 | 3 | 5 | 7
}

export type MailClassificationMode = 'local' | 'model'
export type MailFetchWindow = 'today' | '3d' | '7d' | '14d' | '30d'
export type MailFetchIntervalMinutes = 5 | 15 | 30 | 60

/**
 * A named signature (Phase M2). `accountId` scopes the signature to one
 * account; without it the signature is available to every account. The
 * legacy single `MailSettings.signature` string remains the fallback when
 * no signature list exists.
 */
export interface MailSignature {
  id: string
  accountId?: string
  name: string
  body: string
  isDefault?: boolean
}

/** A named query the user pinned to the sidebar. */
/** What a matched filter does to a thread. */
export interface MailFilterActions {
  /** Apply this label (created locally if missing). */
  labelName?: string
  /** Leave the inbox (archive) — the "file into box" half of the recipe. */
  skipInbox?: boolean
  markRead?: boolean
}

/**
 * A filter is a named QUERY with actions — same query language as search
 * and saved views, same matcher, no second condition DSL.
 */
export interface MailFilterRule {
  id: string
  name: string
  query: string
  actions: MailFilterActions
  enabled: boolean
  createdAt: string
  hitCount: number
  lastHitAt?: string
}

export interface MailSavedView {
  id: string
  name: string
  query: string
  createdAt: string
}

/**
 * Remote-image loading policy. Missing means `ask` with an empty trusted
 * list — the privacy default. "Off" states are explicit values, never key
 * removal: the shell config merge is a spread-merge and cannot delete keys.
 */
export interface RemoteImageSettings {
  /** `ask` (default) blocks until the user chooses; `always` loads everywhere. */
  policy?: 'ask' | 'always'
  /** Normalized (trimmed, lowercased) sender emails whose images auto-load. */
  trustedSenders?: string[]
}

export interface MailSettings {
  typedTriage?: { provider?: 'typesafe' | 'local'; localModel?: string; localConfidence?: number; mode: 'off' | 'shadow' | 'suggest'; dailyCap: number; confidence: number }

  /** The IMAP-family account, when one is configured. */
  imapAccount?: ImapAccountSettings
  classificationMode?: MailClassificationMode
  replyDraftingInstructions?: string
  fetchWindow?: MailFetchWindow
  autoFetchEnabled?: boolean
  fetchIntervalMinutes?: MailFetchIntervalMinutes
  quotedHistoryOpenByDefault?: boolean
  autoDraftVoiceEngine: AutoDraftVoiceEngine
  emailVoiceProfiles?: EmailVoiceProfile[]
  activeEmailVoiceProfileId?: string
  signature: string
  /**
   * Undo-send hold in seconds (Phase M4). 0 sends immediately; missing
   * means the 10s default.
   */
  undoSendDelaySeconds?: 0 | 5 | 10 | 20 | 30
  /** Named signatures (Phase M2); overrides `signature` when present. */
  signatures?: MailSignature[]
  ownerIdentities?: OwnerIdentitySettings
  followUp?: FollowUpSettings
  connectionProfiles?: MailConnectionProfile[]
  /** Remote-image loading policy; missing = ask, no trusted senders. */
  remoteImages?: RemoteImageSettings
}

/**
 * Snooze metadata for a thread. `MailThread.snoozedUntil` remains the quick
 * per-thread marker; this record carries the full metadata (when it was
 * snoozed, where it returns) so unsnooze can restore state faithfully.
 */
export interface MailThreadSnooze {
  threadId: string
  snoozedUntil: string
  snoozedAt: string
  /** Mailbox the thread returns to when the snooze wakes. */
  returnMailboxId?: string
  reason?: 'manual' | 'follow_up'
}

/**
 * Cached provider label metadata (e.g. Gmail labels API), refreshed on sync.
 * Distinct from `MailLabel` (the app's local label view): this is the raw
 * provider surface used to map local labels onto provider label ids.
 */
export interface ProviderLabelMetadata {
  /** Provider-side label id (e.g. Gmail label id). */
  id: string
  name: string
  type: 'system' | 'user'
  color?: string
  unreadCount?: number
  totalCount?: number
  updatedAt: string
}

export type QueuedMailActionType =
  | 'archive'
  | 'unarchive'
  | 'trash'
  | 'markRead'
  | 'markUnread'
  | 'label'
  | 'unlabel'
  | 'move'
  | 'star'
  | 'unstar'
  | 'pin'
  | 'unpin'
  | 'snooze'
  | 'unsnooze'

/**
 * A provider action captured while offline (or while the provider call
 * failed), queued for replay on the next successful sync.
 */
export interface QueuedMailAction {
  id: string
  type: QueuedMailActionType
  threadId: string
  /** Action-specific arguments (labelId, mailboxId, snoozedUntil, ...). */
  payload?: Record<string, unknown>
  queuedAt: string
  attempts: number
  lastError?: string
}

export type ScheduledSendStatus =
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed'

export interface ScheduledSend {
  id: string
  draftId: string
  threadId: string
  /** ISO timestamp at which the draft should be sent. */
  sendAt: string
  createdAt: string
  status: ScheduledSendStatus
  lastError?: string
}

export type MailNotificationScope = 'all' | 'important' | 'none'

export interface MailNotificationPreferences {
  enabled: boolean
  scope: MailNotificationScope
  /** Mute all mail notifications until this ISO timestamp. */
  mutedUntil?: string
  /** Per-account scope overrides, keyed by account id (Phase M4). */
  perAccount?: Record<string, MailNotificationScope>
  /** Notify when a snoozed thread returns to the inbox (Phase M4). */
  notifyOnSnoozeReturn?: boolean
}

export interface MailStore {
  /**
   * Persisted-shape version. Missing means a pre-versioning blob; see
   * migratePersistedMailStore (issue #153 class: migrations must default
   * missing fields and preserve unknown ones, never drop state).
   */
  storeVersion?: number
  accounts: MailAccount[]
  mailboxes: Mailbox[]
  threads: MailThread[]
  messages: MailMessage[]
  tasks: MailTask[]
  taskLists: TaskList[]
  drafts: Draft[]
  labels: MailLabel[]
  settings: MailSettings
  learningRules?: MailLearningRule[]
  /** AI triage decisions, one per thread, newest first. */
  aiTriage?: MailAiTriageRecord[]
  threadContextSummaries?: ThreadContextSummary[]
  /** Thread ids the user has starred (provider sync lands in Phase M1). */
  starredThreadIds?: string[]
  /** Thread ids the user has pinned to the top of the rail. */
  pinnedThreadIds?: string[]
  /** Full snooze metadata per snoozed thread. */
  snoozes?: MailThreadSnooze[]
  /** Named queries pinned to the sidebar. */
  savedViews?: MailSavedView[]
  /** Ordered filter rules, applied to newly synced threads. */
  filters?: MailFilterRule[]
  /**
   * Canonical query → when the user last looked at it. Drives the
   * unseen-arrivals badge on views, boxes, and labels: filtered mail
   * lands where you are not looking, and something must say so.
   */
  querySeenAt?: Record<string, string>
  /** Provider label metadata cache (e.g. Gmail labels API). */
  providerLabels?: ProviderLabelMetadata[]
  /** Offline/failed provider actions queued for replay. */
  queuedActions?: QueuedMailAction[]
  /**
   * Invite keys (uid#sequence#method) already mirrored into PureCalendar,
   * so a re-synced message does not re-write its intent forever. Capped.
   */
  mirroredInviteKeys?: string[]
  /**
   * Addresses already fed to PurePeople's contact book, so a re-synced
   * message does not re-feed its correspondents forever. Capped.
   */
  contactFeedKeys?: string[]
  /**
   * Threads already reported to PurePeople as encounters (who was on them),
   * by thread id, with the message count and latest time they were sent at,
   * so a thread is re-sent only when it changes. Capped.
   */
  encounterFeedMarks?: Record<string, string>
  /** Drafts scheduled to send later. */
  scheduledSends?: ScheduledSend[]
  /**
   * Send runs: mail-merge sessions that own draft IDS and statuses, never
   * content. The rendered drafts are ordinary entries in `drafts`.
   */
  runs?: MailRun[]
  /** Notification preferences for incoming mail. */
  notificationPreferences?: MailNotificationPreferences
  /**
   * Set by providers on fetch results only: describes what the fetch actually
   * covered so the merge never treats uncovered threads as remotely deleted.
   */
  syncCoverage?: MailSyncCoverage
}

/**
 * One provider-side draft, as the drafts listing reports it: the draft's own
 * id (what update and delete address) alongside the message it wraps.
 */
export interface ProviderDraftRef {
  providerDraftId: string
  messageId: string
  threadId: string
}

/**
 * A configured IMAP/SMTP account (manual, Proton Bridge, or Gmail via app
 * password — the whole IMAP family rides this). Server settings are readable
 * configuration; the password lives in the slug-scoped secrets store under
 * `imap-password.<profileId>` and is read main-side by the shell transport,
 * never by the renderer.
 */
export interface ImapAccountSettings {
  profileId: string
  label: string
  email: string
  username: string
  imap: { host: string; port: number; security: 'ssl' | 'starttls' | 'none' }
  smtp: { host: string; port: number; security: 'ssl' | 'starttls' | 'none' }
  /** SMTP login when it differs from the IMAP one (e.g. Proton Bridge). */
  smtpUsername?: string
  /**
   * True when a separate SMTP password was stored under
   * `smtp-password.<profileId>`; without it sending reuses the IMAP key.
   * Recorded here because the secrets store is write-only to the renderer.
   */
  hasSmtpPassword?: boolean
  /** The boot decision: an active IMAP account wins over demo. */
  active: boolean
}

export interface MailSyncCoverage {
  /**
   * ISO timestamp. When the fetch hit its thread cap, only threads with
   * lastMessageAt >= coveredFrom were fully listed; older local threads must
   * not be dropped just because they are missing from this fetch.
   */
  coveredFrom?: string
  /** Thread ids the fetch attempted but could not retrieve (kept locally). */
  failedThreadIds?: string[]
  /** Number of threads that could not be fetched this sync. */
  failedCount?: number
  /**
   * The fetch listed the provider's drafts, so `store.drafts` is the complete
   * remote set and a synced draft missing from it was sent or deleted
   * remotely. Without this flag the merge cannot tell "no drafts" from "did
   * not look", and must never remove anything.
   */
  draftsCovered?: boolean
}

export interface SendDraftInput {
  draft: Draft
  threadId: string
}

/**
 * Optional-capability surface for mail providers. UI features gate on these
 * flags so limited providers (demo, future IMAP) degrade gracefully instead
 * of offering actions the provider cannot honour. A missing capability map or
 * a missing flag means "not supported" — callers must treat undefined as
 * false (see mailProviderSupports).
 */
export interface MailProviderCapabilities {
  /** Provider can send outbound mail (new messages, replies, forwards). */
  compose?: boolean
  /** Provider persists drafts (locally or provider-backed). */
  drafts?: boolean
  /** Provider supports listing/applying labels to threads. */
  labels?: boolean
  /** Provider supports efficient multi-thread bulk actions. */
  bulkActions?: boolean
}

export interface MailProvider {
  /**
   * Declares what this provider supports. Optional so existing/third-party
   * providers keep compiling; absent means "assume nothing beyond the
   * required methods".
   */
  readonly capabilities?: MailProviderCapabilities
  fetchStore(): Promise<MailStore>
  sync(store: MailStore): Promise<MailStore>
  send(input: SendDraftInput): Promise<MailMessage>
  getAttachmentContent?(
    message: MailMessage,
    attachment: Attachment,
  ): Promise<Attachment>
  fetchThreadById?(
    threadId: string,
  ): Promise<{ threads: MailThread[]; messages: MailMessage[] } | null>
  searchThreadSummaries?(
    query: string,
    limit?: number,
  ): Promise<
    Array<{
      threadId: string
      subject: string
      from: string
      date: string
      snippet: string
      inLocalWindow: boolean
    }>
  >
  search(query: string): Promise<
    Array<{
      id: string
      type: 'thread' | 'message' | 'task' | 'attachment'
      title: string
    }>
  >
  labelThread(threadId: string, labelId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  unarchiveThread?(threadId: string): Promise<void>
  moveThread(threadId: string, mailboxId: string): Promise<void>
  deleteThread(threadId: string): Promise<void>
  markThreadRead(threadId: string, read: boolean): Promise<void>
  /**
   * Star/unstar a thread remotely (Gmail: the STARRED label). Providers
   * without remote star support omit this method and star state stays
   * local-only.
   */
  setThreadStarred?(threadId: string, starred: boolean): Promise<void>
  /**
   * Snooze a thread until an ISO timestamp. Only meaningful when the
   * `snooze` capability flag is true; full snooze semantics land in
   * Phase M4.
   */
  snoozeThread?(threadId: string, snoozedUntil: string): Promise<void>
  /**
   * Efficient provider-side bulk mutation. Only used when the
   * `bulkActions` capability flag is true; callers fall back to
   * per-thread calls otherwise.
   */
  bulkModifyThreads?(
    threadIds: string[],
    action: QueuedMailActionType,
    payload?: Record<string, unknown>,
  ): Promise<void>
  /**
   * Provider-backed drafts (Gmail drafts API). Only meaningful when the
   * `drafts` capability flag is true; returns the provider draft id so the
   * local draft can update/delete the same remote draft later. Providers
   * without remote drafts omit these and drafts stay local.
   */
  createDraft?(draft: Draft): Promise<string>
  /**
   * Update a stored draft. Providers whose update REPLACES the stored
   * object (IMAP: append new + delete old) return the replacement id so
   * the caller can re-point the local record — without it, the next sync
   * saw a provider id that no longer existed, deleted the local draft as
   * "removed at the provider", and re-imported the replacement as a brand
   * new record (identity churn mid-edit).
   */
  updateDraft?(providerDraftId: string, draft: Draft): Promise<string | void>
  deleteDraft?(providerDraftId: string): Promise<void>
  /**
   * The provider's own drafts. Without this the draft sync was one-way by
   * construction: a draft written in Gmail could never become an editable
   * draft here, and one sent or deleted there stayed here forever.
   */
  listDrafts?(): Promise<ProviderDraftRef[]>
  /**
   * Provider label surface (Gmail labels API), behind the `labels`
   * capability flag. `createLabel` returns the created provider label;
   * `unlabelThread` removes a previously applied label.
   */
  createLabel?(name: string): Promise<ProviderLabelMetadata>
  unlabelThread?(threadId: string, labelId: string): Promise<void>
}

export interface SearchIndex {
  query(query: string): Promise<
    Array<{
      id: string
      type: 'thread' | 'message' | 'attachment' | 'task'
      title: string
    }>
  >
}

// ── Send runs ─────────────────────────────────────────────────────────

export type MailRunStatus = 'setup' | 'ready' | 'running' | 'paused' | 'done'

export type MailRunItemStatus =
  | 'pending'
  | 'reviewing'
  | 'sent'
  | 'skipped'
  /** The draft was deleted outside the run; skipped with that reason. */
  | 'missing'

export interface MailRunRecipientSource {
  kind: 'sheet' | 'csv' | 'pasted' | 'drafts'
  /** Absolute path for file-backed sources. */
  path?: string
  /** What the UI shows: a file name, "Pasted addresses", … */
  label: string
}

export interface MailRunRecipients {
  source: MailRunRecipientSource
  columns: string[]
  rows: Record<string, string>[]
}

/** How one `{{token}}` resolves from a recipient row. */
export interface MailRunFieldBinding {
  column: string
  /** Derive the value from the column (e.g. first word of a full name). */
  transform?: 'first-word'
}

export interface MailRunItem {
  /** Index into `recipients.rows`; absent for an inherited existing draft. */
  rowIndex?: number
  draftId: string
  status: MailRunItemStatus
  /** Display label (recipient name or address) so the rail needs no draft. */
  label?: string
  sentAt?: string
  sentMessageId?: string
  /** The undo-send hold that is still open for this item, while it is. */
  pendingSendId?: string
  noteAdded?: boolean
  /** Why the item was skipped when the run did it (missing draft, …). */
  skipReason?: string
  /** Best-effort: the address was already emailed this calendar month. */
  emailedThisMonth?: boolean
}

/**
 * A send run: a mail-merge session reviewed and sent one draft at a time.
 * The run owns ids and statuses; every draft it points at is an ordinary
 * draft in Drafts, editable anywhere between sessions.
 */
export interface MailRun {
  id: string
  name: string
  accountId: string
  status: MailRunStatus
  /** The template is itself a draft. Absent for a run built from drafts. */
  template?: { draftId: string }
  recipients?: MailRunRecipients
  /** Token name → how it resolves from a row. */
  fieldMap: Record<string, MailRunFieldBinding>
  /** The template carries a personal-note slot. */
  noteSlot: boolean
  items: MailRunItem[]
  /** Index into `items` of the draft on screen (or to resume at). */
  cursor: number
  createdAt: string
  updatedAt: string
  /** Done runs leave the rail once archived; the record stays. */
  archivedAt?: string
}
