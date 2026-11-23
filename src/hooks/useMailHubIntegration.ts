import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
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
  hasAnyMailIntelligenceFeatureEnabled,
  mailIntelligenceToHubPolicy,
  notifyHubDraftSent,
  openHubDraft,
  resolveMailIntelligenceSettings,
  runMailHubHistoryScan,
  setCachedHubVoiceProfile,
  signalsForThread,
  syncStoreWithMailHub,
  type MailHubHistoryScanProgress,
} from '../lib/mailHubSync'
import type {
  MailIntelligenceHistoryRange,
  MailIntelligenceLastScanSummary,
  MailIntelligenceSettings,
  MailStore,
} from '../types'

export interface UseMailHubIntegrationInput {
  /** Shell-level gate (false for held copies). User opt-in is controlled via `store.settings.mailIntelligence`. */
  enabled: boolean
  /** Enable background message ingestion, voice profile updates, and reply tracking (false for demo store). */
  allowIngestion: boolean
  store: MailStore
  storeRef: RefObject<MailStore>
  /** Optional setter so completed history scans persist `lastHistoryScan` into `store.settings.mailIntelligence`. */
  setStore?: Dispatch<SetStateAction<MailStore>>
  /** Accounts matched to an executive/organisation share are ingested with scope `'organisation'` when org sharing is enabled. */
  orgAccountIds?: ReadonlySet<string>
  /** Injectable client for unit tests; defaults to the singleton `mailHub`. */
  client?: MailHubClient
  /** Optional subtle notice callback when cross-app events arrive. */
  onNotice?: (message: string) => void
}

export interface MailHubHistoryScanState {
  running: boolean
  progress: MailHubHistoryScanProgress | null
}

export interface MailHubIntegrationApi {
  hubAvailable: boolean
  settings: MailIntelligenceSettings
  pendingDrafts: StagedMailDraft[]
  pendingSignals: MailSignal[]
  dueFollowUps: StagedMailDraft[]
  voiceProfile: VoiceProfile | null
  historyScan: MailHubHistoryScanState
  afterSync: () => void
  refresh: () => Promise<void>
  runHistoryScan: (
    range: MailIntelligenceHistoryRange,
  ) => Promise<MailIntelligenceLastScanSummary | null>
  cancelHistoryScan: () => void
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
  const settings = useMemo(
    () => resolveMailIntelligenceSettings(input.store),
    [input.store.settings.mailIntelligence],
  )
  const policyKey = useMemo(
    () => JSON.stringify(mailIntelligenceToHubPolicy(settings)),
    [settings],
  )
  const active = input.enabled && hasAnyMailIntelligenceFeatureEnabled(settings)
  const hubAvailable = input.enabled && client.isAvailable()

  const [pendingDrafts, setPendingDrafts] = useState<StagedMailDraft[]>([])
  const [pendingSignals, setPendingSignals] = useState<MailSignal[]>([])
  const [dueFollowUps, setDueFollowUps] = useState<StagedMailDraft[]>([])
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null)
  const [historyScan, setHistoryScan] = useState<MailHubHistoryScanState>({
    running: false,
    progress: null,
  })

  const trackerRef = useRef(createMailHubSyncTracker())
  const syncTailRef = useRef<Promise<void>>(Promise.resolve())
  const scanAbortRef = useRef<AbortController | null>(null)
  const inputRef = useRef(input)
  inputRef.current = input
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Sync user's granular Mail Intelligence policy to the shell Mail Hub firewall.
  useEffect(() => {
    if (!input.enabled || !client.isAvailable()) return
    void client
      .updatePolicy(mailIntelligenceToHubPolicy(settingsRef.current))
      .catch(() => undefined)
  }, [input.enabled, client, policyKey])

  // Clear disabled feature surfaces immediately so turning any toggle off takes effect right away.
  useEffect(() => {
    if (!active || !settings.crossAppOutbox) {
      setPendingDrafts([])
      setDueFollowUps([])
    }
    if (!active || !settings.signalExtraction) {
      setPendingSignals([])
    }
    if (!active || !settings.voiceProfile) {
      setVoiceProfile(null)
      setCachedHubVoiceProfile(null)
    }
  }, [
    active,
    settings.crossAppOutbox,
    settings.signalExtraction,
    settings.voiceProfile,
  ])

  const refresh = useCallback(async () => {
    const current = inputRef.current
    const currentSettings = settingsRef.current
    const activeClient = current.client ?? mailHub
    if (
      !current.enabled ||
      !hasAnyMailIntelligenceFeatureEnabled(currentSettings) ||
      !activeClient.isAvailable()
    ) {
      return
    }
    try {
      const [drafts, signals, followUps, profile] = await Promise.all([
        currentSettings.crossAppOutbox
          ? activeClient
              .listDrafts({ status: 'pending' })
              .catch(() => [] as StagedMailDraft[])
          : Promise.resolve([] as StagedMailDraft[]),
        currentSettings.signalExtraction
          ? activeClient
              .listSignals({ status: 'pending' })
              .catch(() => [] as MailSignal[])
          : Promise.resolve([] as MailSignal[]),
        currentSettings.crossAppOutbox
          ? activeClient
              .checkFollowUps()
              .catch(() => [] as StagedMailDraft[])
          : Promise.resolve([] as StagedMailDraft[]),
        currentSettings.voiceProfile
          ? activeClient
              .getVoiceProfile()
              .catch(() => null as VoiceProfile | null)
          : Promise.resolve(null as VoiceProfile | null),
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
      const currentSettings = settingsRef.current
      const activeClient = current.client ?? mailHub
      if (
        !current.enabled ||
        !current.allowIngestion ||
        !hasAnyMailIntelligenceFeatureEnabled(currentSettings) ||
        !activeClient.isAvailable()
      ) {
        return
      }
      try {
        const result = await syncStoreWithMailHub({
          store: current.storeRef.current,
          tracker: trackerRef.current,
          client: activeClient,
          orgAccountIds: current.orgAccountIds,
          settings: currentSettings,
        })
        if (currentSettings.signalExtraction && result.extractedSignals.length > 0) {
          setPendingSignals(prev => {
            let next = prev
            for (const sig of result.extractedSignals) {
              if (sig.status === 'pending') next = upsertById(next, sig)
            }
            return next
          })
        }
        if (currentSettings.voiceProfile && result.voiceProfile) {
          setVoiceProfile(result.voiceProfile)
          setCachedHubVoiceProfile(result.voiceProfile)
        }
        if (currentSettings.crossAppOutbox && result.repliesRecorded > 0) {
          const followUps = await activeClient.checkFollowUps().catch(() => null)
          if (followUps) setDueFollowUps(followUps)
        }
      } catch {
        // Best-effort background sync.
      }
    })
  }, [])

  // Refresh Hub snapshots on activation or whenever a surfaced capability is toggled on.
  useEffect(() => {
    if (!active || !client.isAvailable()) return
    void refresh()
  }, [
    active,
    settings.crossAppOutbox,
    settings.signalExtraction,
    settings.voiceProfile,
    client,
    refresh,
  ])

  // Initial sync + live Mail Hub event subscription + periodic follow-up check.
  useEffect(() => {
    if (!active || !client.isAvailable()) return
    if (input.allowIngestion) {
      runIncrementalSync()
    }

    const unsubscribe = client.onEvent((event: MailHubEvent) => {
      const currentSettings = settingsRef.current
      if (!currentSettings.enabled) return
      switch (event.type) {
        case 'draft.staged': {
          if (currentSettings.crossAppOutbox && event.draft.status === 'pending') {
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
          if (!currentSettings.crossAppOutbox) break
          setPendingDrafts(prev => prev.filter(d => d.id !== event.draft.id))
          void client
            .checkFollowUps()
            .then(setDueFollowUps)
            .catch(() => undefined)
          break
        }
        case 'mail.replied': {
          if (!currentSettings.crossAppOutbox) break
          void client
            .checkFollowUps()
            .then(setDueFollowUps)
            .catch(() => undefined)
          break
        }
        case 'mail.followup_due': {
          if (currentSettings.crossAppOutbox) {
            setDueFollowUps(prev => upsertById(prev, event.draft))
          }
          break
        }
        case 'signal.extracted': {
          if (currentSettings.signalExtraction && event.signal.status === 'pending') {
            setPendingSignals(prev => upsertById(prev, event.signal))
          }
          break
        }
        case 'signal.updated': {
          if (!currentSettings.signalExtraction) break
          if (event.signal.status === 'pending') {
            setPendingSignals(prev => upsertById(prev, event.signal))
          } else {
            setPendingSignals(prev => prev.filter(s => s.id !== event.signal.id))
          }
          break
        }
        case 'voice_profile.updated': {
          if (currentSettings.voiceProfile) {
            setVoiceProfile(event.profile)
            setCachedHubVoiceProfile(event.profile)
          }
          break
        }
      }
    })

    const followUpTimer = window.setInterval(() => {
      if (!settingsRef.current.crossAppOutbox) return
      void client
        .checkFollowUps()
        .then(setDueFollowUps)
        .catch(() => undefined)
    }, 5 * 60_000)

    return () => {
      unsubscribe()
      window.clearInterval(followUpTimer)
    }
  }, [active, input.allowIngestion, client, refresh, runIncrementalSync])

  // Debounced incremental ingestion whenever synced messages, org scope, or settings change.
  useEffect(() => {
    if (!active || !input.allowIngestion || !client.isAvailable()) return
    const timer = window.setTimeout(() => {
      runIncrementalSync()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [
    active,
    input.allowIngestion,
    input.store.messages,
    input.orgAccountIds,
    policyKey,
    client,
    runIncrementalSync,
  ])

  const cancelHistoryScan = useCallback(() => {
    scanAbortRef.current?.abort()
  }, [])

  const runHistoryScan = useCallback(
    async (
      range: MailIntelligenceHistoryRange,
    ): Promise<MailIntelligenceLastScanSummary | null> => {
      const current = inputRef.current
      const currentSettings = settingsRef.current
      const activeClient = current.client ?? mailHub
      if (
        !current.enabled ||
        !activeClient.isAvailable() ||
        !hasAnyMailIntelligenceFeatureEnabled(currentSettings)
      ) {
        return null
      }

      scanAbortRef.current?.abort()
      const controller = new AbortController()
      scanAbortRef.current = controller

      setHistoryScan({
        running: true,
        progress: {
          phase: 'policy',
          scannedMessages: 0,
          totalMessages: 0,
          ingestedMessages: 0,
          blockedByPrivacy: 0,
          signalsExtracted: 0,
          voiceSamplesAnalyzed: 0,
          repliesRecorded: 0,
        },
      })

      try {
        const result = await runMailHubHistoryScan({
          store: current.storeRef.current,
          settings: currentSettings,
          range,
          tracker: trackerRef.current,
          client: activeClient,
          orgAccountIds: current.orgAccountIds,
          signal: controller.signal,
          onProgress: progress => {
            setHistoryScan({ running: progress.phase !== 'done' && progress.phase !== 'cancelled', progress })
          },
        })

        if (currentSettings.signalExtraction && result.extractedSignals.length > 0) {
          setPendingSignals(prev => {
            let next = prev
            for (const sig of result.extractedSignals) {
              if (sig.status === 'pending') next = upsertById(next, sig)
            }
            return next
          })
        }
        if (currentSettings.voiceProfile && result.voiceProfile) {
          setVoiceProfile(result.voiceProfile)
          setCachedHubVoiceProfile(result.voiceProfile)
        }

        current.setStore?.(prev => {
          const prevMi = resolveMailIntelligenceSettings(prev)
          return {
            ...prev,
            settings: {
              ...prev.settings,
              mailIntelligence: {
                ...prevMi,
                defaultHistoryRange: range,
                lastHistoryScan: result.summary,
              },
            },
          }
        })

        await refresh()
        const noticePrefix = result.summary.cancelled
          ? 'History scan stopped'
          : 'History scan complete'
        current.onNotice?.(
          `${noticePrefix} (${result.summary.rangeLabel}): ${result.summary.scannedMessages} emails scanned, ${result.summary.signalsExtracted} signals extracted.`,
        )
        return result.summary
      } catch {
        setHistoryScan(prev => ({ ...prev, running: false }))
        return null
      } finally {
        if (scanAbortRef.current === controller) {
          scanAbortRef.current = null
        }
        setHistoryScan(prev => ({ ...prev, running: false }))
      }
    },
    [refresh],
  )

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
    (threadId: string, messageIds: ReadonlySet<string>): MailSignal[] => {
      if (!settings.enabled || !settings.signalExtraction) return []
      return signalsForThread(pendingSignals, threadId, messageIds)
    },
    [pendingSignals, settings.enabled, settings.signalExtraction],
  )

  return {
    hubAvailable,
    settings,
    pendingDrafts: settings.enabled && settings.crossAppOutbox ? pendingDrafts : [],
    pendingSignals: settings.enabled && settings.signalExtraction ? pendingSignals : [],
    dueFollowUps: settings.enabled && settings.crossAppOutbox ? dueFollowUps : [],
    voiceProfile: settings.enabled && settings.voiceProfile ? voiceProfile : null,
    historyScan,
    afterSync: runIncrementalSync,
    refresh,
    runHistoryScan,
    cancelHistoryScan,
    openStagedDraft,
    discardStagedDraft,
    markHubDraftSent,
    acceptSignal,
    dismissSignal,
    getThreadSignals,
  }
}
