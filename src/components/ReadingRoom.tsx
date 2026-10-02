import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, BookmarkCheck, Highlighter, Lock, PenLine, Reply, Trash2 } from 'lucide-react'
import type { MailMessage } from '../types'
import { readerMailBody } from '../lib/mailTextUtils'
export { identityOf } from '../lib/readingRoomIdentity'
import {
  articleOf,
  noteCounts,
  orderedNotes,
  paragraphPieces,
  resolveNote,
  type MessageAnnotations,
  type MessageIdentity,
  type MessageNote,
  type NoteKind,
} from '../lib/readingRoom'
import type { ReadingRoomStore } from '../hooks/useReadingRoom'
import { KeepContextDialog } from './KeepContextDialog'
import {
  BarButton,
  Chip,
  Dateline,
  Headline,
  Kicker,
  Margin,
  MarginHead,
  NoteCard,
  NoteEditor,
  Notice,
  Prose,
  Room,
  RoomBar,
  RoomColumns,
  RoomScroll,
  Rule,
  SelectionBar,
  Sheet,
  Switch,
  WholeNote,
} from './readingRoomStyles'

interface Pending {
  kind: NoteKind
  quote: string
  start: number
  end: number
}

const newId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const formatDate = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/**
 * A message read like an article. Select words to note them for the reply
 * (blue ink), keep a private note (pencil), or just highlight. The notes for
 * the reply go to the assistant in the drawer; private notes never do.
 */
export function ReadingRoom({
  message,
  identity,
  room,
  onBack,
  onDraftReply,
  onWriteSummary,
}: {
  message: MailMessage | null
  identity: MessageIdentity
  room: ReadingRoomStore
  onBack: () => void
  onDraftReply: (record: MessageAnnotations) => void
  onWriteSummary: (identity: MessageIdentity) => void
}): React.ReactElement {
  const record = room.file.byMessageId[identity.messageId]
  const source = message ? readerMailBody(message).visibleText : identity.article
  const article = useMemo(() => articleOf(source), [source])
  const [showPrivate, setShowPrivate] = useState(true)
  const [active, setActive] = useState<string | null>(null)
  const [selection, setSelection] = useState<(Pending & { x: number; y: number }) | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [keeping, setKeeping] = useState(false)
  const columns = useRef<HTMLDivElement>(null)
  const prose = useRef<HTMLDivElement>(null)

  const notes = record ? orderedNotes(record, article.text) : []
  const visible = notes.filter(note => showPrivate || note.kind !== 'private')
  const counts = noteCounts(record)
  const marks = visible
    .map(note => ({ note, at: resolveNote(article.text, note) }))
    .filter((item): item is { note: MessageNote; at: { start: number; end: number } } => item.at !== null)
    .map(({ note, at }) => ({ id: note.id, kind: note.kind, ...at }))
  const numbers = new Map<string, string>()
  let count = 0
  for (const note of notes) if (note.kind !== 'highlight') numbers.set(note.id, note.quote ? String(++count) : '·')

  // A selection inside one paragraph becomes a passage the reader can note.
  const readSelection = () => {
    const selected = window.getSelection()
    const host = prose.current
    const frame = columns.current
    if (!selected || selected.isCollapsed || !host || !frame || selected.rangeCount === 0) {
      setSelection(null)
      return
    }
    const range = selected.getRangeAt(0)
    const paragraphOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('p[data-start]') as HTMLElement | null
    const startParagraph = paragraphOf(range.startContainer)
    if (!startParagraph || !host.contains(startParagraph)) {
      setSelection(null)
      return
    }
    const offsetIn = (paragraph: HTMLElement, node: Node, offset: number) => {
      const before = document.createRange()
      before.setStart(paragraph, 0)
      before.setEnd(node, offset)
      return Number(paragraph.dataset.start) + before.toString().length
    }
    let start = offsetIn(startParagraph, range.startContainer, range.startOffset)
    const endParagraph = paragraphOf(range.endContainer)
    let end =
      endParagraph === startParagraph
        ? offsetIn(startParagraph, range.endContainer, range.endOffset)
        : Number(startParagraph.dataset.start) + (startParagraph.textContent?.length ?? 0)
    while (start < end && /\s/.test(article.text[start])) start += 1
    while (end > start && /\s/.test(article.text[end - 1])) end -= 1
    if (end - start < 2) {
      setSelection(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const box = frame.getBoundingClientRect()
    setSelection({ kind: 'reply', quote: article.text.slice(start, end), start, end, x: rect.left + rect.width / 2 - box.left, y: rect.top - box.top })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelection(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const begin = (kind: NoteKind) => {
    if (!selection) return
    const passage = { kind, quote: selection.quote, start: selection.start, end: selection.end }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    if (kind === 'highlight') void save(passage, '')
    else setPending(passage)
  }

  const save = async (passage: Pending, text: string) => {
    const note: MessageNote = { id: newId(), kind: passage.kind, quote: passage.quote, start: passage.start, end: passage.end, text: text.trim(), createdAt: new Date().toISOString() }
    setPending(null)
    setActive(note.id)
    await room.addNote(identity, note)
  }

  const focusNote = (id: string) => {
    setActive(id)
    document.getElementById(`reading-mark-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const replyCount = counts.reply
  const kept = !!record?.context

  return (
    <Room aria-label="Reading room">
      <RoomBar>
        <BarButton type="button" data-quiet="true" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Back to mail
        </BarButton>
        <span style={{ flex: 1 }} />
        {counts.reply ? (
          <Chip data-ink="reply">
            <i />
            {counts.reply} for the reply
          </Chip>
        ) : null}
        {counts.private ? (
          <Chip data-ink="private">
            <Lock aria-hidden="true" />
            {counts.private} private
          </Chip>
        ) : null}
        <BarButton type="button" aria-pressed={showPrivate} onClick={() => setShowPrivate(value => !value)} title="Show or hide your private notes">
          <Switch $on={showPrivate} aria-hidden="true" />
          Private notes
        </BarButton>
        <BarButton type="button" onClick={() => setKeeping(true)} title="Keep this message as context for your assistants">
          {kept ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          {kept ? 'Kept as context' : 'Keep as context'}
        </BarButton>
        <BarButton
          type="button"
          data-primary="true"
          disabled={!replyCount || !record}
          title={replyCount ? 'The assistant drafts a reply from your notes for the reply. Private notes are never sent.' : 'Add a note for the reply first'}
          onClick={() => record && onDraftReply(record)}
        >
          <Reply aria-hidden="true" />
          {replyCount ? `Draft a reply from ${replyCount} ${replyCount === 1 ? 'note' : 'notes'}` : 'Draft a reply'}
        </BarButton>
      </RoomBar>
      {room.error ? <Notice role="status">{room.error}</Notice> : null}

      <RoomScroll>
        <RoomColumns ref={columns}>
          <Sheet>
            <Kicker>{identity.from.name || identity.from.email}</Kicker>
            <Headline>{identity.subject || '(no subject)'}</Headline>
            <Dateline>
              {formatDate(identity.receivedAt)}
              {identity.from.name ? ` · ${identity.from.email}` : ''}
            </Dateline>
            <Rule />
            <Prose ref={prose} onMouseUp={readSelection} onKeyUp={readSelection}>
              {article.paragraphs.length ? (
                article.paragraphs.map(paragraph => {
                  const pieces = paragraphPieces(paragraph, marks)
                  return (
                  <p key={paragraph.start} data-start={paragraph.start}>
                    {pieces.map((piece, index) => {
                      const content = piece.href ? (
                        <a href={piece.href} target="_blank" rel="noreferrer noopener">
                          {piece.text}
                        </a>
                      ) : (
                        piece.text
                      )
                      if (!piece.noteId) return <span key={index}>{content}</span>
                      // The note's number follows the last piece of its passage.
                      const isEnd = pieces[index + 1]?.noteId !== piece.noteId
                      return (
                        <span key={index}>
                          <mark
                            id={`reading-mark-${piece.noteId}`}
                            data-ink={piece.kind}
                            data-active={active === piece.noteId ? 'true' : undefined}
                            onClick={() => setActive(piece.noteId ?? null)}
                          >
                            {content}
                          </mark>
                          {isEnd && piece.kind !== 'highlight' ? <sup data-ink={piece.kind}>{numbers.get(piece.noteId)}</sup> : null}
                        </span>
                      )
                    })}
                  </p>
                  )
                })
              ) : (
                <p>This message has no text to read.</p>
              )}
            </Prose>
          </Sheet>

          {selection ? (
            <SelectionBar role="toolbar" aria-label="Note on the selected words" style={{ left: selection.x, top: selection.y }} onMouseDown={event => event.preventDefault()}>
              <button type="button" data-ink="reply" onClick={() => begin('reply')}>
                <PenLine aria-hidden="true" />
                Note for the reply
              </button>
              <button type="button" onClick={() => begin('private')}>
                <Lock aria-hidden="true" />
                Private note
              </button>
              <span aria-hidden="true" />
              <button type="button" onClick={() => begin('highlight')}>
                <Highlighter aria-hidden="true" />
                Highlight
              </button>
            </SelectionBar>
          ) : null}

          <Margin aria-label="Notes">
            <MarginHead>
              <h2>Notes</h2>
              <span>blue ink for the reply, pencil for you</span>
            </MarginHead>
            {pending ? <PendingNote pending={pending} onSave={text => void save(pending, text)} onCancel={() => setPending(null)} /> : null}
            {!visible.length && !pending ? (
              <p style={{ margin: '0 14px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--platform-colors-text-tertiary)' }}>
                Select words in the message to note them for the reply, keep a private note, or highlight them.
              </p>
            ) : null}
            {visible.map(note =>
              editing === note.id ? (
                <NoteCard key={note.id} data-ink={note.kind} data-active="true">
                  <span className="badge">{numbers.get(note.id)}</span>
                  <div className="body">
                    {note.quote ? <span className="quote">“{note.quote}”</span> : null}
                    <InkEditor
                      initialText={note.text}
                      initialKind={note.kind}
                      allowHighlight={!!note.quote}
                      onSave={(text, kind) => {
                        setEditing(null)
                        void room.updateNote(identity.messageId, note.id, { text: text.trim(), kind })
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                </NoteCard>
              ) : (
                <NoteCard key={note.id} data-ink={note.kind} data-active={active === note.id ? 'true' : undefined}>
                  <span className="badge">{note.kind === 'highlight' ? '' : numbers.get(note.id)}</span>
                  <div className="body">
                    {note.quote ? (
                      <button type="button" className="quote" onClick={() => focusNote(note.id)} title="Show the passage">
                        “{note.quote}”
                      </button>
                    ) : (
                      <span className="quote">On the whole message</span>
                    )}
                    {note.quote && !resolveNote(article.text, note) ? <span className="lost">This passage is no longer in the message.</span> : null}
                    {note.text ? <p className="text">{note.text}</p> : null}
                    {note.kind === 'private' ? (
                      <span className="private">
                        <Lock aria-hidden="true" />
                        Only you · never in the reply
                      </span>
                    ) : null}
                    <div className="actions">
                      <button type="button" onClick={() => setEditing(note.id)}>
                        <PenLine aria-hidden="true" />
                        {note.text ? 'Edit' : 'Add a note'}
                      </button>
                      <button type="button" aria-label="Remove note" onClick={() => void room.removeNote(identity.messageId, note.id)}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </NoteCard>
              ),
            )}
            {!showPrivate && counts.private ? (
              <p style={{ margin: '4px 14px', fontSize: 12.5, color: 'var(--platform-colors-text-tertiary)' }}>
                {counts.private} private {counts.private === 1 ? 'note' : 'notes'} hidden
              </p>
            ) : null}
            <WholeNote>
              <label htmlFor="reading-room-whole-note">A note on the whole message</label>
              <InkEditor
                key={`whole-${record?.notes.length ?? 0}`}
                id="reading-room-whole-note"
                initialText=""
                initialKind="reply"
                allowHighlight={false}
                saveLabel="Add"
                onSave={(text, kind) => {
                  if (text.trim()) void save({ kind, quote: '', start: 0, end: 0 }, text)
                }}
              />
            </WholeNote>
          </Margin>
        </RoomColumns>
      </RoomScroll>

      {keeping ? (
        <KeepContextDialog
          identity={identity}
          record={record}
          room={room}
          onClose={() => setKeeping(false)}
          onWriteSummary={() => {
            setKeeping(false)
            onWriteSummary(identity)
          }}
        />
      ) : null}
    </Room>
  )
}

function PendingNote({ pending, onSave, onCancel }: { pending: Pending; onSave: (text: string) => void; onCancel: () => void }): React.ReactElement {
  return (
    <NoteCard data-ink={pending.kind} data-active="true">
      <span className="badge">+</span>
      <div className="body">
        <span className="quote">“{pending.quote}”</span>
        <InkEditor initialText="" initialKind={pending.kind} allowHighlight={false} lockKind autoFocus onSave={text => onSave(text)} onCancel={onCancel} />
        {pending.kind === 'private' ? (
          <span className="private">
            <Lock aria-hidden="true" />
            Only you · never in the reply
          </span>
        ) : null}
      </div>
    </NoteCard>
  )
}

/** A note being written: its words, and which ink it is in. ⌘↵ saves, Esc cancels. */
function InkEditor({
  id,
  initialText,
  initialKind,
  allowHighlight,
  lockKind = false,
  autoFocus = false,
  saveLabel = 'Save',
  onSave,
  onCancel,
}: {
  id?: string
  initialText: string
  initialKind: NoteKind
  allowHighlight: boolean
  lockKind?: boolean
  autoFocus?: boolean
  saveLabel?: string
  onSave: (text: string, kind: NoteKind) => void
  onCancel?: () => void
}): React.ReactElement {
  const [text, setText] = useState(initialText)
  const [kind, setKind] = useState<NoteKind>(initialKind === 'highlight' && !allowHighlight ? 'reply' : initialKind)
  const inks: { value: NoteKind; label: string }[] = [
    { value: 'reply', label: 'For the reply' },
    { value: 'private', label: 'Private' },
    ...(allowHighlight ? [{ value: 'highlight' as const, label: 'Highlight' }] : []),
  ]
  return (
    <NoteEditor>
      <textarea
        id={id}
        value={text}
        autoFocus={autoFocus}
        placeholder={kind === 'private' ? 'A note only you will see…' : 'What to say about this…'}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSave(text, kind)
            setText(initialText)
          }
          if (event.key === 'Escape' && onCancel) {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="row">
        {lockKind
          ? null
          : inks.map(ink => (
              <button key={ink.value} type="button" className="ink" data-ink={ink.value} aria-pressed={kind === ink.value} onClick={() => setKind(ink.value)}>
                {ink.label}
              </button>
            ))}
        <span className="grow" />
        {onCancel ? (
          <BarButton type="button" data-quiet="true" onClick={onCancel}>
            Cancel
          </BarButton>
        ) : null}
        <BarButton
          type="button"
          onClick={() => {
            onSave(text, kind)
            setText(initialText)
          }}
        >
          {saveLabel}
        </BarButton>
      </div>
    </NoteEditor>
  )
}
