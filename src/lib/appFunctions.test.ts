import { describe, expect, it, vi } from 'vitest'
import {
  APP_META_TOOL_NAMES,
  createAppOperationsRegistry,
  defineAppFunction,
  defineAppTool,
} from './appFunctions'

interface TestCtx {
  accountConnected: boolean
  heldCopy: boolean
  opsLog: Array<{ kind: string; summary: string }>
}

function buildTestRegistry() {
  const fnRun = vi.fn(async (_ctx: TestCtx, args: Record<string, unknown>) => ({
    summary: `Briefed ${String(args.scope ?? 'all')}`,
    usedDecisionModel: true,
    data: { scope: args.scope ?? 'all', items: 3 },
  }))
  const coreReadRun = vi.fn(async () => ({ content: JSON.stringify({ core: true }) }))
  const releaseRun = vi.fn(async () => ({ content: JSON.stringify({ released: true }) }))
  const extReadRun = vi.fn(async (_ctx: TestCtx, args: Record<string, unknown>) => ({
    content: JSON.stringify({ filters: ['f1'], query: args.q ?? null }),
  }))
  const extWriteRun = vi.fn(async (_ctx: TestCtx, args: Record<string, unknown>) => ({
    content: JSON.stringify({ created: args.name ?? 'rule' }),
  }))
  const extDestructiveRun = vi.fn(async () => ({
    content: JSON.stringify({ deleted: true }),
  }))

  const registry = createAppOperationsRegistry<TestCtx>({
    appSlug: 'demo',
    appName: 'PureDemo',
    functions: [
      defineAppFunction<TestCtx>({
        name: 'fn_quickBriefing',
        category: 'briefing',
        risk: 'read',
        requiresApproval: false,
        replaces: ['listFilters'],
        description: 'Summarize workspace status in one call.',
        inputSchema: { type: 'object', properties: { scope: { type: 'string' } } },
        run: fnRun,
      }),
    ],
    tools: [
      defineAppTool<TestCtx>({
        name: 'getContext',
        exposure: 'always',
        category: 'core',
        risk: 'read',
        requiresApproval: false,
        description: 'Read current app context.',
        inputSchema: { type: 'object', properties: {} },
        run: coreReadRun,
      }),
      defineAppTool<TestCtx>({
        name: 'publishItem',
        exposure: 'always',
        category: 'release',
        risk: 'release',
        releaseButton: 'Publish',
        requiresApproval: true,
        description: 'Release action gated by person approval.',
        inputSchema: { type: 'object', properties: {} },
        run: releaseRun,
      }),
      defineAppTool<TestCtx>({
        name: 'listFilters',
        exposure: 'extended',
        category: 'filters',
        risk: 'read',
        requiresApproval: false,
        description: 'List configured filter rules.',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        run: extReadRun,
      }),
      defineAppTool<TestCtx>({
        name: 'createFilter',
        exposure: 'extended',
        category: 'filters',
        risk: 'write',
        requiresApproval: true,
        description: 'Create a filter rule.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        run: extWriteRun,
      }),
      defineAppTool<TestCtx>({
        name: 'deleteFilter',
        exposure: 'extended',
        category: 'filters',
        risk: 'destructive',
        requiresApproval: true,
        description: 'Delete a filter rule.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        run: extDestructiveRun,
      }),
    ],
  })

  return { registry, fnRun, coreReadRun, releaseRun, extReadRun, extWriteRun, extDestructiveRun }
}

const invokeMeta = (shortName: string, args: Record<string, unknown> = {}) => ({
  toolCallId: `tc_${shortName}`,
  shortName,
  arguments: args,
})

describe('appFunctions primitive', () => {
  it('enforces compile/init security invariants (forbids hiding release or deletesPermanently tools in extended)', () => {
    expect(() =>
      createAppOperationsRegistry({
        appSlug: 'x',
        appName: 'X',
        functions: [],
        tools: [
          defineAppTool({
            name: 'sendIt',
            exposure: 'extended',
            category: 'send',
            risk: 'release',
            requiresApproval: true,
            description: 'Release tool',
            inputSchema: { type: 'object', properties: {} },
            run: async () => ({ content: '{}' }),
          }),
        ],
      }),
    ).toThrow(/MUST have exposure "always"/i)

    expect(() =>
      createAppOperationsRegistry({
        appSlug: 'x',
        appName: 'X',
        functions: [],
        tools: [
          defineAppTool({
            name: 'wipeForever',
            exposure: 'extended',
            category: 'admin',
            risk: 'destructive',
            deletesPermanently: true,
            requiresApproval: true,
            description: 'Permanent delete',
            inputSchema: { type: 'object', properties: {} },
            run: async () => ({ content: '{}' }),
          }),
        ],
      }),
    ).toThrow(/MUST have exposure "always"/i)

    expect(() =>
      createAppOperationsRegistry({
        appSlug: 'x',
        appName: 'X',
        functions: [],
        tools: [
          defineAppTool({
            name: 'sendWebhook',
            exposure: 'extended',
            category: 'integrations',
            risk: 'external',
            requiresApproval: true,
            description: 'Outward call',
            inputSchema: { type: 'object', properties: {} },
            run: async () => ({ content: '{}' }),
          }),
        ],
      }),
    ).toThrow(/MUST have exposure "always"/i)

    expect(() =>
      createAppOperationsRegistry({
        appSlug: 'x',
        appName: 'X',
        functions: [],
        tools: [
          defineAppTool({
            name: 'riskyEdit',
            exposure: 'extended',
            category: 'edits',
            risk: 'write',
            riskWhen: { allowShrink: 'destructive' },
            requiresApproval: false,
            description: 'Has elevated riskWhen',
            inputSchema: { type: 'object', properties: {} },
            run: async () => ({ content: '{}' }),
          }),
        ],
      }),
    ).toThrow(/MUST have exposure "always"/i)
  })

  it('exposes only functions + always tools + 3 meta-tools, and wraps function results in a standard envelope', async () => {
    const { registry } = buildTestRegistry()
    expect(registry.exposedToolNames).toEqual([
      'fn_quickBriefing',
      'getContext',
      'publishItem',
      ...APP_META_TOOL_NAMES,
    ])
    expect(registry.extendedToolNames).toEqual(['listFilters', 'createFilter', 'deleteFilter'])

    const ctx: TestCtx = { accountConnected: true, heldCopy: false, opsLog: [] }
    const handlers = registry.buildHandlers(() => ctx, {
      recordOperation: (c, kind, summary) => c.opsLog.push({ kind, summary }),
    })

    const res = await handlers.fn_quickBriefing(invokeMeta('fn_quickBriefing', { scope: 'inbox' }))
    const parsed = JSON.parse(res.content)
    expect(parsed).toEqual({
      ok: true,
      opClass: 'function',
      function: 'fn_quickBriefing',
      summary: 'Briefed inbox',
      usedDecisionModel: true,
      data: { scope: 'inbox', items: 3 },
    })
    // Read-only functions must NOT pollute the mutations ledger.
    expect(ctx.opsLog).toEqual([])
  })

  it('discovers extended tools with exact invokeVia guidance and full schemas', async () => {
    const { registry } = buildTestRegistry()
    const ctx: TestCtx = { accountConnected: true, heldCopy: false, opsLog: [] }
    const handlers = registry.buildHandlers(() => ctx)

    const res = await handlers.discoverAppTools(invokeMeta('discoverAppTools', { query: 'filter' }))
    const body = JSON.parse(res.content)
    expect(body.totalMatched).toBe(3)
    const byName = Object.fromEntries(body.operations.map((o: { name: string }) => [o.name, o]))
    expect(byName.listFilters.invokeVia).toBe('callExtendedReadTool')
    expect(byName.createFilter.invokeVia).toBe('callExtendedTool')
    expect(byName.deleteFilter.requiresConfirmDestructive).toBe(true)
    expect(byName.listFilters.inputSchema.type).toBe('object')
  })

  it('routes read-only extended tools through callExtendedReadTool and refuses mutating tools', async () => {
    const { registry, extReadRun, extWriteRun } = buildTestRegistry()
    const ctx: TestCtx = { accountConnected: true, heldCopy: false, opsLog: [] }
    const handlers = registry.buildHandlers(() => ctx)

    const ok = await handlers.callExtendedReadTool(
      invokeMeta('callExtendedReadTool', { tool: 'listFilters', arguments: { q: 'acme' } }),
    )
    expect(JSON.parse(ok.content)).toEqual({ filters: ['f1'], query: 'acme' })
    expect(extReadRun).toHaveBeenCalledTimes(1)

    await expect(
      handlers.callExtendedReadTool(
        invokeMeta('callExtendedReadTool', { tool: 'createFilter', arguments: { name: 'bad' } }),
      ),
    ).rejects.toThrow(/cannot run through callExtendedReadTool/i)
    expect(extWriteRun).not.toHaveBeenCalled()
  })

  it('gates destructive extended tools behind confirmDestructive: true and enforces beforeInvoke guards on extended calls', async () => {
    const { registry, extDestructiveRun, extWriteRun } = buildTestRegistry()
    const ctx: TestCtx = { accountConnected: true, heldCopy: false, opsLog: [] }
    const handlers = registry.buildHandlers(() => ctx, {
      beforeInvoke: ({ name, ctx: c }) => {
        if (!c.accountConnected && name !== 'getContext') throw new Error('NO_ACCOUNT')
      },
    })

    // Destructive without confirmDestructive -> refused
    await expect(
      handlers.callExtendedTool(invokeMeta('callExtendedTool', { tool: 'deleteFilter', arguments: { id: 'f1' } })),
    ).rejects.toThrow(/confirmDestructive: true/i)
    expect(extDestructiveRun).not.toHaveBeenCalled()

    // Destructive with confirmDestructive: true -> allowed
    const del = await handlers.callExtendedTool(
      invokeMeta('callExtendedTool', {
        tool: 'deleteFilter',
        arguments: { id: 'f1' },
        confirmDestructive: true,
      }),
    )
    expect(JSON.parse(del.content)).toEqual({ deleted: true })

    // Guard blocks extended calls when account is disconnected
    ctx.accountConnected = false
    await expect(
      handlers.callExtendedTool(invokeMeta('callExtendedTool', { tool: 'createFilter', arguments: { name: 'x' } })),
    ).rejects.toThrow('NO_ACCOUNT')
    expect(extWriteRun).not.toHaveBeenCalled()
  })
})
