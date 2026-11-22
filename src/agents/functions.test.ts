import { describe, expect, it, vi } from 'vitest'
import { demoMailStoreForNow } from '../test/mailFixtures'
import {
  buildGuardedPureMailHandlers,
  NO_ACCOUNT_MESSAGE,
} from '../hooks/usePureMailAgentTools'
import {
  PUREMAIL_AGENT_TOOL_NAMES,
  PUREMAIL_CORE_TOOL_NAMES,
  PUREMAIL_EXTENDED_TOOL_NAMES,
  PUREMAIL_FUNCTION_NAMES,
  type MailAgentToolContext,
} from './catalog'
import { PUREMAIL_OPERATIONS_REGISTRY } from './operationsRegistry'

const NOW = new Date('2026-11-22T12:00:00.000Z')

function makeCtx(): { ctx: MailAgentToolContext; ops: Array<{ kind: string; summary: string }> } {
  let store = demoMailStoreForNow(NOW)
  const ops: Array<{ kind: string; summary: string }> = []
  const ctx: MailAgentToolContext = {
    store,
    getStore: () => store,
    accountId: store.accounts[0]?.id,
    now: NOW,
    currentQuery: 'in:inbox',
    selectedThread: store.threads[0] ?? null,
    showQuery: vi.fn(),
    setStore: updater => {
      store = updater(store)
      ctx.store = store
    },
    applyAction: vi.fn(),
    listMailOperations: vi.fn(async () => []),
    addTaskForThread: vi.fn(),
    requestDraftForThread: vi.fn(async threadId => ({
      status: 'prepared' as const,
      requestId: `req_${threadId}`,
      threadId,
      accountId: store.accounts[0]?.id ?? 'acc_1',
      instructions: 'Reply concisely.',
      context: 'Recent thread context.',
    })),
    commitReplyDraft: vi.fn((requestId, body) => ({
      draftId: `draft_${requestId}`,
      body,
      staged: true,
    })),
    noteAgentSearch: vi.fn(),
    recordOperation: (kind, summary) => ops.push({ kind, summary }),
  }
  return { ctx, ops }
}

const invoke = (shortName: string, args: Record<string, unknown> = {}) => ({
  toolCallId: `tc_${shortName}`,
  shortName,
  arguments: args,
})

describe('PureMail Operations Registry (Functions + 20% Core + Extended Escape Hatch)', () => {
  it('syncs plugin.json 1:1 with PUREMAIL_OPERATIONS_REGISTRY.manifestTools and cuts exposed tools by >60%', async () => {
    const manifest = (await import('../../plugin.json', { with: { type: 'json' } })).default as {
      app: { agents: { tools: unknown[] } }
    }
    expect(manifest.app.agents.tools).toEqual([...PUREMAIL_OPERATIONS_REGISTRY.manifestTools])
    expect([...PUREMAIL_AGENT_TOOL_NAMES]).toEqual([...PUREMAIL_OPERATIONS_REGISTRY.exposedToolNames])
    expect([...PUREMAIL_EXTENDED_TOOL_NAMES].sort()).toEqual(
      [...PUREMAIL_OPERATIONS_REGISTRY.extendedToolNames].sort(),
    )

    const summary = PUREMAIL_OPERATIONS_REGISTRY.auditSummary()
    expect(summary.functions).toBe(PUREMAIL_FUNCTION_NAMES.length)
    expect(summary.coreTools).toBe(PUREMAIL_CORE_TOOL_NAMES.length)
    expect(summary.extendedTools).toBe(PUREMAIL_EXTENDED_TOOL_NAMES.length)
    expect(summary.totalExposed).toBe(25)
    expect(summary.totalAtomicTools).toBe(66)
    expect(summary.schemaReductionPercent).toBeGreaterThanOrEqual(60)
  })

  it('runs fn_inboxBriefing, fn_triageInbox, fn_followUpSweep, fn_senderDossier, fn_auditThreadSecurity, fn_screenerReview, fn_prepareReply, fn_cleanupPromotions, and fn_exportThreadBundle', async () => {
    const { ctx, ops } = makeCtx()
    const handlers = PUREMAIL_OPERATIONS_REGISTRY.buildHandlers(() => ctx, {
      recordOperation: (c, kind, summary) => c.recordOperation?.(kind, summary),
    })

    // 1. fn_inboxBriefing
    const briefing = JSON.parse(
      (await handlers.fn_inboxBriefing(invoke('fn_inboxBriefing', { limit: 5 }))).content,
    )
    expect(briefing.ok).toBe(true)
    expect(briefing.opClass).toBe('function')
    expect(briefing.data.counts.inbox).toBeGreaterThan(0)
    expect(briefing.data.topThreads.length).toBeGreaterThan(0)

    // 2. fn_triageInbox (preview + apply)
    const triage = JSON.parse(
      (await handlers.fn_triageInbox(invoke('fn_triageInbox', { limit: 5, apply: true }))).content,
    )
    expect(triage.ok).toBe(true)
    expect(triage.data.applied).toBe(true)
    expect(triage.data.items.length).toBeGreaterThan(0)

    // 3. fn_followUpSweep
    const followUp = JSON.parse(
      (await handlers.fn_followUpSweep(invoke('fn_followUpSweep'))).content,
    )
    expect(followUp.ok).toBe(true)
    expect(Array.isArray(followUp.data.awaitingThreads)).toBe(true)

    // 4. fn_senderDossier
    const firstSender = ctx.store.messages[0]!.from.email
    const dossier = JSON.parse(
      (await handlers.fn_senderDossier(invoke('fn_senderDossier', { email: firstSender }))).content,
    )
    expect(dossier.ok).toBe(true)
    expect(dossier.data.profile.email).toBe(firstSender.toLowerCase())
    expect(dossier.data.recentThreads.length).toBeGreaterThan(0)

    // 5. fn_auditThreadSecurity
    const firstThreadId = ctx.store.threads[0]!.id
    const audit = JSON.parse(
      (await handlers.fn_auditThreadSecurity(invoke('fn_auditThreadSecurity', { threadId: firstThreadId }))).content,
    )
    expect(audit.ok).toBe(true)
    expect(['clear', 'warn', 'danger']).toContain(audit.data.riskLevel)

    // 6. fn_screenerReview
    const screener = JSON.parse(
      (await handlers.fn_screenerReview(invoke('fn_screenerReview'))).content,
    )
    expect(screener.ok).toBe(true)
    expect(Array.isArray(screener.data.senders)).toBe(true)

    // 7. fn_prepareReply
    const reply = JSON.parse(
      (await handlers.fn_prepareReply(invoke('fn_prepareReply', { threadId: firstThreadId, body: 'Looks good, approved!' }))).content,
    )
    expect(reply.ok).toBe(true)
    expect(reply.data.staged).toBe(true)
    expect(reply.data.note).toMatch(/Nothing was sent/i)

    // 8. fn_cleanupPromotions (apply: false preview default)
    const cleanup = JSON.parse(
      (await handlers.fn_cleanupPromotions(invoke('fn_cleanupPromotions'))).content,
    )
    expect(cleanup.ok).toBe(true)
    expect(cleanup.data.applied).toBe(false)

    // 9. fn_exportThreadBundle (markdown transcript)
    const bundle = JSON.parse(
      (await handlers.fn_exportThreadBundle(invoke('fn_exportThreadBundle', { threadId: firstThreadId }))).content,
    )
    expect(bundle.ok).toBe(true)
    expect(bundle.data.markdown).toContain(ctx.store.threads[0]!.subject)

    // Only mutating function calls (fn_triageInbox apply:true, fn_prepareReply with body) log to mutations ledger
    expect(ops.map(o => o.kind)).toEqual(['function.fn_triageInbox', 'function.fn_prepareReply'])
  })

  it('reaches extended specialist tools on demand and enforces heldCopy + noAccount guards through callExtendedTool', async () => {
    const { ctx } = makeCtx()
    let hasAccount = true
    let heldCopy = false
    const handlers = buildGuardedPureMailHandlers(() => ctx, {
      hasAccount: () => hasAccount,
      heldCopy: () => heldCopy,
    })

    const discovered = JSON.parse(
      (await handlers.discoverAppTools(invoke('discoverAppTools', { category: 'filters' }))).content,
    )
    expect(discovered.operations.map((o: { name: string }) => o.name)).toContain('listFilters')

    const filtersRes = JSON.parse(
      (await handlers.callExtendedReadTool(invoke('callExtendedReadTool', { tool: 'listFilters', arguments: {} }))).content,
    )
    expect(Array.isArray(filtersRes.filters)).toBe(true)

    const boxRes = JSON.parse(
      (await handlers.callExtendedTool(invoke('callExtendedTool', { tool: 'createBox', arguments: { name: 'Tax 2026' } }))).content,
    )
    expect(boxRes.box).toBe('Tax 2026')

    // Held-copy guard blocks extended sending tools like createRun / renderRun / resumeRun!
    heldCopy = true
    await expect(
      handlers.callExtendedTool(invoke('callExtendedTool', { tool: 'createRun', arguments: { name: 'Outreach' } })),
    ).rejects.toThrow(/held in a page/i)

    // No-account guard blocks functions and extended tools while still letting discoverAppTools answer!
    heldCopy = false
    hasAccount = false
    await expect(
      handlers.fn_inboxBriefing(invoke('fn_inboxBriefing')),
    ).rejects.toThrow(NO_ACCOUNT_MESSAGE)
    await expect(
      handlers.callExtendedReadTool(invoke('callExtendedReadTool', { tool: 'listFilters', arguments: {} })),
    ).rejects.toThrow(NO_ACCOUNT_MESSAGE)
    const discoverStillWorks = JSON.parse(
      (await handlers.discoverAppTools(invoke('discoverAppTools', { category: 'filters' }))).content,
    )
    expect(discoverStillWorks.operations.length).toBeGreaterThan(0)
  })
})
