import { useMemo, useState } from 'react'
import { labelAgentRefs, mailboxAgentRefs, runAgentRefs, viewAgentRefs } from '../lib/agentRefs'
import {
  Archive,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  Folder,
  Hourglass,
  Inbox,
  LayoutGrid,
  MailMinus,
  Newspaper,
  NotebookPen,
  PenLine,
  Plus,
  Receipt,
  Search,
  Send,
  Shield,
  Star,
  Timer,
  Trash2,
  SearchCheck,
} from 'lucide-react'
import {
  countThreadQuery,
  markQuerySeen,
  unseenArrivalCount,
  parseMailQuery,
  quoteQueryValue,
  resolveThreadQuery,
} from '../lib/mailQuery'
import { unscreenedSendersInStore } from '../lib/mailScreener'
import { type MailSpecialRailView } from '../lib/mailViews'
import { runStatusLabel } from '../lib/mailRuns'
import type {
  MailAccount,
  Mailbox,
  MailRun,
  MailStore,
} from '../types'
import {
  MailNavUnseen,
  NavComposeButton,
  NavRail,
  NavRailCount,
  NavRailGroupDivider,
  NavRailInlineAddBtn,
  NavRailItem,
  NavRailLabelDot,
  NavRailSectionHeaderRow,
  NavRailSectionTitle,
  NavRailSectionToggle,
} from './mailShellStyles'

export interface MailSidebarProps {
  store: MailStore
  selectedAccount: MailAccount | null
  accountMailboxes: Mailbox[]
  selectedMailboxId: string
  selectedSpecialView: MailSpecialRailView | null
  currentQuery: string
  setCurrentQuery: React.Dispatch<React.SetStateAction<string>>
  setSelectedThreadId: React.Dispatch<React.SetStateAction<string>>
  setFocusedMessageId: React.Dispatch<React.SetStateAction<string | null>>
  setStore: React.Dispatch<React.SetStateAction<MailStore>>
  /** Leave reading mode: picking a view always lands on the index. */
  exitReading: () => void
  openCompose: () => void
  unsubscribeCount: number
  openUnsubscribeDrawer: () => void
  /** Send runs not yet archived, for the Runs row and its section. */
  runs: MailRun[]
  /** The run on screen (run or setup), for the active mark. */
  activeRunId: string | null
  /** The Runs index is on screen. */
  runsIndexActive: boolean
  openRunsIndex: () => void
  /** Going through the whole mailbox on the server. Absent when the account cannot. */
  openSweeps?: () => void
  sweepsActive?: boolean
  /** The reading room's boxes: messages with notes, and messages kept as context. */
  notesCount?: number
  contextCount?: number
  notesActive?: boolean
  contextActive?: boolean
  openNotes?: () => void
  openContext?: () => void
  openRun: (runId: string) => void
  /** Optional inline label creation callback. */
  createMailLabel?: (name: string) => void
  /** Precomputed unscreened sender count for the Screener badge. */
  screenerCount?: number
}

const SIDEBAR_COLLAPSE_KEY = 'puremail.sidebar.collapsed.v1'

type CollapsibleSectionKey = 'folders' | 'labels' | 'views'

function readCollapsedSections(): Record<CollapsibleSectionKey, boolean> {
  if (typeof window === 'undefined') {
    return { folders: false, labels: false, views: false }
  }
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY)
    if (!raw) return { folders: false, labels: false, views: false }
    const parsed = JSON.parse(raw) as Partial<Record<CollapsibleSectionKey, boolean>>
    return {
      folders: parsed.folders === true,
      labels: parsed.labels === true,
      views: parsed.views === true,
    }
  } catch {
    return { folders: false, labels: false, views: false }
  }
}

/** "Synced 2m ago", or an honest fallback when nothing has synced. */
export function syncStatusLine(
  lastMailFetchAt: string | null,
  accountCount: number,
  now: Date = new Date(),
): string {
  const accounts = `${accountCount} account${accountCount === 1 ? '' : 's'}`
  if (!lastMailFetchAt) return `Local mail · ${accounts}`
  const elapsedMs = now.getTime() - new Date(lastMailFetchAt).getTime()
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000))
  const age =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes}m ago`
        : `${Math.floor(minutes / 60)}h ago`
  return `Synced ${age} · ${accounts}`
}

/**
 * The 232px navigation rail: Compose (the ONE accent-filled button), the
 * boxes and special views, labels, saved views, and the bottom-docked sync
 * status line. Every row is just a query — selecting one replaces the whole
 * query string, exactly as the old dropdown nav did.
 */
export function MailSidebar({
  store,
  selectedAccount,
  accountMailboxes,
  selectedMailboxId,
  selectedSpecialView,
  currentQuery,
  setCurrentQuery,
  setSelectedThreadId,
  setFocusedMessageId,
  setStore,
  exitReading,
  openCompose,
  unsubscribeCount,
  openUnsubscribeDrawer,
  runs,
  activeRunId,
  runsIndexActive,
  openRunsIndex,
  notesCount = 0,
  contextCount = 0,
  notesActive = false,
  contextActive = false,
  openNotes,
  openSweeps,
  sweepsActive,
  openContext,
  openRun,
  createMailLabel,
  screenerCount,
}: MailSidebarProps): React.ReactElement {
  const [collapsedSections, setCollapsedSections] = useState<
    Record<CollapsibleSectionKey, boolean>
  >(readCollapsedSections)
  const [addingLabel, setAddingLabel] = useState(false)
  const [newLabelDraft, setNewLabelDraft] = useState('')

  const toggleSection = (key: CollapsibleSectionKey): void => {
    const next = { ...collapsedSections, [key]: !collapsedSections[key] }
    setCollapsedSections(next)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(next))
    } catch {
      // Ignore storage errors in sandboxed/private frames.
    }
  }

  const submitNewLabel = (): void => {
    const trimmed = newLabelDraft.trim()
    if (trimmed && createMailLabel) {
      createMailLabel(trimmed)
    }
    setNewLabelDraft('')
    setAddingLabel(false)
  }

  const computedScreenerCount = useMemo(() => {
    if (typeof screenerCount === 'number') return screenerCount
    if (store.settings.screenerEnabled === false) return 0
    return unscreenedSendersInStore(store, selectedAccount?.id).length
  }, [screenerCount, store, selectedAccount?.id])
  // Every count comes from the same resolver the list renders, so a badge
  // can never disagree with the number of rows it points at.
  const countFor = (query: string): number =>
    countThreadQuery(store, selectedAccount?.id, query)
  const unseenFor = (query: string): number =>
    unseenArrivalCount(store, selectedAccount?.id, query)
  /**
   * "+N since you last looked", for any nav row. The row you are looking at
   * never shows it — you are seeing it now.
   */
  const navUnseen = (query: string): React.ReactElement | null => {
    if (currentQuery === query) return null
    const count = unseenFor(query)
    if (count <= 0) return null
    return (
      <MailNavUnseen aria-label={`${count} new since you last looked`}>
        +{count}
      </MailNavUnseen>
    )
  }

  /**
   * Selecting a nav row replaces the whole query rather than mutating four
   * separate pieces of view state — and always returns to the index: a view
   * is a list, so picking one while reading must show the list.
   */
  const selectQuery = (query: string): void => {
    const first = selectedAccount
      ? resolveThreadQuery(store, selectedAccount.id, query).threads[0] ?? null
      : null
    // Arriving here counts as seeing this query; leaving the previous one
    // counts as having seen whatever arrived while it was on screen.
    const previous = currentQuery
    setStore(current =>
      markQuerySeen(
        previous ? markQuerySeen(current, previous) : current,
        query,
      ),
    )
    setCurrentQuery(query)
    setSelectedThreadId(first?.id ?? '')
    setFocusedMessageId(null)
    exitReading()
  }

  const mailboxByRole = (role: Mailbox['role']): Mailbox | null =>
    accountMailboxes.find(mailbox => mailbox.role === role) ?? null
  const boxQueryFor = (mailbox: Mailbox): string =>
    `in:${quoteQueryValue(mailbox.name)}`
  const navMailboxActive = (mailbox: Mailbox): boolean => {
    if (selectedSpecialView || selectedMailboxId !== mailbox.id) return false
    // The mailbox resolver falls back to the inbox for ANY non-mailbox query
    // (a search, a label view); only a pure `in:` query marks the row.
    const parsed = parseMailQuery(currentQuery.trim() || 'in:inbox')
    return (
      !parsed.text &&
      parsed.terms.length === 1 &&
      parsed.terms[0]?.field === 'in' &&
      !parsed.terms[0]?.negated
    )
  }
  const inboxMailbox = mailboxByRole('inbox')
  const customMailboxes = accountMailboxes.filter(
    mailbox => mailbox.role === 'custom',
  )
  // A box shows once, as its folder: the saved view that created it is the
  // same destination under another name.
  const customMailboxNames = new Set(
    customMailboxes.map(mailbox => mailbox.name.toLowerCase()),
  )
  const visibleSavedViews = (store.savedViews ?? []).filter(
    view => !customMailboxNames.has(view.name.toLowerCase()),
  )
  const inboxUnread = useMemo(
    () =>
      inboxMailbox
        ? countThreadQuery(
            store,
            selectedAccount?.id,
            `${boxQueryFor(inboxMailbox)} is:unread`,
          )
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, selectedAccount?.id, inboxMailbox?.name],
  )
  const scheduledCount = countFor('is:scheduled')

  const specialRow = (
    kind:
      | 'starred'
      | 'snoozed'
      | 'scheduled'
      | 'waiting'
      | 'screener'
      | 'feed'
      | 'paper_trail',
    query: string,
    label: string,
    icon: React.ReactElement,
    options?: { countOverride?: number; accentBadge?: boolean },
  ): React.ReactElement => {
    const active = selectedSpecialView?.kind === kind
    const count =
      typeof options?.countOverride === 'number'
        ? options.countOverride
        : countFor(query)
    return (
      <NavRailItem
        type="button"
        $active={active}
        aria-current={active ? 'true' : undefined}
        onClick={() => selectQuery(query)}
      >
        {icon}
        {label}
        {navUnseen(query)}
        {count > 0 && (
          <NavRailCount $accent={options?.accentBadge}>{count}</NavRailCount>
        )}
      </NavRailItem>
    )
  }

  const mailboxRow = (
    mailbox: Mailbox,
    icon: React.ReactElement,
    labelOverride?: string,
    indentDepth = 0,
  ): React.ReactElement => {
    const query = boxQueryFor(mailbox)
    const active = navMailboxActive(mailbox)
    const count = countFor(query)
    const displayName =
      labelOverride ??
      (indentDepth > 0
        ? mailbox.name.split('/').filter(Boolean).at(-1) ?? mailbox.name
        : mailbox.name)
    return (
      <NavRailItem
        key={mailbox.id}
        {...mailboxAgentRefs(mailbox, labelOverride)}
        type="button"
        $active={active}
        aria-current={active ? 'true' : undefined}
        title={indentDepth > 0 ? mailbox.name : undefined}
        style={
          indentDepth > 0
            ? { paddingLeft: `calc(var(--pure-chrome-inset, 14px) + ${indentDepth * 14}px)` }
            : undefined
        }
        onClick={() => selectQuery(query)}
      >
        {icon}
        {displayName}
        {navUnseen(query)}
        {count > 0 && <NavRailCount>{count}</NavRailCount>}
      </NavRailItem>
    )
  }

  return (
    <NavRail aria-label="Mailboxes and views">
      <NavComposeButton type="button" onClick={openCompose}>
        <PenLine aria-hidden="true" />
        Compose
      </NavComposeButton>
      {/* Mail */}
      {inboxMailbox && (
        <NavRailItem
          {...mailboxAgentRefs(inboxMailbox, 'Inbox')}
          type="button"
          $active={navMailboxActive(inboxMailbox)}
          aria-current={navMailboxActive(inboxMailbox) ? 'true' : undefined}
          onClick={() => selectQuery(boxQueryFor(inboxMailbox))}
        >
          <Inbox aria-hidden="true" />
          Inbox
          {navUnseen(boxQueryFor(inboxMailbox))}
          {inboxUnread > 0 && (
            <NavRailCount $accent>{inboxUnread}</NavRailCount>
          )}
        </NavRailItem>
      )}
      {specialRow('starred', 'is:starred', 'Starred', <Star aria-hidden="true" />)}
      {specialRow('snoozed', 'is:snoozed', 'Snoozed', <Clock aria-hidden="true" />)}
      {specialRow(
        'waiting',
        'is:awaiting',
        'Waiting On',
        <Hourglass aria-hidden="true" />,
      )}
      {scheduledCount > 0 &&
        specialRow(
          'scheduled',
          'is:scheduled',
          'Scheduled',
          <Timer aria-hidden="true" />,
        )}

      {/* Smart Views */}
      <NavRailGroupDivider aria-hidden="true" />
      <NavRailSectionTitle>Smart Views</NavRailSectionTitle>
      {store.settings.screenerEnabled !== false &&
        specialRow(
          'screener',
          'is:screener',
          'Screener',
          <Shield aria-hidden="true" />,
          {
            countOverride: computedScreenerCount,
            accentBadge: computedScreenerCount > 0,
          },
        )}
      {specialRow(
        'feed',
        'is:newsletter',
        'Feed',
        <Newspaper aria-hidden="true" />,
      )}
      {specialRow(
        'paper_trail',
        'is:receipt',
        'Paper Trail',
        <Receipt aria-hidden="true" />,
      )}

      {/* Mailboxes */}
      <NavRailGroupDivider aria-hidden="true" />
      <NavRailSectionTitle>Mailboxes</NavRailSectionTitle>
      {(() => {
        const sent = mailboxByRole('sent')
        return sent ? mailboxRow(sent, <Send aria-hidden="true" />) : null
      })()}
      {(() => {
        const drafts = mailboxByRole('drafts')
        return drafts ? mailboxRow(drafts, <File aria-hidden="true" />) : null
      })()}
      {(() => {
        const archive = mailboxByRole('archive')
        return archive
          ? mailboxRow(archive, <Archive aria-hidden="true" />)
          : null
      })()}
      {(() => {
        const trash = mailboxByRole('trash')
        return trash ? mailboxRow(trash, <Trash2 aria-hidden="true" />) : null
      })()}

      {/* Workspace */}
      <NavRailGroupDivider aria-hidden="true" />
      <NavRailSectionTitle>Workspace</NavRailSectionTitle>
      {(() => {
        const inProgress = runs.filter(run => run.status !== 'done')
        const active = runsIndexActive || Boolean(activeRunId)
        return (
          <NavRailItem
            type="button"
            $active={active}
            aria-current={active ? 'true' : undefined}
            onClick={openRunsIndex}
          >
            <LayoutGrid aria-hidden="true" />
            Runs
            {inProgress.length > 0 && (
              <NavRailCount $accent={inProgress.some(run => run.status === 'running')}>
                {inProgress.length}
              </NavRailCount>
            )}
          </NavRailItem>
        )
      })()}
      {openSweeps ? (
        <NavRailItem
          type="button"
          $active={sweepsActive}
          aria-current={sweepsActive ? 'true' : undefined}
          onClick={openSweeps}
          title="Go through all your mail on the server, however old"
        >
          <SearchCheck aria-hidden="true" />
          Archive sweeps
        </NavRailItem>
      ) : null}
      {openNotes ? (
        <NavRailItem
          type="button"
          $active={notesActive}
          aria-current={notesActive ? 'true' : undefined}
          onClick={openNotes}
          title="Messages you have read and marked"
        >
          <NotebookPen aria-hidden="true" />
          Notes
          {notesCount > 0 && <NavRailCount>{notesCount}</NavRailCount>}
        </NavRailItem>
      ) : null}
      {openContext ? (
        <NavRailItem
          type="button"
          $active={contextActive}
          aria-current={contextActive ? 'true' : undefined}
          onClick={openContext}
          title="Messages kept as context for your assistants"
        >
          <Bookmark aria-hidden="true" />
          Context
          {contextCount > 0 && <NavRailCount>{contextCount}</NavRailCount>}
        </NavRailItem>
      ) : null}
      {runs.some(run => run.status !== 'done') && (
        <NavRailSectionTitle>Active Runs</NavRailSectionTitle>
      )}
      {runs
        .filter(run => run.status !== 'done')
        .slice(0, 6)
        .map(run => {
          const active = activeRunId === run.id
          return (
            <NavRailItem
              key={run.id}
              {...runAgentRefs(run)}
              type="button"
              $active={active}
              aria-current={active ? 'true' : undefined}
              title={`${run.name} · ${runStatusLabel(run)}`}
              onClick={() => openRun(run.id)}
            >
              <LayoutGrid aria-hidden="true" />
              {run.name}
              <NavRailCount>{runStatusLabel(run)}</NavRailCount>
            </NavRailItem>
          )
        })}

      {/* Collapsible Folders */}
      {customMailboxes.length > 0 && (
        <>
          <NavRailGroupDivider aria-hidden="true" />
          <NavRailSectionHeaderRow>
            <NavRailSectionToggle
              type="button"
              aria-expanded={!collapsedSections.folders}
              onClick={() => toggleSection('folders')}
            >
              {collapsedSections.folders ? (
                <ChevronRight aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
              Folders
            </NavRailSectionToggle>
          </NavRailSectionHeaderRow>
          {!collapsedSections.folders &&
            [...customMailboxes]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(mailbox => {
                const depth = Math.max(
                  0,
                  mailbox.name.split('/').filter(Boolean).length - 1,
                )
                return mailboxRow(
                  mailbox,
                  <Folder aria-hidden="true" />,
                  undefined,
                  Math.min(depth, 3),
                )
              })}
        </>
      )}

      {/* Collapsible Labels with inline + create */}
      {(store.labels.length > 0 || Boolean(createMailLabel)) && (
        <>
          <NavRailGroupDivider aria-hidden="true" />
          <NavRailSectionHeaderRow>
            <NavRailSectionToggle
              type="button"
              aria-expanded={!collapsedSections.labels}
              onClick={() => toggleSection('labels')}
            >
              {collapsedSections.labels ? (
                <ChevronRight aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
              Labels
            </NavRailSectionToggle>
            {createMailLabel && (
              <NavRailInlineAddBtn
                type="button"
                aria-label="Create label"
                title="Create label"
                onClick={() => {
                  if (collapsedSections.labels) toggleSection('labels')
                  setAddingLabel(open => !open)
                }}
              >
                <Plus size={12} aria-hidden="true" />
              </NavRailInlineAddBtn>
            )}
          </NavRailSectionHeaderRow>
          {addingLabel && createMailLabel && (
            <div style={{ padding: '4px 12px 6px', display: 'flex', gap: 4 }}>
              <input
                autoFocus
                value={newLabelDraft}
                aria-label="New label name"
                placeholder="Label name…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 24,
                  padding: '0 7px',
                  border: '1px solid var(--n-line)',
                  borderRadius: 3,
                  background: 'var(--n-sheet)',
                  color: 'var(--n-ink)',
                  fontSize: 12,
                }}
                onChange={event => setNewLabelDraft(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitNewLabel()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setAddingLabel(false)
                    setNewLabelDraft('')
                  }
                }}
                onBlur={() => {
                  if (!newLabelDraft.trim()) setAddingLabel(false)
                }}
              />
            </div>
          )}
          {!collapsedSections.labels &&
            store.labels.map(label => {
              const query = `label:${quoteQueryValue(label.name)}`
              const active =
                selectedSpecialView?.kind === 'label' &&
                selectedSpecialView.labelId === label.id
              const count = countFor(query)
              return (
                <NavRailItem
                  key={label.id}
                  {...labelAgentRefs(label)}
                  type="button"
                  $active={active}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectQuery(query)}
                >
                  <NavRailLabelDot $color={label.color} aria-hidden="true" />
                  {label.name}
                  {navUnseen(query)}
                  {count > 0 && <NavRailCount>{count}</NavRailCount>}
                </NavRailItem>
              )
            })}
        </>
      )}

      {/* Collapsible Saved Views */}
      {visibleSavedViews.length > 0 && (
        <>
          <NavRailGroupDivider aria-hidden="true" />
          <NavRailSectionHeaderRow>
            <NavRailSectionToggle
              type="button"
              aria-expanded={!collapsedSections.views}
              onClick={() => toggleSection('views')}
            >
              {collapsedSections.views ? (
                <ChevronRight aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              )}
              Views
            </NavRailSectionToggle>
          </NavRailSectionHeaderRow>
          {!collapsedSections.views &&
            visibleSavedViews.map(view => {
              const active = currentQuery === view.query
              const count = countThreadQuery(store, selectedAccount?.id, view.query)
              return (
                <NavRailItem
                  key={view.id}
                  {...viewAgentRefs(view)}
                  type="button"
                  $active={active}
                  aria-current={active ? 'true' : undefined}
                  title={view.query}
                  onClick={() => selectQuery(view.query)}
                >
                  <Search aria-hidden="true" />
                  {view.name}
                  {navUnseen(view.query)}
                  {count > 0 && <NavRailCount>{count}</NavRailCount>}
                </NavRailItem>
              )
            })}
        </>
      )}
      {unsubscribeCount > 0 && (
        <>
          <NavRailGroupDivider aria-hidden="true" />
          <NavRailItem
            type="button"
            aria-haspopup="dialog"
            onClick={openUnsubscribeDrawer}
          >
            <MailMinus aria-hidden="true" />
            Unsubscribe
            <NavRailCount>{unsubscribeCount}</NavRailCount>
          </NavRailItem>
        </>
      )}
    </NavRail>
  )
}
