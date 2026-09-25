import { useMemo, useRef, useState } from 'react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { useOutsideClose } from './useOutsideClose'
import {
  filterThreadHistory,
  groupThreadHistoryByMonth,
  threadHistoryCounts,
  threadHistorySpan,
  visibleThreadHistory,
  type ThreadHistoryEntry,
  type ThreadHistoryFilter,
} from './threadHistory'
import { formatThreadListTime, senderAvatar } from './mailShellHelpers'
import {
  FilterChip,
  HistoryCloseButton,
  HistoryFilterRow,
  HistoryFooter,
  HistoryFooterLink,
  HistoryMonthLabel,
  HistoryPopover,
  HistoryPopoverCount,
  HistoryPopoverHeader,
  HistoryPopoverTitle,
  HistoryRow,
  HistoryRowGlyph,
  HistoryRowList,
  HistoryRowMarker,
  HistoryRowState,
  HistoryRowTime,
  PaneModeButton,
  PaneModeToggle,
  ReaderSenderAvatar,
  ThreadExpandAll,
  ThreadFilterStrip,
  ThreadSearchInput,
  ThreadViewAvatars,
  ThreadViewBack,
  ThreadViewFooter,
  ThreadViewHeaderBand,
  ThreadViewMetaLine,
  ThreadViewMonth,
  ThreadViewScroll,
  ThreadViewSubject,
  ThreadViewTopRow,
  TimelineBody,
  TimelineCard,
  TimelineCardBody,
  TimelineCardHead,
  TimelineDot,
  TimelineDraftWord,
  TimelineEntry,
  TimelineRow,
  TimelineRowSnippet,
  ThreadPill,
  ThreadPillLabel,
} from './mailShellStyles'

const STATE_WORD = { sent: 'Sent', received: 'Received', draft: 'Draft' } as const
const STATE_GLYPH = { sent: '↗', received: '↙', draft: '↗' } as const

const FILTER_DEFS: Array<{ id: ThreadHistoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'received', label: 'Received' },
  { id: 'drafts', label: 'Drafts' },
]

function HistoryFilterChips({
  entries,
  filter,
  setFilter,
}: {
  entries: ThreadHistoryEntry[]
  filter: ThreadHistoryFilter
  setFilter: (filter: ThreadHistoryFilter) => void
}): React.ReactElement {
  const counts = threadHistoryCounts(entries)
  return (
    <>
      {FILTER_DEFS.map(def => {
        const count = counts[def.id === 'all' ? 'all' : def.id]
        if (def.id !== 'all' && count === 0) return null
        return (
          <FilterChip
            key={def.id}
            type="button"
            $active={filter === def.id}
            aria-pressed={filter === def.id}
            onClick={() => setFilter(def.id)}
          >
            {def.label} {count}
          </FilterChip>
        )
      })}
    </>
  )
}

export function ThreadHistoryPill({
  total,
  open,
  onToggle,
}: {
  total: number
  open: boolean
  onToggle: () => void
}): React.ReactElement {
  return (
    <ThreadPill
      type="button"
      $open={open}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`Thread history, ${total} messages`}
      // Without this, the popover's outside-close fires on the same
      // mousedown and the click then reopens what it just closed.
      onMouseDown={event => event.stopPropagation()}
      onClick={onToggle}
    >
      ⇅ {total} <ThreadPillLabel>in thread</ThreadPillLabel>{' '}
      {open ? '⌃' : '⌄'}
    </ThreadPill>
  )
}

export interface ThreadHistoryPopoverProps {
  entries: ThreadHistoryEntry[]
  currentId: string | null
  filter: ThreadHistoryFilter
  setFilter: (filter: ThreadHistoryFilter) => void
  onOpenEntry: (entry: ThreadHistoryEntry) => void
  onOpenThreadView: () => void
  onClose: () => void
}

export function ThreadHistoryPopover({
  entries,
  currentId,
  filter,
  setFilter,
  onOpenEntry,
  onOpenThreadView,
  onClose,
}: ThreadHistoryPopoverProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(containerRef, true, onClose)
  // Long threads open on the recent few; the rest arrive on scroll.
  const [limit, setLimit] = useState(entries.length > 20 ? 6 : 20)
  const filtered = useMemo(
    () => filterThreadHistory(entries, filter),
    [entries, filter],
  )
  const rows = useMemo(
    () => visibleThreadHistory(filtered, currentId, limit),
    [filtered, currentId, limit],
  )
  const groups = useMemo(() => groupThreadHistoryByMonth(rows), [rows])

  return (
    <HistoryPopover
      ref={containerRef}
      role="dialog"
      aria-label="Thread history"
    >
      <HistoryPopoverHeader>
        <HistoryPopoverTitle>Thread history</HistoryPopoverTitle>
        <HistoryPopoverCount>
          {entries.length} message{entries.length === 1 ? '' : 's'}
        </HistoryPopoverCount>
        <HistoryCloseButton
          type="button"
          aria-label="Close thread history"
          onClick={onClose}
        >
          ✕
        </HistoryCloseButton>
      </HistoryPopoverHeader>
      <HistoryFilterRow>
        <HistoryFilterChips
          entries={entries}
          filter={filter}
          setFilter={setFilter}
        />
      </HistoryFilterRow>
      <HistoryRowList
        onScroll={event => {
          const node = event.currentTarget
          if (node.scrollTop + node.clientHeight >= node.scrollHeight - 24) {
            setLimit(current => Math.min(filtered.length, current + 20))
          }
        }}
      >
        {groups.map(group => (
          <div key={group.label}>
            <HistoryMonthLabel>{group.label}</HistoryMonthLabel>
            {group.entries.map(entry => (
              <HistoryRow
                key={entry.id}
                type="button"
                $current={entry.id === currentId}
                onClick={() => onOpenEntry(entry)}
              >
                <HistoryRowGlyph aria-hidden="true" $state={entry.state}>
                  {STATE_GLYPH[entry.state]}
                </HistoryRowGlyph>
                <HistoryRowState>{STATE_WORD[entry.state]}</HistoryRowState>
                <HistoryRowTime>
                  {formatThreadListTime(entry.at)}
                </HistoryRowTime>
                {entry.id === currentId && (
                  <HistoryRowMarker>current</HistoryRowMarker>
                )}
              </HistoryRow>
            ))}
          </div>
        ))}
      </HistoryRowList>
      <HistoryFooter>
        showing {rows.length} of {filtered.length}
        <HistoryFooterLink type="button" onClick={onOpenThreadView}>
          Open thread view →
        </HistoryFooterLink>
      </HistoryFooter>
    </HistoryPopover>
  )
}

export interface ThreadTimelineViewProps {
  subject: string
  participants: Array<{ name: string; email: string }>
  entries: ThreadHistoryEntry[]
  currentId: string | null
  filter: ThreadHistoryFilter
  setFilter: (filter: ThreadHistoryFilter) => void
  /** Full body text for an entry — messages and drafts resolve differently. */
  bodyTextFor: (entry: ThreadHistoryEntry) => string
  recipientsFor: (entry: ThreadHistoryEntry) => string
  onBack: () => void
  onReplyLatest: () => void
}

const THREAD_VIEW_PAGE = 20
const THREAD_VIEW_INITIAL = 6

export function ThreadTimelineView({
  subject,
  participants,
  entries,
  currentId,
  filter,
  setFilter,
  bodyTextFor,
  recipientsFor,
  onBack,
  onReplyLatest,
}: ThreadTimelineViewProps): React.ReactElement {
  // The open message starts expanded; everything else starts as a row.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(currentId ? [currentId] : []),
  )
  const [loadedCount, setLoadedCount] = useState(
    Math.min(entries.length, Math.max(THREAD_VIEW_INITIAL, 1)),
  )
  const [searchText, setSearchText] = useState('')

  const filtered = useMemo(() => {
    const byState = filterThreadHistory(entries, filter)
    const query = searchText.trim().toLowerCase()
    if (!query) return byState
    return byState.filter(
      entry =>
        entry.snippet.toLowerCase().includes(query) ||
        entry.sender.toLowerCase().includes(query),
    )
  }, [entries, filter, searchText])
  const loaded = useMemo(
    () => visibleThreadHistory(filtered, currentId, loadedCount),
    [filtered, currentId, loadedCount],
  )
  const groups = useMemo(
    () => groupThreadHistoryByMonth(loaded, { alwaysYear: true }),
    [loaded],
  )
  const span = useMemo(() => threadHistorySpan(entries), [entries])

  const toggleExpanded = (id: string): void => {
    setExpandedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <ThreadViewHeaderBand>
        <ThreadViewTopRow>
          <ThreadViewBack type="button" onClick={onBack}>
            ‹ back to message
          </ThreadViewBack>
          <PaneModeToggle role="tablist" aria-label="Pane mode">
            <PaneModeButton type="button" onClick={onBack}>
              Message
            </PaneModeButton>
            <PaneModeButton type="button" $active>
              Thread
            </PaneModeButton>
          </PaneModeToggle>
        </ThreadViewTopRow>
        <ThreadViewSubject>{subject}</ThreadViewSubject>
        <ThreadViewMetaLine>
          <span>
            {entries.length} message{entries.length === 1 ? '' : 's'}
            {span ? ` · ${span}` : ''}
          </span>
          <ThreadViewAvatars aria-hidden="true">
            {participants.slice(0, 4).map(person => {
              const avatar = senderAvatar(person.name || person.email)
              return (
                <span
                  key={person.email}
                  style={{ background: avatar.bg, color: avatar.fg }}
                >
                  {avatar.initial}
                </span>
              )
            })}
          </ThreadViewAvatars>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {participants
              .map(person => person.name || person.email)
              .join(', ')}
          </span>
        </ThreadViewMetaLine>
      </ThreadViewHeaderBand>
      <ThreadFilterStrip>
        <HistoryFilterChips
          entries={entries}
          filter={filter}
          setFilter={setFilter}
        />
        <ThreadSearchInput
          value={searchText}
          placeholder="⌕ in thread"
          aria-label="Search in thread"
          onChange={event => setSearchText(event.currentTarget.value)}
        />
        <ThreadExpandAll
          type="button"
          onClick={() =>
            setExpandedIds(new Set(loaded.map(entry => entry.id)))
          }
        >
          expand all
        </ThreadExpandAll>
      </ThreadFilterStrip>
      <ThreadViewScroll>
        {groups.map(group => (
          <div key={group.label}>
            <ThreadViewMonth>{group.label}</ThreadViewMonth>
            {group.entries.map(entry => {
              const expanded = expandedIds.has(entry.id)
              const avatar = senderAvatar(entry.sender)
              return (
                <TimelineEntry key={entry.id}>
                  <TimelineDot
                    aria-hidden="true"
                    $current={entry.id === currentId}
                  />
                  <TimelineBody>
                    {expanded ? (
                      <TimelineCard>
                        <TimelineCardHead
                          type="button"
                          $current={entry.id === currentId}
                          aria-expanded="true"
                          onClick={() => toggleExpanded(entry.id)}
                        >
                          <ReaderSenderAvatar
                            aria-hidden="true"
                            style={{
                              background: avatar.bg,
                              color: avatar.fg,
                              width: 22,
                              height: 22,
                              fontSize: 9.5,
                            }}
                          >
                            {avatar.initial}
                          </ReaderSenderAvatar>
                          <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                            {entry.sender}
                          </span>
                          <TimelineRowSnippet>
                            {recipientsFor(entry)
                              ? `to ${recipientsFor(entry)} · `
                              : ''}
                            {STATE_WORD[entry.state].toLowerCase()}
                          </TimelineRowSnippet>
                          <HistoryRowMarker>
                            {formatThreadListTime(entry.at)}
                          </HistoryRowMarker>
                          <span aria-hidden="true">⌃</span>
                        </TimelineCardHead>
                        <TimelineCardBody>
                          {bodyTextFor(entry)
                            .split('\n')
                            .map((line, index) => (
                              <p key={`${entry.id}-line-${index}`}>
                                {line || ' '}
                              </p>
                            ))}
                        </TimelineCardBody>
                      </TimelineCard>
                    ) : (
                      <TimelineRow
                        type="button"
                        aria-expanded="false"
                        onClick={() => toggleExpanded(entry.id)}
                      >
                        {entry.state === 'draft' ? (
                          <TimelineDraftWord>draft</TimelineDraftWord>
                        ) : (
                          <ReaderSenderAvatar
                            aria-hidden="true"
                            style={{
                              background: avatar.bg,
                              color: avatar.fg,
                              width: 20,
                              height: 20,
                              fontSize: 9,
                            }}
                          >
                            {avatar.initial}
                          </ReaderSenderAvatar>
                        )}
                        <span style={{ fontWeight: 500, fontSize: 12 }}>
                          {entry.sender}
                        </span>
                        <TimelineRowSnippet>{entry.snippet}</TimelineRowSnippet>
                        <HistoryRowMarker>
                          {formatThreadListTime(entry.at)}
                        </HistoryRowMarker>
                      </TimelineRow>
                    )}
                  </TimelineBody>
                </TimelineEntry>
              )
            })}
          </div>
        ))}
      </ThreadViewScroll>
      <ThreadViewFooter>
        <span>
          {loaded.length} of {filtered.length} loaded
        </span>
        {loaded.length < filtered.length && (
          <HistoryFooterLink
            type="button"
            style={{ marginLeft: 0 }}
            onClick={() =>
              setLoadedCount(current => current + THREAD_VIEW_PAGE)
            }
          >
            load {Math.min(THREAD_VIEW_PAGE, filtered.length - loaded.length)}{' '}
            more
          </HistoryFooterLink>
        )}
        <span style={{ flex: 1 }} />
        {/* The one primary action, so the toolbar above never becomes
            ambiguous about which message it applies to. */}
        <Button size="sm" variant="primary" onClick={onReplyLatest}>
          Reply to latest
        </Button>
      </ThreadViewFooter>
    </>
  )
}
