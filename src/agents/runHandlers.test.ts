import { describe, expect, it } from 'vitest'
import { demoMailStoreForNow } from '../test/mailFixtures'
import { sendDraft } from '../lib/mailModel'
import { finalizeRunDraftForSend, noteTextFromBodyHtml } from '../lib/mailRuns'
import { AgentMailToolError, type MailAgentToolContext } from './catalog'
import { getMailContextHandler } from './handlers'
import {
  addDraftsToRunHandler,
  archiveRunHandler,
  createRunFromDraftsHandler,
  createRunHandler,
  getRunHandler,
  getRunRepliesHandler,
  insertRunNoteSlotHandler,
  listRunsHandler,
  pauseRunHandler,
  previewRunItemHandler,
  renderRunHandler,
  resumeRunHandler,
  sendRunItemHandler,
  setRunFieldMapHandler,
  setRunNoteHandler,
  setRunRecipientsHandler,
  setRunTemplateHandler,
  skipRunItemHandler,
} from './runHandlers'
import type { Draft, MailMessage, MailStore, MailThread } from '../types'

const NOW = new Date('2026-09-02T12:00:00.000Z')

const LIST = `sarah@design.example, Sarah Example
Tom Example <tom@vendor.example>
mere@paper.example, Mere Example
broken-line
sarah@design.example, Sarah Again`

interface TestContext extends MailAgentToolContext {
  sent: Draft[]
  opened: string[]
  files: Record<string, string>
}

function makeContext(overrides: Partial<MailAgentToolContext> = {}): TestContext {
  const store = demoMailStoreForNow(NOW)
  const sent: Draft[] = []
  const opened: string[] = []
  const files: Record<string, string> = {}
  const context: TestContext = {
    store,
    accountId: store.accounts[0]!.id,
    now: NOW,
    currentQuery: 'in:Inbox',
    selectedThread: null,
    showQuery: () => {},
    setStore: (updater: (store: MailStore) => MailStore) => {
      context.store = updater(context.store)
    },
    applyAction: () => {},
    listMailOperations: async () => [],
    addTaskForThread: () => {},
    requestDraftForThread: async () => { throw new Error('n/a') },
    noteAgentSearch: () => {},
    readTextFile: async (path: string) => {
      const content = files[path]
      if (content === undefined) throw new Error('ENOENT')
      return content
    },
    // A synchronous stand-in for the shell's send: finalize, record, commit.
    sendStoreDraft: (draft, options) => {
      const finalized = finalizeRunDraftForSend(draft)
      sent.push(finalized)
      const now = NOW.toISOString()
      const sentMessageId = `msg_sent_${finalized.id}_${now.replace(/[^0-9]/g, '')}`
      context.store = sendDraft(
        { ...context.store, drafts: context.store.drafts.map(item => (item.id === finalized.id ? finalized : item)) },
        finalized.id,
        now,
      )
      options.onCommitted?.(sentMessageId)
      return { ok: true, pendingId: `pending_${finalized.id}`, undoSeconds: 0 }
    },
    openRun: runId => {
      opened.push(runId)
    },
    sent,
    opened,
    files,
    ...overrides,
  }
  return context
}

function parse(result: { content: string }): any {
  return JSON.parse(result.content)
}

async function setUpRenderedRun(context: TestContext): Promise<string> {
  const created = parse(
    await createRunHandler(context, {
      name: 'October workshop invite',
      subject: 'Workshop dates for {{first_name}}',
      body: 'Hi {{first_name}},\n\nTwo sessions this October.\n\n{{note}}\n\nAdam',
      recipients: LIST,
    }),
  )
  parse(renderRunHandler(context, { runId: created.runId }))
  return created.runId
}

describe('run tools: setup', () => {
  it('createRun makes a template draft and a run in setup, validating the pasted list', async () => {
    const context = makeContext()
    const payload = parse(
      await createRunHandler(context, {
        name: 'October workshop invite',
        body: 'Hi {{first_name}}, {{note}}',
        recipients: LIST,
      }),
    )
    expect(payload.status).toBe('setup')
    expect(payload.templateDraftId).toMatch(/^draft_run_template_/)
    expect(payload.recipients).toMatchObject({ rows: 5, valid: 3, invalid: 1, duplicates: 1 })
    expect(payload.fieldMap).toEqual({
      email: { column: 'email' },
      first_name: { column: 'name', transform: 'first-word' },
      name: { column: 'name' },
    })
    expect(payload.availableTokens).toContain('note')
    expect(payload.conventions).toMatch(/\{\{note\}\}/)
    const template = context.store.drafts.find(draft => draft.id === payload.templateDraftId)!
    expect(template.draftKind).toBe('run_template')
    expect(template.runId).toBe(payload.runId)
    expect(template.bodyHtml).toContain('{{first_name}}')
    // The run shows up in the mail context, so "continue the run" resolves.
    const mailContext = parse(getMailContextHandler(context))
    expect(mailContext.activeRuns.map((run: { runId: string }) => run.runId)).toEqual([payload.runId])
  })

  it('createRun reads a CSV or a .sheets package by absolute path, and refuses relative ones', async () => {
    const context = makeContext()
    context.files['/Users/developer/list.csv'] = 'Email,Name\nsarah@design.example,Sarah Example\ntom@vendor.example,Tom Example\n'
    const csv = parse(await createRunHandler(context, { name: 'csv', recipientsPath: '/Users/developer/list.csv' }))
    expect(csv.recipients).toMatchObject({ rows: 2, valid: 2, columns: ['Email', 'Name'] })
    context.files['/Users/developer/Workshop list.sheets/workbook.json'] = JSON.stringify({
      app: 'PureSheets',
      version: 1,
      workbook: {
        activeSheetId: 's1',
        sheets: [{ id: 's1', name: 'List', cells: { A1: { value: 'Email' }, B1: { value: 'Name' }, A2: { value: 'mere@paper.example' }, B2: { value: 'Mere Example' } } }],
      },
    })
    const sheet = parse(await createRunHandler(context, { name: 'sheet', recipientsPath: '/Users/developer/Workshop list.sheets' }))
    expect(sheet.recipients).toMatchObject({ rows: 1, valid: 1 })
    expect(context.store.runs!.find(run => run.id === sheet.runId)!.recipients!.source).toMatchObject({ kind: 'sheet', label: 'Workshop list.sheets' })
    await expect(createRunHandler(context, { name: 'x', recipientsPath: 'list.csv' })).rejects.toThrow(/absolute/)
    await expect(createRunHandler(context, { name: 'x', recipientsPath: '/Users/developer/missing.csv' })).rejects.toThrow(/Could not read/)
  })

  it('setRunRecipients / setRunFieldMap / setRunTemplate / insertRunNoteSlot shape a run step by step', async () => {
    const context = makeContext()
    const created = parse(await createRunHandler(context, { name: 'Stepwise' }))
    const runId = created.runId
    expect(() => renderRunHandler(context, { runId })).toThrow(/no recipient list/)
    const recipients = parse(
      await setRunRecipientsHandler(context, { runId, recipients: 'E-mail,Full name\nsarah@design.example,Sarah Example' }),
    )
    // Pasted text with a header line is still one-address-per-line parsing:
    // the header has no address and is reported invalid, not silently used.
    expect(recipients.rows).toBe(2)
    expect(recipients.invalid).toHaveLength(1)
    const mapped = parse(
      setRunFieldMapHandler(context, { runId, fieldMap: { first_name: { column: 'name', transform: 'first-word' } } }),
    )
    expect(mapped.fieldMap.first_name).toEqual({ column: 'name', transform: 'first-word' })
    expect(() => setRunFieldMapHandler(context, { runId, fieldMap: { email: 'Nope' } })).toThrow(/not in the list/)
    const templated = parse(
      setRunTemplateHandler(context, { runId, subject: 'Hello {{first_name}}', body: 'Hi {{first_name}},\n\nSee you there.\n\nAdam' }),
    )
    expect(templated.templateDraftId).toBe(created.templateDraftId)
    expect(templated.tokensUsed).toEqual(['first_name'])
    expect(templated.noteSlot).toBe(false)
    const slot = parse(insertRunNoteSlotHandler(context, { runId }))
    expect(slot.changed).toBe(true)
    // The reply says where the slot went, not the whole template body.
    expect(slot).not.toHaveProperty('body')
    expect(slot).toMatchObject({ placement: 'after-first-paragraph', slotAfter: 'Hi {{first_name}},' })
    expect(context.store.drafts.find(draft => draft.id === slot.templateDraftId)?.body).toBe(
      'Hi {{first_name}},\n\n{{note}}\n\nSee you there.\n\nAdam',
    )
    expect(parse(insertRunNoteSlotHandler(context, { runId })).changed).toBe(false)
    const preview = parse(previewRunItemHandler(context, { runId }))
    expect(preview).toMatchObject({ row: 2, to: { name: 'Sarah Example', email: 'sarah@design.example' }, subject: 'Hello Sarah', noteSlot: true })
    expect(preview.body).toBe('Hi Sarah,\n\n\n\nSee you there.\n\nAdam')
    expect(context.store.drafts.filter(draft => draft.draftKind === 'run')).toHaveLength(0)
    const rendered = parse(renderRunHandler(context, { runId }))
    expect(rendered).toMatchObject({ created: 1, updated: 0, items: 1, status: 'ready' })
  })

  it('createRunFromDrafts inherits existing drafts and addDraftsToRun appends more', () => {
    const context = makeContext()
    const unsent = context.store.drafts.filter(draft => !draft.sentAt).map(draft => draft.id)
    const payload = parse(createRunFromDraftsHandler(context, { draftIds: [unsent[0]!, 'draft_nope'] }))
    expect(payload.status).toBe('ready')
    expect(payload.items.map((item: { draftId: string }) => item.draftId)).toEqual([unsent[0]])
    expect(payload.skipped).toEqual(['draft_nope'])
    expect(() => createRunFromDraftsHandler(context, { draftIds: ['draft_nope'] })).toThrow(/None of those drafts/)
    expect(() => createRunFromDraftsHandler(context, { draftIds: [] })).toThrow(AgentMailToolError)
    if (unsent.length > 1) {
      const added = parse(addDraftsToRunHandler(context, { runId: payload.runId, draftIds: unsent.slice(1) }))
      expect(added.added).toEqual(unsent.slice(1))
    }
    expect(() => addDraftsToRunHandler(context, { runId: payload.runId, draftIds: [unsent[0]!] })).toThrow(/already in the run/)
  })
})

describe('run tools: the loop', () => {
  it('renderRun creates the drafts; getRun reads items, cursor and validation', async () => {
    const context = makeContext()
    const runId = await setUpRenderedRun(context)
    const run = parse(getRunHandler(context, { runId }))
    expect(run.status).toBe('ready')
    expect(run.items.map((item: { row: number; status: string; label: string }) => [item.row, item.status, item.label])).toEqual([
      [1, 'pending', 'Sarah Example'],
      [2, 'pending', 'Tom Example'],
      [3, 'pending', 'Mere Example'],
    ])
    expect(run.invalidRows).toEqual([{ row: 4, reason: '"broken-line" is not a valid email address.' }])
    expect(run.duplicateRows).toEqual([{ row: 5, duplicateOf: 1, email: 'sarah@design.example' }])
    expect(run.template.tokensUsed).toEqual(['first_name', 'note'])
    expect(run.noteSlot).toBe(true)
    expect(run.note).toMatch(/never bulk-sends/)
    // Re-render is idempotent.
    expect(parse(renderRunHandler(context, { runId }))).toMatchObject({ created: 0, updated: 3 })
  })

  it('setRunNote writes into the slot; sendRunItem sends ONE item and advances; skip/pause/resume/archive', async () => {
    const context = makeContext()
    const runId = await setUpRenderedRun(context)
    const noted = parse(setRunNoteHandler(context, { runId, row: 3, note: 'Thanks for the rag' }))
    expect(noted.note).toBe('Thanks for the rag')
    const mereDraft = context.store.drafts.find(draft => draft.id === noted.draftId)!
    expect(noteTextFromBodyHtml(mereDraft.bodyHtml)).toBe('Thanks for the rag')

    // Current item is row 1 (Sarah): send it.
    const sent = parse(sendRunItemHandler(context, { runId }))
    expect(sent.to).toEqual(['sarah@design.example'])
    expect(sent.status).toBe('sent')
    expect(sent.remaining).toBe(2)
    expect(context.sent).toHaveLength(1)
    // The empty note slot was stripped from what left.
    expect(context.sent[0]!.bodyHtml).not.toContain('data-run-note')
    let run = parse(getRunHandler(context, { runId }))
    expect(run.items[0]).toMatchObject({ status: 'sent', sentAt: NOW.toISOString() })
    expect(run.items[0].sendPending).toBeUndefined()
    expect(run.cursor).toBe(2)
    expect(run.status).toBe('running')
    // Sending again by draftId refuses a sent item.
    expect(() => sendRunItemHandler(context, { runId, draftId: run.items[0].draftId })).toThrow(/already sent/)

    // Skip Tom, then the note-bearing Mere is current: send her by row.
    const skipped = parse(skipRunItemHandler(context, { runId, reason: 'Ask later' }))
    expect(skipped.label).toBe('Tom Example')
    run = parse(getRunHandler(context, { runId }))
    expect(run.cursor).toBe(3)
    const sentMere = parse(sendRunItemHandler(context, { runId, row: 3 }))
    expect(sentMere.to).toEqual(['mere@paper.example'])
    expect(context.sent[1]!.bodyHtml).toContain('Thanks for the rag')
    expect(context.sent[1]!.bodyHtml).not.toContain('data-run-note')
    run = parse(getRunHandler(context, { runId }))
    expect(run.status).toBe('done')
    expect(run.progress).toMatchObject({ sent: 2, skipped: 1, pending: 0 })

    // Archive only when done; pause/resume on a done run are honest.
    expect(parse(archiveRunHandler(context, { runId })).archived).toBe(true)
    expect(parse(listRunsHandler(context, {})).total).toBe(0)
    expect(parse(listRunsHandler(context, { includeArchived: true })).total).toBe(1)
  })

  it('pauseRun keeps the place and resumeRun opens the run for the user', async () => {
    const context = makeContext()
    const runId = await setUpRenderedRun(context)
    parse(sendRunItemHandler(context, { runId }))
    const paused = parse(pauseRunHandler(context, { runId }))
    expect(paused.status).toBe('paused')
    const resumed = parse(resumeRunHandler(context, { runId }))
    expect(resumed.status).toBe('running')
    expect(resumed.cursor).toBe(2)
    expect(resumed.currentItem.label).toBe('Tom Example')
    expect(context.opened).toEqual([runId])
    expect(() => archiveRunHandler(context, { runId })).toThrow(/not done/)
  })

  it('refuses what it cannot do honestly: unknown runs, missing drafts, no slot, no email column', async () => {
    const context = makeContext()
    expect(() => getRunHandler(context, { runId: 'run_nope' })).toThrow(/No run/)
    const created = parse(await createRunHandler(context, { name: 'x', body: 'Hi {{first_name}}', recipients: 'Only,Name\n' }))
    // A pasted list whose only line is a header: no valid addresses.
    expect(() => renderRunHandler(context, { runId: created.runId })).toThrow(/No valid rows/)
    const runId = await setUpRenderedRun(context)
    const run = parse(getRunHandler(context, { runId }))
    // Delete Tom's draft outside the run: sendRunItem says so.
    context.store = { ...context.store, drafts: context.store.drafts.filter(draft => draft.id !== run.items[1].draftId) }
    expect(() => sendRunItemHandler(context, { runId, row: 2 })).toThrow(/no longer exists/)
    expect(parse(getRunHandler(context, { runId })).items[1].status).toBe('missing')
    // A draft without a slot cannot take a note.
    const noSlot = parse(createRunFromDraftsHandler(context, { draftIds: context.store.drafts.filter(d => !d.sentAt && d.draftKind !== 'run' && d.draftKind !== 'run_template').map(d => d.id) }))
    expect(() => setRunNoteHandler(context, { runId: noSlot.runId, note: 'hi' })).toThrow(/no \{\{note\}\} slot/)
    // Without a send path, sendRunItem is unavailable rather than pretending.
    const offline = makeContext({ sendStoreDraft: undefined })
    const offlineRun = await setUpRenderedRun(offline)
    expect(() => sendRunItemHandler(offline, { runId: offlineRun })).toThrow(/unavailable/)
  })

  it('keeps setRunRecipients and renderRun replies small on a long list with many bad rows', async () => {
    const context = makeContext()
    const created = parse(await createRunHandler(context, { name: 'Big list', subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}' }))
    const runId = created.runId
    const lines = [
      ...Array.from({ length: 500 }, (_, index) => `person${index}@list.example, Person ${index}`),
      ...Array.from({ length: 300 }, (_, index) => `not-an-address-${index}`),
      ...Array.from({ length: 100 }, (_, index) => `person${index}@list.example, Again ${index}`),
    ]
    const recipientsResult = setRunRecipientsHandler(context, { runId, recipients: lines.join('\n') })
    const recipients = parse(await recipientsResult)
    expect(recipients).toMatchObject({ rows: 900, valid: 500, invalidTotal: 300, duplicatesTotal: 100 })
    expect(recipients.invalid).toHaveLength(20)
    expect(recipients.duplicates).toHaveLength(20)
    expect((await recipientsResult).content.length).toBeLessThan(6_000)
    const renderResult = renderRunHandler(context, { runId })
    const rendered = parse(renderResult)
    expect(rendered).toMatchObject({ created: 500, items: 500, excludedTotal: 400 })
    expect(rendered.excluded).toHaveLength(20)
    expect(renderResult.content.length).toBeLessThan(4_000)
    // The read still has every row.
    const run = parse(getRunHandler(context, { runId }))
    expect(run.invalidRows).toHaveLength(300)
    expect(run.duplicateRows).toHaveLength(100)
  })
})

describe('run tools: following a sent run', () => {
  const SENT_AT = NOW.toISOString()
  const HEADER = '<puremail-sarah@puremail.local>'

  /**
   * The shell's IMAP send as it really lands: the delivery controller files
   * the provider receipt with sendDraft (stored as msg_sent_<draftId>_…,
   * stamped with sentDraftId), while the id handed back to the run is the
   * provider's transient imap_sent_<ts>, which nothing stored carries.
   */
  function imapContext(): TestContext {
    const context = makeContext()
    context.sendStoreDraft = (draft, options) => {
      const finalized = finalizeRunDraftForSend(draft)
      context.sent.push(finalized)
      const receipt: MailMessage = {
        id: 'imap_sent_1790000000000',
        threadId: finalized.threadId,
        deliveryAccepted: true,
        sentDraftId: finalized.id,
        messageIdHeader: HEADER,
        from: { name: 'Me', email: context.store.accounts[0]!.email },
        to: finalized.to,
        cc: [],
        bcc: [],
        subject: finalized.subject,
        body: finalized.body,
        receivedAt: SENT_AT,
        attachments: [],
        read: true,
      }
      context.store = sendDraft(
        { ...context.store, drafts: context.store.drafts.map(item => (item.id === finalized.id ? finalized : item)) },
        finalized.id,
        SENT_AT,
        { sentMessage: receipt, sentMessageId: receipt.id },
      )
      options.onCommitted?.(receipt.id)
      return { ok: true, pendingId: `pending_${finalized.id}`, undoSeconds: 0 }
    }
    return context
  }

  /** The next IMAP sync: the server's Sent copy replaces the receipt, in the provider's conversation. */
  function syncServerCopy(context: TestContext, draftId: string): { thread: MailThread; copy: MailMessage } {
    const receipt = context.store.messages.find(message => message.sentDraftId === draftId)!
    const thread: MailThread = {
      id: 'imap_thread_puremailsarahpuremaillocal',
      accountId: context.store.accounts[0]!.id,
      mailboxId: context.store.mailboxes[0]!.id,
      subject: receipt.subject,
      participants: receipt.to,
      labels: [],
      status: 'waiting',
      priority: 'none',
      summary: '',
      lastMessageAt: SENT_AT,
      syncState: 'synced',
    }
    const copy: MailMessage = { ...receipt, id: 'imap_sent_uid_42', threadId: thread.id }
    context.store = {
      ...context.store,
      threads: [...context.store.threads, thread],
      messages: [...context.store.messages.filter(message => message.id !== receipt.id), copy],
    }
    return { thread, copy }
  }

  function message(id: string, overrides: Partial<MailMessage>): MailMessage {
    return {
      id,
      threadId: 'imap_thread_puremailsarahpuremaillocal',
      from: { name: 'Sarah Example', email: 'sarah@design.example' },
      to: [{ name: 'Me', email: 'me@example.com' }],
      cc: [],
      subject: 'Re: Workshop dates for Sarah',
      body: 'Yes please — the second session suits.',
      receivedAt: '2026-09-03T09:00:00.000Z',
      attachments: [],
      read: false,
      ...overrides,
    }
  }

  it('getRun points a sent item at the stored copy, not the transient IMAP id, and follows the sync', async () => {
    const context = imapContext()
    const runId = await setUpRenderedRun(context)
    parse(sendRunItemHandler(context, { runId }))
    let item = parse(getRunHandler(context, { runId })).items[0]
    const draftId = item.draftId
    expect(item.status).toBe('sent')
    expect(item.sentMessageId).toMatch(new RegExp(`^msg_sent_${draftId}_`))
    expect(item.sentMessageId).not.toMatch(/^imap_sent_17/)
    expect(item.messageIdHeader).toBe(HEADER)
    expect(item.threadId).toBe(context.store.messages.find(entry => entry.id === item.sentMessageId)!.threadId)
    // Unsent items carry none of it.
    const pending = parse(getRunHandler(context, { runId })).items[1]
    expect(pending.sentMessageId).toBeUndefined()
    expect(pending.threadId).toBeUndefined()

    const { thread, copy } = syncServerCopy(context, draftId)
    item = parse(getRunHandler(context, { runId })).items[0]
    expect(item).toMatchObject({ sentMessageId: copy.id, messageIdHeader: HEADER, threadId: thread.id })
  })

  it('getRunReplies lists other people\'s later messages per sent item, with the reply state', async () => {
    const context = imapContext()
    const runId = await setUpRenderedRun(context)
    parse(sendRunItemHandler(context, { runId }))
    const draftId = parse(getRunHandler(context, { runId })).items[0].draftId
    const { thread } = syncServerCopy(context, draftId)
    const own = context.store.accounts[0]!.email

    let replies = parse(getRunRepliesHandler(context, { runId }))
    expect(replies).toMatchObject({ sent: 1, replied: 0, notSent: 2 })
    expect(replies.items[0]).toMatchObject({ draftId, threadId: thread.id, messageIdHeader: HEADER, replies: [] })
    expect(replies.items[0].replyState.kind).toBe('awaiting')

    context.store = {
      ...context.store,
      messages: [
        ...context.store.messages,
        // Before the letter went: not a reply.
        message('msg_before', { receivedAt: '2026-09-01T09:00:00.000Z' }),
        // Their answer in the conversation.
        message('msg_reply', {}),
        // A colleague answering in a conversation of its own, citing the letter.
        message('msg_cited', {
          threadId: 'imap_thread_elsewhere',
          from: { name: 'Pat Desk', email: 'pat@design.example' },
          references: [HEADER],
          receivedAt: '2026-09-05T09:00:00.000Z',
        }),
        // Our own follow-up and an unsent draft never count.
        message('msg_ours', { from: { name: 'Me', email: own.toUpperCase() }, receivedAt: '2026-09-04T09:00:00.000Z' }),
        message('msg_draft', { isDraft: true, receivedAt: '2026-09-04T10:00:00.000Z' }),
      ],
    }
    replies = parse(getRunRepliesHandler(context, { runId }))
    expect(replies).toMatchObject({ sent: 1, replied: 1 })
    expect(replies.items[0].replies).toEqual([
      {
        messageId: 'msg_reply',
        from: { name: 'Sarah Example', email: 'sarah@design.example' },
        date: '2026-09-03T09:00:00.000Z',
        snippet: 'Yes please — the second session suits.',
        threadId: thread.id,
      },
      expect.objectContaining({ messageId: 'msg_cited', threadId: 'imap_thread_elsewhere' }),
    ])
    // The thread's last word is ours again (msg_ours), so the derived state waits.
    expect(replies.items[0].replyState.kind).toBe('awaiting')

    // since: only what came after an earlier check.
    const later = parse(getRunRepliesHandler(context, { runId, since: '2026-09-04' }))
    expect(later.since).toBe('2026-09-04T00:00:00.000Z')
    expect(later.items[0].replies.map((reply: { messageId: string }) => reply.messageId)).toEqual(['msg_cited'])
    expect(() => getRunRepliesHandler(context, { runId, since: 'next week' })).toThrow(/ISO date/)
    expect(() => getRunRepliesHandler(context, { runId: 'run_nope' })).toThrow(/No run/)
  })

  it('getRunReplies reports a replied thread and an unsent run plainly, and changes nothing', async () => {
    const context = imapContext()
    const runId = await setUpRenderedRun(context)
    const before = context.store
    const unsent = parse(getRunRepliesHandler(context, { runId }))
    expect(unsent).toMatchObject({ sent: 0, replied: 0, notSent: 3, items: [] })
    expect(unsent.note).toMatch(/Send & next/)
    expect(context.store).toBe(before)

    parse(sendRunItemHandler(context, { runId }))
    const draftId = parse(getRunHandler(context, { runId })).items[0].draftId
    syncServerCopy(context, draftId)
    context.store = { ...context.store, messages: [...context.store.messages, message('msg_reply', {})] }
    const sentStore = context.store
    const replies = parse(getRunRepliesHandler(context, { runId }))
    expect(replies.items[0].replyState).toMatchObject({ kind: 'replied', at: '2026-09-03T09:00:00.000Z' })
    expect(context.store).toBe(sentStore)
    expect(context.sent).toHaveLength(1)
  })
})
