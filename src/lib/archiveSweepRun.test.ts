// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage, MailWalkCursor } from '../types'
import { newSweep } from './archiveSweep'

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: { request: async (_name: string, work: () => Promise<unknown>) => work() },
})

const files = new Map<string, unknown>()
vi.mock('../bridge/platformBridge', () => ({
  readPlatformStorageJson: async ({ fileName }: { fileName: string }) => ({ value: files.get(fileName) ?? null, version: undefined }),
  writePlatformStorageJson: async ({ fileName, value }: { fileName: string; value: unknown }) => {
    files.set(fileName, JSON.parse(JSON.stringify(value)))
    return {}
  },
}))
const { decideSweepBatch, nextSweepBatch } = await import('./archiveSweepRun')
const { updateSweepFile, readSweepFile } = await import('./archiveSweepPersistence')

const message = (id: string, subject: string): MailMessage =>
  ({ id, threadId: `t_${id}`, messageIdHeader: `<${id}@x>`, from: { name: '', email: 'a@shop.example' }, to: [], subject, body: subject, receivedAt: '2024-01-01T00:00:00.000Z', attachments: [], read: true }) as MailMessage

/** A mailbox of `count` messages, every fifth one a receipt, read newest first. */
function mailbox(count: number) {
  const all = Array.from({ length: count }, (_, index) => {
    const id = `m${count - index}`
    return { id, message: message(id, (count - index) % 5 === 0 ? 'Your receipt' : 'Hello') }
  })
  const walks: Array<MailWalkCursor | null> = []
  return {
    walks,
    provider: {
      walkMailbox: async (cursor: MailWalkCursor | null, options: { pageSize: number }) => {
        walks.push(cursor)
        const from = typeof cursor?.at === 'number' ? cursor.at : 0
        const items = all.slice(from, from + options.pageSize)
        const next = from + items.length
        return { items, cursor: next < all.length ? { at: next } : null, ...(!cursor ? { approxTotal: count } : {}) }
      },
      readWalkedMessage: async (id: string) => {
        const found = all.find(item => item.id === id)
        return found ? { message: found.message } : null
      },
    },
  }
}

async function started(words: string[]) {
  const sweep = newSweep({ name: 'Receipts', words }, 'agent')
  await updateSweepFile(file => ({ file: { ...file, sweeps: [...file.sweeps, sweep] }, result: null }))
  return sweep.id
}

beforeEach(() => files.clear())

describe('walking a mailbox', () => {
  it('reads until a batch is full, and a later call carries on from where it stopped', async () => {
    const box = mailbox(200)
    const id = await started(['receipt'])
    const first = await nextSweepBatch(box.provider, id, { pageSize: 10 })
    expect(first.rows.length).toBeGreaterThan(0)
    expect(first.rows.every(row => row.subject === 'Your receipt')).toBe(true)
    expect(first.sweep.scanned).toBe(40)
    expect(first.sweep.approxTotal).toBe(200)
    expect(first.sweep.finished).toBe(false)
    await decideSweepBatch(id, first.rows.map(row => ({ id: row.id, keep: true })), 'agent', async () => ({ files: [] }))
    const second = await nextSweepBatch(box.provider, id, { pageSize: 10 })
    expect(second.sweep.scanned).toBe(80)
    expect(second.rows.map(row => row.id)).not.toContain(first.rows[0]!.id)
  })

  it('goes through the whole mailbox once, however it is interrupted, and ends', async () => {
    const box = mailbox(120)
    const id = await started(['receipt'])
    const kept = new Set<string>()
    for (let call = 0; call < 40; call += 1) {
      const batch = await nextSweepBatch(box.provider, id, { pageSize: 15 })
      for (const row of batch.rows) {
        expect(kept.has(row.id)).toBe(false)
        kept.add(row.id)
      }
      if (batch.rows.length) {
        await decideSweepBatch(id, batch.rows.map(row => ({ id: row.id, keep: true })), 'agent', async () => ({ files: ['/w/kept.pdf'] }))
      } else if (batch.sweep.finished) break
    }
    const { sweeps } = await readSweepFile()
    expect(sweeps[0]!.scanned).toBe(120)
    expect(sweeps[0]!.finished).toBe(true)
    expect(sweeps[0]!.queue).toEqual([])
    expect(kept.size).toBe(24)
    expect(sweeps[0]!.kept[0]!.files[0]).toBe('/w/kept.pdf')
  })

  it('says what is still reading rather than ending when a call runs out of time', async () => {
    const box = mailbox(100)
    const id = await started(['nothing-matches-this'])
    const batch = await nextSweepBatch(box.provider, id, { pageSize: 10, budgetMs: 0 })
    expect(batch.rows).toEqual([])
    expect(batch.sweep.finished).toBe(false)
  })

  it('drops a message that has left the server instead of waiting on it for ever', async () => {
    const box = mailbox(10)
    const id = await started(['receipt'])
    await nextSweepBatch(box.provider, id, { pageSize: 10 })
    box.provider.readWalkedMessage = async () => null
    const after = await nextSweepBatch(box.provider, id, { pageSize: 10 })
    expect(after.gone.length).toBeGreaterThan(0)
    expect(after.sweep.queue).toEqual([])
  })

  it('does not mark a message decided when its file could not be saved', async () => {
    const box = mailbox(10)
    const id = await started(['receipt'])
    const batch = await nextSweepBatch(box.provider, id, { pageSize: 10 })
    const row = batch.rows[0]!
    const applied = await decideSweepBatch(id, [{ id: row.id, keep: true, save: 'auto' }], 'agent', async () => {
      throw new Error('server busy')
    })
    expect(applied.retry).toEqual([row.id])
    expect(applied.sweep.queue.some(item => item.id === row.id)).toBe(true)
    expect(applied.sweep.kept).toEqual([])
  })
})
