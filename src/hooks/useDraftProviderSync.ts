import { useEffect, useRef } from 'react'
import { mailProviderSupports } from '../lib/mailProviderCapabilities'
import type { Draft, MailProvider, MailStore } from '../types'

/** How long a draft must sit unchanged before it is pushed to the provider. */
const SYNC_DEBOUNCE_MS = 1500

/** Attempts before a draft is left local and the user is told why. */
const MAX_SYNC_ATTEMPTS = 3

/** Attempts to remove a discarded draft from the provider before giving up. */
const MAX_DELETE_ATTEMPTS = 4

type DraftSyncProvider = Pick<
  MailProvider,
  'capabilities' | 'createDraft' | 'updateDraft' | 'deleteDraft'
>

/** A draft with nothing in it yet is not worth a row in the user's real Drafts. */
function worthSyncing(draft: Draft): boolean {
  if (draft.sentAt) return false
  if (draft.syncState === 'synced') return false
  // 'failed' means we already tried and the provider would not take it.
  // Retrying on every render would append a duplicate per attempt on a
  // provider whose create half-succeeds. An edit resets it to 'pending',
  // which is the retry.
  if (draft.syncState === 'failed') return false
  // An attachment is content too: a draft that is only a file the agent
  // attached still belongs in the account's Drafts.
  return Boolean(
    draft.body.trim() || draft.subject.trim() || draft.attachments.length,
  )
}

/**
 * Keep drafts in step with the provider's own Drafts folder.
 *
 * Before this, exactly two call sites reached `createDraft` — Compose's Save,
 * and the generated-draft filing step — and `updateDraft` was never called
 * from anywhere at all. So reply drafts, forwards and agent-composed messages
 * never left the machine, and a draft that did reach Gmail was frozen at its
 * first-save content no matter how long you edited it.
 *
 * Doing it here instead of at each call site means every draft, however it was
 * made, syncs by the same rule: when it changes and then stops changing, it is
 * pushed. `syncState` is the trigger — draft edits already mark it `pending` —
 * so an edit made offline re-syncs the moment a write succeeds again.
 *
 * This hook owns the whole provider-side lifecycle, deletion included, because
 * create and delete have to agree: discarding a draft mid-save has to remove
 * whatever that save creates, and only the thing holding the in-flight promise
 * can know.
 */
export function useDraftProviderSync(input: {
  store: MailStore
  setStore: (updater: (current: MailStore) => MailStore) => void
  provider: DraftSyncProvider | null | undefined
  onError?: (message: string) => void
  onNotice?: (message: string) => void
}): {
  /**
   * This draft is gone locally — make it gone at the provider too.
   *
   * Call on discard. Handles the case the shell cannot: a draft discarded
   * while its `createDraft` is still in flight has no `providerDraftId` to
   * delete yet, so without this the save lands a moment later and leaves a
   * draft in the user's Gmail that PureMail no longer knows about — which the
   * next sync then pulls back in as a new draft. Discard, and it returns.
   */
  forgetDraft: (draft: Draft) => void
} {
  const { store, setStore, provider, onError, onNotice } = input
  const inFlightRef = useRef<Set<string>>(new Set())
  const attemptsRef = useRef<Map<string, number>>(new Map())
  /** Drafts discarded locally; anything they create must be removed. */
  const discardedRef = useRef<Set<string>>(new Set())
  const storeRef = useRef(store)
  storeRef.current = store
  const providerRef = useRef(provider)
  providerRef.current = provider
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice

  /**
   * Remove a provider draft, retrying a few times. A delete that quietly fails
   * is worse than most failures here: the local copy is already gone, so the
   * next sync sees a draft the provider still lists and adds it back. The
   * discard would look like it had been undone.
   */
  const deleteFromProvider = useRef(
    async (providerDraftId: string, attempt = 1): Promise<void> => {
      const active = providerRef.current
      if (!active?.deleteDraft) return
      try {
        await active.deleteDraft(providerDraftId)
        onNoticeRef.current?.('Draft discarded, at the account too.')
      } catch (error) {
        if (attempt < MAX_DELETE_ATTEMPTS) {
          await new Promise(resolve =>
            setTimeout(resolve, 400 * 2 ** (attempt - 1)),
          )
          return deleteFromProvider.current(providerDraftId, attempt + 1)
        }
        onErrorRef.current?.(
          error instanceof Error
            ? `Discarded here, but the account still holds its copy — it will come back on the next sync. (${error.message})`
            : 'Discarded here, but the account still holds its copy — it will come back on the next sync.',
        )
      }
    },
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!provider || !mailProviderSupports(provider, 'drafts')) return
    const pending = store.drafts.filter(
      draft => worthSyncing(draft) && !inFlightRef.current.has(draft.id),
    )
    if (pending.length === 0) return

    const timer = window.setTimeout(() => {
      for (const queued of pending) {
        // Re-read at fire time: the draft may have been discarded or sent
        // during the debounce, and pushing a discarded draft to Gmail would
        // resurrect it there.
        const current = storeRef.current.drafts.find(
          item => item.id === queued.id,
        )
        const active = providerRef.current
        if (!current || !worthSyncing(current) || !active) continue
        if (inFlightRef.current.has(current.id)) continue
        if (discardedRef.current.has(current.id)) continue
        inFlightRef.current.add(current.id)

        const settle = (): void => {
          inFlightRef.current.delete(current.id)
        }
        const finish = (patch: Partial<Draft>): void => {
          settle()
          attemptsRef.current.delete(current.id)
          // Discarded while this was in flight: the provider draft it just
          // made has to go, and nothing else knows its id.
          if (discardedRef.current.has(current.id)) {
            discardedRef.current.delete(current.id)
            const providerDraftId =
              patch.providerDraftId ?? current.providerDraftId
            if (providerDraftId) void deleteFromProvider.current(providerDraftId)
            return
          }
          setStore(latest => ({
            ...latest,
            drafts: latest.drafts.map(item =>
              item.id === current.id ? { ...item, ...patch } : item,
            ),
          }))
        }
        const fail = (error: unknown): void => {
          settle()
          if (discardedRef.current.has(current.id)) {
            discardedRef.current.delete(current.id)
            return
          }
          const attempts = (attemptsRef.current.get(current.id) ?? 0) + 1
          attemptsRef.current.set(current.id, attempts)
          const reason =
            error instanceof Error ? error.message : 'the provider refused it'
          if (attempts >= MAX_SYNC_ATTEMPTS) {
            setStore(latest => ({
              ...latest,
              drafts: latest.drafts.map(item =>
                item.id === current.id
                  ? { ...item, syncState: 'failed' as const }
                  : item,
              ),
            }))
            onErrorRef.current?.(
              `Draft kept on this machine only — it could not be saved to the account. (${reason})`,
            )
            return
          }
          onErrorRef.current?.(
            `Draft saved locally — retrying the account copy. (${reason})`,
          )
        }

        if (current.providerDraftId) {
          if (!active.updateDraft) {
            settle()
            continue
          }
          void active
            .updateDraft(current.providerDraftId, current)
            .then(replacementId =>
              finish({
                syncState: 'synced',
                // IMAP updates REPLACE the stored draft; re-point the local
                // record or the next sync deletes it as gone-at-provider
                // and re-imports the replacement as a new record.
                ...(typeof replacementId === 'string' && replacementId
                  ? { providerDraftId: replacementId }
                  : {}),
              }),
            )
            .catch(fail)
          continue
        }
        if (!active.createDraft) {
          settle()
          continue
        }
        void active
          .createDraft(current)
          .then(providerDraftId =>
            finish({ providerDraftId, syncState: 'synced' }),
          )
          .catch(fail)
      }
    }, SYNC_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [store.drafts, provider, setStore, store])

  return {
    forgetDraft: (draft: Draft) => {
      const active = providerRef.current
      if (!active || !mailProviderSupports(active, 'drafts')) return
      if (inFlightRef.current.has(draft.id)) {
        // The save is mid-flight; delete once it lands and we know the id.
        discardedRef.current.add(draft.id)
        return
      }
      // Also blocks a debounced save that has not fired yet.
      discardedRef.current.add(draft.id)
      if (draft.providerDraftId) {
        discardedRef.current.delete(draft.id)
        void deleteFromProvider.current(draft.providerDraftId)
      }
    },
  }
}
