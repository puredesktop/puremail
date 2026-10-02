import { useState } from 'react'
import { styled } from 'styled-components'
import { ArrowLeft, Bookmark, FolderOpen, Lock, Search } from 'lucide-react'
import {
  contextTopics,
  matchesContext,
  noteCounts,
  orderedNotes,
  type AnnotationsFile,
  type ContextScope,
  type MessageAnnotations,
} from '../lib/readingRoom'
import { BarButton, INK, PENCIL, READING_SERIF } from './readingRoomStyles'

const day = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
const when = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const byRecent = (a: MessageAnnotations, b: MessageAnnotations) => b.updatedAt.localeCompare(a.updatedAt)

/** Every message read and marked, with what was written beside it. */
export function NotesIndex({
  file,
  onBack,
  onOpen,
  onDraftReply,
}: {
  file: AnnotationsFile
  onBack: () => void
  onOpen: (messageId: string) => void
  onDraftReply: (record: MessageAnnotations) => void
}): React.ReactElement {
  const [show, setShow] = useState<'all' | 'reply' | 'private'>('all')
  const [query, setQuery] = useState('')
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const records = Object.values(file.byMessageId)
    .filter(record => record.notes.length)
    .filter(record => show === 'all' || record.notes.some(note => note.kind === show))
    .filter(record => {
      if (!words.length) return true
      const haystack = [record.subject, record.from.name, record.from.email, ...record.notes.map(note => `${note.quote} ${note.text}`)].join(' ').toLowerCase()
      return words.every(word => haystack.includes(word))
    })
    .sort(byRecent)

  return (
    <Library aria-label="Notes">
      <Head>
        <BarButton type="button" data-quiet="true" onClick={onBack} aria-label="Back to mail">
          <ArrowLeft aria-hidden="true" />
        </BarButton>
        <div className="title">
          <h1>Notes</h1>
          <p>Every message you have read and marked, with what you wrote beside it. Private notes are only ever yours.</p>
        </div>
        <span style={{ flex: 1 }} />
        <div className="segments" role="group" aria-label="Show">
          {(['all', 'reply', 'private'] as const).map(value => (
            <button key={value} type="button" aria-pressed={show === value} onClick={() => setShow(value)}>
              {value === 'all' ? 'All' : value === 'reply' ? 'For the reply' : 'Private'}
            </button>
          ))}
        </div>
        <SearchBox>
          <Search aria-hidden="true" />
          <input aria-label="Search notes" placeholder="Search notes" value={query} onChange={event => setQuery(event.target.value)} />
        </SearchBox>
      </Head>
      <List>
        {!records.length ? (
          <Empty>
            {Object.keys(file.byMessageId).length
              ? 'Nothing matches.'
              : 'No notes yet. Open a message with Read, select words, and note them for the reply or for yourself.'}
          </Empty>
        ) : (
          records.map(record => {
            const counts = noteCounts(record)
            const notes = orderedNotes(record).filter(note => show === 'all' || note.kind === show)
            return (
              <Card key={record.messageId}>
                <div className="top">
                  <div className="who">
                    <span className="meta">
                      {record.from.name || record.from.email} · {day(record.receivedAt)}
                    </span>
                    <h2>{record.subject || '(no subject)'}</h2>
                  </div>
                  {record.replyRequestedAt ? <span className="state">Reply drafted</span> : null}
                </div>
                <div className="notes">
                  {notes.slice(0, 4).map(note => (
                    <div key={note.id} className="note" data-ink={note.kind}>
                      <span className="mark" aria-hidden="true">
                        {note.kind === 'private' ? <Lock /> : null}
                      </span>
                      <span className="words">
                        <span className="quote">{note.quote ? `“${note.quote}”` : 'On the whole message'}</span>
                        {note.text ? <span className="text">{note.text}</span> : <span className="text plain">Highlighted</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="foot">
                  <BarButton type="button" onClick={() => onOpen(record.messageId)}>
                    Open in the reading room
                  </BarButton>
                  <BarButton type="button" disabled={!counts.reply} onClick={() => onDraftReply(record)}>
                    Draft a reply
                  </BarButton>
                  <span style={{ flex: 1 }} />
                  <span className="counts">
                    {counts.reply ? `${counts.reply} for the reply` : ''}
                    {counts.reply && counts.private ? ' · ' : ''}
                    {counts.private ? `${counts.private} private` : ''}
                    {notes.length > 4 ? ` · ${notes.length - 4} more` : ''}
                  </span>
                </div>
              </Card>
            )
          })
        )}
      </List>
    </Library>
  )
}

/** Messages kept as context: who may use each, and when it was last used. */
export function ContextIndex({
  file,
  onBack,
  onOpen,
  onScope,
  onRemove,
  onReveal,
  notice,
}: {
  notice?: string | null
  file: AnnotationsFile
  onBack: () => void
  onOpen: (messageId: string) => void
  onScope: (record: MessageAnnotations, scope: ContextScope) => void
  onRemove: (record: MessageAnnotations) => void
  onReveal: (path: string) => void
}): React.ReactElement {
  const [topic, setTopic] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const topics = contextTopics(file)
  const records = Object.values(file.byMessageId)
    .filter(record => record.context && matchesContext(record, query, topic ?? undefined))
    .sort((a, b) => (b.context?.keptAt ?? '').localeCompare(a.context?.keptAt ?? ''))

  return (
    <Library aria-label="Context">
      <Head>
        <BarButton type="button" data-quiet="true" onClick={onBack} aria-label="Back to mail">
          <ArrowLeft aria-hidden="true" />
        </BarButton>
        <div className="title">
          <h1>Context</h1>
          <p>Messages you kept for later. Your assistants can draw on them. Each says who may use it and when PureMail’s assistant last did.</p>
        </div>
        <span style={{ flex: 1 }} />
        <SearchBox>
          <Search aria-hidden="true" />
          <input aria-label="Search context" placeholder="Search context" value={query} onChange={event => setQuery(event.target.value)} />
        </SearchBox>
      </Head>
      {notice ? <Problem role="status">{notice}</Problem> : null}
      {topics.length ? (
        <Topics role="group" aria-label="Topics">
          <button type="button" aria-pressed={topic === null} onClick={() => setTopic(null)}>
            All
          </button>
          {topics.map(item => (
            <button key={item} type="button" aria-pressed={topic === item} onClick={() => setTopic(item)}>
              {item}
            </button>
          ))}
        </Topics>
      ) : null}
      <List>
        {!records.length ? (
          <Empty>
            {query || topic ? 'Nothing matches.' : 'Nothing kept yet. In the reading room, “Keep as context” saves a message for your assistants to draw on.'}
          </Empty>
        ) : (
          records.map(record => {
            const context = record.context!
            const counts = noteCounts(record)
            const parts = [
              context.include.message ? 'the message' : '',
              context.include.replyNotes && counts.reply ? `${counts.reply} ${counts.reply === 1 ? 'note' : 'notes'} for the reply` : '',
              context.include.privateNotes && counts.private ? `${counts.private} private ${counts.private === 1 ? 'note' : 'notes'}` : '',
            ].filter(Boolean)
            return (
              <Card key={record.messageId}>
                <div className="top">
                  <div className="who">
                    <span className="meta">
                      {record.from.name || record.from.email} · {day(record.receivedAt)}
                    </span>
                    <h2>{context.title}</h2>
                  </div>
                  <span className="scope" data-scope={context.scope}>
                    {context.scope === 'all' ? 'All my apps' : 'PureMail only'}
                  </span>
                </div>
                {context.summary ? <p className="summary">{context.summary}</p> : null}
                <div className="line">
                  {context.topics.map(item => (
                    <span key={item} className="topic">
                      {item}
                    </span>
                  ))}
                  <span className="parts">
                    {parts.length ? parts.join(' and ').replace(/^./, letter => letter.toUpperCase()) : 'Only the title and sentence'}
                    {counts.private && !context.include.privateNotes ? ' · private notes left out' : ''}
                  </span>
                </div>
                <div className="foot">
                  <span className="used">{context.lastUsed ? `Last used by ${context.lastUsed.by}, ${when(context.lastUsed.at)}` : 'Not used yet'}</span>
                  <span style={{ flex: 1 }} />
                  <BarButton type="button" data-quiet="true" onClick={() => onOpen(record.messageId)}>
                    Open
                  </BarButton>
                  <BarButton type="button" data-quiet="true" onClick={() => onScope(record, context.scope === 'all' ? 'mail' : 'all')}>
                    {context.scope === 'all' ? 'PureMail only' : 'Share with all my apps'}
                  </BarButton>
                  {context.file ? (
                    <BarButton type="button" data-quiet="true" onClick={() => onReveal(context.file!)} aria-label="Show the shared file">
                      <FolderOpen aria-hidden="true" />
                    </BarButton>
                  ) : null}
                  <BarButton type="button" data-quiet="true" onClick={() => onRemove(record)}>
                    Remove
                  </BarButton>
                </div>
              </Card>
            )
          })
        )}
      </List>
    </Library>
  )
}

export function ContextIcon(): React.ReactElement {
  return <Bookmark aria-hidden="true" />
}

const Library = styled.section`
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 32px 40px 60px;
  background: var(--puremail-reader-bg, #eceef1);
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family);
`

const Head = styled.header`
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  max-width: 980px;
  margin: 0 auto 16px;
  .title {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 560px;
  }
  h1 {
    margin: 0;
    font: 400 34px/1.1 ${READING_SERIF};
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.55;
    color: var(--platform-colors-text-secondary);
  }
  .segments {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: var(--platform-colors-surface-hover);
  }
  .segments button {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--platform-colors-text-secondary);
    font: 500 13px var(--platform-typography-font-family);
    cursor: pointer;
  }
  .segments button[aria-pressed='true'] {
    background: var(--puremail-message-bg, #ffffff);
    color: var(--platform-colors-text);
    box-shadow: 0 1px 2px rgba(20, 25, 40, 0.1);
  }
`

const SearchBox = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  width: 220px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--platform-colors-border);
  border-radius: 10px;
  background: var(--puremail-message-bg, #ffffff);
  svg {
    width: 15px;
    height: 15px;
    color: var(--platform-colors-text-tertiary);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--platform-colors-text);
    font: 400 14px var(--platform-typography-font-family);
  }
`

const Topics = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 980px;
  margin: 0 auto 16px;
  button {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 99px;
    background: var(--platform-colors-surface-hover);
    color: var(--platform-colors-text-secondary);
    font: 500 13px var(--platform-typography-font-family);
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: var(--platform-colors-text);
    color: var(--puremail-message-bg, #ffffff);
  }
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 980px;
  margin: 0 auto;
`

const Problem = styled.p`
  max-width: 980px;
  margin: 0 auto 14px;
  padding: 9px 12px;
  border-radius: 9px;
  background: var(--puremail-warning-bg, #fdf4de);
  color: var(--puremail-warning-text, #6b4e0c);
  font-size: 13px;
`

const Empty = styled.p`
  margin: 24px 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--platform-colors-text-tertiary);
`

const Card = styled.article`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 24px;
  border-radius: 14px;
  background: var(--puremail-message-bg, #ffffff);
  box-shadow: 0 1px 2px rgba(20, 25, 40, 0.05);
  .top {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .meta {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--platform-colors-text-tertiary);
  }
  h2 {
    margin: 0;
    font: 400 21px/1.25 ${READING_SERIF};
  }
  .state {
    flex: none;
    padding: 4px 10px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--platform-colors-success, #1e7d4f) 14%, transparent);
    color: var(--platform-colors-success, #1e7d4f);
    font-size: 12.5px;
    font-weight: 500;
  }
  .scope {
    flex: none;
    padding: 4px 10px;
    border-radius: 99px;
    background: var(--platform-colors-surface-hover);
    color: var(--platform-colors-text-secondary);
    font-size: 12.5px;
    font-weight: 500;
  }
  .scope[data-scope='all'] {
    background: color-mix(in srgb, ${INK} 13%, transparent);
    color: ${INK};
  }
  .summary {
    margin: 0;
    font: italic 400 16.5px/1.5 ${READING_SERIF};
    color: var(--platform-colors-text);
  }
  .notes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 28px;
  }
  @media (max-width: 760px) {
    .notes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .note {
    display: flex;
    gap: 10px;
  }
  .note .mark {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    border-radius: 50%;
  }
  .note[data-ink='reply'] .mark {
    background: ${INK};
  }
  .note[data-ink='private'] .mark {
    border: 1.5px dashed #858b93;
    color: ${PENCIL};
  }
  .note[data-ink='highlight'] .mark {
    background: #f6edc9;
  }
  .note .mark svg {
    width: 10px;
    height: 10px;
  }
  .words {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .quote {
    font-size: 12.5px;
    font-style: italic;
    color: var(--platform-colors-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    font-size: 14px;
    line-height: 1.5;
    color: var(--platform-colors-text-secondary);
  }
  .note[data-ink='reply'] .text {
    font: italic 400 16px/1.45 ${READING_SERIF};
    color: ${INK};
  }
  .text.plain {
    font-style: normal;
  }
  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .topic {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 9px;
    border-radius: 99px;
    background: var(--platform-colors-surface-hover);
    font-size: 12.5px;
  }
  .parts {
    margin-left: 6px;
    font-size: 12.5px;
    color: var(--platform-colors-text-tertiary);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px solid var(--platform-colors-border-subtle, var(--platform-colors-border));
  }
  .counts,
  .used {
    font-size: 12.5px;
    color: var(--platform-colors-text-tertiary);
  }
`
