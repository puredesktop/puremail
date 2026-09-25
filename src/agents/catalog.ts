import type { PreparedReply } from '../lib/mailDrawerDrafts'
import type { Attachment, Draft, MailMessage, MailStore, MailThread } from '../types'
import type { MailProposal } from '../lib/mailProposal'

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const PUREMAIL_AGENT_TOOL_NAMES = [
  'getMailContext',
  'listThreads',
  'searchAllMail',
  'getThread',
  'showQuery',
  'listViews',
  'saveView',
  'deleteView',
  'applyMailAction',
  'markThreadsRead',
  // AI triage: the assistant judges each thread; the app feeds it batches
  // that fit one tool result and keeps the verdicts.
  'nextTriageBatch',
  'recordTriage',
  'getTriageReport',
  'listMailChanges',
  'draftReply',
  'commitReplyDraft',
  'composeMessage',
  'listDrafts',
  'getDraft',
  'updateDraft',
  'discardDraft',
  'addDraftAttachments',
  'removeDraftAttachment',
  // Documents out of mail: attachments saved as files, an email as a PDF.
  'saveAttachments',
  'saveMessageAsPdf',
  'createMailTask',
  'listFilters',
  'createFilter',
  'applyFilterRetroactively',
  'deleteFilter',
  'setFilterEnabled',
  'createBox',
  'listBoxes',
  'fileThread',
  'openThread',
  // Send runs (mail-merge with a review-and-send loop). No "send all".
  'listRuns',
  'getRun',
  'createRun',
  'createRunFromDrafts',
  'renderRun',
  'setRunNote',
  'sendRunItem',
  'skipRunItem',
  'pauseRun',
  'resumeRun',
  'setRunRecipients',
  'setRunFieldMap',
  'setRunTemplate',
  'insertRunNoteSlot',
  'previewRunItem',
  'addDraftsToRun',
  'archiveRun',
] as const

export const PUREMAIL_AGENT_LOG_LABEL = 'puremail'

/** A tool argument was missing or unusable. Surfaced to the model verbatim. */
export class AgentMailToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentMailToolError'
  }
}

/**
 * Everything the handlers can read or drive. Deliberately narrow: agents
 * read through the same resolver the rail uses and write only by staging a
 * proposal the user approves.
 */
export interface MailAgentToolContext {
  store: MailStore
  /** Fresh state after asynchronous storage work. */
  getStore?: () => MailStore
  accountId: string | undefined
  /**
   * The clock every query resolution uses. Real callers pass the wall
   * clock; tests pin it so fixtures never age out of the fetch window.
   */
  now?: Date
  /** The query the mail list is showing right now. */
  currentQuery: string
  selectedThread: MailThread | null
  /** Point the user's rail at a query. */
  showQuery: (query: string) => void
  /**
   * Open ONE thread in the reader. Navigation, not mutation — but it moves
   * the user's screen, so agents ask in chat before calling it.
   */
  openThreadInReader?: (threadId: string, messageId?: string | null) => void
  setStore: (updater: (store: MailStore) => MailStore) => void
  /**
   * Apply a resolved bulk action immediately. The action is recorded in the
   * operations ledger (the mail agent log) — the log, not a review queue,
   * is the accountability mechanism; approval gates are the shell's
   * permissions.
   */
  applyAction: (proposal: MailProposal) => void
  /**
   * Mark specific threads read or unread — the same optimistic triage path
   * the reader's Mark unread and the list's bulk read/unread use, provider
   * sync included. By thread id, unlike applyMailAction's query.
   */
  setThreadsRead?: (threadIds: string[], read: boolean) => void
  /** Read the mail slice of the operations ledger, newest first. */
  listMailOperations: (limit: number) => Promise<
    Array<{ at: string; lane: string; kind: string; summary: string }>
  >
  /** Fire filter-engine remote mutations through the live provider. */
  fireFilterMutations?: (
    mutations: readonly import('../lib/mailFilters').MailFilterMutation[],
  ) => void
  /**
   * TRUE move to a provider-real mailbox (an IMAP folder): server first,
   * local mirror after. fileThread routes here when the named box is an
   * actual account folder rather than a local label-backed box.
   */
  moveThreadToMailbox?: (
    threadId: string,
    mailboxId: string,
  ) => Promise<void>
  addTaskForThread: (
    threadId: string,
    title: string,
    options: { dueAt?: string; priority?: string },
  ) => void
  /** Prepare context only; the calling drawer performs the reasoning. */
  requestDraftForThread: (threadId: string, brief?: string) => Promise<PreparedReply>
  commitReplyDraft?: (requestId: string, body: string) => Record<string, unknown>
  /** Rewrite a draft the agent already knows the id of. */
  editDraft?: (
    draftId: string,
    patch: { body?: string; subject?: string; to?: string; cc?: string; bcc?: string },
    expectedVersion?: string,
  ) => { ok: true } | { ok: false; reason: string }
  /**
   * Read a local file's bytes for attaching. Bridge-backed in the shell;
   * tests inject a stub. `truncated` means the file was larger than
   * `maxBytes` and the read is unusable as an attachment.
   */
  readAttachmentFile?: (
    path: string,
    maxBytes: number,
  ) => Promise<{
    base64: string
    mimeType?: string
    truncated?: boolean
    byteLength?: number
  }>
  /**
   * Replace a draft's attachment list — the one write both attachment tools
   * make. Goes through the same draft update the compose window's save
   * uses, so provider sync and the open compose window both see it.
   * `summary` is the ledger line for the change.
   */
  setDraftAttachments?: (
    draftId: string,
    attachments: Attachment[],
    summary: string,
  ) => { ok: true } | { ok: false; reason: string }
  /**
   * Fetch an attachment's bytes from the mail server when only its metadata
   * is local — the same provider call the reader's Save and Preview make —
   * and keep the result on the message. Null when it cannot be fetched.
   */
  resolveAttachment?: (
    message: MailMessage,
    attachment: Attachment,
  ) => Promise<Attachment | null>
  /** Write a file's bytes (base64) through the shell. */
  writeBinaryFile?: (path: string, base64: string) => Promise<void>
  /** Names already in a folder; throws when it cannot be listed. */
  listFolderNames?: (folder: string) => Promise<string[]>
  /** Print messages to a PDF in `folder`; resolves to the PDF's path. */
  saveMailPdf?: (input: {
    subject: string
    messages: MailMessage[]
    folder: string
  }) => Promise<{ path: string }>
  /** The user's workspace folder (absolute), when the shell has one set. */
  workspaceFolder?: string | null
  /**
   * Where documents saved out of mail go: a Mail folder inside the user's
   * workspace, created on first use. Never a caller-supplied path — every
   * save lands in the working directory, so nothing is written elsewhere.
   */
  saveFolder?: () => Promise<string>
  /** One line in the mail slice of the operations ledger. */
  recordOperation?: (kind: string, summary: string) => void
  /** Throw a draft away, locally and at the provider. */
  discardDraft?: (draftId: string) => { ok: true } | { ok: false; reason: string }
  /** Read a UTF-8 text file by absolute path (recipient lists: CSV, .sheets). */
  readTextFile?: (path: string) => Promise<string>
  /**
   * THE store-draft send the run screen's Send & next uses: one existing
   * draft, finalized, through the usual undo hold and provider path.
   * Present only in a live session; approval-gated per tool call.
   */
  sendStoreDraft?: (
    draft: Draft,
    options: {
      label?: string
      onCommitted?: (sentMessageId: string | undefined) => void
      onFailed?: (reason: string) => void
    },
  ) => { ok: true; pendingId: string; undoSeconds: number } | { ok: false; reason: string }
  /** Put a run on the user's screen at its first open item (resumeRun). */
  openRun?: (runId: string) => void
  /**
   * Compose a NEW message — its own thread in Drafts, answering nothing.
   * Separate from requestDraftForThread because that one is a reply to a
   * conversation the user already has; an agent asked to write fresh mail
   * had to borrow a thread and the result read as a reply. Nothing sends.
   */
  composeNewMessage?: (input: {
    bcc?: string
    body: string
    cc?: string
    subject: string
    to: string
  }) => { draftId: string; threadId: string }
  /**
   * Record a search an agent just ran so the client can show it. Reads must
   * never hijack the rail — agents probe with several queries while working —
   * so the log is passive: the user clicks an entry to look at one.
   */
  noteAgentSearch: (search: { query: string; total: number }) => void
  /**
   * Server-side Gmail search, present only when a provider is connected.
   * Reaches past the local fetch window; results outside it cannot be
   * opened with getThread because the local store has never seen them.
   */
  /**
   * Fetch a thread the local store has never seen and merge it in. Returns
   * the fragment so a handler can answer from it immediately rather than
   * racing the state update.
   */
  importRemoteThread?: (
    threadId: string,
  ) => Promise<{ threads: MailThread[]; messages: MailMessage[] } | null>
  searchAllMail?: (
    query: string,
    limit: number,
  ) => Promise<
    Array<{
      threadId: string
      subject: string
      from: string
      date: string
      snippet: string
      inLocalWindow: boolean
    }>
  >
}

export function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentMailToolError(`"${key}" is required.`)
  }
  return value.trim()
}

export function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}
