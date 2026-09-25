import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Check,
  Clock,
  FolderInput,
  Mail,
  MailOpen,
  MoreHorizontal,
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
  RowChip,
  RowChipDot,
  RowHoverActions,
  RowSender,
  RowStar,
  RowSubject,
  RowTime,
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

/** Snooze presets shared by the bulk toolbar and the row hover action. */
function snoozePresets(now = new Date()): Array<{ label: string; at: string }> {
  const laterToday = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7))
  nextWeek.setHours(9, 0, 0, 0)
  return [
    { label: 'Later today', at: laterToday.toISOString() },
    { label: 'Tomorrow morning', at: tomorrow.toISOString() },
    { label: 'Next week', at: nextWeek.toISOString() },
  ]
}

export interface ThreadListToolbarProps {
  store: MailStore
  filteredThreads: MailThread[]
  checkedThreadIds: string[]
  selectAllThreads: () => void
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
    'label' | 'move' | 'snooze' | 'more' | null
  >(null)
  const barRef = useRef<HTMLDivElement>(null)
  useOutsideClose(barRef, openMenu !== null, () => setOpenMenu(null))

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
  const moveTargets = store.mailboxes.filter(
    mailbox => mailbox.accountId === checkedAccountId,
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
      <SquareCheck
        type="button"
        role="checkbox"
        aria-checked={allChecked}
        aria-label={allChecked ? 'Clear selection' : 'Select all threads'}
        $checked={selectionCount > 0}
        onClick={() =>
          selectionCount > 0 ? clearThreadSelection() : selectAllThreads()
        }
      >
        {selectionCount > 0 && <Check aria-hidden="true" />}
      </SquareCheck>
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
                <BulkMenu role="menu" aria-label="Hide until">
                  <BulkMenuItem
                    as="div"
                    role="none"
                    style={{ cursor: 'default' }}
                  >
                    Hides these threads until they return. To chase a reply
                    instead, use Follow-up.
                  </BulkMenuItem>
                  {snoozePresets().map(preset => (
                    <BulkMenuItem
                      key={preset.label}
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        act({ type: 'snooze', snoozedUntil: preset.at })
                      }
                    >
                      <Clock aria-hidden="true" />
                      {preset.label}
                    </BulkMenuItem>
                  ))}
                </BulkMenu>
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
}

/**
 * The full-width thread list: one thread per line — checkbox, star, sender,
 * a chip when the thread carries one, subject — snippet, time. Hovering a
 * row shows the four triage icons over the time (absolutely positioned, so
 * nothing reflows). Clicking a row ENTERS reading mode via openThread.
 */
export function ThreadRail({
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
}: ThreadRailProps): React.ReactElement {
  const rowHeight = THREAD_ROW_HEIGHTS[density]
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
  const unreadThreadIds = useMemo(() => {
    const unread = new Set<string>()
    for (const message of store.messages) {
      if (!message.read) unread.add(message.threadId)
    }
    return unread
  }, [store.messages])
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
      const railTop = railOffsetWithin(rail, scroller)
      setVisibleRange(
        visibleRowRange({
          scrollTop: scroller.scrollTop,
          railTop,
          viewportHeight: scroller.clientHeight,
          rowHeight,
          overscan: THREAD_ROW_OVERSCAN,
          total: filteredThreads.length,
        }),
      )
      setTopRow(
        firstVisibleRow({
          scrollTop: scroller.scrollTop,
          railTop,
          rowHeight,
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
  }, [filteredThreads.length, rowHeight])

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

  /** The one chip a row gets: its state if it has one, else its first label. */
  const rowChip = (thread: MailThread): React.ReactElement | null => {
    if (thread.status === 'snoozed' && thread.snoozedUntil) {
      return (
        <RowChip title="Hidden until this time">
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
        <RowChip title="A send is scheduled">
          sends {formatThreadListTime(scheduled.sendAt)}
        </RowChip>
      )
    }
    const status = threadStatusLabel(store, thread, store.drafts)
    if (status) {
      return (
        <MailStateChip $tone={threadStatusTone(store, thread, store.drafts)}>
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
        <RowChip>
          <RowChipDot
            $color={labelColorByName.get(label.toLowerCase())}
            aria-hidden="true"
          />
          {label}
        </RowChip>
      )
    }
    return null
  }

  return (
    <>
    <div ref={railRef} style={{ paddingTop: padTop, paddingBottom: padBottom }}>
      {windowed.map(thread => {
        const unread = unreadThreadIds.has(thread.id)
        const checked = checkedSet.has(thread.id)
        const starred = threadIsStarred(store, thread.id)
        const snippet = thread.summary?.trim() ?? ''
        return (
          <MailListRow
            key={thread.id}
            role="button"
            tabIndex={0}
            aria-label={`Open conversation: ${thread.subject}`}
            $density={density}
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
            {thread.priority === 'high' && <PriorityDot />}
            <RowSender $unread={unread}>
              {thread.participants[0]?.name ?? 'Unknown sender'}
            </RowSender>
            {rowChip(thread)}
            <RowSubject $unread={unread}>
              <strong>{thread.subject}</strong>
              {snippet ? ` — ${snippet}` : ''}
            </RowSubject>
            <RowTime>
              {formatThreadListTime(
                filteredThreadSortTimes.get(thread.id) ?? thread.lastMessageAt,
              )}
            </RowTime>
            <RowHoverActions aria-hidden={false}>
              <RowActionButton
                role="button"
                tabIndex={-1}
                aria-label={`Archive: ${thread.subject}`}
                onClick={event => {
                  event.stopPropagation()
                  runTriageAction([thread.id], { type: 'archive' })
                }}
              >
                <Archive aria-hidden="true" />
              </RowActionButton>
              <RowActionButton
                role="button"
                tabIndex={-1}
                aria-label={`Trash: ${thread.subject}`}
                onClick={event => {
                  event.stopPropagation()
                  runTriageAction([thread.id], { type: 'trash' })
                }}
              >
                <Trash2 aria-hidden="true" />
              </RowActionButton>
              <RowActionButton
                role="button"
                tabIndex={-1}
                aria-label={`${unread ? 'Mark read' : 'Mark unread'}: ${thread.subject}`}
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
                  role="button"
                  tabIndex={-1}
                  aria-label={`Snooze until tomorrow morning: ${thread.subject}`}
                  onClick={event => {
                    event.stopPropagation()
                    runTriageAction([thread.id], {
                      type: 'snooze',
                      snoozedUntil: snoozePresets()[1].at,
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
