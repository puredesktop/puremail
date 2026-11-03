import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { newSweep, SWEEP_READ_CAP, sweepProgress, type ArchiveSweep, type SweepDecision, type SweepSave } from '../lib/archiveSweep'
import { readSweepFile, updateSweepFile } from '../lib/archiveSweepPersistence'
import { decideSweepBatch, nextSweepBatch, setSweepStopped, sweepById } from '../lib/archiveSweepRun'
import { isDocumentAttachment } from '../lib/mailAttachments'
import { cleanMailMessageText } from '../lib/mailTextUtils'
import { saveAttachmentsHandler, saveMessageAsPdfHandler } from './documentHandlers'
import {
  AgentMailToolError,
  optionalNumber,
  optionalString,
  requireString,
  type MailAgentToolContext,
} from './catalog'

/**
 * Archive sweeps for the assistant: every message on the server, once, for
 * whatever the caller is looking for. The screen in ArchiveSweepsScreen runs
 * the same library functions over the same file.
 */

function ok(payload: unknown): AgentToolHandlerResult {
  return { content: JSON.stringify(payload) }
}

function requireProvider(context: MailAgentToolContext) {
  if (!context.sweepProvider) {
    throw new AgentMailToolError('This account cannot be walked: it needs a connected mail server.')
  }
  return context.sweepProvider
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const raw = args[key]
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

function standing(sweep: ArchiveSweep) {
  const { status, said } = sweepProgress(sweep)
  return { sweepId: sweep.id, name: sweep.name, status, said }
}

export async function startArchiveSweepHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  requireProvider(context)
  const name = requireString(args, 'name')
  const sweep = newSweep(
    {
      name,
      words: stringList(args, 'words'),
      senders: stringList(args, 'senders'),
      exclude: stringList(args, 'exclude'),
      skipBulk: args.skipBulk === true,
      ...(optionalString(args, 'since') ? { since: optionalString(args, 'since')! } : {}),
      ...(optionalString(args, 'before') ? { before: optionalString(args, 'before')! } : {}),
    },
    'agent',
  )
  await updateSweepFile(file => ({ file: { ...file, sweeps: [...file.sweeps, sweep] }, result: null }))
  context.recordOperation?.('mail.sweep.start', `Started an archive sweep: ${sweep.name}.`)
  return ok({ ...standing(sweep), note: 'Call nextArchiveBatch.' })
}

export async function nextArchiveBatchHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const provider = requireProvider(context)
  const { sweep, rows } = await nextSweepBatch(provider, requireString(args, 'sweepId'))
  const state = standing(sweep)
  return ok({
    ...state,
    waiting: sweep.queue.length,
    messages: rows,
    note:
      state.status === 'stopped'
        ? 'This sweep is stopped. stopArchiveSweep with resume: true starts it again.'
        : rows.length
          ? 'Decide them all with recordArchiveBatch, then call again.'
          : state.status === 'done'
            ? 'Nothing left: the whole mailbox has been gone through.'
            : 'Still reading: call again.',
  })
}

/** auto: a message's documents, or the email itself as a PDF when it has none. */
async function saveKept(
  context: MailAgentToolContext,
  decision: SweepDecision,
): Promise<{ files: string[]; failed?: string }> {
  const save: SweepSave = decision.save ?? 'none'
  const files: string[] = []
  let attachments = save === 'attachments' || save === 'both'
  let pdf = save === 'pdf' || save === 'both'
  if (save === 'auto') {
    const found = await context.readWalkedMessage?.(decision.id)
    if (!found) return { files, failed: 'It is no longer on the mail server.' }
    attachments = (found.message.attachments ?? []).some(isDocumentAttachment)
    pdf = !attachments
  }
  const args = { archiveItem: decision.id }
  let failed: string | undefined
  if (attachments) {
    const result = JSON.parse((await saveAttachmentsHandler(context, args)).content) as {
      saved?: Array<{ path: string }>
      failed?: Array<{ name: string; reason: string }>
    }
    files.push(...(result.saved ?? []).map(item => item.path))
    if (result.failed?.length) failed = result.failed.map(item => `${item.name}: ${item.reason}`).join('; ')
  }
  if (pdf) {
    const result = JSON.parse((await saveMessageAsPdfHandler(context, args)).content) as { path: string }
    files.push(result.path)
  }
  return { files, ...(failed ? { failed } : {}) }
}

export function readDecisions(args: Record<string, unknown>): SweepDecision[] {
  const raw = args.decisions
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AgentMailToolError('"decisions" is required: one {id, keep, note?, save?} per message from nextArchiveBatch.')
  }
  return raw.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id) throw new AgentMailToolError(`decisions[${index}].id is required.`)
    if (typeof row.keep !== 'boolean') throw new AgentMailToolError(`decisions[${index}].keep must be true or false.`)
    const save = row.save
    if (save !== undefined && !['auto', 'pdf', 'attachments', 'both', 'none'].includes(String(save))) {
      throw new AgentMailToolError(`decisions[${index}].save is auto, pdf, attachments, both or none.`)
    }
    return {
      id: row.id,
      keep: row.keep,
      ...(typeof row.note === 'string' && row.note.trim() ? { note: row.note.trim() } : {}),
      ...(save ? { save: save as SweepSave } : {}),
    }
  })
}

export function saveSweepItem(context: MailAgentToolContext, decision: SweepDecision) {
  return saveKept(context, decision)
}

export async function recordArchiveBatchHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  requireProvider(context)
  const id = requireString(args, 'sweepId')
  const decisions = readDecisions(args)
  const applied = await decideSweepBatch(id, decisions, 'agent', decision => saveKept(context, decision))
  const kept = applied.outcomes.filter(item => item.keep && applied.recorded.includes(item.id))
  if (kept.length) {
    context.recordOperation?.('mail.sweep.keep', `Kept ${kept.length} message${kept.length === 1 ? '' : 's'} in the archive sweep ${applied.sweep.name}.`)
  }
  return ok({
    ...standing(applied.sweep),
    recorded: applied.recorded.length,
    kept: kept.map(item => ({ id: item.id, files: item.files ?? [], ...(item.saveFailed ? { failed: item.saveFailed } : {}) })),
    ...(applied.retry.length ? { comesBack: applied.retry } : {}),
    ...(applied.unknown.length ? { notWaiting: applied.unknown } : {}),
    note: 'Call nextArchiveBatch for the next messages.',
  })
}

export async function readArchiveItemHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  if (!context.readWalkedMessage) throw new AgentMailToolError('This account cannot be walked.')
  const id = requireString(args, 'id')
  const found = await context.readWalkedMessage(id)
  if (!found) throw new AgentMailToolError(`"${id}" is no longer on the mail server.`)
  const { message } = found
  const text = cleanMailMessageText(message).text.replace(/[ \t]+/g, ' ').trim()
  return ok({
    id,
    at: message.receivedAt,
    subject: message.subject,
    from: message.from?.email ?? '',
    to: (message.to ?? []).map(item => item.email),
    files: (message.attachments ?? []).map(item => ({ name: item.name, type: item.mimeType, size: item.sizeLabel })),
    text: text.slice(0, SWEEP_READ_CAP),
    ...(text.length > SWEEP_READ_CAP ? { cut: true } : {}),
  })
}

export async function getArchiveSweepHandler(
  _context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const sweep = await sweepById(requireString(args, 'sweepId'))
  const offset = Math.max(0, Math.floor(optionalNumber(args, 'offset') ?? 0))
  const limit = Math.min(40, Math.max(1, Math.floor(optionalNumber(args, 'limit') ?? 15)))
  const newest = [...sweep.kept].reverse()
  const rows: unknown[] = []
  let used = 0
  for (const item of newest.slice(offset, offset + limit)) {
    const row = { id: item.id, at: item.at.slice(0, 10), subject: item.subject.slice(0, 80), from: item.from, ...(item.note ? { note: item.note.slice(0, 120) } : {}), files: item.files, ...(item.saveFailed ? { failed: item.saveFailed } : {}) }
    used += JSON.stringify(row).length
    if (rows.length && used > 3000) break
    rows.push(row)
  }
  return ok({
    ...standing(sweep),
    looksFor: { words: sweep.words, senders: sweep.senders },
    keptTotal: newest.length,
    offset,
    kept: rows,
  })
}

export async function listArchiveSweepsHandler(): Promise<AgentToolHandlerResult> {
  const { sweeps } = await readSweepFile()
  return ok({ sweeps: sweeps.map(standing) })
}

export async function stopArchiveSweepHandler(
  context: MailAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const stopped = args.resume !== true
  const sweep = await setSweepStopped(requireString(args, 'sweepId'), stopped)
  context.recordOperation?.('mail.sweep.stop', `${stopped ? 'Stopped' : 'Resumed'} the archive sweep ${sweep.name}.`)
  return ok(standing(sweep))
}
