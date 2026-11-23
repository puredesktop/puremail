// @vitest-environment happy-dom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMailHubClient,
  type DailyBriefingPacket,
  type MailHubBridgeTransport,
  type MailHubEvent,
  type MailSignal,
  type StagedMailDraft,
  type VoiceProfile,
} from '@purescience/platform-ui/bridge/mailHub'
import { PLATFORM_BRIDGE_EVENTS } from '@purescience/platform-ui/bridge/events.mjs'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods.mjs'
import { demoMailStoreForNow } from '../test/mailFixtures'
import { prepareReplyContext } from './mailDraftAgent'
import {
  buildMailIntelligenceBriefing,
  createMailHubSyncTracker,
  discardHubDraft,
  formatSourceAppLabel,
  getCachedHubVoiceProfile,
  hubDraftToComposeFields,
  notifyHubDraftSent,
  openHubDraft,
  setCachedHubVoiceProfile,
  signalsForThread,
  syncStoreWithMailHub,
  toIngestedMailMessage,
} from './mailHubSync'
import { MailHubOutboxBanner } from '../components/MailHubOutboxBanner'
import { ThreadSignalChips } from '../components/ThreadSignalChips'
import { useMailHubIntegration, type MailHubIntegrationApi } from '../hooks/useMailHubIntegration'
import type { MailMessage, MailStore } from '../types'

const NOW = new Date('2026-11-23T10:00:00.000Z')

const SAMPLE_VOICE_PROFILE: VoiceProfile = {
  updatedAt: '2026-11-23T09:00:00.000Z',
  sampleCount: 18,
  avgSentenceWords: 11.4,
  directnessScore: 0.84,
  usesBulletsRate: 0.35,
  exclamationRate: 0.08,
  topGreetings: ['Hi', 'Hello'],
  topSignOffs: ['Best,', 'Thanks,'],
  byAudience: {
    executive: {
      sampleCount: 6,
      avgSentenceWords: 10,
      directnessScore: 0.9,
      topGreetings: ['Hi'],
      topSignOffs: ['Best,'],
      toneSummary: 'Crisp and executive.',
    },
    teammate: {
      sampleCount: 8,
      avgSentenceWords: 12,
      directnessScore: 0.85,
      topGreetings: ['Hey'],
      topSignOffs: ['Thanks,'],
      toneSummary: 'Direct and collaborative.',
    },
    external: {
      sampleCount: 4,
      avgSentenceWords: 13,
      directnessScore: 0.75,
      topGreetings: ['Hello'],
      topSignOffs: ['Best regards,'],
      toneSummary: 'Clear and courteous.',
    },
  },
  promptSummary: 'Write concise, high-clarity messages with direct opening answers.',
}

const SAMPLE_DRAFT: StagedMailDraft = {
  id: 'hub_draft_inv_42',
  sourceApp: 'invoicing',
  sourceRecordId: 'inv_42',
  sourceLabel: 'Invoice #1042',
  to: ['billing@acme.example'],
  cc: ['finance@acme.example'],
  subject: 'Invoice #1042 — Q4 Platform Renewal',
  body: 'Hi Acme team,\n\nAttached is Invoice #1042 due in 14 days.\n\nBest,\nAdam',
  followUpDays: 5,
  status: 'pending',
  createdAt: '2026-11-23T08:30:00.000Z',
  updatedAt: '2026-11-23T08:30:00.000Z',
}

const SAMPLE_SIGNALS: MailSignal[] = [
  {
    id: 'sig_receipt_1',
    kind: 'receipt',
    targetApp: 'expenses',
    scope: 'personal',
    messageId: 'msg_1',
    threadId: 'thread_1',
    from: 'receipts@aws.example',
    subject: 'Your November AWS Invoice',
    summary: 'Cloud hosting charge $248.00',
    confidence: 0.94,
    status: 'pending',
    extractedAt: '2026-11-23T08:00:00.000Z',
    updatedAt: '2026-11-23T08:00:00.000Z',
    data: { amount: 248, currency: 'USD' },
  },
  {
    id: 'sig_redline_2',
    kind: 'contract_redline',
    targetApp: 'redline',
    scope: 'organisation',
    messageId: 'msg_2',
    threadId: 'thread_1',
    from: 'legal@partner.example',
    subject: 'MSA Redlines v3',
    summary: 'Updated indemnity cap in Section 8.2',
    confidence: 0.89,
    status: 'pending',
    extractedAt: '2026-11-23T08:15:00.000Z',
    updatedAt: '2026-11-23T08:15:00.000Z',
    data: { clause: '8.2' },
  },
  {
    id: 'sig_dismissed_3',
    kind: 'paper_share',
    targetApp: 'reader',
    scope: 'personal',
    messageId: 'msg_3',
    threadId: 'thread_1',
    from: 'colleague@lab.example',
    subject: 'Preprint attached',
    summary: 'Shared PDF preprint',
    confidence: 0.8,
    status: 'dismissed',
    extractedAt: '2026-11-23T07:00:00.000Z',
    updatedAt: '2026-11-23T07:30:00.000Z',
    data: {},
  },
]

const SAMPLE_BRIEFING: DailyBriefingPacket = {
  generatedAt: '2026-11-23T09:30:00.000Z',
  date: '2026-11-23',
  summary: '1 draft awaiting review, 2 signals ready, 1 overdue follow-up.',
  sections: [
    {
      id: 'outbox',
      title: 'Cross-App Outbox',
      sourceApp: 'mail',
      priority: 'normal',
      items: [
        {
          id: 'item_1',
          title: 'Invoice #1042 — Q4 Platform Renewal',
          sourceApp: 'invoicing',
          priority: 'normal',
        },
      ],
    },
  ],
  counts: {
    pendingDrafts: 1,
    dueFollowUps: 1,
    pendingSignals: 2,
    urgentItems: 1,
  },
  markdown: '# Morning Briefing\n\n- 1 pending draft from PureInvoicing',
  cloudSyncPayload: {
    version: 1,
    generatedAt: '2026-11-23T09:30:00.000Z',
    date: '2026-11-23',
    summary: '1 draft awaiting review, 2 signals ready, 1 overdue follow-up.',
    counts: {
      pendingDrafts: 1,
      dueFollowUps: 1,
      pendingSignals: 2,
      urgentItems: 1,
    },
    sectionIds: ['outbox'],
  },
}

function createFakeHubHarness() {
  const listeners = new Set<(payload: unknown) => void>()
  const calls: Array<{ method: string; args: unknown[] }> = []

  const state = {
    drafts: [SAMPLE_DRAFT] as StagedMailDraft[],
    signals: [...SAMPLE_SIGNALS] as MailSignal[],
    followUps: [
      {
        ...SAMPLE_DRAFT,
        id: 'hub_draft_followup_1',
        sourceApp: 'outreach',
        subject: 'Following up on partnership proposal',
        status: 'sent' as const,
        sentAt: '2026-11-18T10:00:00.000Z',
        followUpDueAt: '2026-11-22T10:00:00.000Z',
      },
    ] as StagedMailDraft[],
    voiceProfile: SAMPLE_VOICE_PROFILE as VoiceProfile | null,
    briefing: SAMPLE_BRIEFING as DailyBriefingPacket,
    failNextIngest: false,
    extractedOnIngest: [] as MailSignal[],
  }

  const transport: MailHubBridgeTransport = {
    call: async <T = unknown>(method: string, args: unknown[] = []): Promise<T> => {
      calls.push({ method, args })
      const payload = (args[0] ?? {}) as Record<string, unknown>

      switch (method) {
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_INGEST_MESSAGES: {
          if (state.failNextIngest) {
            state.failNextIngest = false
            throw new Error('Bridge temporarily busy')
          }
          const messages = (payload.messages as unknown[]) ?? []
          return {
            ingested: messages.length,
            blockedByPrivacy: 0,
            indexed: messages.length,
            usedEmbeddings: false,
            signalsExtracted: state.extractedOnIngest,
          } as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_UPDATE_VOICE_PROFILE:
          return state.voiceProfile as T
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_GET_VOICE_PROFILE:
          return state.voiceProfile as T
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_RECORD_REPLY:
          return [{ ...SAMPLE_DRAFT, status: 'sent', replyMessageId: String(payload.replyMessageId) }] as T
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_LIST_DRAFTS: {
          const status = payload.status
          const list = status
            ? state.drafts.filter(d =>
                Array.isArray(status) ? status.includes(d.status) : d.status === status,
              )
            : state.drafts
          return list as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_MARK_DRAFT_OPENED: {
          const id = String(payload.draftId)
          state.drafts = state.drafts.map(d =>
            d.id === id ? { ...d, status: 'opened' as const } : d,
          )
          return state.drafts.find(d => d.id === id) as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_MARK_DRAFT_SENT: {
          const id = String(payload.draftId)
          state.drafts = state.drafts.map(d =>
            d.id === id
              ? {
                  ...d,
                  status: 'sent' as const,
                  sentMessageId: payload.sentMessageId as string | undefined,
                  sentThreadId: payload.sentThreadId as string | undefined,
                  sentAt: payload.sentAt as string | undefined,
                }
              : d,
          )
          return state.drafts.find(d => d.id === id) as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_DISCARD_DRAFT: {
          const id = String(payload.draftId)
          state.drafts = state.drafts.map(d =>
            d.id === id ? { ...d, status: 'discarded' as const } : d,
          )
          return state.drafts.find(d => d.id === id) as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_CHECK_FOLLOWUPS:
          return state.followUps as T
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_LIST_SIGNALS: {
          const status = payload.status
          const scope = payload.scope
          return state.signals.filter(s => {
            if (status) {
              const ok = Array.isArray(status) ? status.includes(s.status) : s.status === status
              if (!ok) return false
            }
            if (scope && s.scope !== scope) return false
            return true
          }) as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_UPDATE_SIGNAL: {
          const id = String(payload.signalId)
          const status = payload.status as MailSignal['status']
          state.signals = state.signals.map(s => (s.id === id ? { ...s, status } : s))
          return state.signals.find(s => s.id === id) as T
        }
        case PLATFORM_BRIDGE_METHODS.MAIL_HUB_GENERATE_BRIEFING:
          return state.briefing as T
        default:
          throw new Error(`Unexpected bridge method: ${method}`)
      }
    },
    onEvent: (name, listener) => {
      if (name === PLATFORM_BRIDGE_EVENTS.MAIL_HUB_EVENT) {
        listeners.add(listener)
      }
      return () => {
        listeners.delete(listener)
      }
    },
  }

  const client = createMailHubClient(transport)
  const emit = (event: MailHubEvent) => {
    for (const listener of listeners) listener(event)
  }

  return { client, calls, state, emit }
}

afterEach(() => {
  setCachedHubVoiceProfile(null)
  document.body.innerHTML = ''
})

describe('mailHubSync: message ingestion, deduplication, voice profile & reply tracking', () => {
  it('tags personal vs organisation scope and skips drafts/optimistic messages', async () => {
    const store = demoMailStoreForNow(NOW)
    const accountId = store.accounts[0]!.id
    const thread = store.threads[0]!
    const draftMsg: MailMessage = {
      ...store.messages[0]!,
      id: 'msg_draft_skip',
      isDraft: true,
    }
    const optimisticMsg: MailMessage = {
      ...store.messages[0]!,
      id: 'msg_optimistic_skip',
      optimistic: true,
    }
    const storeWithExtra: MailStore = {
      ...store,
      messages: [...store.messages, draftMsg, optimisticMsg],
    }

    const personal = toIngestedMailMessage(store.messages[0]!, {
      thread,
      ownEmails: new Set([store.accounts[0]!.email.toLowerCase()]),
    })
    expect(personal.scope).toBe('personal')

    const org = toIngestedMailMessage(store.messages[0]!, {
      thread,
      ownEmails: new Set([store.accounts[0]!.email.toLowerCase()]),
      orgAccountIds: new Set([accountId]),
    })
    expect(org.scope).toBe('organisation')

    const harness = createFakeHubHarness()
    const tracker = createMailHubSyncTracker()

    const first = await syncStoreWithMailHub({
      store: storeWithExtra,
      tracker,
      client: harness.client,
      orgAccountIds: new Set([accountId]),
    })

    const expectedRealCount = store.messages.filter(m => !m.isDraft && !m.optimistic).length
    expect(first.skipped).toBe(false)
    expect(first.ingestedCount).toBe(expectedRealCount)
    expect(tracker.ingestedMessageIds.has('msg_draft_skip')).toBe(false)
    expect(tracker.ingestedMessageIds.has('msg_optimistic_skip')).toBe(false)

    // Second sync with the same store must be a no-op (strict deduplication).
    const ingestCallsBefore = harness.calls.filter(
      c => c.method === PLATFORM_BRIDGE_METHODS.MAIL_HUB_INGEST_MESSAGES,
    ).length
    const second = await syncStoreWithMailHub({
      store: storeWithExtra,
      tracker,
      client: harness.client,
      orgAccountIds: new Set([accountId]),
    })
    expect(second.ingestedCount).toBe(0)
    expect(second.voiceUpdated).toBe(false)
    expect(
      harness.calls.filter(
        c => c.method === PLATFORM_BRIDGE_METHODS.MAIL_HUB_INGEST_MESSAGES,
      ).length,
    ).toBe(ingestCallsBefore)

    // Adding a brand new inbound reply on an existing thread ingests ONLY that message
    // and records an inbound reply via mailHub.recordReply.
    const newReply: MailMessage = {
      id: 'msg_new_inbound_reply',
      threadId: thread.id,
      from: { name: 'Maya Chen', email: 'maya@partner.example' },
      to: [{ name: store.accounts[0]!.name, email: store.accounts[0]!.email }],
      subject: `Re: ${thread.subject}`,
      body: 'Thanks, we approved the revised schedule and will send the signed copy today.',
      receivedAt: '2026-11-23T09:50:00.000Z',
      inReplyTo: '<orig-msg@puremail.local>',
      attachments: [],
      read: false,
    }
    const third = await syncStoreWithMailHub({
      store: { ...storeWithExtra, messages: [...storeWithExtra.messages, newReply] },
      tracker,
      client: harness.client,
      orgAccountIds: new Set([accountId]),
    })
    expect(third.ingestedCount).toBe(1)
    expect(third.repliesRecorded).toBeGreaterThanOrEqual(1)
    const replyCalls = harness.calls.filter(
      c => c.method === PLATFORM_BRIDGE_METHODS.MAIL_HUB_RECORD_REPLY,
    )
    expect(
      replyCalls.some(
        c =>
          (c.args[0] as { replyMessageId?: string }).replyMessageId ===
          'msg_new_inbound_reply',
      ),
    ).toBe(true)
  })

  it('retries failed ingestion chunks on next sync and grounds reply prompts with Voice Profile', async () => {
    const store = demoMailStoreForNow(NOW)
    const own = store.accounts[0]!
    const sentMsg: MailMessage = {
      id: 'msg_sent_voice_1',
      threadId: store.threads[0]!.id,
      from: { name: own.name, email: own.email },
      to: [{ name: 'Alex', email: 'alex@client.example' }],
      subject: 'Re: Launch timing',
      body: 'Hi Alex,\n\nConfirmed for Thursday at 10am. Let us lock the checklist today.\n\nBest,\nAdam',
      receivedAt: '2026-11-23T09:40:00.000Z',
      attachments: [],
      read: true,
    }
    const storeWithSent: MailStore = {
      ...store,
      messages: [...store.messages, sentMsg],
    }

    const harness = createFakeHubHarness()
    harness.state.failNextIngest = true
    const tracker = createMailHubSyncTracker()

    const first = await syncStoreWithMailHub({
      store: storeWithSent,
      tracker,
      client: harness.client,
      batchSize: 500,
    })
    // Ingest chunk failed so tracker stayed empty, while voice profile still updated.
    expect(first.ingestedCount).toBe(0)
    expect(tracker.ingestedMessageIds.size).toBe(0)
    expect(first.voiceUpdated).toBe(true)
    expect(getCachedHubVoiceProfile()?.promptSummary).toBe(
      SAMPLE_VOICE_PROFILE.promptSummary,
    )

    // Reply context builder automatically grounds prompts with cached Hub Voice Profile!
    const prepared = prepareReplyContext({
      store: storeWithSent,
      threadId: store.threads[0]!.id,
    })
    expect(prepared.context).toContain('Learned Mail Hub Voice Profile:')
    expect(prepared.context).toContain(SAMPLE_VOICE_PROFILE.promptSummary)

    // Next sync retries and succeeds.
    const retry = await syncStoreWithMailHub({
      store: storeWithSent,
      tracker,
      client: harness.client,
      batchSize: 500,
    })
    expect(retry.ingestedCount).toBeGreaterThan(0)
  })
})

describe('mailHubSync: closed-loop Outbox drafts, signals & intelligence briefing', () => {
  it('supports open -> send and discard closed-loop lifecycle', async () => {
    const harness = createFakeHubHarness()
    const fields = hubDraftToComposeFields(SAMPLE_DRAFT)
    expect(fields.sourceAppLabel).toBe('PureInvoicing')
    expect(fields.hubDraftId).toBe(SAMPLE_DRAFT.id)
    expect(fields.to).toBe('billing@acme.example')
    expect(fields.cc).toBe('finance@acme.example')

    const opened = await openHubDraft(SAMPLE_DRAFT.id, harness.client)
    expect(opened?.status).toBe('opened')

    const sent = await notifyHubDraftSent(
      {
        draftId: SAMPLE_DRAFT.id,
        sentMessageId: 'gmail_msg_99',
        sentThreadId: 'gmail_thread_99',
        sentAt: '2026-11-23T10:05:00.000Z',
      },
      harness.client,
    )
    expect(sent?.status).toBe('sent')
    expect(sent?.sentMessageId).toBe('gmail_msg_99')

    // Discard path on a second draft.
    const secondDraft: StagedMailDraft = {
      ...SAMPLE_DRAFT,
      id: 'hub_draft_discard_1',
      sourceApp: 'meet',
      status: 'pending',
    }
    harness.state.drafts.push(secondDraft)
    const discarded = await discardHubDraft(secondDraft.id, harness.client)
    expect(discarded?.status).toBe('discarded')
    expect(formatSourceAppLabel('meet')).toBe('PureMeet')
    expect(formatSourceAppLabel('executive')).toBe('PureExecutive')
  })

  it('matches pending thread signals and builds Mail Intelligence Briefing', async () => {
    const matched = signalsForThread(
      SAMPLE_SIGNALS,
      'thread_1',
      new Set(['msg_1', 'msg_2', 'msg_3']),
    )
    expect(matched.map(s => s.id)).toEqual(['sig_receipt_1', 'sig_redline_2'])

    const harness = createFakeHubHarness()
    const briefing = await buildMailIntelligenceBriefing({
      client: harness.client,
      now: NOW,
    })
    expect(briefing.hubAvailable).toBe(true)
    expect(briefing.counts.pendingOutboxDrafts).toBe(1)
    expect(briefing.counts.pendingSignals).toBe(2)
    expect(briefing.counts.dueFollowUps).toBe(1)
    expect(Object.keys(briefing.signalsByTargetApp).sort()).toEqual([
      'PureExpenses',
      'PureRedline',
    ])
    expect(briefing.voiceProfile?.sampleCount).toBe(18)
    expect(briefing.briefing?.markdown).toContain('Morning Briefing')
  })
})

describe('Mail Hub UI surfaces & live hook event subscriptions', () => {
  it('renders MailHubOutboxBanner with source pill and triggers Open / Discard callbacks', async () => {
    const onOpen = vi.fn()
    const onDiscard = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MailHubOutboxBanner, {
          drafts: [SAMPLE_DRAFT],
          onOpenInComposer: onOpen,
          onDiscard,
        }),
      )
    })

    expect(container.textContent).toContain('From PureInvoicing')
    expect(container.textContent).toContain('Invoice #1042 — Q4 Platform Renewal')
    expect(container.textContent).toContain('billing@acme.example')

    const openBtn = container.querySelector<HTMLButtonElement>(
      `[data-testid="hub-outbox-open-${SAMPLE_DRAFT.id}"]`,
    )
    const discardBtn = container.querySelector<HTMLButtonElement>(
      `[data-testid="hub-outbox-discard-${SAMPLE_DRAFT.id}"]`,
    )
    expect(openBtn).not.toBeNull()
    expect(discardBtn).not.toBeNull()

    await act(async () => {
      openBtn!.click()
    })
    expect(onOpen).toHaveBeenCalledWith(SAMPLE_DRAFT)

    await act(async () => {
      discardBtn!.click()
    })
    expect(onDiscard).toHaveBeenCalledWith(SAMPLE_DRAFT.id)

    await act(async () => {
      root.unmount()
    })
  })

  it('renders ThreadSignalChips and handles Accept and Dismiss actions', async () => {
    const onAccept = vi.fn()
    const onDismiss = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const pending = SAMPLE_SIGNALS.filter(s => s.status === 'pending')

    await act(async () => {
      root.render(
        createElement(ThreadSignalChips, {
          signals: pending,
          onAccept,
          onDismiss,
        }),
      )
    })

    expect(container.textContent).toContain('Receipt')
    expect(container.textContent).toContain('PureExpenses')
    expect(container.textContent).toContain('Contract Redline')
    expect(container.textContent).toContain('PureRedline')

    const acceptBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="thread-signal-accept-sig_receipt_1"]',
    )
    const dismissBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="thread-signal-dismiss-sig_redline_2"]',
    )

    await act(async () => {
      acceptBtn!.click()
      dismissBtn!.click()
    })
    expect(onAccept).toHaveBeenCalledWith('sig_receipt_1')
    expect(onDismiss).toHaveBeenCalledWith('sig_redline_2')

    await act(async () => {
      root.unmount()
    })
  })

  it('useMailHubIntegration reacts to live draft.staged, mail.sent, and signal.extracted events', async () => {
    const store = demoMailStoreForNow(NOW)
    const storeRef = { current: store }
    const harness = createFakeHubHarness()
    const notices: string[] = []
    let latestApi!: MailHubIntegrationApi

    function HarnessComponent() {
      latestApi = useMailHubIntegration({
        enabled: true,
        allowIngestion: false,
        store,
        storeRef,
        client: harness.client,
        onNotice: msg => notices.push(msg),
      })
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(HarnessComponent))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latestApi.hubAvailable).toBe(true)
    expect(latestApi.pendingDrafts.map(d => d.id)).toEqual([SAMPLE_DRAFT.id])
    expect(latestApi.pendingSignals.map(s => s.id)).toEqual([
      'sig_receipt_1',
      'sig_redline_2',
    ])

    // Live cross-app draft staged event from PureMeet.
    const meetDraft: StagedMailDraft = {
      ...SAMPLE_DRAFT,
      id: 'hub_draft_meet_9',
      sourceApp: 'meet',
      subject: 'Meeting recap & action items',
    }
    await act(async () => {
      harness.emit({
        type: 'draft.staged',
        timestamp: NOW.toISOString(),
        sourceApp: 'meet',
        draft: meetDraft,
      })
    })
    expect(latestApi.pendingDrafts.some(d => d.id === 'hub_draft_meet_9')).toBe(true)
    expect(notices.some(n => n.includes('PureMeet'))).toBe(true)

    // Accept a signal -> calls updateSignal(id, 'accepted') and removes from pendingSignals.
    await act(async () => {
      await latestApi.acceptSignal('sig_receipt_1')
    })
    expect(latestApi.pendingSignals.some(s => s.id === 'sig_receipt_1')).toBe(false)

    // Live mail.sent event removes draft from pending list.
    await act(async () => {
      harness.emit({
        type: 'mail.sent',
        timestamp: NOW.toISOString(),
        sourceApp: 'meet',
        draft: { ...meetDraft, status: 'sent' },
      })
    })
    expect(latestApi.pendingDrafts.some(d => d.id === 'hub_draft_meet_9')).toBe(false)

    await act(async () => {
      root.unmount()
    })
  })
})
