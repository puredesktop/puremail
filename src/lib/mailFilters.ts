import type {
  Mailbox,
  MailFilterActions,
  MailFilterRule,
  MailLabel,
  MailStore,
} from '../types'
import { isImapMailboxId } from './imapMailProvider'
import { archiveThread, labelThread, markThreadRead } from './mailModel'
import { quoteQueryValue, resolveThreadQuery } from './mailQuery'

/**
 * The filter engine. Filters are named queries (the same language as
 * search and saved views) with actions. They run over threads exactly
 * once — a run marker on the thread prevents re-firing on re-fetch —
 * and every remote-relevant action also emits the mutation the manual
 * action would send, so Gmail cannot resurrect what a filter archived.
 * Pure functions over the store; the host fires the mutations.
 */

export type MailFilterMutation =
  | { kind: 'archive' | 'markRead'; threadId: string }
  /** TRUE server-side folder move — the box named a real IMAP folder. */
  | { kind: 'move'; threadId: string; mailboxId: string }

/**
 * The real account folder (an IMAP folder mirrored as a mailbox) a box
 * name refers to, when it does. Filing into "git" on a Proton account must
 * land in git ON THE SERVER, not in a local look-alike label — the same
 * rule the agent fileThread tool follows.
 */
export function accountFolderForBoxName(
  store: MailStore,
  accountId: string,
  boxName: string,
): Mailbox | undefined {
  const trimmed = boxName.trim().toLowerCase()
  if (!trimmed) return undefined
  return store.mailboxes.find(
    mailbox =>
      mailbox.accountId === accountId &&
      isImapMailboxId(mailbox.id) &&
      mailbox.name.toLowerCase() === trimmed,
  )
}

/**
 * Compose a filter query from the simple condition controls — the dialog's
 * structured half. Everything lands in the ONE query language search and
 * saved views use, so "advanced" is just editing the composed string.
 */
export function composeFilterQuery(input: {
  senderEmail: string
  scope: 'sender' | 'domain'
  subjectContains?: string
  hasAttachment?: boolean
}): string {
  const domain = input.senderEmail.split('@')[1] ?? ''
  const parts: string[] = []
  const from = input.scope === 'domain' && domain ? domain : input.senderEmail
  if (from.trim()) parts.push(`from:${quoteQueryValue(from.trim())}`)
  const subject = input.subjectContains?.trim()
  if (subject) parts.push(`subject:${quoteQueryValue(subject)}`)
  if (input.hasAttachment) parts.push('has:attachment')
  return parts.join(' ')
}

export interface MailFilterRunResult {
  store: MailStore
  mutations: MailFilterMutation[]
  /** Total rule-thread matches in this run (a thread can hit many rules). */
  totalHits: number
}

const LOCAL_LABEL_COLOR = '#8a7f6a'

/** Find-or-create a label by name (case-insensitive). Local-first: labels
 * created here exist only in the store until label sync lands. */
export function ensureMailLabel(
  store: MailStore,
  name: string,
): { store: MailStore; label: MailLabel } {
  const trimmed = name.trim()
  const existing = store.labels.find(
    label => label.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existing) return { store, label: existing }
  const label: MailLabel = {
    id: `local-label-${crypto.randomUUID()}`,
    name: trimmed,
    color: LOCAL_LABEL_COLOR,
  }
  return { store: { ...store, labels: [...store.labels, label] }, label }
}

/**
 * Find-or-create the custom mailbox behind a box. A box is a HOME, not a
 * label view: threads filed into it live there, so the inbox does not show
 * them and Archive stays strictly "threads the user archived". The remote
 * side is unchanged (Gmail sees archive + label).
 */
export function ensureMailBox(
  store: MailStore,
  accountId: string,
  name: string,
): { store: MailStore; mailbox: Mailbox } {
  const trimmed = name.trim()
  const existing = store.mailboxes.find(
    mailbox =>
      mailbox.accountId === accountId &&
      mailbox.role === 'custom' &&
      mailbox.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existing) return { store, mailbox: existing }
  const mailbox: Mailbox = {
    id: `box-${crypto.randomUUID()}`,
    accountId,
    name: trimmed,
    role: 'custom',
    unreadCount: 0,
  }
  return {
    store: { ...store, mailboxes: [...store.mailboxes, mailbox] },
    mailbox,
  }
}

/**
 * File a thread into a box mailbox. archiveThread handles the fresh case
 * (and the return bookkeeping unarchive uses); a thread that is already
 * archived only needs its home re-pointed.
 */
function fileThreadIntoBox(
  store: MailStore,
  threadId: string,
  boxMailboxId: string,
): MailStore {
  const thread = store.threads.find(item => item.id === threadId)
  if (!thread) return store
  if (thread.status !== 'archived') {
    return archiveThread(store, threadId, boxMailboxId)
  }
  if (thread.mailboxId === boxMailboxId) return store
  return {
    ...store,
    threads: store.threads.map(item =>
      item.id === threadId ? { ...item, mailboxId: boxMailboxId } : item,
    ),
  }
}

/**
 * Manual filing: one thread into one box, no rule created. Identical
 * semantics to a box filter hit — label + box-home + remote archive — so a
 * hand-filed thread behaves exactly like a filtered one.
 */
export function fileThreadToBox(
  store: MailStore,
  accountId: string,
  threadId: string,
  boxName: string,
): { store: MailStore; mutations: MailFilterMutation[] } {
  const trimmed = boxName.trim()
  if (!trimmed) return { store, mutations: [] }
  const realFolder = accountFolderForBoxName(store, accountId, trimmed)
  if (realFolder) {
    // A real account folder: true server move, no local label double.
    const homeChanged =
      store.threads.find(thread => thread.id === threadId)?.mailboxId !==
      realFolder.id
    return {
      store: fileThreadIntoBox(store, threadId, realFolder.id),
      mutations: homeChanged
        ? [{ kind: 'move', threadId, mailboxId: realFolder.id }]
        : [],
    }
  }
  const ensuredLabel = ensureMailLabel(store, trimmed)
  let working = labelThread(
    ensuredLabel.store,
    threadId,
    ensuredLabel.label.id,
  )
  const boxed = ensureMailBox(working, accountId, trimmed)
  working = boxed.store
  const before = working.threads.find(thread => thread.id === threadId)
  working = fileThreadIntoBox(working, threadId, boxed.mailbox.id)
  const after = working.threads.find(thread => thread.id === threadId)
  return {
    store: working,
    mutations:
      before && after && before.status !== after.status
        ? [{ kind: 'archive', threadId }]
        : [],
  }
}

export function addMailFilter(
  store: MailStore,
  input: {
    name: string
    query: string
    actions: MailFilterActions
    now?: Date
  },
): { store: MailStore; rule: MailFilterRule } {
  const rule: MailFilterRule = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    query: input.query.trim(),
    actions: input.actions,
    enabled: true,
    createdAt: (input.now ?? new Date()).toISOString(),
    hitCount: 0,
  }
  return { store: { ...store, filters: [...(store.filters ?? []), rule] }, rule }
}

export function deleteMailFilter(store: MailStore, ruleId: string): MailStore {
  return {
    ...store,
    filters: (store.filters ?? []).filter(rule => rule.id !== ruleId),
  }
}

export function setMailFilterEnabled(
  store: MailStore,
  ruleId: string,
  enabled: boolean,
): MailStore {
  return {
    ...store,
    filters: (store.filters ?? []).map(rule =>
      rule.id === ruleId ? { ...rule, enabled } : rule,
    ),
  }
}

/**
 * Void the run markers on these threads so the next engine pass looks at
 * them again. Called when a remote filter mutation FAILS: the marker was
 * stamped optimistically, and without clearing it a thread whose server
 * move failed sat in the inbox forever — filtered on paper, unfiled in
 * fact.
 */
export function clearFilterRunMarkers(
  store: MailStore,
  threadIds: readonly string[],
): MailStore {
  if (threadIds.length === 0) return store
  const ids = new Set(threadIds)
  return {
    ...store,
    threads: store.threads.map(thread => {
      if (!ids.has(thread.id) || !thread.filterRunAt) return thread
      const { filterRunAt: _cleared, ...rest } = thread
      return rest
    }),
  }
}

export function runMailFilters(
  store: MailStore,
  accountId: string | undefined,
  options: {
    /** Restrict the run to these threads (default: every account thread). */
    threadIds?: readonly string[]
    /** Explicit retroactive apply: ignore run markers. */
    includeAlreadyRun?: boolean
    /** Restrict to these rules (retroactive apply targets ONE rule). */
    ruleIds?: readonly string[]
    now?: Date
  } = {},
): MailFilterRunResult {
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  if (!accountId) return { store, mutations: [], totalHits: 0 }

  const threadsById = new Map(store.threads.map(thread => [thread.id, thread]))
  const candidateIds = new Set(
    (options.threadIds ??
      store.threads
        .filter(thread => thread.accountId === accountId)
        .map(thread => thread.id)
    ).filter(id => {
      const thread = threadsById.get(id)
      if (!thread) return false
      // Filters act per MESSAGE, like Gmail's: a thread whose latest
      // message postdates its last filter run is new work — without this,
      // a reply on a filed thread lands back in the inbox and stays there.
      return (
        options.includeAlreadyRun ||
        !thread.filterRunAt ||
        thread.lastMessageAt > thread.filterRunAt
      )
    }),
  )
  const rules = (store.filters ?? []).filter(
    rule =>
      rule.enabled && (!options.ruleIds || options.ruleIds.includes(rule.id)),
  )

  // Match every rule against the INPUT store before applying anything, so
  // rule order cannot hide threads from later rules (an archive by rule 1
  // must not stop rule 2 from labelling the same thread).
  const matchesByRule = rules.map(rule => ({
    rule,
    threadIds: resolveThreadQuery(store, accountId, rule.query, now)
      .threads.map(thread => thread.id)
      .filter(id => candidateIds.has(id)),
  }))

  let working = store
  const mutationKeys = new Set<string>()
  const mutations: MailFilterMutation[] = []
  const hitNamesByThread = new Map<string, string[]>()
  const hitCountByRule = new Map<string, number>()
  let totalHits = 0

  const pushMutation = (mutation: MailFilterMutation): void => {
    const key = `${mutation.kind}:${mutation.threadId}`
    if (mutationKeys.has(key)) return
    mutationKeys.add(key)
    mutations.push(mutation)
  }

  for (const { rule, threadIds } of matchesByRule) {
    if (threadIds.length === 0) continue
    hitCountByRule.set(rule.id, threadIds.length)
    totalHits += threadIds.length
    for (const threadId of threadIds) {
      const names = hitNamesByThread.get(threadId) ?? []
      names.push(rule.name)
      hitNamesByThread.set(threadId, names)
      const actions = rule.actions
      if (actions.labelName) {
        const ensured = ensureMailLabel(working, actions.labelName)
        working = labelThread(ensured.store, threadId, ensured.label.id)
      }
      if (actions.skipInbox) {
        const before = working.threads.find(t => t.id === threadId)
        const realFolder = actions.labelName
          ? accountFolderForBoxName(working, accountId, actions.labelName)
          : undefined
        if (realFolder) {
          // The box IS a real folder on the mail server (IMAP): move the
          // thread there for real instead of archiving a labelled copy.
          const homeChanged =
            working.threads.find(t => t.id === threadId)?.mailboxId !==
            realFolder.id
          working = fileThreadIntoBox(working, threadId, realFolder.id)
          if (homeChanged) {
            pushMutation({
              kind: 'move',
              threadId,
              mailboxId: realFolder.id,
            })
          }
        } else if (actions.labelName) {
          // Box rule: the box mailbox is the thread's home.
          const boxed = ensureMailBox(working, accountId, actions.labelName)
          working = fileThreadIntoBox(boxed.store, threadId, boxed.mailbox.id)
        } else {
          working = archiveThread(working, threadId)
        }
        const after = working.threads.find(t => t.id === threadId)
        if (!realFolder && before?.status !== after?.status) {
          pushMutation({ kind: 'archive', threadId })
        }
      }
      if (actions.markRead) {
        working = markThreadRead(working, threadId, true)
        pushMutation({ kind: 'markRead', threadId })
      }
    }
  }

  // Relocate threads earlier builds filed as plain archive + label: a
  // thread this rule already acted on whose home is still an archive-role
  // mailbox belongs in the box. Idempotent, local-only, no new mutations.
  const archiveRoleIds = new Set(
    working.mailboxes
      .filter(mailbox => mailbox.role === 'archive')
      .map(mailbox => mailbox.id),
  )
  for (const rule of rules) {
    if (!rule.actions.skipInbox || !rule.actions.labelName) continue
    const strays = working.threads.filter(
      thread =>
        thread.accountId === accountId &&
        archiveRoleIds.has(thread.mailboxId) &&
        thread.filteredBy?.includes(rule.name),
    )
    if (!strays.length) continue
    const boxed = ensureMailBox(working, accountId, rule.actions.labelName)
    working = boxed.store
    for (const thread of strays) {
      working = fileThreadIntoBox(working, thread.id, boxed.mailbox.id)
    }
  }

  // Stamp every candidate — matched or not — so this run never repeats,
  // and record which rules acted for the per-thread audit line.
  working = {
    ...working,
    threads: working.threads.map(thread => {
      if (!candidateIds.has(thread.id)) return thread
      const names = hitNamesByThread.get(thread.id)
      return {
        ...thread,
        filterRunAt: nowIso,
        ...(names
          ? {
              filteredBy: [
                ...new Set([...(thread.filteredBy ?? []), ...names]),
              ],
            }
          : {}),
      }
    }),
    filters: (working.filters ?? []).map(rule => {
      const hits = hitCountByRule.get(rule.id)
      return hits
        ? { ...rule, hitCount: rule.hitCount + hits, lastHitAt: nowIso }
        : rule
    }),
  }

  return { store: working, mutations, totalHits }
}


export interface MailFilterSuggestion {
  senderEmail: string
  senderName: string
  /** Archived-thread evidence behind the suggestion. */
  archivedCount: number
  suggestedQuery: string
  suggestedName: string
}

const SUGGESTION_THRESHOLD = 3

/**
 * The learning pipeline, unified with filters: repeated manual behavior
 * becomes a SUGGESTED rule, surfaced beside hand-made ones and created
 * through the same machinery. v1 heuristic: a sender whose threads the
 * user keeps archiving (>= 3) and who no enabled filter already covers.
 */
export function suggestMailFilters(
  store: MailStore,
  accountId: string | undefined,
): MailFilterSuggestion[] {
  if (!accountId) return []
  const existingQueries = (store.filters ?? [])
    .filter(rule => rule.enabled)
    .map(rule => rule.query.toLowerCase())
  const bySender = new Map<
    string,
    { name: string; archived: number }
  >()
  for (const thread of store.threads) {
    if (thread.accountId !== accountId) continue
    if (thread.status !== 'archived') continue
    const sender = thread.participants[0]
    if (!sender?.email) continue
    const key = sender.email.toLowerCase()
    const entry = bySender.get(key) ?? { name: sender.name, archived: 0 }
    entry.archived += 1
    bySender.set(key, entry)
  }
  const suggestions: MailFilterSuggestion[] = []
  for (const [email, entry] of bySender) {
    if (entry.archived < SUGGESTION_THRESHOLD) continue
    if (existingQueries.some(query => query.includes(email))) continue
    suggestions.push({
      senderEmail: email,
      senderName: entry.name,
      archivedCount: entry.archived,
      suggestedQuery: `from:${email}`,
      suggestedName: entry.name || email,
    })
  }
  return suggestions.sort((a, b) => b.archivedCount - a.archivedCount)
}
