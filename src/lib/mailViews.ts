import type { MailStore } from '../types'

/**
 * The non-mailbox views the sidebar can be showing. Since phase 2 these
 * are derived from the current query (`is:starred`, `label:"X"`, …) rather
 * than stored — this type just names what the query currently resolves to.
 */
export type MailSpecialRailView =
  | { kind: 'starred' }
  | { kind: 'snoozed' }
  | { kind: 'scheduled' }
  | { kind: 'label'; labelId: string }

export function threadIsStarred(
  store: Pick<MailStore, 'starredThreadIds'>,
  threadId: string,
): boolean {
  return store.starredThreadIds?.includes(threadId) ?? false
}
