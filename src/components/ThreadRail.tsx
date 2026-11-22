import type { TeamReadStatuses } from '../lib/teamMailReview'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  BellOff,
  Check,
  ChevronDown,
  Clock,
  FolderInput,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Pin,
  RefreshCw,
  Star,
  Tag,
  Trash2,
} from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import type { BulkTriageAction } from '../lib/mailTriage'
import { LayoutGrid } from 'lucide-react'
import { useOutsideClose } from './useOutsideClose'
import { threadIsStarred } from '../lib/mailViews'
import { AI_TRIAGE_LABELS, aiTriageCurrent } from '../lib/aiTriageState'
import { threadAgentRefs } from '../lib/agentRefs'
import type {
  MailFetchIntervalMinutes,
  MailStore,
  MailThread,
} from '../types'
import {
  BulkMenu,
  BulkMenuItem,
  BulkMenuWrap,
  ListHeaderBar,
  ListHeaderCount,
  ListHeaderName,
  ListHeaderRange,
  ListHeaderSelectedCount,
  ListIconButton,
  MailListRow,
  MailStateChip,
  PriorityDot,
  RowActionButton,
  RowAttachmentChip,
  RowAvatar,
  RowBottomLine,
  RowChip,
  RowHoverActions,
  RowInlineBody,
  RowLabels,
  RowMark,
  RowPinIcon,
  RowSender,
  RowStar,
  RowSubject,
  RowThreadCount,
  RowTime,
  RowTopLine,
  RowTwoLineBody,
  RowUnreadDot,
  RowVipBadge,
  SelectField,
  SettingToggle,
  SquareCheck,
  ListPositionBar,
  ListPositionButton,
  ListPositionInput,
  ListPositionLabel,
  THREAD_ROW_OVERSCAN,
} from './mailShellStyles'
import {
  conversationKeyForThread,
  displayThreadLabels,
  formatThreadListTime,
  senderAvatar,
  threadStatusExplanation,
  threadStatusLabel,
  threadStatusTone,
} from './mailShellHelpers'
import {
  THREAD_ROW_HEIGHTS,
  firstVisibleRow,
  listPositionLabel,
  scrollTopForRow,
  visibleRowRange,
  type MailDensity,
} from './mailShellLayout'
import {
  ThreadListEmptyState,
  ThreadListSkeleton,
  type ThreadListEmptyVariant,
} from './ThreadListStates'
import { TimePickerPopover } from './TimePickerPopover'

/**
 * The rail's offset inside its scroller.
 *
 * NOT the element's own offsetTop, which measures from the nearest
 * POSITIONED ancestor — the mail scroller is static, so that number
 * belonged to an outer box and was 74px adrift here. It made "back to
 * top" land past the first row, leaving it hidden and the second clipped,
 * and skewed the virtual window by more than a row.
 */
function railOffsetWithin(rail: HTMLElement, scroller: HTMLElement): number {
  return Math.round(
    rail.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop,
  )
}

export interface ThreadListToolbarProps {
  store: MailStore
  filteredThreads: MailThread[]
  checkedThreadIds: string[]
  selectAllThreads: () => void
  selectThreadsByIds?: (threadIds: string[]) => void
  clearThreadSelection: () => void
  runTriageAction: (threadIds: string[], action: BulkTriageAction) => void
  canSnoozeThreads: boolean
  createMailLabel: (name: string) => void
  cancelScheduledSendsForThreads: (threadIds: string[]) => void
  /**
   * "Review & send as a run": present only when every checked thread holds
   * an unsent draft (the Drafts view, typically). Inherits those drafts
   * into a run without touching them.
   */
  reviewSelectionAsRun?: (threadIds: string[]) => void
  refreshMail: (trigger?: 'manual' | 'auto') => Promise<void>
  mailFetching: boolean
  mailFetchDisabled: boolean
  /** What the list is showing, in the user's terms ("Inbox", a query…). */
  viewName: string
  unreadInView: number
  autoFetchEnabled: boolean
  mailFetchIntervalMinutes: number
  setStore: React.Dispatch<React.SetStateAction<MailStore>>
}

/**
 * The 44px header over the thread list. Index state: select-all, refresh,
 * More (auto-fetch), the view name and its unread count, and the total on
 * the right. With a selection it becomes the bulk toolbar: N selected plus
 * the triage actions, wired to the same runTriageAction as ever.
 *
 * No newer/older chevrons: the list scrolls (windowed), it does not
 * paginate, so there is no page to move between.
 */
export function ThreadListToolbar({
  store,
  filteredThreads,
  checkedThreadIds,
  selectAllThreads,
  selectThreadsByIds,
  clearThreadSelection,
  runTriageAction,
  canSnoozeThreads,
  createMailLabel,
  cancelScheduledSendsForThreads,
  reviewSelectionAsRun,
  refreshMail,
  mailFetching,
  mailFetchDisabled,
  viewName,
  unreadInView,
  autoFetchEnabled,
  mailFetchIntervalMinutes,
  setStore,
}: ThreadListToolbarProps): React.ReactElement {
  const [newLabelName, setNewLabelName] = useState('')
  const [openMenu, setOpenMenu] = useState<
    'select' | 'label' | 'move' | 'snooze' | 'more' | null
  >(null)
  const barRef = useRef<HTMLDivElement>(null)
  useOutsideClose(barRef, openMenu !== null, () => setOpenMenu(null))

  const unreadThreadIds = useMemo(() => {
    const unread = new Set<string>()
    for (const message of store.messages) {
      if (!message.read) unread.add(message.threadId)
    }
    return unread
  }, [store.messages])

  const selectSubset = (kind: 'all' | 'none' | 'unread' | 'read' | 'starred' | 'unstarred'): void => {
    setOpenMenu(null)
    if (kind === 'none') {
      clearThreadSelection()
      return
    }
    if (kind === 'all') {
      selectAllThreads()
      return
    }
    if (!selectThreadsByIds) return
    const ids = filteredThreads
      .filter(thread => {
        if (kind === 'unread') return unreadThreadIds.has(thread.id)
        if (kind === 'read') return !unreadThreadIds.has(thread.id)
        if (kind === 'starred') return threadIsStarred(store, thread.id)
        return !threadIsStarred(store, thread.id)
      })
      .map(thread => thread.id)
    selectThreadsByIds(ids)
  }

  const selectionCount = checkedThreadIds.length
  const checkedSet = useMemo(
    () => new Set(checkedThreadIds),
    [checkedThreadIds],
  )
  const allChecked =
    filteredThreads.length > 0 &&
    filteredThreads.every(thread => checkedSet.has(thread.id))
  const checkedAccountId = filteredThreads.find(thread =>
    checkedSet.has(thread.id),
  )?.accountId
  // Only offer genuine move destinations (never Drafts/Sent, which are not move targets).
  const moveTargets = store.mailboxes.filter(
    mailbox =>
      mailbox.accountId === checkedAccountId &&
      mailbox.role !== 'drafts' &&
      mailbox.role !== 'sent',
  )
  const scheduledThreadIds = useMemo(
    () =>
      new Set(
        (store.scheduledSends ?? [])
          .filter(entry => entry.status === 'scheduled')
          .map(entry => entry.threadId),
      ),
    [store.scheduledSends],
  )
  const checkedHasScheduled = checkedThreadIds.some(threadId =>
    scheduledThreadIds.has(threadId),
  )

  const act = (action: BulkTriageAction): void => {
    setOpenMenu(null)
    runTriageAction(checkedThreadIds, action)
  }
  const setAutoFetchEnabled = (enabled: boolean): void => {
    setStore(current => ({
      ...current,
      settings: { ...current.settings, autoFetchEnabled: enabled },
    }))
  }
  const setMailFetchInterval = (minutes: MailFetchIntervalMinutes): void => {
    setStore(current => ({
      ...current,
      settings: { ...current.settings, fetchIntervalMinutes: minutes },
    }))
  }

  return (
    <ListHeaderBar
      ref={barRef}
      role="toolbar"
      aria-label={
        selectionCount > 0 ? 'Selected thread actions' : 'Thread list'
      }
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <SquareCheck
          type="button"
          role="checkbox"
          aria-checked={allChecked ? true : selectionCount > 0 ? 'mixed' : false}
          aria-label={selectionCount > 0 ? 'Clear selection' : 'Select all threads'}
          $checked={selectionCount > 0}
          onClick={() =>
            selectionCount > 0 ? clearThreadSelection() : selectAllThreads()
          }
        >
          {selectionCount > 0 && <Check aria-hidden="true" />}
        </SquareCheck>
        {selectThreadsByIds && (
          <BulkMenuWrap>
            <ListIconButton
              type="button"
              aria-label="Select threads menu"
              aria-expanded={openMenu === 'select'}
              aria-haspopup="menu"
              style={{ width: 18, padding: 0 }}
              onClick={() =>
                setOpenMenu(current => (current === 'select' ? null : 'select'))
              }
            >
              <ChevronDown size={12} aria-hidden="true" />
            </ListIconButton>
            {openMenu === 'select' && (
              <BulkMenu role="menu" aria-label="Select threads">
                {(
                  [
                    ['all', 'All'],
                    ['none', 'None'],
                    ['unread', 'Unread'],
                    ['read', 'Read'],
                    ['starred', 'Starred'],
                    ['unstarred', 'Unstarred'],
                  ] as const
                ).map(([kind, label]) => (
                  <BulkMenuItem
                    key={kind}
                    type="button"
                    role="menuitem"
                    onClick={() => selectSubset(kind)}
                  >
                    {label}
                  </BulkMenuItem>
                ))}
              </BulkMenu>
            )}
          </BulkMenuWrap>
        )}
      </div>
      {selectionCount > 0 ? (
        <>
          <ListHeaderSelectedCount aria-live="polite">
            {selectionCount} selected
          </ListHeaderSelectedCount>
          <ListIconButton
            type="button"
            aria-label="Archive selected"
            onClick={() => act({ type: 'archive' })}
          >
            <Archive aria-hidden="true" />
          </ListIconButton>
          <ListIconButton
            type="button"
            aria-label="Trash selected"
            onClick={() => act({ type: 'trash' })}
          >
            <Trash2 aria-hidden="true" />
          </ListIconButton>
          <ListIconButton
            type="button"
            aria-label="Mark selected read"
            onClick={() => act({ type: 'read', read: true })}
          >
            <MailOpen aria-hidden="true" />
          </ListIconButton>
          <ListIconButton
            type="button"
            aria-label="Mark selected unread"
            onClick={() => act({ type: 'read', read: false })}
          >
            <Mail aria-hidden="true" />
          </ListIconButton>
          <ListIconButton
            type="button"
            aria-label="Star selected"
            onClick={() => act({ type: 'star', starred: true })}
          >
            <Star aria-hidden="true" />
          </ListIconButton>
          <ListIconButton
            type="button"
            aria-label="Mute selected"
            onClick={() => act({ type: 'mute', muted: true })}
          >
            <BellOff aria-hidden="true" />
          </ListIconButton>
          <BulkMenuWrap>
            <ListIconButton
              type="button"
              aria-label="Label selected"
              aria-expanded={openMenu === 'label'}
              aria-haspopup="menu"
              onClick={() =>
                setOpenMenu(current => (current === 'label' ? null : 'label'))
              }
            >
              <Tag aria-hidden="true" />
            </ListIconButton>
            {openMenu === 'label' && (
              <BulkMenu role="menu" aria-label="Apply label">
                {store.labels.length === 0 && (
                  <BulkMenuItem type="button" disabled>
                    No labels yet
                  </BulkMenuItem>
                )}
                {store.labels.map(label => (
                  <BulkMenuItem
                    key={label.id}
                    type="button"
                    role="menuitem"
                    onClick={() => act({ type: 'label', labelId: label.id })}
                  >
                    <Tag aria-hidden="true" />
                    {label.name}
                  </BulkMenuItem>
                ))}
                <BulkMenuItem as="div" role="none" style={{ cursor: 'default' }}>
                  <input
                    value={newLabelName}
                    aria-label="New label name"
                    placeholder="New label…"
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
                    onChange={event =>
                      setNewLabelName(event.currentTarget.value)
                    }
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      createMailLabel(newLabelName)
                      setNewLabelName('')
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!newLabelName.trim()}
                    onClick={() => {
                      createMailLabel(newLabelName)
                      setNewLabelName('')
                    }}
                  >
                    Create
                  </Button>
                </BulkMenuItem>
              </BulkMenu>
            )}
          </BulkMenuWrap>
          <BulkMenuWrap>
            <ListIconButton
              type="button"
              aria-label="Move selected"
              aria-expanded={openMenu === 'move'}
              aria-haspopup="menu"
              onClick={() =>
                setOpenMenu(current => (current === 'move' ? null : 'move'))
              }
            >
              <FolderInput aria-hidden="true" />
            </ListIconButton>
            {openMenu === 'move' && (
              <BulkMenu role="menu" aria-label="Move to mailbox">
                {moveTargets.map(mailbox => (
                  <BulkMenuItem
                    key={mailbox.id}
                    type="button"
                    role="menuitem"
                    onClick={() => act({ type: 'move', mailboxId: mailbox.id })}
                  >
                    <FolderInput aria-hidden="true" />
                    {mailbox.name}
                  </BulkMenuItem>
                ))}
              </BulkMenu>
            )}
          </BulkMenuWrap>
          {canSnoozeThreads && (
            <BulkMenuWrap>
              <ListIconButton
                type="button"
                data-popover-trigger=""
                aria-label="Snooze selected"
                aria-expanded={openMenu === 'snooze'}
                aria-haspopup="menu"
                onClick={() =>
                  setOpenMenu(current =>
                    current === 'snooze' ? null : 'snooze',
                  )
                }
              >
                <Clock aria-hidden="true" />
              </ListIconButton>
              {openMenu === 'snooze' && (
                <TimePickerPopover
                  mode="snooze"
                  onSelect={iso => act({ type: 'snooze', snoozedUntil: iso })}
                  onClose={() => setOpenMenu(null)}
                />
              )}
            </BulkMenuWrap>
          )}
          {checkedHasScheduled && (
            <Button
              size="sm"
              onClick={() => cancelScheduledSendsForThreads(checkedThreadIds)}
            >
              <Clock aria-hidden="true" size={13} /> Cancel send
            </Button>
          )}
          {reviewSelectionAsRun && (
            <Button
              size="sm"
              title="Loop through these drafts one at a time: Send & next, Skip, or edit each"
              onClick={() => reviewSelectionAsRun(checkedThreadIds)}
            >
              <LayoutGrid aria-hidden="true" size={13} /> Review &amp; send as a run
            </Button>
          )}
          <Button size="sm" variant="text" onClick={clearThreadSelection}>
            Clear
          </Button>
        </>
      ) : (
        <>
          <ListIconButton
            type="button"
            $fetching={mailFetching}
            disabled={mailFetchDisabled || mailFetching}
            aria-label={mailFetching ? 'Fetching mail' : 'Refresh'}
            onClick={() => void refreshMail()}
          >
            <RefreshCw aria-hidden="true" />
          </ListIconButton>
          <BulkMenuWrap>
            <ListIconButton
              type="button"
              aria-label="List options"
              aria-expanded={openMenu === 'more'}
              aria-haspopup="menu"
              onClick={() =>
                setOpenMenu(current => (current === 'more' ? null : 'more'))
              }
            >
              <MoreHorizontal aria-hidden="true" />
            </ListIconButton>
            {openMenu === 'more' && (
              <BulkMenu role="menu" aria-label="List options">
                <BulkMenuItem as="div" role="none" style={{ cursor: 'default' }}>
                  <SettingToggle>
                    <input
                      type="checkbox"
                      checked={autoFetchEnabled}
                      onChange={event =>
                        setAutoFetchEnabled(event.currentTarget.checked)
                      }
                      aria-label="Auto-fetch mail"
                    />
                    Auto-fetch mail
                  </SettingToggle>
                </BulkMenuItem>
                <BulkMenuItem as="div" role="none" style={{ cursor: 'default' }}>
                  <SettingToggle>
                    Fetch every
                    <SelectField
                      value={String(mailFetchIntervalMinutes)}
                      disabled={!autoFetchEnabled}
                      onChange={event =>
                        setMailFetchInterval(
                          Number(
                            event.currentTarget.value,
                          ) as MailFetchIntervalMinutes,
                        )
                      }
                      aria-label="Mail auto-fetch interval"
                    >
                      <option value="5">5 minutes</option>
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="60">60 minutes</option>
                    </SelectField>
                  </SettingToggle>
                </BulkMenuItem>
              </BulkMenu>
            )}
          </BulkMenuWrap>
          <ListHeaderName title={viewName}>{viewName}</ListHeaderName>
          {unreadInView > 0 && (
            <ListHeaderCount>{unreadInView} unread</ListHeaderCount>
          )}
          <ListHeaderRange>
            {filteredThreads.length} thread
            {filteredThreads.length === 1 ? '' : 's'}
          </ListHeaderRange>
        </>
      )}
    </ListHeaderBar>
  )
}

export interface ThreadRailProps {
  teamReads?: TeamReadStatuses
  store: MailStore
  filteredThreads: MailThread[]
  filteredThreadEntries: Array<{ thread: MailThread; sortAt: string }>
  selectedThreadId: string
  selectedConversationKey: string | null
  openThread: (threadId: string, messageId?: string | null) => void
  checkedThreadIds: string[]
  toggleThreadChecked: (threadId: string, extendRange: boolean) => void
  runTriageAction: (threadIds: string[], action: BulkTriageAction) => void
  canSnoozeThreads: boolean
  toggleThreadStarred: (threadId: string) => void
  density: MailDensity
  /** The box in the Executive room lists the Inbox itself; this stays mounted, out of sight. */
  hiddenInRoom?: boolean
  mailFetching?: boolean
  emptyVariant?: ThreadListEmptyVariant
  currentQuery?: string
  onClearSearch?: () => void
  onSearchServer?: () => void
  onCompose?: () => void
}

/**
 * The full-width thread list: one thread per line — checkbox, star, sender,
 * a chip when the thread carries one, subject — snippet, time. Hovering a
 * row shows the four triage icons over the time (absolutely positioned, so
 * nothing reflows). Clicking a row ENTERS reading mode via openThread.
 */
export function ThreadRail({
  teamReads = {},
  store,
  filteredThreads,
  filteredThreadEntries,
  selectedThreadId,
  selectedConversationKey,
  openThread,
  checkedThreadIds,
  toggleThreadChecked,
  runTriageAction,
  canSnoozeThreads,
  toggleThreadStarred,
  density,
  hiddenInRoom,
  mailFetching = false,
  emptyVariant = 'inbox-zero',
  currentQuery,
  onClearSearch,
  onSearchServer,
  onCompose,
}: ThreadRailProps): React.ReactElement {
  const [isNarrowPane, setIsNarrowPane] = useState(false)
  const effectiveDensity: MailDensity = isNarrowPane ? 'comfortable' : density
  const rowHeight = THREAD_ROW_HEIGHTS[effectiveDensity]
  const [snoozeRow, setSnoozeRow] = useState<{
    threadId: string
    top: number
    right: number
    flipUp: boolean
  } | null>(null)
  useEffect(() => {
    setSnoozeRow(null)
  }, [currentQuery, store.accounts.length, filteredThreads.length])
  const filteredThreadSortTimes = useMemo(
    () =>
      new Map(
        filteredThreadEntries.map(entry => [entry.thread.id, entry.sortAt]),
      ),
    [filteredThreadEntries],
  )
  /**
   * One pass over messages rather than a scan per rendered row, so this stays
   * flat as the mailbox grows.
   */
  const { unreadThreadIds, messageCountByThread, attachmentCountByThread } =
    useMemo(() => {
      const unread = new Set<string>()
      const msgCounts = new Map<string, number>()
      const attCounts = new Map<string, number>()
      for (const message of store.messages) {
        if (!message.read) unread.add(message.threadId)
        if (!message.isDraft) {
          msgCounts.set(
            message.threadId,
            (msgCounts.get(message.threadId) ?? 0) + 1,
          )
        }
        const attLen = message.attachments?.length ?? 0
        if (attLen > 0) {
          attCounts.set(
            message.threadId,
            (attCounts.get(message.threadId) ?? 0) + attLen,
          )
        }
      }
      return {
        unreadThreadIds: unread,
        messageCountByThread: msgCounts,
        attachmentCountByThread: attCounts,
      }
    }, [store.messages])
  const vipEmailSet = useMemo(
    () =>
      new Set(
        (store.vipSenders ?? []).map(email => email.trim().toLowerCase()),
      ),
    [store.vipSenders],
  )
  const pinnedIdSet = useMemo(
    () => new Set(store.pinnedThreadIds ?? []),
    [store.pinnedThreadIds],
  )
  const checkedSet = useMemo(
    () => new Set(checkedThreadIds),
    [checkedThreadIds],
  )
  const scheduledByThread = useMemo(
    () =>
      new Map(
        (store.scheduledSends ?? [])
          .filter(entry => entry.status === 'scheduled')
          .map(entry => [entry.threadId, entry]),
      ),
    [store.scheduledSends],
  )
  const labelColorByName = useMemo(
    () =>
      new Map(
        store.labels.map(label => [label.name.toLowerCase(), label.color]),
      ),
    [store.labels],
  )
  /** Unsent drafts per thread, so a draft tool marks its thread's row. */
  const unsentDraftIdsByThread = useMemo(() => {
    const byThread = new Map<string, string[]>()
    for (const draft of store.drafts) {
      if (draft.sentAt) continue
      const ids = byThread.get(draft.threadId)
      if (ids) ids.push(draft.id)
      else byThread.set(draft.threadId, [draft.id])
    }
    return byThread
  }, [store.drafts])

  // Only the rows near the viewport are mounted. Measured cost is
  // proportional to rows rendered — 2,000 mounted rows made a single query
  // edit take seconds, while rendering none was instant — so the list is
  // windowed. Rows are a fixed height, which keeps this exact.
  const railRef = useRef<HTMLDivElement>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 40 })
  // The row under the top edge — what "where am I" means to a person. Not
  // visibleRange.start, which begins earlier by the overscan.
  const [topRow, setTopRow] = useState(0)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpValue, setJumpValue] = useState('')
  useEffect(() => {
    const rail = railRef.current
    const scroller = rail?.closest<HTMLElement>('[data-mail-scroll]')
    if (!rail || !scroller) return
    const update = (): void => {
      const narrow = scroller.clientWidth > 0 && scroller.clientWidth <= 560
      setIsNarrowPane(prev => (prev === narrow ? prev : narrow))
      const effectiveRowHeight = THREAD_ROW_HEIGHTS[narrow ? 'comfortable' : density]
      const railTop = railOffsetWithin(rail, scroller)
      setVisibleRange(
        visibleRowRange({
          scrollTop: scroller.scrollTop,
          railTop,
          viewportHeight: scroller.clientHeight,
          rowHeight: effectiveRowHeight,
          overscan: THREAD_ROW_OVERSCAN,
          total: filteredThreads.length,
        }),
      )
      setTopRow(
        firstVisibleRow({
          scrollTop: scroller.scrollTop,
          railTop,
          rowHeight: effectiveRowHeight,
          total: filteredThreads.length,
        }),
      )
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [filteredThreads.length, rowHeight, density])

  const jumpTo = (position: number): void => {
    const rail = railRef.current
    const scroller = rail?.closest<HTMLElement>('[data-mail-scroll]')
    if (!rail || !scroller) return
    // Assigned, not scrollTo({behavior:'smooth'}): smooth scrolling is a
    // no-op inside the sandboxed app frame, so the jump silently did
    // nothing. An instant move is also the right feel for "go to 150".
    const railTop = railOffsetWithin(rail, scroller)
    const top = scrollTopForRow({
      position,
      railTop,
      rowHeight,
      total: filteredThreads.length,
    })
    scroller.scrollTop = top
    // Report the new position from the jump itself rather than waiting for
    // a scroll event: a programmatic scroll does not always emit one (a
    // hidden or throttled frame emits none), and the label would then sit
    // on the old number while the list showed somewhere else.
    setTopRow(
      firstVisibleRow({
        scrollTop: top,
        railTop,
        rowHeight,
        total: filteredThreads.length,
      }),
    )
    setVisibleRange(
      visibleRowRange({
        scrollTop: top,
        railTop,
        viewportHeight: scroller.clientHeight,
        rowHeight,
        overscan: THREAD_ROW_OVERSCAN,
        total: filteredThreads.length,
      }),
    )
  }
  const positionLabel = listPositionLabel({
    first: topRow,
    total: filteredThreads.length,
  })

  const windowed = filteredThreads.slice(visibleRange.start, visibleRange.end)
  const padTop = visibleRange.start * rowHeight
  const padBottom =
    Math.max(0, filteredThreads.length - visibleRange.end) * rowHeight

  const formatExactDateTime = (iso: string): string => {
    const parsed = new Date(iso)
    if (Number.isNaN(parsed.getTime())) return iso
    return parsed.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  }

  /** The one chip a row gets: its state if it has one, else its first label. */
  const rowChip = (thread: MailThread): React.ReactElement | null => {
    if (thread.status === 'snoozed' && thread.snoozedUntil) {
      return (
        <RowChip title={`Hidden until ${formatExactDateTime(thread.snoozedUntil)}`}>
          until {formatThreadListTime(thread.snoozedUntil)}
        </RowChip>
      )
    }
    if (thread.snoozeReturnedAt) {
      return (
        <MailStateChip
          $tone="priority"
          title="Returned from snooze — open the thread to clear this."
        >
          returned
        </MailStateChip>
      )
    }
    const scheduled = scheduledByThread.get(thread.id)
    if (scheduled) {
      return (
        <RowChip title={`Scheduled to send ${formatExactDateTime(scheduled.sendAt)}`}>
          sends {formatThreadListTime(scheduled.sendAt)}
        </RowChip>
      )
    }
    const status = threadStatusLabel(store, thread, store.drafts)
    if (status) {
      return (
        <MailStateChip $tone={threadStatusTone(store, thread, store.drafts)} title={threadStatusExplanation(status)}>
          {status}
        </MailStateChip>
      )
    }
    // The AI's call, when it says the thread wants attention.
    const triaged = aiTriageCurrent(store, thread)
    if (triaged && (triaged.verdict === 'needs_reply' || triaged.verdict === 'important')) {
      return (
        <MailStateChip
          $tone={triaged.verdict === 'needs_reply' ? 'reply' : 'priority'}
          title={`${triaged.decidedBy === 'user' ? 'Set by you' : 'AI triage'}: ${triaged.reason}`}
        >
          {AI_TRIAGE_LABELS[triaged.verdict]}
        </MailStateChip>
      )
    }
    const label = displayThreadLabels(store, thread, store.drafts)[0]
    if (label) {
      return (
        <RowChip style={{ '--lab-colour': labelColorByName.get(label.toLowerCase()) } as React.CSSProperties}>
          {label}
        </RowChip>
      )
    }
    return null
  }

  if (!hiddenInRoom && filteredThreads.length === 0) {
    if (mailFetching) {
      return <ThreadListSkeleton rows={8} density={density} />
    }
    return (
      <ThreadListEmptyState
        variant={emptyVariant}
        query={currentQuery}
        onClearSearch={onClearSearch}
        onSearchServer={onSearchServer}
        onCompose={onCompose}
      />
    )
  }

  return (
    <>
    <div ref={railRef} style={{ paddingTop: padTop, paddingBottom: padBottom, display: hiddenInRoom ? 'none' : undefined }}>
      {windowed.map(thread => {
        const unread = unreadThreadIds.has(thread.id)
        const checked = checkedSet.has(thread.id)
        const starred = threadIsStarred(store, thread.id)
        const pinned = pinnedIdSet.has(thread.id)
        const primaryParticipant = thread.participants[0]
        const senderDisplay =
          primaryParticipant?.name || primaryParticipant?.email || 'Unknown sender'
        const isVip = thread.participants.some(p =>
          vipEmailSet.has(p.email.trim().toLowerCase()),
        )
        const msgCount = messageCountByThread.get(thread.id) ?? 0
        const attCount = attachmentCountByThread.get(thread.id) ?? 0
        const avatar = senderAvatar(senderDisplay)
        const snippet = thread.summary?.trim() ?? ''
        const sortIso =
          filteredThreadSortTimes.get(thread.id) ?? thread.lastMessageAt
        const chipEl = rowChip(thread)
        const teamReadEl = teamReads[thread.id] ? (
          <MailStateChip
            $tone="label"
            title={teamReads[thread.id]!.description}
          >
            {teamReads[thread.id]!.label}
          </MailStateChip>
        ) : null

        return (
          <MailListRow
            key={thread.id}
            {...threadAgentRefs(thread, unsentDraftIdsByThread.get(thread.id))}
            role="button"
            tabIndex={0}
            aria-label={`Open conversation: ${thread.subject}`}
            $density={effectiveDensity}
            $unread={unread}
            $checked={checked}
            $active={
              thread.id === selectedThreadId ||
              (selectedConversationKey !== null &&
                conversationKeyForThread(thread) === selectedConversationKey)
            }
            onClick={() => openThread(thread.id)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              if (event.target !== event.currentTarget) return
              event.preventDefault()
              openThread(thread.id)
            }}
          >
            <SquareCheck
              as="span"
              role="checkbox"
              tabIndex={0}
              aria-checked={checked}
              aria-label={`Select conversation: ${thread.subject}`}
              $checked={checked}
              onClick={event => {
                event.stopPropagation()
                toggleThreadChecked(thread.id, event.shiftKey)
              }}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                toggleThreadChecked(thread.id, event.shiftKey)
              }}
            >
              {checked && <Check aria-hidden="true" />}
            </SquareCheck>
            <RowStar
              role="button"
              tabIndex={0}
              aria-pressed={starred}
              aria-label={
                starred
                  ? `Unstar conversation: ${thread.subject}`
                  : `Star conversation: ${thread.subject}`
              }
              $starred={starred}
              onClick={event => {
                event.stopPropagation()
                toggleThreadStarred(thread.id)
              }}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                toggleThreadStarred(thread.id)
              }}
            >
              <Star aria-hidden="true" />
            </RowStar>
            <RowMark>
              {unread ? (
                <RowUnreadDot aria-hidden="true" />
              ) : thread.priority === 'high' ? (
                <PriorityDot />
              ) : null}
            </RowMark>
            <RowAvatar
              $size={effectiveDensity === 'comfortable' ? 'md' : 'sm'}
              aria-hidden="true"
              style={{ background: avatar.bg, color: avatar.fg }}
            >
              {avatar.initial}
            </RowAvatar>
            {effectiveDensity === 'comfortable' ? (
              <RowTwoLineBody>
                <RowTopLine>
                  <RowSender
                    $unread={unread}
                    style={{ width: 'auto', flex: '0 1 auto' }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {senderDisplay}
                    </span>
                    {msgCount > 1 && (
                      <RowThreadCount aria-label={`${msgCount} messages`}>
                        ({msgCount})
                      </RowThreadCount>
                    )}
                    {isVip && <RowVipBadge>VIP</RowVipBadge>}
                    {pinned && (
                      <RowPinIcon title="Pinned" aria-label="Pinned">
                        <Pin aria-hidden="true" />
                      </RowPinIcon>
                    )}
                  </RowSender>
                  <span style={{ flex: 1 }} />
                  {attCount > 0 && (
                    <RowAttachmentChip
                      title={`${attCount} attachment${attCount === 1 ? '' : 's'}`}
                      aria-label={`${attCount} attachment${attCount === 1 ? '' : 's'}`}
                    >
                      <Paperclip aria-hidden="true" />
                    </RowAttachmentChip>
                  )}
                  <RowTime
                    as="time"
                    dateTime={sortIso}
                    title={formatExactDateTime(sortIso)}
                  >
                    {formatThreadListTime(sortIso)}
                  </RowTime>
                </RowTopLine>
                <RowBottomLine>
                  <RowSubject $unread={unread}>
                    <strong>{thread.subject}</strong>
                    {snippet ? ` — ${snippet}` : ''}
                  </RowSubject>
                  {(chipEl || teamReadEl) && (
                    <RowLabels>
                      {chipEl}
                      {teamReadEl}
                    </RowLabels>
                  )}
                </RowBottomLine>
              </RowTwoLineBody>
            ) : (
              <>
                <RowInlineBody>
                  <RowSender
                    $unread={unread}
                    data-row-sender-cluster=""
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {senderDisplay}
                    </span>
                    {msgCount > 1 && (
                      <RowThreadCount aria-label={`${msgCount} messages`}>
                        ({msgCount})
                      </RowThreadCount>
                    )}
                    {isVip && <RowVipBadge>VIP</RowVipBadge>}
                    {pinned && (
                      <RowPinIcon title="Pinned" aria-label="Pinned">
                        <Pin aria-hidden="true" />
                      </RowPinIcon>
                    )}
                  </RowSender>
                  {(chipEl || teamReadEl) && (
                    <RowLabels>
                      {chipEl}
                      {teamReadEl}
                    </RowLabels>
                  )}
                  <RowSubject $unread={unread}>
                    <strong>{thread.subject}</strong>
                    {snippet ? ` — ${snippet}` : ''}
                  </RowSubject>
                </RowInlineBody>
                {attCount > 0 && (
                  <RowAttachmentChip
                    title={`${attCount} attachment${attCount === 1 ? '' : 's'}`}
                    aria-label={`${attCount} attachment${attCount === 1 ? '' : 's'}`}
                  >
                    <Paperclip aria-hidden="true" />
                  </RowAttachmentChip>
                )}
                <RowTime
                  as="time"
                  dateTime={sortIso}
                  title={formatExactDateTime(sortIso)}
                >
                  {formatThreadListTime(sortIso)}
                </RowTime>
              </>
            )}
            <RowHoverActions
              $topAligned={effectiveDensity === 'comfortable'}
              aria-hidden={false}
              style={
                snoozeRow?.threadId === thread.id
                  ? { opacity: 1, pointerEvents: 'auto' }
                  : undefined
              }
            >
              <RowActionButton
                type="button"
                aria-label="Archive"
                title="Archive"
                onClick={event => {
                  event.stopPropagation()
                  runTriageAction([thread.id], { type: 'archive' })
                }}
              >
                <Archive aria-hidden="true" />
              </RowActionButton>
              <RowActionButton
                type="button"
                aria-label="Trash"
                title="Trash"
                onClick={event => {
                  event.stopPropagation()
                  runTriageAction([thread.id], { type: 'trash' })
                }}
              >
                <Trash2 aria-hidden="true" />
              </RowActionButton>
              <RowActionButton
                type="button"
                aria-label={unread ? 'Mark read' : 'Mark unread'}
                title={unread ? 'Mark read' : 'Mark unread'}
                onClick={event => {
                  event.stopPropagation()
                  runTriageAction([thread.id], { type: 'read', read: unread })
                }}
              >
                {unread ? (
                  <MailOpen aria-hidden="true" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
              </RowActionButton>
              {canSnoozeThreads && (
                <RowActionButton
                  type="button"
                  data-popover-trigger=""
                  aria-label="Snooze"
                  title="Snooze"
                  onClick={event => {
                    event.stopPropagation()
                    if (snoozeRow?.threadId === thread.id) {
                      setSnoozeRow(null)
                      return
                    }
                    const rect = event.currentTarget.getBoundingClientRect()
                    const viewportH =
                      typeof window !== 'undefined' ? window.innerHeight : 800
                    const viewportW =
                      typeof window !== 'undefined' ? window.innerWidth : 1200
                    const flipUp = viewportH - rect.bottom < 340
                    setSnoozeRow({
                      threadId: thread.id,
                      top: flipUp ? rect.top - 6 : rect.bottom + 6,
                      right: Math.max(12, viewportW - rect.right),
                      flipUp,
                    })
                  }}
                >
                  <Clock aria-hidden="true" />
                </RowActionButton>
              )}
            </RowHoverActions>
          </MailListRow>
        )
      })}
    </div>
    {snoozeRow &&
      typeof document !== 'undefined' &&
      createPortal(
        <div
          style={{
            position: 'fixed',
            right: snoozeRow.right,
            ...(snoozeRow.flipUp
              ? { bottom: Math.max(12, window.innerHeight - snoozeRow.top) }
              : { top: snoozeRow.top }),
            zIndex: 350,
          }}
        >
          <TimePickerPopover
            mode="snooze"
            staticPosition
            onSelect={iso => {
              const targetId = snoozeRow.threadId
              setSnoozeRow(null)
              runTriageAction([targetId], {
                type: 'snooze',
                snoozedUntil: iso,
              })
            }}
            onClose={() => setSnoozeRow(null)}
          />
        </div>,
        document.body,
      )}
    {positionLabel && filteredThreads.length > 20 ? (
      <ListPositionBar>
        {jumpOpen ? (
          <form
            style={{ display: 'contents' }}
            onSubmit={event => {
              event.preventDefault()
              const asked = Number.parseInt(jumpValue, 10)
              if (Number.isFinite(asked)) jumpTo(asked)
              setJumpOpen(false)
              setJumpValue('')
            }}
          >
            <ListPositionLabel as="label" htmlFor="mail-list-jump">
              Go to
            </ListPositionLabel>
            <ListPositionInput
              id="mail-list-jump"
              autoFocus
              inputMode="numeric"
              placeholder={String(topRow + 1)}
              value={jumpValue}
              onChange={event => setJumpValue(event.currentTarget.value)}
              onBlur={() => {
                setJumpOpen(false)
                setJumpValue('')
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  setJumpOpen(false)
                  setJumpValue('')
                }
              }}
            />
            <ListPositionLabel>
              of {filteredThreads.length.toLocaleString()}
            </ListPositionLabel>
          </form>
        ) : (
          <>
            <ListPositionButton
              type="button"
              title="Jump to a position in this list"
              onClick={() => setJumpOpen(true)}
            >
              {positionLabel}
            </ListPositionButton>
            <ListPositionButton
              type="button"
              title="Back to the top"
              onClick={() => jumpTo(1)}
              disabled={topRow === 0}
            >
              top
            </ListPositionButton>
          </>
        )}
      </ListPositionBar>
    ) : null}
    </>
  )
}
