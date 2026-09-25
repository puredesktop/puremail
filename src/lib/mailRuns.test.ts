import { describe, expect, it } from 'vitest'
import { demoMailStoreForNow, pruneOrphanedDraftThreads, sendDraft } from './mailModel'
import {
  addDraftsToRun,
  advanceRun,
  buildRunTemplatePrompt,
  bodyHasNoteSlot,
  createRun,
  createRunFromDrafts,
  createRunTemplateDraft,
  deriveFirstName,
  detectCsvDelimiter,
  draftHasNote,
  emailedThisMonth,
  emptyNoteRegionHtml,
  finalizeRunBodyHtml,
  finalizeRunDraftForSend,
  guessRunFieldMap,
  markRunItemCommitted,
  markRunItemSent,
  markRunItemUnsent,
  nextPendingIndex,
  noteTextFromBodyHtml,
  parseCsv,
  parsePastedRecipients,
  pauseRun,
  previousIndex,
  recipientsFromCsv,
  recipientsFromSheetsWorkbook,
  reconcileRun,
  renderRun,
  renderRunBodyHtml,
  renderRunDraftFields,
  resumeIndex,
  runProgress,
  runSummaryLine,
  runTokensIn,
  setNoteInBodyHtml,
  skipRunItem,
  startRun,
  substituteRunTokens,
  templateNoteSlotHtml,
  validateRunRecipients,
} from './mailRuns'
import type { MailRun, MailStore } from '../types'

const NOW = '2026-09-02T10:00:00.000Z'

const LIST = `Email,Name,Role
sarah@design.example,Sarah Example,studio
tom@vendor.example,Tom Example,joinery
mere@paper.example,Mere Example,paper
not-an-email,Broken Row,x
sarah@design.example,Sarah Again,dupe`

function storeWithTemplate(): {
  store: MailStore
  run: MailRun
  templateId: string
} {
  let store = demoMailStoreForNow(new Date(NOW))
  const template = createRunTemplateDraft(
    store,
    {
      accountId: store.accounts[0]!.id,
      subject: 'Workshop dates for {{first_name}}',
      body: 'Hi {{first_name}},\n\nSee attached.\n{{note}}\nAdam',
      bodyHtml: `<p>Hi {{first_name}},</p><p>See attached.</p>${templateNoteSlotHtml()}<p>User</p>`,
      attachments: [
        { id: 'att_1', name: 'deposit.pdf', mimeType: 'application/pdf', sizeLabel: '1 KB', size: 1024 },
      ],
    },
    NOW,
  )
  store = template.store
  const created = createRun(
    store,
    {
      name: 'October workshop invite',
      accountId: store.accounts[0]!.id,
      templateDraftId: template.draft.id,
      recipients: recipientsFromCsv(LIST, { kind: 'csv', label: 'list.csv' }),
    },
    NOW,
  )
  return { store: created.store, run: created.run, templateId: template.draft.id }
}

describe('tokens', () => {
  it('lists unique tokens and substitutes by exact or normalized name', () => {
    expect(runTokensIn('Hi {{first_name}} {{ First Name }} {{email}}')).toEqual([
      'first_name',
      'First Name',
      'email',
    ])
    const result = substituteRunTokens('Hi {{First Name}}, {{unknown}}!', {
      first_name: 'Sarah',
    })
    expect(result.text).toBe('Hi Sarah, !')
    expect(result.missing).toEqual(['unknown'])
  })

  it('HTML-escapes substituted values in html mode', () => {
    const result = substituteRunTokens('<p>{{name}}</p>', { name: 'A <b> & "co"\nLtd' }, { html: true })
    expect(result.text).toBe('<p>A &lt;b&gt; &amp; &quot;co&quot;<br>Ltd</p>')
  })

  it('derives first names from the usual shapes', () => {
    expect(deriveFirstName('Sarah Example')).toBe('Sarah')
    expect(deriveFirstName('Chen, Sarah')).toBe('Sarah')
    expect(deriveFirstName('Dr. Mere Example')).toBe('Mere')
    expect(deriveFirstName('"Tom" Verner')).toBe('Tom')
    expect(deriveFirstName('   ')).toBe('')
    expect(deriveFirstName('Aro Valley Timber')).toBe('Aro')
  })

  it('guesses a field map from column names', () => {
    expect(guessRunFieldMap(['Email', 'Name', 'Role'])).toEqual({
      email: { column: 'Email' },
      first_name: { column: 'Name', transform: 'first-word' },
      name: { column: 'Name' },
    })
    expect(guessRunFieldMap(['E-mail address', 'First name', 'Surname'])).toEqual({
      email: { column: 'E-mail address' },
      first_name: { column: 'First name' },
      name: { column: 'First name' },
      last_name: { column: 'Surname' },
    })
    expect(guessRunFieldMap(['Company', 'Phone'])).toEqual({})
  })
})

describe('recipient sources', () => {
  it('parses RFC 4180 CSV: quotes, doubled quotes, embedded newlines, CRLF', () => {
    const text = 'a,b\r\n"x, y","say ""hi""\nthere"\r\nplain,row\r\n\r\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
      ['plain', 'row'],
    ])
    expect(detectCsvDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectCsvDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('reads a CSV with a header into columns and rows', () => {
    const recipients = recipientsFromCsv(LIST, { kind: 'csv', label: 'list.csv' })
    expect(recipients.columns).toEqual(['Email', 'Name', 'Role'])
    expect(recipients.rows).toHaveLength(5)
    expect(recipients.rows[2]).toEqual({ Email: 'mere@paper.example', Name: 'Mere Example', Role: 'paper' })
  })

  it('synthesizes columns for a headerless CSV', () => {
    const recipients = recipientsFromCsv('sarah@design.example,Sarah Example\ntom@vendor.example,Tom Example')
    expect(recipients.columns).toEqual(['email', 'name'])
    expect(recipients.rows[0]).toEqual({ email: 'sarah@design.example', name: 'Sarah Example' })
  })

  it('parses pasted lines in every supported shape', () => {
    const recipients = parsePastedRecipients(`
sarah@design.example
Tom Example <tom@vendor.example>
mere@paper.example, Mere Example
Hana Example, hana@example.com
kate@example.com\tKate Example
this is not an address
`)
    expect(recipients.columns).toEqual(['email', 'name'])
    expect(recipients.rows).toEqual([
      { email: 'sarah@design.example', name: '' },
      { email: 'tom@vendor.example', name: 'Tom Example' },
      { email: 'mere@paper.example', name: 'Mere Example' },
      { email: 'hana@example.com', name: 'Hana Example' },
      { email: 'kate@example.com', name: 'Kate Example' },
      { email: 'this is not an address', name: '' },
    ])
  })

  it('reads the first sheet of a PureSheets workbook', () => {
    const workbook = {
      app: 'PureSheets',
      version: 1,
      workbook: {
        activeSheetId: 's1',
        sheets: [
          {
            id: 's1',
            name: 'List',
            cells: {
              A1: { value: 'Email', kind: 'text' },
              B1: { value: 'Name', kind: 'text' },
              A2: { value: 'sarah@design.example', kind: 'text' },
              B2: { value: 'Sarah Example', kind: 'text' },
              A3: { value: 'tom@vendor.example', kind: 'text' },
              // B3 blank on purpose
              A5: { value: 'mere@paper.example', kind: 'text' },
              B5: { value: 'Mere Example', kind: 'text' },
            },
          },
        ],
      },
    }
    const recipients = recipientsFromSheetsWorkbook(workbook, { kind: 'sheet', label: 'Workshop list.sheets' })
    expect(recipients.columns).toEqual(['Email', 'Name'])
    expect(recipients.rows).toEqual([
      { Email: 'sarah@design.example', Name: 'Sarah Example' },
      { Email: 'tom@vendor.example', Name: '' },
      { Email: 'mere@paper.example', Name: 'Mere Example' },
    ])
    expect(() => recipientsFromSheetsWorkbook({ app: 'Other' }, { kind: 'sheet', label: 'x' })).toThrow(/PureSheets/)
  })

  it('validates addresses and flags duplicates with row numbers', () => {
    const recipients = recipientsFromCsv(LIST)
    const validation = validateRunRecipients(recipients, guessRunFieldMap(recipients.columns))
    expect(validation.validRowIndexes).toEqual([0, 1, 2])
    expect(validation.invalid).toEqual([{ rowIndex: 3, reason: '"not-an-email" is not a valid email address.' }])
    expect(validation.duplicates).toEqual([{ rowIndex: 4, email: 'sarah@design.example', firstRowIndex: 0 }])
    expect(validateRunRecipients(recipients, {}).invalid).toHaveLength(5)
  })

  it('flags an address already emailed this calendar month, best effort', () => {
    const store = demoMailStoreForNow(new Date(NOW))
    const owner = store.accounts[0]!.email
    store.messages.push({
      id: 'msg_x',
      threadId: 't',
      from: { name: 'Me', email: owner },
      to: [{ name: 'Sarah', email: 'Sarah@design.example' }],
      cc: [],
      bcc: [],
      subject: 's',
      body: 'b',
      receivedAt: '2026-09-01T08:00:00.000Z',
      attachments: [],
      read: true,
    })
    expect(emailedThisMonth(store, 'sarah@design.example', new Date(NOW))).toBe(true)
    expect(emailedThisMonth(store, 'sarah@design.example', new Date('2026-10-02T00:00:00.000Z'))).toBe(false)
    expect(emailedThisMonth(store, 'nobody@example.com', new Date(NOW))).toBe(false)
  })
})

describe('the note slot', () => {
  it('renders template regions and bare tokens as empty regions, substituting the rest', () => {
    const html = `<p>Hi {{first_name}}</p>${templateNoteSlotHtml()}<p>{{ note }}</p><p>Bye</p>`
    const rendered = renderRunBodyHtml(html, { first_name: 'Mere' })
    expect(rendered.html).toBe(
      `<p>Hi Mere</p>${emptyNoteRegionHtml()}<p>${emptyNoteRegionHtml()}</p><p>Bye</p>`,
    )
    expect(rendered.missing).toEqual([])
    expect(bodyHasNoteSlot({ body: '', bodyHtml: html })).toBe(true)
    expect(bodyHasNoteSlot({ body: 'x {{note}}' })).toBe(true)
    expect(bodyHasNoteSlot({ body: 'plain' })).toBe(false)
  })

  it('strips an empty region entirely and unwraps a filled one at send time', () => {
    const empty = `<p>Hi</p>${emptyNoteRegionHtml()}<p>Bye</p>`
    expect(finalizeRunBodyHtml(empty)).toEqual({ html: '<p>Hi</p><p>Bye</p>', hadNote: false, changed: true })
    const filled = `<p>Hi</p><div data-run-note=""><p>Thanks for the <b>rag</b></p></div><p>Bye</p>`
    expect(finalizeRunBodyHtml(filled)).toEqual({
      html: '<p>Hi</p><p>Thanks for the <b>rag</b></p><p>Bye</p>',
      hadNote: true,
      changed: true,
    })
    // Nested divs inside the region do not fool the scanner.
    const nested = `<div data-run-note=""><div><p>inner</p></div></div><p>after</p>`
    expect(finalizeRunBodyHtml(nested).html).toBe('<div><p>inner</p></div><p>after</p>')
    expect(finalizeRunBodyHtml('<p>no slot</p>').changed).toBe(false)
  })

  it('reads and writes the note text, and is identity without a slot', () => {
    const html = `<p>Hi</p>${emptyNoteRegionHtml()}<p>Bye</p>`
    expect(noteTextFromBodyHtml(html)).toBe('')
    const withNote = setNoteInBodyHtml(html, 'Bring a few\nsheets')!
    expect(withNote).toBe('<p>Hi</p><div data-run-note=""><p>Bring a few</p><p>sheets</p></div><p>Bye</p>')
    expect(noteTextFromBodyHtml(withNote)).toBe('Bring a few\nsheets')
    expect(draftHasNote({ bodyHtml: withNote })).toBe(true)
    expect(setNoteInBodyHtml('<p>no slot</p>', 'x')).toBeNull()
    const draft = {
      id: 'd',
      threadId: 't',
      to: [],
      subject: 's',
      body: 'b',
      bodyHtml: '<p>plain</p>',
      attachments: [],
      updatedAt: NOW,
      syncState: 'pending' as const,
    }
    expect(finalizeRunDraftForSend(draft)).toBe(draft)
    expect(finalizeRunDraftForSend({ ...draft, bodyHtml: html }).bodyHtml).toBe('<p>Hi</p><p>Bye</p>')
  })
})

describe('rendering', () => {
  it('previews one row exactly as it renders', () => {
    const { store, run, templateId } = storeWithTemplate()
    const template = store.drafts.find(draft => draft.id === templateId)!
    const fields = renderRunDraftFields(run, template, 2)!
    expect(fields.to).toEqual({ name: 'Mere Example', email: 'mere@paper.example' })
    expect(fields.subject).toBe('Workshop dates for Mere')
    expect(fields.body).toBe('Hi Mere,\n\nSee attached.\n\nAdam')
    expect(fields.bodyHtml).toBe(`<p>Hi Mere,</p><p>See attached.</p>${emptyNoteRegionHtml()}<p>User</p>`)
    expect(fields.missing).toEqual([])
    expect(renderRunDraftFields(run, template, 99)).toBeNull()
  })

  it('reports tokens the list cannot fill', () => {
    const { store, run, templateId } = storeWithTemplate()
    const template = { ...store.drafts.find(draft => draft.id === templateId)!, subject: 'For {{company}}' }
    expect(renderRunDraftFields(run, template, 0)!.missing).toEqual(['company'])
  })

  it('renders drafts for valid rows only, as ordinary drafts with the template attachments', () => {
    const { store, run } = storeWithTemplate()
    const draftsBefore = store.drafts.length
    const result = renderRun(store, run.id, NOW)
    expect(result.created).toBe(3)
    expect(result.updated).toBe(0)
    expect(result.excluded).toEqual([
      { rowIndex: 3, reason: '"not-an-email" is not a valid email address.' },
      { rowIndex: 4, reason: 'Duplicate of row 1 (sarah@design.example).' },
    ])
    expect(result.run.status).toBe('ready')
    expect(result.run.items.map(item => item.rowIndex)).toEqual([0, 1, 2])
    expect(result.run.items.map(item => item.label)).toEqual(['Sarah Example', 'Tom Example', 'Mere Example'])
    expect(result.store.drafts).toHaveLength(draftsBefore + 3)
    const first = result.store.drafts.find(draft => draft.id === result.run.items[0]!.draftId)!
    expect(first.draftKind).toBe('run')
    expect(first.runId).toBe(run.id)
    expect(first.to).toEqual([{ name: 'Sarah Example', email: 'sarah@design.example' }])
    expect(first.attachments.map(item => item.name)).toEqual(['deposit.pdf'])
    expect(first.bodyHtml).toContain('data-run-note')
    // Each rendered draft has its own thread in Drafts.
    const thread = result.store.threads.find(item => item.id === first.threadId)!
    expect(result.store.mailboxes.find(box => box.id === thread.mailboxId)?.role).toBe('drafts')
  })

  it('re-renders idempotently: unsent drafts update in place (keeping notes), sent items are untouched', () => {
    const { store, run } = storeWithTemplate()
    const first = renderRun(store, run.id, NOW)
    const [itemA, itemB] = first.run.items
    // The user typed a note into A and sent B outside the run.
    let next = first.store
    next = {
      ...next,
      drafts: next.drafts.map(draft =>
        draft.id === itemA!.draftId
          ? { ...draft, bodyHtml: setNoteInBodyHtml(draft.bodyHtml, 'Thanks for the rag')! }
          : draft,
      ),
    }
    next = sendDraft(next, itemB!.draftId, '2026-09-02T11:00:00.000Z')
    next = { ...next, runs: next.runs!.map(item => reconcileRun(next, item)) }
    expect(next.runs![0]!.items[1]!.status).toBe('sent')
    // Change the template, re-render.
    next = {
      ...next,
      drafts: next.drafts.map(draft =>
        draft.id === run.template!.draftId ? { ...draft, subject: 'New subject for {{first_name}}' } : draft,
      ),
    }
    const second = renderRun(next, run.id, '2026-09-02T12:00:00.000Z')
    expect(second.created).toBe(0)
    expect(second.updated).toBe(2)
    expect(second.run.items.map(item => item.draftId)).toEqual(first.run.items.map(item => item.draftId))
    const draftA = second.store.drafts.find(draft => draft.id === itemA!.draftId)!
    expect(draftA.subject).toBe('New subject for Sarah')
    expect(noteTextFromBodyHtml(draftA.bodyHtml)).toBe('Thanks for the rag')
    expect(second.run.items[0]!.noteAdded).toBe(true)
    expect(second.run.items[1]!.status).toBe('sent')
    expect(second.store.drafts.some(draft => draft.id === itemB!.draftId)).toBe(false)
  })

  it('recreates a deleted draft on re-render and removes drafts for rows that dropped out', () => {
    const { store, run } = storeWithTemplate()
    const first = renderRun(store, run.id, NOW)
    const gone = first.run.items[2]!.draftId
    let next: MailStore = { ...first.store, drafts: first.store.drafts.filter(draft => draft.id !== gone) }
    // Shrink the list to two rows.
    next = {
      ...next,
      runs: next.runs!.map(item =>
        item.id === run.id
          ? { ...item, recipients: { ...item.recipients!, rows: item.recipients!.rows.slice(0, 2) } }
          : item,
      ),
    }
    const second = renderRun(next, run.id, '2026-09-02T12:00:00.000Z')
    expect(second.run.items).toHaveLength(2)
    expect(second.store.drafts.filter(draft => draft.runId === run.id && draft.draftKind === 'run')).toHaveLength(2)
    // Grow it back to three: row 2 gets a fresh draft with a new id.
    const grown: MailStore = {
      ...second.store,
      runs: second.store.runs!.map(item =>
        item.id === run.id ? { ...item, recipients: run.recipients } : item,
      ),
    }
    const third = renderRun(grown, run.id, '2026-09-02T13:00:00.000Z')
    expect(third.created).toBe(1)
    expect(third.run.items[2]!.draftId).not.toBe(gone)
    expect(third.run.items[2]!.status).toBe('pending')
  })

  it('refuses to render without a template or list', () => {
    const store = demoMailStoreForNow(new Date(NOW))
    const created = createRun(store, { name: 'x', accountId: store.accounts[0]!.id }, NOW)
    expect(() => renderRun(created.store, created.run.id)).toThrow(/no template/)
    expect(() => renderRun(store, 'run_missing')).toThrow(/No run/)
  })
})

describe('inheriting drafts', () => {
  it('builds a run from existing drafts in list order and leaves them editable', () => {
    const store = demoMailStoreForNow(new Date(NOW))
    const unsent = store.drafts.filter(draft => !draft.sentAt).map(draft => draft.id)
    expect(unsent.length).toBeGreaterThan(0)
    const result = createRunFromDrafts(
      store,
      { name: 'Review drafts', accountId: store.accounts[0]!.id, draftIds: [...unsent, 'draft_nope'] },
      NOW,
    )
    expect(result.run.status).toBe('ready')
    expect(result.run.items.map(item => item.draftId)).toEqual(unsent)
    expect(result.run.items.every(item => item.rowIndex === undefined)).toBe(true)
    expect(result.missing).toEqual(['draft_nope'])
    expect(result.run.template).toBeUndefined()
    // Drafts are still the same drafts, now tagged with the run.
    for (const id of unsent) {
      const draft = result.store.drafts.find(item => item.id === id)!
      expect(draft.runId).toBe(result.run.id)
      expect(draft.sentAt).toBeUndefined()
    }
    // Adding again is a no-op for drafts already in the run.
    const again = addDraftsToRun(result.store, result.run, unsent, NOW)
    expect(again.added).toEqual([])
    expect(again.run.items).toHaveLength(unsent.length)
  })
})

describe('the loop', () => {
  function runWith(statuses: MailRun['items'][number]['status'][], cursor = 0): MailRun {
    return {
      id: 'run_1',
      name: 'Test',
      accountId: 'acct',
      status: 'running',
      fieldMap: {},
      noteSlot: false,
      items: statuses.map((status, index) => ({ draftId: `d${index}`, status })),
      cursor,
      createdAt: NOW,
      updatedAt: NOW,
    }
  }

  it('resumes at the first open item at or after the cursor, wrapping', () => {
    expect(resumeIndex(runWith(['sent', 'sent', 'pending', 'pending'], 1))).toBe(2)
    expect(resumeIndex(runWith(['pending', 'sent', 'sent'], 2))).toBe(0)
    expect(resumeIndex(runWith(['sent', 'skipped'], 0))).toBe(-1)
    expect(resumeIndex(runWith([], 0))).toBe(-1)
  })

  it('finds the next open item after the cursor and the previous of any status', () => {
    const run = runWith(['sent', 'pending', 'skipped', 'pending'])
    expect(nextPendingIndex(run, 1)).toBe(3)
    expect(nextPendingIndex(run, 3)).toBe(1)
    expect(nextPendingIndex(runWith(['sent', 'pending']), 1)).toBe(-1)
    expect(previousIndex(run, 2)).toBe(1)
    expect(previousIndex(run, 0)).toBe(-1)
  })

  it('send & next: marks sent, advances, finishes when nothing is open', () => {
    let run = startRun(runWith(['pending', 'pending', 'pending']), NOW)
    expect(run.status).toBe('running')
    expect(run.items[0]!.status).toBe('reviewing')
    run = markRunItemSent(run, 'd0', { pendingSendId: 'p1' }, NOW)
    run = advanceRun(run, NOW)
    expect(run.cursor).toBe(1)
    expect(run.items[0]!.status).toBe('sent')
    expect(run.items[0]!.pendingSendId).toBe('p1')
    expect(run.items[1]!.status).toBe('reviewing')
    run = markRunItemCommitted(run, 'd0', 'msg_1', NOW)
    expect(run.items[0]!.pendingSendId).toBeUndefined()
    expect(run.items[0]!.sentMessageId).toBe('msg_1')
    run = skipRunItem(run, 'd1', undefined, NOW)
    run = advanceRun(run, NOW)
    expect(run.cursor).toBe(2)
    run = markRunItemSent(run, 'd2', {}, NOW)
    run = advanceRun(run, NOW)
    expect(run.status).toBe('done')
    expect(runProgress(run)).toEqual({ total: 3, sent: 2, skipped: 1, missing: 0, pending: 0, toGo: 0 })
    expect(runSummaryLine(run)).toBe('Run: Test · 2 sent · 1 skipped · done')
  })

  it('undo (or a provider failure) puts the item back and the cursor on it', () => {
    let run = runWith(['sent', 'sent', 'pending'], 2)
    run = markRunItemUnsent(run, 'd1', 'Gmail refused the send.', NOW)
    expect(run.items[1]!.status).toBe('pending')
    expect(run.items[1]!.skipReason).toBe('Gmail refused the send.')
    expect(run.cursor).toBe(1)
    const done = markRunItemUnsent({ ...runWith(['sent', 'sent']), status: 'done' }, 'd0', undefined, NOW)
    expect(done.status).toBe('running')
  })

  it('pause clears the reviewing mark; reopening resumes where it stopped', () => {
    let run = startRun(runWith(['sent', 'pending', 'pending']), NOW)
    expect(run.cursor).toBe(1)
    run = pauseRun(run, NOW)
    expect(run.status).toBe('paused')
    expect(run.items[1]!.status).toBe('pending')
    run = startRun(run, NOW)
    expect(run.status).toBe('running')
    expect(run.cursor).toBe(1)
    expect(run.items[1]!.status).toBe('reviewing')
    const finished = startRun(runWith(['sent', 'skipped']), NOW)
    expect(finished.status).toBe('done')
  })

  it('a skipped item revisited can still be sent; a sent item cannot be skipped', () => {
    let run = runWith(['skipped', 'sent'])
    run = markRunItemSent(run, 'd0', {}, NOW)
    expect(run.items[0]!.status).toBe('sent')
    expect(skipRunItem(run, 'd1', undefined, NOW).items[1]!.status).toBe('sent')
  })
})

describe('reconciling with the drafts as they are now', () => {
  it('marks a deleted draft missing, a draft sent elsewhere sent, and follows edits', () => {
    const { store, run } = storeWithTemplate()
    const rendered = renderRun(store, run.id, NOW)
    const [a, b, c] = rendered.run.items
    let next: MailStore = {
      ...rendered.store,
      drafts: rendered.store.drafts.filter(draft => draft.id !== a!.draftId),
    }
    next = sendDraft(next, b!.draftId, '2026-09-02T11:00:00.000Z')
    next = {
      ...next,
      drafts: next.drafts.map(draft =>
        draft.id === c!.draftId
          ? { ...draft, to: [{ name: 'Mere K.', email: 'mere@paper.example' }], bodyHtml: setNoteInBodyHtml(draft.bodyHtml, 'note')! }
          : draft,
      ),
    }
    const reconciled = reconcileRun(next, rendered.run)
    expect(reconciled).not.toBe(rendered.run)
    expect(reconciled.items[0]).toMatchObject({ status: 'missing', skipReason: 'The draft was deleted.' })
    expect(reconciled.items[1]).toMatchObject({ status: 'sent', sentAt: '2026-09-02T11:00:00.000Z' })
    expect(reconciled.items[1]!.sentMessageId).toMatch(/^msg_sent_/)
    expect(reconciled.items[2]).toMatchObject({ status: 'pending', label: 'Mere K.', noteAdded: true })
    // Nothing changed → same object.
    expect(reconcileRun(next, reconciled)).toBe(reconciled)
    // Everything resolved → done.
    const allDone = reconcileRun(
      { ...next, drafts: next.drafts.filter(draft => draft.id !== c!.draftId) },
      reconciled,
    )
    expect(allDone.items[2]!.status).toBe('missing')
    expect(allDone.status).toBe('done')
  })

  it('a rendered draft deleted from Drafts leaves no empty thread behind', () => {
    const { store, run } = storeWithTemplate()
    const rendered = renderRun(store, run.id, NOW)
    const draft = rendered.store.drafts.find(item => item.id === rendered.run.items[0]!.draftId)!
    const pruned = pruneOrphanedDraftThreads({
      ...rendered.store,
      drafts: rendered.store.drafts.filter(item => item.id !== draft.id),
    })
    expect(pruned.threads.some(thread => thread.id === draft.threadId)).toBe(false)
    // A SENT one keeps its thread (the sent copy lives there).
    const sent = sendDraft(rendered.store, draft.id)
    expect(pruneOrphanedDraftThreads(sent).threads.some(thread => thread.id === draft.threadId)).toBe(true)
  })
})

describe('the setup prompt box', () => {
  it('hands the drawer agent the brief with ids, fields and the note convention', () => {
    const prompt = buildRunTemplatePrompt({
      runId: 'run_1',
      runName: 'October workshop invite',
      templateDraftId: 'draft_run_template_1',
      tokens: ['email', 'first_name', 'role'],
      hasNoteSlot: false,
      currentSubject: '',
      currentBody: '',
      request: 'write a warm invite to the October workshops, mention both dates',
    })
    expect(prompt).toContain('runId run_1')
    expect(prompt).toContain('templateDraftId draft_run_template_1')
    expect(prompt).toContain('{{email}}, {{first_name}}, {{role}}')
    expect(prompt).toContain('exactly one {{note}} slot')
    expect(prompt).toContain('updateDraft(templateDraftId, { subject, body })')
    expect(prompt).toContain('Do not renderRun or send')
    expect(prompt).toContain('The template is empty.')
    expect(prompt.endsWith('Brief: write a warm invite to the October workshops, mention both dates')).toBe(true)
    const revision = buildRunTemplatePrompt({
      runId: 'run_1',
      runName: 'x',
      templateDraftId: 'd',
      tokens: [],
      hasNoteSlot: true,
      currentSubject: 'Hello {{first_name}}',
      currentBody: 'Hi {{first_name}},\n\n{{note}}\n\nAdam',
      request: 'make it shorter',
    })
    expect(revision).toContain('Keep the existing {{note}} slot')
    expect(revision).toContain('Subject: Hello {{first_name}}')
    expect(revision).toContain('none yet (no recipient list attached)')
  })
})
