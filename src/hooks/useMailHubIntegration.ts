import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  mailHub,
  type MailHubClient,
  type MailHubEvent,
  type MailSignal,
  type MarkDraftSentInput,
  type StagedMailDraft,
  type VoiceProfile,
} from '@purescience/platform-ui/bridge/mailHub'
import {
  createMailHubSyncTracker,
  discardHubDraft,
  formatSourceAppLabel,
  notifyHubDraftSent,
  openHubDraft,
  setCachedHubVoiceProfile,
  signalsForThread,
  syncStoreWithMailHub,
} from '../lib/mailHubSync'
import type { MailStore } from '../types'

export interface UseMailHubIntegrationInput {
  /** Enable hub event subscriptions, Outbox review, and signal loading. */
  enabled: boolean
  /** Enable background message ingestion, voice profile updates, and reply tracking (false for demo store). */
  allowIngestion: boolean
  store: MailStore
  storeRef: RefObject<MailStore>
  /** Accounts matched to an executive/organisation share are ingested with scope `'organisation'`. */
  orgAccountIds?: ReadonlySet<string>
  /** Injectable client for unit tests; defaults to the singleton `mailHub`. */
  client?: MailHubClient
  /** Optional subtle notice callback when cross-app events arrive. */
  onNotice?: (message: string) => void
}

export interface MailHubIntegrationApi {
  hubAvailable: boolean
  pendingDrafts: StagedMailDraft[]
  pendingSignals: MailSignal[]
  dueFollowUps: StagedMailDraft[]
  voiceProfile: VoiceProfile | null
  afterSync: () => void
  refresh: () => Promise<void>
  openStagedDraft: (draftId: string) => Promise<StagedMailDraft | null>
  discardStagedDraft: (draftId: string) => Promise<boolean>
  markHubDraftSent: (input: MarkDraftSentInput) => Promise<StagedMailDraft | null>
  acceptSignal: (signalId: string) => Promise<boolean>
  dismissSignal: (signalId: string) => Promise<boolean>
  getThreadSignals: (
    threadId: string,
    messageIds: ReadonlySet<string>,
  ) => MailSignal[]
}

function upsertById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const idx = list.findIndex(existing => existing.id === item.id)
  if (idx === -1) return [item, ...list]
  const next = list.slice()
  next[idx] = item
  return next
}

export function useMailHubIntegration(
  input: UseMailHubIntegrationInput,
): MailHubIntegrationApi {
  const client = input.client ?? mailHub
  const hubAvailable = input.enabled && client.isAvailable()

  const [pendingDrafts, setPendingDrafts] = useState<StagedMailDraft[]>([])
  const [pendingSignals, setPendingSignals] = useState<MailSignal[]>([])
  const [dueFollowUps, setDueFollowUps] = useState<StagedMailDraft[]>([])
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null)

  const trackerRef = useRef(createMailHubSyncTracker())
  const syncTailRef = useRef<Promise<void>>(Promise.resolve())
  const inputRef = useRef(input)
  inputRef.current = input

  const refresh = useCallback(async () => {
    const current = inputRef.current
    const activeClient = current.client ?? mailHub
    if (!current.enabled || !activeClient.isAvailable()) return
    try {
      const [drafts, signals, followUps, profile] = await Promise.all([
        activeClient.listDrafts({ status: 'pending' }).catch(() => [] as StagedMailDraft[]),
        activeClient.listSignals({ status: 'pending' }).catch(() => [] as MailSignal[]),
        activeClient.checkFollowUps().catch(() => [] as StagedMailDraft[]),
        activeClient.getVoiceProfile().catch(() => null as VoiceProfile | null),
      ])
      setPendingDrafts(drafts)
      setPendingSignals(signals)
      setDueFollowUps(followUps)
      setVoiceProfile(profile)
      setCachedHubVoiceProfile(profile)
    } catch {
      // Hub refresh is a side channel; never disrupt mail.
    }
  }, [])

  const runIncrementalSync = useCallback(() => {
    syncTailRef.current = syncTailRef.current.then(async () => {
      const current = inputRef.current
      const activeClient = current.client ?? mailHub
      if (!current.enabled || !current.allowIngestion || !activeClient.isAvailable()) {
        return
      }
      try {
        const result = await syncStoreWithMailHub({
          store: current.storeRef.current,
          tracker: trackerRef.current,
          client: activeClient,
          orgAccountIds: current.orgAccountIds,
        })
        if (result.extractedSignals.length > 0) {
          setPendingSignals(prev => {
            let next = prev
            for (const sig of result.extractedSignals) {
              if (sig.status === 'pending') next = upsertById(next, sig)
            }
            return next
          })
        }
        if (result.voiceProfile) {
          setVoiceProfile(result.voiceProfile)
          setCachedHubVoiceProfile(result.voiceProfile)
        }
        if (result.repliesRecorded > 0) {
          const followUps = await activeClient.checkFollowUps().catch(() => null)
          if (followUps) setDueFollowUps(followUps)
        }
      } catch {
        // Best-effort background sync.
      }
    })
  }, [])

  // Initial load + live Mail Hub event subscription + periodic follow-up check.
  useEffect(() => {
    if (!input.enabled || !client.isAvailable()) return
    void refresh()
    if (input.allowIngestion) {
      runIncrementalSync()
    }

    const unsubscribe = client.onEvent((event: MailHubEvent) => {
      switch (event.type) {
        case 'draft.staged': {
          if (event.draft.status === 'pending') {
            setPendingDrafts(prev => upsertById(prev, event.draft))
            const label = formatSourceAppLabel(event.sourceApp || event.draft.sourceApp)
            const subject = event.draft.subject?.trim() || '(no subject)'
            inputRef.current.onNotice?.(
              `New draft from ${label}: "${subject}" awaiting review.`,
            )
          }
          break
        }
        case 'mail.sent': {
          setPendingDrafts(prev => prev.filter(d => d.id !== event.draft.id))
          void client
            .checkFollowUps()
            .then(setDueFollowUps)
            .catch(() => undefined)
          break
        }
        case 'mail.replied': {
          void client
            .checkFollowUps()
            .then(setDueFollowUps)
            .catch(() => undefined)
          break
        }
        case 'mail.followup_due': {
          setDueFollowUps(prev => upsertById(prev, event.draft))
          break
        }
        case 'signal.extracted': {
          if (event.signal.status === 'pending') {
            setPendingSignals(prev => upsertById(prev, event.signal))
          }
          break
        }
        case 'signal.updated': {
          if (event.signal.status === 'pending') {
            setPendingSignals(prev => upsertById(prev, event.signal))
          } else {
            setPendingSignals(prev => prev.filter(s => s.id !== event.signal.id))
          }
          break
        }
        case 'voice_profile.updated': {
          setVoiceProfile(event.profile)
          setCachedHubVoiceProfile(event.profile)
          break
        }
      }
    })

    const followUpTimer = window.setInterval(() => {
      void client
        .checkFollowUps()
        .then(setDueFollowUps)
        .catch(() => undefined)
    }, 5 * 60_000)

    return () => {
      unsubscribe()
      window.clearInterval(followUpTimer)
    }
  }, [input.enabled, input.allowIngestion, client, refresh, runIncrementalSync])

  // Debounced incremental ingestion whenever synced messages or org scope changes.
  useEffect(() => {
    if (!input.enabled || !input.allowIngestion || !client.isAvailable()) return
    const timer = window.setTimeout(() => {
      runIncrementalSync()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [
    input.enabled,
    input.allowIngestion,
    input.store.messages,
    input.orgAccountIds,
    client,
    runIncrementalSync,
  ])

  const openStagedDraft = useCallback(
    async (draftId: string): Promise<StagedMailDraft | null> => {
      const activeClient = inputRef.current.client ?? mailHub
      const updated = await openHubDraft(draftId, activeClient)
      setPendingDrafts(prev => prev.filter(d => d.id !== draftId))
      return updated
    },
    [],
  )

  const discardStagedDraft = useCallback(async (draftId: string): Promise<boolean> => {
    const activeClient = inputRef.current.client ?? mailHub
    const discarded = await discardHubDraft(draftId, activeClient)
    if (discarded || !activeClient.isAvailable()) {
      setPendingDrafts(prev => prev.filter(d => d.id !== draftId))
      return Boolean(discarded)
    }
    return false
  }, [])

  const markHubDraftSent = useCallback(
    async (sentInput: MarkDraftSentInput): Promise<StagedMailDraft | null> => {
      const activeClient = inputRef.current.client ?? mailHub
      const result = await notifyHubDraftSent(sentInput, activeClient)
      setPendingDrafts(prev => prev.filter(d => d.id !== sentInput.draftId))
      return result
    },
    [],
  )

  const acceptSignal = useCallback(async (signalId: string): Promise<boolean> => {
    const activeClient = inputRef.current.client ?? mailHub
    if (!activeClient.isAvailable()) return false
    try {
      await activeClient.updateSignal(signalId, 'accepted')
      setPendingSignals(prev => prev.filter(s => s.id !== signalId))
      return true
    } catch {
      return false
    }
  }, [])

  const dismissSignal = useCallback(async (signalId: string): Promise<boolean> => {
    const activeClient = inputRef.current.client ?? mailHub
    if (!activeClient.isAvailable()) return false
    try {
      await activeClient.updateSignal(signalId, 'dismissed')
      setPendingSignals(prev => prev.filter(s => s.id !== signalId))
      return true
    } catch {
      return false
    }
  }, [])

  const getThreadSignals = useCallback(
    (threadId: string, messageIds: ReadonlySet<string>): MailSignal[] =>
      signalsForThread(pendingSignals, threadId, messageIds),
    [pendingSignals],
  )

  return {
    hubAvailable,
    pendingDrafts,
    pendingSignals,
    dueFollowUps,
    voiceProfile,
    afterSync: runIncrementalSync,
    refresh,
    openStagedDraft,
    discardStagedDraft,
    markHubDraftSent,
    acceptSignal,
    dismissSignal,
    getThreadSignals,
  }
}
