import { updateTriageFile, withStoredTriage } from '../lib/triagePersistence'
import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  aiTriageFeed,
  aiTriageRemaining,
  aiTriageReport,
  applyAiTriage,
  countVerdicts,
  parseSince,
  type AiTriageDecision,
} from '../lib/aiTriage'
import { AI_TRIAGE_VERDICTS, isAiTriageVerdict } from '../lib/aiTriageState'
import type { MailAiTriageVerdict } from '../types'
import {
  AgentMailToolError,
  optionalNumber,
  optionalString,
  type MailAgentToolContext,
} from './catalog'

/**
 * AI triage tools. Results are compact JSON on purpose: a tool result over
 * the shell's 4,000-character limit is parked in a file the model reads
 * back a chunk per turn, and those turns are what made triage slow.
 */
function compact(payload: unknown): AgentToolHandlerResult {
  return { content: JSON.stringify(payload) }
}

function requireAccount(context: MailAgentToolContext): string {
  if (!context.accountId) {
    throw new AgentMailToolError('No mail account is connected.')
  }
  return context.accountId
}

function nonZero(
  counts: Record<MailAiTriageVerdict, number>,
): Partial<Record<MailAiTriageVerdict, number>> {
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0))
}

export async function nextTriageBatchHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  context = {...context,store:await withStoredTriage(context.store)}
  const accountId = requireAccount(context)
  return compact(
    aiTriageFeed(context.store, accountId, {
      scope: optionalString(args, 'scope'),
      limit: optionalNumber(args, 'limit'),
      now: context.now,
    }),
  )
}

function readDecisions(args: Record<string, unknown>): AiTriageDecision[] {
  const raw = args.decisions
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AgentMailToolError(
      '"decisions" is required: one {id, at, verdict, reason, action?} per thread from nextTriageBatch.',
    )
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new AgentMailToolError(
        `decisions[${index}] must be an object {id, at, verdict, reason, action?}.`,
      )
    }
    const item = entry as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) {
      throw new AgentMailToolError(
        `decisions[${index}].id is required: the thread id from nextTriageBatch.`,
      )
    }
    return {
      id,
      ...(typeof item.at === 'string' ? { at: item.at.trim() } : {}),
      verdict: typeof item.verdict === 'string' ? item.verdict : '',
      ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
      ...(typeof item.action === 'string' ? { action: item.action } : {}),
    }
  })
}

export async function recordTriageHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  context = {...context,store:await withStoredTriage(context.store)}
  const accountId = requireAccount(context)
  const decisions = readDecisions(args)
  const now = context.now ?? new Date()
  const applied = await updateTriageFile(file => {
    const result=applyAiTriage({...(context.getStore?.() ?? context.store),aiTriage:file.records},decisions,{decidedBy:'agent',now})
    return {file:{...file,records:result.store.aiTriage ?? []},result}
  })
  context.setStore(current=>({...current,aiTriage:applied.store.aiTriage}))
  const remaining = aiTriageRemaining(
    applied.store,
    accountId,
    optionalString(args, 'scope'),
    context.now,
  )
  return compact({
    recorded: applied.recorded.length,
    ...(applied.recorded.length ? { counts: nonZero(countVerdicts(applied.recorded)) } : {}),
    ...(applied.stale.length ? { stale: applied.stale } : {}),
    ...(applied.unknown.length ? { unknown: applied.unknown } : {}),
    ...(applied.invalid.length ? { invalid: applied.invalid } : {}),
    remaining,
    note: applied.invalid.length
      ? 'Fix the invalid entries and record them again.'
      : applied.stale.length
        ? 'Stale threads got a new message; they come back in the next batch.'
        : remaining
          ? 'Call nextTriageBatch for the next batch.'
          : 'Triage is done for this scope; getTriageReport has the results.',
  })
}

export async function getTriageReportHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  context = {...context,store:await withStoredTriage(context.store)}
  const accountId = requireAccount(context)
  const since = parseSince(optionalString(args, 'since'), context.now ?? new Date())
  if (!since) {
    throw new AgentMailToolError('"since" must be an ISO date or a span like 12h, 1d or 1w.')
  }
  let include: MailAiTriageVerdict[] | undefined
  if (args.include !== undefined) {
    const list = Array.isArray(args.include) ? args.include : [args.include]
    if (!list.length || !list.every(isAiTriageVerdict)) {
      throw new AgentMailToolError(`"include" takes verdicts: ${AI_TRIAGE_VERDICTS.join(', ')}.`)
    }
    include = list as MailAiTriageVerdict[]
  }
  return compact(
    aiTriageReport(context.store, accountId, {
      since,
      include,
      offset: optionalNumber(args, 'offset'),
    }),
  )
}
