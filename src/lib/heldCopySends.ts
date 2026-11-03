import type { Draft, MailStore } from '../types'

const TEAM_DRAFT_ID = /^draft_(?:compose|reply)_exec-/
const TEAM_DRAFT_MESSAGE_ID = /puremail-draft-draft_(?:compose|reply)_exec-/

/** Made by the Executive team: by its id, or, brought back from the account's listing, by the Message-ID that names it. */
export const isTeamDraft = (draft: Pick<Draft, 'id' | 'providerDraftMessageIdHeader'>): boolean =>
  TEAM_DRAFT_ID.test(draft.id) || TEAM_DRAFT_MESSAGE_ID.test(draft.providerDraftMessageIdHeader ?? '')

const inSendRun = (store: Pick<MailStore, 'runs'>, draftId: string): boolean =>
  (store.runs ?? []).some(run => run.template?.draftId === draftId || run.items.some(item => item.draftId === draftId))

/**
 * Why a copy of Mail held in a page will not send this draft, or null when it may. A
 * person's own message, sent with their own click, goes out from wherever they are, once.
 * The team's drafts and send runs belong to Mail's own tab, which is the one copy that
 * tracks and reports them.
 */
export function heldCopySendRefusal(store: Pick<MailStore, 'runs'>, draft: Pick<Draft, 'id' | 'providerDraftMessageIdHeader'>): string | null {
  if (isTeamDraft(draft)) return 'This draft came from the executive team, so it is sent from Mail itself. Open Mail in its own tab. Nothing was sent.'
  if (inSendRun(store, draft.id)) return 'Send runs go out from Mail itself. Open Mail in its own tab. Nothing was sent.'
  return null
}

/** How much older than the fetch interval the last sync must be before a held copy concludes no tab is syncing. */
const NO_TAB_GRACE_MS = 2 * 60_000

/**
 * A normal tab keeps the mailbox synced, and a held copy reads what it saves. A held copy fetches
 * only when nothing has synced for a whole interval and more, so it never doubles a tab's fetch and
 * its inbox never goes stale when no tab is open.
 */
export function heldCopyFetchDue(lastSyncedAt: string | undefined, intervalMinutes: number, now: number = Date.now()): boolean {
  const last = Date.parse(lastSyncedAt ?? '')
  if (!Number.isFinite(last)) return true
  return now - last > intervalMinutes * 60_000 + NO_TAB_GRACE_MS
}
