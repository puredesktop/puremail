import { useEffect, useMemo, useRef, useState } from 'react'
import { createGlobalStyle, styled } from 'styled-components'
import { threadAgentRefs } from '../lib/agentRefs'
import { unreadThreadIds } from '../lib/mailListFilters'
import { resolveThreadQuery } from '../lib/mailQuery'
import type { MailContact, MailStore } from '../types'
import { formatThreadListTime } from './mailShellHelpers'
import {
  AskPanel,
  AgentSearchRow,
  ComposeContextStrip,
  ComposeDockIconButton,
  ComposeDockSendLater,
  ComposeDockToolbar,
  ComposeFooter,
  ComposeHeader,
  ComposeScreen,
  ComposeToolbar,
  DockedTaskDrawer,
  FilterChipRow,
  KbdChip,
  ListHeaderBar,
  ListPositionBar,
  MailBodyRow,
  MailFrame,
  MailStateChip,
  MailStatusBar,
  MailTopBar,
  Meta,
  NavRail,
  ReaderBackButton,
  ReaderDetailsButton,
  ReaderHeaderBand,
  ReaderSenderAvatar,
  ReaderSenderReply,
  ReaderSenderTo,
  ReaderStateChip,
  ReaderStateLine,
  ReaderTaskChip,
  ReaderTimestamp,
  ReaderToolbar,
  ReaderToolbarButton,
  ReaderToolbarPrimary,
  ReaderToolbarSwap,
  ReaderToolbarSwapLayer,
  Title,
  ToolbarDivider,
  MessageCard,
} from './mailShellStyles'

/**
 * Mail in the Executive room: one question on sight, what is in my inbox that I
 * should look at. CompactInbox answers it, an opened thread or draft fills the box.
 *
 * This sheet exists only while compact is on, so the full app carries none of
 * it. It hides with CSS rather than unmounting, and the full app's view lives in
 * its own state (useRoomSlot), so growing to the whole app finds it as it was.
 *
 * Kept on purpose, because hiding them could mislead before a send: Cc and Bcc,
 * attachment chips, send reminders, banners, mail recovery and toasts.
 *
 * ReaderToolbarPrimary is styled(ReaderToolbarButton) and so carries that
 * class too: every rule on the button has to exclude it, or Reply goes as well.
 */
export const CompactInRoomStyle = createGlobalStyle`
  ${MailFrame}[data-compact-in-room] {
    --puremail-page-width: min(680px, calc(100% - 32px));
    --puremail-page-shadow: none;
    --puremail-panel-shadow: none;
    --page-shadow: none;
  }

  /* White ground, as the room's paper. Dark mode keeps the theme's own ground. */
  :root:not([data-platform-theme='dark']) ${MailFrame}[data-compact-in-room] {
    --canvas: #ffffff;
    --glass-panel: #ffffff;
    --pure-page: #ffffff;
    --pure-chrome-bar: #ffffff;
    --pure-chrome-well: #ffffff;
    --pure-chrome-sidebar: #ffffff;
    --puremail-pane-bg: #ffffff;
    --puremail-pane-header-bg: #ffffff;
    --puremail-reader-bg: #ffffff;
    --puremail-message-bg: #ffffff;
    --puremail-empty-surface: #ffffff;
    background: #ffffff;
  }

  /* The held look: calm enterprise, one muted accent, hairlines, sans throughout. Navy replaces the app's brand colour for
     its primary buttons, and a slate for the rest of what the accent coloured. Dark mode keeps the theme's own. */
  :root:not([data-platform-theme='dark']) ${MailFrame}[data-compact-in-room] {
    --pure-chrome-accent: #1f3a5f;
    --pure-chrome-on-accent: #ffffff;
    --puremail-accent: #2f5d8c;
    --pure-chrome-line: #dde1e7;
    --pure-chrome-hover: #f5f6f8;
  }

  /* Reading a thread: the state line is plain sans, not an uppercase tag and monospace figures. */
  [data-compact-in-room] ${ReaderHeaderBand} {
    padding: 14px 24px;
  }
  [data-compact-in-room] ${ReaderStateLine} {
    font-family: inherit;
    font-size: 12px;
  }
  [data-compact-in-room] ${ReaderStateChip} {
    padding: 0;
    background: none;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
  [data-compact-in-room] ${ReaderTimestamp},
  [data-compact-in-room] ${ReaderSenderTo},
  [data-compact-in-room] ${ReaderDetailsButton},
  [data-compact-in-room] ${MailStateChip} {
    font-family: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  [data-compact-in-room] ${MailStateChip} {
    font-weight: 500;
  }
  [data-compact-in-room] ${Title} {
    margin-bottom: 8px;
    font-size: 15px;
    line-height: 1.35;
  }
  [data-compact-in-room] ${ReaderSenderAvatar} {
    display: none;
  }
  /* Reply sits twice, in the bar and on the message: the one in the bar is the primary, this one is the quiet copy. */
  [data-compact-in-room] ${ReaderSenderReply} {
    height: 28px;
    margin-left: 0;
    border: 1px solid #cdd1d7;
    background: #ffffff;
    color: var(--platform-colors-text);
    font-size: 12px;
    font-weight: 500;
  }
  [data-compact-in-room] ${ReaderSenderReply}:hover {
    background: #f5f6f8;
    filter: none;
  }
  [data-compact-in-room] ${ReaderToolbarButton} {
    height: 28px;
  }
  [data-compact-in-room] ${MessageCard} p {
    font-size: 14px;
    line-height: 1.55;
  }

  /* Square edges, as the room. */
  [data-compact-in-room],
  [data-compact-in-room] * {
    border-radius: 0 !important;
  }

  /* Chrome around the mail. */
  [data-compact-in-room] ${MailTopBar},
  [data-compact-in-room] ${NavRail},
  [data-compact-in-room] ${ListHeaderBar},
  [data-compact-in-room] ${FilterChipRow},
  [data-compact-in-room] ${AgentSearchRow},
  [data-compact-in-room] ${DockedTaskDrawer},
  [data-compact-in-room] ${ListPositionBar},
  [data-compact-in-room] [data-mail-scroll]:not([data-compact-keep]),
  [data-compact-in-room] ${MailStatusBar}:not([data-compact-keep]) {
    display: none !important;
  }

  /* Mail recovery, opened from a toast, sits under the inbox and never crowds it out. */
  [data-compact-in-room] [data-mail-scroll][data-compact-keep] {
    flex: 0 1 auto;
    max-height: 60%;
  }

  /* The thread: Back and Reply, then the reading. */
  [data-compact-in-room] ${ReaderToolbar} > *:not(${ReaderBackButton}):not(${ReaderToolbarSwap}),
  [data-compact-in-room] ${ReaderToolbarSwapLayer} ${ReaderToolbarButton}:not(${ReaderToolbarPrimary}),
  [data-compact-in-room] ${ReaderToolbarSwapLayer} > ${ToolbarDivider},
  [data-compact-in-room] ${ReaderToolbarSwapLayer} > ${MailStateChip},
  [data-compact-in-room] ${ReaderTaskChip},
  [data-compact-in-room] ${AskPanel},
  [data-compact-in-room] ${ReaderStateLine} > div:has([aria-label='Triage verdict']) {
    display: none !important;
  }
  /* The arrow says its word. The button's tooltip is that same ::after, made plain here. */
  [data-compact-in-room] ${ReaderBackButton} {
    padding: 0 8px 0 4px;
    color: var(--platform-colors-text);
    font-size: 13px;
    font-weight: 500;
  }
  [data-compact-in-room] ${ReaderBackButton}[aria-label]::after {
    content: 'Back';
    position: static;
    padding: 0;
    transform: none;
    background: none;
    color: inherit;
    font: inherit;
    opacity: 1;
    visibility: visible;
    transition: none;
  }

  /* The compose window fills the box; the run card's copy of it is not this one. */
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] {
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    border-width: 0;
    box-shadow: none;
  }
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] button[aria-label='Minimize'],
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] button[aria-label='Open full screen'],
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] ${ComposeContextStrip},
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] ${ComposeDockToolbar},
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] ${ComposeDockSendLater},
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] ${ComposeDockIconButton},
  [data-compact-in-room] ${MailBodyRow} > [data-puremail-compose-dock] ${KbdChip} {
    display: none !important;
  }

  /* A composer left full screen before the split: the same few controls. */
  [data-compact-in-room] ${ComposeScreen} ${ComposeHeader} ${Meta},
  [data-compact-in-room] ${ComposeScreen} ${ComposeContextStrip},
  [data-compact-in-room] ${ComposeScreen} ${ComposeToolbar},
  [data-compact-in-room] ${ComposeScreen} ${ComposeFooter} > *:not(:last-child) {
    display: none !important;
  }
`

const ROW_HEIGHT = 72
const PREVIEW_LENGTH = 140

const Inbox = styled.section`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
`

const Heading = styled.header`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--pure-chrome-line);
`

const HeadingText = styled.h2`
  margin: 0;
  color: var(--platform-colors-text);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`

const NewMessage = styled.button`
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 0;
  background: var(--pure-chrome-accent);
  color: var(--pure-chrome-on-accent);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;

  &:hover {
    filter: brightness(0.94);
  }
`

const Rows = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
`
const Pager = styled.nav`
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-top: 1px solid #e3e5e9;
  background: #ffffff;
  font-size: 12px;
  color: #4f5661;
  span { margin-right: auto; }
`
const PagerButton = styled.button`
  height: 26px;
  padding: 0 10px;
  border: 1px solid #cdd1d7;
  border-radius: 3px;
  background: #ffffff;
  color: #1f2328;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #f3f4f6; }
  &:disabled { opacity: .4; cursor: default; }
`

const Row = styled.button<{ $unread: boolean }>`
  display: grid;
  width: 100%;
  height: ${ROW_HEIGHT}px;
  box-sizing: border-box;
  grid-template-columns: minmax(0, 1fr) auto;
  align-content: center;
  gap: 1px 12px;
  padding: 0 16px;
  border: 0;
  border-bottom: 1px solid var(--pure-chrome-line);
  background: transparent;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.35;
  text-align: left;

  ${({ $unread }) =>
    $unread
      ? `
    > span:not(:last-child) {
      color: var(--platform-colors-text);
      font-weight: 600;
    }
  `
      : ''}

  &:hover {
    background: var(--pure-chrome-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent);
    outline-offset: -2px;
  }
`

const Line = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Sender = styled(Line)``

const When = styled(Line)`
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`

const Subject = styled(Line)`
  grid-column: 1 / -1;
`

const Preview = styled(Line)`
  grid-column: 1 / -1;
  font-size: 12px;
`

const Nothing = styled.p`
  margin: 0;
  padding: 24px 16px;
  color: var(--platform-colors-text-secondary);
  font-size: 13px;
`

function senderName(contact: MailContact | undefined): string {
  return contact?.name?.trim() || contact?.email?.trim() || 'Unknown sender'
}

function previewText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_LENGTH)
}

/**
 * Always the account's Inbox, newest first, whatever the full app last showed.
 * It reads the store directly and never the shell's query or filter. The one thing that
 * changes it is words the page holding it asked to search for, until the person goes back.
 */
export function CompactInbox({
  store,
  accountId,
  onOpen,
  onNewMessage,
  search = '',
  onShowInbox,
}: {
  store: MailStore
  accountId: string | undefined
  onOpen: (threadId: string) => void
  onNewMessage: () => void
  search?: string
  onShowInbox?: () => void
}): React.ReactElement {
  const searching = search.trim().length > 0
  const entries = resolveThreadQuery(store, accountId, searching ? search : 'in:inbox').entries
  const unread = useMemo(() => unreadThreadIds(store), [store])
  const isUnread = (threads: ReadonlyArray<{ id: string }>): boolean => threads.some(thread => unread.has(thread.id))
  const unreadCount = entries.filter(entry => isUnread(entry.threads)).length
  const ownAddress = store.accounts.find(account => account.id === accountId)?.email?.toLowerCase()
  /** The newest message to reach the person in each thread: who wrote, and a preview if the thread has no summary. */
  const newest = useMemo(() => {
    const byThread = new Map<string, MailStore['messages'][number]>()
    for (const message of store.messages) {
      if (message.isDraft || message.from?.email?.toLowerCase() === ownAddress) continue
      const held = byThread.get(message.threadId)
      if (!held || message.receivedAt > held.receivedAt) byThread.set(message.threadId, message)
    }
    return byThread
  }, [store.messages, ownAddress])
  const draftIds = useMemo(() => {
    const byThread = new Map<string, string[]>()
    for (const draft of store.drafts) {
      if (!draft.sentAt) byThread.set(draft.threadId, [...(byThread.get(draft.threadId) ?? []), draft.id])
    }
    return byThread
  }, [store.drafts])

  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 0 })
  const measure = (): void => {
    const node = scroller.current
    if (node) setView({ top: node.scrollTop, height: node.clientHeight })
  }
  useEffect(() => {
    measure()
    const node = scroller.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  // one page at a time, as many rows as fit: a list that scrolled inside the room's own scrolling would trap the wheel
  const perPage = Math.max(1, Math.floor(view.height / ROW_HEIGHT) || 8)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [search])
  const lastPage = Math.max(0, Math.ceil(entries.length / perPage) - 1)
  const shownPage = Math.min(page, lastPage)
  const start = shownPage * perPage
  const end = Math.min(entries.length, start + perPage)

  return (
    <Inbox aria-label={searching ? 'Search results' : 'Inbox'}>
      <Heading>
        <HeadingText>
          {searching
            ? `${entries.length} ${entries.length === 1 ? 'conversation matches' : 'conversations match'} “${search.trim()}”`
            : unreadCount > 0 ? `Inbox · ${unreadCount} unread` : 'Inbox'}
        </HeadingText>
        {searching && onShowInbox ? (
          <NewMessage type="button" onClick={onShowInbox}>
            Show inbox
          </NewMessage>
        ) : (
          <NewMessage type="button" onClick={onNewMessage}>
            New message
          </NewMessage>
        )}
      </Heading>
      <Rows ref={scroller}>
        {entries.length === 0 ? (
          <Nothing>{searching ? `Nothing in your mail matches “${search.trim()}”.` : 'Nothing in your inbox.'}</Nothing>
        ) : (
          <div>
            {entries.slice(start, end).map(entry => {
              const { thread } = entry
              const latest = newest.get(thread.id)
              return (
                <Row
                  key={thread.id}
                  {...threadAgentRefs(thread, draftIds.get(thread.id))}
                  type="button"
                  $unread={isUnread(entry.threads)}
                  onClick={() => onOpen(thread.id)}
                >
                  <Sender>{senderName(latest?.from ?? thread.participants[0])}</Sender>
                  <When>{formatThreadListTime(entry.sortAt)}</When>
                  <Subject>{thread.subject || '(no subject)'}</Subject>
                  <Preview>{previewText(thread.summary || latest?.body || '')}</Preview>
                </Row>
              )
            })}
          </div>
        )}
      </Rows>
      {entries.length > perPage && (
        <Pager aria-label={searching ? 'Search pages' : 'Inbox pages'}>
          <span>{start + 1}–{end} of {entries.length}</span>
          <PagerButton type="button" aria-label="Newer messages" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>‹ Newer</PagerButton>
          <PagerButton type="button" aria-label="Older messages" disabled={shownPage === lastPage} onClick={() => setPage(shownPage + 1)}>Older ›</PagerButton>
        </Pager>
      )}
    </Inbox>
  )
}
