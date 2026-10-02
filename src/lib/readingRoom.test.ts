import { describe, expect, it } from 'vitest'
import {
  addNote,
  articleOf,
  contextFileName,
  contextForAgent,
  contextMarkdown,
  emptyAnnotationsFile,
  matchesContext,
  noteCounts,
  noteForAgent,
  orderedNotes,
  paragraphPieces,
  parseAnnotationsFile,
  removeNote,
  replyBrief,
  resolveNote,
  setContext,
  updateNote,
  type MessageIdentity,
  type MessageNote,
} from './readingRoom'

const body = [
  'Dear Adam,',
  'We would like to start the pilot in the first week of March, with the completeness check first.',
  'On cost, the budget is fixed at the figure we discussed. See the plan [https://example.org/plan] for details.',
  'Would Thursday afternoon work for a call?',
].join('\n\n')

const identity = (article: string): MessageIdentity => ({
  messageId: 'm1',
  threadId: 't1',
  subject: 'The spring pilot',
  from: { name: 'Maren Holt', email: 'maren@example.org' },
  receivedAt: '2026-10-06T09:12:00.000Z',
  article,
})

const note = (article: string, kind: MessageNote['kind'], quote: string, text: string, id = quote || 'whole'): MessageNote => {
  const start = quote ? article.indexOf(quote) : 0
  return { id, kind, quote, start, end: start + quote.length, text, createdAt: `2026-10-06T10:00:0${id.length % 10}.000Z` }
}

describe('the reading room', () => {
  it('reads a message as paragraphs, with links as their labels', () => {
    const article = articleOf(body)
    expect(article.paragraphs).toHaveLength(4)
    expect(article.text).not.toContain('https://')
    const link = article.paragraphs[2].runs.find(run => run.href)
    expect(link?.href).toBe('https://example.org/plan')
    for (const paragraph of article.paragraphs) expect(article.text.slice(paragraph.start, paragraph.start + paragraph.text.length)).toBe(paragraph.text)
  })

  it('finds a passage again when the text around it moved, and gives up when it is gone', () => {
    const { text } = articleOf(body)
    const marked = note(text, 'reply', 'first week of March', 'Propose the second week.')
    expect(resolveNote(text, marked)).toEqual({ start: marked.start, end: marked.end })
    const moved = `A new opening line.\n\n${text}`
    expect(resolveNote(moved, marked)?.start).toBe(marked.start + 21)
    expect(resolveNote('Nothing like it.', marked)).toBeNull()
  })

  it('cuts a paragraph at its marks, across links, without overlapping marks', () => {
    const article = articleOf(body)
    const paragraph = article.paragraphs[2]
    const fixed = note(article.text, 'private', 'the budget is fixed', 'Check with Ana.', 'n1')
    const overlap = note(article.text, 'reply', 'budget', 'Overlaps', 'n2')
    const pieces = paragraphPieces(paragraph, [fixed, overlap])
    expect(pieces.map(piece => piece.text).join('')).toBe(paragraph.text)
    expect(pieces.filter(piece => piece.noteId).map(piece => piece.noteId)).toEqual(['n1'])
    expect(pieces.find(piece => piece.href)?.text.length).toBeGreaterThan(0)
  })

  it('keeps notes per message, drops an empty record, and orders whole-message notes first', () => {
    const { text } = articleOf(body)
    const now = '2026-10-06T10:00:00.000Z'
    let file = addNote(emptyAnnotationsFile(), identity(text), note(text, 'reply', 'Would Thursday afternoon work for a call?', 'Yes, after two.'), now)
    file = addNote(file, identity(text), note(text, 'reply', '', 'Thank her for the write-up.'), now)
    file = addNote(file, identity(text), note(text, 'private', 'the budget is fixed', 'Check with Ana first.'), now)
    const record = file.byMessageId.m1
    expect(noteCounts(record)).toEqual({ reply: 2, private: 1, highlight: 0 })
    expect(orderedNotes(record).map(item => item.quote)).toEqual(['', 'the budget is fixed', 'Would Thursday afternoon work for a call?'])
    file = updateNote(file, 'm1', 'the budget is fixed', { text: 'Ask Ana.' }, now)
    expect(file.byMessageId.m1.notes.find(item => item.kind === 'private')?.text).toBe('Ask Ana.')
    for (const item of record.notes) file = removeNote(file, 'm1', item.id, now)
    expect(file.byMessageId.m1).toBeUndefined()
  })

  it('briefs the assistant from notes for the reply only, never private notes', () => {
    const { text } = articleOf(body)
    const now = '2026-10-06T10:00:00.000Z'
    let file = addNote(emptyAnnotationsFile(), identity(text), note(text, 'reply', 'first week of March', 'Propose the second week.'), now)
    file = addNote(file, identity(text), note(text, 'private', 'the budget is fixed', 'The board chair is the problem.'), now)
    file = addNote(file, identity(text), note(text, 'highlight', 'completeness check', ''), now)
    const record = file.byMessageId.m1
    const brief = replyBrief(record)
    expect(brief).toContain('Propose the second week.')
    expect(brief).not.toContain('board chair')
    expect(brief).not.toContain('completeness check')
    expect(record.notes.map(noteForAgent).filter(Boolean).map(item => item!.kind)).toEqual(['reply', 'highlight'])
  })

  it('keeps context with only what the reader chose, for agents and for the shared file', () => {
    const { text } = articleOf(body)
    const now = '2026-10-06T10:00:00.000Z'
    let file = addNote(emptyAnnotationsFile(), identity(text), note(text, 'reply', 'first week of March', 'Propose the second week.'), now)
    file = addNote(file, identity(text), note(text, 'private', 'the budget is fixed', 'The board chair is the problem.'), now)
    file = setContext(file, identity(text), { title: 'The spring pilot', summary: 'Northbridge want to start in March.', topics: ['Spring pilot'], include: { message: true, replyNotes: true, privateNotes: false }, scope: 'all', keptAt: now }, now)
    const record = file.byMessageId.m1
    const forAgent = contextForAgent(record)!
    expect(forAgent.notesForTheReply).toHaveLength(1)
    expect('privateNotesTheReaderIncluded' in forAgent).toBe(false)
    const markdown = contextMarkdown(record)
    expect(markdown).toContain('source: PureMail')
    expect(markdown).toContain('topics: ["Spring pilot"]')
    expect(markdown).toContain('Propose the second week.')
    expect(markdown).not.toContain('board chair')
    expect(markdown).toContain('## The message')
    expect(matchesContext(record, 'march pilot')).toBe(true)
    expect(matchesContext(record, 'anything', 'Contracts')).toBe(false)
    expect(contextFileName(record, 'The spring pilot: dates & data')).toBe('2026-10-06-the-spring-pilot-dates-data-m1.md')
  })

  it('reads its own file back, and refuses what it does not recognise', () => {
    const { text } = articleOf(body)
    const now = '2026-10-06T10:00:00.000Z'
    const file = addNote(emptyAnnotationsFile(), identity(text), note(text, 'reply', 'first week of March', 'Second week.'), now)
    expect(parseAnnotationsFile(JSON.parse(JSON.stringify(file)))).toEqual(file)
    expect(parseAnnotationsFile({ version: 2, byMessageId: {} }).byMessageId).toEqual({})
  })
})

describe('reading room tools', () => {
  it('never hands a private note to the agent', async () => {
    const { getMessageNotesHandler, listKeptContextHandler } = await import('../agents/readingRoomHandlers')
    const { text } = articleOf(body)
    const now = '2026-10-06T10:00:00.000Z'
    let file = addNote(emptyAnnotationsFile(), identity(text), note(text, 'reply', 'first week of March', 'Propose the second week.'), now)
    file = addNote(file, identity(text), note(text, 'private', 'the budget is fixed', 'The board chair is the problem.'), now)
    file = setContext(file, identity(text), { title: 'The spring pilot', summary: '', topics: [], include: { message: true, replyNotes: true, privateNotes: false }, scope: 'mail', keptAt: now }, now)
    const used: string[] = []
    const room = { fileRef: { current: file }, recordContextUse: async (ids: string[]) => void used.push(...ids) }
    const context = { store: { messages: [] }, accountId: undefined, readingRoom: room } as never
    const notes = getMessageNotesHandler(context, { messageId: 'm1' }).content
    expect(notes).toContain('Propose the second week.')
    expect(notes).not.toContain('board chair')
    expect(notes).toContain('1 private note')
    const kept = (await listKeptContextHandler(context, { query: 'pilot' })).content
    expect(kept).not.toContain('board chair')
    expect(used).toEqual(['m1'])
  })
})
