import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { createComposedMessageDraft } from '../lib/mailModel'
import { parseComposeRecipients } from '../components/mailShellHelpers'
import {
  bodyHtmlWithQuote,
  bodyWithQuote,
  upsertReplyDraft,
  type ComposeQuoteState,
  type ComposeReplyContext,
} from '../lib/replyCompose'
import { confirmedSentCopy, draftDelivery, draftEditBlock } from '../lib/mailDeliveryStatus'
import type { Attachment, Draft, MailStore } from '../types'

export interface ComposeDraftSnapshot {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  bodyHtml: string
  attachments: Attachment[]
}

type ComposeFields = Pick<Draft, 'to' | 'subject' | 'body' | 'attachments'> & { cc: Draft['to']; bcc: Draft['to']; bodyHtml: string }

/** Whether these window fields say something the draft does not. Bytes fetched for an attachment later are not words. */
export function composeWordsDiffer(existing: Draft, fields: ComposeFields): boolean {
  return !(
    existing.subject === (fields.subject.trim() || '(no subject)') &&
    existing.body === fields.body &&
    (existing.bodyHtml ?? '') === fields.bodyHtml &&
    JSON.stringify([existing.to, existing.cc ?? [], existing.bcc ?? []]) ===
      JSON.stringify([fields.to, fields.cc, fields.bcc]) &&
    existing.attachments.length === fields.attachments.length &&
    existing.attachments.every((a, index) => {
      const b = fields.attachments[index]
      return a.id === b.id && a.name === b.name && a.mimeType === b.mimeType
    })
  )
}

/**
 * Where a window's words may be saved when it closes or is put aside: onto its
 * draft (`free`), nowhere because the draft already says them (`nothing`), or
 * as a draft of their own because the draft is leaving or has gone (`apart`).
 */
export function composeSaveTarget(store: Pick<MailStore, 'drafts' | 'messages'>, draftId: string | null | undefined, fields: ComposeFields): 'free' | 'nothing' | 'apart' {
  if (!draftId) return 'free'
  if (!draftEditBlock(store, draftId) && draftDelivery(store, draftId).state !== 'submitted') return 'free'
  const draft = store.drafts.find(item => item.id === draftId)
  if (draft) return composeWordsDiffer(draft, fields) ? 'apart' : 'nothing'
  return confirmedSentCopy(store, draftId)?.body === fields.body ? 'nothing' : 'apart'
}

/**
 * Snapshot the one open composer into the store; provider sync remains its sole
 * remote writer. While the draft is held, on its way or unconfirmed nothing is
 * written: the approval stands and the words wait in the window. They reach the
 * draft once Undo or a known failure frees it, and become a new draft if it went.
 */
export function useComposeDraftAutosave(input: {
  active: boolean
  pending: boolean
  session: number
  accountId?: string
  signature: string
  context: ComposeReplyContext | null
  quote: ComposeQuoteState | null
  snapshot: ComposeDraftSnapshot
  storeRef: RefObject<MailStore>
  setStore: Dispatch<SetStateAction<MailStore>>
  setContext: Dispatch<SetStateAction<ComposeReplyContext | null>>
  /** Why the window's draft must not change now; null when it may. */
  editBlock?: string | null
  /** The window's draft was confirmed sent while the window stayed open. */
  sentAway?: boolean
  onLocked?: (reason: string) => void
  onKeptSeparately?: () => void
}): void {
  const {
    active,
    pending,
    session,
    accountId,
    signature,
    context,
    quote,
    snapshot,
    storeRef,
    setStore,
    setContext,
    editBlock = null,
    sentAway = false,
  } = input
  const { to, cc, bcc, subject, body, bodyHtml, attachments } = snapshot
  const latest = useRef(input)
  latest.current = input
  // The last words the store held for this draft: a confirmed send removes it.
  const lastDraft = useRef<Draft | undefined>(undefined)
  const toldLocked = useRef(false)
  if (!editBlock) toldLocked.current = false
  const heldDraft = context?.draftId ? storeRef.current.drafts.find(draft => draft.id === context.draftId) : undefined
  if (heldDraft) lastDraft.current = heldDraft
  else if (!context?.draftId) lastDraft.current = undefined
  useEffect(() => {
    if (!active || pending) return
    const beyondSignature = body.trim() && body.trim() !== signature.trim()
    const hasContent = context
      ? beyondSignature || attachments.length || context.draftId
      : beyondSignature ||
        attachments.length ||
        to.trim() ||
        cc.trim() ||
        bcc.trim() ||
        subject.trim()
    if (!hasContent) return
    const timer = window.setTimeout(() => {
      const current = latest.current
      // A closed/replaced editor or a send must never be resurrected by a stale timer.
      if (!current.active || current.pending || current.session !== session)
        return
      const fields = {
        to: parseComposeRecipients(to),
        cc: parseComposeRecipients(cc),
        bcc: parseComposeRecipients(bcc),
        subject,
        body: bodyWithQuote(body, quote),
        bodyHtml: bodyHtmlWithQuote(bodyHtml, quote),
        attachments,
      }
      if (!context) {
        const now = new Date().toISOString()
        const created = createComposedMessageDraft(
          storeRef.current,
          { ...fields, accountId },
          now,
        )
        setStore(
          store =>
            createComposedMessageDraft(
              store,
              { ...fields, accountId },
              now,
              created,
            ).store,
        )
        setContext({
          threadId: created.threadId,
          draftId: created.draftId,
          messageId: null,
          kind: 'draft',
        })
        return
      }
      if (context.draftId && current.editBlock) {
        if (lastDraft.current && composeWordsDiffer(lastDraft.current, fields) && !toldLocked.current) {
          toldLocked.current = true
          current.onLocked?.(current.editBlock)
        }
        return
      }
      if (context.draftId && current.sentAway) {
        const went = lastDraft.current
        if (!went || !composeWordsDiffer(went, fields)) return
        const keptId = `draft_compose_${crypto.randomUUID()}`
        const kept = { ...context, draftId: null }
        setStore(store => upsertReplyDraft(store, { context: kept, ...fields, newDraftId: keptId }).store)
        setContext(value => (value === context ? { ...kept, draftId: keptId } : value))
        current.onKeptSeparately?.()
        return
      }
      const newDraftId =
        context.draftId ?? `draft_compose_${crypto.randomUUID()}`
      setStore(store => {
        const existing = store.drafts.find(
          draft => draft.id === context.draftId,
        )
        if (
          context.draftId &&
          (!existing ||
            existing.sentAt ||
            draftEditBlock(store, existing.id) ||
            existing.syncState === 'conflict' ||
            existing.providerConflict)
        )
          return store
        if (existing && !composeWordsDiffer(existing, fields) && existing.attachments.every((a, index) => a.content === attachments[index].content)) return store
        return upsertReplyDraft(store, { context, ...fields, newDraftId }).store
      })
      if (!context.draftId)
        setContext(value =>
          value === context ? { ...context, draftId: newDraftId } : value,
        )
    }, 350)
    return () => window.clearTimeout(timer)
  }, [
    active,
    pending,
    session,
    accountId,
    signature,
    context,
    quote,
    to,
    cc,
    bcc,
    subject,
    body,
    bodyHtml,
    attachments,
    storeRef,
    setStore,
    setContext,
    editBlock,
    sentAway,
  ])
}
