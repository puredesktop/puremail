import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Forward,
  Reply,
  ReplyAll,
  Send,
  Sparkles,
} from 'lucide-react'
import styled from 'styled-components'
import type { SnippetMatchDecision } from '../lib/mailDecisionOps'

export type QuickReplySendResult =
  | boolean
  | { ok: boolean; error?: string }
  | void

export interface QuickReplyBarProps {
  threadId?: string
  recipientSummary: string
  busy?: boolean
  suggestedSnippet?: SnippetMatchDecision | null
  onSend: (
    body: string,
    event?: React.SyntheticEvent | Event,
  ) => Promise<QuickReplySendResult> | QuickReplySendResult
  onExpandToCompose: (draftBody: string) => void
  onReplyAll?: () => void
  onForward?: () => void
}

const BarRoot = styled.div`
  flex: none;
  border-top: 1px solid var(--n-line);
  background: var(--n-panel);
  padding: 10px 16px;
  font-family: var(--platform-typography-font-family, sans-serif);
`

const Card = styled.div<{ $expanded: boolean }>`
  display: flex;
  flex-direction: column;
  border: 1px solid
    ${props =>
      props.$expanded
        ? 'var(--pure-chrome-accent, var(--p-text))'
        : 'var(--n-line)'};
  border-radius: 5px;
  background: var(--n-sheet);
  transition: border-color 0.12s ease;
  overflow: hidden;
`

const CollapsedRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
`

const TriggerButton = styled.button`
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--n-faint);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: text;

  &:hover {
    color: var(--n-soft);
  }
`

const RecipientLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ExpandedHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px 4px;
  color: var(--n-faint);
  font-size: 11.5px;
`

const Textarea = styled.textarea`
  width: 100%;
  min-height: 70px;
  max-height: 168px;
  padding: 4px 12px 10px;
  border: 0;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.48;
  resize: none;
  outline: none;
  box-sizing: border-box;

  &::placeholder {
    color: var(--n-faint);
  }
`

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid var(--n-fence);
  background: var(--n-panel);
`

const FooterGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

const SubtleBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--n-soft);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--n-line);
    background: var(--n-sheet);
    color: var(--n-ink);
  }
  &:disabled {
    color: var(--n-disabled);
    cursor: default;
  }
`

const HintText = styled.span`
  color: var(--n-faint);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 10.5px;
`

const SendBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--pure-chrome-accent, var(--p-text));
  border-radius: 3px;
  background: var(--pure-chrome-accent, var(--p-text));
  color: var(--pure-chrome-on-accent, var(--p-on-text));
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  &:disabled {
    border-color: var(--n-fence);
    background: var(--n-panel);
    color: var(--n-faint);
    cursor: default;
  }
`

export function QuickReplyBar({
  threadId,
  recipientSummary,
  busy = false,
  suggestedSnippet,
  onSend,
  onExpandToCompose,
  onReplyAll,
  onForward,
}: QuickReplyBarProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setBody('')
    setExpanded(false)
    setSendError(null)
  }, [threadId])

  useEffect(() => {
    if (!expanded) return
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [expanded])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const nextHeight = Math.min(Math.max(el.scrollHeight, 70), 168)
    el.style.height = `${nextHeight}px`
  }, [body, expanded])

  const trimmed = body.trim()

  const handleSend = async (
    event?: React.SyntheticEvent | Event,
  ): Promise<void> => {
    if (!trimmed || busy) return
    setSendError(null)
    try {
      const result = await onSend(body, event)
      if (result === false) {
        setSendError('Message was not sent. Your reply text has been kept.')
        return
      }
      if (typeof result === 'object' && result !== null && result.ok === false) {
        setSendError(
          result.error || 'Message was not sent. Your reply text has been kept.',
        )
        return
      }
      setBody('')
      setExpanded(false)
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : 'Message was not sent. Your reply text has been kept.',
      )
    }
  }

  return (
    <BarRoot data-quick-reply-bar="">
      <Card $expanded={expanded}>
        {!expanded ? (
          <CollapsedRow>
            <TriggerButton
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`Quick reply to ${recipientSummary}`}
            >
              <Reply size={14} style={{ flex: 'none' }} aria-hidden="true" />
              <RecipientLabel>
                Quick reply to {recipientSummary}…
              </RecipientLabel>
            </TriggerButton>
            {suggestedSnippet && (
              <SubtleBtn
                type="button"
                onClick={() => {
                  setBody(suggestedSnippet.body)
                  setExpanded(true)
                }}
                title={`Insert suggested snippet "${suggestedSnippet.title}" (${Math.round(
                  suggestedSnippet.confidence * 100,
                )}% match)`}
                style={{
                  borderColor: 'var(--p-line, var(--n-line))',
                  background: 'var(--p-tint)',
                  color: 'var(--p-on-tint, var(--n-ink))',
                }}
              >
                <Sparkles size={11} aria-hidden="true" />
                {suggestedSnippet.title}
              </SubtleBtn>
            )}
            {onReplyAll && (
              <SubtleBtn type="button" onClick={onReplyAll}>
                <ReplyAll size={12} aria-hidden="true" />
                Reply all
              </SubtleBtn>
            )}
            {onForward && (
              <SubtleBtn type="button" onClick={onForward}>
                <Forward size={12} aria-hidden="true" />
                Forward
              </SubtleBtn>
            )}
          </CollapsedRow>
        ) : (
          <>
            <ExpandedHeader>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Reply size={12} aria-hidden="true" />
                <span>Replying to {recipientSummary}</span>
              </span>
              <SubtleBtn
                type="button"
                onClick={() => {
                  const draftBody = body
                  setBody('')
                  setSendError(null)
                  setExpanded(false)
                  onExpandToCompose(draftBody)
                }}
                title="Pop out to full composer"
              >
                <ArrowUpRight size={12} aria-hidden="true" />
                Pop out
              </SubtleBtn>
            </ExpandedHeader>

            <Textarea
              ref={textareaRef}
              rows={3}
              value={body}
              disabled={busy}
              onChange={event => {
                setBody(event.target.value)
                if (sendError) setSendError(null)
              }}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSend(event)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!trimmed) setExpanded(false)
                  else textareaRef.current?.blur()
                }
              }}
              placeholder="Write a quick reply…"
              aria-label={`Quick reply to ${recipientSummary}`}
            />
            {sendError && (
              <div
                role="alert"
                style={{
                  padding: '4px 12px 6px',
                  fontSize: 11.5,
                  color: 'var(--p-failed-text, var(--puremail-danger-text))',
                }}
              >
                {sendError}
              </div>
            )}

            <Footer>
              <FooterGroup>
                {onReplyAll && (
                  <SubtleBtn type="button" onClick={onReplyAll}>
                    <ReplyAll size={12} aria-hidden="true" />
                    Reply all
                  </SubtleBtn>
                )}
                {onForward && (
                  <SubtleBtn type="button" onClick={onForward}>
                    <Forward size={12} aria-hidden="true" />
                    Forward
                  </SubtleBtn>
                )}
              </FooterGroup>

              <FooterGroup>
                <HintText aria-hidden="true">⌘↵</HintText>
                <SendBtn
                  type="button"
                  data-release="send"
                  disabled={!trimmed || busy}
                  onClick={event => {
                    void handleSend(event)
                  }}
                >
                  <Send size={12} aria-hidden="true" />
                  {busy ? 'Sending…' : 'Send'}
                </SendBtn>
              </FooterGroup>
            </Footer>
          </>
        )}
      </Card>
    </BarRoot>
  )
}
