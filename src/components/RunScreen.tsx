import { useEffect, useRef, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Pause,
  X,
} from 'lucide-react'
import {
  advanceRun,
  markRunItemCommitted,
  markRunItemSent,
  markRunItemUnsent,
  nextPendingIndex,
  previousIndex,
  reconcileRun,
  runProgress,
  runSummaryLine,
  setRunCursor,
  skipRunItem,
} from '../lib/mailRuns'
import type { Draft, MailRun, MailRunItem } from '../types'
import { ComposeEditor, type ComposeEditorProps } from './ComposeEditor'
import type { PendingSendState } from './mailShellHelpers'
import { useRunCard, useRunCardAutosave } from './runCardState'
import {
  RunBodyRow,
  RunCardColumn,
  RunHeaderBack,
  RunHeaderBar,
  RunHeaderButton,
  RunHeaderMeta,
  RunHeaderName,
  RunHeaderSpacer,
  RunPanel,
  RunPanelActions,
  RunPanelKicker,
  RunPanelText,
  RunPanelTitle,
  RunPrimaryButton,
  RunProgressSegment,
  RunProgressSegments,
  RunRail,
  RunRailFooter,
  RunRailHeader,
  RunRailHeaderMeta,
  RunRailKicker,
  RunRailLabel,
  RunRailList,
  RunRailMeta,
  RunRailRow,
  RunRailSquare,
  RunRailTick,
  RunStatusAction,
  RunStatusLine,
  RunStatusSpacer,
  RunSurface,
} from './runStyles'

/** What the shell's one store-draft send returns. */
export type SendStoreDraftResult =
  | { ok: true; pendingId: string; undoSeconds: number }
  | { ok: false; reason: string }

export interface SendStoreDraftOptions {
  label?: string
  /** The hold elapsed and the message left (or the demo account recorded it). */
  onCommitted?: (sentMessageId: string | undefined) => void
  /** The provider refused; the draft is still in Drafts. */
  onFailed?: (reason: string) => void
}

/** Shell plumbing every run card needs, passed through untouched. */
export type RunEditorPlumbing = Pick<
  ComposeEditorProps,
  | 'store'
  | 'setStore'
  | 'storeRef'
  | 'activeProvider'
  | 'mailProviderRef'
  | 'selectedAccount'
  | 'pendingSend'
  | 'schedulePendingSend'
  | 'undoPendingSend'
  | 'markDraftSending'
  | 'setSelectedMailboxId'
  | 'setSelectedThreadId'
  | 'setCommandNotice'
>

export interface RunScreenProps {
  run: MailRun
  plumbing: RunEditorPlumbing
  updateRun: (runId: string, update: (run: MailRun) => MailRun) => void
  sendStoreDraft: (draft: Draft, options: SendStoreDraftOptions) => SendStoreDraftResult
  pendingSends: PendingSendState[]
  undoPendingSend: (pendingId: string) => void
  setCommandNotice: (notice: string) => void
  onBack: () => void
  onEditTemplate: (() => void) | null
  onPause: () => void
}


function timeLabel(iso: string | undefined): string {
  if (!iso) return ''
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  return when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function itemMeta(item: MailRunItem, active: boolean): { text: string; accent?: boolean } | null {
  if (item.status === 'sent') return { text: `sent ${timeLabel(item.sentAt)}`.trim() }
  if (active) return { text: 'reviewing', accent: true }
  if (item.status === 'skipped') return { text: 'skipped' }
  if (item.status === 'missing') return { text: 'missing' }
  if (item.noteAdded) return { text: 'note added' }
  if (item.emailedThisMonth) return { text: 'emailed this month' }
  return null
}

/**
 * The run: one draft at a time, in the docked window's chrome, with the
 * recipient rail beside it. Send & next sends THIS draft through the
 * shell's one store-draft path (undo hold and all) and the next open item
 * is on screen at once; Skip and ⌘← move without sending. Every edit lands
 * in that item's draft only — autosaved, like any draft.
 */
export function RunScreen({
  run,
  plumbing,
  updateRun,
  sendStoreDraft,
  pendingSends,
  undoPendingSend,
  setCommandNotice,
  onBack,
  onEditTemplate,
  onPause,
}: RunScreenProps): React.ReactElement {
  const { store, setStore } = plumbing
  const progress = runProgress(run)
  const cursor = Math.min(Math.max(run.cursor, 0), Math.max(run.items.length - 1, 0))
  const item = run.items[cursor] ?? null
  const draft =
    item && item.status !== 'sent'
      ? store.drafts.find(entry => entry.id === item.draftId && !entry.sentAt) ?? null
      : null
  const { card, setters } = useRunCard(draft)
  const composeToRef = useRef<HTMLInputElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)

  // Autosave: the card writes into its draft when typing pauses, and is
  // flushed before every navigation and on leaving the screen.
  const { flush: saveCard } = useRunCardAutosave(card, setStore)
  const saveCardRef = useRef(saveCard)
  saveCardRef.current = saveCard

  // Drafts edited or deleted elsewhere: the run follows them.
  useEffect(() => {
    const reconciled = reconcileRun(store, run)
    if (reconciled !== run) updateRun(run.id, () => reconciled)
    // Only the drafts matter; the run object itself is what we update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.drafts, store.messages])

  // Focus the body when a new item lands, caret in the note slot if any.
  useEffect(() => {
    if (!card) return undefined
    const timer = window.setTimeout(() => {
      const surface = surfaceRef.current
      const editor = surface?.querySelector<HTMLElement>(
        '[data-puremail-compose-dock] [role="textbox"]',
      )
      if (!editor) return
      editor.focus({ preventScroll: true })
      const slot = editor.querySelector<HTMLElement>('[data-run-note]')
      const target = slot?.querySelector('p') ?? slot
      if (!target) return
      const selection = window.getSelection()
      if (!selection) return
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }, 30)
    return () => window.clearTimeout(timer)
    // Once per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.draftId])

  // ── Navigation ────────────────────────────────────────────────────────
  const goTo = (index: number): void => {
    if (index < 0 || index >= run.items.length) return
    saveCardRef.current()
    updateRun(run.id, current => setRunCursor(current, index))
  }
  const goNext = (): void => {
    const next = nextPendingIndex(run, cursor)
    if (next >= 0) goTo(next)
    else updateRun(run.id, current => advanceRun(current))
  }
  const goPrevious = (): void => goTo(previousIndex(run, cursor))
  const skip = (): void => {
    if (!item || item.status === 'sent') return
    saveCardRef.current()
    updateRun(run.id, current => advanceRun(skipRunItem(current, item.draftId)))
  }

  // ── Send & next ───────────────────────────────────────────────────────
  const sendItem = (savedDraft: Draft): void => {
    const draftId = savedDraft.id
    const result = sendStoreDraft(savedDraft, {
      label: 'Message',
      onCommitted: sentMessageId =>
        updateRun(run.id, current => markRunItemCommitted(current, draftId, sentMessageId)),
      onFailed: reason =>
        updateRun(run.id, current => markRunItemUnsent(current, draftId, reason)),
    })
    if (!result.ok) {
      setCommandNotice(result.reason)
      return
    }
    // With no undo hold the commit already ran; a hold id would linger.
    const pendingSendId = result.undoSeconds > 0 ? result.pendingId : undefined
    updateRun(run.id, current =>
      advanceRun(markRunItemSent(current, draftId, { pendingSendId })),
    )
  }
  const undoItem = (target: MailRunItem): void => {
    if (!target.pendingSendId) return
    undoPendingSend(target.pendingSendId)
    updateRun(run.id, current => markRunItemUnsent(current, target.draftId, undefined))
  }
  const openHolds = run.items.filter(
    entry => entry.pendingSendId && pendingSends.some(hold => hold.id === entry.pendingSendId),
  )
  const latestHold = openHolds[openHolds.length - 1] ?? null

  const onSurfaceKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (item && item.status !== 'sent' && item.status !== 'missing') skip()
      else goNext()
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goPrevious()
      return
    }
    if (event.key === 'Enter' && (!card || !draft)) {
      // The card handles its own ⌘⏎; on a sent/missing panel it means Next.
      event.preventDefault()
      goNext()
    }
  }

  // ── Header ────────────────────────────────────────────────────────────
  const SEGMENTS = 6
  const perSegment = progress.total / SEGMENTS
  const segments = Array.from({ length: SEGMENTS }, (_, index) => {
    if (!progress.total) return 0
    const filled = progress.sent - index * perSegment
    return Math.max(0, Math.min(1, filled / perSegment))
  })
  const position = run.items.length ? `${cursor + 1} of ${run.items.length}` : '0 of 0'
  const roleColumn = ((): string | null => {
    if (!item || item.rowIndex === undefined || !run.recipients) return null
    const mapped = new Set(Object.values(run.fieldMap).map(binding => binding.column))
    const extra = run.recipients.columns.find(column => !mapped.has(column))
    const value = extra ? run.recipients.rows[item.rowIndex]?.[extra]?.trim() : ''
    return value || null
  })()
  const cardMeta = item
    ? [item.label, roleColumn, item.status === 'skipped' ? 'skipped earlier' : null]
        .filter(Boolean)
        .join(' · ')
    : ''
  const sentMessage =
    item?.status === 'sent' && item.sentMessageId
      ? store.messages.find(message => message.id === item.sentMessageId) ?? null
      : null
  const sentDraft =
    item?.status === 'sent'
      ? store.drafts.find(entry => entry.id === item.draftId) ?? null
      : null
  const sourceLabel = run.recipients
    ? `${run.recipients.source.label} · ${run.recipients.rows.length}`
    : `${run.items.length} draft${run.items.length === 1 ? '' : 's'}`

  return (
    <RunSurface
      ref={surfaceRef}
      aria-label={`Send run ${run.name}`}
      tabIndex={-1}
      onKeyDown={onSurfaceKeyDown}
      data-puremail-run-screen
    >
      <RunHeaderBar>
        <RunHeaderBack type="button" aria-label="Back to Runs" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </RunHeaderBack>
        <RunHeaderName title={run.name}>{run.name}</RunHeaderName>
        <RunHeaderMeta>run · {position}</RunHeaderMeta>
        <RunProgressSegments aria-label={`${progress.sent} of ${progress.total} sent`}>
          {segments.map((fill, index) => (
            <RunProgressSegment key={index} $fill={fill} />
          ))}
        </RunProgressSegments>
        <RunHeaderMeta>
          {progress.sent} sent · {progress.toGo} to go
        </RunHeaderMeta>
        <RunHeaderSpacer />
        {run.status !== 'done' && (
          <RunHeaderButton type="button" onClick={onPause}>
            <Pause aria-hidden="true" />
            Pause run
          </RunHeaderButton>
        )}
        {onEditTemplate && (
          <RunHeaderButton type="button" onClick={onEditTemplate}>
            Edit template
          </RunHeaderButton>
        )}
      </RunHeaderBar>

      <RunBodyRow>
        <RunCardColumn>
          {run.status === 'done' && !draft ? (
            <RunPanel role="status">
              <RunPanelKicker>Run complete</RunPanelKicker>
              <RunPanelTitle>{run.name}</RunPanelTitle>
              <RunPanelText>
                {progress.sent} sent
                {progress.skipped ? ` · ${progress.skipped} skipped` : ''}
                {progress.missing ? ` · ${progress.missing} missing` : ''}. Sent
                mail is in Sent as normal; skipped drafts are still in Drafts.
                Use ⌘← to look back through the items, or return to Runs to
                archive this one.
              </RunPanelText>
              <RunPanelActions>
                <RunPrimaryButton type="button" onClick={onBack}>
                  Back to Runs
                </RunPrimaryButton>
                {progress.skipped > 0 && (
                  <RunHeaderButton
                    type="button"
                    onClick={() => {
                      const first = run.items.findIndex(entry => entry.status === 'skipped')
                      if (first >= 0) goTo(first)
                    }}
                  >
                    Review skipped
                  </RunHeaderButton>
                )}
              </RunPanelActions>
            </RunPanel>
          ) : !item ? (
            <RunPanel role="status">
              <RunPanelKicker>Nothing to review</RunPanelKicker>
              <RunPanelTitle>This run has no drafts yet.</RunPanelTitle>
              <RunPanelText>
                Render drafts from the template, or add existing drafts, in the
                run's setup.
              </RunPanelText>
              <RunPanelActions>
                {onEditTemplate && (
                  <RunPrimaryButton type="button" onClick={onEditTemplate}>
                    Open setup
                  </RunPrimaryButton>
                )}
                <RunHeaderButton type="button" onClick={onBack}>
                  Back to Runs
                </RunHeaderButton>
              </RunPanelActions>
            </RunPanel>
          ) : item.status === 'sent' ? (
            <RunPanel role="status" aria-label="Sent item">
              <RunPanelKicker>
                Draft {cursor + 1} of {run.items.length} · sent
              </RunPanelKicker>
              <RunPanelTitle>
                {(sentMessage ?? sentDraft)?.subject ?? item.label ?? 'Sent'}
              </RunPanelTitle>
              <RunPanelText>
                To {item.label ?? sentMessage?.to[0]?.email ?? 'recipient'}
                {item.sentAt ? ` · ${timeLabel(item.sentAt)}` : ''}.{' '}
                {item.pendingSendId && pendingSends.some(hold => hold.id === item.pendingSendId)
                  ? 'Leaving in a moment — undo while you can.'
                  : 'It is in Sent as normal mail.'}
              </RunPanelText>
              {(sentMessage ?? sentDraft)?.body && (
                <RunPanelText style={{ whiteSpace: 'pre-wrap' }}>
                  {(sentMessage ?? sentDraft)!.body.trim().slice(0, 600)}
                </RunPanelText>
              )}
              <RunPanelActions>
                {item.pendingSendId && pendingSends.some(hold => hold.id === item.pendingSendId) && (
                  <RunHeaderButton type="button" onClick={() => undoItem(item)}>
                    Undo send
                  </RunHeaderButton>
                )}
                <RunPrimaryButton type="button" onClick={goNext}>
                  Next
                  <ChevronRight aria-hidden="true" />
                </RunPrimaryButton>
              </RunPanelActions>
            </RunPanel>
          ) : !draft ? (
            <RunPanel role="status" aria-label="Missing draft">
              <RunPanelKicker>
                Draft {cursor + 1} of {run.items.length} · missing
              </RunPanelKicker>
              <RunPanelTitle>{item.label ?? 'This draft'} was deleted.</RunPanelTitle>
              <RunPanelText>
                The run points at a draft that no longer exists in Drafts, so
                this recipient is skipped. Re-render from the template to
                recreate it, or move on.
              </RunPanelText>
              <RunPanelActions>
                <RunPrimaryButton type="button" onClick={goNext}>
                  Next
                  <ChevronRight aria-hidden="true" />
                </RunPrimaryButton>
                {onEditTemplate && (
                  <RunHeaderButton type="button" onClick={onEditTemplate}>
                    Edit template
                  </RunHeaderButton>
                )}
              </RunPanelActions>
            </RunPanel>
          ) : card ? (
            <ComposeEditor
              key={`run-card-${draft.id}-${card.seed}`}
              {...plumbing}
              variant="run"
              runChrome={{
                mode: 'item',
                title: `Draft ${cursor + 1} of ${run.items.length}`,
                meta: cardMeta,
                hint: '⌘← previous · ⌘→ skip',
                toMeta:
                  item.rowIndex !== undefined
                    ? `from list · row ${item.rowIndex + 1}`
                    : 'existing draft',
                onSend: sendItem,
                onSkip: skip,
                canSkip: true,
                sendPending: false,
                footerNote: 'edits here change this draft only',
                attachmentNote: run.template ? 'shared by the run' : undefined,
              }}
              composeTo={card.to}
              setComposeTo={setters.setTo}
              composeCc={card.cc}
              setComposeCc={setters.setCc}
              composeBcc={card.bcc}
              setComposeBcc={setters.setBcc}
              composeCcBccOpen={card.ccBccOpen}
              setComposeCcBccOpen={setters.setCcBccOpen}
              composeSubject={card.subject}
              setComposeSubject={setters.setSubject}
              composeBody={card.body}
              setComposeBody={setters.setBody}
              composeBodyHtml={card.bodyHtml}
              setComposeBodyHtml={setters.setBodyHtml}
              composeAttachments={card.attachments}
              setComposeAttachments={setters.setAttachments}
              composeDropActive={card.dropActive}
              setComposeDropActive={setters.setDropActive}
              setComposeOpen={() => {}}
              composeContext={{
                threadId: draft.threadId,
                messageId: null,
                kind: 'draft',
                draftId: draft.id,
              }}
              composeQuote={null}
              setComposeQuote={() => {}}
              switchComposeReplyKind={() => {}}
              onResetComposeContext={() => {}}
              discardContextDraft={() => {}}
              composeToRef={composeToRef}
            />
          ) : null}
        </RunCardColumn>

        <RunRail aria-label="Recipients">
          <RunRailHeader>
            <RunRailKicker>Recipients</RunRailKicker>
            <RunRailHeaderMeta title={sourceLabel}>{sourceLabel}</RunRailHeaderMeta>
          </RunRailHeader>
          <RunRailList>
            {run.items.map((entry, index) => {
              const active = index === cursor
              const meta = itemMeta(entry, active)
              const tone =
                entry.status === 'sent'
                  ? 'sent'
                  : active
                    ? 'current'
                    : entry.status === 'skipped' || entry.status === 'missing'
                      ? 'off'
                      : 'pending'
              return (
                <RunRailRow
                  key={`${entry.draftId}-${index}`}
                  type="button"
                  $active={active}
                  $muted={entry.status === 'skipped' || entry.status === 'missing'}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => goTo(index)}
                >
                  <RunRailTick $tone={tone} aria-hidden="true">
                    {entry.status === 'sent' ? (
                      <Check strokeWidth={2.5} />
                    ) : active ? (
                      <ChevronRight />
                    ) : entry.status === 'skipped' || entry.status === 'missing' ? (
                      <X />
                    ) : (
                      <RunRailSquare />
                    )}
                  </RunRailTick>
                  <RunRailLabel title={entry.label}>{entry.label ?? entry.draftId}</RunRailLabel>
                  {meta && <RunRailMeta $accent={meta.accent}>{meta.text}</RunRailMeta>}
                </RunRailRow>
              )
            })}
          </RunRailList>
          <RunRailFooter>
            <span>Sent mail lands in Sent as normal · each send is undoable for the usual hold</span>
            <span>Nothing sends without Send &amp; next on each draft</span>
          </RunRailFooter>
        </RunRail>
      </RunBodyRow>

      <RunStatusLine role="status">
        <span>{runSummaryLine(run)}</span>
        <RunStatusSpacer />
        {latestHold ? (
          <>
            <span>
              {openHolds.length === 1
                ? `Sending to ${latestHold.label ?? 'recipient'}…`
                : `${openHolds.length} sends queued…`}
            </span>
            <RunStatusAction type="button" onClick={() => undoItem(latestHold)}>
              Undo
            </RunStatusAction>
          </>
        ) : (
          <span>All changes saved</span>
        )}
      </RunStatusLine>
    </RunSurface>
  )
}
