import { useMailDrop } from './useMailDrop'
import { prepareMailDrop, rasterizeMailSvg } from '../lib/mailDrop'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  Bold,
  Braces,
  ChevronDown,
  Clock,
  FileText,
  Forward,
  Italic,
  Link2,
  List,
  ListOrdered,
  ChevronUp,
  Maximize2,
  Minus,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Reply,
  ReplyAll,
  Send,
  SkipForward,
  Trash2,
  Underline,
  X,
} from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { sendDraft } from '../lib/mailModel'
import { useOutsideClose } from './useOutsideClose'
import { scheduleSend } from '../lib/mailScheduledSend'
import {
  attachmentDisplaySize,
  attachmentKindLabel,
  attachmentSizeStatus,
} from '../lib/mailAttachments'
import {
  bodyMentionsAttachment,
  defaultSignatureForAccount,
  invalidRecipientsInInput,
  plainTextToComposeHtml,
  signaturesForAccount,
} from '../lib/mailCompose'
import { composeEscapeAction } from '../lib/composeWindowMode'
import { templateNoteSlotHtml } from '../lib/mailRuns'
import {
  bodyHtmlWithQuote,
  bodyWithQuote,
  upsertReplyDraft,
  type ComposeQuoteState,
  type ComposeReplyContext,
  type ReplyComposeKind,
} from '../lib/replyCompose'
import { mailProviderSupports } from '../lib/mailProviderCapabilities'
import { sanitizeMailHtml } from '../lib/sanitizeMailHtml'
import { recordOperation } from '../bridge/platformBridge'
import type {
  Attachment,
  Draft,
  MailAccount,
  MailProvider,
  MailStore,
  MailThread,
} from '../types'
import {
  AttachmentDropHint,
  AttachmentMeta,
  AttachmentName,
  AttachmentSizeNotice,
  ComposeContextLink,
  ComposeContextSpacer,
  ComposeContextStrip,
  ComposeContextText,
  ComposeQuoteChip,
  ComposeQuoteChipRow,
  BulkMenu,
  BulkMenuItem,
  BulkMenuWrap,
  ComposeAttachmentChip,
  ComposeAttachmentList,
  ComposeBody,
  ComposeDockAttachmentChip,
  ComposeDockAttachmentMeta,
  ComposeDockAttachmentName,
  ComposeDockAttachmentRemove,
  ComposeDockAttachmentRow,
  ComposeDockCcBccToggle,
  ComposeDockEditor,
  ComposeDockFooter,
  ComposeDockFooterNote,
  ComposeDockFooterSpacer,
  ComposeDockIconButton,
  ComposeDockMenu,
  ComposeDockNotices,
  ComposeDockRecipients,
  ComposeDockRow,
  ComposeDockRowLabel,
  ComposeDockRowMeta,
  ComposeDockSecondaryButton,
  ComposeDockSendButton,
  ComposeDockSendGroup,
  ComposeDockSendLater,
  ComposeDockSubjectInput,
  ComposeDockTitle,
  ComposeDockTitleBar,
  ComposeDockTitleHint,
  ComposeDockTitleMeta,
  ComposeDockTitleSpacer,
  ComposeDockToolbar,
  ComposeDockToolbarButton,
  ComposeDockToolbarDivider,
  ComposeDockToolbarTextButton,
  ComposeTemplateToChip,
  ComposeDockWinButton,
  ComposeDockWindow,
  ComposeField,
  ComposeFileInput,
  ComposeFooter,
  ComposeHeader,
  ComposeInlineNotice,
  ComposeInlineRow,
  ComposeInput,
  ComposeLabel,
  ComposeMinimizedButton,
  ComposeMinimizedStrip,
  ComposeMinimizedTitle,
  ComposeRichBody,
  ComposeScreen,
  ComposeToolbar,
  ComposeToolbarButton,
  DraftAddressToggle,
  KbdChip,
  Kicker,
  Meta,
  PendingSendLabel,
  Subject,
} from './mailShellStyles'
import {
  createComposeId,
  providerName,
  fileToAttachment,
  namedClipboardFile,
  parseComposeRecipients,
  type PendingSendState,
} from './mailShellHelpers'
import { RecipientChipsInput } from './RecipientChipsInput'

type ComposeSendSnapshot = {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  bodyHtml: string
  attachments: Attachment[]
}

/**
 * What the run card is for, and what it reports back. The run variant is
 * the docked window's chrome laid inline in the run screen: an item card
 * (one rendered draft, Send & next / Skip) or the template card in setup
 * (Insert field, Insert note slot, Render N drafts). The shell owns every
 * decision — the editor only calls back.
 */
export interface RunComposeChrome {
  mode: 'item' | 'template'
  /** "Draft 3 of 24" / "New run · October workshop invite". */
  title: string
  /** "Mere Example · paper supplier" / "template · 24 recipients". */
  meta?: string
  /** "⌘← previous · ⌘→ skip" at the right of the title strip. */
  hint?: string
  /** Item card: "from list · row 3". */
  toMeta?: string
  /** Item card: the draft to send, current fields written in. The shell sends it. */
  onSend?: (draft: Draft) => void
  onSkip?: () => void
  canSkip?: boolean
  /** Item card: this item's send is still in its undo hold. */
  sendPending?: boolean
  onUndoSend?: () => void
  footerNote?: string
  /** Template card: tokens the Insert field menu offers. */
  tokens?: string[]
  onRender?: () => void
  renderLabel?: string
  renderDisabled?: boolean
  renderNote?: string
  onPreview?: () => void
  previewLabel?: string
  onDiscard?: () => void
  discardArmed?: boolean
  /** Attachment row note: "go on every draft" / "shared by the run". */
  attachmentNote?: string
}

export interface ComposeEditorProps {
  store: MailStore
  setStore: React.Dispatch<React.SetStateAction<MailStore>>
  storeRef: React.MutableRefObject<MailStore>
  activeProvider: 'demo' | 'gmail' | 'imap'
  mailProviderRef: React.MutableRefObject<MailProvider | undefined>
  selectedAccount: MailAccount | null
  composeTo: string
  setComposeTo: React.Dispatch<React.SetStateAction<string>>
  composeCc: string
  setComposeCc: React.Dispatch<React.SetStateAction<string>>
  composeBcc: string
  setComposeBcc: React.Dispatch<React.SetStateAction<string>>
  composeCcBccOpen: boolean
  setComposeCcBccOpen: React.Dispatch<React.SetStateAction<boolean>>
  composeSubject: string
  setComposeSubject: React.Dispatch<React.SetStateAction<string>>
  composeBody: string
  setComposeBody: React.Dispatch<React.SetStateAction<string>>
  composeBodyHtml: string
  setComposeBodyHtml: React.Dispatch<React.SetStateAction<string>>
  composeAttachments: Attachment[]
  setComposeAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  composeDropActive: boolean
  setComposeDropActive: React.Dispatch<React.SetStateAction<boolean>>
  setComposeOpen: (open: boolean) => void
  /**
   * What the window is answering, when it is a reply/reply-all/forward (or
   * an existing draft opened from Drafts) rather than a new message. Set by
   * the shell when a reply opens; null for plain compose. The editor
   * branches on it ONLY where a reply differs: the context strip, the
   * quoted-history chip, and the threaded send/save/discard paths.
   */
  composeContext: ComposeReplyContext | null
  /** Collapsed quoted history; null once expanded into the body (or none). */
  composeQuote: ComposeQuoteState | null
  setComposeQuote: React.Dispatch<
    React.SetStateAction<ComposeQuoteState | null>
  >
  /** Re-derives recipients/subject for the new kind (context strip links). */
  switchComposeReplyKind: (kind: ReplyComposeKind) => void
  /** Clears the shell-owned reply context when the compose state resets. */
  onResetComposeContext: () => void
  /** Discards the store draft a context window was opened on. */
  discardContextDraft: (draftId: string) => void
  /**
   * 'docked' renders the small bottom-right window (or its minimized strip);
   * 'full' renders the full-screen compose surface. Same state, same
   * handlers — only the chrome differs.
   */
  variant?: 'full' | 'docked' | 'run'
  /** Run variant only: the card's role and callbacks. */
  runChrome?: RunComposeChrome
  /** Docked only: the window is collapsed to the 240×36 title strip. */
  dockMinimized?: boolean
  onMinimize?: () => void
  onRestore?: () => void
  /** Docked → full-screen pop-out. */
  onExpand?: () => void
  /** Full-screen → back to the docked window. */
  onDock?: () => void
  composeToRef: React.RefObject<HTMLInputElement | null>
  pendingSend: PendingSendState | null
  schedulePendingSend: (pending: PendingSendState, commit: () => void) => void
  undoPendingSend: (pendingId: string) => void
  markDraftSending: (draftId: string, sending: boolean) => void
  setSelectedMailboxId: React.Dispatch<React.SetStateAction<string>>
  setSelectedThreadId: React.Dispatch<React.SetStateAction<string>>
  setCommandNotice: React.Dispatch<React.SetStateAction<string>>
}

export function ComposeEditor({
  store,
  setStore,
  storeRef,
  activeProvider,
  mailProviderRef,
  selectedAccount,
  composeTo,
  setComposeTo,
  composeCc,
  setComposeCc,
  composeBcc,
  setComposeBcc,
  composeCcBccOpen,
  setComposeCcBccOpen,
  composeSubject,
  setComposeSubject,
  composeBody,
  setComposeBody,
  composeBodyHtml,
  setComposeBodyHtml,
  composeAttachments,
  setComposeAttachments,
  composeDropActive,
  setComposeDropActive,
  setComposeOpen,
  composeContext,
  composeQuote,
  setComposeQuote,
  switchComposeReplyKind,
  onResetComposeContext,
  discardContextDraft,
  variant = 'full',
  runChrome,
  dockMinimized = false,
  onMinimize,
  onRestore,
  onExpand,
  onDock,
  composeToRef,
  pendingSend,
  schedulePendingSend,
  undoPendingSend,
  markDraftSending,
  setSelectedMailboxId,
  setSelectedThreadId,
  setCommandNotice,
}: ComposeEditorProps): React.ReactElement {
  const composeRecipients = useMemo(
    () => parseComposeRecipients(composeTo),
    [composeTo],
  )
  const composeCcRecipients = useMemo(
    () => parseComposeRecipients(composeCc),
    [composeCc],
  )
  const composeBccRecipients = useMemo(
    () => parseComposeRecipients(composeBcc),
    [composeBcc],
  )
  const canSaveCompose = Boolean(
    composeRecipients.length ||
      composeCcRecipients.length ||
      composeBccRecipients.length ||
      composeSubject.trim() ||
      composeBody.trim() ||
      composeAttachments.length,
  )
  const composeSizeStatus = useMemo(
    () => attachmentSizeStatus(composeAttachments),
    [composeAttachments],
  )
  const invalidComposeRecipients = useMemo(
    () =>
      [composeTo, composeCc, composeBcc].flatMap(value =>
        invalidRecipientsInInput(value),
      ),
    [composeBcc, composeCc, composeTo],
  )
  const composeSendPending = runChrome
    ? Boolean(runChrome.sendPending)
    : pendingSend?.target === 'compose'
  // Provider-backed = any real account, not just Gmail; the demo simulation
  // is the one place a local send is the source of truth.
  const providerBacked =
    activeProvider !== 'demo' ? mailProviderRef.current : undefined
  // Provider-backed accounts must declare the compose capability before the
  // composer offers a real send (M0 capability gate, real for Gmail in M2).
  const composeCapable =
    !providerBacked || mailProviderSupports(providerBacked, 'compose')
  const canSendCompose =
    composeCapable &&
    composeRecipients.length > 0 &&
    Boolean(composeSubject.trim() || composeBody.trim()) &&
    !composeSizeStatus.overLimit &&
    invalidComposeRecipients.length === 0
  const composeSignatures = signaturesForAccount(
    store.settings,
    selectedAccount?.id,
  )

  // ── Reply context (the docked window answering a thread) ─────────────
  const contextMessage = composeContext?.messageId
    ? store.messages.find(
        message => message.id === composeContext.messageId,
      ) ?? null
    : null
  // A degenerate 'draft' context (a standalone draft opened from Drafts)
  // gets the threaded save/send paths but no strip — it answers nothing.
  const replyStripVisible =
    Boolean(composeContext) &&
    composeContext?.kind !== 'draft' &&
    Boolean(contextMessage)
  const contextTimeLabel = ((): string => {
    if (!contextMessage) return ''
    const when = new Date(contextMessage.receivedAt)
    if (Number.isNaN(when.getTime())) return contextMessage.receivedAt
    const now = new Date()
    const sameDay = when.toDateString() === now.toDateString()
    const time = when.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
    if (sameDay) return `${time} today`
    return `${when.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })} ${time}`
  })()
  const contextSenderName = contextMessage
    ? contextMessage.from.name || contextMessage.from.email
    : ''
  const contextKindLine =
    composeContext?.kind === 'forward'
      ? 'Forwarding'
      : composeContext?.kind === 'replyAll'
        ? 'Replying to all —'
        : 'Replying to'
  const contextKindSwitches: Array<{
    kind: ReplyComposeKind
    label: string
  }> = (
    [
      { kind: 'reply', label: 'Reply' },
      { kind: 'replyAll', label: 'Reply all' },
      { kind: 'forward', label: 'Forward' },
    ] as const
  ).filter(item => item.kind !== composeContext?.kind)

  /**
   * Expand the quoted-history chip: the quote enters the editable body
   * (sanitized, same rule as paste) and stops being separate state. One
   * way, like Gmail's trimmed-content dots — once it is words in the body
   * it is the user's text to trim.
   */
  const expandComposeQuote = (): void => {
    const editor = editorRef.current
    if (!editor || !composeQuote) return
    const safeQuote = sanitizeMailHtml(composeQuote.html, {
      allowRemoteImages: true,
    })
    editor.innerHTML = `${editor.innerHTML}<p><br></p>${safeQuote}`
    stripEmptyInlineFormatting()
    syncBodyFromEditor()
    setComposeQuote(null)
  }

  // ── Rich text body (Phase M2) ────────────────────────────────────────
  const editorRef = useRef<HTMLDivElement>(null)
  const [signatureMenuOpen, setSignatureMenuOpen] = useState(false)
  const [linkUrlDraft, setLinkUrlDraft] = useState<string | null>(null)
  const [attachmentReminderOpen, setAttachmentReminderOpen] = useState(false)
  const [subjectReminderOpen, setSubjectReminderOpen] = useState(false)
  const subjectInputRef = useRef<HTMLInputElement>(null)
  // The action Send-anyway resumes: plain send or a specific scheduled send.
  const pendingSubjectActionRef = useRef<(() => void) | null>(null)
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false)
  const scheduleMenuWrapRef = useRef<HTMLDivElement>(null)
  useOutsideClose(scheduleMenuWrapRef, scheduleMenuOpen, () =>
    setScheduleMenuOpen(false),
  )
  const [scheduleAtDraft, setScheduleAtDraft] = useState('')
  // Template card: the Insert field ▾ menu of tokens the list provides.
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false)
  const fieldMenuWrapRef = useRef<HTMLDivElement>(null)
  useOutsideClose(fieldMenuWrapRef, fieldMenuOpen, () => setFieldMenuOpen(false))

  // Discard is an ARMED TWO-STEP: the first click arms "Discard?" for a few
  // seconds, the second click discards. window.confirm is a silent no-op in
  // the sandboxed shell iframe, so it can never guard this.
  const [discardArmed, setDiscardArmed] = useState(false)
  useEffect(() => {
    if (!discardArmed || typeof window === 'undefined') return
    const timer = window.setTimeout(() => setDiscardArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [discardArmed])

  // Live format-at-caret state: without it the toolbar gives no sign
  // that bold typing mode is armed — text comes out bold and the user
  // cannot see why, or that clicking B disarmed it.
  const [inlineFormats, setInlineFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  })
  // Two ways a compose types bold with no visible cause: Chromium's
  // execCommand typing style surviving from a previous compose, and empty
  // formatting shells (<b><br></b>) left in restored draft HTML that the
  // caret lands inside on click. Fresh typing must NEVER start formatted
  // unless the caret genuinely sits in formatted text with content.
  const stripEmptyInlineFormatting = (): void => {
    const editor = editorRef.current
    if (!editor) return
    for (const element of [
      ...editor.querySelectorAll('b, strong, i, em, u'),
    ]) {
      if (!element.textContent?.trim()) {
        element.replaceWith(...element.childNodes)
      }
    }
  }
  // A toolbar arm is deliberate: hold the disarm off briefly so "click B,
  // then type" keeps its bold. Any caret MOVE after that reads as changed
  // intent (Gmail drops the armed style on caret move too).
  const armGraceRef = useRef(0)
  // Chromium keeps a hidden per-document typing style that can apply bold
  // to inserted text while queryCommandState reports FALSE — state-based
  // disarming cannot see it. So typing is normalized after the fact: a
  // formatting wrapper that appears around freshly typed text is kept only
  // if the caret was already inside that format or the user armed it
  // deliberately (toolbar button or Cmd/Ctrl+B/I/U); otherwise it is
  // unwrapped immediately.
  const INLINE_FORMAT_TAGS = {
    bold: /^(B|STRONG)$/,
    italic: /^(I|EM)$/,
    underline: /^U$/,
  } as const
  const userArmedRef = useRef({ bold: false, italic: false, underline: false })
  const caretHadFormatRef = useRef({
    bold: false,
    italic: false,
    underline: false,
  })
  const caretFormatContext = (): {
    bold: boolean
    italic: boolean
    underline: boolean
  } => {
    const editor = editorRef.current
    const selection = document.getSelection()
    const context = { bold: false, italic: false, underline: false }
    if (!editor || !selection || !editor.contains(selection.anchorNode)) {
      return context
    }
    let node: Node | null = selection.anchorNode
    while (node && node !== editor) {
      if (node instanceof HTMLElement && node.textContent?.trim()) {
        for (const format of ['bold', 'italic', 'underline'] as const) {
          if (INLINE_FORMAT_TAGS[format].test(node.tagName)) {
            context[format] = true
          }
        }
      }
      node = node.parentNode
    }
    return context
  }
  const armInlineFormat = (format: 'bold' | 'italic' | 'underline'): void => {
    armGraceRef.current = Date.now()
    userArmedRef.current = { ...userArmedRef.current, [format]: true }
  }
  const unwrapStrayTypedFormats = (): void => {
    const editor = editorRef.current
    const selection = document.getSelection()
    if (!editor || !selection || !selection.isCollapsed) return
    const anchorNode = selection.anchorNode
    if (!anchorNode || !editor.contains(anchorNode)) return
    const anchorOffset = selection.anchorOffset
    let changed = false
    let node: Node | null = anchorNode
    while (node && node !== editor) {
      const parent: Node | null = node.parentNode
      if (node instanceof HTMLElement) {
        for (const format of ['bold', 'italic', 'underline'] as const) {
          if (
            INLINE_FORMAT_TAGS[format].test(node.tagName) &&
            !caretHadFormatRef.current[format] &&
            !userArmedRef.current[format]
          ) {
            node.replaceWith(...node.childNodes)
            changed = true
            break
          }
        }
      }
      node = parent
    }
    if (changed) {
      const limit =
        anchorNode.nodeType === Node.TEXT_NODE
          ? (anchorNode.textContent?.length ?? 0)
          : anchorNode.childNodes.length
      const range = document.createRange()
      range.setStart(anchorNode, Math.min(anchorOffset, limit))
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }
  const disarmStrayInlineFormats = (): void => {
    const editor = editorRef.current
    const selection = document.getSelection()
    if (!editor || !selection || !selection.isCollapsed) return
    if (!editor.contains(selection.anchorNode)) return
    if (Date.now() - armGraceRef.current < 600) return
    // Caret inside REAL formatted text (with content): the armed state is
    // genuine — typing there should continue the format.
    let node: Node | null = selection.anchorNode
    while (node && node !== editor) {
      if (
        node instanceof HTMLElement &&
        /^(B|STRONG|I|EM|U)$/.test(node.tagName) &&
        node.textContent?.trim()
      ) {
        return
      }
      node = node.parentNode
    }
    for (const command of ['bold', 'italic', 'underline']) {
      if (document.queryCommandState(command)) {
        document.execCommand(command)
      }
    }
  }

  const refreshInlineFormats = (): void => {
    const editor = editorRef.current
    if (
      !editor ||
      !editor.contains(document.getSelection()?.anchorNode ?? null)
    ) {
      return
    }
    setInlineFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    })
  }
  useEffect(() => {
    const onSelectionChange = (): void => {
      // Order matters: neutralize stray armed formats at the NEW caret
      // (this runs after the browser places it), then report the truth.
      disarmStrayInlineFormats()
      if (Date.now() - armGraceRef.current >= 600) {
        userArmedRef.current = { bold: false, italic: false, underline: false }
      }
      caretHadFormatRef.current = caretFormatContext()
      refreshInlineFormats()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () =>
      document.removeEventListener('selectionchange', onSelectionChange)
  })

  const syncBodyFromEditor = (): void => {
    const editor = editorRef.current
    if (!editor) return
    setComposeBodyHtml(editor.innerHTML)
    setComposeBody(editor.innerText.replace(/ /g, ' '))
    refreshInlineFormats()
  }

  const dropState = useRef({attachments:composeAttachments,identity:composeContext?.draftId})
  dropState.current={attachments:composeAttachments,identity:composeContext?.draftId}
  const applyMailDrop = async(value:string,range:Range):Promise<void>=>{
    const editor=editorRef.current,identity=dropState.current.identity
    if(!editor || composeSendPending)throw new Error('Open an editable draft before dropping here.')
    const result=await prepareMailDrop(value,rasterizeMailSvg)
    if(!editor.isConnected || editorRef.current!==editor || dropState.current.identity!==identity || !editor.contains(range.startContainer))throw new Error('The draft changed while preparing the drop. Try again.')
    const current=dropState.current.attachments
    const added=result.attachments.filter(a=>!current.some(b=>a.content===b.content&&a.mimeType===b.mimeType))
    const next=[...current,...added],status=attachmentSizeStatus(next)
    if(status.overLimit)throw new Error(`This drop would exceed the ${status.limitLabel} attachment limit.`)
    if(result.html){editor.focus();const selection=document.getSelection();selection?.removeAllRanges();selection?.addRange(range);if(!document.execCommand('insertHTML',false,`<div><br></div>${sanitizeMailHtml(result.html,{allowRemoteImages:true})}<div><br></div>`))throw new Error('Could not insert into this draft. Click the message body and try again.');if(selection?.rangeCount){const end=selection.getRangeAt(0);range.setStart(end.endContainer,end.endOffset);range.collapse(true)}syncBodyFromEditor()}
    dropState.current.attachments=next;setComposeAttachments(next);setCommandNotice(result.notice)
  }
  useMailDrop(editorRef,composeContext?.draftId,applyMailDrop,setCommandNotice)

  const execEditorCommand = (command: string, value?: string): void => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    if (command === 'bold' || command === 'italic' || command === 'underline') {
      armGraceRef.current = Date.now()
      userArmedRef.current = {
        ...userArmedRef.current,
        [command]: document.queryCommandState(command),
      }
    }
    syncBodyFromEditor()
    refreshInlineFormats()
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!event.metaKey && !event.ctrlKey) return
    const format =
      event.key === 'b' ? 'bold'
      : event.key === 'i' ? 'italic'
      : event.key === 'u' ? 'underline'
      : null
    if (format) armInlineFormat(format)
  }

  const handleEditorInput = (event: FormEvent<HTMLDivElement>): void => {
    const inputType = (event.nativeEvent as InputEvent).inputType
    if (inputType === 'insertText' || inputType === 'insertCompositionText') {
      unwrapStrayTypedFormats()
    }
    syncBodyFromEditor()
  }

  const insertHtmlAtCaret = (html: string): void => {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, html)
    syncBodyFromEditor()
  }

  const handleRichPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    // Files pasted into the body attach (handled by the surface-level
    // handler); text goes through THE mail sanitizer before it can touch
    // the DOM — same sanitizer the reader uses (security-sensitive).
    if (event.clipboardData?.files.length) return
    event.preventDefault()
    const html = event.clipboardData?.getData('text/html')
    if (html) {
      insertHtmlAtCaret(sanitizeMailHtml(html, { allowRemoteImages: true }))
      return
    }
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (text) insertHtmlAtCaret(plainTextToComposeHtml(text))
  }

  const insertSignature = (body: string): void => {
    const editor = editorRef.current
    if (!editor) return
    editor.innerHTML = `${editor.innerHTML}<p><br></p>${plainTextToComposeHtml(
      body,
    )}`
    stripEmptyInlineFormatting()
    syncBodyFromEditor()
  }

  // Seed the uncontrolled editor exactly once per mount: restore a
  // half-written body, or start a fresh compose with the default signature.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (composeBodyHtml) {
      editor.innerHTML = composeBodyHtml
      stripEmptyInlineFormatting()
      return
    }
    if (composeBody.trim()) {
      editor.innerHTML = plainTextToComposeHtml(composeBody)
      syncBodyFromEditor()
      return
    }
    const signature = defaultSignatureForAccount(
      store.settings,
      selectedAccount?.id,
    )
    if (signature) {
      editor.innerHTML = `<p><br></p><p><br></p>${plainTextToComposeHtml(
        signature.body,
      )}`
      stripEmptyInlineFormatting()
      syncBodyFromEditor()
    }
    // Mount-only by design: the editor is uncontrolled after seeding.
  }, [])

  const mailboxIdForRole = (
    role: MailStore['mailboxes'][number]['role'],
    sourceStore = store,
  ): string => {
    return (
      sourceStore.mailboxes.find(
        mailbox =>
          mailbox.role === role && mailbox.accountId === selectedAccount?.id,
      )?.id ??
      sourceStore.mailboxes.find(mailbox => mailbox.role === role)?.id ??
      sourceStore.mailboxes[0]?.id ??
      ''
    )
  }

  const resetCompose = (): void => {
    // The run card's fields belong to the run screen, which re-seeds them
    // per item; a send never clears them from here.
    if (variant === 'run') return
    setComposeTo('')
    setComposeCc('')
    setComposeBcc('')
    setComposeCcBccOpen(false)
    setComposeSubject('')
    setComposeBody('')
    setComposeBodyHtml('')
    setComposeAttachments([])
    setComposeQuote(null)
    onResetComposeContext()
    setAttachmentReminderOpen(false)
    setSubjectReminderOpen(false)
    if (editorRef.current) editorRef.current.innerHTML = ''
  }

  const createComposeDraftStore = (
    current: MailStore,
    snapshot: ComposeSendSnapshot = {
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      body: composeBody,
      bodyHtml: composeBodyHtml,
      attachments: composeAttachments,
    },
    ids?: { draftId: string; threadId: string },
  ): { nextStore: MailStore; draftId: string; threadId: string } => {
    const now = new Date().toISOString()
    const to = parseComposeRecipients(snapshot.to)
    const cc = parseComposeRecipients(snapshot.cc)
    const bcc = parseComposeRecipients(snapshot.bcc)
    const account =
      current.accounts.find(item => item.id === selectedAccount?.id) ??
      current.accounts[0]
    const accountId = account?.id ?? 'local'
    // Ids come from the caller when it needs to know them. Minting them
    // inside a setState updater and reading them back out was unsound: React
    // may run an updater more than once and keep only one result, leaving the
    // caller holding an id that is not in the store.
    const threadId = ids?.threadId ?? createComposeId('thread_compose')
    const draftId = ids?.draftId ?? createComposeId('draft_compose')
    const draftsMailboxId =
      current.mailboxes.find(
        mailbox => mailbox.role === 'drafts' && mailbox.accountId === accountId,
      )?.id ??
      current.mailboxes.find(mailbox => mailbox.role === 'drafts')?.id ??
      current.mailboxes[0]?.id ??
      ''
    const from = { name: account?.name ?? 'Me', email: account?.email ?? '' }
    const subject = snapshot.subject.trim() || '(no subject)'
    const body = snapshot.body.trim()
    const thread: MailThread = {
      id: threadId,
      accountId,
      mailboxId: draftsMailboxId,
      subject,
      participants: [from, ...to, ...cc, ...bcc],
      labels: [],
      status: 'waiting',
      priority: 'none',
      summary: body.slice(0, 160) || 'Draft message',
      lastMessageAt: now,
      syncState: 'pending',
    }
    const draft: Draft = {
      id: draftId,
      threadId,
      to,
      cc,
      bcc,
      subject,
      body: snapshot.body,
      ...(snapshot.bodyHtml ? { bodyHtml: snapshot.bodyHtml } : {}),
      attachments: snapshot.attachments,
      updatedAt: now,
      syncState: 'pending',
      source: 'manual',
      draftKind: 'manual',
      provenance: ['Created from Compose.'],
    }
    return {
      draftId,
      threadId,
      nextStore: {
        ...current,
        threads: [thread, ...current.threads],
        drafts: [...current.drafts, draft],
      },
    }
  }

  /**
   * The reply analogue of createComposeDraftStore: writes the window state
   * into a draft ON THE ANSWERED THREAD (updating the draft the window was
   * opened on, if any) instead of minting a new thread. The collapsed quote
   * is folded into the stored body — collapsing hides words, never drops
   * them.
   */
  const createContextDraftStore = (
    current: MailStore,
    context: ComposeReplyContext,
    snapshot: ComposeSendSnapshot = {
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      body: composeBody,
      bodyHtml: composeBodyHtml,
      attachments: composeAttachments,
    },
    newDraftId?: string,
  ): { nextStore: MailStore; draftId: string; threadId: string } => {
    const result = upsertReplyDraft(current, {
      context,
      to: parseComposeRecipients(snapshot.to),
      cc: parseComposeRecipients(snapshot.cc),
      bcc: parseComposeRecipients(snapshot.bcc),
      subject: snapshot.subject,
      body: bodyWithQuote(snapshot.body, composeQuote),
      bodyHtml: snapshot.bodyHtml
        ? bodyHtmlWithQuote(snapshot.bodyHtml, composeQuote)
        : composeQuote
          ? bodyHtmlWithQuote('', composeQuote)
          : '',
      attachments: snapshot.attachments,
      ...(newDraftId ? { newDraftId } : {}),
    })
    return {
      nextStore: result.store,
      draftId: result.draftId,
      threadId: context.threadId,
    }
  }

  const saveComposeDraft = (): void => {
    if (!canSaveCompose) return
    if (composeContext) {
      // A reply/forward (or reopened draft) saves back onto its own thread
      // through the one reply-draft path — never as a new compose thread.
      const context = composeContext
      const newDraftId = createComposeId(
        context.kind === 'forward' ? 'draft_forward' : 'draft_reply',
      )
      setStore(
        current =>
          createContextDraftStore(current, context, undefined, newDraftId)
            .nextStore,
      )
      resetCompose()
      setComposeOpen(false)
      setCommandNotice('Draft saved.')
      return
    }
    const ids = {
      draftId: createComposeId('draft_compose'),
      threadId: createComposeId('thread_compose'),
    }
    setStore(current => createComposeDraftStore(current, undefined, ids).nextStore)
    setSelectedThreadId(ids.threadId)
    resetCompose()
    setComposeOpen(false)
    // The provider copy is made by useDraftProviderSync, which watches every
    // draft in the store. Creating it here as well raced that hook and could
    // leave two Gmail drafts for one local one.
    setCommandNotice('Draft saved.')
  }

  const recordComposeSend = (subject: string): void => {
    void recordOperation({
      lane: 'user',
      kind: 'mail.compose.send',
      appSlug: 'mail',
      summary: `Sent "${subject.trim() || '(no subject)'}" from Compose.`,
    })
  }

  const recordReplySend = (subject: string): void => {
    void recordOperation({
      lane: 'user',
      kind: 'mail.reply.send',
      appSlug: 'mail',
      summary: `Sent "${
        subject.trim() || '(no subject)'
      }" from the compose window.`,
    })
  }

  /**
   * The threaded send: the window's state becomes (or updates) a draft on
   * the answered thread and goes out through the SAME machinery the reply
   * composer always used — provider.send({ draft, threadId }) so the
   * provider threads it (In-Reply-To/References server-side), sendDraft for
   * the local sent copy. Compose's new-thread path is never involved.
   */
  const sendContextReply = (
    context: ComposeReplyContext,
    snapshot: ComposeSendSnapshot,
  ): void => {
    const pendingId = `pending_reply_${Date.now()}`
    const sentLabel = context.kind === 'forward' ? 'Forward' : 'Reply'
    schedulePendingSend(
      {
        id: pendingId,
        target: 'compose',
        label: sentLabel,
      },
      () => {
        const newDraftId = createComposeId(
          context.kind === 'forward' ? 'draft_forward' : 'draft_reply',
        )
        const result = createContextDraftStore(
          storeRef.current,
          context,
          snapshot,
          newDraftId,
        )
        const draft = result.nextStore.drafts.find(
          item => item.id === result.draftId,
        )
        if (!draft) return
        const provider =
          activeProvider !== 'demo' ? mailProviderRef.current : undefined
        const home = providerName(activeProvider)
        if (provider) {
          setStore(() => result.nextStore)
          markDraftSending(result.draftId, true)
          resetCompose()
          setComposeOpen(false)
          setCommandNotice(`Sending through ${home}…`)
          void provider
            .send({ draft, threadId: draft.threadId })
            .then(message => {
              setStore(current =>
                sendDraft(current, result.draftId, undefined, {
                  // Append the sent copy locally so the reply is visible in
                  // the thread immediately; the next sync replaces it with
                  // the server's copy (no duplicate).
                  appendMessage: true,
                  keepDraft: false,
                  sentMessageId: message.gmailMessageId ?? message.id,
                  sentGmailMessageId: message.gmailMessageId,
                }),
              )
              setSelectedThreadId(result.threadId)
              setCommandNotice(`${sentLabel} sent through ${home}.`)
              recordReplySend(snapshot.subject)
            })
            .catch(error => {
              setCommandNotice(
                error instanceof Error
                  ? `Could not send through ${home} — the draft is saved on the thread. (${error.message})`
                  : `Could not send through ${home} — the draft is saved on the thread.`,
              )
            })
            .finally(() => markDraftSending(result.draftId, false))
          return
        }
        if (activeProvider !== 'demo') {
          // A real account whose provider is not ready — never fake a send.
          setStore(() => result.nextStore)
          resetCompose()
          setComposeOpen(false)
          setCommandNotice(
            `${home} is not connected right now — your ${sentLabel.toLowerCase()} was saved as a draft, not sent.`,
          )
          return
        }
        // Local/demo account: the local send is the source of truth. The
        // appended copy is confirmed by construction, so strip the
        // optimistic marker sendDraft stamps on provider-unconfirmed sends
        // — a local send has no server to wait for.
        setStore(() => {
          const sent = sendDraft(result.nextStore, result.draftId)
          return {
            ...sent,
            messages: sent.messages.map(message => {
              if (!message.id.startsWith(`msg_sent_${result.draftId}_`)) {
                return message
              }
              const { optimistic: _optimistic, ...confirmed } = message
              return confirmed
            }),
          }
        })
        setSelectedThreadId(result.threadId)
        resetCompose()
        setComposeOpen(false)
        setCommandNotice(
          `${sentLabel} sent. Attachments were included.`,
        )
        recordReplySend(snapshot.subject)
      },
    )
  }

  const scheduleComposeSend = (sendAt: string): void => {
    if (!subjectReminderOpen && !composeSubject.trim()) {
      pendingSubjectActionRef.current = () => scheduleComposeSend(sendAt)
      setSubjectReminderOpen(true)
      setScheduleMenuOpen(false)
      return
    }
    setSubjectReminderOpen(false)
    pendingSubjectActionRef.current = null
    if (!canSendCompose) return
    const sendAtMs = Date.parse(sendAt)
    if (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now()) {
      setCommandNotice('Pick a future time for the scheduled send.')
      return
    }
    const sendAtIso = new Date(sendAtMs).toISOString()
    const subject = composeSubject.trim() || '(no subject)'
    const context = composeContext
    const contextNewDraftId = context
      ? createComposeId(
          context.kind === 'forward' ? 'draft_forward' : 'draft_reply',
        )
      : null
    setStore(current => {
      // A reply schedules ITS thread's draft; only plain compose mints a
      // new thread for the scheduled message.
      const result =
        context && contextNewDraftId
          ? createContextDraftStore(
              current,
              context,
              undefined,
              contextNewDraftId,
            )
          : createComposeDraftStore(current)
      return scheduleSend(result.nextStore, {
        draftId: result.draftId,
        threadId: result.threadId,
        sendAt: sendAtIso,
      })
    })
    resetCompose()
    setComposeOpen(false)
    setScheduleMenuOpen(false)
    setCommandNotice(
      `"${subject}" scheduled. It sends while PureMail is open; if the app is closed it sends on next launch.`,
    )
    void recordOperation({
      lane: 'user',
      kind: 'mail.compose.schedule',
      appSlug: 'mail',
      summary: `Scheduled "${subject}" to send later.`,
    })
  }

  const schedulePresets = (): Array<{ label: string; at: string }> => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    const monday = new Date()
    monday.setDate(monday.getDate() + (((8 - monday.getDay()) % 7) || 7))
    monday.setHours(9, 0, 0, 0)
    return [
      { label: 'Tomorrow 9:00', at: tomorrow.toISOString() },
      { label: 'Monday 9:00', at: monday.toISOString() },
    ]
  }

  const sendComposeMessage = (): void => {
    if (pendingSend?.target === 'compose') {
      undoPendingSend(pendingSend.id)
      return
    }
    if (!canSendCompose) return
    // Subject reminder: "(no subject)" in someone's inbox is almost always
    // an accident — ask once, inline, before the message leaves.
    if (!subjectReminderOpen && !composeSubject.trim()) {
      pendingSubjectActionRef.current = sendComposeMessage
      setSubjectReminderOpen(true)
      return
    }
    setSubjectReminderOpen(false)
    pendingSubjectActionRef.current = null
    // Attachment reminder: the body talks about an attachment but none is
    // present — ask once, inline, before the message leaves.
    if (
      !attachmentReminderOpen &&
      composeAttachments.length === 0 &&
      bodyMentionsAttachment(composeBody)
    ) {
      setAttachmentReminderOpen(true)
      return
    }
    setAttachmentReminderOpen(false)
    const snapshot: ComposeSendSnapshot = {
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      body: composeBody,
      bodyHtml: composeBodyHtml,
      attachments: composeAttachments,
    }
    if (runChrome?.mode === 'item' && composeContext) {
      // Send & next: the card's fields are written into ITS draft (in
      // place, same id) and the shell sends that draft through the one
      // store-draft send path — the same one the sendRunItem tool uses.
      const context = composeContext
      const result = createContextDraftStore(storeRef.current, context, snapshot)
      const draft = result.nextStore.drafts.find(item => item.id === result.draftId)
      if (!draft) return
      setStore(current => createContextDraftStore(current, context, snapshot).nextStore)
      runChrome.onSend?.(draft)
      return
    }
    if (composeContext) {
      // A reply/forward goes out threaded on the conversation it answers —
      // the compose path below creates a NEW thread and must never carry it.
      sendContextReply(composeContext, snapshot)
      return
    }
    const pendingId = `pending_compose_${Date.now()}`
    schedulePendingSend(
      {
        id: pendingId,
        target: 'compose',
        label: 'Message',
      },
      () => {
        const provider =
          activeProvider !== 'demo' ? mailProviderRef.current : undefined
        if (provider) {
          // Compose must actually send through the provider — the local-only
          // path showed "Message sent." while the mail never left the machine.
          const result = createComposeDraftStore(storeRef.current, snapshot)
          const draft = result.nextStore.drafts.find(
            item => item.id === result.draftId,
          )
          if (!draft) return
          setStore(() => result.nextStore)
          markDraftSending(result.draftId, true)
          resetCompose()
          setComposeOpen(false)
          setCommandNotice('Sending through Gmail…')
          void provider
            .send({ draft, threadId: draft.threadId })
            .then(message => {
              let sentMailboxId = ''
              setStore(current => {
                const sentStore = sendDraft(current, result.draftId, undefined, {
                  appendMessage: true,
                  keepDraft: false,
                  sentMessageId: message.gmailMessageId ?? message.id,
                  // Stamp the confirmed Gmail id so this appended copy is real
                  // sent history and dedups against the synced message —
                  // instead of lingering as an unconfirmed phantom.
                  sentGmailMessageId: message.gmailMessageId,
                })
                sentMailboxId = mailboxIdForRole('sent', sentStore)
                return {
                  ...sentStore,
                  threads: sentStore.threads.map(thread =>
                    thread.id === result.threadId && sentMailboxId
                      ? { ...thread, mailboxId: sentMailboxId }
                      : thread,
                  ),
                }
              })
              setSelectedMailboxId(sentMailboxId)
              setSelectedThreadId(result.threadId)
              setCommandNotice('Message sent through Gmail.')
              recordComposeSend(snapshot.subject)
            })
            .catch(error => {
              setCommandNotice(
                error instanceof Error
                  ? `Could not send through Gmail — the draft is saved in Drafts. (${error.message})`
                  : 'Could not send through Gmail — the draft is saved in Drafts.',
              )
            })
            .finally(() => markDraftSending(result.draftId, false))
          return
        }
        if (activeProvider !== 'demo') {
          // A real account whose provider is not ready — NEVER fake a send.
          // Save the message as a draft and say so, rather than claiming
          // "Message sent." for mail that never left the machine (the phantom
          // trust bug). The user can send it once the account reconnects.
          let draftThreadId = ''
          setStore(current => {
            const result = createComposeDraftStore(current, snapshot)
            draftThreadId = result.threadId
            return result.nextStore
          })
          setSelectedThreadId(draftThreadId)
          resetCompose()
          setComposeOpen(false)
          setCommandNotice(
            `${providerName(activeProvider)} is not connected right now — your message was saved to Drafts, not sent.`,
          )
          return
        }
        // Local/demo account: a local send is the source of truth here.
        let threadId = ''
        let sentMailboxId = ''
        setStore(current => {
          const result = createComposeDraftStore(current, snapshot)
          threadId = result.threadId
          const sentStore = sendDraft(result.nextStore, result.draftId)
          sentMailboxId = mailboxIdForRole('sent', sentStore)
          return {
            ...sentStore,
            threads: sentStore.threads.map(thread =>
              thread.id === threadId && sentMailboxId
                ? { ...thread, mailboxId: sentMailboxId }
                : thread,
            ),
          }
        })
        setSelectedMailboxId(sentMailboxId)
        setSelectedThreadId(threadId)
        resetCompose()
        setComposeOpen(false)
        setCommandNotice('Message sent. Attachments were included.')
        recordComposeSend(snapshot.subject)
      },
    )
  }

  const attachComposeFiles = async (
    files: FileList | File[] | null,
  ): Promise<void> => {
    if (!files?.length) return
    try {
      const attachments = await Promise.all(
        Array.from(files).map(fileToAttachment),
      )
      const status = attachmentSizeStatus([
        ...composeAttachments,
        ...attachments,
      ])
      setComposeAttachments(current => [...current, ...attachments])
      setCommandNotice(
        status.overLimit
          ? `Attachments total ${status.totalLabel} — over the ${status.limitLabel} sending limit. Remove some before sending.`
          : status.nearLimit
            ? `${attachments.length} attachment${
                attachments.length === 1 ? '' : 's'
              } added — ${status.totalLabel} of ${status.limitLabel} used.`
            : `${attachments.length} attachment${
                attachments.length === 1 ? '' : 's'
              } added to compose.`,
      )
    } catch (error) {
      setCommandNotice(
        error instanceof Error ? error.message : 'Could not attach files.',
      )
    }
  }

  const removeComposeAttachment = (attachmentId: string): void => {
    const attachment=composeAttachments.find(a=>a.id===attachmentId)
    if(attachment?.content && editorRef.current){
      for(const media of editorRef.current.querySelectorAll('img,video,audio'))if(media.getAttribute('src')===attachment.content)media.remove()
      for(const p of editorRef.current.querySelectorAll('p'))if(p.textContent===`Attached video: ${attachment.name}` || p.textContent===`Attached audio: ${attachment.name}`)p.remove()
      syncBodyFromEditor()
    }

    setComposeAttachments(current =>
      current.filter(attachment => attachment.id !== attachmentId),
    )
    setCommandNotice('Attachment removed from compose.')
  }

  const handleComposeAttachmentDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setComposeDropActive(false)
    const files = Array.from(event.dataTransfer.files)
    const editor=editorRef.current
    const hit=document.elementFromPoint(event.clientX,event.clientY)
    if(editor && hit && editor.contains(hit)){
      const doc=document as Document & {caretRangeFromPoint?:(x:number,y:number)=>Range|null}
      const range=doc.caretRangeFromPoint?.(event.clientX,event.clientY) || document.createRange()
      if(!editor.contains(range.startContainer)){range.selectNodeContents(editor);range.collapse(false)}
      if(files.length){
        void (async()=>{for(const file of files){const a=await fileToAttachment(file);await applyMailDrop(JSON.stringify({version:1,kind:'file',name:a.name,dataUrl:a.content}),range)}})().catch(error=>setCommandNotice(String(error)))
        return
      }
      const url=event.dataTransfer.getData('text/uri-list').split('\n').find(line=>/^https?:\/\//i.test(line))
      if(url){void applyMailDrop(JSON.stringify({version:1,kind:'webpage',reference:{id:'',type:'webpage',title:event.dataTransfer.getData('text/plain') || url,url,authors:[]}}),range).catch(error=>setCommandNotice(String(error)));return}
    }
    if (files.length)void attachComposeFiles(files)
  }

  // Pasting a screenshot (or copied files) anywhere in the compose surface
  // attaches it — matching what mail clients do with clipboard images.
  const handleComposePaste = (event: ClipboardEvent<HTMLElement>): void => {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (!files.length) return
    event.preventDefault()
    void attachComposeFiles(files.map(namedClipboardFile))
  }

  // ── Docked small-window chrome ───────────────────────────────────────

  /**
   * A reply whose body is still exactly what opening seeded (nothing, or
   * the default signature) and that carries no attachments. Closing one
   * quietly discards instead of littering Drafts — the Re:-prefilled
   * subject alone is not work worth keeping. A window opened on an
   * existing store draft is never "untouched": that draft already exists
   * and closing keeps it current.
   */
  const contextComposeUntouched = ((): boolean => {
    if (!composeContext) return false
    if (composeContext.draftId) return false
    if (composeAttachments.length > 0) return false
    const body = composeBody.trim()
    if (!body) return true
    const signature = defaultSignatureForAccount(
      store.settings,
      selectedAccount?.id,
    )
    return Boolean(signature) && body === signature!.body.trim()
  })()

  /**
   * Closing the window keeps the work: a non-empty compose is saved to
   * Drafts through the one existing draft path; an empty one (or an
   * untouched reply) just closes.
   */
  const closeKeepingDraft = (): void => {
    if (contextComposeUntouched) {
      resetCompose()
      setComposeOpen(false)
      return
    }
    if (canSaveCompose) {
      saveComposeDraft()
      return
    }
    setComposeOpen(false)
  }

  /** First click arms; the second (within the grace window) discards. */
  const handleDiscardClick = (): void => {
    if (canSaveCompose && !contextComposeUntouched && !discardArmed) {
      setDiscardArmed(true)
      return
    }
    const contextDraftId = composeContext?.draftId ?? null
    resetCompose()
    setComposeOpen(false)
    if (contextDraftId) {
      // The window was editing a store draft — discard that too, through
      // the shell's one draft-discard path (it posts its own notice).
      discardContextDraft(contextDraftId)
      return
    }
    setCommandNotice('Draft discarded.')
  }

  const handleDockKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      // The run screen listens for ⌘⏎ too; the card answers first.
      event.stopPropagation()
      if (runChrome?.mode === 'template') {
        if (!runChrome.renderDisabled) runChrome.onRender?.()
        return
      }
      sendComposeMessage()
      return
    }
    if (event.key !== 'Escape') return
    event.stopPropagation()
    const hasOpenLayer =
      scheduleMenuOpen || signatureMenuOpen || linkUrlDraft !== null || fieldMenuOpen
    const action = composeEscapeAction('docked', hasOpenLayer)
    if (action === 'close-menus') {
      setScheduleMenuOpen(false)
      setSignatureMenuOpen(false)
      setLinkUrlDraft(null)
      setFieldMenuOpen(false)
      return
    }
    // The run card has nothing to minimize into.
    if (variant === 'run') return
    // The recipient-suggestion listbox closes itself on this same press;
    // it is still in the DOM at bubble time, so its presence means this
    // Escape belonged to it — the next one minimizes.
    if (event.currentTarget.querySelector('[role="listbox"]')) return
    if (action === 'minimize') onMinimize?.()
  }

  const dockTitle =
    composeSubject.trim() ||
    (composeContext
      ? composeContext.kind === 'forward'
        ? 'Forward'
        : 'Reply'
      : 'New message')

  /**
   * The 28px context strip under the title bar: what this window answers,
   * with text-link switches to the other reply types. Switching re-derives
   * recipients and the subject prefix (shell-side); the user's body is
   * never touched by a switch.
   */
  const composeContextStrip = replyStripVisible ? (
    <ComposeContextStrip aria-label="Reply context">
      {composeContext?.kind === 'forward' ? (
        <Forward aria-hidden="true" />
      ) : composeContext?.kind === 'replyAll' ? (
        <ReplyAll aria-hidden="true" />
      ) : (
        <Reply aria-hidden="true" />
      )}
      <ComposeContextText>
        {contextKindLine} <strong>{contextSenderName}</strong> ·{' '}
        {contextTimeLabel}
      </ComposeContextText>
      <ComposeContextSpacer />
      {contextKindSwitches.map(item => (
        <ComposeContextLink
          key={item.kind}
          type="button"
          onClick={() => switchComposeReplyKind(item.kind)}
        >
          {item.label}
        </ComposeContextLink>
      ))}
    </ComposeContextStrip>
  ) : null

  /**
   * The collapsed quoted history: a chip at the end of the body. Expanding
   * puts the quote into the editor (sanitized) for trimming; collapsed, it
   * is still included on send.
   */
  const composeQuoteChip = composeQuote ? (
    <ComposeQuoteChipRow>
      <ComposeQuoteChip
        type="button"
        aria-expanded={false}
        aria-label={`Expand quoted history, ${composeQuote.count} message${
          composeQuote.count === 1 ? '' : 's'
        }`}
        onClick={expandComposeQuote}
      >
        <MoreHorizontal aria-hidden="true" />
        Quoted history · {composeQuote.count} message
        {composeQuote.count === 1 ? '' : 's'}
      </ComposeQuoteChip>
    </ComposeQuoteChipRow>
  ) : null

  const scheduleMenuItems = (
    <>
      {schedulePresets().map(preset => (
        <BulkMenuItem
          key={preset.label}
          type="button"
          role="menuitem"
          onClick={() => scheduleComposeSend(preset.at)}
        >
          <Clock aria-hidden="true" />
          {preset.label}
        </BulkMenuItem>
      ))}
      <BulkMenuItem as="div" role="none" style={{ cursor: 'default' }}>
        <input
          type="datetime-local"
          value={scheduleAtDraft}
          aria-label="Custom send time"
          style={{
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
          }}
          onClick={event => event.stopPropagation()}
          onChange={event => setScheduleAtDraft(event.currentTarget.value)}
        />
        <Button
          size="sm"
          disabled={!scheduleAtDraft}
          onClick={() => scheduleComposeSend(scheduleAtDraft)}
        >
          Schedule
        </Button>
      </BulkMenuItem>
    </>
  )

  if (variant === 'docked' || variant === 'run') {
    const isRun = variant === 'run'
    const runMode = runChrome?.mode ?? null
    return (
      <>
        {!isRun && dockMinimized && (
          <ComposeMinimizedStrip aria-label="Minimized compose window">
            <ComposeMinimizedTitle
              type="button"
              title={dockTitle}
              onClick={() => onRestore?.()}
            >
              {dockTitle}
            </ComposeMinimizedTitle>
            <ComposeMinimizedButton
              type="button"
              aria-label="Restore"
              onClick={() => onRestore?.()}
            >
              <ChevronUp aria-hidden="true" />
            </ComposeMinimizedButton>
            <ComposeMinimizedButton
              type="button"
              aria-label="Close"
              onClick={closeKeepingDraft}
            >
              <X aria-hidden="true" />
            </ComposeMinimizedButton>
          </ComposeMinimizedStrip>
        )}
        {/* The window stays mounted while minimized (display: none) so the
            uncontrolled rich-text body keeps its DOM — restore is instant
            and loses nothing. */}
        <ComposeDockWindow
          aria-label={
            runMode === 'item'
              ? 'Run draft'
              : runMode === 'template'
                ? 'Run template'
                : 'Compose window'
          }
          data-puremail-compose-dock
          $dropActive={composeDropActive}
          $inline={isRun}
          style={!isRun && dockMinimized ? { display: 'none' } : undefined}
          onKeyDown={handleDockKeyDown}
          onDragEnter={event => {
            event.preventDefault()
            setComposeDropActive(true)
          }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={event => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return
            }
            setComposeDropActive(false)
          }}
          onDrop={handleComposeAttachmentDrop}
          onPaste={handleComposePaste}
        >
          {isRun && runChrome ? (
            <ComposeDockTitleBar>
              <ComposeDockTitle
                title={runChrome.title}
                style={{ flex: 'none' }}
              >
                {runChrome.title}
              </ComposeDockTitle>
              {runChrome.meta && (
                <ComposeDockTitleMeta title={runChrome.meta}>
                  {runChrome.meta}
                </ComposeDockTitleMeta>
              )}
              <ComposeDockTitleSpacer />
              {runChrome.hint && (
                <ComposeDockTitleHint aria-hidden="true">
                  {runChrome.hint}
                </ComposeDockTitleHint>
              )}
            </ComposeDockTitleBar>
          ) : (
            <ComposeDockTitleBar>
              <ComposeDockTitle title={dockTitle}>{dockTitle}</ComposeDockTitle>
              <ComposeDockWinButton
                type="button"
                aria-label="Minimize"
                onClick={() => onMinimize?.()}
              >
                <Minus aria-hidden="true" />
              </ComposeDockWinButton>
              <ComposeDockWinButton
                type="button"
                aria-label="Open full screen"
                onClick={() => onExpand?.()}
              >
                <Maximize2 aria-hidden="true" />
              </ComposeDockWinButton>
              <ComposeDockWinButton
                type="button"
                aria-label="Close"
                onClick={closeKeepingDraft}
              >
                <X aria-hidden="true" />
              </ComposeDockWinButton>
            </ComposeDockTitleBar>
          )}

          {!isRun && composeContextStrip}

          {runMode === 'template' ? (
            <ComposeDockRow>
              <ComposeDockRowLabel>To</ComposeDockRowLabel>
              <ComposeTemplateToChip title="Each draft goes to its row's email address">
                {'{{email}}'}
                <span>from list</span>
              </ComposeTemplateToChip>
              <ComposeDockCcBccToggle
                type="button"
                aria-expanded={composeCcBccOpen}
                onClick={() => setComposeCcBccOpen(open => !open)}
              >
                {composeCcBccOpen ? 'Hide Cc Bcc' : 'Cc Bcc'}
              </ComposeDockCcBccToggle>
            </ComposeDockRow>
          ) : (
            <ComposeDockRow>
              <ComposeDockRowLabel>To</ComposeDockRowLabel>
              <ComposeDockRecipients>
                <RecipientChipsInput
                  inputRef={composeToRef}
                  value={composeTo}
                  onChange={setComposeTo}
                  store={store}
                  accountId={selectedAccount?.id}
                  ariaLabel="To recipients"
                  placeholder="name@example.com, Name <name@example.com>"
                />
              </ComposeDockRecipients>
              {runChrome?.toMeta && (
                <ComposeDockRowMeta>{runChrome.toMeta}</ComposeDockRowMeta>
              )}
              <ComposeDockCcBccToggle
                type="button"
                aria-expanded={composeCcBccOpen}
                onClick={() => setComposeCcBccOpen(open => !open)}
              >
                {composeCcBccOpen ? 'Hide Cc Bcc' : 'Cc Bcc'}
              </ComposeDockCcBccToggle>
            </ComposeDockRow>
          )}
          {composeCcBccOpen && (
            <>
              <ComposeDockRow>
                <ComposeDockRowLabel>Cc</ComposeDockRowLabel>
                <ComposeDockRecipients>
                  <RecipientChipsInput
                    value={composeCc}
                    onChange={setComposeCc}
                    store={store}
                    accountId={selectedAccount?.id}
                    ariaLabel="Cc recipients"
                    placeholder="cc@example.com"
                  />
                </ComposeDockRecipients>
              </ComposeDockRow>
              <ComposeDockRow>
                <ComposeDockRowLabel>Bcc</ComposeDockRowLabel>
                <ComposeDockRecipients>
                  <RecipientChipsInput
                    value={composeBcc}
                    onChange={setComposeBcc}
                    store={store}
                    accountId={selectedAccount?.id}
                    ariaLabel="Bcc recipients"
                    placeholder="bcc@example.com"
                  />
                </ComposeDockRecipients>
              </ComposeDockRow>
            </>
          )}
          <ComposeDockRow>
            <ComposeDockSubjectInput
              ref={subjectInputRef}
              value={composeSubject}
              aria-label="Subject"
              placeholder="Subject"
              onChange={event => {
                setComposeSubject(event.currentTarget.value)
                if (event.currentTarget.value.trim()) {
                  setSubjectReminderOpen(false)
                }
              }}
            />
          </ComposeDockRow>

          <ComposeDockEditor
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Message body"
            data-run-mode={runMode ?? undefined}
            data-placeholder={
              runMode === 'template'
                ? 'Write the template. Insert field adds {{first_name}}-style tokens; Insert note slot marks the per-recipient line.'
                : composeContext
                  ? 'Write your reply...'
                  : 'Write your message, or drop citations, images, videos, PDFs and contacts here…'
            }
            onInput={handleEditorInput}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleRichPaste}
          />

          {!isRun && composeQuoteChip}

          {(composeAttachments.length > 0 || composeDropActive) && (
            <ComposeDockAttachmentRow aria-label="Compose attachments">
              {composeAttachments.map(attachment => (
                <ComposeDockAttachmentChip key={attachment.id}>
                  <FileText aria-hidden="true" />
                  <ComposeDockAttachmentName title={attachment.name}>
                    {attachment.name}
                  </ComposeDockAttachmentName>
                  <ComposeDockAttachmentMeta>
                    {attachmentDisplaySize(attachment)}
                  </ComposeDockAttachmentMeta>
                  <ComposeDockAttachmentRemove
                    type="button"
                    aria-label={`Remove attachment ${attachment.name}`}
                    onClick={() => removeComposeAttachment(attachment.id)}
                  >
                    <X aria-hidden="true" />
                  </ComposeDockAttachmentRemove>
                </ComposeDockAttachmentChip>
              ))}
              {composeDropActive && (
                <AttachmentDropHint>Drop files to attach.</AttachmentDropHint>
              )}
              {composeAttachments.length > 0 && (
                <AttachmentSizeNotice
                  $tone={
                    composeSizeStatus.overLimit
                      ? 'danger'
                      : composeSizeStatus.nearLimit
                        ? 'warning'
                        : 'neutral'
                  }
                  role={composeSizeStatus.overLimit ? 'alert' : undefined}
                >
                  {runChrome?.attachmentNote ? `${runChrome.attachmentNote} · ` : ''}
                  {composeSizeStatus.overLimit
                    ? `${composeSizeStatus.totalLabel} — over the ${composeSizeStatus.limitLabel} limit`
                    : `${composeSizeStatus.totalLabel} of ${composeSizeStatus.limitLabel}`}
                </AttachmentSizeNotice>
              )}
            </ComposeDockAttachmentRow>
          )}

          {(invalidComposeRecipients.length > 0 ||
            subjectReminderOpen ||
            attachmentReminderOpen ||
            linkUrlDraft !== null) && (
            <ComposeDockNotices>
              {linkUrlDraft !== null && (
                <ComposeInlineRow>
                  <ComposeInput
                    value={linkUrlDraft}
                    onChange={event =>
                      setLinkUrlDraft(event.currentTarget.value)
                    }
                    placeholder="https://example.com"
                    aria-label="Link address"
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      const url = linkUrlDraft.trim()
                      if (/^https?:\/\//i.test(url)) {
                        execEditorCommand('createLink', url)
                      }
                      setLinkUrlDraft(null)
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const url = linkUrlDraft.trim()
                      if (/^https?:\/\//i.test(url)) {
                        execEditorCommand('createLink', url)
                      }
                      setLinkUrlDraft(null)
                    }}
                  >
                    Link
                  </Button>
                  <Button size="sm" onClick={() => setLinkUrlDraft(null)}>
                    Cancel
                  </Button>
                </ComposeInlineRow>
              )}
              {invalidComposeRecipients.length > 0 && (
                <ComposeInlineNotice $tone="warning" role="alert">
                  {invalidComposeRecipients.length === 1
                    ? `"${invalidComposeRecipients[0]?.email}" is not a valid email address — fix it to send.`
                    : `${invalidComposeRecipients.length} recipients are not valid email addresses — fix them to send.`}
                </ComposeInlineNotice>
              )}
              {subjectReminderOpen && (
                <ComposeInlineNotice
                  $tone="warning"
                  role="alertdialog"
                  aria-label="Missing subject reminder"
                >
                  This message has no subject.
                  <Button
                    size="sm"
                    onClick={() => {
                      setSubjectReminderOpen(false)
                      pendingSubjectActionRef.current = null
                      subjectInputRef.current?.focus()
                    }}
                  >
                    Add subject
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const action =
                        pendingSubjectActionRef.current ?? sendComposeMessage
                      pendingSubjectActionRef.current = null
                      action()
                    }}
                  >
                    Send anyway
                  </Button>
                </ComposeInlineNotice>
              )}
              {attachmentReminderOpen && (
                <ComposeInlineNotice
                  $tone="warning"
                  role="alertdialog"
                  aria-label="Attachment reminder"
                >
                  The message mentions an attachment, but nothing is attached.
                  <Button size="sm" onClick={sendComposeMessage}>
                    Send anyway
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setAttachmentReminderOpen(false)}
                  >
                    Keep editing
                  </Button>
                </ComposeInlineNotice>
              )}
            </ComposeDockNotices>
          )}

          <ComposeDockToolbar role="toolbar" aria-label="Text formatting">
            <ComposeDockToolbarButton
              type="button"
              aria-label="Bold"
              aria-pressed={inlineFormats.bold}
              $active={inlineFormats.bold}
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('bold')}
            >
              <Bold aria-hidden="true" />
            </ComposeDockToolbarButton>
            <ComposeDockToolbarButton
              type="button"
              aria-label="Italic"
              aria-pressed={inlineFormats.italic}
              $active={inlineFormats.italic}
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('italic')}
            >
              <Italic aria-hidden="true" />
            </ComposeDockToolbarButton>
            <ComposeDockToolbarButton
              type="button"
              aria-label="Underline"
              aria-pressed={inlineFormats.underline}
              $active={inlineFormats.underline}
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('underline')}
            >
              <Underline aria-hidden="true" />
            </ComposeDockToolbarButton>
            <ComposeDockToolbarDivider aria-hidden="true" />
            <ComposeDockToolbarButton
              type="button"
              aria-label="Bulleted list"
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('insertUnorderedList')}
            >
              <List aria-hidden="true" />
            </ComposeDockToolbarButton>
            <ComposeDockToolbarButton
              type="button"
              aria-label="Numbered list"
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('insertOrderedList')}
            >
              <ListOrdered aria-hidden="true" />
            </ComposeDockToolbarButton>
            <ComposeDockToolbarButton
              type="button"
              aria-label="Insert link"
              aria-expanded={linkUrlDraft !== null}
              onMouseDown={event => event.preventDefault()}
              onClick={() =>
                setLinkUrlDraft(current => (current === null ? '' : null))
              }
            >
              <Link2 aria-hidden="true" />
            </ComposeDockToolbarButton>
            {runMode === 'template' && runChrome && (
              <>
                <ComposeDockToolbarDivider aria-hidden="true" />
                <BulkMenuWrap ref={fieldMenuWrapRef}>
                  <ComposeDockToolbarTextButton
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={fieldMenuOpen}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setFieldMenuOpen(open => !open)}
                  >
                    <Braces aria-hidden="true" />
                    Insert field
                    <ChevronDown aria-hidden="true" />
                  </ComposeDockToolbarTextButton>
                  {fieldMenuOpen && (
                    <ComposeDockMenu role="menu" aria-label="Insert field">
                      {(runChrome.tokens ?? []).length === 0 && (
                        <BulkMenuItem type="button" disabled>
                          Attach a recipient list to get fields
                        </BulkMenuItem>
                      )}
                      {(runChrome.tokens ?? []).map(token => (
                        <BulkMenuItem
                          key={token}
                          type="button"
                          role="menuitem"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => {
                            setFieldMenuOpen(false)
                            insertHtmlAtCaret(`{{${token}}}`)
                          }}
                        >
                          <Braces aria-hidden="true" />
                          {`{{${token}}}`}
                        </BulkMenuItem>
                      ))}
                    </ComposeDockMenu>
                  )}
                </BulkMenuWrap>
                <ComposeDockToolbarTextButton
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() =>
                    insertHtmlAtCaret(`${templateNoteSlotHtml()}<p><br></p>`)
                  }
                >
                  Insert note slot
                </ComposeDockToolbarTextButton>
              </>
            )}
          </ComposeDockToolbar>

          {runMode === 'item' && runChrome ? (
            <ComposeDockFooter>
              <ComposeDockSendButton
                type="button"
                disabled={!canSendCompose && !composeSendPending}
                onClick={() =>
                  composeSendPending
                    ? runChrome.onUndoSend?.()
                    : sendComposeMessage()
                }
              >
                {composeSendPending ? (
                  <PendingSendLabel>Sent · Undo</PendingSendLabel>
                ) : (
                  <>
                    Send &amp; next
                    <Send aria-hidden="true" />
                  </>
                )}
              </ComposeDockSendButton>
              <KbdChip>⌘⏎</KbdChip>
              <ComposeDockSecondaryButton
                type="button"
                disabled={runChrome.canSkip === false}
                onClick={() => runChrome.onSkip?.()}
              >
                <SkipForward aria-hidden="true" size={12} />
                Skip <KbdChip>⌘→</KbdChip>
              </ComposeDockSecondaryButton>
              <ComposeDockIconButton
                type="button"
                aria-label="Attach files"
                onClick={() => {
                  if (typeof document !== 'undefined') {
                    document
                      .getElementById(`puremail-compose-attachments-${variant}`)
                      ?.click()
                  }
                }}
              >
                <Paperclip aria-hidden="true" />
              </ComposeDockIconButton>
              <ComposeDockFooterSpacer />
              {runChrome.footerNote && (
                <ComposeDockFooterNote>{runChrome.footerNote}</ComposeDockFooterNote>
              )}
            </ComposeDockFooter>
          ) : runMode === 'template' && runChrome ? (
            <ComposeDockFooter>
              <ComposeDockSendButton
                type="button"
                disabled={runChrome.renderDisabled}
                onClick={() => runChrome.onRender?.()}
              >
                {runChrome.renderLabel ?? 'Render drafts'}
                <ChevronDown aria-hidden="true" style={{ transform: 'rotate(-90deg)' }} />
              </ComposeDockSendButton>
              {runChrome.renderNote && (
                <ComposeDockFooterNote>{runChrome.renderNote}</ComposeDockFooterNote>
              )}
              <ComposeDockIconButton
                type="button"
                aria-label="Attach files"
                onClick={() => {
                  if (typeof document !== 'undefined') {
                    document
                      .getElementById(`puremail-compose-attachments-${variant}`)
                      ?.click()
                  }
                }}
              >
                <Paperclip aria-hidden="true" />
              </ComposeDockIconButton>
              <ComposeDockFooterSpacer />
              {runChrome.onPreview && (
                <ComposeDockSecondaryButton
                  type="button"
                  disabled={runChrome.renderDisabled}
                  onClick={() => runChrome.onPreview?.()}
                >
                  {runChrome.previewLabel ?? 'Preview'}
                </ComposeDockSecondaryButton>
              )}
              {runChrome.onDiscard && (
                <ComposeDockIconButton
                  type="button"
                  $armed={runChrome.discardArmed}
                  aria-label={
                    runChrome.discardArmed
                      ? 'Click again to discard the run'
                      : 'Discard run'
                  }
                  onClick={() => runChrome.onDiscard?.()}
                >
                  {runChrome.discardArmed ? 'Discard?' : <Trash2 aria-hidden="true" />}
                </ComposeDockIconButton>
              )}
            </ComposeDockFooter>
          ) : (
          <ComposeDockFooter>
            <BulkMenuWrap ref={scheduleMenuWrapRef}>
              <ComposeDockSendGroup>
                <ComposeDockSendButton
                  type="button"
                  disabled={!canSendCompose && !composeSendPending}
                  onClick={sendComposeMessage}
                >
                  {composeSendPending ? (
                    <PendingSendLabel>Sent · Undo</PendingSendLabel>
                  ) : (
                    <>
                      Send
                      <Send aria-hidden="true" />
                    </>
                  )}
                </ComposeDockSendButton>
                <ComposeDockSendLater
                  type="button"
                  aria-label="Send later"
                  aria-haspopup="menu"
                  aria-expanded={scheduleMenuOpen}
                  disabled={!canSendCompose}
                  onClick={() => setScheduleMenuOpen(open => !open)}
                >
                  <ChevronDown aria-hidden="true" />
                </ComposeDockSendLater>
              </ComposeDockSendGroup>
              {scheduleMenuOpen && (
                <ComposeDockMenu role="menu" aria-label="Send later">
                  {scheduleMenuItems}
                </ComposeDockMenu>
              )}
            </BulkMenuWrap>
            <ComposeDockIconButton
              type="button"
              aria-label="Attach files"
              onClick={() => {
                if (typeof document !== 'undefined') {
                  document
                    .getElementById(`puremail-compose-attachments-${variant}`)
                    ?.click()
                }
              }}
            >
              <Paperclip aria-hidden="true" />
            </ComposeDockIconButton>
            {composeSignatures.length > 0 && (
              <BulkMenuWrap>
                <ComposeDockIconButton
                  type="button"
                  aria-label="Insert signature"
                  aria-haspopup="menu"
                  aria-expanded={signatureMenuOpen}
                  onClick={() => setSignatureMenuOpen(open => !open)}
                >
                  <PenLine aria-hidden="true" />
                </ComposeDockIconButton>
                {signatureMenuOpen && (
                  <ComposeDockMenu role="menu" aria-label="Insert signature">
                    {composeSignatures.map(signature => (
                      <BulkMenuItem
                        key={signature.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSignatureMenuOpen(false)
                          insertSignature(signature.body)
                        }}
                      >
                        <PenLine aria-hidden="true" />
                        {signature.name}
                        {signature.isDefault ? ' · default' : ''}
                      </BulkMenuItem>
                    ))}
                  </ComposeDockMenu>
                )}
              </BulkMenuWrap>
            )}
            <KbdChip>⌘⏎</KbdChip>
            <ComposeDockFooterSpacer />
            <ComposeDockIconButton
              type="button"
              $armed={discardArmed}
              aria-label={
                discardArmed ? 'Click again to discard' : 'Discard draft'
              }
              onClick={handleDiscardClick}
            >
              {discardArmed ? 'Discard?' : <Trash2 aria-hidden="true" />}
            </ComposeDockIconButton>
          </ComposeDockFooter>
          )}
          <ComposeFileInput
            id={`puremail-compose-attachments-${variant}`}
            type="file"
            multiple
            onChange={event => {
              void attachComposeFiles(event.currentTarget.files)
              event.currentTarget.value = ''
            }}
          />
        </ComposeDockWindow>
      </>
    )
  }

  return (
    <ComposeScreen aria-label="Compose mail">
      <ComposeHeader>
        <div>
          <Kicker>
            {composeContext
              ? composeContext.kind === 'forward'
                ? 'Forward'
                : 'Reply'
              : 'New mail'}
          </Kicker>
          <Subject>{composeContext ? dockTitle : 'Compose'}</Subject>
          <Meta>
            {replyStripVisible
              ? `${contextKindLine} ${contextSenderName} · ${contextTimeLabel}`
              : 'Send a new message or save it as a local draft.'}
          </Meta>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onDock && (
            <Button size="sm" onClick={onDock}>
              Back to window
            </Button>
          )}
          <Button size="sm" onClick={() => setComposeOpen(false)}>
            Close
          </Button>
        </div>
      </ComposeHeader>
      {composeContextStrip}
      <ComposeBody
        onDragEnter={event => {
          event.preventDefault()
          setComposeDropActive(true)
        }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={event => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return
          }
          setComposeDropActive(false)
        }}
        onDrop={handleComposeAttachmentDrop}
        onPaste={handleComposePaste}
      >
        <ComposeField as="div">
          <ComposeLabel>To</ComposeLabel>
          <RecipientChipsInput
            inputRef={composeToRef}
            value={composeTo}
            onChange={setComposeTo}
            store={store}
            accountId={selectedAccount?.id}
            ariaLabel="To recipients"
            placeholder="name@example.com, Name <name@example.com>"
          />
        </ComposeField>
        <div>
          <DraftAddressToggle
            type="button"
            onClick={() => setComposeCcBccOpen(open => !open)}
          >
            {composeCcBccOpen ? 'Hide Cc/Bcc' : 'Cc/Bcc'}
          </DraftAddressToggle>
        </div>
        {composeCcBccOpen && (
          <>
            <ComposeField as="div">
              <ComposeLabel>Cc</ComposeLabel>
              <RecipientChipsInput
                value={composeCc}
                onChange={setComposeCc}
                store={store}
                accountId={selectedAccount?.id}
                ariaLabel="Cc recipients"
                placeholder="cc@example.com"
              />
            </ComposeField>
            <ComposeField as="div">
              <ComposeLabel>Bcc</ComposeLabel>
              <RecipientChipsInput
                value={composeBcc}
                onChange={setComposeBcc}
                store={store}
                accountId={selectedAccount?.id}
                ariaLabel="Bcc recipients"
                placeholder="bcc@example.com"
              />
            </ComposeField>
          </>
        )}
        <ComposeField>
          <ComposeLabel>Subject</ComposeLabel>
          <ComposeInput
            ref={subjectInputRef}
            value={composeSubject}
            onChange={event => {
              setComposeSubject(event.currentTarget.value)
              if (event.currentTarget.value.trim()) {
                setSubjectReminderOpen(false)
              }
            }}
            placeholder="Subject"
          />
        </ComposeField>
        <ComposeField as="div" $grow>
          <ComposeLabel>Message</ComposeLabel>
          <ComposeToolbar role="toolbar" aria-label="Text formatting">
            <ComposeToolbarButton
              type="button"
              aria-label="Bold"
              title="Bold"
              aria-pressed={inlineFormats.bold}
              $active={inlineFormats.bold}
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('bold')}
            >
              <Bold aria-hidden="true" />
            </ComposeToolbarButton>
            <ComposeToolbarButton
              type="button"
              aria-label="Italic"
              title="Italic"
              aria-pressed={inlineFormats.italic}
              $active={inlineFormats.italic}
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('italic')}
            >
              <Italic aria-hidden="true" />
            </ComposeToolbarButton>
            <ComposeToolbarButton
              type="button"
              aria-label="Underline"
              title="Underline"
              aria-pressed={inlineFormats.underline}
              $active={inlineFormats.underline}
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('underline')}
            >
              <Underline aria-hidden="true" />
            </ComposeToolbarButton>
            <ComposeToolbarButton
              type="button"
              aria-label="Bulleted list"
              title="Bulleted list"
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('insertUnorderedList')}
            >
              <List aria-hidden="true" />
            </ComposeToolbarButton>
            <ComposeToolbarButton
              type="button"
              aria-label="Numbered list"
              title="Numbered list"
              onMouseDown={event => event.preventDefault()}
              onClick={() => execEditorCommand('insertOrderedList')}
            >
              <ListOrdered aria-hidden="true" />
            </ComposeToolbarButton>
            <ComposeToolbarButton
              type="button"
              aria-label="Insert link"
              title="Insert link"
              aria-expanded={linkUrlDraft !== null}
              onMouseDown={event => event.preventDefault()}
              onClick={() =>
                setLinkUrlDraft(current => (current === null ? '' : null))
              }
            >
              <Link2 aria-hidden="true" />
            </ComposeToolbarButton>
          </ComposeToolbar>
          {linkUrlDraft !== null && (
            <ComposeInlineRow>
              <ComposeInput
                value={linkUrlDraft}
                onChange={event => setLinkUrlDraft(event.currentTarget.value)}
                placeholder="https://example.com"
                aria-label="Link address"
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  const url = linkUrlDraft.trim()
                  if (/^https?:\/\//i.test(url)) {
                    execEditorCommand('createLink', url)
                  }
                  setLinkUrlDraft(null)
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  const url = linkUrlDraft.trim()
                  if (/^https?:\/\//i.test(url)) {
                    execEditorCommand('createLink', url)
                  }
                  setLinkUrlDraft(null)
                }}
              >
                Link
              </Button>
              <Button size="sm" onClick={() => setLinkUrlDraft(null)}>
                Cancel
              </Button>
            </ComposeInlineRow>
          )}
          <ComposeRichBody
            ref={editorRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Message body"
            data-placeholder={
              composeContext ? 'Write your reply...' : 'Write your message, or drop citations, images, videos, PDFs and contacts here…'
            }
            onInput={handleEditorInput}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleRichPaste}
          />
          {composeQuoteChip}
        </ComposeField>
        <ComposeAttachmentList
          aria-label="Compose attachments"
          $dropActive={composeDropActive}
        >
          {composeAttachments.map(attachment => (
            <ComposeAttachmentChip key={attachment.id}>
              <AttachmentMeta>{attachmentKindLabel(attachment)}</AttachmentMeta>
              <AttachmentName title={attachment.name}>
                {attachment.name}
              </AttachmentName>
              <AttachmentMeta>
                {attachmentDisplaySize(attachment)}
              </AttachmentMeta>
              <Button
                size="sm"
                onClick={() => removeComposeAttachment(attachment.id)}
              >
                Remove
              </Button>
            </ComposeAttachmentChip>
          ))}
          <AttachmentDropHint>
            Drop files anywhere in compose, paste an image, or use Attach
            files.
          </AttachmentDropHint>
          {composeAttachments.length > 0 && (
            <AttachmentSizeNotice
              $tone={
                composeSizeStatus.overLimit
                  ? 'danger'
                  : composeSizeStatus.nearLimit
                    ? 'warning'
                    : 'neutral'
              }
              role={composeSizeStatus.overLimit ? 'alert' : undefined}
            >
              {composeSizeStatus.overLimit
                ? `Attachments total ${composeSizeStatus.totalLabel} — over the ${composeSizeStatus.limitLabel} sending limit. Remove attachments to send.`
                : `${composeSizeStatus.totalLabel} of ${composeSizeStatus.limitLabel}`}
            </AttachmentSizeNotice>
          )}
        </ComposeAttachmentList>
        <ComposeFileInput
          id="puremail-compose-attachments"
          type="file"
          multiple
          onChange={event => {
            void attachComposeFiles(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
        <div>
          <Button
            size="sm"
            onClick={() => {
              if (typeof document !== 'undefined') {
                document.getElementById('puremail-compose-attachments')?.click()
              }
            }}
          >
            Attach files
          </Button>
        </div>
        {invalidComposeRecipients.length > 0 && (
          <ComposeInlineNotice $tone="warning" role="alert">
            {invalidComposeRecipients.length === 1
              ? `"${invalidComposeRecipients[0]?.email}" is not a valid email address — fix it to send.`
              : `${invalidComposeRecipients.length} recipients are not valid email addresses — fix them to send.`}
          </ComposeInlineNotice>
        )}
        {subjectReminderOpen && (
          <ComposeInlineNotice
            $tone="warning"
            role="alertdialog"
            aria-label="Missing subject reminder"
          >
            This message has no subject.
            <Button
              size="sm"
              onClick={() => {
                setSubjectReminderOpen(false)
                pendingSubjectActionRef.current = null
                subjectInputRef.current?.focus()
              }}
            >
              Add subject
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const action =
                  pendingSubjectActionRef.current ?? sendComposeMessage
                pendingSubjectActionRef.current = null
                action()
              }}
            >
              Send anyway
            </Button>
          </ComposeInlineNotice>
        )}
        {attachmentReminderOpen && (
          <ComposeInlineNotice
            $tone="warning"
            role="alertdialog"
            aria-label="Attachment reminder"
          >
            The message mentions an attachment, but nothing is attached.
            <Button size="sm" onClick={sendComposeMessage}>
              Send anyway
            </Button>
            <Button
              size="sm"
              onClick={() => setAttachmentReminderOpen(false)}
            >
              Keep editing
            </Button>
          </ComposeInlineNotice>
        )}
      </ComposeBody>
      <ComposeFooter>
        {composeSignatures.length > 0 && (
          <BulkMenuWrap>
            <Button
              size="sm"
              aria-haspopup="menu"
              aria-expanded={signatureMenuOpen}
              onClick={() => setSignatureMenuOpen(open => !open)}
            >
              <PenLine aria-hidden="true" size={13} /> Signature
            </Button>
            {signatureMenuOpen && (
              <BulkMenu role="menu" aria-label="Insert signature">
                {composeSignatures.map(signature => (
                  <BulkMenuItem
                    key={signature.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSignatureMenuOpen(false)
                      insertSignature(signature.body)
                    }}
                  >
                    <PenLine aria-hidden="true" />
                    {signature.name}
                    {signature.isDefault ? ' · default' : ''}
                  </BulkMenuItem>
                ))}
              </BulkMenu>
            )}
          </BulkMenuWrap>
        )}
        <Button size="sm" onClick={handleDiscardClick}>
          {discardArmed ? 'Discard? click again' : 'Discard'}
        </Button>
        <Button size="sm" disabled={!canSaveCompose} onClick={saveComposeDraft}>
          Save draft
        </Button>
        <BulkMenuWrap ref={scheduleMenuWrapRef}>
          <Button
            size="sm"
            disabled={!canSendCompose}
            aria-haspopup="menu"
            aria-expanded={scheduleMenuOpen}
            title="Send later"
            onClick={() => setScheduleMenuOpen(open => !open)}
          >
            <Clock aria-hidden="true" size={13} /> Send later
          </Button>
          {scheduleMenuOpen && (
            <BulkMenu role="menu" aria-label="Send later">
              {scheduleMenuItems}
            </BulkMenu>
          )}
        </BulkMenuWrap>
        <Button
          size="sm"
          variant="primary"
          disabled={!canSendCompose && !composeSendPending}
          onClick={sendComposeMessage}
        >
          {composeSendPending ? (
            <PendingSendLabel>Sent · Undo</PendingSendLabel>
          ) : (
            'Send'
          )}
        </Button>
      </ComposeFooter>
    </ComposeScreen>
  )
}
