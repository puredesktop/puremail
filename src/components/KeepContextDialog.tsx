import { useEffect, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { Check, Sparkles } from 'lucide-react'
import { contextTopics, noteCounts, parseTopics, type ContextScope, type MessageAnnotations, type MessageIdentity } from '../lib/readingRoom'
import type { ReadingRoomStore } from '../hooks/useReadingRoom'
import { BarButton, INK, READING_SERIF } from './readingRoomStyles'

/**
 * Keep a message as context: a title, a sentence, topics, what goes in, and
 * who may use it. Private notes are left out unless the reader ticks them.
 */
export function KeepContextDialog({
  identity,
  record,
  room,
  onClose,
  onWriteSummary,
}: {
  identity: MessageIdentity
  record: MessageAnnotations | undefined
  room: ReadingRoomStore
  onClose: () => void
  onWriteSummary: () => void
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const existing = record?.context
  const counts = noteCounts(record)
  const [title, setTitle] = useState(existing?.title ?? identity.subject)
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [topics, setTopics] = useState((existing?.topics ?? []).join(', '))
  const [include, setInclude] = useState(existing?.include ?? { message: true, replyNotes: true, privateNotes: false })
  const [scope, setScope] = useState<ContextScope>(existing?.scope ?? 'mail')
  const known = contextTopics(room.file).filter(topic => !parseTopics(topics).includes(topic)).slice(0, 6)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  const keep = async () => {
    await room.keepContext(identity, {
      title: title.trim() || identity.subject,
      summary: summary.trim(),
      topics: parseTopics(topics),
      include,
      scope,
      keptAt: existing?.keptAt ?? new Date().toISOString(),
      ...(existing?.file ? { file: existing.file } : {}),
      ...(existing?.lastUsed ? { lastUsed: existing.lastUsed } : {}),
    })
    onClose()
  }

  const parts: { key: keyof typeof include; label: string; hint: string }[] = [
    { key: 'message', label: 'The message', hint: `${identity.from.name || identity.from.email}${identity.receivedAt ? `, ${new Date(identity.receivedAt).toLocaleDateString()}` : ''}` },
    { key: 'replyNotes', label: `Notes for the reply (${counts.reply})`, hint: 'What you decided, in your own words' },
    { key: 'privateNotes', label: `Private notes (${counts.private})`, hint: 'Off unless you choose. Private notes are only ever yours.' },
  ]

  return (
    <Dialog
      ref={dialog}
      aria-label="Keep as context"
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        if (event.target === dialog.current) onClose()
      }}
    >
      <h1>Keep as context</h1>
      <p className="lead">
        Kept messages become context your assistants can draw on later, here in PureMail or in your other apps. You choose what goes in and who may use it.
      </p>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={event => setTitle(event.target.value)} />
      </label>
      <label className="field">
        <span className="split">
          In a sentence
          <button type="button" className="link" onClick={onWriteSummary}>
            <Sparkles aria-hidden="true" />
            Write it with the assistant
          </button>
        </span>
        <textarea rows={2} value={summary} placeholder="What this message is about, in a sentence" onChange={event => setSummary(event.target.value)} />
      </label>
      <label className="field">
        <span>Topics</span>
        <input value={topics} placeholder="Separate topics with commas" onChange={event => setTopics(event.target.value)} />
        {known.length ? (
          <span className="known">
            {known.map(topic => (
              <button key={topic} type="button" onClick={() => setTopics(current => [...parseTopics(current), topic].join(', '))}>
                {topic}
              </button>
            ))}
          </span>
        ) : null}
      </label>
      <div className="field">
        <span>What goes in</span>
        {parts.map(part => (
          <button
            key={part.key}
            type="button"
            role="checkbox"
            aria-checked={include[part.key]}
            className="part"
            onClick={() => setInclude(current => ({ ...current, [part.key]: !current[part.key] }))}
          >
            <span className="box" data-on={include[part.key] ? 'true' : undefined}>
              {include[part.key] ? <Check aria-hidden="true" /> : null}
            </span>
            <span className="words">
              <b>{part.label}</b>
              <span>{part.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="field">
        <span>Who may use it</span>
        <div className="scopes" role="radiogroup" aria-label="Who may use it">
          <button type="button" role="radio" aria-checked={scope === 'mail'} onClick={() => setScope('mail')}>
            <b>PureMail only</b>
            <span>PureMail’s assistant can use it, for example when you next write to this person.</span>
          </button>
          <button type="button" role="radio" aria-checked={scope === 'all'} onClick={() => setScope('all')}>
            <b>All my apps</b>
            <span>Also saved as a file in your Pure folder, under Context, for any app’s assistant to read.</span>
          </button>
        </div>
        <span className="hint">Kept on this computer. An assistant reads it only when it bears on what you ask.</span>
      </div>
      <footer>
        {existing ? (
          <BarButton
            type="button"
            data-quiet="true"
            onClick={() => {
              void room.keepContext(identity, undefined)
              onClose()
            }}
          >
            Stop keeping it
          </BarButton>
        ) : null}
        <span style={{ flex: 1 }} />
        <BarButton type="button" data-quiet="true" onClick={onClose}>
          Cancel
        </BarButton>
        <BarButton type="button" data-primary="true" onClick={() => void keep()}>
          {existing ? 'Save' : 'Keep as context'}
        </BarButton>
      </footer>
    </Dialog>
  )
}

const Dialog = styled.dialog`
  width: min(540px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  box-sizing: border-box;
  padding: 28px 30px 22px;
  border: 0;
  border-radius: 16px;
  background: var(--puremail-message-bg, #ffffff);
  color: var(--platform-colors-text);
  box-shadow: 0 2px 6px rgba(20, 25, 40, 0.06), 0 28px 64px -28px rgba(20, 25, 40, 0.4);
  font-family: var(--platform-typography-font-family);
  &[open] {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  &::backdrop {
    background: rgba(20, 25, 40, 0.28);
    backdrop-filter: blur(2px);
  }
  h1 {
    margin: 0;
    font: 400 26px/1.15 ${READING_SERIF};
  }
  .lead {
    margin: -8px 0 0;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--platform-colors-text-secondary);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field > span:first-child {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--platform-colors-text-tertiary);
  }
  .split {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  input,
  textarea {
    box-sizing: border-box;
    padding: 9px 11px;
    border: 1px solid var(--platform-colors-border);
    border-radius: 9px;
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    font: 400 14px var(--platform-typography-font-family);
  }
  textarea {
    resize: none;
    font: italic 400 16px/1.45 ${READING_SERIF};
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: none;
    color: ${INK};
    font: 500 12.5px var(--platform-typography-font-family);
    cursor: pointer;
  }
  .link svg {
    width: 13px;
    height: 13px;
  }
  .known {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .known button {
    height: 28px;
    padding: 0 10px;
    border: 1px dashed var(--platform-colors-border);
    border-radius: 99px;
    background: transparent;
    color: var(--platform-colors-text-secondary);
    font: 500 12.5px var(--platform-typography-font-family);
    cursor: pointer;
  }
  .part {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .part:hover {
    background: var(--platform-colors-surface-hover);
  }
  .box {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border: 1.5px solid var(--platform-colors-border);
    border-radius: 5px;
  }
  .box[data-on='true'] {
    border-color: ${INK};
    background: ${INK};
    color: #ffffff;
  }
  .box svg {
    width: 12px;
    height: 12px;
    stroke-width: 3;
  }
  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .words b {
    font-size: 14px;
    font-weight: 500;
  }
  .words span {
    font-size: 12.5px;
    color: var(--platform-colors-text-tertiary);
  }
  .scopes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .scopes button {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1.5px solid var(--platform-colors-border);
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .scopes button[aria-checked='true'] {
    border-color: ${INK};
    background: color-mix(in srgb, ${INK} 6%, transparent);
  }
  .scopes b {
    font-size: 14px;
    font-weight: 600;
  }
  .scopes span {
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--platform-colors-text-secondary);
  }
  .hint {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--platform-colors-text-tertiary);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
  }
`
