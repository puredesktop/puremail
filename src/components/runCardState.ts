import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { contactsToComposeInput, upsertReplyDraft } from '../lib/replyCompose'
import { parseComposeRecipients } from './mailShellHelpers'
import type { Attachment, Draft, MailStore } from '../types'

/**
 * The compose fields of ONE run card (an item's draft, or the template),
 * owned by the run screen rather than the shell's compose state. The
 * ComposeEditor is keyed on the draft id so its uncontrolled body seeds
 * once per draft; the fields here are derived from that draft in render,
 * before the editor mounts, so the seed can never be stale.
 */
export interface RunCardFields {
  draftId: string
  /** The store draft this card was seeded from (object identity). */
  draftRef: Draft
  /** Bumped on every re-seed so the keyed editor remounts and re-seeds. */
  seed: number
  to: string
  cc: string
  bcc: string
  ccBccOpen: boolean
  subject: string
  body: string
  bodyHtml: string
  attachments: Attachment[]
  dropActive: boolean
}

export function seedRunCard(draft: Draft, seed = 0): RunCardFields {
  return {
    draftId: draft.id,
    draftRef: draft,
    seed,
    to: contactsToComposeInput(draft.to),
    cc: contactsToComposeInput(draft.cc ?? []),
    bcc: contactsToComposeInput(draft.bcc ?? []),
    ccBccOpen: (draft.cc?.length ?? 0) + (draft.bcc?.length ?? 0) > 0,
    subject: draft.subject,
    body: draft.body,
    bodyHtml: draft.bodyHtml ?? '',
    attachments: draft.attachments,
    dropActive: false,
  }
}

/** Same attachments: by id and size, not array identity (spreads and syncs re-create arrays). */
function sameAttachments(a: Attachment[], b: Attachment[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => item.id === b[index]?.id && item.size === b[index]?.size)
  )
}

/** True when the card holds something the stored draft does not. */
export function runCardDiffersFromDraft(card: RunCardFields, draft: Draft): boolean {
  const seeded = seedRunCard(draft)
  return (
    card.to !== seeded.to ||
    card.cc !== seeded.cc ||
    card.bcc !== seeded.bcc ||
    card.subject !== seeded.subject ||
    card.body !== seeded.body ||
    card.bodyHtml !== seeded.bodyHtml ||
    !sameAttachments(card.attachments, seeded.attachments)
  )
}

/**
 * Write the card into its draft, in place (same id, same provider copy),
 * through the one reply-draft upsert. Identity when nothing changed.
 */
export function storeWithRunCardSaved(
  store: MailStore,
  card: RunCardFields,
  now = new Date().toISOString(),
): MailStore {
  const draft = store.drafts.find(item => item.id === card.draftId)
  if (!draft || draft.sentAt || !runCardDiffersFromDraft(card, draft)) return store
  const to = parseComposeRecipients(card.to)
  const upserted = upsertReplyDraft(store, {
    context: { threadId: draft.threadId, messageId: null, kind: 'draft', draftId: draft.id },
    to,
    cc: parseComposeRecipients(card.cc),
    bcc: parseComposeRecipients(card.bcc),
    subject: card.subject,
    body: card.body,
    bodyHtml: card.bodyHtml,
    attachments: card.attachments,
    now,
  }).store
  // The upsert normalizes an empty subject to "(no subject)" for sending;
  // a run card is still being written, so what was typed stands — an
  // empty template subject must not come back as literal text.
  const saved: MailStore = {
    ...upserted,
    drafts: upserted.drafts.map(item =>
      item.id === draft.id ? { ...item, subject: card.subject } : item,
    ),
  }
  // A run thread exists only to carry its draft, so the Drafts row follows
  // the draft's subject and recipient — a template renamed from "Run
  // template" must not keep listing under the old name.
  if (!draft.threadId.startsWith('thread_run')) return saved
  const subject = card.subject.trim() || (draft.draftKind === 'run_template' ? 'Run template' : '(no subject)')
  return {
    ...saved,
    threads: saved.threads.map(thread =>
      thread.id === draft.threadId
        ? {
            ...thread,
            subject,
            summary: card.body.trim().slice(0, 160) || thread.summary,
            participants: [thread.participants[0] ?? { name: 'Me', email: '' }, ...to],
            lastMessageAt: now,
          }
        : thread,
    ),
  }
}

type Setter<T> = Dispatch<SetStateAction<T>>

export interface RunCardSetters {
  setTo: Setter<string>
  setCc: Setter<string>
  setBcc: Setter<string>
  setCcBccOpen: Setter<boolean>
  setSubject: Setter<string>
  setBody: Setter<string>
  setBodyHtml: Setter<string>
  setAttachments: Setter<Attachment[]>
  setDropActive: Setter<boolean>
}

function resolve<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(current) : value
}

/**
 * Card state that follows the draft it shows: when `draft` changes id, the
 * fields are re-seeded DURING render (React's adjust-state-on-prop-change
 * pattern) so the keyed editor mounts with the right body.
 *
 * It also follows the draft's CONTENT when something else writes it — the
 * drawer agent's updateDraft / setRunNote, an edit in the docked window —
 * so the card never autosaves stale fields over that work. The card's own
 * save lands as a draft whose fields equal the card, which is not an
 * external change; an unrelated store touch (sync state) is not either.
 */
export function useRunCard(draft: Draft | null): {
  card: RunCardFields | null
  setters: RunCardSetters
} {
  const [card, setCard] = useState<RunCardFields | null>(() =>
    draft ? seedRunCard(draft) : null,
  )
  if (draft && (!card || card.draftId !== draft.id)) {
    setCard(seedRunCard(draft))
  } else if (!draft && card) {
    setCard(null)
  } else if (draft && card && card.draftRef !== draft) {
    const contentChanged = runCardDiffersFromDraft(seedRunCard(card.draftRef), draft)
    if (contentChanged && runCardDiffersFromDraft(card, draft)) {
      setCard(seedRunCard(draft, card.seed + 1))
    } else {
      setCard({ ...card, draftRef: draft })
    }
  }
  const field =
    <K extends keyof RunCardFields>(key: K): Setter<RunCardFields[K]> =>
    value =>
      setCard(current =>
        current ? { ...current, [key]: resolve(value, current[key]) } : current,
      )
  const setters: RunCardSetters = {
    setTo: field('to'),
    setCc: field('cc'),
    setBcc: field('bcc'),
    setCcBccOpen: field('ccBccOpen'),
    setSubject: field('subject'),
    setBody: field('body'),
    setBodyHtml: field('bodyHtml'),
    setAttachments: field('attachments'),
    setDropActive: field('dropActive'),
  }
  return {
    card: draft && card && card.draftId === draft.id ? card : null,
    setters,
  }
}

const AUTOSAVE_MS = 800

/**
 * Autosave for a run card: the card writes into its draft when typing
 * pauses, when the card changes draft, and when the screen unmounts.
 * `flush` saves right now (before a send, a render, a navigation).
 */
export function useRunCardAutosave(
  card: RunCardFields | null,
  setStore: (updater: (store: MailStore) => MailStore) => void,
): { flush: () => void } {
  // Updated in an effect, not in render: the flush-on-leave cleanup runs
  // BEFORE this commit's effects, so it still sees the previous draft's
  // card and saves that — not the freshly seeded next one.
  const cardRef = useRef(card)
  useEffect(() => {
    cardRef.current = card
  }, [card])
  const flush = (): void => {
    const current = cardRef.current
    if (!current) return
    setStore(store => storeWithRunCardSaved(store, current))
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    if (!card) return undefined
    const timer = window.setTimeout(() => flushRef.current(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [card])
  useEffect(
    () => () => {
      flushRef.current()
    },
    [card?.draftId],
  )
  return { flush: () => flushRef.current() }
}
