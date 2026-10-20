import { cleanModelDraft, prepareReplyContext } from './mailDraftAgent'
import { createGeneratedDraftForThread, isGeneratedDraft } from './mailModel'
import type { Draft, MailStore } from '../types'

export interface PreparedReply {
  status: 'prepared'
  requestId: string
  threadId: string
  accountId: string
  existingDraftId?: string
  instructions: string
  context: string
}

/** 53-bit string hash (cyrb53); two seeds give the token ~106 bits. */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Exact editable state token; provider sync alone does not invalidate it.
 * A short hash of the editable fields, not the fields themselves: the token
 * travels through getDraft replies and back in updateDraft calls, and the
 * raw fields carried the whole body plus every attachment's base64 bytes.
 */
export function draftEditVersion(draft: Draft): string {
  const state = JSON.stringify({ id: draft.id, body: draft.body, bodyHtml: draft.bodyHtml, subject: draft.subject, to: draft.to, cc: draft.cc, bcc: draft.bcc, attachments: draft.attachments, sentAt: draft.sentAt, updatedAt: draft.updatedAt })
  return `v1-${state.length.toString(36)}-${hash53(state, 1)}${hash53(state, 2)}`
}

// Ignore provider bookkeeping, but invalidate on any source or user draft edit.
function sourceVersion(store: MailStore, threadId: string): string {
  const thread = store.threads.find(item => item.id === threadId)
  return JSON.stringify({
    account: store.accounts.find(item => item.id === thread?.accountId),
    messages: store.messages.filter(item => item.threadId === threadId && !item.isDraft),
    subject: thread?.subject,
    drafts: store.drafts.filter(item => item.threadId === threadId).map(draft => ({
      id: draft.id, body: draft.body, bodyHtml: draft.bodyHtml, subject: draft.subject,
      to: draft.to, cc: draft.cc, bcc: draft.bcc, attachments: draft.attachments,
      sentAt: draft.sentAt, updatedAt: draft.updatedAt,
    })),
  })
}

/** Per mounted Mail tab. No inference, provider writes, timers or background jobs. */
export class MailDrawerDrafts {
  private pending = new Map<string, { prepared: PreparedReply; version: string; expires: number; brief?: string }>()
  clear() { this.pending.clear() }

  prepare(store: MailStore, accountId: string | undefined, threadId: string, brief?: string): PreparedReply {
    const thread = store.threads.find(item => item.id === threadId)
    if (!thread || !accountId || thread.accountId !== accountId) throw new Error('Open the thread’s account before preparing a reply.')
    const drafts = store.drafts.filter(item => item.threadId === threadId && !item.sentAt)
    if (drafts.length > 1 || drafts.some(item => !isGeneratedDraft(item))) {
      throw new Error('This thread has a manual or multiple drafts. Read the intended draft with getDraft and edit it explicitly.')
    }
    // A fresh prepare supersedes the older proposal for this thread.
    for (const [id, item] of this.pending) {
      if (item.expires < Date.now() || item.prepared.threadId === threadId) this.pending.delete(id)
    }
    if (this.pending.size >= 50) throw new Error('Too many pending replies. Complete or cancel the existing requests first.')
    const prepared: PreparedReply = {
      status: 'prepared', requestId: crypto.randomUUID(), threadId, accountId,
      ...(drafts[0] ? { existingDraftId: drafts[0].id } : {}),
      ...prepareReplyContext({ store, threadId, previousDraft: drafts[0], userFeedback: brief }),
    }
    this.pending.set(prepared.requestId, { prepared, version: sourceVersion(store, threadId), expires: Date.now() + 10 * 60_000, brief })
    return prepared
  }

  commit(store: MailStore, accountId: string | undefined, requestId: string, rawBody: string) {
    const task = this.pending.get(requestId)
    if (!task || task.expires < Date.now()) throw new Error('Reply request expired, cancelled or already committed. Read the draft before preparing again.')
    const { prepared } = task
    if (accountId !== prepared.accountId || !store.threads.some(item => item.id === prepared.threadId && item.accountId === accountId) || sourceVersion(store, prepared.threadId) !== task.version) {
      this.pending.delete(requestId)
      throw new Error('The account, thread or draft changed. Nothing was written. Prepare the reply again from current context.')
    }
    if (rawBody.length > 100_000) throw new Error('Reply body exceeds 100,000 characters.')
    const body = cleanModelDraft(rawBody)
    if (!body) throw new Error('Provide a nonempty reply body.')
    const previous = store.drafts.find(item => item.id === prepared.existingDraftId)
    const generated = createGeneratedDraftForThread(store, prepared.threadId, undefined, {
      previousDraft: previous, generatedBody: body, force: true, qaRequestId: requestId,
      qaOrigin: previous ? 'regenerate' : 'user_requested',
      userFeedback: task.brief, redraftReason: previous ? 'user_instruction' : undefined,
    })
    if (!generated) throw new Error('Could not create a reply from this thread. Nothing was written.')
    // Preserve provider identity, recipients and attachments when improving an existing draft.
    const draft = previous ? {
      ...previous, ...generated, to: previous.to, cc: previous.cc, bcc: previous.bcc,
      subject: previous.subject, providerDraftId: previous.providerDraftId,
      bodyHtml: undefined,
    } : { ...generated, id: `drawer_reply_${requestId}` }
    this.pending.delete(requestId)
    return {
      store: { ...store, drafts: previous ? store.drafts.map(item => item.id === previous.id ? draft : item) : [...store.drafts, draft] },
      receipt: { status: previous ? 'improved' : 'ready', draftId: draft.id, threadId: draft.threadId, applied: true, persisted: false, providerSync: 'pending', sent: false },
    }
  }
}
