import { confirmedSentCopy } from './mailDeliveryStatus'
import { recoverInterruptedSends } from './mailRuns'
import type { MailStore } from '../types'

const CHANNEL = 'puremail-send-attempts'
/** Long enough for an open Mail window to answer. Silence proves nothing: a frozen window cannot answer, and a closed channel reaches nobody. */
const ANSWER_WAIT_MS = 250

type OwnershipMessage = { type: 'who'; ask: string; draftIds: string[] } | { type: 'mine'; ask: string; draftIds: string[] }

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  } catch {
    return null
  }
}

/** This window answers for the sends it is itself carrying out. Returns the way to stop answering. */
export function answerSendOwnership(mine: (draftId: string) => boolean): () => void {
  const channel = openChannel()
  if (!channel) return () => {}
  channel.onmessage = event => {
    const message = event.data as OwnershipMessage
    if (message?.type !== 'who') return
    const draftIds = message.draftIds.filter(mine)
    if (draftIds.length) channel.postMessage({ type: 'mine', ask: message.ask, draftIds } satisfies OwnershipMessage)
  }
  return () => channel.close()
}

/** Which of these drafts another open Mail window says it is sending now. A claim is evidence of a live send; no claim is evidence of nothing. */
export async function draftsSendingElsewhere(draftIds: string[]): Promise<Set<string>> {
  const claimed = new Set<string>()
  const channel = draftIds.length ? openChannel() : null
  if (!channel) return claimed
  const ask = `${Date.now()}_${Math.random()}`
  channel.onmessage = event => {
    const message = event.data as OwnershipMessage
    if (message?.type === 'mine' && message.ask === ask) message.draftIds.forEach(id => claimed.add(id))
  }
  channel.postMessage({ type: 'who', ask, draftIds } satisfies OwnershipMessage)
  await new Promise(resolve => setTimeout(resolve, ANSWER_WAIT_MS))
  channel.close()
  return claimed
}

/** Drafts whose saved record says a send was in the air. */
export function draftsInTheAir(store: MailStore): string[] {
  return [...new Set([
    ...store.drafts.filter(draft => draft.sendAttempt).map(draft => draft.id),
    ...(store.runs ?? []).flatMap(run => run.items).filter(item => item.status === 'sending').map(item => item.draftId),
    ...(store.scheduledSends ?? []).filter(entry => entry.status === 'sending').map(entry => entry.draftId),
  ])]
}

/** What this window holds about another window's send may be old: take the saved record of how it ended. */
function withSavedOutcome(store: MailStore, saved: MailStore, draftIds: string[]): MailStore {
  let next = store
  for (const id of draftIds) {
    const mineNow = next.drafts.find(draft => draft.id === id)
    if (!mineNow) continue
    const onDisk = saved.drafts.find(draft => draft.id === id)
    if (onDisk) {
      if (onDisk.sendAttempt?.id !== mineNow.sendAttempt?.id || onDisk.sendState !== mineNow.sendState) next = { ...next, drafts: next.drafts.map(draft => (draft.id === id ? onDisk : draft)) }
      continue
    }
    const copy = confirmedSentCopy(saved, id)
    // Gone from the record with no copy of it: it may well have left, so it cannot read as nothing sent.
    next = copy
      ? { ...next, drafts: next.drafts.filter(draft => draft.id !== id), messages: [...next.messages.filter(message => message.id !== copy.id), copy] }
      : { ...next, drafts: next.drafts.map(draft => (draft.id === id ? { ...draft, sendState: 'uncertain' as const } : draft)) }
  }
  return next
}

/**
 * Settles sends no window claims. Asks the other open Mail windows first and
 * leaves alone what one claims, and reads the saved record afresh, since this
 * window's copy of another's send can be out of date. What nobody claims and no
 * saved outcome settles reads as unconfirmed, never as not sent: its window may
 * only be suspended. A failed read settles nothing.
 */
export async function settleAbandonedSends(input: {
  read: () => MailStore
  update: (updater: (store: MailStore) => MailStore) => void
  mine: (draftId: string) => boolean
  readSaved: () => Promise<MailStore | null>
}): Promise<void> {
  const foreign = draftsInTheAir(input.read()).filter(id => !input.mine(id))
  if (!foreign.length) return
  const claimed = await draftsSendingElsewhere(foreign)
  const open = foreign.filter(id => !claimed.has(id))
  if (!open.length) return
  const saved = await input.readSaved().catch(() => null)
  if (!saved) return
  input.update(store => {
    const free = open.filter(id => !input.mine(id))
    return recoverInterruptedSends(withSavedOutcome(store, saved, free), undefined, { scope: id => free.includes(id) })
  })
}
