import { MailAnnotationDocument } from './MailAnnotationDocument'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bookmark, BookmarkCheck, Lock, Maximize2, Minimize2, PenLine, Reply } from 'lucide-react'
import type { MailMessage } from '../types'
import { readerMailBody } from '../lib/mailTextUtils'
export { identityOf } from '../lib/readingRoomIdentity'
import {
  articleOf,
  noteCounts,
  orderedNotes,
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
  NoteCard,
  NoteEditor,
  Notice,
  Prose,
  Room,
  RoomBar,
  RoomColumns,
  RoomScroll,
  Rule,
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
  const [expanded, setExpanded] = useState(true)
  const [fontSize, setFontSize] = useState(19)
  const [noteKind,setNoteKind] = useState<NoteKind>('reply')
  const [generalOpen,setGeneralOpen] = useState(false)
  const [editingGeneral,setEditingGeneral] = useState<string|null>(null)
  const [showPrivate, setShowPrivate] = useState(true)
  const [keeping, setKeeping] = useState(false)
  const notes = record ? orderedNotes(record, article.text) : []
  const counts = noteCounts(record)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); onBack() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])

  const save = async (passage: Pending, text: string) => {
    const note: MessageNote = { id: newId(), kind: passage.kind, quote: passage.quote, start: passage.start, end: passage.end, text: text.trim(), createdAt: new Date().toISOString() }
    setGeneralOpen(false)
    await room.addNote(identity, note)
  }

  const replyCount = counts.reply
  const kept = !!record?.context

  const content = (
    <Room aria-label="Reading room" data-expanded={expanded}>
      <RoomBar>
        <BarButton type="button" data-quiet="true" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Back to mail
        </BarButton>
        <BarButton type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)} title={expanded ? 'Restore reader size' : 'Expand reader'}>
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          {expanded ? 'Restore' : 'Expand'}
        </BarButton>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          Text size
          <input type="range" aria-label="Reading text size" min={15} max={28} step={1} value={fontSize} onChange={event => setFontSize(Number(event.target.value))} style={{ width: 90 }} />
          <output style={{ minWidth: 32 }}>{fontSize}px</output>
        </label>
        <BarButton type="button" aria-pressed={noteKind==='private'} onClick={()=>setNoteKind(value=>value==='reply'?'private':'reply')} title="Choose whether new annotations guide the reply or stay private">
          {noteKind==='private'?'New notes: private':'New notes: for the reply'}
        </BarButton>
        <span style={{ flex: 1 }} />
        <BarButton type="button" onClick={() => {
          setGeneralOpen(true)
          setTimeout(() => { document.getElementById('reading-room-whole-note')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          document.getElementById('reading-room-whole-note')?.focus({ preventScroll: true }) }, 0)
        }} title="Add a note about the whole reply, without selecting a passage">
          <PenLine aria-hidden="true" />General note
        </BarButton>
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
        <RoomColumns>
          <Sheet>
            <Kicker>{identity.from.name || identity.from.email}</Kicker>
            <Headline>{identity.subject || '(no subject)'}</Headline>
            <Dateline>
              {formatDate(identity.receivedAt)}
              {identity.from.name ? ` · ${identity.from.email}` : ''}
            </Dateline>
            <Rule />
            {generalOpen || notes.some(note=>!note.quote) ? <WholeNote>
              <label htmlFor="reading-room-whole-note">General note</label>
              {notes.filter(note=>!note.quote&&(showPrivate||note.kind!=='private')).map(note=><NoteCard key={note.id} data-ink={note.kind}><div className="body"><p className="text">{note.text}</p>{editingGeneral===note.id ? <InkEditor initialText={note.text} initialKind={note.kind} allowHighlight={false} onCancel={()=>setEditingGeneral(null)} onSave={(text,kind)=>{void room.updateNote(identity.messageId,note.id,{text:text.trim(),kind});setEditingGeneral(null)}}/> : null}<div className="actions"><span>{note.kind==='private'?'Private':'For the reply'}</span><button type="button" onClick={()=>setEditingGeneral(note.id)}>Edit</button><button type="button" onClick={()=>void room.removeNote(identity.messageId,note.id)}>Delete</button></div></div></NoteCard>)}
              {generalOpen ? <InkEditor id="reading-room-whole-note" initialText="" initialKind={noteKind} allowHighlight={false} onCancel={()=>setGeneralOpen(false)} saveLabel="Add note" onSave={(text,kind)=>{if(text.trim())void save({kind,quote:'',start:0,end:0},text)}}/> : null}
            </WholeNote> : null}
            <Prose $fontSize={fontSize}>
              <MailAnnotationDocument source={source} identity={identity} room={room} showPrivate={showPrivate} noteKind={noteKind}/>
            </Prose>
          </Sheet>


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
  return expanded ? createPortal(content, document.body) : content
}

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
