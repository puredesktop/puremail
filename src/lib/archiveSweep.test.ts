import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../types'
import {
  applySweepOutcomes,
  newSweep,
  packSweepRows,
  SWEEP_RESULT_BUDGET,
  sweepExcerpt,
  sweepMatches,
  sweepProgress,
  takeWalkPage,
} from './archiveSweep'

const message = (over: Partial<MailMessage> = {}): MailMessage =>
  ({
    id: 'm1',
    threadId: 't1',
    from: { name: 'Shop', email: 'billing@shop.example' },
    to: [],
    subject: 'Your order',
    body: 'Thanks for shopping.',
    receivedAt: '2024-03-01T10:00:00.000Z',
    attachments: [],
    read: true,
    ...over,
  }) as MailMessage

const sweep = (over = {}) => newSweep({ name: 'Find things', ...over }, 'agent', new Date('2026-11-02T00:00:00Z'))

describe('what a sweep sets aside', () => {
  it('finds a word in the subject, the body or a file name, as a word or the start of one', () => {
    const asked = sweep({ words: ['Invoice'] })
    expect(sweepMatches(asked, message({ subject: 'Invoices for March' }))).toBe(true)
    expect(sweepMatches(asked, message({ body: 'Your invoice is ready' }))).toBe(true)
    expect(sweepMatches(asked, message({ attachments: [{ id: 'a', name: 'invoice-12.pdf', mimeType: 'application/pdf' }] as MailMessage['attachments'] }))).toBe(true)
    expect(sweepMatches(asked, message({ body: 'We reinvoiced nothing' }))).toBe(false)
  })

  it('finds a sender by address or domain, and asks for nothing when given nothing', () => {
    expect(sweepMatches(sweep({ senders: ['shop.example'] }), message())).toBe(true)
    expect(sweepMatches(sweep({ senders: ['other.example'] }), message())).toBe(false)
    expect(sweepMatches(sweep(), message())).toBe(true)
  })

  it('leaves out drafts, what is excluded, dates outside the range, and bulk mail with no files when asked', () => {
    expect(sweepMatches(sweep(), message({ isDraft: true }))).toBe(false)
    expect(sweepMatches(sweep({ words: ['order'], exclude: ['shop.example'] }), message())).toBe(false)
    expect(sweepMatches(sweep({ since: '2025-01-01' }), message())).toBe(false)
    expect(sweepMatches(sweep({ before: '2024-01-01' }), message())).toBe(false)
    expect(sweepMatches(sweep({ skipBulk: true }), message({ listUnsubscribe: '<x>' }))).toBe(false)
    expect(sweepMatches(sweep({ skipBulk: true }), message({ listUnsubscribe: '<x>', attachments: [{ id: 'a', name: 'a.pdf' }] as MailMessage['attachments'] }))).toBe(true)
  })
})

describe('excerpts and batches', () => {
  it('keeps the start and the places the words appear, and stays within the cap', () => {
    const text = `${'Opening words '.repeat(20)}${'filler '.repeat(200)}Total paid 41.50 USD${' more'.repeat(200)}`
    const excerpt = sweepExcerpt(text, ['total'], 300)
    expect(excerpt.cut).toBe(true)
    expect(excerpt.text.length).toBeLessThanOrEqual(300)
    expect(excerpt.text.startsWith('Opening words')).toBe(true)
    expect(excerpt.text).toContain('Total paid 41.50 USD')
  })

  it('packs rows to one tool result, and always returns at least one', () => {
    const row = (id: string, size: number) => ({ id, at: '', subject: '', from: '', text: 'x'.repeat(size) })
    const packed = packSweepRows([row('a', 1500), row('b', 1500), row('c', 1500)])
    expect(packed.map(item => item.id)).toEqual(['a', 'b'])
    expect(JSON.stringify(packed).length).toBeLessThan(SWEEP_RESULT_BUDGET + 100)
    expect(packSweepRows([row('big', 9000)])).toHaveLength(1)
  })
})

describe('keeping its place', () => {
  const page = (ids: string[], from: unknown, cursor: unknown) => ({
    from: from as null,
    cursor: cursor as null,
    items: ids.map(id => ({ id, message: message({ id, messageIdHeader: `<${id}@x>` }) })),
  })

  it('counts each message once, moves its place on, and finishes on the last page', () => {
    const asked = sweep()
    const one = takeWalkPage(asked, page(['a', 'b'], null, { folder: 'All', beforeUid: 5 })).sweep
    expect(one.scanned).toBe(2)
    expect(one.queue.map(item => item.id)).toEqual(['a', 'b'])
    expect(one.finished).toBe(false)
    const two = takeWalkPage(one, page(['c'], { folder: 'All', beforeUid: 5 }, null)).sweep
    expect(two.scanned).toBe(3)
    expect(two.finished).toBe(true)
  })

  it('counts a copy in another folder once', () => {
    const asked = sweep()
    const first = takeWalkPage(asked, page(['a'], null, { folder: 'Inbox', beforeUid: 2 })).sweep
    const copy = takeWalkPage(first, {
      from: { folder: 'Inbox', beforeUid: 2 },
      cursor: null,
      items: [{ id: 'other-folder', message: message({ id: 'other-folder', messageIdHeader: '<a@x>' }) }],
    }).sweep
    expect(copy.scanned).toBe(1)
    expect(copy.queue).toHaveLength(1)
  })

  it('ignores a page fetched from a place another copy has already moved past', () => {
    const asked = sweep()
    const moved = takeWalkPage(asked, page(['a'], null, { folder: 'All', beforeUid: 5 })).sweep
    const late = takeWalkPage(moved, page(['a'], null, { folder: 'All', beforeUid: 5 }))
    expect(late.sweep).toBe(moved)
    expect(late.added).toEqual([])
  })
})

describe('decisions', () => {
  const waiting = () => takeWalkPage(sweep(), {
    from: null,
    cursor: null,
    items: [{ id: 'a', message: message({ id: 'a' }) }, { id: 'b', message: message({ id: 'b' }) }],
  }).sweep

  it('records keeps with their files and skips, and reports an id that is not waiting', () => {
    const applied = applySweepOutcomes(waiting(), [
      { id: 'a', keep: true, note: 'A receipt', files: ['/w/Mail/a.pdf'] },
      { id: 'b', keep: false },
      { id: 'zzz', keep: false },
    ], 'agent')
    expect(applied.sweep.queue).toEqual([])
    expect(applied.sweep.kept.map(item => [item.id, item.files])).toEqual([['a', ['/w/Mail/a.pdf']]])
    expect(applied.sweep.skipped).toBe(1)
    expect(applied.unknown).toEqual(['zzz'])
    expect(sweepProgress(applied.sweep).status).toBe('done')
  })

  it('brings a message back when its file failed, then keeps it with the reason rather than for ever', () => {
    const failed = { id: 'a', keep: true, files: [], saveFailed: 'server busy' }
    const once = applySweepOutcomes(waiting(), [failed], 'agent')
    expect(once.retry).toEqual(['a'])
    expect(once.sweep.queue.some(item => item.id === 'a')).toBe(true)
    const twice = applySweepOutcomes(once.sweep, [failed], 'agent')
    expect(twice.retry).toEqual([])
    expect(twice.sweep.kept[0]?.saveFailed).toBe('server busy')
  })
})
