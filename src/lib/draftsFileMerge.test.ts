import { describe, expect, it } from 'vitest'
import { applyDraftsFileChanges, baselineOf, mergeRecords, mergeScheduledSends, withoutTombstoned, type Tombstone } from './draftsFileMerge'
import { emptyMailStore } from './mailStoreData'
import type { Draft, ScheduledSend } from '../types'

const NOW = '2026-11-02T12:00:00.000Z'

function draft(id: string, patch: Partial<Draft> = {}): Draft {
  return { id, threadId: 't', to: [], subject: '', body: id, attachments: [], updatedAt: '2026-11-02T10:00:00.000Z', syncState: 'pending', ...patch }
}

const merge = (input: { baseline?: Draft[]; memory?: Draft[]; disk?: Draft[]; tombstones?: Tombstone[]; discards?: Map<string, string> }) =>
  mergeRecords<Draft>({ baseline: baselineOf(input.baseline ?? []), memory: input.memory ?? [], disk: input.disk ?? [], tombstones: input.tombstones ?? [], discards: input.discards, now: NOW })

const ids = (drafts: Draft[]) => drafts.map(item => item.id).sort()

describe('merging the drafts file', () => {
  it('absence on either side is never a delete', () => {
    const result = merge({ memory: [draft('mine')], disk: [draft('theirs')] })
    expect(ids(result.merged)).toEqual(['mine', 'theirs'])
    expect(ids(result.arrived)).toEqual(['theirs'])
    expect(result.tombstones).toEqual([])
  })

  it('writes back what this copy still holds when the file lost it', () => {
    const held = draft('held')
    const result = merge({ baseline: [held], memory: [held], disk: [] })
    expect(ids(result.merged)).toEqual(['held'])
    expect(result.removed).toEqual([])
  })

  it('a draft this copy held and no longer holds gets a tombstone', () => {
    const held = draft('gone')
    const result = merge({ baseline: [held], memory: [], disk: [held] })
    expect(result.merged).toEqual([])
    expect(result.tombstones).toEqual([{ id: 'gone', deletedAt: NOW, reason: 'removed' }])
  })

  it('a recorded discard is a discarded tombstone, at the time it happened', () => {
    const held = draft('gone')
    const at = '2026-11-02T11:59:00.000Z'
    expect(merge({ baseline: [held], disk: [held], discards: new Map([['gone', at]]) }).tombstones).toEqual([{ id: 'gone', deletedAt: at, reason: 'discarded' }])
  })

  it('takes the file when only the other copy changed it, even at the same edit time', () => {
    const base = draft('x')
    const pushed = { ...base, providerDraftId: 'gmail_1', syncState: 'synced' as const }
    const result = merge({ baseline: [base], memory: [base], disk: [pushed] })
    expect(result.merged).toEqual([pushed])
    expect(result.arrived).toEqual([pushed])
  })

  it('keeps memory when only this copy changed it, even at an older edit time', () => {
    const base = draft('x')
    const edited = { ...base, body: 'edited', updatedAt: '2026-11-02T09:00:00.000Z' }
    expect(merge({ baseline: [base], memory: [edited], disk: [base] }).merged).toEqual([edited])
  })

  it('both changed: later edit wins, sent beats unsent, an uncertain send beats an edit', () => {
    const base = draft('x')
    const early = { ...base, body: 'early', updatedAt: '2026-11-02T10:30:00.000Z' }
    const late = { ...base, body: 'late', updatedAt: '2026-11-02T11:00:00.000Z' }
    expect(merge({ baseline: [base], memory: [early], disk: [late] }).merged).toEqual([late])
    expect(merge({ baseline: [base], memory: [late], disk: [early] }).merged).toEqual([late])
    const sent = { ...early, sentAt: '2026-11-02T10:31:00.000Z' }
    expect(merge({ baseline: [base], memory: [late], disk: [sent] }).merged).toEqual([sent])
    const uncertain = { ...early, sendState: 'uncertain' as const }
    expect(merge({ baseline: [base], memory: [uncertain], disk: [late] }).merged).toEqual([uncertain])
  })

  it('a tombstone removes an unchanged copy, and yields to a later real edit', () => {
    const held = draft('x')
    const tombstone: Tombstone = { id: 'x', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'discarded' }
    const dropped = merge({ baseline: [held], memory: [held], tombstones: [tombstone] })
    expect(dropped.merged).toEqual([])
    expect(dropped.removed).toEqual([tombstone])
    expect(dropped.tombstones).toEqual([tombstone])
    const edited = { ...held, body: 'more', updatedAt: '2026-11-02T11:00:00.000Z' }
    const kept = merge({ baseline: [held], memory: [edited], tombstones: [tombstone] })
    expect(kept.merged).toEqual([edited])
    expect(kept.tombstones).toEqual([])
  })

  it('an edit made before the delete loses to it', () => {
    const held = draft('x')
    const edited = { ...held, body: 'more', updatedAt: '2026-11-02T10:10:00.000Z' }
    const tombstone: Tombstone = { id: 'x', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' }
    expect(merge({ baseline: [held], memory: [edited], tombstones: [tombstone] }).merged).toEqual([])
  })

  it('a record new to this copy clears the tombstone: a provider listed it again', () => {
    const relisted = draft('x', { updatedAt: '2026-01-01T00:00:00.000Z' })
    const result = merge({ memory: [relisted], tombstones: [{ id: 'x', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' }] })
    expect(result.merged).toEqual([relisted])
    expect(result.tombstones).toEqual([])
  })

  it('does not take a tombstoned record from the file', () => {
    const result = merge({ disk: [draft('x')], tombstones: [{ id: 'x', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' }] })
    expect(result.merged).toEqual([])
    expect(result.arrived).toEqual([])
  })

  it('forgets tombstones after 90 days', () => {
    expect(merge({ tombstones: [{ id: 'x', deletedAt: '2026-01-01T00:00:00.000Z', reason: 'removed' }] }).tombstones).toEqual([])
  })
})

describe('tombstone helpers', () => {
  it('drops on load what a tombstone covers, not what was edited later or sent', () => {
    const tombstones: Tombstone[] = [
      { id: 'a', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' },
      { id: 'b', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' },
      { id: 'c', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' },
    ]
    const kept = withoutTombstoned([draft('a'), draft('b', { updatedAt: '2026-11-02T11:00:00.000Z' }), draft('c', { sentAt: NOW }), draft('d')], tombstones)
    expect(ids(kept)).toEqual(['b', 'c', 'd'])
  })
})

describe('taking another copy’s saves into memory', () => {
  const empty = { drafts: [], removedDrafts: [], runs: [], removedRuns: [], scheduledSends: [], sentReceipts: [] }

  it('is the same store when nothing arrived', () => {
    const store = emptyMailStore()
    expect(applyDraftsFileChanges(store, empty)).toBe(store)
  })

  it('keeps an edit made here after the merge was taken', () => {
    const typed = draft('x', { body: 'typed', updatedAt: '2026-11-02T11:00:00.000Z' })
    const store = { ...emptyMailStore(), drafts: [typed] }
    const next = applyDraftsFileChanges(store, { ...empty, drafts: [draft('x', { body: 'theirs' })], removedDrafts: [{ id: 'x', deletedAt: '2026-11-02T10:30:00.000Z', reason: 'removed' }] })
    expect(next.drafts).toEqual([typed])
  })

  it('adds a draft with its home, and removes a deleted one', () => {
    const store = { ...emptyMailStore(), drafts: [draft('gone')] }
    const thread = { id: 't2', accountId: 'acc' } as never
    const next = applyDraftsFileChanges(store, { ...empty, drafts: [draft('new', { threadId: 't2' })], removedDrafts: [{ id: 'gone', deletedAt: NOW, reason: 'discarded' }], recovery: { accounts: [], mailboxes: [], threads: [thread] } })
    expect(ids(next.drafts)).toEqual(['new'])
    expect(next.threads.map(item => item.id)).toEqual(['t2'])
  })
})

describe('sends and schedules in the merged file', () => {
  const attempt = { id: 'attempt_1', at: NOW, phase: 'held' as const, approved: 'fingerprint' }
  const base = draft('d')
  const empty = { drafts: [], removedDrafts: [], runs: [], removedRuns: [], scheduledSends: [], sentReceipts: [] }

  it('an attempt under way beats a later edit from a copy that did not know of it', () => {
    const mine = draft('d', { sendAttempt: attempt })
    const theirs = draft('d', { body: 'edited elsewhere', updatedAt: '2026-11-02T11:00:00.000Z' })
    expect(merge({ baseline: [base], memory: [mine], disk: [theirs] }).merged).toEqual([mine])
    expect(merge({ baseline: [base], memory: [theirs], disk: [mine] }).merged).toEqual([mine])
  })

  it('the record settling an attempt beats that attempt', () => {
    const stale = draft('d', { sendAttempt: { ...attempt, phase: 'preparing' } })
    const undone = draft('d', { sendSettledAttemptId: attempt.id, sendUndoneAt: NOW })
    expect(merge({ baseline: [base], memory: [stale], disk: [undone] }).merged).toEqual([undone])
    expect(merge({ baseline: [base], memory: [undone], disk: [stale] }).merged).toEqual([undone])
  })

  it('a delete from another copy does not erase a send begun here since', () => {
    const mine = draft('d', { sendAttempt: attempt })
    const result = merge({ baseline: [base], memory: [mine], tombstones: [{ id: 'd', deletedAt: NOW, reason: 'discarded' }] })
    expect(result.merged).toEqual([mine])
    expect(result.removed).toEqual([])
    expect(result.tombstones).toEqual([])
  })

  it('a send that ended elsewhere and removed its draft still removes it here', () => {
    const copied = draft('d', { sendAttempt: attempt })
    const tombstone: Tombstone = { id: 'd', deletedAt: NOW, reason: 'removed' }
    const result = merge({ baseline: [copied], memory: [copied], tombstones: [tombstone] })
    expect(result.merged).toEqual([])
    expect(result.removed).toEqual([tombstone])
  })

  it('an arrival saved without knowing of the attempt leaves it in memory; one that settled it does not', () => {
    const store = { ...emptyMailStore(), drafts: [draft('d', { sendAttempt: attempt })] }
    const edited = draft('d', { body: 'edited', updatedAt: '2026-11-02T11:00:00.000Z' })
    expect(applyDraftsFileChanges(store, { ...empty, drafts: [edited] }).drafts[0]!.sendAttempt).toEqual(attempt)
    const settled = draft('d', { sendSettledAttemptId: attempt.id, sendState: 'failed', updatedAt: '2026-11-02T11:00:00.000Z' })
    expect(applyDraftsFileChanges(store, { ...empty, drafts: [settled] }).drafts[0]).toEqual(settled)
  })

  const entry = (id: string, status: ScheduledSend['status']): ScheduledSend => ({ id, draftId: 'd', threadId: 't', sendAt: NOW, createdAt: NOW, status })

  it('a stale copy cannot revive a stopped schedule, and the stop reaches it', () => {
    const result = mergeScheduledSends({ baseline: new Set(['s']), memory: [entry('s', 'scheduled')], disk: [entry('s', 'cancelled')] })
    expect(result.merged).toEqual([entry('s', 'cancelled')])
    expect(result.arrived).toEqual([entry('s', 'cancelled')])
    const taken = applyDraftsFileChanges({ ...emptyMailStore(), scheduledSends: [entry('s', 'scheduled')] }, { ...empty, scheduledSends: result.arrived })
    expect(taken.scheduledSends).toEqual([entry('s', 'cancelled')])
  })

  it('keeps schedules each copy made, and does not bring back one this copy dropped', () => {
    const result = mergeScheduledSends({ baseline: new Set(['dropped']), memory: [entry('mine', 'scheduled')], disk: [entry('theirs', 'scheduled'), entry('dropped', 'scheduled')] })
    expect(result.merged.map(item => item.id)).toEqual(['mine', 'theirs'])
    expect(result.arrived.map(item => item.id)).toEqual(['theirs'])
  })
})
