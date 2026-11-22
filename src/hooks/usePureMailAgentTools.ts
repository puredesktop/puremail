import { useMemo, useRef, type RefObject } from 'react'
import { isHeldCopy } from '../lib/heldCopy'
import {
  usePlatformAgentTools,
  type AgentToolHandler,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  AgentMailToolError,
  PUREMAIL_AGENT_LOG_LABEL,
  PUREMAIL_AGENT_TOOL_NAMES,
  type MailAgentToolContext,
} from '../agents/catalog'
import { PUREMAIL_OPERATIONS_REGISTRY } from '../agents/operationsRegistry'

/**
 * Registers PureMail's exposed operations (9 composite `fn_*` functions, 13
 * core/release atomic tools, and 3 escape-hatch meta-tools for the 53 extended
 * specialist tools) with the shell.
 */

/** What every tool but getMailContext / discoverAppTools says while PureMail has no mail account on this desktop. */
export const NO_ACCOUNT_MESSAGE =
  'PureMail has no mail account on this desktop, so it cannot read, draft or send mail here yet. A person connects one in Mail settings → Providers; until then nothing can be done in PureMail. Say so in your answer rather than trying again.'

const NO_ACCOUNT_ALLOWED = new Set(['getMailContext', 'discoverAppTools'])

/**
 * The handlers as they answer: as they are with an account; without one, at once and plainly (only getMailContext
 * and discoverAppTools run).
 */
export function answeringWithoutAccount<T extends Record<string, (...args: never[]) => unknown>>(hasAccount: boolean, handlers: T): T {
  if (hasAccount) return handlers
  const refuse = async () => {
    throw new AgentMailToolError(NO_ACCOUNT_MESSAGE)
  }
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      NO_ACCOUNT_ALLOWED.has(name) ? handler : refuse,
    ]),
  ) as T
}

const HELD_COPY_MESSAGE =
  'This is a copy of PureMail held in a page, which does not send mail or run send runs. Those happen in Mail\'s own tab. Say so in your answer rather than trying again; nothing was sent.'

/** The tools that send, or start something that sends. Reading, drafting and looking at runs stay available. */
export const SENDING_TOOLS = new Set([
  'sendDraft',
  'createRun',
  'createRunFromDrafts',
  'renderRun',
  'resumeRun',
  'sendRunItem',
])

/** A held copy never sends for an agent. A person's own click on Send is theirs, and goes through the one send path. */
export function refusingSendsWhenHeld<T extends Record<string, (...args: never[]) => unknown>>(held: boolean, handlers: T): T {
  if (!held) return handlers
  const refuse = async () => {
    throw new AgentMailToolError(HELD_COPY_MESSAGE)
  }
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      SENDING_TOOLS.has(name) ? refuse : handler,
    ]),
  ) as T
}

/** Build the guarded PureMail handler map (exported for direct security tests). */
export function buildGuardedPureMailHandlers(
  getContext: () => MailAgentToolContext,
  options: { hasAccount: () => boolean; heldCopy: () => boolean },
): Record<string, AgentToolHandler> {
  return PUREMAIL_OPERATIONS_REGISTRY.buildHandlers(getContext, {
    createError: message => new AgentMailToolError(message),
    recordOperation: (ctx, kind, summary) => {
      ctx.recordOperation?.(kind, summary)
    },
    beforeInvoke: ({ name }) => {
      if (!options.hasAccount() && !NO_ACCOUNT_ALLOWED.has(name)) {
        throw new AgentMailToolError(NO_ACCOUNT_MESSAGE)
      }
      if (options.heldCopy() && SENDING_TOOLS.has(name)) {
        throw new AgentMailToolError(HELD_COPY_MESSAGE)
      }
    },
  })
}

export function usePureMailAgentTools(
  hasAccount: boolean,
  context: MailAgentToolContext,
): RefObject<MailAgentToolContext> {
  // Handlers close over a ref so a tool invoked mid-render always sees the
  // current store and query rather than the values from registration time.
  const contextRef = useRef(context)
  contextRef.current = context
  const hasAccountRef = useRef(hasAccount)
  hasAccountRef.current = hasAccount

  const registryHandlers = useMemo(
    () =>
      buildGuardedPureMailHandlers(() => contextRef.current, {
        hasAccount: () => hasAccountRef.current,
        heldCopy: () => isHeldCopy(),
      }),
    [],
  )

  // Statically key-preserving registration so `scripts/check-manifests.mjs`
  // can verify every manifest tool has a live registered handler at build time.
  const handlers = useMemo(
    () =>
      Object.fromEntries(
        PUREMAIL_AGENT_TOOL_NAMES.map(name => [
          name,
          async (invoke: Parameters<AgentToolHandler>[0]) =>
            registryHandlers[name]!(invoke),
        ]),
      ),
    [registryHandlers],
  )

  usePlatformAgentTools({
    // Always offered, so a call never goes unanswered; without an account they say so.
    ready: true,
    tools: PUREMAIL_AGENT_TOOL_NAMES,
    logLabel: PUREMAIL_AGENT_LOG_LABEL,
    errorType: AgentMailToolError,
    handlers,
  })
  return contextRef
}
