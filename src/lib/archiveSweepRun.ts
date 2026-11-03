import type { MailMessage, MailProvider, MailWalkPage } from '../types'
import {
  applySweepOutcomes,
  packSweepRows,
  SWEEP_MAX_BATCH,
  sweepProgress,
  sweepRow,
  takeWalkPage,
  type ArchiveSweep,
  type SweepDecision,
  type SweepOutcome,
  type SweepRow,
} from './archiveSweep'
import { readSweepFile, updateSweep } from './archiveSweepPersistence'

/** Messages read from the server in one step of a walk. */
const WALK_PAGE = 50
/** One call stops walking after this long and says to call again, so it never outlasts a tool call. */
const WALK_BUDGET_MS = 20_000

export type SweepProvider = Required<Pick<MailProvider, 'walkMailbox' | 'readWalkedMessage'>>

export function sweepProviderOf(provider: MailProvider | null | undefined): SweepProvider | null {
  return provider?.walkMailbox && provider.readWalkedMessage ? (provider as SweepProvider) : null
}

export interface SweepBatch {
  sweep: ArchiveSweep
  rows: SweepRow[]
  /** Messages that have left the server since they were set aside. */
  gone: string[]
}

/**
 * Walks until enough messages are waiting to fill a batch or time is up, saving
 * its place after every page, then reads what is next. One walk at a time per
 * sweep across tabs; a copy the lock cannot reach loses its page harmlessly,
 * because a page only counts from the place it was fetched from.
 */
export async function nextSweepBatch(
  provider: SweepProvider,
  id: string,
  options: { budgetMs?: number; pageSize?: number } = {},
): Promise<SweepBatch> {
  const run = async (): Promise<SweepBatch> => {
    const fresh = new Map<string, MailMessage>()
    const deadline = Date.now() + (options.budgetMs ?? WALK_BUDGET_MS)
    let sweep = await sweepById(id)
    while (
      !sweep.stopped &&
      !sweep.finished &&
      sweep.queue.length < SWEEP_MAX_BATCH &&
      Date.now() < deadline
    ) {
      const from = sweep.cursor
      const page: MailWalkPage = await provider.walkMailbox(from, {
        pageSize: options.pageSize ?? WALK_PAGE,
        ...(sweep.since ? { since: sweep.since } : {}),
        ...(sweep.before ? { before: sweep.before } : {}),
      })
      sweep = await updateSweep(id, current => {
        const taken = takeWalkPage(current, { from, ...page })
        return { sweep: taken.sweep, result: taken.sweep }
      })
      for (const item of page.items) {
        if (sweep.queue.some(queued => queued.id === item.id)) fresh.set(item.id, item.message)
      }
    }
    if (sweep.stopped) return { sweep, rows: [], gone: [] }
    const rows: SweepRow[] = []
    const gone: string[] = []
    for (const item of sweep.queue.slice(0, SWEEP_MAX_BATCH)) {
      const message = fresh.get(item.id) ?? (await provider.readWalkedMessage(item.id))?.message
      if (message) rows.push(sweepRow(sweep, item.id, message))
      else gone.push(item.id)
    }
    if (gone.length) {
      sweep = await updateSweep(id, current => {
        const applied = applySweepOutcomes(current, gone.map(item => ({ id: item, keep: false })), 'agent')
        return { sweep: applied.sweep, result: applied.sweep }
      })
    }
    return { sweep, rows: packSweepRows(rows), gone }
  }
  return navigator.locks ? navigator.locks.request(`puremail:archive-walk:${id}`, run) : run()
}

export async function sweepById(id: string): Promise<ArchiveSweep> {
  const sweep = (await readSweepFile()).sweeps.find(item => item.id === id)
  if (!sweep) throw new Error(`No sweep "${id}". listArchiveSweeps shows them.`)
  return sweep
}

/**
 * Saves what a person or agent chose to keep, then records every decision. The
 * file comes first: a message is only marked decided once its file exists, and
 * one that could not be saved comes back in the next batch.
 */
export async function decideSweepBatch(
  id: string,
  decisions: readonly SweepDecision[],
  by: 'person' | 'agent',
  save: (decision: SweepDecision) => Promise<{ files: string[]; failed?: string }>,
): Promise<{
  sweep: ArchiveSweep
  recorded: string[]
  retry: string[]
  unknown: string[]
  outcomes: SweepOutcome[]
}> {
  const before = await sweepById(id)
  const waiting = new Set(before.queue.map(item => item.id))
  const outcomes: SweepOutcome[] = []
  for (const decision of decisions) {
    if (!decision.keep || !waiting.has(decision.id) || decision.save === 'none') {
      outcomes.push({ id: decision.id, keep: decision.keep, ...(decision.note ? { note: decision.note } : {}) })
      continue
    }
    const saved = await save(decision).catch(error => ({
      files: [] as string[],
      failed: error instanceof Error ? error.message : String(error),
    }))
    outcomes.push({
      id: decision.id,
      keep: true,
      ...(decision.note ? { note: decision.note } : {}),
      files: saved.files,
      ...(saved.failed ? { saveFailed: saved.failed } : {}),
    })
  }
  const applied = await updateSweep(id, current => {
    const result = applySweepOutcomes(current, outcomes, by)
    return { sweep: result.sweep, result }
  })
  return { ...applied, outcomes }
}

export function setSweepStopped(id: string, stopped: boolean): Promise<ArchiveSweep> {
  return updateSweep(id, current => {
    const sweep = { ...current, stopped, updatedAt: new Date().toISOString() }
    return { sweep, result: sweep }
  })
}

export { sweepProgress }
