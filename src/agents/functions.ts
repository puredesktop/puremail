import type { MailScope } from '@purescience/platform-ui/bridge/mailHub'
import { defineAppFunction, type AppFunctionDefinition } from '../lib/appFunctions'
import { buildMailIntelligenceBriefing } from '../lib/mailHubSync'
import { applyAiTriage, senderFacts, triageRow } from '../lib/aiTriage'
import { aiTriageCurrent, isAiTriageVerdict, latestDeliveredMessage } from '../lib/aiTriageState'
import {
  buildFollowUpNudgeText,
  dueFollowUpReminders,
  scheduleFollowUpReminder,
} from '../lib/followUpRadar'
import {
  analyzeThreadWithDecisionModel,
  classifyScreenerSenderWithDecisionModel,
  decisionModelOpsActive,
  formatDecisionModelLabel,
} from '../lib/mailDecisionOps'
import { buildMarkdownFromThread } from '../lib/mailExport'
import { inspectMailPrivacy } from '../lib/mailPrivacyShield'
import { quoteQueryValue, resolveThreadQuery } from '../lib/mailQuery'
import { ownAddresses, replyStateInStore } from '../lib/mailReplyState'
import type { MailProposal } from '../lib/mailProposal'
import type { BulkTriageAction } from '../lib/mailTriage'
import {
  applyScreenerDecisionWithEffects,
  isNewsletterThread,
  isPaperTrailThread,
  unscreenedSendersInStore,
} from '../lib/mailScreener'
import { matchSnippets, renderSnippet } from '../lib/mailSnippets'
import { buildSenderProfile } from '../lib/senderIntelligence'
import type { MailFilterMutation } from '../lib/mailFilters'
import type {
  MailAiTriageVerdict,
  MailMessage,
  MailStore,
  MailThread,
  ScreenerDestination,
} from '../types'
import {
  AgentMailToolError,
  optionalNumber,
  optionalString,
  requireString,
  type MailAgentToolContext,
} from './catalog'
import { saveAttachmentsHandler, saveMessageAsPdfHandler } from './documentHandlers'
import { createFilterHandler } from './handlers'

function activeStore(ctx: MailAgentToolContext): MailStore {
  return ctx.getStore ? ctx.getStore() : ctx.store
}

function accountThreads(store: MailStore, accountId?: string): MailThread[] {
  return accountId
    ? store.threads.filter(t => t.accountId === accountId)
    : store.threads
}

function threadNonDraftMessages(
  store: MailStore,
  threadId: string,
): MailMessage[] {
  return store.messages
    .filter(m => m.threadId === threadId && !m.isDraft && !m.optimistic)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

function latestNonDraftMessage(
  store: MailStore,
  threadId: string,
): MailMessage | undefined {
  return threadNonDraftMessages(store, threadId)[0]
}

function storeOwnAddresses(store: MailStore): Set<string> {
  return ownAddresses({
    email: store.accounts[0]?.email ?? '',
    emails: [
      ...store.accounts.map(a => a.email),
      ...(store.settings.ownerIdentities?.emails ?? []),
    ],
  })
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function excerpt(text: string | undefined, max = 180): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

const VALID_SCREENER_DESTINATIONS = new Set<ScreenerDestination>([
  'inbox',
  'feed',
  'paper_trail',
  'blocked',
])

export const PUREMAIL_FUNCTIONS: readonly AppFunctionDefinition<MailAgentToolContext>[] = [
  // ── 1. fn_inboxBriefing ───────────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_inboxBriefing',
    category: 'briefing',
    risk: 'read',
    requiresApproval: false,
    replaces: ['getMailContext', 'listThreads', 'getThread', 'getTriageReport', 'listDrafts'],
    description:
      'One-shot executive inbox briefing. Replaces calling getMailContext + multiple listThreads + getThread calls. Returns unread/priority/VIP counts, threads awaiting your reply, overdue follow-ups, unscreened Screener senders, ready drafts, and concise previews with security highlights.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum actionable threads to include in detail (default 10, max 25).',
        },
        includeNoise: {
          type: 'boolean',
          description: 'Include newsletters/receipts in the top thread list (default false).',
        },
      },
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const now = ctx.now ?? new Date()
      const nowIso = now.toISOString()
      const limit = clampInt(optionalNumber(args, 'limit'), 10, 1, 25)
      const includeNoise = args.includeNoise === true

      const inboxRes = resolveThreadQuery(store, ctx.accountId, 'in:inbox', now)
      const unreadRes = resolveThreadQuery(
        store,
        ctx.accountId,
        'in:inbox is:unread',
        now,
      )
      const vipSet = new Set(
        (store.vipSenders ?? []).map(e => e.trim().toLowerCase()),
      )
      const unscreened = unscreenedSendersInStore(store, ctx.accountId)
      const dueReminders = dueFollowUpReminders(store, now.getTime()).filter(r =>
        ctx.accountId ? r.accountId === ctx.accountId : true,
      )
      const own = storeOwnAddresses(store)

      let needsYourReplyCount = 0
      let awaitingTheirReplyCount = 0
      let overdueWaitingCount = 0
      let vipCount = 0
      let highPriorityCount = 0
      let securityAlertsCount = 0

      const scored = inboxRes.threads.map(thread => {
        const threadMsgs = threadNonDraftMessages(store, thread.id)
        const latest = threadMsgs[0]
        const reply = replyStateInStore(store, thread, nowIso)
        const triage = aiTriageCurrent(store, thread)
        const isVip =
          vipSet.size > 0 &&
          thread.participants.some(p => vipSet.has(p.email.trim().toLowerCase()))
        const isUnread = threadMsgs.some(m => !m.read)
        const isBulk =
          isNewsletterThread(thread, threadMsgs, store.screenerDecisions) ||
          isPaperTrailThread(thread, threadMsgs, store.screenerDecisions)
        const latestIsIncoming =
          Boolean(latest) && !own.has(latest!.from.email.trim().toLowerCase())
        const needsYourReply =
          triage?.verdict === 'needs_reply' ||
          (latestIsIncoming && !isBulk && reply.kind !== 'replied')
        const privacy = latest ? inspectMailPrivacy(latest) : null
        const hasSecurityAlert = Boolean(
          privacy &&
            (privacy.linkWarnings.length > 0 ||
              privacy.senderMismatch ||
              privacy.auth.dmarc === 'fail' ||
              privacy.auth.spf === 'fail'),
        )

        if (needsYourReply) needsYourReplyCount += 1
        if (reply.kind === 'awaiting') {
          awaitingTheirReplyCount += 1
          if (reply.overdue) overdueWaitingCount += 1
        }
        if (isVip) vipCount += 1
        if (thread.priority === 'high') highPriorityCount += 1
        if (hasSecurityAlert) securityAlertsCount += 1

        let score = 0
        if (isVip) score += 40
        if (thread.priority === 'high') score += 30
        if (needsYourReply) score += 25
        if (isUnread) score += 15
        if (hasSecurityAlert) score += 20
        if (isBulk) score -= 25

        return {
          thread,
          latest,
          reply,
          triage,
          isVip,
          isUnread,
          isBulk,
          hasSecurityAlert,
          trackersBlocked: privacy?.trackers.length ?? 0,
          score,
        }
      })

      const topThreads = scored
        .filter(item => includeNoise || !item.isBulk || item.isVip || item.hasSecurityAlert)
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.thread.lastMessageAt.localeCompare(a.thread.lastMessageAt),
        )
        .slice(0, limit)
        .map(item => ({
          threadId: item.thread.id,
          subject: item.thread.subject,
          from: item.latest?.from ?? item.thread.participants[0] ?? null,
          lastMessageAt: item.thread.lastMessageAt,
          unread: item.isUnread,
          vip: item.isVip,
          priority: item.thread.priority,
          replyState: item.reply.kind,
          triageVerdict: item.triage?.verdict ?? null,
          hasSecurityAlert: item.hasSecurityAlert,
          trackersBlocked: item.trackersBlocked,
          preview: excerpt(item.latest?.body || item.thread.summary, 180),
        }))

      const draftsReady = store.drafts.filter(d => {
        if (d.sentAt || d.qaStatus === 'pending') return false
        if (ctx.accountId) {
          const thr = store.threads.find(t => t.id === d.threadId)
          if (thr && thr.accountId !== ctx.accountId) return false
        }
        return !d.sendState || d.sendState === 'failed'
      }).length

      const summary = `Inbox briefing: ${inboxRes.total} in inbox (${unreadRes.total} unread, ${needsYourReplyCount} need reply, ${overdueWaitingCount} overdue follow-ups, ${unscreened.length} waiting in Screener).`
      return {
        summary,
        data: {
          counts: {
            inbox: inboxRes.total,
            unread: unreadRes.total,
            needsYourReply: needsYourReplyCount,
            awaitingTheirReply: awaitingTheirReplyCount,
            overdueWaiting: overdueWaitingCount,
            dueFollowUpReminders: dueReminders.length,
            vip: vipCount,
            highPriority: highPriorityCount,
            screenerPending: unscreened.length,
            draftsReady,
            securityAlerts: securityAlertsCount,
          },
          topThreads,
          screenerPreview: unscreened.slice(0, 5).map(s => ({
            email: s.email,
            name: s.name,
            count: s.count,
            latestSubject: s.latestSubject,
            suggestedDestination: s.suggestedDestination,
          })),
        },
      }
    },
  }),

  // ── 2. fn_triageInbox ─────────────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_triageInbox',
    category: 'triage',
    risk: 'read',
    requiresApproval: false,
    riskWhen: { apply: 'write' },
    replaces: ['nextTriageBatch', 'recordTriage', 'getTriageReport'],
    description:
      'Batch-categorizes untriaged inbox threads into needs_reply / important / fyi / noise in ONE call, using configured Decision Models (Jex / OpenAI / Local) when Automatic Triage is active and deterministic signals otherwise. Flags phishing risks. Pass apply: true to save the verdicts onto the threads (does not move or send mail).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum untriaged threads to evaluate (default 10, max 20).',
        },
        apply: {
          type: 'boolean',
          description: 'Record the computed verdicts onto the threads (default false: preview plan only).',
        },
      },
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const now = ctx.now ?? new Date()
      const nowIso = now.toISOString()
      const limit = clampInt(optionalNumber(args, 'limit'), 10, 1, 20)
      const apply = args.apply === true
      const useModel = decisionModelOpsActive(store)

      const inboxRes = resolveThreadQuery(store, ctx.accountId, 'in:inbox', now)
      const facts = senderFacts(store)
      const candidates = inboxRes.threads
        .filter(thread => !aiTriageCurrent(store, thread))
        .slice(0, limit)

      let usedDecisionModel = false
      let modelEvaluated = 0
      const MAX_TRIAGE_MODEL_CALLS = 8
      const items: Array<{
        threadId: string
        subject: string
        from: string
        receivedAt: string
        verdict: MailAiTriageVerdict
        confidence: number
        source: 'decision-model' | 'deterministic'
        reason: string
        securityRisk?: string
      }> = []

      for (const thread of candidates) {
        const latest = latestDeliveredMessage(store, thread.id) ?? latestNonDraftMessage(store, thread.id)
        if (!latest) continue
        const row = triageRow(store, thread, facts)
        const reply = replyStateInStore(store, thread, nowIso)
        let verdict: MailAiTriageVerdict = 'fyi'
        let confidence = 0.75
        let source: 'decision-model' | 'deterministic' = 'deterministic'
        let reason = 'Informational message.'
        let securityRisk: string | undefined

        if (
          useModel &&
          modelEvaluated < MAX_TRIAGE_MODEL_CALLS &&
          row.last !== 'you' &&
          !row.bulk
        ) {
          modelEvaluated += 1
          const insight = await analyzeThreadWithDecisionModel({
            store,
            thread,
            message: latest,
            isOutgoing: false,
          })
          if (insight) {
            usedDecisionModel = true
            if (insight.security && insight.security.riskLevel !== 'clear') {
              securityRisk = insight.security.summary
            }
            if (insight.triageAction) {
              const map: Record<string, MailAiTriageVerdict> = {
                reply: 'needs_reply',
                create_task: 'important',
                snooze: 'important',
                archive: 'fyi',
                unsubscribe: 'noise',
              }
              const mapped = map[insight.triageAction.action]
              if (mapped && isAiTriageVerdict(mapped)) {
                verdict = mapped
                confidence = insight.triageAction.confidence
                source = 'decision-model'
                reason = `${formatDecisionModelLabel(insight.provider, insight.model)} suggested ${insight.triageAction.action} (${Math.round(confidence * 100)}%).`
              }
            }
          }
        }

        const threadMsgs = threadNonDraftMessages(store, thread.id)
        if (source === 'deterministic') {
          if (row.bulk || isNewsletterThread(thread, threadMsgs, store.screenerDecisions)) {
            verdict = 'noise'
            reason = 'Bulk/newsletter sender.'
          } else if (isPaperTrailThread(thread, threadMsgs, store.screenerDecisions)) {
            verdict = 'fyi'
            reason = 'Transactional receipt or order update.'
          } else if (row.last !== 'you' && reply.kind !== 'replied') {
            verdict = 'needs_reply'
            reason = 'Direct incoming message awaiting your reply.'
          } else if (thread.priority === 'high') {
            verdict = 'important'
            reason = 'Marked high priority.'
          }
        }

        items.push({
          threadId: thread.id,
          subject: thread.subject,
          from: latest.from.email,
          receivedAt: latest.receivedAt,
          verdict,
          confidence,
          source,
          reason,
          ...(securityRisk ? { securityRisk } : {}),
        })
      }

      let recorded = 0
      if (apply && items.length > 0) {
        const decisions = items.map(item => ({
          id: item.threadId,
          at: item.receivedAt,
          verdict: item.verdict,
          reason: item.reason,
        }))
        // Compute count purely outside React's async setStore updater so batching / StrictMode cannot zero or double it.
        const previewApply = applyAiTriage(store, decisions, {
          decidedBy: 'agent',
          now,
        })
        recorded = previewApply.recorded.length
        if (recorded > 0) {
          ctx.setStore(current =>
            applyAiTriage(current, decisions, { decidedBy: 'agent', now }).store,
          )
        }
      }

      const byVerdict = {
        needs_reply: items.filter(i => i.verdict === 'needs_reply').length,
        important: items.filter(i => i.verdict === 'important').length,
        fyi: items.filter(i => i.verdict === 'fyi').length,
        noise: items.filter(i => i.verdict === 'noise').length,
      }

      return {
        mutated: apply && recorded > 0,
        usedDecisionModel,
        summary: `Triaged ${items.length} untriaged threads (${byVerdict.needs_reply} needs_reply, ${byVerdict.important} important, ${byVerdict.fyi} fyi, ${byVerdict.noise} noise)${apply ? ` — recorded ${recorded}` : ' (preview)'}.`,
        data: {
          applied: apply,
          recorded,
          counts: byVerdict,
          items,
        },
      }
    },
  }),

  // ── 3. fn_followUpSweep ───────────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_followUpSweep',
    category: 'follow_up',
    risk: 'read',
    requiresApproval: false,
    riskWhen: { scheduleMissing: 'write' },
    replaces: ['listThreads', 'getThread'],
    description:
      'Finds sent threads awaiting a reply and due follow-up reminders in ONE call. Uses Decision Models (when active) to filter out closing "Thanks!" messages that do not actually expect a reply, and generates ready-to-use follow-up nudge text. Optionally schedules reminders for overdue unanswered threads when scheduleMissing: true.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum awaiting threads to return (default 15, max 30).',
        },
        onlyOverdue: {
          type: 'boolean',
          description: 'Return only overdue threads/reminders (default false).',
        },
        scheduleMissing: {
          type: 'boolean',
          description: 'Schedule a follow-up reminder for awaiting threads that lack one (default false).',
        },
      },
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const now = ctx.now ?? new Date()
      const nowIso = now.toISOString()
      const limit = clampInt(optionalNumber(args, 'limit'), 15, 1, 30)
      const onlyOverdue = args.onlyOverdue === true
      const scheduleMissing = args.scheduleMissing === true
      const useModel = decisionModelOpsActive(store)

      const threads = accountThreads(store, ctx.accountId).filter(
        t => t.status !== 'archived' && t.status !== 'done',
      )
      const dueReminders = dueFollowUpReminders(store, now.getTime()).filter(r =>
        ctx.accountId ? r.accountId === ctx.accountId : true,
      )
      const activeReminderIds = new Set(
        (store.followUpReminders ?? [])
          .filter(r => !r.dismissedAt)
          .map(r => r.threadId),
      )

      // Sort overdue / longest-waiting threads FIRST so the 5-call Decision Model
      // budget and `limit` prioritize the highest-urgency unanswered threads.
      const rawAwaiting = threads
        .map(thread => ({
          thread,
          reply: replyStateInStore(store, thread, nowIso),
        }))
        .filter(
          (entry): entry is {
            thread: MailThread
            reply: { kind: 'awaiting'; since: string; days: number; overdue: boolean }
          } => entry.reply.kind === 'awaiting' && (!onlyOverdue || entry.reply.overdue),
        )
        .sort(
          (a, b) =>
            Number(b.reply.overdue) - Number(a.reply.overdue) ||
            b.reply.days - a.reply.days,
        )

      let usedDecisionModel = false
      let modelEvaluated = 0
      const toSchedule: Array<{ threadId: string; accountId: string; remindAt: string }> = []
      const awaiting: Array<{
        threadId: string
        subject: string
        recipient: string
        lastSentAt: string
        workingDaysWaiting: number
        overdue: boolean
        hasReminder: boolean
        expectsReply: boolean
        suggestedWindow: string | null
        suggestedNudge: string
      }> = []

      for (const { thread, reply } of rawAwaiting) {
        if (awaiting.length >= limit) break

        const latest = latestNonDraftMessage(store, thread.id)
        let expectsReply = true
        let suggestedWindow: string | null = reply.overdue ? '1d' : '2d'
        let suggestedIso: string | null = new Date(
          now.getTime() + (reply.overdue ? 1 : 2) * 86_400_000,
        ).toISOString()

        if (useModel && latest && modelEvaluated < 5) {
          modelEvaluated += 1
          const insight = await analyzeThreadWithDecisionModel({
            store,
            thread,
            message: latest,
            isOutgoing: true,
          })
          if (insight?.followUp) {
            usedDecisionModel = true
            expectsReply = insight.followUp.expectsReply
            suggestedWindow =
              insight.followUp.suggestedWindow === 'none'
                ? null
                : insight.followUp.suggestedWindow
            suggestedIso = insight.followUp.suggestedIso
          }
        }

        if (!expectsReply) continue

        const recipient =
          latest?.to?.[0]?.name ||
          latest?.to?.[0]?.email ||
          thread.participants[0]?.name ||
          thread.participants[0]?.email ||
          'recipient'

        const hasReminder = activeReminderIds.has(thread.id)
        if (scheduleMissing && !hasReminder && suggestedIso) {
          toSchedule.push({
            threadId: thread.id,
            accountId: thread.accountId,
            remindAt: suggestedIso,
          })
        }

        awaiting.push({
          threadId: thread.id,
          subject: thread.subject,
          recipient,
          lastSentAt: latest?.receivedAt ?? thread.lastMessageAt,
          workingDaysWaiting: reply.days,
          overdue: reply.overdue,
          hasReminder: hasReminder || (scheduleMissing && Boolean(suggestedIso)),
          expectsReply,
          suggestedWindow,
          suggestedNudge: buildFollowUpNudgeText(thread, latest),
        })
      }

      if (toSchedule.length > 0) {
        ctx.setStore(current => {
          let next = current
          for (const item of toSchedule) {
            next = scheduleFollowUpReminder(
              next,
              { ...item, cancelOnReply: true },
              nowIso,
            )
          }
          return next
        })
      }

      return {
        mutated: toSchedule.length > 0,
        usedDecisionModel,
        summary: `Follow-up sweep: ${awaiting.length} threads awaiting reply (${awaiting.filter(i => i.overdue).length} overdue), ${dueReminders.length} due reminders${toSchedule.length ? `, scheduled ${toSchedule.length} reminders` : ''}.`,
        data: {
          awaitingThreads: awaiting,
          scheduledCount: toSchedule.length,
          dueReminders: dueReminders.map(r => ({
            id: r.id,
            threadId: r.threadId,
            remindAt: r.remindAt,
            note: r.note ?? null,
          })),
        },
      }
    },
  }),

  // ── 4. fn_senderDossier ───────────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_senderDossier',
    category: 'intelligence',
    risk: 'read',
    requiresApproval: false,
    replaces: ['listThreads', 'getThread', 'listKeptContext'],
    description:
      'Builds a complete dossier on a sender (email address or domain) in ONE call: relationship metrics, VIP/Screener status, recent threads with previews, shared attachments, linked tasks, and kept reading-room context.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Sender email address (e.g. "mira@acme.com") or domain (e.g. "acme.com").',
        },
        limit: {
          type: 'number',
          description: 'Maximum recent threads to include (default 10, max 25).',
        },
      },
      required: ['email'],
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const queryEmail = requireString(args, 'email').toLowerCase()
      const limit = clampInt(optionalNumber(args, 'limit'), 10, 1, 25)

      const scopedThreads = accountThreads(store, ctx.accountId)
      const scopedThreadIds = new Set(scopedThreads.map(t => t.id))
      const accountEmail = store.accounts.find(a => a.id === ctx.accountId)?.email
      const matchingSender = queryEmail.includes('@')
        ? queryEmail
        : store.messages.find(
            m =>
              scopedThreadIds.has(m.threadId) &&
              m.from.email.toLowerCase().endsWith(`@${queryEmail}`),
          )?.from.email.toLowerCase() ?? queryEmail

      const profile = buildSenderProfile(
        store,
        matchingSender,
        accountEmail,
        ctx.accountId,
      )
      const matchingThreads = scopedThreads
        .filter(thread =>
          thread.participants.some(p => {
            const e = p.email.trim().toLowerCase()
            return queryEmail.includes('@')
              ? e === queryEmail
              : e.endsWith(`@${queryEmail}`)
          }),
        )
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))

      const threadIds = new Set(matchingThreads.map(t => t.id))
      const tasks = store.tasks
        .filter(t => threadIds.has(t.source.threadId))
        .map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueAt: t.dueAt ?? null,
          threadId: t.source.threadId,
        }))

      const keptContext = Object.values(ctx.readingRoom?.file.byMessageId ?? {})
        .filter(rec => rec.context && threadIds.has(rec.threadId))
        .map(rec => ({
          messageId: rec.messageId,
          threadId: rec.threadId,
          subject: rec.subject,
          scope: rec.context!.scope,
          keptAt: rec.context!.keptAt ?? null,
        }))

      return {
        summary: `Sender dossier for ${profile.name || matchingSender}: ${matchingThreads.length} threads, ${profile.sharedAttachments.length} attachments, ${tasks.length} tasks, VIP=${profile.isVip}, Screener=${profile.screenerDestination ?? 'unscreened'}.`,
        data: {
          profile: {
            email: profile.email,
            name: profile.name,
            domain: profile.domain,
            isVip: profile.isVip,
            screenerDestination: profile.screenerDestination,
            sentToMe: profile.receivedCount,
            sentByMe: profile.sentCount,
            firstContactAt: profile.firstContactAt,
            lastContactAt: profile.lastContactAt,
          },
          recentThreads: matchingThreads.slice(0, limit).map(t => ({
            threadId: t.id,
            subject: t.subject,
            status: t.status,
            lastMessageAt: t.lastMessageAt,
            preview: excerpt(latestNonDraftMessage(store, t.id)?.body || t.summary, 160),
          })),
          attachments: profile.sharedAttachments.slice(0, 15),
          tasks,
          keptContext,
        },
      }
    },
  }),

  // ── 5. fn_prepareReply ────────────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_prepareReply',
    category: 'compose',
    risk: 'write',
    requiresApproval: true,
    replaces: ['getThread', 'draftReply', 'commitReplyDraft', 'listDrafts'],
    description:
      'Prepares a reply draft for a thread in ONE call: loads thread & sender context, matches saved snippets, and stages a ready-to-review draft (when body or snippetId is provided, or returns prepared context + snippet candidates). NEVER sends email — a person always clicks Send.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread id to reply to.',
        },
        body: {
          type: 'string',
          description: 'Optional reply body to stage immediately as a draft.',
        },
        snippetId: {
          type: 'string',
          description: 'Optional saved snippet id or shortcut to render into the reply body.',
        },
        brief: {
          type: 'string',
          description: 'Optional one-line intent/guidance for preparing the reply.',
        },
      },
      required: ['threadId'],
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const threadId = requireString(args, 'threadId')
      const thread = store.threads.find(t => t.id === threadId)
      if (!thread) throw new AgentMailToolError(`Thread "${threadId}" was not found.`)

      const latest = latestNonDraftMessage(store, threadId)
      const bodyArg = optionalString(args, 'body')
      const snippetArg = optionalString(args, 'snippetId')
      const brief = optionalString(args, 'brief')
      const account = store.accounts.find(a => a.id === thread.accountId)

      const snippets = store.snippets ?? []
      let resolvedBody = bodyArg ?? ''
      let matchedSnippetTitle: string | null = null

      if (!resolvedBody && snippetArg) {
        const hit =
          snippets.find(s => s.id === snippetArg || s.shortcut === snippetArg) ??
          matchSnippets(snippets, snippetArg)[0]
        if (!hit) {
          throw new AgentMailToolError(
            `Snippet "${snippetArg}" was not found. Available snippets: ${snippets.map(s => s.shortcut || s.id).join(', ') || 'none'}.`,
          )
        }
        const rendered = renderSnippet(hit, {
          recipientName: latest?.from.name || latest?.from.email || '',
          myName: account?.name || account?.email || '',
          subject: thread.subject,
        })
        resolvedBody = rendered.body
        matchedSnippetTitle = hit.title
      }

      const prepared = await ctx.requestDraftForThread(threadId, brief)
      let committed: Record<string, unknown> | null = null
      if (resolvedBody) {
        if (!ctx.commitReplyDraft) {
          throw new AgentMailToolError(
            'Draft staging is unavailable in this session; call draftReply and compose manually.',
          )
        }
        committed = ctx.commitReplyDraft(prepared.requestId, resolvedBody)
      }

      const snippetSuggestions = snippets.slice(0, 6).map(s => ({
        id: s.id,
        title: s.title,
        shortcut: s.shortcut ?? null,
      }))

      return {
        mutated: Boolean(committed),
        summary: committed
          ? `Staged reply draft for "${thread.subject}"${matchedSnippetTitle ? ` using snippet "${matchedSnippetTitle}"` : ''} (not sent).`
          : `Prepared reply context for "${thread.subject}" (requestId: ${prepared.requestId}; pass body to stage draft).`,
        data: {
          threadId,
          subject: thread.subject,
          from: latest?.from ?? null,
          requestId: prepared.requestId,
          staged: Boolean(committed),
          draft: committed,
          matchedSnippetTitle,
          availableSnippets: snippetSuggestions,
          latestPreview: excerpt(latest?.body, 500),
          note: 'Nothing was sent. The person reviews and clicks Send in PureMail.',
        },
      }
    },
  }),

  // ── 6. fn_cleanupPromotions ───────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_cleanupPromotions',
    category: 'cleanup',
    risk: 'read',
    requiresApproval: false,
    riskWhen: { apply: 'destructive' },
    replaces: ['listThreads', 'showQuery', 'applyMailAction', 'createFilter'],
    description:
      'Finds bulk newsletters, promotions, and List-Unsubscribe clutter in the inbox. Runs read-only preview by default (apply: false); pass apply: true to archive, mark read, or trash ONLY the exact matched promotional threads and optionally add an auto-archive filter.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional mail query to scope cleanup (default: inbox newsletters/bulk with List-Unsubscribe).',
        },
        action: {
          type: 'string',
          enum: ['archive', 'read', 'trash'],
          description: 'Cleanup action when apply is true (default "archive").',
        },
        apply: {
          type: 'boolean',
          description: 'Execute the cleanup on the matched promotional threads (default false: read-only preview).',
        },
        createAutoArchiveFilterFrom: {
          type: 'string',
          description: 'Optional sender email or domain to auto-file into a Newsletters filter (only when apply: true).',
        },
      },
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const now = ctx.now ?? new Date()
      const apply = args.apply === true
      const action = (optionalString(args, 'action') ?? 'archive') as 'archive' | 'read' | 'trash'
      if (!['archive', 'read', 'trash'].includes(action)) {
        throw new AgentMailToolError('"action" must be "archive", "read", or "trash".')
      }
      const query = optionalString(args, 'query')
      const filterSender = optionalString(args, 'createAutoArchiveFilterFrom')

      const candidates = query
        ? resolveThreadQuery(store, ctx.accountId, query, now).threads
        : resolveThreadQuery(store, ctx.accountId, 'in:inbox', now).threads.filter(
            thread => {
              const threadMsgs = threadNonDraftMessages(store, thread.id)
              const latest = threadMsgs[0]
              return (
                Boolean(latest?.listUnsubscribe) ||
                isNewsletterThread(thread, threadMsgs, store.screenerDecisions)
              )
            },
          )

      const senderCounts = new Map<string, number>()
      for (const t of candidates) {
        const email =
          latestNonDraftMessage(store, t.id)?.from.email ??
          t.participants[0]?.email ??
          'unknown'
        senderCounts.set(email, (senderCounts.get(email) ?? 0) + 1)
      }

      const topSenders = [...senderCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([email, count]) => ({ email, count }))

      let appliedProposalSummary: { query: string; threadCount: number; action: string } | null = null
      let filterResult: unknown = null

      if (apply && candidates.length > 0) {
        const bulkAction: BulkTriageAction =
          action === 'archive'
            ? { type: 'archive' }
            : action === 'trash'
              ? { type: 'trash' }
              : { type: 'read', read: true }

        // Build an exact candidate-scoped proposal so we NEVER affect non-promotional inbox mail.
        const proposal: MailProposal = {
          id: `prop_cleanup_${crypto.randomUUID()}`,
          query: query ?? 'is:newsletter',
          action: bulkAction,
          rationale: `Cleanup ${candidates.length} promotional/newsletter thread${candidates.length === 1 ? '' : 's'} (${action})`,
          threadIds: candidates.map(c => c.id),
          createdAt: now.toISOString(),
        }
        ctx.applyAction(proposal)
        appliedProposalSummary = {
          query: proposal.query,
          threadCount: proposal.threadIds.length,
          action,
        }

        if (filterSender) {
          const created = createFilterHandler(ctx, {
            name: `Auto-archive ${filterSender}`,
            query: `from:${quoteQueryValue(filterSender)}`,
            labelName: 'Newsletters',
            fileIntoBox: true,
            markRead: true,
          })
          filterResult = JSON.parse(created.content)
        }
      }

      return {
        mutated: apply && candidates.length > 0,
        summary: !apply
          ? `Promotion cleanup preview: found ${candidates.length} promotional/newsletter threads across ${senderCounts.size} senders (apply: false).`
          : `Cleaned up ${candidates.length} promotional threads (${action})${filterSender ? ` and added Newsletters filter for ${filterSender}` : ''}.`,
        data: {
          applied: apply,
          action,
          matchedCount: candidates.length,
          uniqueSenders: senderCounts.size,
          topSenders,
          sampleThreads: candidates.slice(0, 10).map(t => ({
            threadId: t.id,
            subject: t.subject,
            from: latestNonDraftMessage(store, t.id)?.from.email ?? null,
          })),
          ...(appliedProposalSummary ? { appliedProposal: appliedProposalSummary } : {}),
          ...(filterResult ? { filterResult } : {}),
        },
      }
    },
  }),

  // ── 7. fn_screenerReview ──────────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_screenerReview',
    category: 'screener',
    risk: 'read',
    requiresApproval: false,
    riskWhen: { decisions: 'destructive' },
    replaces: ['listThreads', 'getThread', 'applyMailAction'],
    description:
      'Reviews first-time unknown senders waiting in The Screener with deterministic + Decision-Model routing suggestions (inbox, feed, paper_trail, blocked). Optionally applies a batch of user-approved decisions in ONE call (escalates to destructive approval when decisions are supplied, since blocked senders move mail to Trash).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum unscreened senders to return (default 15, max 30).',
        },
        decisions: {
          type: 'array',
          description: 'Optional user-approved Screener decisions to apply in one batch.',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              destination: {
                type: 'string',
                enum: ['inbox', 'feed', 'paper_trail', 'blocked'],
              },
              name: { type: 'string' },
            },
            required: ['email', 'destination'],
          },
        },
      },
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const nowIso = (ctx.now ?? new Date()).toISOString()
      const limit = clampInt(optionalNumber(args, 'limit'), 15, 1, 30)
      const decisionsArg = Array.isArray(args.decisions) ? args.decisions : []

      const parsedDecisions: Array<{
        email: string
        destination: ScreenerDestination
        name?: string
      }> = []
      for (const raw of decisionsArg) {
        if (!raw || typeof raw !== 'object') {
          throw new AgentMailToolError('Each Screener decision must be an object with email and destination.')
        }
        const rec = raw as { email?: unknown; destination?: unknown; name?: unknown }
        const email = typeof rec.email === 'string' ? rec.email.trim().toLowerCase() : ''
        const destination = rec.destination as ScreenerDestination
        if (!email || !VALID_SCREENER_DESTINATIONS.has(destination)) {
          throw new AgentMailToolError(
            `Invalid Screener decision for "${email || '(empty)'}": destination must be inbox, feed, paper_trail, or blocked.`,
          )
        }
        const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : undefined
        parsedDecisions.push({ email, destination, ...(name ? { name } : {}) })
      }

      // Compute pure transitions outside React's async setStore updater so
      // `applied`, `pendingMutations`, and `nextStore` are 100% deterministic.
      let nextStore = store
      const applied: Array<{ email: string; destination: ScreenerDestination; affectedThreads: number }> = []
      const pendingMutations: MailFilterMutation[] = []

      if (parsedDecisions.length > 0) {
        for (const item of parsedDecisions) {
          const out = applyScreenerDecisionWithEffects(
            nextStore,
            item.email,
            item.destination,
            item.name,
            nowIso,
            ctx.accountId,
          )
          nextStore = out.store
          applied.push({
            email: item.email,
            destination: item.destination,
            affectedThreads: out.affectedThreadIds.length,
          })
          if (item.destination === 'blocked') {
            for (const threadId of out.affectedThreadIds) {
              const thr = nextStore.threads.find(t => t.id === threadId)
              const hasTrash = nextStore.mailboxes.some(
                m => m.accountId === (thr?.accountId ?? ctx.accountId) && m.role === 'trash',
              )
              pendingMutations.push({
                kind: hasTrash ? 'trash' : 'archive',
                threadId,
              })
            }
          }
        }

        ctx.setStore(current => {
          let updated = current
          for (const item of parsedDecisions) {
            updated = applyScreenerDecisionWithEffects(
              updated,
              item.email,
              item.destination,
              item.name,
              nowIso,
              ctx.accountId,
            ).store
          }
          return updated
        })

        if (pendingMutations.length > 0 && ctx.fireFilterMutations) {
          ctx.fireFilterMutations(pendingMutations)
        }
      }

      const waiting = unscreenedSendersInStore(nextStore, ctx.accountId).slice(0, limit)
      const useModel = decisionModelOpsActive(nextStore)
      let usedDecisionModel = false
      let modelCalls = 0

      const senders = []
      for (const sender of waiting) {
        let modelSuggestion: {
          destination: ScreenerDestination
          confidence: number
          model: string
        } | null = null
        if (useModel && modelCalls < 5) {
          const latestMsg = latestNonDraftMessage(nextStore, sender.latestThreadId)
          if (latestMsg) {
            modelCalls += 1
            const res = await classifyScreenerSenderWithDecisionModel({
              store: nextStore,
              senderEmail: sender.email,
              senderName: sender.name,
              latestMessage: latestMsg,
              threadCount: sender.count,
            })
            if (res) {
              usedDecisionModel = true
              modelSuggestion = {
                destination: res.destination,
                confidence: res.confidence,
                model: formatDecisionModelLabel(res.provider, res.model),
              }
            }
          }
        }
        senders.push({
          email: sender.email,
          name: sender.name,
          count: sender.count,
          latestThreadId: sender.latestThreadId,
          latestSubject: sender.latestSubject,
          latestDate: sender.latestDate,
          suggestedDestination:
            modelSuggestion?.destination ?? sender.suggestedDestination,
          modelSuggestion,
        })
      }

      return {
        mutated: applied.length > 0,
        usedDecisionModel,
        summary:
          applied.length > 0
            ? `Applied ${applied.length} Screener decisions; ${senders.length} senders remaining.`
            : `${senders.length} first-time senders waiting in Screener.`,
        data: {
          applied,
          waitingCount: senders.length,
          senders,
        },
      }
    },
  }),

  // ── 8. fn_auditThreadSecurity ─────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_auditThreadSecurity',
    category: 'security',
    risk: 'read',
    requiresApproval: false,
    replaces: ['getThread'],
    description:
      'Runs a complete privacy & security audit on a thread in ONE call: SPF/DKIM/DMARC authentication, From vs Reply-To/Return-Path domain alignment, blocked tracking pixels (vendors + URLs), suspicious/phishing link detection, AND Decision-Model semantic deception/credential-harvesting analysis when active.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread id to audit.',
        },
      },
      required: ['threadId'],
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const threadId = requireString(args, 'threadId')
      const thread = store.threads.find(t => t.id === threadId)
      if (!thread) throw new AgentMailToolError(`Thread "${threadId}" was not found.`)

      const messages = store.messages
        .filter(m => m.threadId === threadId && !m.isDraft && !m.optimistic)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

      if (messages.length === 0) {
        return {
          summary: `No delivered messages to audit in thread "${thread.subject}".`,
          data: { threadId, riskLevel: 'clear', messages: [] },
        }
      }

      const own = ownAddresses({
        email: store.accounts.find(a => a.id === thread.accountId)?.email ?? '',
        emails: [
          ...store.accounts.map(a => a.email),
          ...(store.settings.ownerIdentities?.emails ?? []),
        ],
      })

      const latest = messages[0]!
      const isOutgoing = own.has(latest.from.email.trim().toLowerCase())
      const deterministicReports = messages.slice(0, 5).map(msg => {
        const rep = inspectMailPrivacy(msg)
        return {
          messageId: msg.id,
          from: msg.from.email,
          receivedAt: msg.receivedAt,
          auth: rep.auth,
          senderMismatch: rep.senderMismatch,
          trackersBlocked: rep.trackers,
          linkWarnings: rep.linkWarnings,
        }
      })

      let modelSecurity = null
      let usedDecisionModel = false
      if (!isOutgoing && decisionModelOpsActive(store)) {
        const insight = await analyzeThreadWithDecisionModel({
          store,
          thread,
          message: latest,
          isOutgoing: false,
        })
        if (insight?.security) {
          usedDecisionModel = true
          modelSecurity = insight.security
        }
      }

      const totalTrackers = deterministicReports.reduce(
        (sum, r) => sum + r.trackersBlocked.length,
        0,
      )
      const totalLinkWarnings = deterministicReports.reduce(
        (sum, r) => sum + r.linkWarnings.length,
        0,
      )
      const anyAuthFail = deterministicReports.some(
        r => r.auth.dmarc === 'fail' || r.auth.spf === 'fail',
      )
      const anyMismatch = deterministicReports.some(r => Boolean(r.senderMismatch))

      const riskLevel =
        anyAuthFail || totalLinkWarnings > 0 || modelSecurity?.riskLevel === 'danger'
          ? 'danger'
          : anyMismatch || modelSecurity?.riskLevel === 'warn'
            ? 'warn'
            : 'clear'

      return {
        usedDecisionModel,
        summary: `Security audit for "${thread.subject}": ${riskLevel.toUpperCase()} (${totalTrackers} trackers blocked, ${totalLinkWarnings} link warnings${modelSecurity ? `, model=${modelSecurity.riskLevel}` : ''}).`,
        data: {
          threadId,
          subject: thread.subject,
          riskLevel,
          totalTrackersBlocked: totalTrackers,
          totalLinkWarnings,
          modelSecurity,
          messages: deterministicReports,
        },
      }
    },
  }),

  // ── 9. fn_exportThreadBundle ──────────────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_exportThreadBundle',
    category: 'export',
    risk: 'write',
    requiresApproval: false,
    replaces: ['getThread', 'saveAttachments', 'saveMessageAsPdf'],
    description:
      'Exports a thread bundle in ONE call: saves the thread PDF and/or document attachments into the workspace Mail folder (when workspace saving is available) and returns a clean Markdown transcript + metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread id to export.',
        },
        savePdf: {
          type: 'boolean',
          description: 'Save thread as PDF in the workspace Mail folder (default true when supported).',
        },
        saveAttachments: {
          type: 'boolean',
          description: 'Save thread attachments into the workspace Mail folder (default true when supported).',
        },
        includeMarkdown: {
          type: 'boolean',
          description: 'Include a Markdown digest of the thread in the response (default true).',
        },
      },
      required: ['threadId'],
    },
    run: async (ctx, args) => {
      const store = activeStore(ctx)
      const threadId = requireString(args, 'threadId')
      let thread = store.threads.find(t => t.id === threadId)
      let messages = store.messages
        .filter(m => m.threadId === threadId && !m.isDraft)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))

      if (!thread && ctx.importRemoteThread) {
        const imported = await ctx.importRemoteThread(threadId)
        if (imported) {
          thread = imported.threads.find(t => t.id === threadId)
          messages = imported.messages
            .filter(m => m.threadId === threadId && !m.isDraft)
            .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
        }
      }
      if (!thread) throw new AgentMailToolError(`Thread "${threadId}" was not found.`)

      const wantPdf = args.savePdf !== false
      const wantAttachments = args.saveAttachments !== false
      const wantMarkdown = args.includeMarkdown !== false

      let pdfResult: Record<string, unknown> | null = null
      let attachmentsResult: Record<string, unknown> | null = null
      let savedAttachmentsCount = 0
      const warnings: string[] = []

      if (wantPdf) {
        if (ctx.saveMailPdf && ctx.saveFolder) {
          try {
            const res = await saveMessageAsPdfHandler(ctx, { threadId })
            pdfResult = JSON.parse(res.content) as Record<string, unknown>
          } catch (err) {
            warnings.push(
              `PDF export skipped: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        } else {
          warnings.push('PDF export unavailable in this session (workspace Mail folder not configured).')
        }
      }

      const hasAnyAttachments = messages.some(m => m.attachments.length > 0)
      if (wantAttachments && hasAnyAttachments) {
        if (ctx.writeBinaryFile && ctx.saveFolder) {
          try {
            const res = await saveAttachmentsHandler(ctx, { threadId })
            attachmentsResult = JSON.parse(res.content) as Record<string, unknown>
            savedAttachmentsCount = Array.isArray(attachmentsResult.saved)
              ? attachmentsResult.saved.length
              : 0
          } catch (err) {
            warnings.push(
              `Attachments export skipped: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        } else {
          warnings.push('Attachment export unavailable in this session (workspace Mail folder not configured).')
        }
      }

      const markdown = wantMarkdown
        ? buildMarkdownFromThread(thread, messages)
        : undefined
      const didSaveFiles = Boolean(pdfResult) || savedAttachmentsCount > 0

      return {
        mutated: didSaveFiles,
        summary: `Exported bundle for "${thread.subject}" (${messages.length} messages${pdfResult ? ', PDF saved' : ''}${savedAttachmentsCount > 0 ? `, ${savedAttachmentsCount} attachment${savedAttachmentsCount === 1 ? '' : 's'} saved` : ''}).`,
        data: {
          threadId,
          subject: thread.subject,
          messageCount: messages.length,
          pdf: pdfResult,
          attachments: attachmentsResult,
          savedAttachmentsCount,
          warnings,
          ...(markdown ? { markdown } : {}),
        },
      }
    },
  }),

  // ── 10. fn_mailIntelligenceBriefing ───────────────────────────────────
  defineAppFunction<MailAgentToolContext>({
    name: 'fn_mailIntelligenceBriefing',
    category: 'briefing',
    risk: 'read',
    requiresApproval: false,
    replaces: ['listDrafts', 'getMailContext'],
    description:
      'Aggregates the Mail Intelligence Hub executive picture in ONE call: pending cross-app Outbox drafts awaiting review, extracted email signals grouped by target Pure* app, overdue follow-ups, the active Voice Profile summary, and the synthesized Morning Briefing.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['personal', 'organisation'],
          description:
            'Optional privacy scope filter for extracted signals and briefing synthesis.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum pending drafts and signals to include in detail (default 25, max 100).',
        },
        includeBriefingMarkdown: {
          type: 'boolean',
          description:
            'Include the synthesized Morning Briefing Markdown document (default true).',
        },
      },
    },
    run: async (ctx, args) => {
      const rawScope = optionalString(args, 'scope')
      if (rawScope && rawScope !== 'personal' && rawScope !== 'organisation') {
        throw new AgentMailToolError(
          `Invalid scope "${rawScope}". Expected "personal" or "organisation".`,
        )
      }
      const scope = rawScope as MailScope | undefined
      const limit = clampInt(optionalNumber(args, 'limit'), 25, 1, 100)
      const includeBriefingMarkdown = args.includeBriefingMarkdown !== false

      const data = await buildMailIntelligenceBriefing({
        client: ctx.mailHubClient,
        scope,
        limit,
        includeBriefingMarkdown,
        now: ctx.now,
      })

      const appCount = Object.keys(data.signalsByTargetApp).length
      const summary = data.hubAvailable
        ? `Mail Intelligence Hub briefing: ${data.counts.pendingOutboxDrafts} pending cross-app draft${data.counts.pendingOutboxDrafts === 1 ? '' : 's'}, ${data.counts.pendingSignals} signal${data.counts.pendingSignals === 1 ? '' : 's'} across ${appCount} app${appCount === 1 ? '' : 's'}, ${data.counts.dueFollowUps} overdue follow-up${data.counts.dueFollowUps === 1 ? '' : 's'}${data.voiceProfile ? `, Voice Profile grounded on ${data.voiceProfile.sampleCount} sent emails` : ''}.`
        : 'Mail Intelligence Hub bridge is unavailable in this session; returning empty cross-app snapshot.'

      return {
        mutated: false,
        summary,
        data: data as unknown as Record<string, unknown>,
      }
    },
  }),
]
