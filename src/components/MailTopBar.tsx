import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  Columns2,
  List,
  PanelBottom,
  RefreshCw,
  Rows2,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import {
  mailCommandsForQuery,
  type MailCommandId,
} from '../lib/mailCommands'
import {
  buildMailQuery,
  deleteMailView,
  parseMailQuery,
  renameMailView,
  saveMailView,
  type MailQueryTerm,
} from '../lib/mailQuery'
import type {
  MailAccount,
  MailProvider,
  MailStore,
  MailThread,
} from '../types'
import {
  BulkMenuItem,
  BulkMenuWrap,
  KbdChip,
  LayoutSwitcherBtn,
  LayoutSwitcherGroup,
  ListButton,
  MailTopBar as TopBarShellStyle,
  Meta,
  RecipientChip,
  SearchResults,
  SearchToolbar,
  SearchSectionTitle,
  SearchResultHeading,
  SearchResultDetail,
  Subject,
  ThreadActionsMenu,
  TopAccountAvatar,
  TopAccountChip,
  TopBarIconButton,
  TopBarSpacer,
  TopSearchField,
  TopSearchInput,
  TopSearchPanel,
  TopSearchWrap,
} from './mailShellStyles'
import { formatDate } from './mailShellHelpers'
import { SearchFilterBuilder } from './SearchFilterBuilder'
import { useOutsideClose } from './useOutsideClose'
import { type MailDensity, type ReadingPaneLayout } from './mailShellLayout'

export interface MailTopBarProps {
  store: MailStore
  selectedAccount: MailAccount | null
  selectedAccountId: string
  switchAccount: (accountId: string) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  searchPanelOpen: boolean
  setSearchPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  currentQuery: string
  setCurrentQuery: React.Dispatch<React.SetStateAction<string>>
  setStore: React.Dispatch<React.SetStateAction<MailStore>>
  runMailCommand: (command: MailCommandId) => void
  openThread: (threadId: string, messageId?: string | null) => void
  /** Raw-query provider search; null when no remote provider is active. */
  searchGmail:
    | ((query: string) => Promise<
        Array<{
          id: string
          type: 'thread' | 'message' | 'task' | 'attachment'
          title: string
        }>
      >)
    | null
  /**
   * Server-side search past the local fetch window — the SAME function the
   * searchAllMail agent tool calls. Null when the provider cannot search
   * remotely.
   */
  searchAllMail: NonNullable<MailProvider['searchThreadSummaries']> | null
  /** Fetch a remote-only search hit into the store so it can be opened. */
  importRemoteThread:
    | ((
        threadId: string,
      ) => Promise<{ threads: MailThread[]; messages: unknown[] } | null>)
    | null
  refreshMail: (trigger?: 'manual' | 'auto') => Promise<void>
  mailFetching: boolean
  mailFetchDisabled: boolean
  density: MailDensity
  setDensity: (density: MailDensity) => void
  readingPaneLayout?: ReadingPaneLayout
  setReadingPaneLayout?: (layout: ReadingPaneLayout) => void
  onOpenFocusTriage?: () => void
  onOpenCommandPalette?: () => void
  onCreateFilterFromSearch?: (query: string) => void
  connectionControl?: React.ReactNode
  openCalendar?: () => void
  openSettings: () => void
  openRecovery?: () => void
}

function accountInitials(account: MailAccount | null): string {
  const source = account?.name?.trim() || account?.email?.trim() || ''
  if (!source) return '?'
  const words = source.split(/[\s._@-]+/).filter(Boolean)
  const initials = words
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('')
  return initials || source[0].toUpperCase()
}

/**
 * The 50px bar over rail and content: Mail mark, the permanent search field
 * (⌘K), fetch-now, density, settings, and the account chip. The search field
 * replaces the old sidebar search drawer as the entry point — same local
 * query resolution, same "Search all mail" server action, results in a
 * dropdown panel under the field.
 */
export function MailTopBar({
  store,
  selectedAccount,
  selectedAccountId,
  switchAccount,
  searchInputRef,
  searchPanelOpen,
  setSearchPanelOpen,
  currentQuery,
  setCurrentQuery,
  setStore,
  runMailCommand,
  openThread,
  searchGmail,
  searchAllMail,
  importRemoteThread,
  refreshMail,
  mailFetching,
  mailFetchDisabled,
  density,
  setDensity,
  readingPaneLayout,
  setReadingPaneLayout,
  onOpenFocusTriage,
  onOpenCommandPalette,
  onCreateFilterFromSearch,
  openCalendar,
  openSettings,
  connectionControl,
  openRecovery,
}: MailTopBarProps): React.ReactElement {
  const [builderOpen, setBuilderOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClose(accountMenuRef, accountMenuOpen, () =>
    setAccountMenuOpen(false),
  )
  const [remoteResults, setRemoteResults] = useState<
    Array<{ id: string; type: string; title: string }>
  >([])
  // The search box edits a DRAFT that starts blank every time the panel
  // opens: search is something you type, not the current view's query echoed
  // back for you to fight with. Nothing commits until the user has actually
  // typed; a search cleared back to empty returns to the inbox.
  const [draftQuery, setDraftQueryState] = useState('')
  const draftDirtyRef = useRef(false)
  const setDraftQuery = (
    value: string | ((current: string) => string),
  ): void => {
    draftDirtyRef.current = true
    setDraftQueryState(value)
  }
  const searchWrapRef = useRef<HTMLDivElement>(null)
  useOutsideClose(searchWrapRef, searchPanelOpen, () =>
    setSearchPanelOpen(false),
  )
  const isBareNavigationQuery = (query: string): boolean => {
    const trimmed = query.trim().toLowerCase()
    return (
      !trimmed ||
      trimmed === 'in:inbox' ||
      trimmed === 'in:sent' ||
      trimmed === 'in:archive' ||
      trimmed === 'in:trash' ||
      trimmed === 'in:drafts' ||
      trimmed === 'is:starred' ||
      trimmed === 'is:snoozed' ||
      trimmed === 'is:awaiting' ||
      trimmed === 'is:screener' ||
      trimmed === 'is:newsletter' ||
      trimmed === 'is:receipt'
    )
  }
  const recordRecentSearch = (query: string): void => {
    const clean = query.trim()
    if (!clean || isBareNavigationQuery(clean)) return
    setStore(current => {
      const existing = current.settings.recentSearches ?? []
      const next = [
        clean,
        ...existing.filter(item => item.toLowerCase() !== clean.toLowerCase()),
      ].slice(0, 8)
      return {
        ...current,
        settings: {
          ...current.settings,
          recentSearches: next,
        },
      }
    })
  }
  const accountFolderNames = useMemo(
    () =>
      store.mailboxes
        .filter(mailbox => !selectedAccountId || mailbox.accountId === selectedAccountId)
        .map(mailbox => mailbox.name),
    [store.mailboxes, selectedAccountId],
  )
  const labelNames = useMemo(
    () => store.labels.map(label => label.name),
    [store.labels],
  )
  useEffect(() => {
    if (!searchPanelOpen) {
      setDraftQueryState(isBareNavigationQuery(currentQuery) ? '' : currentQuery)
      draftDirtyRef.current = false
      setBuilderOpen(false)
    }
  }, [searchPanelOpen, currentQuery])
  useEffect(() => {
    if (!draftDirtyRef.current) return
    const target = draftQuery.trim() ? draftQuery : 'in:inbox'
    if (target === currentQuery) return
    const timeout = window.setTimeout(() => setCurrentQuery(target), 250)
    return () => window.clearTimeout(timeout)
  }, [draftQuery, currentQuery, setCurrentQuery])

  // Provider passthrough: the free text goes to the server verbatim so the
  // user can see what exists remotely but not on this device.
  const queryFreeText = useMemo(
    () => parseMailQuery(currentQuery).text,
    [currentQuery],
  )
  useEffect(() => {
    if (!searchGmail || !queryFreeText.trim()) {
      setRemoteResults([])
      return
    }
    let cancelled = false
    const timeout = window.setTimeout(() => {
      searchGmail(queryFreeText)
        .then(results => {
          if (!cancelled) setRemoteResults(results)
        })
        .catch(() => {
          if (!cancelled) setRemoteResults([])
        })
    }, 450)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [queryFreeText, searchGmail])

  type AllMailResult = Awaited<
    ReturnType<NonNullable<MailProvider['searchThreadSummaries']>>
  >[number]
  // "Search all mail" is explicit, not typeahead: a server round-trip the
  // user asks for, rendering below the local results. null = not asked yet.
  const [allMailResults, setAllMailResults] = useState<AllMailResult[] | null>(
    null,
  )
  const [allMailPending, setAllMailPending] = useState(false)
  const [allMailError, setAllMailError] = useState('')
  const [openingThread, setOpeningThread] = useState<string | null>(null)
  const searchGeneration = useRef(0)
  const allMailQuery = (draftDirtyRef.current ? draftQuery : currentQuery).trim()
  useEffect(() => {
    // Ignore answers from earlier queries, including edits before debounce.
    searchGeneration.current += 1
    setAllMailPending(false)
    setOpeningThread(null)
    setAllMailResults(null)
    setAllMailError('')
  }, [allMailQuery, searchPanelOpen, selectedAccountId])
  const runAllMailSearch = (): void => {
    if (!searchAllMail || allMailPending) return
    const query = allMailQuery
    if (!query) return
    const generation = ++searchGeneration.current
    setAllMailPending(true)
    setAllMailResults(null)
    setAllMailError('')
    searchAllMail(query, 20)
      .then(results => { if (generation === searchGeneration.current) setAllMailResults(results) })
      .catch(error => {
        if (generation === searchGeneration.current) setAllMailError(error instanceof Error ? error.message : 'Search failed.')
      })
      .finally(() => { if (generation === searchGeneration.current) setAllMailPending(false) })
  }
  const openResultThread = (threadId: string): void => {
    setSearchPanelOpen(false)
    openThread(threadId)
  }
  const openAllMailResult = (result: AllMailResult): void => {
    if (result.inLocalWindow) {
      openResultThread(result.threadId)
      return
    }
    if (!importRemoteThread || openingThread) return
    const generation = searchGeneration.current
    setOpeningThread(result.threadId)
    setAllMailError('')
    void importRemoteThread(result.threadId)
      .then(fragment => {
        if (generation !== searchGeneration.current) return
        if (!fragment?.threads.length || !fragment.messages.length) throw new Error('The server message could not be loaded. Search again to retry.')
        openResultThread(fragment.threads[0].id)
      })
      .catch(error => {
        if (generation === searchGeneration.current) setAllMailError(error instanceof Error ? error.message : 'Could not fetch thread.')
      })
      .finally(() => { if (generation === searchGeneration.current) setOpeningThread(null) })
  }

  const applySearchQuery = (nextQuery: string): void => {
    const clean = nextQuery.trim() || 'in:inbox'
    draftDirtyRef.current = false
    setDraftQueryState(isBareNavigationQuery(clean) ? '' : clean)
    setCurrentQuery(clean)
    recordRecentSearch(clean)
  }

  const activeQueryChips = useMemo(() => {
    const parsed = parseMailQuery(currentQuery)
    return parsed.terms.map((term, index) => ({
      key: `${term.field}-${term.value}-${index}`,
      label: `${term.negated ? '-' : ''}${term.field}:${term.value}`,
      term,
    }))
  }, [currentQuery])

  const savedViewForQuery = (store.savedViews ?? []).find(
    view => view.query === currentQuery,
  )
  const removeQueryChip = (chip: { term: MailQueryTerm }): void => {
    const parsed = parseMailQuery(currentQuery)
    const nextQuery = buildMailQuery({
      ...parsed,
      terms: parsed.terms.filter(
        term =>
          !(
            term.field === chip.term.field &&
            term.value === chip.term.value &&
            term.negated === chip.term.negated
          ),
      ),
    })
    draftDirtyRef.current = false
    setDraftQueryState(isBareNavigationQuery(nextQuery) ? '' : nextQuery)
    setCurrentQuery(nextQuery)
  }
  // Armed naming instead of window.prompt: prompt() silently no-ops inside
  // the sandboxed shell iframe, so "Save as view" would look dead there.
  const [viewNameDraft, setViewNameDraft] = useState<string | null>(null)
  const [viewNameError, setViewNameError] = useState<string | null>(null)
  const submitViewName = (): void => {
    if (!viewNameDraft) return
    const trimmed = viewNameDraft.trim()
    if (!trimmed) return
    if (
      savedViewForQuery &&
      (store.savedViews ?? []).some(
        view =>
          view.id !== savedViewForQuery.id &&
          view.name.trim().toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      setViewNameError('A saved view with that name already exists.')
      return
    }
    setStore(current =>
      savedViewForQuery
        ? renameMailView(current, savedViewForQuery.id, trimmed, currentQuery)
        : saveMailView(current, trimmed, currentQuery),
    )
    setViewNameError(null)
    setViewNameDraft(null)
  }
  const commandResults = mailCommandsForQuery(queryFreeText)

  return (
    <TopBarShellStyle>
      {/* No wordmark here: the shell's identity header above already carries
          the tinted PureMail brand — the office-family rule is one brand per
          window, worn by the shell. */}
      <TopSearchWrap ref={searchWrapRef}>
        <TopSearchField>
          <Search aria-hidden="true" />
          <TopSearchInput
            ref={searchInputRef}
            value={draftQuery}
            placeholder="Search mail — sender, subject, label:travel, has:attachment…"
            aria-label="Search mail"
            aria-expanded={searchPanelOpen}
            aria-controls="puremail-search-panel"
            onFocus={() => setSearchPanelOpen(true)}
            onChange={event => setDraftQuery(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applySearchQuery(draftQuery)
                return
              }
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              setSearchPanelOpen(false)
              event.currentTarget.blur()
            }}
          />
          {onOpenCommandPalette ? (
            <KbdChip
              as="button"
              type="button"
              aria-label="Open command palette"
              title="Open command palette (⌘K)"
              style={{ cursor: 'pointer', border: '1px solid var(--n-line)' }}
              onClick={event => {
                event.stopPropagation()
                setSearchPanelOpen(false)
                onOpenCommandPalette()
              }}
            >
              ⌘K
            </KbdChip>
          ) : (
            <KbdChip aria-hidden="true">⌘K</KbdChip>
          )}
        </TopSearchField>
        {searchPanelOpen && (
          <TopSearchPanel id="puremail-search-panel">
            <SearchToolbar>
              <Button
                size="sm"
                variant="subtle"
                data-popover-trigger=""
                aria-expanded={builderOpen}
                aria-label="Query operators"
                onClick={() => setBuilderOpen(open => !open)}
              >
                <SlidersHorizontal aria-hidden="true" size={13} /> operators
              </Button>

              {activeQueryChips.length > 0 &&
                activeQueryChips.map(chip => (
                  <RecipientChip key={chip.key}>
                    <span>{chip.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${chip.label}`}
                      onClick={() => removeQueryChip(chip)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </RecipientChip>
                ))}
              {currentQuery !== 'in:inbox' && (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    draftDirtyRef.current = false
                    setDraftQueryState('')
                    setCurrentQuery('in:inbox')
                  }}
                >
                  Clear all
                </Button>
              )}
              {viewNameDraft === null ? (
                <Button
                  size="sm"
                  disabled={!currentQuery.trim()}
                  onClick={() => {
                    setViewNameError(null)
                    setViewNameDraft(savedViewForQuery?.name ?? '')
                  }}
                >
                  {savedViewForQuery ? 'Rename view' : 'Save as view'}
                </Button>
              ) : (
                <>
                  <input
                    autoFocus
                    value={viewNameDraft}
                    aria-label="View name"
                    placeholder="View name…"
                    style={{
                      border: '1px solid var(--puremail-line)',
                      outline: 'none',
                      background: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                      fontSize: 12,
                      padding: '2px 6px',
                    }}
                    onChange={event => {
                      setViewNameError(null)
                      setViewNameDraft(event.currentTarget.value)
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setViewNameError(null)
                        setViewNameDraft(null)
                        return
                      }
                      if (event.key !== 'Enter' || !viewNameDraft.trim())
                        return
                      event.preventDefault()
                      submitViewName()
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!viewNameDraft.trim()}
                    onClick={submitViewName}
                  >
                    Save
                  </Button>
                  {viewNameError && (
                    <span
                      role="alert"
                      style={{
                        fontSize: 11,
                        color: 'var(--platform-colors-danger, var(--puremail-danger-text))',
                      }}
                    >
                      {viewNameError}
                    </span>
                  )}
                </>
              )}
              {savedViewForQuery && (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() =>
                    setStore(current =>
                      deleteMailView(current, savedViewForQuery.id),
                    )
                  }
                >
                  Remove view
                </Button>
              )}
            </SearchToolbar>
            {builderOpen && (
              <SearchFilterBuilder
                inline
                query={draftDirtyRef.current ? draftQuery : currentQuery}
                folders={accountFolderNames}
                labels={labelNames}
                recentSearches={store.settings.recentSearches ?? []}
                onApply={builtQuery => {
                  applySearchQuery(builtQuery)
                  setBuilderOpen(false)
                }}
                onCreateFilter={
                  onCreateFilterFromSearch
                    ? builtQuery => {
                        setBuilderOpen(false)
                        setSearchPanelOpen(false)
                        onCreateFilterFromSearch(builtQuery)
                      }
                    : undefined
                }
                onClear={() => {
                  draftDirtyRef.current = false
                  setDraftQueryState('')
                  setCurrentQuery('in:inbox')
                  setBuilderOpen(false)
                }}
                onClose={() => setBuilderOpen(false)}
              />
            )}

            {remoteResults.length > 0 && (
              <SearchResults aria-label="Mail server results">
                <SearchSectionTitle>Server matches <span>{remoteResults.length}</span></SearchSectionTitle>
                {remoteResults.slice(0, 8).map(result => (
                  <ListButton
                    key={`remote-${result.type}-${result.id}`}
                    onClick={() => {
                      if (result.type === 'thread') {
                        openResultThread(result.id)
                        return
                      }
                      const matchedMessage = store.messages.find(
                        message =>
                          message.id === result.id ||
                          message.attachments.some(att => att.id === result.id),
                      )
                      if (matchedMessage) {
                        openResultThread(matchedMessage.threadId)
                        return
                      }
                      const matchedTask = store.tasks.find(
                        task => task.id === result.id && task.source?.threadId,
                      )
                      if (matchedTask?.source?.threadId) {
                        openResultThread(matchedTask.source.threadId)
                      }
                    }}
                  >
                    <Subject>{result.title}</Subject>
                    <Meta>Server · {result.type}</Meta>
                  </ListButton>
                ))}
              </SearchResults>
            )}
            {searchAllMail && (
              <SearchResults aria-label="Search all mail">
                <SearchSectionTitle>Search the server <span>{allMailResults === null ? 'All dates' : `${allMailResults.length} results`}</span></SearchSectionTitle>
                <ListButton
                  onClick={runAllMailSearch}
                  aria-busy={allMailPending}
                >
                  <Subject>
                    {allMailPending ? 'Searching all mail…' : 'Search all mail'}
                  </Subject>
                  <Meta>
                    Include messages not downloaded to this device
                  </Meta>
                </ListButton>
                {allMailError && <Meta role="alert">{allMailError}</Meta>}
                {allMailResults && allMailResults.length >= 20 && <Meta>Showing up to 20 matches. Refine your search for more specific results.</Meta>}
                {allMailResults && allMailResults.length === 0 && (
                  <Meta>No matches on the server.</Meta>
                )}
                {(allMailResults ?? []).slice(0, 20).map(result => (
                  <ListButton
                    key={`all-mail-${result.threadId}`}
                    onClick={() => openAllMailResult(result)}
                    disabled={Boolean(openingThread)}
                    aria-busy={openingThread === result.threadId}
                  >
                    <SearchResultHeading>
                      <Subject>{openingThread === result.threadId ? 'Loading message…' : result.subject || '(no subject)'}</Subject>
                      <time dateTime={result.date}>{formatDate(result.date)}</time>
                    </SearchResultHeading>
                    <SearchResultDetail>
                      <span>{result.from || 'Unknown sender'}</span>
                      <span>{result.inLocalWindow ? 'On this device' : 'On server'}</span>
                    </SearchResultDetail>
                    {result.snippet && <Meta>{result.snippet}</Meta>}
                  </ListButton>
                ))}
              </SearchResults>
            )}
            {commandResults.length > 0 && (
              <SearchResults aria-label="Commands">
                <SearchSectionTitle>Actions</SearchSectionTitle>
                {commandResults.slice(0, 4).map(command => (
                  <ListButton
                    key={`command-${command.id}`}
                    onClick={() => {
                      setSearchPanelOpen(false)
                      runMailCommand(command.id)
                    }}
                  >
                    <Subject>{command.label}</Subject>
                    <Meta>
                      Action · {command.shortcut} · {command.description}
                    </Meta>
                  </ListButton>
                ))}
              </SearchResults>
            )}
          </TopSearchPanel>
        )}
      </TopSearchWrap>
      <TopBarSpacer />
      {openCalendar && (
        <TopBarIconButton
          type="button"
          aria-label="Open PureCalendar beside Mail"
          title="Open PureCalendar beside Mail"
          onClick={openCalendar}
        >
          <CalendarDays aria-hidden="true" />
        </TopBarIconButton>
      )}
      {connectionControl}
      <TopBarIconButton
        type="button"
        $fetching={mailFetching}
        disabled={mailFetchDisabled || mailFetching}
        aria-label={mailFetching ? 'Fetching mail' : 'Fetch mail now'}
        onClick={() => void refreshMail()}
      >
        <RefreshCw aria-hidden="true" />
      </TopBarIconButton>
      <TopBarIconButton
        type="button"
        aria-pressed={density === 'comfortable'}
        aria-label={
          density === 'compact'
            ? 'Use comfortable row height'
            : 'Use compact row height'
        }
        onClick={() =>
          setDensity(density === 'compact' ? 'comfortable' : 'compact')
        }
      >
        {density === 'compact' ? (
          <Rows3 aria-hidden="true" />
        ) : (
          <Rows2 aria-hidden="true" />
        )}
      </TopBarIconButton>
      {readingPaneLayout && setReadingPaneLayout && (
        <LayoutSwitcherGroup role="group" aria-label="Reading pane layout">
          <LayoutSwitcherBtn
            type="button"
            $active={readingPaneLayout === 'list-only'}
            aria-pressed={readingPaneLayout === 'list-only'}
            aria-label="List only layout"
            title="List only"
            onClick={() => setReadingPaneLayout('list-only')}
          >
            <List aria-hidden="true" />
          </LayoutSwitcherBtn>
          <LayoutSwitcherBtn
            type="button"
            $active={readingPaneLayout === 'split-right'}
            aria-pressed={readingPaneLayout === 'split-right'}
            aria-label="Split right layout"
            title="Split right"
            onClick={() => setReadingPaneLayout('split-right')}
          >
            <Columns2 aria-hidden="true" />
          </LayoutSwitcherBtn>
          <LayoutSwitcherBtn
            type="button"
            $active={readingPaneLayout === 'split-bottom'}
            aria-pressed={readingPaneLayout === 'split-bottom'}
            aria-label="Split bottom layout"
            title="Split bottom"
            onClick={() => setReadingPaneLayout('split-bottom')}
          >
            <PanelBottom aria-hidden="true" />
          </LayoutSwitcherBtn>
        </LayoutSwitcherGroup>
      )}
      {onOpenFocusTriage && (
        <TopBarIconButton
          type="button"
          aria-label="Focus triage mode"
          title="Focus triage mode"
          onClick={onOpenFocusTriage}
        >
          <Zap aria-hidden="true" />
        </TopBarIconButton>
      )}
      <BulkMenuWrap ref={accountMenuRef}>
        <TopAccountChip
          type="button"
          aria-label="Mail account menu"
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          onClick={() => setAccountMenuOpen(open => !open)}
        >
          <TopAccountAvatar aria-hidden="true">
            {accountInitials(selectedAccount)}
          </TopAccountAvatar>
          <span>{selectedAccount?.email ?? 'No account'}</span>
          <ChevronDown aria-hidden="true" />
        </TopAccountChip>
        {accountMenuOpen && (
          <ThreadActionsMenu role="menu" aria-label="Mail accounts">
            {store.accounts.map(account => (
              <BulkMenuItem
                key={account.id}
                role="menuitem"
                aria-current={
                  account.id === selectedAccountId ? 'true' : undefined
                }
                onClick={() => {
                  setAccountMenuOpen(false)
                  if (account.id === selectedAccountId) return
                  switchAccount(account.id)
                }}
              >
                {account.name && account.name !== account.email
                  ? `${account.name} · ${account.email}`
                  : account.email}
              </BulkMenuItem>
            ))}
            {openRecovery && <BulkMenuItem role="menuitem" onClick={() => {
              setAccountMenuOpen(false)
              openRecovery()
            }}>Mail recovery</BulkMenuItem>}
            <BulkMenuItem
              role="menuitem"
              onClick={() => {
                setAccountMenuOpen(false)
                openSettings()
              }}
            >
              Account settings…
            </BulkMenuItem>
          </ThreadActionsMenu>
        )}
      </BulkMenuWrap>
    </TopBarShellStyle>
  )
}
