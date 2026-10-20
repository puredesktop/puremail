/**
 * Markup for PureDesktop's agent activity layer: when an agent tool touches an
 * item, the layer marks the element whose `data-agent-ref` names it. A ref is a
 * value a tool passes (plain, and as `argName:value`) or a value a read answers
 * under an id-like key. These helpers spell out every form PureMail's tools
 * use for each kind of item — markup only, nothing here changes behaviour.
 *
 * Note: the layer skips arguments whose key starts with `message`, so a call's
 * `messageId` argument never marks a message on its own; `threadId` (which the
 * same tools take) marks the thread, and read answers listing `id` /
 * `messageId` do mark message elements.
 */

export interface AgentRefProps {
  'data-agent-ref': string
  'data-agent-label': string
}

function refs(values: Array<string | null | undefined>, keys: string[], label: string): AgentRefProps {
  const out = new Set<string>()
  for (const value of values) {
    if (!value) continue
    out.add(value)
    for (const key of keys) out.add(`${key}:${value}`)
  }
  return { 'data-agent-ref': [...out].join(' '), 'data-agent-label': label }
}

/** A thread: getThread/openThread/fileThread/createMailTask… `threadId`, markThreadsRead `threadIds`, recordTriage `decisions[].id`, list answers `id`. */
export function threadAgentRefs(
  thread: { id: string; subject?: string },
  draftIds: readonly string[] = [],
): AgentRefProps {
  const own = refs([thread.id], ['id', 'threadId', 'threadIds'], thread.subject || '(no subject)')
  if (!draftIds.length) return own
  const drafts = refs([...draftIds], DRAFT_KEYS, '')
  return { ...own, 'data-agent-ref': `${own['data-agent-ref']} ${drafts['data-agent-ref']}` }
}

/** One message: getThread answers `messages[].id`; kept-context and notes answers `messageId`. */
export function messageAgentRefs(message: { id: string }, label: string): AgentRefProps {
  return refs([message.id], ['id', 'messageId'], label || 'Message')
}

const DRAFT_KEYS = ['id', 'draftId', 'draftIds', 'templateDraftId']

/** A draft: getDraft/updateDraft/discardDraft/addDraftAttachments… `draftId`, createRunFromDrafts `draftIds`, createRun `templateDraftId`. */
export function draftAgentRefs(draft: { id: string; subject?: string }): AgentRefProps {
  return refs([draft.id], DRAFT_KEYS, draft.subject?.trim() || 'Draft')
}

/** A send run: every run tool's `runId`. */
export function runAgentRefs(run: { id: string; name: string }): AgentRefProps {
  return refs([run.id], ['runId'], run.name || 'Run')
}

/** One run item: `draftId` (setRunNote/sendRunItem/skipRunItem) and the 1-based `row` those tools and previewRunItem take. */
export function runItemAgentRefs(item: { draftId: string; rowIndex?: number; label?: string }): AgentRefProps {
  const base = refs([item.draftId], DRAFT_KEYS, item.label || 'Run draft')
  return item.rowIndex === undefined
    ? base
    : { ...base, 'data-agent-ref': `${base['data-agent-ref']} row:${item.rowIndex + 1}` }
}

/** A folder/box by name: fileThread `box`, applyMailAction `mailboxName`, createBox `name`. */
export function mailboxAgentRefs(mailbox: { name: string }, label?: string): AgentRefProps {
  return refs([mailbox.name], ['box', 'mailboxName', 'name'], label || mailbox.name)
}

/** A label by name: applyMailAction/createFilter `labelName`. */
export function labelAgentRefs(label: { name: string }): AgentRefProps {
  return refs([label.name], ['labelName'], label.name)
}

/** A saved view by name: saveView/deleteView `name`. */
export function viewAgentRefs(view: { name: string }): AgentRefProps {
  return refs([view.name], ['name'], view.name)
}

/** A filter rule: deleteFilter/setFilterEnabled/applyFilterRetroactively `filter` (name or id), createFilter `name`, listFilters `id`. */
export function filterAgentRefs(rule: { id: string; name: string }): AgentRefProps {
  const byId = refs([rule.id], ['id', 'filter'], rule.name)
  const byName = refs([rule.name], ['filter', 'name'], rule.name)
  return { ...byId, 'data-agent-ref': `${byId['data-agent-ref']} ${byName['data-agent-ref']}` }
}

/** A message opened to read or kept (reading room, Notes, Context): its id, plus the `threadId` getMessageNotes/addMessageNote take with it. */
export function readingAgentRefs(identity: { messageId: string; threadId?: string; subject?: string }): AgentRefProps {
  const message = messageAgentRefs({ id: identity.messageId }, identity.subject || '(no subject)')
  if (!identity.threadId) return message
  return {
    ...message,
    'data-agent-ref': `${message['data-agent-ref']} ${identity.threadId} threadId:${identity.threadId}`,
  }
}

/** The app's open surface: a write that names nothing on screen is marked on the element carrying `@open` (the thread reader). */
export function withOpenAgentRef(props: AgentRefProps): AgentRefProps {
  return { ...props, 'data-agent-ref': `${props['data-agent-ref']} @open` }
}
