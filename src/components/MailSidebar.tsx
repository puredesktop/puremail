import { useMemo } from 'react'
import {
  Archive,
  Clock,
  File,
  Folder,
  Inbox,
  LayoutGrid,
  MailMinus,
  PenLine,
  Search,
  Send,
  Star,
  Timer,
  Trash2,
} from 'lucide-react'
import {
  countThreadQuery,
  markQuerySeen,
  unseenArrivalCount,
  parseMailQuery,
  quoteQueryValue,
  resolveThreadQuery,
} from '../lib/mailQuery'
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
  NavRailItem,
  NavRailLabelDot,
  NavRailSectionTitle,
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
  openRun: (runId: string) => void
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
  openRun,
}: MailSidebarProps): React.ReactElement {
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
    kind: 'starred' | 'snoozed' | 'scheduled',
    query: string,
    label: string,
    icon: React.ReactElement,
  ): React.ReactElement => {
    const active = selectedSpecialView?.kind === kind
    const count = countFor(query)
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
        {count > 0 && <NavRailCount>{count}</NavRailCount>}
      </NavRailItem>
    )
  }

  const mailboxRow = (
    mailbox: Mailbox,
    icon: React.ReactElement,
    labelOverride?: string,
  ): React.ReactElement => {
    const query = boxQueryFor(mailbox)
    const active = navMailboxActive(mailbox)
    const count = countFor(query)
    return (
      <NavRailItem
        key={mailbox.id}
        type="button"
        $active={active}
        aria-current={active ? 'true' : undefined}
        onClick={() => selectQuery(query)}
      >
        {icon}
        {labelOverride ?? mailbox.name}
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
      {inboxMailbox && (
        <NavRailItem
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
      {(() => {
        const sent = mailboxByRole('sent')
        return sent ? mailboxRow(sent, <Send aria-hidden="true" />) : null
      })()}
      {(() => {
        const drafts = mailboxByRole('drafts')
        return drafts ? mailboxRow(drafts, <File aria-hidden="true" />) : null
      })()}
      {(() => {
        // Runs sit under Drafts: a paused run is one click away. The row
        // opens the index; the section below lists runs in progress.
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
      {scheduledCount > 0 &&
        specialRow(
          'scheduled',
          'is:scheduled',
          'Scheduled',
          <Timer aria-hidden="true" />,
        )}
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
      {runs.some(run => run.status !== 'done') && (
        <NavRailSectionTitle>Runs</NavRailSectionTitle>
      )}
      {runs
        .filter(run => run.status !== 'done')
        .slice(0, 6)
        .map(run => {
          const active = activeRunId === run.id
          return (
            <NavRailItem
              key={run.id}
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
      {customMailboxes.length > 0 && (
        <NavRailSectionTitle>Folders</NavRailSectionTitle>
      )}
      {customMailboxes.map(mailbox =>
        mailboxRow(mailbox, <Folder aria-hidden="true" />),
      )}
      {store.labels.length > 0 && (
        <NavRailSectionTitle>Labels</NavRailSectionTitle>
      )}
      {store.labels.map(label => {
        const query = `label:${quoteQueryValue(label.name)}`
        const active =
          selectedSpecialView?.kind === 'label' &&
          selectedSpecialView.labelId === label.id
        const count = countFor(query)
        return (
          <NavRailItem
            key={label.id}
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
      {visibleSavedViews.length > 0 && (
        <NavRailSectionTitle>Views</NavRailSectionTitle>
      )}
      {visibleSavedViews.map(view => {
        const active = currentQuery === view.query
        const count = countThreadQuery(store, selectedAccount?.id, view.query)
        return (
          <NavRailItem
            key={view.id}
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
      {unsubscribeCount > 0 && (
        <NavRailItem
          type="button"
          aria-haspopup="dialog"
          onClick={openUnsubscribeDrawer}
        >
          <MailMinus aria-hidden="true" />
          Unsubscribe
          <NavRailCount>{unsubscribeCount}</NavRailCount>
        </NavRailItem>
      )}
    </NavRail>
  )
}
