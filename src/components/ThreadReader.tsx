import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactElement } from 'react'
import type { MouseEvent } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderInput,
  Forward,
  MailOpen,
  MoreHorizontal,
  Reply as ReplyIcon,
  ReplyAll,
  Sparkles,
  SquareCheck,
  Trash2,
} from 'lucide-react'
import type { CalendarInviteResponse } from '@purescience/platform-ui/bridge/calendarInviteIntent'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import {
  MailFilterDialog,
  type MailFilterDialogSubmit,
} from './MailFilterDialog'
import {
  clearFilterRunMarkers,
  addMailFilter,
  accountFolderForBoxName,
  ensureMailLabel,
  fileThreadToBox,
  runMailFilters,
  type MailFilterMutation,
} from '../lib/mailFilters'
import { useOutsideClose } from './useOutsideClose'
import {
  ThreadHistoryPill,
  ThreadHistoryPopover,
  ThreadTimelineView,
} from './ThreadHistoryViews'
import {
  buildThreadHistoryEntries,
  isInviteNoticeBody,
  type ThreadHistoryEntry,
  type ThreadHistoryFilter,
} from './threadHistory'
import { quoteQueryValue, saveMailView } from '../lib/mailQuery'
import { draftLaunchPreview } from '../lib/replyCompose'
import {
  draftKindForDraft,
  readerMailBody,
  recoverMailThreadSync,
} from '../lib/mailModel'
import {
  mailHtmlHasRemoteImages,
  sanitizeMailHtml,
} from '../lib/sanitizeMailHtml'
import {
  remoteImageBannerState,
  remoteImageDecision,
  setRemoteImagePolicy,
  trustSender,
  untrustSender,
} from '../lib/remoteImagePolicy'
import {
  attachmentContentToBase64,
  attachmentDisplaySize,
  attachmentImageDataUrl,
  attachmentPdfDataUrl,
  attachmentKindLabel,
  attachmentPreviewKind,
  attachmentTextContent,
  isPdfAttachment,
  safeAttachmentFileName,
  writeAttachmentsToFolder,
} from '../lib/mailAttachments'
import { mailPdfFileName, saveMailAsPdf } from '../lib/mailPdf'
import {
  ATTACHMENT_VIEWER_CACHE_DIR,
  ATTACHMENT_VIEWER_PROBE_FILE,
  isViewerUnsupportedError,
  openAttachmentInViewerWindow,
  parentDirectoryPath,
} from '../lib/attachmentViewer'
import {
  dialogSaveFile,
  dialogSaveFolder,
  openCalendarApp,
  fsCreateFolder,
  fsListNames,
  fsWriteBinary,
  isStandaloneDevMode,
  mailPdfDeps,
  openExternalUrl,
  openFileViewerWindow,
  osReveal,
  readPlatformStorageJson,
  recordOperation,
} from '../bridge/platformBridge'
import { AiTriageControl } from './AiTriageControl'
import type {
  Attachment,
  Draft,
  MailAccount,
  Mailbox,
  MailMessage,
  MailProvider,
  MailStore,
  MailThread,
  QaDraftStatus,
} from '../types'
import {
  AttachmentActionButton,
  AttachmentChip,
  AttachmentList,
  AttachmentMeta,
  AttachmentName,
  CollapsedQuoteBoundary,
  ComposeLabel,
  ExpandedQuoteBlock,
  ExpandedQuoteHeader,
  FiledLine,
  Kicker,
  MailStateChip,
  MailSystemBanner,
  MessageBody,
  MessageCard,
  Meta,
  QaEditedTag,
  AttachmentBandInner,
  AttachmentChipControlsRight,
  AttachmentChipActions,
  AttachmentChips,
  AttachmentRowMeta,
  AttachmentRowName,
  AttachmentRowText,
  AttachmentTypeTile,
  ReaderAttachmentChip,
  ReaderAttachmentBand,
  ReaderBackButton,
  ReaderBandInner,
  ReaderCardBody,
  ReaderCardHeader,
  ReaderEmptyState,
  InviteCard,
  InviteCardActions,
  InviteCardHead,
  InviteCardLabel,
  InviteCardMeta,
  InviteCardNote,
  InviteCardTitle,
  InviteCardWhen,
  InviteStatusMeta,
  InviteStatusPill,
  InviteStatusRow,
  InviteStatusText,
  ToolbarDivider,
  ProvenanceLine,
  ReaderDetailsButton,
  ReaderDetailsPanel,
  type InviteStatusTone,
  MessageStickyAnchor,
  MessageStickyHeader,
  MessageStickyInner,
  MessageStickySenderName,
  ReaderCondensedSubject,
  ReaderHeaderBand,
  ReaderPane,
  ReaderScroll,
  ReaderScrollBody,
  ReaderStateChip,
  ReaderStateLine,
  ReaderPosition,
  ReaderSenderAvatar,
  ReaderSenderName,
  ReaderSenderRow,
  ReaderSenderTo,
  ReaderTaskChip,
  ReaderTimestamp,
  ReaderToolbar,
  ReaderToolbarButton,
  ReaderToolbarLabel,
  ReaderToolbarPrimary,
  ReaderToolbarSwap,
  ReaderToolbarSwapLayer,
  READER_TOOLBAR_HEIGHT,
  ReplyLaunchKicker,
  ReplyLaunchOpen,
  ReplyLaunchPreview,
  ReplyLaunchStrip,
  SentReplyBody,
  SentReplyRecipient,
  SentReplyRecipientText,
  TextLinkButton,
  Title,
  AskChip,
  AskInput,
  AskInputRow,
  AskPanel,
  AskPanelHeader,
  AskPanelTitle,
  AskStatusLine,
  AskSuggestionRow,
  BulkMenuItem,
  BulkMenuWrap,
  ThreadActionsMenu,
} from './mailShellStyles'
import {
  attachmentExtension,
  displayThreadLabels,
  formatContactsInput,
  formatDate,
  formatThreadListTime,
  isCalendarAttachment,
  messageDirectionForAccount,
  draftKindLabel,
  providerName,
  sentDraftRecipientSummary,
  threadStatusLabel,
  threadStatusTone,
  threadSyncLabel,
  senderAvatar,
  type AttachmentPreviewState,
} from './mailShellHelpers'


/**
 * Plain text rendered as real paragraphs: blank-line groups split
 * paragraphs, single newlines stay as line breaks INSIDE one. The old
 * per-line rendering gave EVERY line its own <p> (each with a paragraph
 * margin) and every blank line a full `&nbsp;` paragraph — inches of air
 * between two sentences.
 */
function plainTextParagraphs(
  text: string,
  keyPrefix: string,
): React.ReactNode[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.replace(/^\n+|\n+$/g, ''))
    .filter(paragraph => paragraph.trim().length > 0)
    .map((paragraph, paragraphIndex) => (
      <p key={`${keyPrefix}-${paragraphIndex}`}>
        {paragraph.split('\n').map((line, lineIndex, lines) => (
          <Fragment key={`${keyPrefix}-${paragraphIndex}-${lineIndex}`}>
            {line}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </p>
    ))
}

export interface ThreadReaderProps {
  store: MailStore
  setStore: React.Dispatch<React.SetStateAction<MailStore>>
  storeRef: React.MutableRefObject<MailStore>
  providerBacked: MailProvider | undefined
  activeProvider: 'demo' | 'gmail' | 'imap'
  mailProviderRef: React.MutableRefObject<MailProvider | undefined>
  selectedThreadStarred: boolean
  toggleThreadStarred: (threadId: string) => void
  selectedThread: MailThread
  selectedMailbox: Mailbox | null
  selectedAccount: MailAccount | null
  selectedMessages: MailMessage[]
  selectedThreadReplyDrafts: Draft[]
  activeMessageTab: MailMessage | null
  activeReplyDraft: Draft | null
  selectedThreadDrafting: boolean
  selectedThreadGeneratedDraft: Draft | null
  selectedThreadQaStatus: QaDraftStatus | null
  selectedInvite: MailMessage['calendarInvite']
  selectedInviteMessage: MailMessage | undefined
  readerMode: 'email' | 'reply'
  setReaderMode: React.Dispatch<React.SetStateAction<'email' | 'reply'>>
  setActiveMessageTabId: React.Dispatch<React.SetStateAction<string | null>>
  setActiveReplyDraftId: React.Dispatch<React.SetStateAction<string | null>>
  focusedMessageId: string | null
  setFocusedMessageId: React.Dispatch<React.SetStateAction<string | null>>
  setFocusedDraftId: React.Dispatch<React.SetStateAction<string | null>>
  expandedQuotedMessageIds: string[]
  setExpandedQuotedMessageIds: React.Dispatch<React.SetStateAction<string[]>>
  collapsedQuotedMessageIds: string[]
  setCollapsedQuotedMessageIds: React.Dispatch<React.SetStateAction<string[]>>
  remoteImagesLoadedIds: string[]
  setRemoteImagesLoadedIds: React.Dispatch<React.SetStateAction<string[]>>
  attachmentActionErrors: Record<string, string>
  setAttachmentActionErrors: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >
  setAttachmentPreview: React.Dispatch<
    React.SetStateAction<AttachmentPreviewState | null>
  >
  systemNotice: string
  systemNoticeDismissed: boolean
  setSystemNoticeDismissed: React.Dispatch<React.SetStateAction<boolean>>
  mailDraftNotice: string
  setCommandNotice: React.Dispatch<React.SetStateAction<string>>
  markSelectedUnread: () => void
  deleteSelectedThread: () => void
  addSelectedThreadToCalendar: () => Promise<void>
  forwardSelectedThread: () => void
  /**
   * Opens an existing unsent draft in the docked compose window — the ONE
   * composer surface. The launcher strip, the history pill, and the Ask
   * panel's "Open draft" all go through it.
   */
  openDraftInComposeWindow: (draft: Draft) => void
  replyWithBody: (body: string) => void
  /** Opens the task drawer and scrolls this task into view inside it. */
  openTaskDrawer: () => void
  /** Tasks filed against this thread, for the header chip. */
  threadTaskCount: number
  addTask: () => void
  /** 1-based position of this thread in the list, and the list's length. */
  threadPosition: number
  threadTotal: number
  selectAdjacentThread: (offset: 1 | -1) => void
  /** Closes the reader; only reachable where it overlays the list. */
  closeThread: () => void
  /**
   * The shell's 50px search band. While reading it belongs to the reader's
   * SCROLL FLOW — it scrolls away with the content and scrolls back in at
   * the top, like any other content — so the shell hands the one instance
   * here instead of rendering it fixed above the columns.
   */
  topBar?: React.ReactNode
  focusReply: () => void
  focusReplyAll: () => void
  askThreadAgent: (question: string) => Promise<string>
  summarizeSelectedThread: () => Promise<{
    summary: string
    actionItems: string[]
  }>
  addExtractedTask: (title: string) => void
  createSelectedThreadDraft: (brief?: string) => void
  archiveSelectedThread: () => void
  unarchiveSelectedThread: () => void
  addFollowUp: () => void
  openCalendarInvite: (response?: CalendarInviteResponse) => Promise<void>
  openCalendarInviteForMessage: (
    message: MailMessage,
    response?: CalendarInviteResponse,
  ) => Promise<void>
}

/**
 * One message's sanitized body.
 *
 * The sanitizer is a DOMParser plus a full tree walk — 6ms for a 15KB email,
 * 15ms for 62KB. It used to run inline in the render, for every message in
 * the thread, on every render of this component. Since compose state lives in
 * the shell above, that meant re-sanitizing the whole open thread on every
 * keystroke: a five-message thread spent 30-75ms per key against a 16ms
 * frame, which is exactly what typing in the compose box felt like.
 *
 * Its own component so the work can be memoized on the only two things it
 * depends on. A render that changes neither now costs nothing.
 */
export const SanitizedMessageBody = memo(function SanitizedMessageBody({
  bodyHtml,
  allowRemoteImages,
}: {
  bodyHtml: string
  allowRemoteImages: boolean
}): ReactElement {
  const html = useMemo(
    () => sanitizeMailHtml(bodyHtml, { allowRemoteImages }),
    [bodyHtml, allowRemoteImages],
  )
  // The sandboxed iframe cannot reliably open `target="_blank"` links, so
  // web links route through the shell to the system browser. mailto: keeps
  // its native behavior.
  const onBodyClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null
    const anchor = target?.closest?.('a[href]')
    const href = anchor?.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) {
      event.preventDefault()
      void openExternalUrl(href)
    }
  }, [])
  return (
    <MessageBody
      onClick={onBodyClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

export function ThreadReader({
  store,
  setStore,
  storeRef,
  providerBacked,
  activeProvider,
  mailProviderRef,
  selectedThreadStarred,
  toggleThreadStarred,
  selectedThread,
  selectedMailbox,
  selectedAccount,
  selectedMessages,
  selectedThreadReplyDrafts,
  activeMessageTab,
  activeReplyDraft,
  selectedThreadDrafting,
  selectedThreadGeneratedDraft,
  selectedThreadQaStatus,
  selectedInvite,
  selectedInviteMessage,
  readerMode,
  setReaderMode,
  setActiveMessageTabId,
  setActiveReplyDraftId,
  focusedMessageId,
  setFocusedMessageId,
  setFocusedDraftId,
  expandedQuotedMessageIds,
  setExpandedQuotedMessageIds,
  collapsedQuotedMessageIds,
  setCollapsedQuotedMessageIds,
  remoteImagesLoadedIds,
  setRemoteImagesLoadedIds,
  attachmentActionErrors,
  setAttachmentActionErrors,
  setAttachmentPreview,
  systemNotice,
  systemNoticeDismissed,
  setSystemNoticeDismissed,
  mailDraftNotice,
  setCommandNotice,
  markSelectedUnread,
  deleteSelectedThread,
  addSelectedThreadToCalendar,
  forwardSelectedThread,
  openDraftInComposeWindow,
  openTaskDrawer,
  threadTaskCount,
  addTask,
  threadPosition,
  threadTotal,
  selectAdjacentThread,
  closeThread,
  topBar,
  focusReply,
  focusReplyAll,
  askThreadAgent,
  summarizeSelectedThread,
  createSelectedThreadDraft,
  archiveSelectedThread,
  unarchiveSelectedThread,
  addFollowUp,
  openCalendarInvite,
  openCalendarInviteForMessage,
}: ThreadReaderProps): React.ReactElement {
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)

  const [detailsOpen, setDetailsOpen] = useState(false)
  // 8b/9a: the pill's popover, its filter (shared with the thread view), and
  // which of the pane's two modes is showing.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<ThreadHistoryFilter>('all')
  const [paneMode, setPaneMode] = useState<'message' | 'thread'>('message')
  // The inline reply composer this pane used to render became the docked
  // compose window (the ONE composer surface); the reader keeps only the
  // launcher strip at its foot and the sent-reply view. See ComposeEditor.
  const [inviteChangeOpen, setInviteChangeOpen] = useState(false)
  const inviteChangeRef = useRef<HTMLDivElement>(null)
  useOutsideClose(inviteChangeRef, inviteChangeOpen, () =>
    setInviteChangeOpen(false),
  )
  useEffect(() => {
    if (!historyOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyOpen])
  // A different thread starts over: message mode, popover shut, filter reset.
  useEffect(() => {
    setPaneMode('message')
    setHistoryOpen(false)
    setHistoryFilter('all')
    setInviteChangeOpen(false)
  }, [selectedThread.id])
  /**
   * The reading-height trigger: has the standalone subject row (the header
   * band) scrolled up past the sticky toolbar? No scroll math — an
   * IntersectionObserver sentinel on the band itself, with the root's top
   * edge pulled in by the toolbar's height since the band slides UNDER the
   * sticky toolbar rather than off the scroller. Everything downstream
   * (the toolbar's crossfaded subject, the slim sender line) is an opacity
   * swap keyed on this one boolean, so nothing re-renders per scroll pixel
   * and no content ever moves.
   */
  const [subjectPassed, setSubjectPassed] = useState(false)
  const readerScrollRef = useRef<HTMLDivElement>(null)
  const readerHeaderRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = readerScrollRef.current
    const band = readerHeaderRef.current
    if (!node || !band) {
      // The composer and the thread timeline unmount the scroller; their
      // toolbar (where rendered) shows the full-chrome layer.
      setSubjectPassed(false)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[entries.length - 1]
        if (entry) setSubjectPassed(!entry.isIntersecting)
      },
      {
        root: node,
        rootMargin: `-${READER_TOOLBAR_HEIGHT}px 0px 0px 0px`,
      },
    )
    observer.observe(band)
    return () => observer.disconnect()
    // paneMode/readerMode matter: the thread view and the sent-reply view
    // unmount ReaderScroll, and coming back mounts a NEW node — without
    // re-running, the observer stays on the detached one and the crossfade
    // goes dead.
  }, [selectedThread.id, readerMode, paneMode])
  // A new message starts at the top, with its own disclosure closed.
  useEffect(() => {
    // Never yank the pane while the user is typing in it. IMAP draft sync
    // replaces provider uids, which can re-key the draft's thread id
    // mid-edit — a "new thread" that is really the same draft — and this
    // effect used to scroll the composer to the top under the caret.
    const active = document.activeElement
    const editingInsideReader =
      active !== null &&
      readerScrollRef.current?.contains(active) === true &&
      (active.tagName === 'TEXTAREA' ||
        active.tagName === 'INPUT' ||
        (active as HTMLElement).isContentEditable)
    if (editingInsideReader) return
    readerScrollRef.current?.scrollTo({ top: 0 })
    setSubjectPassed(false)
    setDetailsOpen(false)
  }, [selectedThread.id, focusedMessageId])
  const threadMenuWrapRef = useRef<HTMLDivElement>(null)
  useOutsideClose(threadMenuWrapRef, threadMenuOpen, () =>
    setThreadMenuOpen(false),
  )
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const fileMenuWrapRef = useRef<HTMLDivElement>(null)
  useOutsideClose(fileMenuWrapRef, fileMenuOpen, () => setFileMenuOpen(false))
  const [newBoxName, setNewBoxName] = useState('')
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)

  const filterSeedSender = (() => {
    const inbound = [...selectedMessages]
      .reverse()
      .find(message => message.from.email !== selectedAccount?.email)
    return (
      inbound?.from.email ??
      selectedThread.participants[0]?.email ??
      ''
    )
  })()

  function fireFilterMutations(mutations: readonly MailFilterMutation[]): void {
    const provider = mailProviderRef.current
    if (!provider || mutations.length === 0) return
    // Serialized: parallel bursts drew Gmail 429s (see PureMailShell).
    void (async () => {
      const failedThreadIds: string[] = []
      for (const mutation of mutations) {
        try {
          if (mutation.kind === 'archive') {
            await provider.archiveThread(mutation.threadId)
          } else if (mutation.kind === 'move') {
            // A box that IS a real account folder (IMAP): true server move.
            await provider.moveThread(mutation.threadId, mutation.mailboxId)
          } else {
            await provider.markThreadRead(mutation.threadId, true)
          }
        } catch (error) {
          console.warn('[puremail] filter mutation failed', error)
          // The run marker was stamped optimistically; a failed server
          // action must void it, or the thread sits in the inbox forever —
          // filtered on paper, unfiled in fact. Cleared markers make the
          // next sync's engine pass retry.
          if (mutation.kind !== 'markRead') {
            failedThreadIds.push(mutation.threadId)
          }
        }
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      if (failedThreadIds.length > 0) {
        setStore(current => clearFilterRunMarkers(current, failedThreadIds))
      }
    })()
  }

  function fileSelectedIntoBox(boxName: string): void {
    const filed = fileThreadToBox(
      storeRef.current,
      selectedThread.accountId,
      selectedThread.id,
      boxName,
    )
    setStore(filed.store)
    fireFilterMutations(filed.mutations)
    setThreadMenuOpen(false)
    setFileMenuOpen(false)
    setNewBoxName('')
    setCommandNotice(`Filed into ${boxName.trim()}.`)
  }

  function handleCreateFilter(input: MailFilterDialogSubmit): void {
    setFilterDialogOpen(false)
    let next = storeRef.current
    // A box that IS a real account folder (IMAP) needs no local label or
    // pinned view — the folder already exists in the sidebar, and the rule
    // moves matches into it on the server.
    const realFolder = accountFolderForBoxName(
      next,
      selectedThread.accountId,
      input.labelName,
    )
    if (!realFolder) {
      next = ensureMailLabel(next, input.labelName).store
      if (input.fileIntoBox) {
        // Box creation in the same gesture: the label's view joins the
        // sidebar; the rule archives + labels so matches land in the box.
        next = saveMailView(
          next,
          input.labelName,
          `label:${quoteQueryValue(input.labelName)}`,
        )
      }
    }
    const added = addMailFilter(next, {
      name: input.name,
      query: input.query,
      actions: {
        labelName: input.labelName,
        ...(input.fileIntoBox ? { skipInbox: true } : {}),
        ...(input.markRead ? { markRead: true } : {}),
      },
    })
    next = added.store
    if (input.applyToExisting) {
      const run = runMailFilters(next, selectedThread.accountId, {
        includeAlreadyRun: true,
        ruleIds: [added.rule.id],
      })
      next = run.store
      fireFilterMutations(run.mutations)
    }
    setStore(next)
    setCommandNotice(
      input.applyToExisting
        ? `Filter “${input.name}” created · applied to ${input.matchCount} thread${
            input.matchCount === 1 ? '' : 's'
          }.`
        : `Filter “${input.name}” created.`,
    )
  }
  const [agentQuestion, setAgentQuestion] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [askStatus, setAskStatus] = useState('')
  const askInputRef = useRef<HTMLInputElement | null>(null)
  const currentThreadId = selectedThread?.id ?? ''
  const activeAskThread = useRef(currentThreadId)
  activeAskThread.current = currentThreadId
  useEffect(() => { setAgentQuestion(''); setAskStatus(''); setAgentBusy(false) }, [currentThreadId])

  // Opening the panel should put the caret where the user is about to type.
  useEffect(() => {
    if (agentPanelOpen) askInputRef.current?.focus()
  }, [agentPanelOpen])

  const runAsk = (rawQuestion: string, kind: 'question' | 'summary' = 'question'): void => {
    const question = rawQuestion.trim()
    if (!question || !currentThreadId || agentBusy) return
    setAgentBusy(true)
    setAskStatus('Opening the drawer…')
    const threadId = currentThreadId
    const request = kind === 'summary' ? summarizeSelectedThread() : askThreadAgent(question)
    void request.then(() => {
      if (activeAskThread.current === threadId) setAskStatus('Continue in the drawer for the answer.')
    }).catch(error => {
      if (activeAskThread.current === threadId) setAskStatus(error instanceof Error ? error.message : 'Could not reach the drawer.')
    }).finally(() => { if (activeAskThread.current === threadId) setAgentBusy(false) })
  }

  const submitAskInput = (): void => {
    runAsk(agentQuestion)
    setAgentQuestion('')
  }

  /**
   * Suggestions fill the same input and take the same path rather than being
   * parallel buttons with parallel handlers — one door, still discoverable.
   */
  const askSuggestions: Array<{ label: string; run: () => void }> = [
    {
      label: 'Summarize this thread',
      run: () => runAsk('Summarize this thread', 'summary'),
    },
    {
      label: 'What are they asking me to do?',
      run: () => runAsk('What are they asking me to do?'),
    },
  ]

  const quotedHistoryOpenByDefault =
    store.settings.quotedHistoryOpenByDefault ?? false

  const isQuotedHistoryExpanded = (messageId: string): boolean =>
    quotedHistoryOpenByDefault
      ? !collapsedQuotedMessageIds.includes(messageId)
      : expandedQuotedMessageIds.includes(messageId)

  const setQuotedHistoryOpen = (messageId: string, open: boolean): void => {
    setExpandedQuotedMessageIds(current =>
      open
        ? current.includes(messageId)
          ? current
          : [...current, messageId]
        : current.filter(id => id !== messageId),
    )
    setCollapsedQuotedMessageIds(current =>
      open
        ? current.filter(id => id !== messageId)
        : current.includes(messageId)
        ? current
        : [...current, messageId],
    )
  }

  const retrySelectedThreadSync = (): void => {
    if (!selectedThread) return
    setStore(current =>
      recoverMailThreadSync(current, selectedThread.id, 'retry'),
    )
    setCommandNotice('Thread sync retry queued.')
  }

  const resolveSelectedThreadSync = (): void => {
    if (!selectedThread) return
    setStore(current =>
      recoverMailThreadSync(current, selectedThread.id, 'resolve'),
    )
    setCommandNotice('Thread sync warning marked resolved.')
  }

  const cacheMessageAttachment = (
    messageId: string,
    attachment: Attachment,
  ): void => {
    setStore(current => ({
      ...current,
      messages: current.messages.map(message =>
        message.id === messageId
          ? {
              ...message,
              attachments: message.attachments.map(item =>
                item.id === attachment.id ? attachment : item,
              ),
            }
          : message,
      ),
    }))
  }

  const recordAttachmentError = (
    messageId: string,
    attachmentId: string,
    error: string | null,
  ): void => {
    setAttachmentActionErrors(current => {
      const key = `${messageId}:${attachmentId}`
      if (error === null) {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      return { ...current, [key]: error }
    })
  }

  /**
   * A synced message's .ics arrives as a remote attachment with no local
   * content, so the invite card had nothing to parse and the machine notice
   * fell through as body prose. The file is a few hundred bytes — fetch it
   * quietly when the message opens. One attempt per attachment: a failure
   * leaves the plain message, not a retry loop.
   */
  const inviteFetchAttemptsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const message = activeMessageTab
    if (!message || !providerBacked?.getAttachmentContent) return
    const pending = message.attachments.filter(
      attachment =>
        isCalendarAttachment(attachment) &&
        !attachment.content &&
        attachment.remote &&
        !inviteFetchAttemptsRef.current.has(attachment.id),
    )
    if (pending.length === 0) return
    let cancelled = false
    for (const attachment of pending) {
      inviteFetchAttemptsRef.current.add(attachment.id)
      void providerBacked
        .getAttachmentContent(message, attachment)
        .then(resolved => {
          if (!cancelled) cacheMessageAttachment(message.id, resolved)
        })
        .catch(() => {
          // Silence is deliberate: the fallback is the message as it was.
        })
    }
    return () => {
      cancelled = true
    }
  }, [activeMessageTab, providerBacked])

  const resolveAttachmentContent = async (
    message: MailMessage,
    attachment: Attachment,
  ): Promise<Attachment | null> => {
    if (attachment.content) return attachment
    if (!providerBacked?.getAttachmentContent) {
      recordAttachmentError(
        message.id,
        attachment.id,
        'No local content available.',
      )
      setCommandNotice(`${attachment.name} has no local preview content.`)
      return null
    }
    try {
      setCommandNotice(`Downloading ${attachment.name}...`)
      const resolved = await providerBacked.getAttachmentContent(
        message,
        attachment,
      )
      cacheMessageAttachment(message.id, resolved)
      recordAttachmentError(message.id, attachment.id, null)
      return resolved
    } catch (error) {
      recordAttachmentError(message.id, attachment.id, 'Download failed.')
      setCommandNotice(
        error instanceof Error
          ? error.message
          : `Could not download ${attachment.name}.`,
      )
      return null
    }
  }

  // Standalone dev mode has no native save dialog — fall back to a browser
  // download so the action still produces a file.
  const downloadAttachmentViaBrowser = (attachment: Attachment): void => {
    if (!attachment.content || typeof document === 'undefined') return
    const link = document.createElement('a')
    link.href = attachment.content.startsWith('data:')
      ? attachment.content
      : `data:${
          attachment.mimeType || 'text/plain'
        };charset=utf-8,${encodeURIComponent(attachment.content)}`
    link.download = safeAttachmentFileName(attachment.name)
    document.body.append(link)
    link.click()
    link.remove()
  }

  // Where each attachment (or a message's save-all folder) last landed on
  // disk, so a completed save can grow a "Reveal" affordance. Session-local
  // by design: a stale path from a previous run would reveal nothing.
  const [savedAttachmentPaths, setSavedAttachmentPaths] = useState<
    Record<string, string>
  >({})
  const recordSavedPath = (key: string, path: string): void => {
    setSavedAttachmentPaths(current => ({ ...current, [key]: path }))
  }

  const saveAttachmentToDisk = async (
    message: MailMessage,
    attachment: Attachment,
  ): Promise<void> => {
    const resolved = await resolveAttachmentContent(message, attachment)
    if (!resolved?.content) return
    if (isStandaloneDevMode()) {
      downloadAttachmentViaBrowser(resolved)
      setCommandNotice(`Downloaded ${resolved.name}.`)
      return
    }
    const base64 = attachmentContentToBase64(resolved)
    if (base64 === null) {
      recordAttachmentError(message.id, attachment.id, 'Could not encode file.')
      setCommandNotice(`Could not prepare ${resolved.name} for saving.`)
      return
    }
    try {
      const path = await dialogSaveFile({
        defaultName: safeAttachmentFileName(resolved.name),
      })
      if (!path) return
      await fsWriteBinary(path, base64)
      recordAttachmentError(message.id, attachment.id, null)
      recordSavedPath(`${message.id}:${attachment.id}`, path)
      setCommandNotice(`Saved ${resolved.name} to ${path}.`)
    } catch (error) {
      recordAttachmentError(message.id, attachment.id, 'Save failed.')
      setCommandNotice(
        error instanceof Error
          ? error.message
          : `Could not save ${resolved.name}.`,
      )
    }
  }

  const saveAllAttachments = async (message: MailMessage): Promise<void> => {
    if (message.attachments.length === 0) return
    if (isStandaloneDevMode()) {
      for (const attachment of message.attachments) {
        const resolved = await resolveAttachmentContent(message, attachment)
        if (resolved?.content) downloadAttachmentViaBrowser(resolved)
      }
      setCommandNotice('Attachments downloaded.')
      return
    }
    let folder: string | null = null
    try {
      folder = await dialogSaveFolder()
    } catch (error) {
      setCommandNotice(
        error instanceof Error
          ? error.message
          : 'Could not open the folder picker.',
      )
      return
    }
    if (!folder) return
    // The writer the saveAttachments agent tool uses: safe names that are
    // unique in the folder, so nothing already there is overwritten.
    const { saved, failed } = await writeAttachmentsToFolder(
      message.attachments,
      folder,
      {
        resolve: attachment => resolveAttachmentContent(message, attachment),
        writeBinary: fsWriteBinary,
        existingNames: () => fsListNames(folder),
      },
    )
    for (const item of saved) recordAttachmentError(message.id, item.id, null)
    for (const item of failed) {
      // The user sees "Save failed." inline; the console keeps the cause.
      console.warn('[puremail] attachment save failed:', item.name, item.reason)
      recordAttachmentError(message.id, item.id, 'Save failed.')
    }
    if (saved.length > 0) recordSavedPath(`${message.id}:all`, folder)
    setCommandNotice(
      saved.length === message.attachments.length
        ? `Saved ${saved.length} attachment${saved.length === 1 ? '' : 's'} to ${folder}.`
        : `Saved ${saved.length} of ${message.attachments.length} attachments to ${folder}.`,
    )
  }

  /**
   * The whole thread as a PDF, where the save dialog says. The same page and
   * print path as the saveMessageAsPdf agent tool.
   */
  const saveThreadAsPdf = async (): Promise<void> => {
    const messages = selectedMessages.filter(message => !message.isDraft)
    if (messages.length === 0) return
    let outputPath: string | null = null
    try {
      outputPath = await dialogSaveFile({ defaultName: mailPdfFileName(selectedThread.subject) })
    } catch (error) {
      setCommandNotice(error instanceof Error ? error.message : 'Could not open the save dialog.')
      return
    }
    if (!outputPath) return
    setCommandNotice('Saving the email as a PDF…')
    try {
      const { path } = await saveMailAsPdf(
        { subject: selectedThread.subject, messages },
        { outputPath },
        mailPdfDeps,
      )
      recordSavedPath(`${selectedThread.id}:pdf`, path)
      setCommandNotice(`Saved the email as a PDF: ${path}.`)
      void recordOperation({
        lane: 'user',
        kind: 'mail.export.pdf',
        appSlug: 'mail',
        summary: `Saved "${selectedThread.subject}" as a PDF: ${path}.`,
      })
    } catch (error) {
      setCommandNotice(
        `Could not save the PDF: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const previewAttachment = async (
    message: MailMessage,
    attachment: Attachment,
  ): Promise<void> => {
    const kind = attachmentPreviewKind(attachment)
    if (!kind) {
      setCommandNotice(
        `No inline preview for ${attachment.name} — save it to disk to view.`,
      )
      return
    }
    // The app iframe is sandboxed, so Chromium's PDF plugin never runs in
    // the inline <object> preview — for PDFs the detached viewer window IS
    // the preview. Standalone dev mode (no viewer bridge) keeps the overlay.
    if (kind === 'pdf' && !isStandaloneDevMode()) {
      await openAttachmentInViewer(message, attachment)
      return
    }
    const resolved = await resolveAttachmentContent(message, attachment)
    if (!resolved?.content) return
    if (kind === 'image') {
      const imageUrl = attachmentImageDataUrl(resolved)
      if (!imageUrl) {
        setCommandNotice(`Could not decode ${resolved.name} for preview.`)
        return
      }
      setAttachmentPreview({ name: resolved.name, kind, imageUrl })
      return
    }
    if (kind === 'pdf') {
      const pdfUrl = attachmentPdfDataUrl(resolved)
      if (!pdfUrl) {
        setCommandNotice(`Could not decode ${resolved.name} for preview.`)
        return
      }
      setAttachmentPreview({ name: resolved.name, kind, pdfUrl })
      return
    }
    const text = attachmentTextContent(resolved)
    if (text === null) {
      setCommandNotice(`Could not decode ${resolved.name} for preview.`)
      return
    }
    setAttachmentPreview({ name: resolved.name, kind, text })
  }

  // Viewer cache plumbing: the cache folder lives beside the app's JSON
  // stores; its location is learned once (by probing where a store file
  // WOULD live) and the created-folder path memoized for the session, as is
  // the set of cache files already written so repeat opens skip the rewrite.
  const attachmentCacheDirRef = useRef<string | null>(null)
  const viewerWrittenPathsRef = useRef(new Set<string>())
  const ensureAttachmentCacheDir = async (): Promise<string | null> => {
    if (attachmentCacheDirRef.current) return attachmentCacheDirRef.current
    try {
      const probe = await readPlatformStorageJson({
        appSlug: 'mail',
        fileName: ATTACHMENT_VIEWER_PROBE_FILE,
      })
      const storesDir = probe.path ? parentDirectoryPath(probe.path) : null
      if (!storesDir) return null
      const dir = await fsCreateFolder(storesDir, ATTACHMENT_VIEWER_CACHE_DIR)
      attachmentCacheDirRef.current = dir
      return dir
    } catch (error) {
      console.warn('[puremail] viewer cache folder unavailable:', error)
      return null
    }
  }

  /**
   * Primary action for PDF attachments: bytes to the cache folder, then the
   * shell's detached viewer window — a real window beside the suite, never a
   * tab over the mail. Standalone dev mode has no viewer bridge, so it keeps
   * the inline preview overlay.
   */
  const openAttachmentInViewer = async (
    message: MailMessage,
    attachment: Attachment,
  ): Promise<void> => {
    if (isStandaloneDevMode()) {
      await previewAttachment(message, attachment)
      return
    }
    const result = await openAttachmentInViewerWindow(message.id, attachment, {
      resolve: item => resolveAttachmentContent(message, item),
      cacheDir: ensureAttachmentCacheDir,
      writeBinary: fsWriteBinary,
      openViewer: openFileViewerWindow,
      written: viewerWrittenPathsRef.current,
    })
    if (result.status === 'opened') {
      recordAttachmentError(message.id, attachment.id, null)
      setCommandNotice(`Opened ${attachment.name} in its own window.`)
      void recordOperation({
        lane: 'user',
        kind: 'mail.attachment.view',
        appSlug: 'mail',
        summary: `Opened attachment ${attachment.name} in the PDF viewer window`,
        refs: { path: result.path, messageId: message.id },
      })
      return
    }
    if (result.status === 'error') {
      // Apps roll out ahead of shells here, so a shell without the viewer
      // is a supported state — point at the action that works instead of
      // leaving a bare failure.
      if (isViewerUnsupportedError(result.reason)) {
        recordAttachmentError(message.id, attachment.id, 'Viewer unavailable.')
        setCommandNotice(
          `This PureDesktop build cannot open viewer windows yet — use Save to view ${attachment.name}, and restart PureDesktop once the shell is updated.`,
        )
        return
      }
      recordAttachmentError(message.id, attachment.id, 'Open failed.')
      setCommandNotice(`Could not open ${attachment.name}: ${result.reason}`)
    }
  }

  const addAttachmentInviteToCalendar = async (
    message: MailMessage,
    attachment: Attachment,
  ): Promise<void> => {
    if (!isCalendarAttachment(attachment)) return
    const resolved = await resolveAttachmentContent(message, attachment)
    if (!resolved?.content) {
      setCommandNotice(
        'This invite file has no local content. Nothing was added.',
      )
      return
    }
    await openCalendarInviteForMessage({
      ...message,
      attachments: [resolved],
    })
  }

  /**
   * The thread's identity line: who it is from, and who it came to. Taken
   * from the newest message rather than the thread's participant list, which
   * ordered by first appearance and so named the wrong person on any thread
   * that had been replied to.
   */
  const headerMessage =
    activeMessageTab ??
    selectedMessages.find(message => message.id === focusedMessageId) ??
    selectedMessages[selectedMessages.length - 1] ??
    null
  const headerSenderName =
    headerMessage?.from.name ||
    headerMessage?.from.email ||
    selectedThread.participants[0]?.name ||
    'Unknown sender'
  const headerAvatar = senderAvatar(headerSenderName)
  /**
   * One word for what this message is, replacing the Sent / Received button
   * pair. Both facts it carried live here now: the state on this line, the
   * received timestamp inside `details`.
   */
  const headerDirection = headerMessage
    ? messageDirectionForAccount(headerMessage, selectedAccount?.email)
    : 'incoming'
  const headerScheduled = (store.scheduledSends ?? []).some(
    entry =>
      entry.status === 'scheduled' && entry.threadId === selectedThread.id,
  )
  const readerStateLabel = headerScheduled
    ? 'Scheduled'
    : headerDirection === 'draft'
      ? 'Draft'
      : headerDirection === 'outgoing'
        ? 'Sent'
        : 'Received'
  /**
   * Only a message actually fetched from the provider may claim to have come
   * via it; a local sent copy must not. Same rule the message card applies.
   */
  const readerViaSource = headerMessage?.id.startsWith('gmail_msg_')
    ? 'Gmail'
    : headerMessage?.id.startsWith('imap_msg_')
      ? providerName('imap')
      : null
  /** One timeline for the pill, the popover, and the thread view. */
  const historyEntries = useMemo(
    () =>
      buildThreadHistoryEntries(
        selectedMessages,
        selectedThreadReplyDrafts,
        selectedAccount?.email,
        selectedAccount?.name,
      ),
    [selectedMessages, selectedThreadReplyDrafts, selectedAccount],
  )
  const historyCurrentId =
    readerMode === 'reply'
      ? activeReplyDraft?.id ?? null
      : activeMessageTab?.id ?? null

  const openHistoryEntry = (entry: ThreadHistoryEntry): void => {
    setHistoryOpen(false)
    setPaneMode('message')
    if (entry.kind === 'message') {
      setActiveMessageTabId(entry.id)
      setFocusedMessageId(entry.id)
      setFocusedDraftId(null)
      setReaderMode('email')
      return
    }
    const draft = selectedThreadReplyDrafts.find(item => item.id === entry.id)
    if (draft && !draft.sentAt) {
      // An unsent draft is edited in the ONE composer surface — the docked
      // compose window; the reader only ever shows sent replies.
      openDraftInComposeWindow(draft)
      return
    }
    setActiveReplyDraftId(entry.id)
    setFocusedDraftId(null)
    setReaderMode('reply')
  }

  const historyBodyText = (entry: ThreadHistoryEntry): string => {
    if (entry.kind === 'draft') {
      return (
        selectedThreadReplyDrafts.find(item => item.id === entry.id)?.body ??
        ''
      )
    }
    const message = selectedMessages.find(item => item.id === entry.id)
    return message ? readerMailBody(message).visibleText || message.body : ''
  }

  const historyRecipients = (entry: ThreadHistoryEntry): string => {
    const contacts =
      entry.kind === 'draft'
        ? selectedThreadReplyDrafts.find(item => item.id === entry.id)?.to
        : selectedMessages.find(item => item.id === entry.id)?.to
    return (contacts ?? [])
      .map(person => person.name || person.email)
      .join(', ')
  }

  /**
   * 8a: the invite's response as state, never as body prose. The attendee
   * matching the account carries it; on a REPLY the first attendee is the
   * responder even when the account is not listed.
   */
  const accountEmailLc = selectedAccount?.email.trim().toLowerCase()
  const inviteAttendee = selectedInvite
    ? selectedInvite.attendees.find(
        person => person.email.trim().toLowerCase() === accountEmailLc,
      ) ??
      (selectedInvite.method === 'REPLY'
        ? selectedInvite.attendees[0]
        : undefined)
    : undefined
  const inviteResponse =
    inviteAttendee && inviteAttendee.response !== 'needsAction'
      ? inviteAttendee.response
      : null
  const inviteTone: InviteStatusTone =
    selectedInvite?.status === 'cancelled' || inviteResponse === 'declined'
      ? 'declined'
      : inviteResponse === 'tentative'
        ? 'tentative'
        : inviteResponse === 'accepted'
          ? 'confirmed'
          : 'neutral'
  const invitePillWord =
    selectedInvite?.status === 'cancelled'
      ? 'cancelled'
      : inviteResponse === 'declined'
        ? 'declined'
        : inviteResponse === 'tentative'
          ? 'tentative'
          : inviteResponse === 'accepted'
            ? 'confirmed'
            : 'awaiting response'
  const inviteResponseVerb =
    inviteResponse === 'accepted'
      ? 'accepted'
      : inviteResponse === 'declined'
        ? 'declined'
        : 'replied maybe'
  const inviteMessageOutgoing = selectedInviteMessage
    ? messageDirectionForAccount(
        selectedInviteMessage,
        selectedAccount?.email,
      ) === 'outgoing'
    : false
  const inviteResponder = inviteMessageOutgoing
    ? 'You'
    : inviteAttendee?.name || 'They'
  const inviteWhen = selectedInvite
    ? (() => {
        const starts = new Date(selectedInvite.startsAt)
        const ends = new Date(selectedInvite.endsAt)
        const sameDay = starts.toDateString() === ends.toDateString()
        const day = starts.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
        const time = (date: Date): string =>
          date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })
        return sameDay
          ? `${day} · ${time(starts)} – ${time(ends)}`
          : `${formatDate(selectedInvite.startsAt)} – ${formatDate(
              selectedInvite.endsAt,
            )}`
      })()
    : ''
  /** True when this message's body is the machine notice the card absorbs. */
  const inviteBodyIsNotice = Boolean(
    selectedInvite &&
      selectedInviteMessage &&
      isInviteNoticeBody(selectedInviteMessage.body),
  )
  /**
   * What earns a place on the state line: the message's state, its time and
   * source, priority, its tasks, and one thread-status word. Labels, sync
   * state and starred are real facts but quiet ones — they demote to
   * `details`, counted on the line, instead of crowding it. Eight chips deep
   * the line was wrapping into a wall.
   */
  const demotedChips: Array<{ label: string; tone: 'label' }> = [
    ...displayThreadLabels(store, selectedThread, store.drafts).map(label => ({
      label,
      tone: 'label' as const,
    })),
    ...(threadSyncLabel(selectedThread)
      ? [{ label: threadSyncLabel(selectedThread) as string, tone: 'label' as const }]
      : []),
    ...(selectedThreadStarred
      ? [{ label: 'starred', tone: 'label' as const }]
      : []),
  ]
  const inviteSourceName = selectedInvite?.rawSource.startsWith('inline:')
    ? 'meeting details in this email'
    : selectedInviteMessage?.attachments[0]?.name ?? 'this email'
  /** The footer band belongs to the message on screen. */
  const attachmentMessage = activeMessageTab
  // Three rows by default, all of them on demand — the band is an edge, not
  // a file manager, but every file must stay reachable.
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false)
  useEffect(() => {
    setAttachmentsExpanded(false)
  }, [attachmentMessage?.id])
  const readerAttachments = attachmentsExpanded
    ? attachmentMessage?.attachments ?? []
    : (attachmentMessage?.attachments ?? []).slice(0, 3)
  const readerAttachmentsCanSaveAll = Boolean(
    attachmentMessage &&
      attachmentMessage.attachments.length > 1 &&
      (attachmentMessage.attachments.some(item => item.content) ||
        providerBacked?.getAttachmentContent),
  )
  const headerRecipients =
    headerMessage?.to
      .map(person => person.name || person.email)
      .filter(Boolean)
      .join(', ') ??
    selectedAccount?.email ??
    ''

  /** The thread's first label — the one chip beside the condensed subject. */
  const condensedLabel =
    displayThreadLabels(store, selectedThread, store.drafts)[0] ?? null
  /** One truth for both Reply buttons (expanded row and condensed row). */
  const replyPrimaryLabel =
    activeReplyDraft && !activeReplyDraft.sentAt ? 'Continue draft' : 'Reply'
  /** The one unsent draft the reader-foot launcher strip previews. */
  const launcherDraft =
    selectedThreadReplyDrafts.find(draft => !draft.sentAt) ?? null
  /** The message the reading-height slim line describes, and its place. */
  const stickyMessage = readerMode === 'email' ? activeMessageTab : null
  const stickyMessageIndex = stickyMessage
    ? selectedMessages.findIndex(item => item.id === stickyMessage.id) + 1
    : 0
  /**
   * The toolbar shows the subject (and the slim line shows the sender) only
   * while actually reading a message whose own header has scrolled away.
   */
  const subjectInToolbar = subjectPassed && paneMode === 'message'

  /* Region 3, part 1. One 38px row of actions, sticky at the top of the
     reader's scroll flow from the moment it loads. Its flexible middle
     crossfades: the reply cluster at load, the inline subject (plus label
     chip, Reply and Forward) once the standalone subject row has scrolled
     up past it. The crossfade is opacity only — the back button and the
     triage cluster never move. */
  const readerToolbar = (
      <ReaderToolbar role="toolbar" aria-label="Mail actions">
        {/* The way back to the index: the reader REPLACED the list, so the
            arrow (and Escape) is how the list returns. */}
        <ReaderBackButton
          type="button"
          onClick={closeThread}
          aria-label="Back to the thread list (Esc)"
        >
          <ArrowLeft aria-hidden="true" />
        </ReaderBackButton>
        <ReaderToolbarSwap>
          <ReaderToolbarSwapLayer $shown={!subjectInToolbar}>
            <ToolbarDivider aria-hidden="true" />
            {/* Says what pressing it does. A thread can hold an unsent
                draft — yours, an agent's, or one written in the account
                elsewhere — and labelling that "Reply" gave the user no way
                to know a draft was waiting, nor that this is how to get
                back into it. */}
            <ReaderToolbarPrimary type="button" onClick={focusReply}>
              {replyPrimaryLabel}
            </ReaderToolbarPrimary>
            <ReaderToolbarButton type="button" onClick={focusReplyAll}>
              <ReplyAll aria-hidden="true" />
              <ReaderToolbarLabel>all</ReaderToolbarLabel>
            </ReaderToolbarButton>
            <ReaderToolbarButton type="button" onClick={forwardSelectedThread}>
              <Forward aria-hidden="true" />
              <ReaderToolbarLabel>fwd</ReaderToolbarLabel>
            </ReaderToolbarButton>
            <ReaderToolbarButton
              type="button"
              aria-expanded={agentPanelOpen}
              onClick={() => setAgentPanelOpen(open => !open)}
            >
              <Sparkles aria-hidden="true" />
              <ReaderToolbarLabel>ask</ReaderToolbarLabel>
            </ReaderToolbarButton>
          </ReaderToolbarSwapLayer>
          <ReaderToolbarSwapLayer $shown={subjectInToolbar}>
            {/* The subject's standalone row is off screen — this is now its
                only statement, stated once. Reply here takes the same
                reply-open path R takes; Forward is the existing action. */}
            <ReaderCondensedSubject title={selectedThread.subject}>
              {selectedThread.subject}
            </ReaderCondensedSubject>
            {condensedLabel && (
              <MailStateChip $tone="label">{condensedLabel}</MailStateChip>
            )}
            <ReaderToolbarPrimary type="button" onClick={focusReply}>
              <ReplyIcon aria-hidden="true" />
              {replyPrimaryLabel}
            </ReaderToolbarPrimary>
            <ReaderToolbarButton
              type="button"
              aria-label="Forward"
              onClick={forwardSelectedThread}
            >
              <Forward aria-hidden="true" />
            </ReaderToolbarButton>
          </ReaderToolbarSwapLayer>
        </ReaderToolbarSwap>
        {selectedThread.status === 'archived' ||
        selectedMailbox?.role === 'archive' ? (
          <ReaderToolbarButton type="button" onClick={unarchiveSelectedThread}>
            <ArchiveRestore aria-hidden="true" />
            <ReaderToolbarLabel>unarchive</ReaderToolbarLabel>
          </ReaderToolbarButton>
        ) : (
          <ReaderToolbarButton type="button" onClick={archiveSelectedThread}>
            <Archive aria-hidden="true" />
            <ReaderToolbarLabel>archive</ReaderToolbarLabel>
          </ReaderToolbarButton>
        )}
        <ReaderToolbarButton
          type="button"
          aria-label="Move to Trash"
          onClick={deleteSelectedThread}
        >
          <Trash2 aria-hidden="true" />
          <ReaderToolbarLabel>trash</ReaderToolbarLabel>
        </ReaderToolbarButton>
        <ReaderToolbarButton
          type="button"
          aria-label="Mark unread"
          onClick={markSelectedUnread}
        >
          <MailOpen aria-hidden="true" />
          <ReaderToolbarLabel>unread</ReaderToolbarLabel>
        </ReaderToolbarButton>
        {/* Filing is a triage verb, not a rarity: it stays on the top line
            rather than folding into More. */}
        <BulkMenuWrap ref={fileMenuWrapRef}>
          <ReaderToolbarButton
            type="button"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
            onClick={() => setFileMenuOpen(open => !open)}
          >
            <FolderInput aria-hidden="true" />
            <ReaderToolbarLabel>file</ReaderToolbarLabel>
          </ReaderToolbarButton>
          {fileMenuOpen && (
            <ThreadActionsMenu role="menu" aria-label="File into a box">
              {store.mailboxes
                .filter(
                  mailbox =>
                    mailbox.accountId === selectedThread.accountId &&
                    mailbox.role === 'custom',
                )
                .map(mailbox => (
                  <BulkMenuItem
                    key={mailbox.id}
                    role="menuitem"
                    onClick={() => fileSelectedIntoBox(mailbox.name)}
                  >
                    {mailbox.name}
                  </BulkMenuItem>
                ))}
              <BulkMenuItem as="div" role="none" style={{ cursor: 'default' }}>
                <input
                  value={newBoxName}
                  aria-label="File into a new box"
                  placeholder="New box…"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 0,
                    outline: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                  }}
                  onClick={event => event.stopPropagation()}
                  onChange={event => setNewBoxName(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    if (newBoxName.trim()) fileSelectedIntoBox(newBoxName)
                  }}
                />
              </BulkMenuItem>
            </ThreadActionsMenu>
          )}
        </BulkMenuWrap>
        <ReaderToolbarButton type="button" onClick={addFollowUp}>
          <Clock aria-hidden="true" />
          <ReaderToolbarLabel>follow up</ReaderToolbarLabel>
        </ReaderToolbarButton>
        {/* Files a task against this thread; the drawer opens and scrolls it
            into view rather than leaving you to go looking for it. */}
        <ReaderToolbarButton type="button" onClick={addTask}>
          <SquareCheck aria-hidden="true" />
          <ReaderToolbarLabel>task</ReaderToolbarLabel>
        </ReaderToolbarButton>
        {/*
          A small anchored menu, not a full-height sheet with a backdrop.
          Dimming the whole app to offer "Mark unread" was never
          proportionate to what is behind it.
        */}
        <BulkMenuWrap ref={threadMenuWrapRef}>
          <ReaderToolbarButton
            type="button"
            aria-haspopup="menu"
            aria-expanded={threadMenuOpen}
            aria-label="More thread actions"
            onClick={() => setThreadMenuOpen(open => !open)}
          >
            <MoreHorizontal aria-hidden="true" />
          </ReaderToolbarButton>
          {threadMenuOpen && (
            <ThreadActionsMenu role="menu" aria-label="More thread actions">
              <BulkMenuItem
                role="menuitem"
                onClick={() => {
                  markSelectedUnread()
                  setThreadMenuOpen(false)
                }}
              >
                Mark unread
              </BulkMenuItem>
              <BulkMenuItem
                role="menuitem"
                onClick={() => {
                  toggleThreadStarred(selectedThread.id)
                  setThreadMenuOpen(false)
                }}
              >
                {selectedThreadStarred ? 'Unstar' : 'Star'}
              </BulkMenuItem>
              <BulkMenuItem
                role="menuitem"
                onClick={() => {
                  void (selectedInvite
                    ? openCalendarInvite()
                    : addSelectedThreadToCalendar())
                  setThreadMenuOpen(false)
                }}
              >
                {selectedInvite ? 'Calendar invite' : 'Add to calendar'}
              </BulkMenuItem>
              <BulkMenuItem
                role="menuitem"
                onClick={() => {
                  setFilterDialogOpen(true)
                  setThreadMenuOpen(false)
                }}
              >
                Filter like this…
              </BulkMenuItem>
              {!isStandaloneDevMode() && (
                <BulkMenuItem
                  role="menuitem"
                  onClick={() => {
                    setThreadMenuOpen(false)
                    void saveThreadAsPdf()
                  }}
                >
                  Save as PDF…
                </BulkMenuItem>
              )}
              <BulkMenuItem
                role="menuitem"
                onClick={() => {
                  deleteSelectedThread()
                  setThreadMenuOpen(false)
                }}
              >
                Delete
              </BulkMenuItem>
            </ThreadActionsMenu>
          )}
        </BulkMenuWrap>
        <ReaderPosition aria-label={`Thread ${threadPosition} of ${threadTotal}`}>
          {threadPosition} of {threadTotal}
        </ReaderPosition>
        <ReaderToolbarButton
          type="button"
          aria-label="Newer thread (k)"
          disabled={threadPosition <= 1}
          onClick={() => selectAdjacentThread(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </ReaderToolbarButton>
        <ReaderToolbarButton
          type="button"
          aria-label="Older thread (j)"
          disabled={threadPosition >= threadTotal}
          onClick={() => selectAdjacentThread(1)}
        >
          <ChevronRight aria-hidden="true" />
        </ReaderToolbarButton>
      </ReaderToolbar>
  )

  return (
    <ReaderPane>
      {systemNotice && !systemNoticeDismissed && (
        <MailSystemBanner role="status">
          <span aria-hidden="true">●</span>
          <span>
            <strong>Calendar handoff is off.</strong> {systemNotice}{' '}
            Mail works normally; calendar follow-ups are paused until
            permissions reload.
          </span>
          <div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setSystemNoticeDismissed(true)}
            >
              Grant & restart
            </Button>
            <Button
              size="sm"
              onClick={() => setSystemNoticeDismissed(true)}
            >
              Later
            </Button>
          </div>
        </MailSystemBanner>
      )}
      {mailDraftNotice && !systemNotice && (
        <MailSystemBanner role="status">
          <span aria-hidden="true">●</span>
          <span>{mailDraftNotice}</span>
        </MailSystemBanner>
      )}
      {paneMode === 'thread' ? (
        /* 9a. The thread as a timeline; the top bar and toolbar stay put —
           this view scrolls on its own. */
        <>
          {topBar}
          {readerToolbar}
          <ThreadTimelineView
          subject={selectedThread.subject}
          participants={selectedThread.participants}
          entries={historyEntries}
          currentId={historyCurrentId}
          filter={historyFilter}
          setFilter={setHistoryFilter}
          bodyTextFor={historyBodyText}
          recipientsFor={historyRecipients}
          onBack={() => setPaneMode('message')}
          onReplyLatest={() => {
            setPaneMode('message')
            focusReply()
          }}
          />
        </>
      ) : (
        <>
      {/* The reader's one scroll container. The search band, the sticky
          toolbar, the header band and the slim sender line all live INSIDE
          it: disappearing chrome scrolls off like content, the toolbar
          sticks from load, and nothing animates its height. */}
      <ReaderScroll ref={readerScrollRef} data-reader-scroll="">
      {topBar}
      {readerToolbar}
      {/* Band 1. State, subject, sender — each fact once. The pane used to
          state the sender three times and the timestamp four. It scrolls
          away naturally; the toolbar's subject fades in as it passes. */}
      <ReaderHeaderBand ref={readerHeaderRef}>
        <ReaderBandInner>
          <ReaderStateLine>
            <ReaderStateChip>{readerStateLabel}</ReaderStateChip>
            <span>
              {formatDate(headerMessage?.receivedAt ?? selectedThread.lastMessageAt)}
            </span>
            {readerViaSource && <span>· via {readerViaSource}</span>}
            {selectedThread.priority === 'high' && (
              <MailStateChip
                $tone="priority"
                title="Marked important by the mail provider."
              >
                high priority
              </MailStateChip>
            )}
            {threadTaskCount > 0 && (
              <ReaderTaskChip
                type="button"
                onClick={openTaskDrawer}
                title="Show these in the task drawer"
              >
                {threadTaskCount} task{threadTaskCount === 1 ? '' : 's'}
              </ReaderTaskChip>
            )}
            {threadStatusLabel(store, selectedThread, store.drafts) && (
              <MailStateChip
                $tone={threadStatusTone(store, selectedThread, store.drafts)}
              >
                {threadStatusLabel(store, selectedThread, store.drafts)}
              </MailStateChip>
            )}
            <AiTriageControl store={store} setStore={setStore} thread={selectedThread} />
            {demotedChips.length > 0 && (
              <ReaderTaskChip
                type="button"
                aria-expanded={detailsOpen}
                title={demotedChips.map(chip => chip.label).join(' · ')}
                onClick={() => setDetailsOpen(open => !open)}
              >
                +{demotedChips.length} more
              </ReaderTaskChip>
            )}
            {/* The thread's whole presence here. No pill on a one-message
                thread — there is no history to show. */}
            {historyEntries.length > 1 && (
              <ThreadHistoryPill
                total={historyEntries.length}
                open={historyOpen}
                onToggle={() => setHistoryOpen(open => !open)}
              />
            )}
          </ReaderStateLine>
          <Title>{selectedThread.subject}</Title>
          <ReaderSenderRow>
            <ReaderSenderAvatar
              aria-hidden="true"
              style={{ background: headerAvatar.bg, color: headerAvatar.fg }}
            >
              {headerAvatar.initial}
            </ReaderSenderAvatar>
            <ReaderSenderName>{headerSenderName}</ReaderSenderName>
            {headerRecipients && (
              <ReaderSenderTo title={headerRecipients}>
                to {headerRecipients}
              </ReaderSenderTo>
            )}
            <ReaderDetailsButton
              type="button"
              aria-expanded={detailsOpen}
              aria-controls="puremail-reader-details"
              onClick={() => setDetailsOpen(open => !open)}
            >
              details {detailsOpen ? '⌃' : '⌄'}
            </ReaderDetailsButton>
          </ReaderSenderRow>
          {/* Everything the header no longer states inline. */}
          {detailsOpen && (
            <ReaderDetailsPanel id="puremail-reader-details">
              {headerMessage && (
                <>
                  <dt>from</dt>
                  <dd>
                    {headerMessage.from.name}
                    {headerMessage.from.email
                      ? ` <${headerMessage.from.email}>`
                      : ''}
                  </dd>
                  <dt>to</dt>
                  <dd>{formatContactsInput(headerMessage.to) || '—'}</dd>
                  {(headerMessage.cc?.length ?? 0) > 0 && (
                    <>
                      <dt>cc</dt>
                      <dd>{formatContactsInput(headerMessage.cc ?? [])}</dd>
                    </>
                  )}
                  {(headerMessage.bcc?.length ?? 0) > 0 && (
                    <>
                      <dt>bcc</dt>
                      <dd>{formatContactsInput(headerMessage.bcc ?? [])}</dd>
                    </>
                  )}
                  <dt>{headerMessage.isDraft ? 'saved' : 'received'}</dt>
                  <dd>{formatDate(headerMessage.receivedAt)}</dd>
                  {headerMessage.messageIdHeader && (
                    <>
                      <dt>message-id</dt>
                      <dd>{headerMessage.messageIdHeader}</dd>
                    </>
                  )}
                </>
              )}
              <dt>source</dt>
              <dd>
                {readerViaSource ? `${readerViaSource} · ` : ''}
                {selectedAccount?.email ?? 'this device'}
              </dd>
              {demotedChips.length > 0 && (
                <>
                  <dt>labels</dt>
                  <dd>
                    <span
                      style={{
                        display: 'inline-flex',
                        flexWrap: 'wrap',
                        gap: 4,
                      }}
                    >
                      {demotedChips.map(chip => (
                        <MailStateChip key={chip.label} $tone={chip.tone}>
                          {chip.label}
                        </MailStateChip>
                      ))}
                    </span>
                  </dd>
                </>
              )}
            </ReaderDetailsPanel>
          )}
        </ReaderBandInner>
      </ReaderHeaderBand>
      {/* Reading-height: once the header band above has collapsed away, this
          slim line keeps naming who is talking — a zero-height sticky
          anchor pins it under the always-sticky toolbar, so its appearance
          is an opacity fade that can never move content. */}
      {stickyMessage && (
        <MessageStickyAnchor aria-hidden={!subjectInToolbar}>
          <MessageStickyHeader $visible={subjectInToolbar}>
            <MessageStickyInner>
              <MessageStickySenderName>
                {stickyMessage.from.name || stickyMessage.from.email}
              </MessageStickySenderName>
              <ReaderTimestamp>
                {formatThreadListTime(stickyMessage.receivedAt)}
                {stickyMessageIndex > 0
                  ? ` · message ${stickyMessageIndex} of ${selectedMessages.length}`
                  : ''}
              </ReaderTimestamp>
            </MessageStickyInner>
          </MessageStickyHeader>
        </MessageStickyAnchor>
      )}
      <ReaderScrollBody>
        {(selectedThread.syncState === 'failed' ||
          selectedThread.syncState === 'conflict') && (
          <FiledLine>
            Sync needs attention. Retry queues this thread again; mark
            resolved clears the local warning.
            <button type="button" onClick={retrySelectedThreadSync}>
              retry
            </button>
            <button type="button" onClick={resolveSelectedThreadSync}>
              mark resolved
            </button>
          </FiledLine>
        )}
        {agentPanelOpen && (
          <AskPanel aria-label="Ask about this thread">
            <AskPanelHeader>
              <AskPanelTitle>Ask</AskPanelTitle>
              <Button
                size="sm"
                variant="text"
                onClick={() => setAgentPanelOpen(false)}
              >
                Close
              </Button>
            </AskPanelHeader>
            <AskInputRow>
              <AskInput
                ref={askInputRef}
                value={agentQuestion}
                placeholder="Ask about this thread"
                aria-label="Question about this thread"
                onChange={event => setAgentQuestion(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitAskInput()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setAgentPanelOpen(false)
                  }
                }}
              />
              <Button
                size="sm"
                disabled={agentBusy || !agentQuestion.trim()}
                onClick={submitAskInput}
              >
                Ask
              </Button>
            </AskInputRow>
            <AskSuggestionRow>
              {askSuggestions.map(suggestion => (
                <AskChip
                  key={suggestion.label}
                  type="button"
                  disabled={agentBusy}
                  onClick={suggestion.run}
                >
                  {suggestion.label}
                </AskChip>
              ))}
              <AskChip
                type="button"
                disabled={agentBusy || Boolean(selectedThreadDrafting)}
                onClick={() => createSelectedThreadDraft()}
              >
                {selectedThreadQaStatus === 'failed'
                  ? 'Retry draft'
                  : 'Draft a reply'}
              </AskChip>
            </AskSuggestionRow>
            {(selectedThreadDrafting || selectedThreadGeneratedDraft) && (
              <AskStatusLine aria-live="polite">
                {selectedThreadDrafting ? (
                  'Working…'
                ) : selectedThreadQaStatus === 'failed' ? (
                  <>
                    {/* A failed draft used to be hidden from every surface,
                        which is how work an agent reported doing became
                        findable nowhere at all. Say what happened. */}
                    {selectedThreadGeneratedDraft?.qaError
                      ? `Drafting failed: ${selectedThreadGeneratedDraft.qaError}`
                      : 'Drafting failed. Nothing was written.'}
                    <TextLinkButton
                      type="button"
                      onClick={() => createSelectedThreadDraft()}
                    >
                      Try again
                    </TextLinkButton>
                  </>
                ) : (
                  <>
                    Draft ready.
                    <TextLinkButton
                      type="button"
                      onClick={() => {
                        // Open the draft that already exists — in the
                        // compose window, seeded with the drafted body.
                        // focusReply() would *create* another one, which is
                        // how this shipped a blank "Manual draft" over the
                        // generated one it was meant to reveal.
                        if (!selectedThreadGeneratedDraft) return
                        openDraftInComposeWindow(selectedThreadGeneratedDraft)
                      }}
                    >
                      Open draft
                    </TextLinkButton>
                  </>
                )}
              </AskStatusLine>
            )}
            <AskStatusLine aria-live="polite">{askStatus || 'Questions and summaries are answered in the drawer.'}</AskStatusLine>
          </AskPanel>
        )}
      {readerMode === 'email' ? (
        <>
          {selectedInvite && selectedInviteMessage && (
            <InviteCard aria-label="Calendar invite">
              <InviteCardHead>
                <div style={{ minWidth: 0 }}>
                  <InviteCardLabel>Calendar invite</InviteCardLabel>
                  <InviteCardTitle>{selectedInvite.title}</InviteCardTitle>
                  <InviteCardWhen>
                    {inviteWhen}
                    {selectedInvite.location
                      ? ` · ${selectedInvite.location}`
                      : ''}
                  </InviteCardWhen>
                  <InviteCardMeta>
                    {selectedInvite.organizer
                      ? `organiser ${selectedInvite.organizer.name}`
                      : 'organiser not listed'}
                    {' · '}
                    {selectedInvite.attendees.length} attendee
                    {selectedInvite.attendees.length === 1 ? '' : 's'}
                  </InviteCardMeta>
                  {selectedInvite.description && (
                    <InviteCardWhen style={{ marginTop: 6 }}>
                      {selectedInvite.description}
                    </InviteCardWhen>
                  )}
                </div>
                <InviteStatusPill $tone={inviteTone}>
                  {invitePillWord}
                </InviteStatusPill>
              </InviteCardHead>
              {/* Where "alex@… has accepted the invitation to …" lives now:
                  as the invite's status, not a paragraph. */}
              {inviteResponse && (
                <InviteStatusRow $tone={inviteTone}>
                  <InviteStatusText $tone={inviteTone}>
                    ✓ {inviteResponder} {inviteResponseVerb}
                  </InviteStatusText>
                  <InviteStatusMeta>
                    {formatDate(selectedInviteMessage.receivedAt)}
                    {selectedInvite.method === 'REPLY' &&
                    inviteMessageOutgoing
                      ? ' · reply sent to organiser'
                      : ''}
                  </InviteStatusMeta>
                  <span style={{ flex: 1 }} />
                  <BulkMenuWrap ref={inviteChangeRef}>
                    <ReaderDetailsButton
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={inviteChangeOpen}
                      onClick={() => setInviteChangeOpen(open => !open)}
                    >
                      change ⌄
                    </ReaderDetailsButton>
                    {inviteChangeOpen && (
                      <ThreadActionsMenu
                        role="menu"
                        aria-label="Change response"
                      >
                        {(
                          [
                            ['accepted', 'Accept'],
                            ['tentative', 'Maybe'],
                            ['declined', 'Decline'],
                          ] as const
                        ).map(([response, label]) => (
                          <BulkMenuItem
                            key={response}
                            role="menuitem"
                            onClick={() => {
                              setInviteChangeOpen(false)
                              void openCalendarInvite(response)
                            }}
                          >
                            {label}
                          </BulkMenuItem>
                        ))}
                      </ThreadActionsMenu>
                    )}
                  </BulkMenuWrap>
                </InviteStatusRow>
              )}
              <InviteCardActions>
                {/* A cancellation is not something to accept or decline —
                    the only action left is reconciling the calendar. */}
                {selectedInvite.status === 'cancelled' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void openCalendarInvite()}
                  >
                    Update calendar
                  </Button>
                ) : inviteResponse ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void openCalendarInvite()}
                    >
                      Add to calendar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void openCalendarApp()}
                    >
                      Open in PureCalendar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void openCalendarInvite('accepted')}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void openCalendarInvite('tentative')}
                    >
                      Maybe
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void openCalendarInvite('declined')}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void openCalendarInvite()}
                    >
                      Add to calendar
                    </Button>
                  </>
                )}
                {!selectedInvite.description && (
                  <InviteCardNote>no event description</InviteCardNote>
                )}
              </InviteCardActions>
            </InviteCard>
          )}
          {activeMessageTab ? (
            (() => {
              const message = activeMessageTab
              const body = readerMailBody(message)
              const quotedExpanded = isQuotedHistoryExpanded(message.id)
              // "via Gmail" moved to the header band's state line, and only
              // a message actually fetched from Gmail (id `gmail_msg_*`)
              // earns it there — a local `msg_sent_*` copy must never make
              // that claim. That was the phantom-send lie.
              const isUnconfirmedSend = Boolean(message.optimistic)
              if (
                message.id === selectedInviteMessage?.id &&
                inviteBodyIsNotice &&
                !isUnconfirmedSend
              ) {
                /* The invite card above carries this message's meaning; all
                   that is left to say is where it came from — one quiet line,
                   no card chrome around it. */
                return (
                  <ProvenanceLine key={message.id}>
                    Generated by PureMail from {inviteSourceName} · no
                    message body
                  </ProvenanceLine>
                )
              }
              return (
                <MessageCard
                  key={message.id}
                  id={`puremail-message-${message.id}`}
                  $focused={focusedMessageId === message.id}
                >
                  {/* No sender block here at all: the header band names the
                      open message's sender, state, timestamp and source, and
                      the pane renders one message at a time — anything
                      repeated here is the duplicated block 8a deletes. */}
                  {isUnconfirmedSend && (
                    <Meta>
                      Sending… this reply has not been confirmed by{' '}
                      {providerName(activeProvider)} yet.
                    </Meta>
                  )}
                  {body.hasCollapsedHistory ? (
                    <MessageBody>
                      {body.segments.map((segment, segmentIndex) => {
                        if (segment.type === 'quote') {
                          return quotedExpanded ? (
                            <ExpandedQuoteBlock
                              key={`${message.id}-quote-${segmentIndex}`}
                            >
                              <ExpandedQuoteHeader>
                                <span>{segment.label}</span>
                                <TextLinkButton
                                  type="button"
                                  onClick={() =>
                                    setQuotedHistoryOpen(
                                      message.id,
                                      false,
                                    )
                                  }
                                >
                                  Hide
                                </TextLinkButton>
                              </ExpandedQuoteHeader>
                              {segment.text
                                .split('\n')
                                .map((line, lineIndex) => (
                                  <p
                                    key={`${message.id}-quote-line-${segmentIndex}-${lineIndex}`}
                                  >
                                    {line || '\u00a0'}
                                  </p>
                                ))}
                            </ExpandedQuoteBlock>
                          ) : (
                            <CollapsedQuoteBoundary
                              key={`${message.id}-quote-${segmentIndex}`}
                            >
                              <span>{segment.label} hidden</span>
                              <TextLinkButton
                                type="button"
                                onClick={() =>
                                  setQuotedHistoryOpen(message.id, true)
                                }
                              >
                                Open
                              </TextLinkButton>
                            </CollapsedQuoteBoundary>
                          )
                        }
                        return plainTextParagraphs(
                          segment.text,
                          `${message.id}-text-${segmentIndex}`,
                        )
                      })}
                    </MessageBody>
                  ) : message.bodyHtml ? (
                    (() => {
                      const hasRemoteImages = mailHtmlHasRemoteImages(
                        message.bodyHtml,
                      )
                      const senderEmail = message.from?.email ?? ''
                      const decision = remoteImageDecision({
                        settings: store.settings,
                        senderEmail,
                        messageId: message.id,
                        onceLoadedIds: remoteImagesLoadedIds,
                      })
                      const banner = remoteImageBannerState(
                        decision,
                        senderEmail,
                      )
                      // Reversing a grant must re-block the open message
                      // immediately, so drop its session-only "once" entry
                      // alongside the settings change — otherwise a message
                      // loaded once before being trusted stays loaded.
                      const clearOnceLoaded = (): void =>
                        setRemoteImagesLoadedIds(current =>
                          current.filter(id => id !== message.id),
                        )
                      const reverseGrant = (): void => {
                        clearOnceLoaded()
                        if (decision.reason === 'trusted-sender') {
                          setStore(current => ({
                            ...current,
                            settings: untrustSender(
                              current.settings,
                              senderEmail,
                            ),
                          }))
                        } else if (decision.reason === 'policy-always') {
                          setStore(current => ({
                            ...current,
                            settings: setRemoteImagePolicy(
                              current.settings,
                              'ask',
                            ),
                          }))
                        }
                      }
                      return (
                        <>
                          {hasRemoteImages && (
                            <CollapsedQuoteBoundary
                              style={{ flexWrap: 'wrap' }}
                            >
                              <span>{banner.label}</span>
                              {decision.load ? (
                                <TextLinkButton
                                  type="button"
                                  onClick={reverseGrant}
                                >
                                  {banner.actionLabel}
                                </TextLinkButton>
                              ) : (
                                <>
                                  <TextLinkButton
                                    type="button"
                                    onClick={() =>
                                      setRemoteImagesLoadedIds(current => [
                                        ...current,
                                        message.id,
                                      ])
                                    }
                                  >
                                    Just this once
                                  </TextLinkButton>
                                  <span aria-hidden="true">·</span>
                                  <TextLinkButton
                                    type="button"
                                    disabled={!senderEmail}
                                    onClick={() =>
                                      setStore(current => ({
                                        ...current,
                                        settings: trustSender(
                                          current.settings,
                                          senderEmail,
                                        ),
                                      }))
                                    }
                                  >
                                    Always from this sender
                                  </TextLinkButton>
                                  <span aria-hidden="true">·</span>
                                  <TextLinkButton
                                    type="button"
                                    onClick={() =>
                                      setStore(current => ({
                                        ...current,
                                        settings: setRemoteImagePolicy(
                                          current.settings,
                                          'always',
                                        ),
                                      }))
                                    }
                                  >
                                    Always
                                  </TextLinkButton>
                                </>
                              )}
                            </CollapsedQuoteBoundary>
                          )}
                          <SanitizedMessageBody
                            bodyHtml={message.bodyHtml}
                            allowRemoteImages={decision.load}
                          />
                        </>
                      )
                    })()
                  ) : (
                    <MessageBody>
                      {plainTextParagraphs(message.body, `${message.id}-body`)}
                    </MessageBody>
                  )}
                </MessageCard>
              )
            })()
          ) : (
            <ReaderEmptyState>
              <EmptyState
                tone="neutral"
                title="No message selected"
                message="Pick a dated message tab to read this thread."
              />
            </ReaderEmptyState>
          )}
          {/* The reply LAUNCHER at the reader's foot. The inline composer
              this strip replaced lives on as the docked compose window —
              the strip previews the draft in progress (agent-drafted or
              saved) or offers a fresh reply, and clicking it opens the
              window seeded with that draft. ONE composer surface. */}
          {(launcherDraft || activeMessageTab) && (
            <ReplyLaunchStrip
              type="button"
              aria-label={
                launcherDraft
                  ? 'Open the draft reply in the compose window'
                  : 'Reply in the compose window'
              }
              onClick={() =>
                launcherDraft
                  ? openDraftInComposeWindow(launcherDraft)
                  : focusReply()
              }
            >
              <ReplyIcon aria-hidden="true" />
              {launcherDraft ? (
                <>
                  <ReplyLaunchKicker>
                    {draftKindForDraft(launcherDraft) === 'manual'
                      ? launcherDraft.id.startsWith('draft_forward')
                        ? 'Draft forward'
                        : 'Draft reply'
                      : 'Drafted for you'}
                  </ReplyLaunchKicker>
                  <ReplyLaunchPreview>
                    {draftLaunchPreview(launcherDraft.body) || 'Empty draft'}
                    {launcherDraft.attachments.length > 0
                      ? ` · ${launcherDraft.attachments.length} attachment${
                          launcherDraft.attachments.length === 1 ? '' : 's'
                        }`
                      : ''}
                  </ReplyLaunchPreview>
                  <ReplyLaunchOpen>Open draft</ReplyLaunchOpen>
                </>
              ) : (
                <>
                  <ReplyLaunchPreview>
                    Reply to{' '}
                    {activeMessageTab
                      ? activeMessageTab.from.name ||
                        activeMessageTab.from.email
                      : 'this thread'}
                    …
                  </ReplyLaunchPreview>
                  <ReplyLaunchOpen>Opens the compose window</ReplyLaunchOpen>
                </>
              )}
            </ReplyLaunchStrip>
          )}
        </>
      ) : (
        <>
          {activeReplyDraft ? (
            [activeReplyDraft].map(draft => {
              return (
                <MessageCard key={draft.id}>
                  <ReaderCardHeader>
                    <div>
                      <Kicker>
                        {draft.sentAt
                          ? 'Reply sent'
                          : draftKindForDraft(draft) === 'manual'
                          ? 'Draft reply'
                          : 'Generated draft'}
                      </Kicker>
                      <Meta>
                        {draft.sentAt
                          ? `sent ${formatDate(draft.sentAt)}${
                              sentDraftRecipientSummary(draft)
                                ? ` · ${sentDraftRecipientSummary(draft)}`
                                : ''
                            }${
                              draft.sentWithoutReview
                                ? ' · sent without QA review'
                                : ''
                            }`
                          : `${draftKindLabel(
                              draftKindForDraft(draft),
                            )}${
                              draft.confidence
                                ? ` · ${draft.confidence} confidence`
                                : ''
                            }`}
                      </Meta>
                    </div>
                  </ReaderCardHeader>
                  <ReaderCardBody>
                    {draft.sentAt ? (
                      <>
                        <SentReplyRecipient>
                          <ComposeLabel>To</ComposeLabel>
                          <SentReplyRecipientText>
                            {formatContactsInput(draft.to) ||
                              'No recipient'}
                          </SentReplyRecipientText>
                        </SentReplyRecipient>
                        {draft.sentWithoutReview && (
                          <QaEditedTag>
                            Sent without QA review
                            {draft.sentByAutomation
                              ? ' by automation'
                              : ''}
                            .
                            {draft.sentReviewBypassReason
                              ? ` ${draft.sentReviewBypassReason}`
                              : ''}
                          </QaEditedTag>
                        )}
                        <SentReplyBody>{draft.body}</SentReplyBody>
                        {draft.attachments.length > 0 && (
                          <AttachmentList aria-label="Sent attachments">
                            {draft.attachments.map(attachment => (
                              <AttachmentChip key={attachment.id}>
                                <AttachmentMeta>
                                  {attachmentKindLabel(attachment)}
                                </AttachmentMeta>
                                <AttachmentName title={attachment.name}>
                                  {attachment.name}
                                </AttachmentName>
                                <AttachmentMeta>
                                  {attachmentDisplaySize(attachment)}
                                </AttachmentMeta>
                              </AttachmentChip>
                            ))}
                          </AttachmentList>
                        )}
                        {draft.provenance &&
                          draft.provenance.length > 0 && (
                            <Meta>
                              Sources: {draft.provenance.join(' · ')}
                            </Meta>
                          )}
                      </>
                    ) : null}
                  </ReaderCardBody>
                </MessageCard>
              )
            })
          ) : (
            <ReaderEmptyState>
              <EmptyState
                tone="neutral"
                title="No reply selected"
                message="Use Reply to create a new reply tab for this email."
              />
            </ReaderEmptyState>
          )}
        </>
      )}
      </ReaderScrollBody>
      </ReaderScroll>
      {/* Band 3. The pane's bottom edge. A short message used to trail off
          into white with nothing closing the column. */}
      {readerAttachments.length > 0 && attachmentMessage && (
        <ReaderAttachmentBand aria-label="Attachments">
          <AttachmentBandInner>
            <AttachmentChips
              $scroll={
                attachmentsExpanded &&
                attachmentMessage.attachments.length > 6
              }
            >
            {readerAttachments.map(attachment => {
              const calendarAttachment = isCalendarAttachment(attachment)
              const contentAvailable = Boolean(
                attachment.content || providerBacked?.getAttachmentContent,
              )
              const previewable =
                contentAvailable && attachmentPreviewKind(attachment) !== null
              // PDFs open in the shell's detached viewer window as their
              // primary action; every other kind keeps its old primary.
              const viewerPrimary =
                !calendarAttachment &&
                contentAvailable &&
                isPdfAttachment(attachment)
              const attachmentError =
                attachmentActionErrors[
                  `${attachmentMessage.id}:${attachment.id}`
                ]
              return (
                <ReaderAttachmentChip key={attachment.id}>
                  <AttachmentTypeTile aria-hidden="true">
                    {attachmentExtension(attachment.name)}
                  </AttachmentTypeTile>
                  <AttachmentRowText>
                    <AttachmentRowName title={attachment.name}>
                      {attachment.name}
                    </AttachmentRowName>
                    <AttachmentRowMeta>
                      {calendarAttachment
                        ? 'Calendar invite'
                        : attachmentKindLabel(attachment)}{' '}
                      · {attachmentDisplaySize(attachment)}
                      {attachmentError ? ` · ${attachmentError}` : ''}
                    </AttachmentRowMeta>
                  </AttachmentRowText>
                  <AttachmentChipActions>
                    {/* One primary, chosen by type: an .ics wants adding to
                        the calendar, an image wants looking at, anything
                        else wants saving. When the invite card is on screen
                        it owns Add to calendar; the file here keeps only
                        Preview and Save. */}
                    {calendarAttachment && !selectedInvite ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void addAttachmentInviteToCalendar(
                            attachmentMessage,
                            attachment,
                          )
                        }
                      >
                        Add to calendar
                      </Button>
                    ) : viewerPrimary ? (
                      <AttachmentActionButton
                        size="sm"
                        variant="primary"
                        aria-label={`Open ${attachment.name} in its own viewer window`}
                        onClick={() =>
                          void openAttachmentInViewer(
                            attachmentMessage,
                            attachment,
                          )
                        }
                      >
                        Open
                      </AttachmentActionButton>
                    ) : previewable ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void previewAttachment(attachmentMessage, attachment)
                        }
                      >
                        Preview
                      </Button>
                    ) : (
                      contentAvailable && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            void saveAttachmentToDisk(
                              attachmentMessage,
                              attachment,
                            )
                          }
                        >
                          Save
                        </Button>
                      )
                    )}
                    {previewable && calendarAttachment && !selectedInvite && (
                      <Button
                        size="sm"
                        onClick={() =>
                          void previewAttachment(attachmentMessage, attachment)
                        }
                      >
                        Preview
                      </Button>
                    )}
                    {contentAvailable &&
                      ((calendarAttachment && !selectedInvite) ||
                        previewable) && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void saveAttachmentToDisk(
                              attachmentMessage,
                              attachment,
                            )
                          }
                        >
                          Save
                        </Button>
                      )}
                    {attachmentError && (
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() =>
                          void resolveAttachmentContent(
                            attachmentMessage,
                            attachment,
                          ).then(resolved => {
                            if (resolved) {
                              setCommandNotice(`${resolved.name} downloaded.`)
                            }
                          })
                        }
                      >
                        Retry
                      </Button>
                    )}
                    {savedAttachmentPaths[
                      `${attachmentMessage.id}:${attachment.id}`
                    ] && (
                      <Button
                        size="sm"
                        variant="subtle"
                        title="Show the saved file in your file manager"
                        onClick={() =>
                          void osReveal(
                            savedAttachmentPaths[
                              `${attachmentMessage.id}:${attachment.id}`
                            ],
                          )
                        }
                      >
                        Reveal
                      </Button>
                    )}
                  </AttachmentChipActions>
                </ReaderAttachmentChip>
              )
            })}
              {readerAttachments.length <
              attachmentMessage.attachments.length ? (
                <ReaderDetailsButton
                  type="button"
                  aria-expanded={false}
                  style={{ marginLeft: 0 }}
                  onClick={() => setAttachmentsExpanded(true)}
                >
                  +
                  {attachmentMessage.attachments.length -
                    readerAttachments.length}{' '}
                  more ⌄
                </ReaderDetailsButton>
              ) : attachmentsExpanded ? (
                <ReaderDetailsButton
                  type="button"
                  aria-expanded
                  style={{ marginLeft: 0 }}
                  onClick={() => setAttachmentsExpanded(false)}
                >
                  show fewer ⌃
                </ReaderDetailsButton>
              ) : null}
              {(savedAttachmentPaths[`${attachmentMessage.id}:all`] ||
                readerAttachmentsCanSaveAll) && (
                <AttachmentChipControlsRight>
                {savedAttachmentPaths[`${attachmentMessage.id}:all`] && (
                  <Button
                    size="sm"
                    variant="subtle"
                    title="Show the saved folder in your file manager"
                    onClick={() =>
                      void osReveal(
                        savedAttachmentPaths[`${attachmentMessage.id}:all`],
                      )
                    }
                  >
                    Reveal folder
                  </Button>
                )}
                {readerAttachmentsCanSaveAll && (
                  <Button
                    size="sm"
                    onClick={() => void saveAllAttachments(attachmentMessage)}
                  >
                    Save all ({attachmentMessage.attachments.length})
                  </Button>
                )}
                </AttachmentChipControlsRight>
              )}
            </AttachmentChips>
          </AttachmentBandInner>
        </ReaderAttachmentBand>
      )}
        </>
      )}
      {filterDialogOpen && (
        <MailFilterDialog
          store={store}
          accountId={selectedThread.accountId}
          seed={{
            senderEmail: filterSeedSender,
            subject: selectedThread.subject,
          }}
          onClose={() => setFilterDialogOpen(false)}
          onSubmit={handleCreateFilter}
        />
      )}
      {historyOpen && paneMode === 'message' && (
        <ThreadHistoryPopover
          entries={historyEntries}
          currentId={historyCurrentId}
          filter={historyFilter}
          setFilter={setHistoryFilter}
          onOpenEntry={openHistoryEntry}
          onOpenThreadView={() => {
            setHistoryOpen(false)
            setPaneMode('thread')
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </ReaderPane>
  )
}
