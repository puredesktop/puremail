import type {
  AgentToolHandler,
  AgentToolHandlerResult,
  AgentToolInvokeContext,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'

/**
 * Pure* Cross-App Operations Primitive: `function` vs atomic `tool` + 3-tier exposure.
 *
 * Zero app-specific imports — designed to be lifted verbatim into
 * `@purescience/platform-ui` and reused across every Pure* application.
 *
 * Exposure tiers:
 *   1. `function` (always exposed): high-level composite workflows that replace
 *      3–15 atomic LLM round-trips (optionally combining deterministic code +
 *      fast Decision Models) in one auditable call.
 *   2. `tool` with `exposure: 'always'` (~top 20% core verbs + ALL `release`
 *      and `deletesPermanently` tools): directly callable by name.
 *   3. `tool` with `exposure: 'extended'` (the remaining ~80% specialist tools):
 *      hidden from the default LLM prompt to save schema tokens & improve tool
 *      selection accuracy, yet 100% discoverable and callable on demand via the
 *      three universal escape-hatch meta-tools:
 *        - `discoverAppTools` (read, no approval)
 *        - `callExtendedReadTool` (read, no approval — read-only extended tools)
 *        - `callExtendedTool` (write, approval-gated, escalates destructive via
 *          `riskWhen.confirmDestructive`, strictly refuses release/permanent-delete)
 */

export type AppOperationClass = 'function' | 'tool'
export type AppOperationExposure = 'always' | 'extended'
export type AppOperationRisk =
  | 'read'
  | 'write'
  | 'destructive'
  | 'external'
  | 'release'

export const APP_META_TOOL_NAMES = [
  'discoverAppTools',
  'callExtendedReadTool',
  'callExtendedTool',
] as const

export type AppMetaToolName = (typeof APP_META_TOOL_NAMES)[number]

/** Matches PureDesktop `plugin.json -> app.agents.tools[]` strict schema 1:1. */
export interface AppOperationManifestEntry {
  name: string
  description: string
  inputSchema: Record<string, unknown> & { type: 'object' }
  requiresApproval: boolean
  risk: AppOperationRisk
  releaseButton?: string
  deletesPermanently?: boolean
  riskWhen?: Record<string, 'write' | 'destructive' | 'external' | 'release'>
  requiresCapabilities?: Array<'vision'>
}

export interface AppFunctionOutput {
  /** One-line human-readable summary surfaced to both the agent and (when mutated) the operations ledger. */
  summary: string
  /** Structured payload returned to the agent. */
  data: Record<string, unknown>
  /** Set true when the function modified app state so only real mutations enter the changes ledger. */
  mutated?: boolean
  /** Whether a fast Decision Model contributed to this result. */
  usedDecisionModel?: boolean
  /** Optional images returned alongside text (requires `vision`). */
  images?: AgentToolHandlerResult['images']
}

export interface AppFunctionResultEnvelope {
  ok: true
  opClass: 'function'
  function: string
  summary: string
  usedDecisionModel?: boolean
  data: Record<string, unknown>
}

export interface AppFunctionDefinition<TCtx> {
  opClass: 'function'
  name: string
  category: string
  description: string
  inputSchema: Record<string, unknown> & { type: 'object' }
  risk: Exclude<AppOperationRisk, 'release'>
  requiresApproval: boolean
  riskWhen?: Record<string, 'write' | 'destructive' | 'external' | 'release'>
  requiresCapabilities?: Array<'vision'>
  /** Atomic tools that this composite function replaces for common workflows. */
  replaces?: readonly string[]
  run: (
    ctx: TCtx,
    args: Record<string, unknown>,
    invoke: AgentToolInvokeContext,
  ) => Promise<AppFunctionOutput>
}

export interface AppAtomicToolDefinition<TCtx> {
  opClass: 'tool'
  exposure: AppOperationExposure
  name: string
  category: string
  description: string
  inputSchema: Record<string, unknown> & { type: 'object' }
  risk: AppOperationRisk
  requiresApproval: boolean
  releaseButton?: string
  deletesPermanently?: boolean
  riskWhen?: Record<string, 'write' | 'destructive' | 'external' | 'release'>
  requiresCapabilities?: Array<'vision'>
  run: (
    ctx: TCtx,
    args: Record<string, unknown>,
    invoke: AgentToolInvokeContext,
  ) => Promise<AgentToolHandlerResult>
}

export interface AppOperationsAuditSummary {
  appSlug: string
  functions: number
  coreTools: number
  extendedTools: number
  metaTools: number
  totalExposed: number
  totalAtomicTools: number
  totalRegistered: number
  schemaReductionPercent: number
}

export interface AppOperationsGuardContext<TCtx> {
  ctx: TCtx
  name: string
  opClass: AppOperationClass | 'meta'
  risk: AppOperationRisk
  viaExtended: boolean
}

export interface BuildHandlersOptions<TCtx> {
  /**
   * Optional app-wide pre-execution guard (e.g., no connected account, held
   * copy refusing sends). Runs uniformly for BOTH direct calls AND extended
   * calls routed through `callExtendedReadTool` / `callExtendedTool`.
   * Throw an Error to refuse execution cleanly.
   */
  beforeInvoke?: (guard: AppOperationsGuardContext<TCtx>) => void | Promise<void>
  /** Optional operations ledger callback for `function` and extended mutations. */
  recordOperation?: (ctx: TCtx, kind: string, summary: string) => void
  /** Custom error constructor for domain validation errors (optional). */
  createError?: (message: string) => Error
}

export interface AppOperationsRegistry<TCtx> {
  readonly appSlug: string
  readonly functions: readonly AppFunctionDefinition<TCtx>[]
  readonly coreTools: readonly AppAtomicToolDefinition<TCtx>[]
  readonly extendedTools: readonly AppAtomicToolDefinition<TCtx>[]
  readonly exposedToolNames: readonly string[]
  readonly extendedToolNames: readonly string[]
  readonly allAtomicToolNames: readonly string[]
  readonly manifestTools: readonly AppOperationManifestEntry[]
  auditSummary: () => AppOperationsAuditSummary
  buildHandlers: (
    getCtx: () => TCtx,
    options?: BuildHandlersOptions<TCtx>,
  ) => Record<string, AgentToolHandler>
}

export function defineAppFunction<TCtx>(
  spec: Omit<AppFunctionDefinition<TCtx>, 'opClass'>,
): AppFunctionDefinition<TCtx> {
  return { ...spec, opClass: 'function' }
}

export function defineAppTool<TCtx>(
  spec: Omit<AppAtomicToolDefinition<TCtx>, 'opClass'>,
): AppAtomicToolDefinition<TCtx> {
  return { ...spec, opClass: 'tool' }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toManifestEntry(
  op:
    | Pick<
        AppFunctionDefinition<unknown>,
        | 'name'
        | 'description'
        | 'inputSchema'
        | 'risk'
        | 'requiresApproval'
        | 'riskWhen'
        | 'requiresCapabilities'
      >
    | Pick<
        AppAtomicToolDefinition<unknown>,
        | 'name'
        | 'description'
        | 'inputSchema'
        | 'risk'
        | 'requiresApproval'
        | 'releaseButton'
        | 'deletesPermanently'
        | 'riskWhen'
        | 'requiresCapabilities'
      >,
): AppOperationManifestEntry {
  const entry: AppOperationManifestEntry = {
    name: op.name,
    risk: op.risk,
    description: op.description,
    inputSchema: op.inputSchema,
    requiresApproval: op.requiresApproval,
  }
  if ('releaseButton' in op && op.releaseButton) {
    entry.releaseButton = op.releaseButton
  }
  if ('deletesPermanently' in op && op.deletesPermanently) {
    entry.deletesPermanently = true
  }
  if (op.riskWhen && Object.keys(op.riskWhen).length > 0) {
    entry.riskWhen = op.riskWhen
  }
  if (op.requiresCapabilities && op.requiresCapabilities.length > 0) {
    entry.requiresCapabilities = op.requiresCapabilities
  }
  return entry
}

function splitCamel(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
}

function scoreMatch(
  words: readonly string[],
  fields: { name: string; category: string; description: string; replaces?: readonly string[] },
): number {
  if (words.length === 0) return 1
  const nameText = splitCamel(fields.name)
  const catText = fields.category.toLowerCase()
  const descText = fields.description.toLowerCase()
  const repText = (fields.replaces ?? []).map(splitCamel).join(' ')
  let score = 0
  let hits = 0
  for (const raw of words) {
    const stem = raw.replace(/(ing|ed|es|s)$/, '')
    if (!stem) continue
    if (nameText.includes(stem)) score += 6
    else if (catText.includes(stem)) score += 4
    else if (repText.includes(stem)) score += 3
    else if (descText.includes(stem)) score += 1
    else continue
    hits += 1
  }
  return hits === 0 ? 0 : hits * 10 + score
}

export function createAppOperationsRegistry<TCtx>(config: {
  appSlug: string
  appName: string
  functions: readonly AppFunctionDefinition<TCtx>[]
  tools: readonly AppAtomicToolDefinition<TCtx>[]
}): AppOperationsRegistry<TCtx> {
  const { appSlug, appName, functions, tools } = config
  const metaSet = new Set<string>(APP_META_TOOL_NAMES)
  const seen = new Set<string>()

  for (const fn of functions) {
    if (!fn.name.trim()) throw new Error('App function name must be non-empty.')
    if (metaSet.has(fn.name)) {
      throw new Error(`Function "${fn.name}" collides with reserved meta-tool name.`)
    }
    if (seen.has(fn.name)) {
      throw new Error(`Duplicate operation name "${fn.name}".`)
    }
    if ((fn.risk as string) === 'release') {
      throw new Error(
        `Function "${fn.name}" cannot have risk "release"; release actions must be direct atomic tools.`,
      )
    }
    if (fn.inputSchema?.type !== 'object') {
      throw new Error(`Function "${fn.name}" must declare an object inputSchema.`)
    }
    if (typeof fn.requiresApproval !== 'boolean') {
      throw new Error(`Function "${fn.name}" must explicitly state requiresApproval.`)
    }
    seen.add(fn.name)
  }

  const coreTools: AppAtomicToolDefinition<TCtx>[] = []
  const extendedTools: AppAtomicToolDefinition<TCtx>[] = []
  const extendedByName = new Map<string, AppAtomicToolDefinition<TCtx>>()
  const allByName = new Map<
    string,
    AppFunctionDefinition<TCtx> | AppAtomicToolDefinition<TCtx>
  >()

  for (const fn of functions) allByName.set(fn.name, fn)

  for (const tool of tools) {
    if (!tool.name.trim()) throw new Error('App tool name must be non-empty.')
    if (metaSet.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" collides with reserved meta-tool name.`)
    }
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate operation name "${tool.name}".`)
    }
    if (tool.inputSchema?.type !== 'object') {
      throw new Error(`Tool "${tool.name}" must declare an object inputSchema.`)
    }
    if (typeof tool.requiresApproval !== 'boolean') {
      throw new Error(`Tool "${tool.name}" must explicitly state requiresApproval.`)
    }
    if (tool.exposure === 'extended' && tool.risk === 'release') {
      throw new Error(
        `Release tool "${tool.name}" MUST have exposure "always" so it never bypasses the shell release gate.`,
      )
    }
    if (tool.exposure === 'extended' && tool.risk === 'external') {
      throw new Error(
        `External tool "${tool.name}" MUST have exposure "always" so it never bypasses alwaysAsks outward approval.`,
      )
    }
    if (tool.exposure === 'extended' && tool.deletesPermanently) {
      throw new Error(
        `Permanent-delete tool "${tool.name}" MUST have exposure "always" so it never bypasses alwaysAsks.`,
      )
    }
    if (
      tool.exposure === 'extended' &&
      tool.riskWhen &&
      Object.values(tool.riskWhen).some(
        r => r === 'release' || r === 'external' || r === 'destructive',
      )
    ) {
      throw new Error(
        `Tool "${tool.name}" declares elevated riskWhen and MUST have exposure "always" so shell argument-risk gates cannot be bypassed.`,
      )
    }
    seen.add(tool.name)
    allByName.set(tool.name, tool)
    if (tool.exposure === 'always') {
      coreTools.push(tool)
    } else {
      extendedTools.push(tool)
      extendedByName.set(tool.name, tool)
    }
  }

  const extendedCategories = [
    ...new Set(extendedTools.map(tool => tool.category)),
  ].sort()
  const sampleCategories = extendedCategories.slice(0, 5)
  const sampleCategoryText = sampleCategories.length
    ? sampleCategories.map(c => `"${c}"`).join(', ')
    : '"all"'
  const directReleaseNames = coreTools
    .filter(t => t.risk === 'release')
    .map(t => t.name)
  const releaseHint = directReleaseNames.length
    ? ` (call ${directReleaseNames.join(' / ')} directly)`
    : ''

  const metaManifestEntries: AppOperationManifestEntry[] = [
    {
      name: 'discoverAppTools',
      risk: 'read',
      requiresApproval: false,
      description: `Discover ${appName}'s extended specialist tools (${extendedTools.length} tools across ${extendedCategories.join(', ')}) and composite functions (${functions.length} workflows). Prefer calling exposed composite functions and core tools first; use discoverAppTools when an edge case needs a specialist tool, then call it via callExtendedReadTool (for read-only tools) or callExtendedTool (for mutating tools).`,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: `Optional keywords describing the capability you need (e.g. ${sampleCategoryText}).`,
          },
          category: {
            type: 'string',
            description: `Optional category filter (${extendedCategories.join(', ')}, or "all").`,
          },
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional exact tool names to fetch full JSON input schemas for.',
          },
          includeFunctions: {
            type: 'boolean',
            description: 'Include already-exposed composite functions and core tools in the listing (default false: searches extended tools first).',
          },
        },
      },
    },
    {
      name: 'callExtendedReadTool',
      risk: 'read',
      requiresApproval: false,
      description: `Call one of ${appName}'s read-only extended specialist tools discovered via discoverAppTools (categories: ${extendedCategories.join(', ')}). Strictly refuses mutating, destructive, external, or release tools.`,
      inputSchema: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: 'Exact name of a read-only extended tool from discoverAppTools.',
          },
          arguments: {
            type: 'object',
            description: 'Arguments object matching the tool’s inputSchema.',
          },
        },
        required: ['tool'],
      },
    },
    {
      name: 'callExtendedTool',
      risk: 'write',
      requiresApproval: true,
      riskWhen: { confirmDestructive: 'destructive' },
      description: `Call one of ${appName}'s mutating extended specialist tools discovered via discoverAppTools (categories: ${extendedCategories.join(', ')}). For destructive tools, set confirmDestructive: true after checking with the user. Strictly refuses read-only tools (use callExtendedReadTool), external tools, permanent-delete tools, and release tools${releaseHint}.`,
      inputSchema: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: 'Exact name of a mutating extended tool from discoverAppTools.',
          },
          arguments: {
            type: 'object',
            description: 'Arguments object matching the tool’s inputSchema.',
          },
          confirmDestructive: {
            type: 'boolean',
            description: 'Required (true) when calling an extended tool marked risk: "destructive".',
          },
        },
        required: ['tool'],
      },
    },
  ]

  const manifestTools: AppOperationManifestEntry[] = [
    ...functions.map(toManifestEntry),
    ...coreTools.map(toManifestEntry),
    ...metaManifestEntries,
  ]

  const exposedToolNames = manifestTools.map(t => t.name)
  const extendedToolNames = extendedTools.map(t => t.name)
  const allAtomicToolNames = tools.map(t => t.name)

  function auditSummary(): AppOperationsAuditSummary {
    const totalExposed = manifestTools.length
    const totalAtomicTools = tools.length
    const totalRegistered = functions.length + tools.length
    const reduction =
      totalAtomicTools > 0
        ? Math.round(((totalAtomicTools - totalExposed) / totalAtomicTools) * 100)
        : 0
    return {
      appSlug,
      functions: functions.length,
      coreTools: coreTools.length,
      extendedTools: extendedTools.length,
      metaTools: metaManifestEntries.length,
      totalExposed,
      totalAtomicTools,
      totalRegistered,
      schemaReductionPercent: reduction,
    }
  }

  function buildHandlers(
    getCtx: () => TCtx,
    options: BuildHandlersOptions<TCtx> = {},
  ): Record<string, AgentToolHandler> {
    const makeErr = (msg: string) =>
      options.createError ? options.createError(msg) : new Error(msg)

    const handlers: Record<string, AgentToolHandler> = {}

    // 1. Register composite App Functions
    for (const fn of functions) {
      handlers[fn.name] = async invoke => {
        const ctx = getCtx()
        await options.beforeInvoke?.({
          ctx,
          name: fn.name,
          opClass: 'function',
          risk: fn.risk,
          viaExtended: false,
        })
        const args = isPlainObject(invoke.arguments) ? invoke.arguments : {}
        const output = await fn.run(ctx, args, invoke)
        const didMutate = output.mutated ?? fn.risk !== 'read'
        if (didMutate) {
          options.recordOperation?.(ctx, `function.${fn.name}`, output.summary)
        }
        const envelope: AppFunctionResultEnvelope = {
          ok: true,
          opClass: 'function',
          function: fn.name,
          summary: output.summary,
          ...(output.usedDecisionModel !== undefined
            ? { usedDecisionModel: output.usedDecisionModel }
            : {}),
          data: output.data,
        }
        return {
          content: JSON.stringify(envelope),
          ...(output.images?.length ? { images: output.images } : {}),
        }
      }
    }

    // 2. Register Core / Release Atomic Tools (exposure: 'always')
    for (const tool of coreTools) {
      handlers[tool.name] = async invoke => {
        const ctx = getCtx()
        await options.beforeInvoke?.({
          ctx,
          name: tool.name,
          opClass: 'tool',
          risk: tool.risk,
          viaExtended: false,
        })
        const args = isPlainObject(invoke.arguments) ? invoke.arguments : {}
        return tool.run(ctx, args, invoke)
      }
    }

    // 3. Universal Escape-Hatch Meta-Tools
    handlers.discoverAppTools = async invoke => {
      const ctx = getCtx()
      await options.beforeInvoke?.({
        ctx,
        name: 'discoverAppTools',
        opClass: 'meta',
        risk: 'read',
        viaExtended: false,
      })
      const args = isPlainObject(invoke.arguments) ? invoke.arguments : {}
      const query =
        typeof args.query === 'string' ? args.query.trim() : ''
      const category =
        typeof args.category === 'string'
          ? args.category.trim().toLowerCase()
          : ''
      const names = Array.isArray(args.names)
        ? args.names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map(n => n.trim())
        : []
      const includeFunctions = args.includeFunctions === true

      if (names.length > 0) {
        const details = names.map(name => {
          const op = allByName.get(name)
          if (!op) {
            return { name, found: false, error: `Unknown ${appName} operation "${name}".` }
          }
          const isExtended = op.opClass === 'tool' && op.exposure === 'extended'
          return {
            name: op.name,
            found: true,
            opClass: op.opClass,
            category: op.category,
            exposure: op.opClass === 'function' ? 'always' : op.exposure,
            risk: op.risk,
            requiresApproval: op.requiresApproval,
            invokeVia: !isExtended
              ? 'direct'
              : op.risk === 'read'
                ? 'callExtendedReadTool'
                : 'callExtendedTool',
            ...(isExtended && op.risk === 'destructive'
              ? { requiresConfirmDestructive: true }
              : {}),
            description: op.description,
            inputSchema: op.inputSchema,
          }
        })
        return {
          content: JSON.stringify({
            appSlug,
            mode: 'describe',
            operations: details,
          }),
        }
      }

      const pool: Array<AppFunctionDefinition<TCtx> | AppAtomicToolDefinition<TCtx>> =
        includeFunctions
          ? [...functions, ...coreTools, ...extendedTools]
          : [...extendedTools]

      const filtered =
        category && category !== 'all'
          ? pool.filter(op => op.category.toLowerCase() === category)
          : pool

      const words = query
        ? [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 8)
        : []

      const scored = filtered
        .map(op => ({
          op,
          score: scoreMatch(words, {
            name: op.name,
            category: op.category,
            description: op.description,
            replaces: op.opClass === 'function' ? op.replaces : undefined,
          }),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.op.name.localeCompare(b.op.name))

      const includeSchemas = scored.length <= 10 || words.length > 0
      const operations = scored.slice(0, 25).map(({ op }) => {
        const isExtended = op.opClass === 'tool' && op.exposure === 'extended'
        return {
          name: op.name,
          opClass: op.opClass,
          category: op.category,
          exposure: op.opClass === 'function' ? 'always' : op.exposure,
          risk: op.risk,
          requiresApproval: op.requiresApproval,
          invokeVia: !isExtended
            ? 'direct'
            : op.risk === 'read'
              ? 'callExtendedReadTool'
              : 'callExtendedTool',
          ...(isExtended && op.risk === 'destructive'
            ? { requiresConfirmDestructive: true }
            : {}),
          description: op.description,
          ...(includeSchemas ? { inputSchema: op.inputSchema } : {}),
        }
      })

      return {
        content: JSON.stringify({
          appSlug,
          categories: extendedCategories,
          totalMatched: scored.length,
          showing: operations.length,
          hint:
            'Call read-only extended tools with callExtendedReadTool({ tool, arguments }); call mutating extended tools with callExtendedTool({ tool, arguments, confirmDestructive? }). Pass names: [...] to discoverAppTools to inspect any schema.',
          operations,
        }),
      }
    }

    handlers.callExtendedReadTool = async invoke => {
      const args = isPlainObject(invoke.arguments) ? invoke.arguments : {}
      const toolName = typeof args.tool === 'string' ? args.tool.trim() : ''
      if (!toolName) {
        throw makeErr('"tool" is required. Use discoverAppTools to find extended tool names.')
      }
      const directOp = allByName.get(toolName)
      const extended = extendedByName.get(toolName)
      if (!extended) {
        if (directOp) {
          throw makeErr(
            `"${toolName}" is already directly exposed in your active tools — call "${toolName}" directly instead of callExtendedReadTool.`,
          )
        }
        throw makeErr(
          `Unknown extended tool "${toolName}". Use discoverAppTools to list available tools.`,
        )
      }
      if (extended.risk !== 'read') {
        throw makeErr(
          `Refused: "${toolName}" has risk "${extended.risk}" and cannot run through callExtendedReadTool. Call it via callExtendedTool instead.`,
        )
      }
      if (args.arguments !== undefined && !isPlainObject(args.arguments)) {
        throw makeErr('"arguments" must be a JSON object.')
      }
      const ctx = getCtx()
      await options.beforeInvoke?.({
        ctx,
        name: extended.name,
        opClass: 'tool',
        risk: extended.risk,
        viaExtended: true,
      })
      const toolArgs = isPlainObject(args.arguments) ? args.arguments : {}
      return extended.run(ctx, toolArgs, {
        ...invoke,
        shortName: extended.name,
        arguments: toolArgs,
      })
    }

    handlers.callExtendedTool = async invoke => {
      const args = isPlainObject(invoke.arguments) ? invoke.arguments : {}
      const toolName = typeof args.tool === 'string' ? args.tool.trim() : ''
      if (!toolName) {
        throw makeErr('"tool" is required. Use discoverAppTools to find extended tool names.')
      }
      const directOp = allByName.get(toolName)
      const extended = extendedByName.get(toolName)
      if (!extended) {
        if (directOp) {
          throw makeErr(
            `"${toolName}" is already directly exposed in your active tools — call "${toolName}" directly instead of callExtendedTool.`,
          )
        }
        throw makeErr(
          `Unknown extended tool "${toolName}". Use discoverAppTools to list available tools.`,
        )
      }
      if (
        extended.risk === 'release' ||
        extended.risk === 'external' ||
        extended.deletesPermanently
      ) {
        throw makeErr(
          `Refused: "${toolName}" cannot be invoked through callExtendedTool; call it directly.`,
        )
      }
      if (extended.risk === 'read') {
        throw makeErr(
          `"${toolName}" is read-only. Call it via callExtendedReadTool instead of callExtendedTool.`,
        )
      }
      if (extended.risk === 'destructive' && args.confirmDestructive !== true) {
        throw makeErr(
          `"${toolName}" is destructive. Re-call callExtendedTool with confirmDestructive: true after confirming with the user.`,
        )
      }
      if (args.arguments !== undefined && !isPlainObject(args.arguments)) {
        throw makeErr('"arguments" must be a JSON object.')
      }
      const ctx = getCtx()
      await options.beforeInvoke?.({
        ctx,
        name: extended.name,
        opClass: 'tool',
        risk: extended.risk,
        viaExtended: true,
      })
      const toolArgs = isPlainObject(args.arguments) ? args.arguments : {}
      const result = await extended.run(ctx, toolArgs, {
        ...invoke,
        shortName: extended.name,
        arguments: toolArgs,
      })
      if (!result.isError) {
        options.recordOperation?.(
          ctx,
          `extended.${extended.name}`,
          `Executed extended tool ${extended.name}`,
        )
      }
      return result
    }

    return handlers
  }

  return {
    appSlug,
    functions,
    coreTools,
    extendedTools,
    exposedToolNames,
    extendedToolNames,
    allAtomicToolNames,
    manifestTools,
    auditSummary,
    buildHandlers,
  }
}
