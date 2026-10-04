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
import type { Attachment, MailStore } from '../types'

export interface ComposeDraftSnapshot {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  bodyHtml: string
  attachments: Attachment[]
}

/** Snapshot the one open composer into the store; provider sync remains its sole remote writer. */
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
  } = input
  const { to, cc, bcc, subject, body, bodyHtml, attachments } = snapshot
  const latest = useRef(input)
  latest.current = input
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
            existing.sendState === 'uncertain' ||
            existing.syncState === 'conflict' ||
            existing.providerConflict)
        )
          return store
        if (
          existing &&
          existing.subject === (subject.trim() || '(no subject)') &&
          existing.body === fields.body &&
          (existing.bodyHtml ?? '') === fields.bodyHtml &&
          JSON.stringify([
            existing.to,
            existing.cc ?? [],
            existing.bcc ?? [],
          ]) === JSON.stringify([fields.to, fields.cc, fields.bcc]) &&
          existing.attachments.length === attachments.length &&
          existing.attachments.every((a, index) => {
            const b = attachments[index]
            return (
              a.id === b.id &&
              a.name === b.name &&
              a.mimeType === b.mimeType &&
              a.content === b.content
            )
          })
        )
          return store
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
  ])
}
