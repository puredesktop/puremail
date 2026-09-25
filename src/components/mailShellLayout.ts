import type { MailStore } from '../types'

export type TaskMode = 'thread' | 'mine' | 'followups'

/**
 * Row density for the thread list. The header's density control switches
 * between them, and the rail windows on the matching height — the two cannot
 * drift because both read this map.
 */
export type MailDensity = 'compact' | 'comfortable'
export const THREAD_ROW_HEIGHTS: Record<MailDensity, number> = {
  /** --pure-chrome-list-row-height: a number because the rail windows on it. */
  compact: 36,
  comfortable: 48,
}

export type MailLayoutState = {
  selectedAccountId: string
  /** The mail view, as a query string. Restored verbatim on boot. */
  query: string
  selectedThreadId: string
  /**
   * Whether the full-width reader is showing instead of the thread list.
   * The two are mutually exclusive surfaces: selecting a thread ENTERS
   * reading, Back/Escape returns to the index. `selectedThreadId` alone
   * cannot carry this — a selection always exists, but the list is the
   * home state.
   *
   * Persisted-state defaults are migrations: every pre-redesign blob lacks
   * this field, and those users must boot into the index, not the reader,
   * so absence (or anything but `true`) reads as false.
   */
  reading: boolean
  taskMode: TaskMode
  /**
   * The task drawer's open state, per account. One account's tasks are not
   * another's, so a single global flag opened a drawer over a mailbox the
   * user had never opened it on.
   */
  taskDrawerOpen: Record<string, boolean>
  density: MailDensity
}

export const MAIL_LAYOUT_STORAGE_KEY = 'puremail.layout.v1'

export function defaultLayoutState(store: MailStore): MailLayoutState {
  const selectedAccountId = store.accounts[0]?.id ?? ''
  const selectedThreadId =
    store.threads.find(thread => thread.accountId === selectedAccountId)?.id ??
    store.threads[0]?.id ??
    ''
  return {
    selectedAccountId,
    query: 'in:inbox',
    selectedThreadId,
    reading: false,
    /**
     * Every open task, not just the open thread's. The drawer has no mode
     * control any more — the Thread / Mine / Follow-ups buttons went with the
     * fourth column — so the narrow view would be a dead end you could enter
     * from a keyboard shortcut and never leave.
     */
    taskMode: 'mine',
    taskDrawerOpen: {},
    density: 'compact',
  }
}

/** Collapsed unless this account was left with the drawer open. */
export function taskDrawerOpenFor(
  state: Pick<MailLayoutState, 'taskDrawerOpen'>,
  accountId: string,
): boolean {
  return state.taskDrawerOpen[accountId] === true
}


/**
 * Reads the per-account map, migrating the single `taskPaneCollapsed` flag
 * layouts saved before the drawer was per account. The old flag only tells us
 * about the account that was open when it was written, so that is the only
 * account it is applied to.
 */
function readTaskDrawerOpen(
  parsed: Partial<MailLayoutState> & { taskPaneCollapsed?: unknown },
  selectedAccountId: string,
): Record<string, boolean> {
  const saved = parsed.taskDrawerOpen
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const entries = Object.entries(saved).filter(
      ([, open]) => typeof open === 'boolean',
    ) as Array<[string, boolean]>
    return Object.fromEntries(entries)
  }
  if (typeof parsed.taskPaneCollapsed === 'boolean' && selectedAccountId) {
    return { [selectedAccountId]: !parsed.taskPaneCollapsed }
  }
  return {}
}

export function readLayoutState(store: MailStore): MailLayoutState {
  if (typeof window === 'undefined') return defaultLayoutState(store)
  try {
    const saved = window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY)
    if (!saved) return defaultLayoutState(store)
    const parsed = JSON.parse(saved) as Partial<MailLayoutState>
    const selectedAccountId = store.accounts.some(
      account => account.id === parsed.selectedAccountId,
    )
      ? parsed.selectedAccountId!
      : store.accounts[0]?.id ?? ''
    const query =
      typeof parsed.query === 'string' && parsed.query.trim()
        ? parsed.query
        : 'in:inbox'
    const selectedThreadId = store.threads.some(
      thread =>
        thread.id === parsed.selectedThreadId &&
        thread.accountId === selectedAccountId,
    )
      ? parsed.selectedThreadId!
      : store.threads.find(thread => thread.accountId === selectedAccountId)
          ?.id ??
        store.threads[0]?.id ??
        ''
    /**
     * 'thread' was the OLD default, persisted on every layout write — so
     * virtually every pre-redesign localStorage holds it. Preserving it
     * booted existing users into a drawer filtered to the open thread's
     * tasks (usually none) with the mode buttons long deleted. Thread scope
     * is a session gesture now, never a persisted one.
     */
    const taskMode = parsed.taskMode === 'followups' ? 'followups' : 'mine'
    return {
      selectedAccountId,
      query,
      selectedThreadId,
      // Reading state only survives a reload when the thread it was showing
      // does: restoring the reader over a vanished selection would open an
      // empty surface with nothing to go "back" from.
      reading: parsed.reading === true && Boolean(selectedThreadId),
      taskMode,
      taskDrawerOpen: readTaskDrawerOpen(parsed, selectedAccountId),
      density: parsed.density === 'comfortable' ? 'comfortable' : 'compact',
    }
  } catch (error) {
    console.warn(
      '[puremail] persisted layout unreadable; using defaults:',
      error,
    )
    return defaultLayoutState(store)
  }
}

/**
 * Which rows the windowed thread rail should mount.
 *
 * Pure so the arithmetic is testable without a browser: the DOM wiring is a
 * scroll listener, but the off-by-one risks all live here.
 */
export function visibleRowRange(input: {
  /** Scroll offset of the container the rail lives in. */
  scrollTop: number
  /** The rail's offset within that container. */
  railTop: number
  /** Visible height of the container. */
  viewportHeight: number
  rowHeight: number
  overscan: number
  total: number
}): { start: number; end: number } {
  const { scrollTop, railTop, viewportHeight, rowHeight, overscan, total } =
    input
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const first = Math.floor((scrollTop - railTop) / rowHeight)
  const perScreen = Math.ceil(viewportHeight / rowHeight)
  const start = Math.max(0, Math.min(total, first - overscan))
  // Always mount at least one screenful even when the container reports no
  // height yet (first paint, or a collapsed layout), otherwise the rail can
  // render nothing and look empty.
  const end = Math.max(
    start + 1,
    Math.min(total, first + Math.max(perScreen, 1) + overscan),
  )
  return { start, end: Math.min(total, end) }
}

/**
 * Where you are in a long list, in words.
 *
 * The rail scrolls one continuous list of every thread, so there are no
 * pages to number — but "how far in am I, and how much is left?" is still
 * a fair question, and a virtual list answers it badly by default: the
 * scrollbar is the only clue and it lies about small lists.
 *
 * `first` is the topmost row actually in view (the render window starts
 * earlier, by the overscan, which is not what a person means by "here").
 */
export function listPositionLabel(input: {
  first: number
  total: number
}): string | null {
  const { first, total } = input
  if (total <= 0) return null
  const at = Math.min(Math.max(1, first + 1), total)
  return `${at.toLocaleString()} of ${total.toLocaleString()}`
}

/** The topmost row in view, ignoring the rows mounted above it for overscan. */
export function firstVisibleRow(input: {
  scrollTop: number
  railTop: number
  rowHeight: number
  total: number
}): number {
  const { scrollTop, railTop, rowHeight, total } = input
  if (total <= 0 || rowHeight <= 0) return 0
  return Math.max(0, Math.min(total - 1, Math.floor((scrollTop - railTop) / rowHeight)))
}

/**
 * Where to scroll so row `position` (1-based, as the label reads) sits at
 * the top. Out-of-range asks are clamped rather than refused: typing 9999
 * into "go to" means "the end".
 */
export function scrollTopForRow(input: {
  position: number
  railTop: number
  rowHeight: number
  total: number
}): number {
  const { position, railTop, rowHeight, total } = input
  if (total <= 0 || rowHeight <= 0) return railTop
  const row = Math.min(Math.max(1, Math.round(position)), total) - 1
  return Math.max(0, railTop + row * rowHeight)
}
