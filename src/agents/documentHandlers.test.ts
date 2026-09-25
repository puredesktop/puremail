import { describe, expect, it } from 'vitest'
import { demoMailStoreForNow } from '../lib/mailModel'
import { bytesToBase64 } from '../lib/mailAttachments'
import type { Attachment, MailMessage, MailStore } from '../types'
import { AgentMailToolError, type MailAgentToolContext } from './catalog'
import { saveAttachmentsHandler, saveMessageAsPdfHandler } from './documentHandlers'
import { composeMessageHandler } from './handlers'

const NOW = new Date('2026-07-24T12:00:00.000Z')

const file = (name: string, mimeType: string, text: string, extra: Partial<Attachment> = {}): Attachment => ({
  id: `att_${name}`,
  name,
  mimeType,
  sizeLabel: `${text.length} B`,
  size: text.length,
  content: `data:${mimeType};base64,${btoa(text)}`,
  ...extra,
})

const remote = (name: string, mimeType: string, size: number): Attachment => ({
  id: `att_remote_${name}`,
  name,
  mimeType,
  sizeLabel: `${size} B`,
  size,
  remote: { provider: 'gmail', messageId: 'g1', attachmentId: name },
})

function withThread(store: MailStore): { store: MailStore; threadId: string } {
  const thread = store.threads[0]
  const base = {
    threadId: thread.id,
    from: { name: 'Riley Example', email: 'riley@publisher.example' },
    to: [{ name: 'User', email: 'alex@business.example' }],
    subject: 'Contract and schedule',
    read: true,
  }
  const messages: MailMessage[] = [
    {
      ...base,
      id: 'msg_old',
      body: 'First draft attached.',
      receivedAt: '2026-07-20T09:00:00.000Z',
      attachments: [file('contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'v1')],
    },
    {
      ...base,
      id: 'msg_new',
      body: 'Updated files attached.',
      bodyHtml: '<p>Updated files <b>attached</b>.</p><script>alert(1)</script>',
      receivedAt: '2026-07-22T09:00:00.000Z',
      attachments: [
        file('contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'v1'),
        remote('schedule.pdf', 'application/pdf', 5),
        file('rights.xml', 'application/xml', '<rights/>'),
        file('image001.png', 'image/png', 'png'),
      ],
    },
  ]
  return {
    threadId: thread.id,
    store: {
      ...store,
      messages: [...store.messages.filter(message => message.threadId !== thread.id), ...messages],
    },
  }
}

function makeContext(overrides: Partial<MailAgentToolContext> = {}) {
  const { store, threadId } = withThread(demoMailStoreForNow(NOW))
  const writes: Array<{ path: string; text: string }> = []
  const operations: string[] = []
  const context: MailAgentToolContext = {
    store,
    accountId: store.accounts[0].id,
    now: NOW,
    currentQuery: 'in:Inbox',
    selectedThread: null,
    showQuery: () => undefined,
    setStore: updater => {
      context.store = updater(context.store)
    },
    applyAction: () => undefined,
    listMailOperations: async () => [],
    addTaskForThread: () => undefined,
    requestDraftForThread: async () => {
      throw new Error('not used')
    },
    resolveAttachment: async (_message, attachment) => ({
      ...attachment,
      content: `data:${attachment.mimeType};base64,${btoa('%PDF-')}`,
    }),
    writeBinaryFile: async (path, base64) => {
      writes.push({ path, text: atob(base64) })
    },
    listFolderNames: async () => ['schedule.pdf'],
    recordOperation: (_kind, summary) => operations.push(summary),
    saveFolder: async () => '/Users/developer/Pure/Mail/',
    noteAgentSearch: () => undefined,
    ...overrides,
  }
  return { context, threadId, writes, operations }
}

const parse = (result: { content: string }): any => JSON.parse(result.content)

describe('saveAttachments', () => {
  it('saves the documents once each, fetching what is remote and never overwriting', async () => {
    const { context, threadId, writes, operations } = makeContext()
    const result = parse(
      await saveAttachmentsHandler(context, { threadId }),
    )
    expect(result.saved.map((item: any) => item.path)).toEqual([
      '/Users/developer/Pure/Mail/contract.docx',
      // schedule.pdf is already in the folder, so this one gets a new name.
      '/Users/developer/Pure/Mail/schedule (1).pdf',
      '/Users/developer/Pure/Mail/rights.xml',
    ])
    // The signature image is skipped, and said so.
    expect(result.skipped).toEqual([
      expect.objectContaining({ name: 'image001.png', type: 'Image' }),
    ])
    // The forwarded contract is written once, from the newest message.
    expect(writes.filter(item => item.path.endsWith('contract.docx'))).toHaveLength(1)
    expect(writes.find(item => item.path.endsWith('.pdf'))?.text).toBe('%PDF-')
    expect(result.saved[0]).toMatchObject({ type: 'Doc', from: 'riley@publisher.example' })
    expect(operations[0]).toMatch(/Saved 3 attachments/)
  })

  it('saves exactly the named files, images included', async () => {
    const { context, threadId, writes } = makeContext()
    const result = parse(
      await saveAttachmentsHandler(context, {
        threadId,
        names: ['image001.png', 'RIGHTS.XML'],
      }),
    )
    expect(result.saved.map((item: any) => item.name)).toEqual(['rights.xml', 'image001.png'])
    expect(result.skipped).toBeUndefined()
    expect(writes).toHaveLength(2)
  })

  it('can take one message only', async () => {
    const { context, threadId } = makeContext()
    const result = parse(
      await saveAttachmentsHandler(context, { threadId, messageId: 'msg_old' }),
    )
    expect(result.saved.map((item: any) => item.name)).toEqual(['contract.docx'])
  })

  it('reports a file it could not fetch without failing the rest', async () => {
    const { context, threadId } = makeContext({ resolveAttachment: async () => null })
    const result = parse(await saveAttachmentsHandler(context, { threadId }))
    expect(result.saved).toHaveLength(2)
    expect(result.failed).toEqual([
      expect.objectContaining({ name: 'schedule.pdf' }),
    ])
  })

  it('saves only into the workspace, and says so when there is none', async () => {
    const { context, threadId, writes } = makeContext({
      saveFolder: async () => {
        throw new Error('no workspace is set up')
      },
    })
    await expect(saveAttachmentsHandler(context, { threadId })).rejects.toThrow(/No workspace folder/)
    expect(writes).toEqual([])
  })

  it('teaches the caller when a name is wrong', async () => {
    const { context, threadId } = makeContext()
    await expect(
      saveAttachmentsHandler(context, { threadId, names: ['budget.xlsx'] }),
    ).rejects.toThrow(/"contract.docx"/)
    await expect(
      saveAttachmentsHandler(context, { threadId: 'nope' }),
    ).rejects.toThrow(AgentMailToolError)
  })
})

describe('saveMessageAsPdf', () => {
  it('saves the thread through the PDF path and returns where it went', async () => {
    const calls: Array<{ subject: string; messages: MailMessage[]; folder: string }> = []
    const { context, threadId, operations } = makeContext({
      saveMailPdf: async input => {
        calls.push(input)
        return { path: `${input.folder}/Contract and schedule.pdf` }
      },
    })
    const result = parse(await saveMessageAsPdfHandler(context, { threadId }))
    expect(result.path).toBe('/Users/developer/Pure/Mail/Contract and schedule.pdf')
    expect(calls[0].folder).toBe('/Users/developer/Pure/Mail')
    expect(calls[0].messages.map(message => message.id)).toEqual(['msg_old', 'msg_new'])
    expect(operations[0]).toMatch(/as a PDF/)

    const one = parse(
      await saveMessageAsPdfHandler(context, { threadId, messageId: 'msg_new' }),
    )
    expect(one.messages).toBe(1)
  })
})

describe('composeMessage with attachments', () => {
  const read = (text: string) => ({ base64: bytesToBase64(new TextEncoder().encode(text)), mimeType: 'application/pdf' })

  it('drafts a new message with the files attached in one call', async () => {
    const set: Array<{ draftId: string; names: string[] }> = []
    const { context } = makeContext({
      composeNewMessage: () => ({ draftId: 'draft_new', threadId: 'thread_new' }),
      readAttachmentFile: async () => read('%PDF-1.7'),
      setDraftAttachments: (draftId, attachments) => {
        set.push({ draftId, names: attachments.map(item => item.name) })
        return { ok: true }
      },
    })
    const result = parse(
      await composeMessageHandler(context, {
        to: 'riley@publisher.example',
        subject: 'Signed contract',
        body: 'Attached.',
        attachments: ['/Users/developer/Pure/contract.pdf'],
      }),
    )
    expect(set).toEqual([{ draftId: 'draft_new', names: ['contract.pdf'] }])
    expect(result.attachments[0].name).toBe('contract.pdf')
  })

  it('refuses an unreadable or relative file before any draft exists', async () => {
    let composed = 0
    const { context } = makeContext({
      composeNewMessage: () => {
        composed += 1
        return { draftId: 'd', threadId: 't' }
      },
      readAttachmentFile: async () => {
        throw new Error('ENOENT')
      },
      setDraftAttachments: () => ({ ok: true }),
    })
    const args = { to: 'a@b.c', subject: 's', body: 'b' }
    await expect(composeMessageHandler(context, { ...args, attachments: ['/missing.pdf'] })).rejects.toThrow(
      /Could not read/,
    )
    await expect(composeMessageHandler(context, { ...args, attachments: ['relative.pdf'] })).rejects.toThrow(
      /absolute/,
    )
    expect(composed).toBe(0)
  })
})
