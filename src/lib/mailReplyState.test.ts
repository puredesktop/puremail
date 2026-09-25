import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../types'
import {
  replyStateChip,
  replyStateForThread,
  workingDaysBetween,
} from './mailReplyState'

const me = { email: 'alex@business.example', emails: ['alex@alternate.example'] }
const NOW = '2026-09-03T12:00:00.000Z' // a Thursday

function message(
  input: Omit<Partial<MailMessage>, 'from' | 'to'> & { from: string; to: string[]; receivedAt: string },
): MailMessage {
  const { from, to, ...rest } = input
  return {
    id: `${from}-${input.receivedAt}`,
    threadId: 't1',
    subject: 'Re: thing',
    body: '',
    attachments: [],
    read: true,
    ...rest,
    from: { name: from, email: from },
    to: to.map(email => ({ name: email, email })),
  } as MailMessage
}
const thread = { id: 't1' }

describe('replyStateForThread', () => {
  it('is awaiting when the last message is ours to someone else, with working days counted', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['andrea@example.com'], receivedAt: '2026-08-28T09:00:00.000Z' }), // Friday
    ], me, NOW)
    // Fri → Thu: Mon Tue Wed Thu = 4 working days
    expect(state).toEqual({ kind: 'awaiting', since: '2026-08-28T09:00:00.000Z', days: 4, overdue: true })
  })

  it('is not overdue inside the threshold', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['dave@example.com'], receivedAt: '2026-09-02T09:00:00.000Z' }),
    ], me, NOW)
    expect(state).toMatchObject({ kind: 'awaiting', days: 1, overdue: false })
  })

  it('is replied when they answered after we spoke', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['ben@example.com'], receivedAt: '2026-09-01T09:00:00.000Z' }),
      message({ from: 'ben@example.com', to: ['alex@business.example'], receivedAt: '2026-09-03T10:00:00.000Z' }),
    ], me, NOW)
    expect(state).toMatchObject({ kind: 'replied', at: '2026-09-03T10:00:00.000Z', hoursAgo: 2 })
  })

  it('sending again resets the clock', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['x@example.com'], receivedAt: '2026-08-20T09:00:00.000Z' }),
      message({ from: 'alex@business.example', to: ['x@example.com'], receivedAt: '2026-09-02T09:00:00.000Z' }),
    ], me, NOW)
    expect(state).toMatchObject({ kind: 'awaiting', days: 1 })
  })

  it('an inbound-only thread is nothing to wait for', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'news@example.com', to: ['alex@business.example'], receivedAt: '2026-09-01T09:00:00.000Z' }),
    ], me, NOW)
    expect(state).toEqual({ kind: 'none' })
  })

  it('a note to yourself, or to an alias of yourself, is nothing to wait for', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['alex@alternate.example'], receivedAt: '2026-09-01T09:00:00.000Z' }),
    ], me, NOW)
    expect(state).toEqual({ kind: 'none' })
  })

  it('a message to a no-reply address is nothing to wait for', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['no-reply@service.example'], receivedAt: '2026-09-01T09:00:00.000Z' }),
    ], me, NOW)
    expect(state).toEqual({ kind: 'none' })
  })

  it('a reply to a list message is nothing to wait for', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'digest@list.example', to: ['alex@business.example'], receivedAt: '2026-09-01T08:00:00.000Z', listUnsubscribe: '<mailto:leave@list.example>' }),
      message({ from: 'alex@business.example', to: ['digest@list.example'], receivedAt: '2026-09-01T09:00:00.000Z' }),
    ], me, NOW)
    expect(state).toEqual({ kind: 'none' })
  })

  it('in a group thread any external reply counts', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'alex@business.example', to: ['a@example.com', 'b@example.com'], receivedAt: '2026-09-01T09:00:00.000Z' }),
      message({ from: 'b@example.com', to: ['alex@business.example', 'a@example.com'], receivedAt: '2026-09-02T09:00:00.000Z' }),
    ], me, NOW)
    expect(state.kind).toBe('replied')
  })

  it('drafts are not messages', () => {
    const state = replyStateForThread(thread, [
      message({ from: 'x@example.com', to: ['alex@business.example'], receivedAt: '2026-09-01T09:00:00.000Z' }),
      message({ from: 'alex@business.example', to: ['x@example.com'], receivedAt: '2026-09-02T09:00:00.000Z', isDraft: true }),
    ], me, NOW)
    expect(state).toEqual({ kind: 'none' })
  })
})

describe('workingDaysBetween', () => {
  it('skips weekends and counts the start day as day 0', () => {
    expect(workingDaysBetween('2026-08-28T09:00:00.000Z', '2026-08-28T18:00:00.000Z')).toBe(0) // same Friday
    expect(workingDaysBetween('2026-08-28T09:00:00.000Z', '2026-08-31T09:00:00.000Z')).toBe(1) // Fri → Mon
    expect(workingDaysBetween('2026-08-28T09:00:00.000Z', '2026-09-04T09:00:00.000Z')).toBe(5) // Fri → next Fri
  })
})

describe('replyStateChip', () => {
  it('words the states the way the list shows them', () => {
    expect(replyStateChip({ kind: 'awaiting', since: '', days: 3, overdue: true })).toEqual({ label: 'no reply · 3d', tone: 'overdue' })
    expect(replyStateChip({ kind: 'awaiting', since: '', days: 0, overdue: false })).toEqual({ label: 'no reply · today', tone: 'waiting' })
    expect(replyStateChip({ kind: 'replied', at: '', hoursAgo: 2.4 })).toEqual({ label: 'replied 2h', tone: 'replied' })
    expect(replyStateChip({ kind: 'replied', at: '', hoursAgo: 30 })).toBeNull()
    expect(replyStateChip({ kind: 'none' })).toBeNull()
  })
})
