import type { MailStore } from '../types'
import type { BulkTriageAction } from './mailTriage'
import { resolveThreadQuery } from './mailQuery'

/**
 * A resolved bulk action an agent wants to apply: a query, the action to take
 * over the threads that query matches, and why. Despite the name, this is not
 * a review queue — agents apply actions immediately (see applyAction in
 * agents/catalog.ts) and the operations ledger records them; the log, not an
 * approval gate, is the accountability mechanism. The query is kept verbatim
 * so the ledger entry can show exactly what the agent asked for.
 */
export interface MailProposal {
  id: string
  /** The query the agent named. Shown verbatim so the user can read it. */
  query: string
  action: BulkTriageAction
  /** One line from the agent explaining the intent. */
  rationale: string
  /** Thread ids matched when the proposal was made. */
  threadIds: string[]
  createdAt: string
}

export type MailProposalActionName =
  | 'archive'
  | 'trash'
  | 'read'
  | 'unread'
  | 'label'
  | 'snooze'
  | 'move'
  | 'star'
  | 'unstar'

export interface MailProposalRequest {
  query: string
  action: MailProposalActionName
  labelName?: string
  snoozedUntil?: string
  mailboxName?: string
  rationale?: string
}

export class MailProposalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailProposalError'
  }
}

/** Human-readable summary of what a proposal would do. */
export function describeProposal(
  store: MailStore,
  proposal: MailProposal,
): string {
  const count = proposal.threadIds.length
  const threads = `${count} thread${count === 1 ? '' : 's'}`
  switch (proposal.action.type) {
    case 'archive':
      return `Archive ${threads}`
    case 'trash':
      return `Move ${threads} to Trash`
    case 'read':
      return `Mark ${threads} ${proposal.action.read ? 'read' : 'unread'}`
    case 'label': {
      const labelId = proposal.action.labelId
      const label = store.labels.find(item => item.id === labelId)
      return `Label ${threads} "${label?.name ?? labelId}"`
    }
    case 'snooze':
      return `Snooze ${threads}`
    case 'star':
      return `${proposal.action.starred ? 'Star' : 'Unstar'} ${threads}`
    case 'move': {
      const mailboxId = proposal.action.mailboxId
      const mailbox = store.mailboxes.find(item => item.id === mailboxId)
      return `Move ${threads} to ${mailbox?.name ?? mailboxId}`
    }
    default:
      return `Update ${threads}`
  }
}

/**
 * Turn an agent request into a proposal, resolving the query through the
 * same resolver the rail renders so the threads the user reviews are exactly
 * the threads the agent addressed.
 */
export function buildMailProposal(
  store: MailStore,
  accountId: string | undefined,
  request: MailProposalRequest,
  now: Date | string = new Date(),
): MailProposal {
  const action = triageActionFor(store, request)
  const resolved = resolveThreadQuery(store, accountId, request.query, now)
  // Bulk actions apply to every thread in a conversation, not just the
  // representative row the rail shows.
  const threadIds = resolved.entries.flatMap(entry =>
    entry.threads.map(thread => thread.id),
  )
  if (threadIds.length === 0) {
    throw new MailProposalError(
      `No threads match "${resolved.query}". Nothing was proposed.`,
    )
  }
  const createdAt =
    (now instanceof Date ? now : new Date(now)).toISOString()
  return {
    id: `proposal_${createdAt.replace(/[^0-9]/g, '')}`,
    query: resolved.query,
    action,
    rationale: request.rationale?.trim() || '',
    threadIds,
    createdAt,
  }
}

function triageActionFor(
  store: MailStore,
  request: MailProposalRequest,
): BulkTriageAction {
  switch (request.action) {
    case 'archive':
      return { type: 'archive' }
    case 'trash':
      return { type: 'trash' }
    case 'read':
      return { type: 'read', read: true }
    case 'unread':
      return { type: 'read', read: false }
    case 'star':
      return { type: 'star', starred: true }
    case 'unstar':
      return { type: 'star', starred: false }
    case 'label': {
      if (!request.labelName) {
        throw new MailProposalError(
          '"labelName" is required when action is "label".',
        )
      }
      const label = store.labels.find(
        item =>
          item.name.toLowerCase() === request.labelName?.toLowerCase() ||
          item.id === request.labelName,
      )
      if (!label) {
        throw new MailProposalError(
          `No label named "${request.labelName}". Existing labels: ${
            store.labels.map(item => item.name).join(', ') || 'none'
          }.`,
        )
      }
      return { type: 'label', labelId: label.id }
    }
    case 'move': {
      if (!request.mailboxName) {
        throw new MailProposalError(
          '"mailboxName" is required when action is "move".',
        )
      }
      const mailbox = store.mailboxes.find(
        item =>
          item.name.toLowerCase() === request.mailboxName?.toLowerCase() ||
          item.id === request.mailboxName,
      )
      if (!mailbox) {
        throw new MailProposalError(
          `No mailbox named "${request.mailboxName}". Existing mailboxes: ${
            store.mailboxes.map(item => item.name).join(', ') || 'none'
          }.`,
        )
      }
      return { type: 'move', mailboxId: mailbox.id }
    }
    case 'snooze': {
      if (!request.snoozedUntil) {
        throw new MailProposalError(
          '"snoozedUntil" is required when action is "snooze".',
        )
      }
      if (!Number.isFinite(Date.parse(request.snoozedUntil))) {
        throw new MailProposalError(
          `"snoozedUntil" is not a valid timestamp: ${request.snoozedUntil}`,
        )
      }
      return { type: 'snooze', snoozedUntil: request.snoozedUntil }
    }
    default:
      throw new MailProposalError(`Unknown action "${request.action}".`)
  }
}
