// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  aiTriageFeed,
  aiTriageReport,
  aiTriageSummary,
  applyAiTriage,
  clearAiTriage,
  parseSince,
  untriagedThreads,
} from './aiTriage'
import { aiTriageFixture } from './aiTriageFixture'
import { aiTriageCurrent, aiTriageRecordFor } from './aiTriageState'
import { parseMailQuery, resolveThreadQuery } from './mailQuery'
import { migratePersistedMailStore } from './mailStoreMigration'
import type { MailStore } from '../types'

const NOW = new Date('2026-09-14T08:00:00.000Z')

function agentDecision(store: MailStore, id: string, verdict: string, extra = {}) {
  const row = aiTriageFeed(store, store.accounts[0].id, { now: NOW, budget: 100_000 }).threads.find(
    item => item.id === id,
  )
  if (!row) throw new Error(`${id} is not in the feed`)
  return { id, at: row.at, verdict, reason: `Reason for ${id}.`, ...extra }
}

function record(store: MailStore, decisions: Array<ReturnType<typeof agentDecision>>) {
  return applyAiTriage(store, decisions, { decidedBy: 'agent', now: NOW })
}

describe('the triage feed', () => {
  it('feeds untriaged inbox threads with the cleaned latest message and hard facts, never a verdict', () => {
    const { store, accountId } = aiTriageFixture(NOW)
    const feed = aiTriageFeed(store, accountId, { now: NOW })
    const byId = new Map(feed.threads.map(row => [row.id, row]))

    expect([...byId.keys()].sort()).toEqual(['t_ask', 't_cc', 't_mine', 't_news'])
    expect(feed.remaining).toBe(0)
    expect(byId.get('t_ask')).toMatchObject({
      last: 'them',
      unread: true,
      from: 'Mere Example <mere@partner.example>',
    })
    expect(byId.get('t_ask')!.text).toContain('needs your signature before Friday')
    expect(byId.get('t_mine')).toMatchObject({ last: 'you', messages: 2 })
    expect(byId.get('t_news')).toMatchObject({ bulk: true })
    expect(byId.get('t_cc')).toMatchObject({ cc: true, files: ['board-pack.pdf'] })
    // The colleague is someone the user has written to.
    expect(byId.get('t_cc')!.sender).toEqual({ replied: 1 })
    for (const row of feed.threads) {
      expect(Object.keys(row)).not.toContain('verdict')
    }
  })

  it('packs a batch under the result budget and says how many remain', () => {
    const fixture = aiTriageFixture(NOW)
    const long = 'A long paragraph about the pilot schedule and budget. '.repeat(20)
    const threads = Array.from({ length: 14 }, (_, index) =>
      fixture.makeThread(`t_bulk_${index}`, `Update ${index}`, 5 + index),
    )
    const messages = threads.map((thread, index) =>
      fixture.makeMessage(`m_bulk_${index}`, thread.id, fixture.people.partner, long, 5 + index),
    )
    const store: MailStore = { ...fixture.store, threads, messages }

    const feed = aiTriageFeed(store, fixture.accountId, { now: NOW, budget: 3700 })
    expect(JSON.stringify(feed).length).toBeLessThanOrEqual(3700)
    expect(feed.returned).toBeGreaterThan(0)
    expect(feed.returned).toBeLessThan(14)
    expect(feed.remaining).toBe(14 - feed.returned)
    expect(feed.threads[0].cut).toBe(true)
  })

  it('shortens a lone long message rather than overflowing', () => {
    const fixture = aiTriageFixture(NOW)
    const thread = fixture.makeThread('t_huge', 'Everything', 5)
    const message = fixture.makeMessage('m_huge', 't_huge', fixture.people.partner, 'word '.repeat(400), 5)
    const store: MailStore = { ...fixture.store, threads: [thread], messages: [message] }

    const feed = aiTriageFeed(store, fixture.accountId, { now: NOW, budget: 700 })
    expect(feed.returned).toBe(1)
    expect(feed.threads[0].cut).toBe(true)
    expect(JSON.stringify(feed).length).toBeLessThanOrEqual(700)
  })
})

describe('recording decisions', () => {
  it('records against the latest message, and a new message reopens the thread', () => {
    const fixture = aiTriageFixture(NOW)
    const applied = record(fixture.store, [
      agentDecision(fixture.store, 't_ask', 'needs_reply', { action: 'Sign the contract.' }),
    ])
    expect(applied.recorded).toEqual([
      { id: 't_ask', subject: 'Contract sign-off', verdict: 'needs_reply' },
    ])
    const store = applied.store
    expect(aiTriageCurrent(store, { id: 't_ask' })).toMatchObject({
      verdict: 'needs_reply',
      action: 'Sign the contract.',
      decidedBy: 'agent',
    })
    expect(untriagedThreads(store, fixture.accountId, 'in:inbox', NOW).map(t => t.id)).not.toContain('t_ask')

    const followUp = fixture.makeMessage('m_ask_2', 't_ask', fixture.people.partner, 'Any news on the signature?', 5)
    const reopened: MailStore = { ...store, messages: [...store.messages, followUp] }
    expect(aiTriageCurrent(reopened, { id: 't_ask' })).toBeNull()
    const row = aiTriageFeed(reopened, fixture.accountId, { now: NOW }).threads.find(item => item.id === 't_ask')
    expect(row).toMatchObject({ before: 'needs_reply', at: followUp.receivedAt })
  })

  it('refuses a stale at, a missing at, a missing reason, a bad verdict and an unknown id', () => {
    const fixture = aiTriageFixture(NOW)
    const good = agentDecision(fixture.store, 't_cc', 'fyi')
    const applied = applyAiTriage(
      fixture.store,
      [
        { ...agentDecision(fixture.store, 't_ask', 'needs_reply'), at: '2026-01-01T00:00:00.000Z' },
        { id: 't_news', verdict: 'noise', reason: 'Bulk.' },
        { ...agentDecision(fixture.store, 't_mine', 'fyi'), reason: '  ' },
        { ...good, id: 't_cc', verdict: 'maybe' },
        { id: 't_nope', at: good.at, verdict: 'fyi', reason: 'x' },
      ],
      { decidedBy: 'agent', now: NOW },
    )
    expect(applied.recorded).toEqual([])
    expect(applied.store).toBe(fixture.store)
    expect(applied.stale).toEqual([{ id: 't_ask', subject: 'Contract sign-off' }])
    expect(applied.unknown).toEqual(['t_nope'])
    expect(applied.invalid.map(item => item.id).sort()).toEqual(['t_cc', 't_mine', 't_news'])
  })

  it('keeps the assistant verdict when the user corrects it, and later batches carry the correction', () => {
    const fixture = aiTriageFixture(NOW)
    const byAgent = record(fixture.store, [agentDecision(fixture.store, 't_news', 'noise')]).store
    const byUser = applyAiTriage(byAgent, [{ id: 't_news', verdict: 'important' }], {
      decidedBy: 'user',
      now: NOW,
    }).store
    expect(aiTriageRecordFor(byUser, 't_news')).toMatchObject({
      verdict: 'important',
      decidedBy: 'user',
      correctedFrom: 'noise',
      reason: 'Reason for t_news.',
    })

    const nextIssue = fixture.makeThread('t_news_2', 'Next week in publishing', 2)
    const nextMessage = fixture.makeMessage('m_news_2', 't_news_2', fixture.people.digest, 'More stories.', 2)
    const later: MailStore = {
      ...byUser,
      threads: [...byUser.threads, nextIssue],
      messages: [...byUser.messages, nextMessage],
    }
    const row = aiTriageFeed(later, fixture.accountId, { now: NOW }).threads.find(item => item.id === 't_news_2')
    expect(row?.sender).toEqual({ marked: 'important' })
  })

  it('clears a decision so the thread is triaged again', () => {
    const fixture = aiTriageFixture(NOW)
    const store = record(fixture.store, [agentDecision(fixture.store, 't_ask', 'needs_reply')]).store
    const cleared = clearAiTriage(store, ['t_ask'])
    expect(aiTriageRecordFor(cleared, 't_ask')).toBeNull()
    expect(clearAiTriage(cleared, ['t_ask'])).toBe(cleared)
  })

  it('writes one ledger line a person can read', () => {
    expect(
      aiTriageSummary([
        { verdict: 'needs_reply' },
        { verdict: 'fyi' },
        { verdict: 'fyi' },
        { verdict: 'noise' },
      ]),
    ).toBe('Triaged 4 threads: 1 needs a reply, 2 FYI, 1 noise.')
  })
})

describe('search', () => {
  it('understands is:triaged, is:untriaged and triage:<verdict>', () => {
    const fixture = aiTriageFixture(NOW)
    const store = record(fixture.store, [
      agentDecision(fixture.store, 't_ask', 'needs_reply'),
      agentDecision(fixture.store, 't_news', 'noise'),
    ]).store
    const total = (query: string) => resolveThreadQuery(store, fixture.accountId, query, NOW).total

    expect(total('in:inbox is:untriaged')).toBe(2)
    expect(total('in:inbox is:triaged')).toBe(2)
    expect(total('triage:needs_reply')).toBe(1)
    expect(total('in:inbox -triage:noise')).toBe(3)
    expect(parseMailQuery('triage:maybe').terms).toEqual([])
  })
})

describe('the report', () => {
  it('groups by verdict, leaves noise out, and marks what was done or reopened', () => {
    const fixture = aiTriageFixture(NOW)
    let store = record(fixture.store, [
      agentDecision(fixture.store, 't_ask', 'needs_reply', { action: 'Sign it.' }),
      agentDecision(fixture.store, 't_cc', 'important'),
      agentDecision(fixture.store, 't_mine', 'fyi'),
      agentDecision(fixture.store, 't_news', 'noise'),
    ]).store
    store = {
      ...store,
      messages: [
        ...store.messages,
        fixture.makeMessage('m_ask_reply', 't_ask', fixture.owner, 'Signed.', -5, { read: true, to: [fixture.people.partner] }),
        fixture.makeMessage('m_cc_2', 't_cc', fixture.people.colleague, 'Updated pack.', -5),
      ],
    }

    const report = aiTriageReport(store, fixture.accountId, { since: parseSince('1d', NOW)! })
    expect(report.counts).toEqual({ needs_reply: 1, important: 1, fyi: 1, noise: 1 })
    expect(report.items.map(item => [item.id, item.verdict])).toEqual([
      ['t_ask', 'needs_reply'],
      ['t_cc', 'important'],
      ['t_mine', 'fyi'],
    ])
    expect(report.items[0]).toMatchObject({ action: 'Sign it.', done: true })
    expect(report.items[1]).toMatchObject({ reopened: true })
    expect(report.nextOffset).toBeUndefined()
  })

  it('pages under the budget', () => {
    const fixture = aiTriageFixture(NOW)
    const threads = Array.from({ length: 10 }, (_, index) =>
      fixture.makeThread(`t_page_${index}`, `Page ${index}`, 5 + index),
    )
    const messages = threads.map((thread, index) =>
      fixture.makeMessage(`m_page_${index}`, thread.id, fixture.people.partner, 'Please confirm.', 5 + index),
    )
    let store: MailStore = { ...fixture.store, threads, messages }
    store = record(
      store,
      threads.map(thread => ({
        ...agentDecision(store, thread.id, 'needs_reply'),
        reason: 'They are waiting on a decision about the pilot budget and the start date. '.repeat(3),
      })),
    ).store

    const since = parseSince('1d', NOW)!
    const first = aiTriageReport(store, fixture.accountId, { since, budget: 1200 })
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(1200)
    expect(first.nextOffset).toBe(first.items.length)
    const seen = [...first.items]
    let offset = first.nextOffset
    while (offset !== undefined) {
      const page = aiTriageReport(store, fixture.accountId, { since, budget: 1200, offset })
      seen.push(...page.items)
      offset = page.nextOffset
    }
    expect(seen.map(item => item.id).sort()).toEqual(threads.map(thread => thread.id).sort())
  })

  it('reads since as a span or a date', () => {
    expect(parseSince('12h', NOW)?.toISOString()).toBe('2026-09-13T20:00:00.000Z')
    expect(parseSince(undefined, NOW)?.toISOString()).toBe('2026-09-13T08:00:00.000Z')
    expect(parseSince('2026-09-10', NOW)?.toISOString()).toBe('2026-09-10T00:00:00.000Z')
    expect(parseSince('yesterday', NOW)).toBeNull()
  })
})

describe('persistence', () => {
  it('keeps well-formed triage records and drops malformed ones', () => {
    const fixture = aiTriageFixture(NOW)
    const store = record(fixture.store, [agentDecision(fixture.store, 't_ask', 'needs_reply')]).store
    const migrated = migratePersistedMailStore({
      ...store,
      aiTriage: [...(store.aiTriage ?? []), { threadId: 'broken' } as never],
    })
    expect(migrated.aiTriage?.map(item => item.threadId)).toEqual(['t_ask'])
  })
})
