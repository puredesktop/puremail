import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  RefreshCw,
  Rows2,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
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
  quoteQueryValue,
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
  ListButton,
  MailTopBar as TopBarShellStyle,
  Meta,
  RecipientChip,
  SearchResults,
  SearchRow,
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
import { useOutsideClose } from './useOutsideClose'
import { type MailDensity } from './mailShellLayout'

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
  openSettings: () => void
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
  openSettings,
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
  useEffect(() => {
    if (!searchPanelOpen) {
      setDraftQueryState('')
      draftDirtyRef.current = false
      setBuilderOpen(false)
    }
  }, [searchPanelOpen])
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
  useEffect(() => {
    // A new query invalidates the previous server answer.
    setAllMailResults(null)
    setAllMailError('')
  }, [currentQuery])
  const runAllMailSearch = (): void => {
    if (!searchAllMail || allMailPending) return
    const query = (draftQuery.trim() || currentQuery).trim()
    if (!query) return
    setAllMailPending(true)
    setAllMailError('')
    searchAllMail(query, 20)
      .then(results => setAllMailResults(results))
      .catch(error =>
        setAllMailError(
          error instanceof Error ? error.message : 'Search failed.',
        ),
      )
      .finally(() => setAllMailPending(false))
  }
  const openResultThread = (threadId: string): void => {
    setSearchPanelOpen(false)
    openThread(threadId)
  }
  const openAllMailResult = (result: AllMailResult): void => {
    if (result.inLocalWindow || !importRemoteThread) {
      openResultThread(result.threadId)
      return
    }
    // Outside the sync window: fetch it into the store first, exactly as the
    // getThread tool does, then open it like any other thread.
    void importRemoteThread(result.threadId)
      .then(() => openResultThread(result.threadId))
      .catch(error =>
        setAllMailError(
          error instanceof Error ? error.message : 'Could not fetch thread.',
        ),
      )
  }

  const appendOperator = (operator: string): void => {
    setDraftQuery(current =>
      `${current.trim()} ${operator}`.trim().replace(/\s+/g, ' '),
    )
    searchInputRef.current?.focus()
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
    setCurrentQuery(
      buildMailQuery({
        ...parsed,
        terms: parsed.terms.filter(
          term =>
            !(
              term.field === chip.term.field &&
              term.value === chip.term.value &&
              term.negated === chip.term.negated
            ),
        ),
      }),
    )
  }
  // Armed naming instead of window.prompt: prompt() silently no-ops inside
  // the sandboxed shell iframe, so "Save as view" would look dead there.
  const [viewNameDraft, setViewNameDraft] = useState<string | null>(null)
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
              if (event.key !== 'Escape') return
              setSearchPanelOpen(false)
              event.currentTarget.blur()
            }}
          />
          <KbdChip aria-hidden="true">⌘K</KbdChip>
        </TopSearchField>
        {searchPanelOpen && (
          <TopSearchPanel id="puremail-search-panel">
            <SearchRow style={{ justifyContent: 'flex-end' }}>
              <Button
                size="sm"
                variant="subtle"
                aria-expanded={builderOpen}
                aria-label="Query operators"
                onClick={() => setBuilderOpen(open => !open)}
              >
                <SlidersHorizontal aria-hidden="true" size={13} /> operators
              </Button>
            </SearchRow>
            {builderOpen && (
              <div
                style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
                role="group"
                aria-label="Query operator builder"
              >
                {[
                  'is:unread',
                  'is:starred',
                  'has:attachment',
                  'has:calendar',
                  'from:',
                  'to:',
                  'cc:',
                  'subject:',
                  'newer_than:7d',
                  'older_than:30d',
                  'sort:oldest',
                ].map(operator => (
                  <Button
                    key={operator}
                    size="sm"
                    onClick={() => appendOperator(operator)}
                  >
                    {operator}
                  </Button>
                ))}
                {store.labels.slice(0, 4).map(label => (
                  <Button
                    key={label.id}
                    size="sm"
                    onClick={() =>
                      appendOperator(`label:${quoteQueryValue(label.name)}`)
                    }
                  >
                    label:{label.name}
                  </Button>
                ))}
              </div>
            )}
            <SearchRow style={{ flexWrap: 'wrap', gap: 4 }}>
              {/* Chips repeat the input verbatim for a single term — they
                  only earn their row as per-term removers. */}
              {activeQueryChips.length > 1 &&
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
              {viewNameDraft === null ? (
                <Button
                  size="sm"
                  disabled={!currentQuery.trim()}
                  onClick={() =>
                    setViewNameDraft(savedViewForQuery?.name ?? '')
                  }
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
                    onChange={event =>
                      setViewNameDraft(event.currentTarget.value)
                    }
                    onKeyDown={event => {
                      if (event.key === 'Escape') setViewNameDraft(null)
                      if (event.key !== 'Enter' || !viewNameDraft.trim())
                        return
                      setStore(current =>
                        saveMailView(current, viewNameDraft, currentQuery),
                      )
                      setViewNameDraft(null)
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!viewNameDraft.trim()}
                    onClick={() => {
                      setStore(current =>
                        saveMailView(current, viewNameDraft, currentQuery),
                      )
                      setViewNameDraft(null)
                    }}
                  >
                    Save
                  </Button>
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
            </SearchRow>
            {remoteResults.length > 0 && (
              <SearchResults aria-label="Mail server results">
                <Meta>
                  Not on this device · {remoteResults.length} more on the
                  server
                </Meta>
                {remoteResults.slice(0, 8).map(result => (
                  <ListButton
                    key={`remote-${result.type}-${result.id}`}
                    onClick={() => {
                      if (result.type === 'thread') openResultThread(result.id)
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
                <ListButton
                  onClick={runAllMailSearch}
                  aria-busy={allMailPending}
                >
                  <Subject>
                    {allMailPending ? 'Searching all mail…' : 'Search all mail'}
                  </Subject>
                  <Meta>
                    Ask the mail server directly, past the local fetch window
                  </Meta>
                </ListButton>
                {allMailError && <Meta>{allMailError}</Meta>}
                {allMailResults && allMailResults.length === 0 && (
                  <Meta>No matches on the server.</Meta>
                )}
                {(allMailResults ?? []).slice(0, 20).map(result => (
                  <ListButton
                    key={`all-mail-${result.threadId}`}
                    onClick={() => openAllMailResult(result)}
                  >
                    <Subject>{result.subject || '(no subject)'}</Subject>
                    <Meta>
                      {result.from} · {formatDate(result.date)}
                      {result.inLocalWindow ? '' : ' · not on this device'}
                    </Meta>
                    {result.snippet && <Meta>{result.snippet}</Meta>}
                  </ListButton>
                ))}
              </SearchResults>
            )}
            {commandResults.length > 0 && (
              <SearchResults aria-label="Commands">
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
      <BulkMenuWrap ref={accountMenuRef}>
        <TopAccountChip
          type="button"
          aria-haspopup={store.accounts.length > 1 ? 'menu' : 'dialog'}
          aria-expanded={
            store.accounts.length > 1 ? accountMenuOpen : undefined
          }
          onClick={() => {
            if (store.accounts.length > 1) {
              setAccountMenuOpen(open => !open)
            } else {
              openSettings()
            }
          }}
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
