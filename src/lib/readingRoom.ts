/**
 * The reading room: a message read like an article, with notes in two inks.
 *
 * - Notes for the reply (blue ink) are what the assistant drafts a reply from.
 * - Private notes (pencil) are the reader's alone. They never go into a reply,
 *   and the agent tools never return them.
 * - A highlight marks a passage without a note; it is the reader's too.
 *
 * A message can also be kept as context: a title, a sentence, topics, what
 * goes in, and who may use it (PureMail only, or every app). Kept context for
 * every app is also written out as a Markdown file any app's assistant can
 * read. Everything here is pure; storage lives in readingRoomPersistence.ts.
 */

import { plainTextSegments } from './plainTextLinks'

export type NoteKind = 'reply' | 'private' | 'highlight'
export type ContextScope = 'mail' | 'all'

export interface MessageNote {
  id: string
  kind: NoteKind
  /** The passage, exactly as the article shows it; empty for a note on the whole message. */
  quote: string
  /** Where the passage sits in the article text; re-found by its quote if the text moved. */
  start: number
  end: number
  text: string
  createdAt: string
  updatedAt?: string
}

export interface KeptContext {
  title: string
  /** One sentence on what the message is about. */
  summary: string
  topics: string[]
  include: { message: boolean; replyNotes: boolean; privateNotes: boolean }
  scope: ContextScope
  keptAt: string
  /** The Markdown file written for every-app context, when there is one. */
  file?: string
  lastUsed?: { by: string; at: string }
}

export interface MessageAnnotations {
  messageId: string
  threadId: string
  accountId?: string
  subject: string
  from: { name: string; email: string }
  receivedAt: string
  /** The article text when first annotated, so notes and context outlive the mail cache. */
  article: string
  notes: MessageNote[]
  context?: KeptContext
  replyRequestedAt?: string
  updatedAt: string
}

export interface AnnotationsFile {
  version: 1
  byMessageId: Record<string, MessageAnnotations>
}

export const emptyAnnotationsFile = (): AnnotationsFile => ({ version: 1, byMessageId: {} })

/* ----------------------------------------------------------------- article */

export interface ArticleRun {
  text: string
  href?: string
}

export interface ArticleParagraph {
  /** Offset of the paragraph's first character in the article text. */
  start: number
  text: string
  runs: ArticleRun[]
}

export interface Article {
  /** The paragraphs' display text joined by blank lines: what offsets count in. */
  text: string
  paragraphs: ArticleParagraph[]
}

/**
 * The readable article from a message's visible text: blank-line groups are
 * paragraphs, and links show as their labels (as the reader shows them), so
 * a selection in the room maps exactly onto this text.
 */
export function articleOf(source: string): Article {
  const blocks = source
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.replace(/^\n+|\n+$/g, ''))
    .filter(block => block.trim().length > 0)
  const paragraphs: ArticleParagraph[] = []
  let offset = 0
  for (const block of blocks) {
    const runs: ArticleRun[] = plainTextSegments(block).map(segment =>
      segment.kind === 'link' ? { text: segment.text, href: segment.href } : { text: segment.text },
    )
    const text = runs.map(run => run.text).join('')
    if (!text.trim()) continue
    if (paragraphs.length) offset += 2
    paragraphs.push({ start: offset, text, runs })
    offset += text.length
  }
  return { text: paragraphs.map(paragraph => paragraph.text).join('\n\n'), paragraphs }
}

/** Where a note's passage is in the article now, or null when it can no longer be found. */
export function resolveNote(articleText: string, note: Pick<MessageNote, 'quote' | 'start' | 'end'>): { start: number; end: number } | null {
  if (!note.quote) return null
  if (articleText.slice(note.start, note.end) === note.quote) return { start: note.start, end: note.end }
  const at = articleText.indexOf(note.quote)
  return at === -1 ? null : { start: at, end: at + note.quote.length }
}

export interface ArticlePiece extends ArticleRun {
  noteId?: string
  kind?: NoteKind
}

/**
 * A paragraph cut into pieces at the edges of the notes it holds. Passages
 * never overlap in the room: a note whose passage overlaps an earlier one is
 * left out of the marks (it still shows in the margin).
 */
export function paragraphPieces(paragraph: ArticleParagraph, marks: readonly { id: string; kind: NoteKind; start: number; end: number }[]): ArticlePiece[] {
  const from = paragraph.start
  const to = paragraph.start + paragraph.text.length
  const inside = marks
    .filter(mark => mark.start < to && mark.end > from)
    .map(mark => ({ ...mark, start: Math.max(mark.start, from) - from, end: Math.min(mark.end, to) - from }))
    .sort((a, b) => a.start - b.start)
  const kept: typeof inside = []
  for (const mark of inside) if (!kept.length || mark.start >= kept[kept.length - 1].end) kept.push(mark)
  const pieces: ArticlePiece[] = []
  let runStart = 0
  for (const run of paragraph.runs) {
    const runEnd = runStart + run.text.length
    let cursor = runStart
    for (const mark of kept) {
      if (mark.end <= cursor || mark.start >= runEnd) continue
      if (mark.start > cursor) pieces.push({ ...run, text: paragraph.text.slice(cursor, mark.start) })
      const end = Math.min(mark.end, runEnd)
      pieces.push({ ...run, text: paragraph.text.slice(Math.max(mark.start, cursor), end), noteId: mark.id, kind: mark.kind })
      cursor = end
    }
    if (cursor < runEnd) pieces.push({ ...run, text: paragraph.text.slice(cursor, runEnd) })
    runStart = runEnd
  }
  return pieces.filter(piece => piece.text.length > 0)
}

/* ------------------------------------------------------------------- notes */

export interface NoteCounts {
  reply: number
  private: number
  highlight: number
}

export function noteCounts(record: Pick<MessageAnnotations, 'notes'> | undefined): NoteCounts {
  const counts: NoteCounts = { reply: 0, private: 0, highlight: 0 }
  for (const note of record?.notes ?? []) counts[note.kind] += 1
  return counts
}

/** Notes in reading order: notes on the whole message first, then by passage. */
export function orderedNotes(record: MessageAnnotations, articleText = record.article): MessageNote[] {
  const position = (note: MessageNote) => (note.quote ? (resolveNote(articleText, note)?.start ?? Number.MAX_SAFE_INTEGER) : -1)
  return [...record.notes].sort((a, b) => position(a) - position(b) || a.createdAt.localeCompare(b.createdAt))
}

export interface MessageIdentity {
  messageId: string
  threadId: string
  accountId?: string
  subject: string
  from: { name: string; email: string }
  receivedAt: string
  article: string
}

/** The message's record, made when it is first annotated or kept. */
export function recordFor(file: AnnotationsFile, identity: MessageIdentity, now: string): MessageAnnotations {
  return file.byMessageId[identity.messageId] ?? { ...identity, notes: [], updatedAt: now }
}

function withRecord(file: AnnotationsFile, record: MessageAnnotations): AnnotationsFile {
  const byMessageId = { ...file.byMessageId }
  // A record with nothing in it is not kept: no notes, no context.
  if (!record.notes.length && !record.context) delete byMessageId[record.messageId]
  else byMessageId[record.messageId] = record
  return { ...file, byMessageId }
}

export function addNote(file: AnnotationsFile, identity: MessageIdentity, note: MessageNote, now: string): AnnotationsFile {
  const record = recordFor(file, identity, now)
  return withRecord(file, { ...record, notes: [...record.notes, note], updatedAt: now })
}

export function updateNote(file: AnnotationsFile, messageId: string, noteId: string, patch: Partial<Pick<MessageNote, 'text' | 'kind'>>, now: string): AnnotationsFile {
  const record = file.byMessageId[messageId]
  if (!record) return file
  return withRecord(file, {
    ...record,
    notes: record.notes.map(note => (note.id === noteId ? { ...note, ...patch, updatedAt: now } : note)),
    updatedAt: now,
  })
}

export function removeNote(file: AnnotationsFile, messageId: string, noteId: string, now: string): AnnotationsFile {
  const record = file.byMessageId[messageId]
  if (!record) return file
  return withRecord(file, { ...record, notes: record.notes.filter(note => note.id !== noteId), updatedAt: now })
}

export function setContext(file: AnnotationsFile, identity: MessageIdentity, context: KeptContext | undefined, now: string): AnnotationsFile {
  const record = recordFor(file, identity, now)
  return withRecord(file, { ...record, context, updatedAt: now })
}

export function markReplyRequested(file: AnnotationsFile, messageId: string, now: string): AnnotationsFile {
  const record = file.byMessageId[messageId]
  return record ? withRecord(file, { ...record, replyRequestedAt: now, updatedAt: now }) : file
}

/* ---------------------------------------------------------- reply and tools */

/**
 * What the assistant is given to draft a reply: the notes for the reply,
 * each with its passage. Private notes and highlights are never part of it.
 */
export function replyBrief(record: MessageAnnotations): string {
  const notes = orderedNotes(record).filter(note => note.kind === 'reply' && note.text.trim())
  if (!notes.length) return ''
  const lines = [
    `Reply to the message from ${record.from.name || record.from.email} ("${record.subject}"), using only the reader's notes below. Each note says what to answer; keep the reader's voice, short and warm. Do not add facts, dates or commitments the notes do not contain.`,
  ]
  notes.forEach((note, index) => {
    lines.push(note.quote ? `${index + 1}. On the passage "${note.quote}": ${note.text.trim()}` : `${index + 1}. On the whole message: ${note.text.trim()}`)
  })
  return lines.join('\n')
}

/** A note as the agent tools show it. Private notes are never passed through here. */
export function noteForAgent(note: MessageNote): { id: string; kind: 'reply' | 'highlight'; passage: string; note: string } | null {
  if (note.kind === 'private') return null
  return { id: note.id, kind: note.kind, passage: note.quote || '(the whole message)', note: note.text }
}

/** The kept context as the agent tools show it: only what the reader chose to include. */
export function contextForAgent(record: MessageAnnotations) {
  const context = record.context
  if (!context) return null
  const notes = orderedNotes(record)
  return {
    messageId: record.messageId,
    threadId: record.threadId,
    title: context.title,
    summary: context.summary,
    topics: context.topics,
    scope: context.scope,
    from: record.from,
    receivedAt: record.receivedAt,
    keptAt: context.keptAt,
    ...(context.include.message ? { message: record.article } : {}),
    ...(context.include.replyNotes
      ? { notesForTheReply: notes.filter(note => note.kind === 'reply').map(note => ({ passage: note.quote || '(the whole message)', note: note.text })) }
      : {}),
    ...(context.include.privateNotes
      ? { privateNotesTheReaderIncluded: notes.filter(note => note.kind === 'private').map(note => ({ passage: note.quote || '(the whole message)', note: note.text })) }
      : {}),
  }
}

/** Kept context that matches a search: title, summary, topics, sender or the message itself. */
export function matchesContext(record: MessageAnnotations, query: string, topic?: string): boolean {
  const context = record.context
  if (!context) return false
  if (topic && !context.topics.some(item => item.toLowerCase() === topic.toLowerCase())) return false
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [context.title, context.summary, context.topics.join(' '), record.from.name, record.from.email, record.subject, context.include.message ? record.article : '']
    .join(' ')
    .toLowerCase()
  return words.every(word => haystack.includes(word))
}

/* ------------------------------------------------------- the shared file */

export const CONTEXT_FOLDER = ['Context', 'PureMail'] as const

/** A readable, stable file name for a kept message. */
export function contextFileName(record: Pick<MessageAnnotations, 'messageId' | 'subject' | 'receivedAt'>, title?: string): string {
  const base = (title || record.subject || 'message')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'message'
  const day = record.receivedAt.slice(0, 10)
  const id = record.messageId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'mail'
  return `${day ? `${day}-` : ''}${base}-${id}.md`
}

const yamlString = (value: string) => JSON.stringify(value)

/**
 * The Markdown file for context kept for every app: front matter any app can
 * read, then the sentence, what the reader decided, and the message itself,
 * each only when the reader chose to include it.
 */
export function contextMarkdown(record: MessageAnnotations): string {
  const context = record.context
  if (!context) return ''
  const notes = orderedNotes(record)
  const reply = notes.filter(note => note.kind === 'reply')
  const privateNotes = notes.filter(note => note.kind === 'private')
  const lines = [
    '---',
    'source: PureMail',
    `title: ${yamlString(context.title)}`,
    `from: ${yamlString(record.from.name ? `${record.from.name} <${record.from.email}>` : record.from.email)}`,
    `received: ${yamlString(record.receivedAt)}`,
    `subject: ${yamlString(record.subject)}`,
    `topics: [${context.topics.map(yamlString).join(', ')}]`,
    `kept: ${yamlString(context.keptAt)}`,
    `messageId: ${yamlString(record.messageId)}`,
    '---',
    '',
    `# ${context.title}`,
    '',
  ]
  if (context.summary.trim()) lines.push(context.summary.trim(), '')
  if (context.include.replyNotes && reply.length) {
    lines.push('## What I decided', '')
    reply.forEach(note => lines.push(note.quote ? `- On “${note.quote}”: ${note.text.trim()}` : `- ${note.text.trim()}`))
    lines.push('')
  }
  if (context.include.privateNotes && privateNotes.length) {
    lines.push('## My private notes', '')
    privateNotes.forEach(note => lines.push(note.quote ? `- On “${note.quote}”: ${note.text.trim()}` : `- ${note.text.trim()}`))
    lines.push('')
  }
  if (context.include.message) lines.push('## The message', '', record.article.trim(), '')
  return lines.join('\n')
}

/** Topics typed as a comma-separated line, tidied. */
export function parseTopics(value: string): string[] {
  return [...new Set(value.split(',').map(topic => topic.trim()).filter(Boolean))].slice(0, 12)
}

/** All topics across kept context, most used first. */
export function contextTopics(file: AnnotationsFile): string[] {
  const counts = new Map<string, number>()
  for (const record of Object.values(file.byMessageId)) for (const topic of record.context?.topics ?? []) counts.set(topic, (counts.get(topic) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([topic]) => topic)
}

/** Reads a stored file, keeping only well-formed records and notes. */
export function parseAnnotationsFile(value: unknown): AnnotationsFile {
  const file = emptyAnnotationsFile()
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return file
  const records = (value as { byMessageId?: unknown }).byMessageId
  if (!records || typeof records !== 'object') return file
  const text = (input: unknown) => (typeof input === 'string' ? input : '')
  for (const [messageId, raw] of Object.entries(records as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const from = (record.from ?? {}) as Record<string, unknown>
    const notes = (Array.isArray(record.notes) ? record.notes : [])
      .filter((note): note is Record<string, unknown> => !!note && typeof note === 'object')
      .filter(note => note.kind === 'reply' || note.kind === 'private' || note.kind === 'highlight')
      .map(note => ({
        id: text(note.id) || `note-${Math.random().toString(36).slice(2, 10)}`,
        kind: note.kind as NoteKind,
        quote: text(note.quote),
        start: typeof note.start === 'number' ? note.start : 0,
        end: typeof note.end === 'number' ? note.end : 0,
        text: text(note.text),
        createdAt: text(note.createdAt) || new Date(0).toISOString(),
        ...(text(note.updatedAt) ? { updatedAt: text(note.updatedAt) } : {}),
      }))
    const rawContext = record.context as Record<string, unknown> | undefined
    const include = (rawContext?.include ?? {}) as Record<string, unknown>
    const context: KeptContext | undefined =
      rawContext && typeof rawContext === 'object'
        ? {
            title: text(rawContext.title) || text(record.subject),
            summary: text(rawContext.summary),
            topics: Array.isArray(rawContext.topics) ? rawContext.topics.filter((topic): topic is string => typeof topic === 'string') : [],
            include: { message: include.message !== false, replyNotes: include.replyNotes !== false, privateNotes: include.privateNotes === true },
            scope: rawContext.scope === 'all' ? 'all' : 'mail',
            keptAt: text(rawContext.keptAt) || text(record.updatedAt),
            ...(text(rawContext.file) ? { file: text(rawContext.file) } : {}),
            ...(rawContext.lastUsed && typeof rawContext.lastUsed === 'object'
              ? { lastUsed: { by: text((rawContext.lastUsed as Record<string, unknown>).by), at: text((rawContext.lastUsed as Record<string, unknown>).at) } }
              : {}),
          }
        : undefined
    if (!notes.length && !context) continue
    file.byMessageId[messageId] = {
      messageId,
      threadId: text(record.threadId),
      ...(text(record.accountId) ? { accountId: text(record.accountId) } : {}),
      subject: text(record.subject),
      from: { name: text(from.name), email: text(from.email) },
      receivedAt: text(record.receivedAt),
      article: text(record.article),
      notes,
      ...(context ? { context } : {}),
      ...(text(record.replyRequestedAt) ? { replyRequestedAt: text(record.replyRequestedAt) } : {}),
      updatedAt: text(record.updatedAt),
    }
  }
  return file
}
