import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  articleOf,
  contextForAgent,
  matchesContext,
  noteCounts,
  noteForAgent,
  orderedNotes,
  parseTopics,
  type KeptContext,
  type MessageNote,
} from '../lib/readingRoom'
import { identityOf } from '../lib/readingRoomIdentity'
import { AgentMailToolError, optionalString, requireString, type MailAgentToolContext } from './catalog'

/**
 * The reading room's tools. The agent sees notes for the reply and
 * highlights, never private notes: those are the reader's own, so the tools
 * report only how many there are. Kept context is shown with exactly what the
 * reader chose to include.
 */

const ok = (payload: unknown): AgentToolHandlerResult => ({ content: JSON.stringify(payload, null, 2) })

function roomOf(context: MailAgentToolContext) {
  if (!context.readingRoom) throw new AgentMailToolError('The reading room is not available in this window.')
  return context.readingRoom
}

function messageFor(context: MailAgentToolContext, args: Record<string, unknown>) {
  const room = roomOf(context)
  const store = context.getStore?.() ?? context.store
  const messageId = optionalString(args, 'messageId')
  const threadId = optionalString(args, 'threadId')
  let id = messageId
  if (!id && threadId) {
    const inThread = store.messages.filter(message => message.threadId === threadId && !message.isDraft)
    id = inThread.at(-1)?.id
    if (!id) throw new AgentMailToolError(`No message found in thread ${threadId}.`)
  }
  if (!id) throw new AgentMailToolError('Pass messageId (or threadId for its latest message). Call getThread for message ids.')
  const message = store.messages.find(item => item.id === id) ?? null
  const record = room.fileRef.current.byMessageId[id]
  const identity = identityOf(message, record, context.accountId)
  if (!identity) throw new AgentMailToolError(`No message has id ${id}. Call getThread for message ids.`)
  return { room, identity, record }
}

export function getMessageNotesHandler(context: MailAgentToolContext, args: Record<string, unknown> = {}): AgentToolHandlerResult {
  const { identity, record } = messageFor(context, args)
  const counts = noteCounts(record)
  return ok({
    messageId: identity.messageId,
    threadId: identity.threadId,
    subject: identity.subject,
    from: identity.from,
    notes: record ? orderedNotes(record).map(noteForAgent).filter(Boolean) : [],
    ...(counts.private ? { privateNotes: `${counts.private} private ${counts.private === 1 ? 'note' : 'notes'}; they are the reader’s own and are never shown to you or used in a reply.` } : {}),
    ...(record?.context ? { keptAsContext: { title: record.context.title, scope: record.context.scope } } : {}),
  })
}

export async function addMessageNoteHandler(context: MailAgentToolContext, args: Record<string, unknown> = {}): Promise<AgentToolHandlerResult> {
  const { room, identity } = messageFor(context, args)
  const kind = optionalString(args, 'kind') ?? 'reply'
  if (kind === 'private') throw new AgentMailToolError('Private notes are written by the reader only.')
  if (kind !== 'reply' && kind !== 'highlight') throw new AgentMailToolError('kind must be "reply" or "highlight".')
  const text = optionalString(args, 'note') ?? ''
  if (kind === 'reply' && !text) throw new AgentMailToolError('A note for the reply needs "note": what to say.')
  const passage = optionalString(args, 'passage') ?? ''
  if (kind === 'highlight' && !passage) throw new AgentMailToolError('A highlight needs "passage": the exact words to mark.')
  const article = articleOf(identity.article).text
  const start = passage ? article.indexOf(passage) : 0
  if (passage && start === -1) throw new AgentMailToolError('"passage" must be words copied exactly from the message as the reading room shows it. Read it with getMessageNotes or getThread.')
  const note: MessageNote = {
    id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    quote: passage,
    start: passage ? start : 0,
    end: passage ? start + passage.length : 0,
    text,
    createdAt: new Date().toISOString(),
  }
  await room.addNote(identity, note)
  return ok({ ok: true, noteId: note.id, kind, messageId: identity.messageId })
}

export async function listKeptContextHandler(context: MailAgentToolContext, args: Record<string, unknown> = {}): Promise<AgentToolHandlerResult> {
  const room = roomOf(context)
  const messageId = optionalString(args, 'messageId')
  const query = optionalString(args, 'query') ?? ''
  const topic = optionalString(args, 'topic')
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 20) : 8
  const records = Object.values(room.fileRef.current.byMessageId)
    .filter(record => record.context && (messageId ? record.messageId === messageId : matchesContext(record, query, topic)))
    .sort((a, b) => (b.context?.keptAt ?? '').localeCompare(a.context?.keptAt ?? ''))
    .slice(0, limit)
  if (records.length) await room.recordContextUse(records.map(record => record.messageId), 'the PureMail assistant')
  return ok({
    count: records.length,
    context: records.map(contextForAgent),
    note: 'Name the source when you use kept context: “From your PureMail context: <title>”.',
  })
}

export async function keepAsContextHandler(context: MailAgentToolContext, args: Record<string, unknown> = {}): Promise<AgentToolHandlerResult> {
  const { room, identity, record } = messageFor(context, args)
  const existing = record?.context
  const scopeArg = optionalString(args, 'scope')
  if (scopeArg && scopeArg !== 'mail' && scopeArg !== 'all') throw new AgentMailToolError('scope must be "mail" (PureMail only) or "all" (all apps).')
  const topics = Array.isArray(args.topics) ? parseTopics(args.topics.filter((item): item is string => typeof item === 'string').join(',')) : existing?.topics ?? []
  const next: KeptContext = {
    title: optionalString(args, 'title') ?? existing?.title ?? identity.subject,
    summary: optionalString(args, 'summary') ?? existing?.summary ?? '',
    topics,
    include: {
      message: typeof args.includeMessage === 'boolean' ? args.includeMessage : (existing?.include.message ?? true),
      replyNotes: typeof args.includeReplyNotes === 'boolean' ? args.includeReplyNotes : (existing?.include.replyNotes ?? true),
      // Only the reader decides whether private notes go in.
      privateNotes: existing?.include.privateNotes ?? false,
    },
    scope: (scopeArg as KeptContext['scope'] | undefined) ?? existing?.scope ?? 'mail',
    keptAt: existing?.keptAt ?? new Date().toISOString(),
    ...(existing?.file ? { file: existing.file } : {}),
    ...(existing?.lastUsed ? { lastUsed: existing.lastUsed } : {}),
  }
  await room.keepContext(identity, next)
  return ok({ ok: true, messageId: identity.messageId, title: next.title, scope: next.scope, summary: next.summary, topics: next.topics })
}

export async function removeKeptContextHandler(context: MailAgentToolContext, args: Record<string, unknown> = {}): Promise<AgentToolHandlerResult> {
  const messageId = requireString(args, 'messageId')
  const { room, identity, record } = messageFor(context, { messageId })
  if (!record?.context) throw new AgentMailToolError('That message is not kept as context.')
  await room.keepContext(identity, undefined)
  return ok({ ok: true, removed: messageId })
}
