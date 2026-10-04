// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { emptyAnnotationsFile, type AnnotationsFile, type MessageIdentity } from '../lib/readingRoom'
const persistence = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }))
vi.mock('../lib/readingRoomPersistence', () => ({ readAnnotationsFile: persistence.read, updateAnnotationsFile: persistence.update, syncContextFile: vi.fn() }))
import { useReadingRoom } from './useReadingRoom'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('rejects failed intent persistence so callers cannot dispatch a draft as saved', async () => {
 const file = emptyAnnotationsFile()
 persistence.read.mockResolvedValue(file)
 persistence.update.mockRejectedValueOnce(new Error('Disk unavailable'))
 let latest!: ReturnType<typeof useReadingRoom>
 function Probe() { latest = useReadingRoom(); return null }
 const root = createRoot(document.createElement('div'))
 const identity: MessageIdentity = { messageId: 'm', threadId: 't', subject: 'Planning', article: 'Source', receivedAt: '2026-10-02', from: { name: 'Sender', email: 'sender@example.test' } }
 try {
  await act(async () => root.render(createElement(Probe)))
  await act(async () => { await expect(latest.setReplyIntent(identity, 'Please call tomorrow.')).rejects.toThrow('Disk unavailable') })
  expect(latest.error).toBe('Disk unavailable')
  expect(latest.file.byMessageId.m.replyIntent).toBe('Please call tomorrow.')
  persistence.update.mockImplementationOnce(async (change: (file: AnnotationsFile) => AnnotationsFile) => change(file))
  await act(async () => { await latest.setReplyIntent(identity, 'Please call tomorrow.') })
  expect(latest.error).toBeNull()
  expect(latest.file.byMessageId.m.replyIntent).toBe('Please call tomorrow.')
 } finally { await act(async () => root.unmount()) }
})
