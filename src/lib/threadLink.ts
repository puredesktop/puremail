import { digestMessageId } from './executiveShare'
import type { MailStore } from '../types'

export const THREAD_LINK_PREFIX = 'purescience://mail/thread/'

/**
 * What `purescience://mail/thread/<threadId>[/<messageId>]` opens (a row of mail on a dashboard:
 * workspace.openApp({ appSlug: 'mail', resourceId: 'thread/<threadId>/<messageId>' }), or a host holding Mail in a page).
 * The message id is the one the Executive digest shares, so a thread since renumbered is still found by its message.
 * A plain sentence when it is not on this desktop. Null: not a thread link.
 */
export function threadLinkTarget(
  store: Pick<MailStore, 'threads' | 'messages'>,
  path: string,
): { threadId: string; messageId: string | null } | { notice: string } | null {
  if (!path.startsWith(THREAD_LINK_PREFIX)) return null
  const notHere = { notice: 'This mail is not in PureMail on this desktop.' }
  let threadId = ''
  let wanted = ''
  try {
    ;[threadId = '', wanted = ''] = path.slice(THREAD_LINK_PREFIX.length).split('/').map(decodeURIComponent)
  } catch {
    return notHere
  }
  const message = wanted ? store.messages.find(each => !each.isDraft && (each.id === wanted || digestMessageId(each) === wanted)) : undefined
  const thread = store.threads.find(each => each.id === threadId) ?? store.threads.find(each => each.id === message?.threadId)
  if (!thread) return notHere
  return { threadId: thread.id, messageId: message?.threadId === thread.id ? message.id : null }
}
