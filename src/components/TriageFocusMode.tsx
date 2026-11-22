import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  BellOff,
  CheckCircle2,
  Clock,
  Reply,
  SkipForward,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import styled from 'styled-components'
import {
  formatDecisionModelLabel,
  type TriageActionChoice,
  type TriageActionDecision,
} from '../lib/mailDecisionOps'
import type { MailThread } from '../types'
import { TimePickerPopover } from './TimePickerPopover'

export interface TriageFocusModeProps {
  open: boolean
  threads: MailThread[]
  currentIndex: number
  triagedCount: number
  totalCount: number
  decisionHint?: TriageActionDecision | null
  onClose: () => void
  onArchive: (threadId: string) => void
  onTrash: (threadId: string) => void
  onSnooze: (threadId: string, iso: string) => void
  onStar: (threadId: string) => void
  onMute: (threadId: string) => void
  onReply: (threadId: string) => void
  onSkip: () => void
  onUndo?: () => void
  canUndo?: boolean
  renderPreview: (thread: MailThread) => ReactNode
}

function triageActionLabel(action: TriageActionChoice): string {
  switch (action) {
    case 'reply':
      return 'Reply'
    case 'archive':
      return 'Archive'
    case 'snooze':
      return 'Snooze'
    case 'unsubscribe':
      return 'Unsubscribe / Mute'
    case 'create_task':
      return 'Track as task'
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--platform-z-index-zi-app-modal, 300);
  display: flex;
  flex-direction: column;
  background: var(--n-ground);
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const TopBar = styled.header`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 48px;
  padding: 0 20px;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-sheet);
`

const TopLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
`

const Title = styled.h2`
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
`

const ProgressWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const ProgressTrack = styled.div`
  width: 140px;
  height: 5px;
  border-radius: 3px;
  background: var(--n-selected);
  overflow: hidden;
`

const ProgressFill = styled.div<{ $percent: number }>`
  width: ${props => `${props.$percent}%`};
  height: 100%;
  background: var(--pure-chrome-accent, var(--p-text));
  transition: width 0.2s ease;
`

const ProgressLabel = styled.span`
  color: var(--n-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`

const TopActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`

const TopBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--n-btn-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--n-hover);
  }
  &:disabled {
    border-color: var(--n-fence);
    background: var(--n-panel);
    color: var(--n-faint);
    cursor: default;
  }
`

const Stage = styled.main`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
`

const PreviewCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 780px;
  min-height: 260px;
  max-height: 100%;
  padding: 20px 24px;
  box-sizing: border-box;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.14);
  overflow: auto;
`

const PreviewSubject = styled.h3`
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--n-ink);
`

const InboxZeroCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 460px;
  margin: auto;
  padding: 40px 28px;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.12);
  text-align: center;
`

const ZeroIcon = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--p-done-border, var(--p-done-line));
  border-radius: 6px;
  background: var(--p-done-bg, var(--p-done-tint));
  color: var(--p-done-fg, var(--p-done-text));
`

const ZeroTitle = styled.h3`
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 700;
`

const ZeroDesc = styled.p`
  margin: 0;
  color: var(--n-soft);
  font-size: 13px;
  line-height: 1.5;
`

const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--pure-chrome-accent, var(--p-text));
  border-radius: 3px;
  background: var(--pure-chrome-accent, var(--p-text));
  color: var(--pure-chrome-on-accent, var(--p-on-text));
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    filter: brightness(0.95);
  }
`

const HudBar = styled.footer`
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 16px;
  border-top: 1px solid var(--n-line);
  background: var(--n-sheet);
`

const HudActionWrap = styled.div`
  position: relative;
  display: inline-flex;
`

const UpPopoverAnchor = styled.div`
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  z-index: var(--platform-z-index-zi-app-menus, 100);

  & > div {
    position: static;
  }
`

const HudButton = styled.button<{ $danger?: boolean; $suggested?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid
    ${props =>
      props.$suggested
        ? 'var(--pure-chrome-accent, var(--p-text))'
        : 'var(--n-btn-line)'};
  border-radius: 4px;
  background: ${props =>
    props.$suggested ? 'var(--p-tint)' : 'var(--n-panel)'};
  color: ${props =>
    props.$danger
      ? 'var(--p-failed-fg, var(--p-failed-text))'
      : props.$suggested
        ? 'var(--p-on-tint, var(--n-ink))'
        : 'var(--n-ink)'};
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${props =>
      props.$suggested ? 'var(--p-tint)' : 'var(--n-hover)'};
    filter: ${props => (props.$suggested ? 'brightness(0.97)' : 'none')};
  }
  &:disabled {
    color: var(--n-faint);
    border-color: var(--n-fence);
    cursor: default;
  }
`

const HintPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--p-line, var(--n-line));
  border-radius: 3px;
  background: var(--p-tint);
  color: var(--p-on-tint, var(--n-ink));
  font-size: 11.5px;
  font-weight: 600;
`

const Kbd = styled.kbd`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-soft);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
`

export function TriageFocusMode({
  open,
  threads,
  currentIndex,
  triagedCount,
  totalCount,
  decisionHint,
  onClose,
  onArchive,
  onTrash,
  onSnooze,
  onStar,
  onMute,
  onReply,
  onSkip,
  onUndo,
  canUndo = false,
  renderPreview,
}: TriageFocusModeProps): React.ReactElement | null {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const exitBtnRef = useRef<HTMLButtonElement | null>(null)

  const currentThread =
    threads.length > 0
      ? threads[Math.min(Math.max(currentIndex, 0), threads.length - 1)]
      : undefined

  useEffect(() => {
    setSnoozeOpen(false)
  }, [open, currentThread?.id])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      exitBtnRef.current?.focus()
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (snoozeOpen) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      const lower = event.key.toLowerCase()
      if (lower === 'z' && canUndo && onUndo) {
        event.preventDefault()
        onUndo()
        return
      }

      if (!currentThread) return

      if (lower === 'e') {
        event.preventDefault()
        onArchive(currentThread.id)
      } else if (event.key === '#') {
        event.preventDefault()
        onTrash(currentThread.id)
      } else if (lower === 'h') {
        event.preventDefault()
        setSnoozeOpen(true)
      } else if (lower === 's') {
        event.preventDefault()
        onStar(currentThread.id)
      } else if (lower === 'm') {
        event.preventDefault()
        onMute(currentThread.id)
      } else if (lower === 'r') {
        event.preventDefault()
        onReply(currentThread.id)
      } else if (lower === 'j') {
        event.preventDefault()
        onSkip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    open,
    snoozeOpen,
    currentThread,
    canUndo,
    onClose,
    onArchive,
    onTrash,
    onStar,
    onMute,
    onReply,
    onSkip,
    onUndo,
  ])

  if (!open) return null

  const safeTotal = Math.max(totalCount, triagedCount, threads.length)
  const percent =
    safeTotal > 0 ? Math.min(100, Math.round((triagedCount / safeTotal) * 100)) : 100

  return (
    <Overlay role="dialog" aria-modal="true" aria-label="Triage focus mode">
      <TopBar>
        <TopLeft>
          <Title>Triage Focus</Title>
          <ProgressWrap>
            <ProgressTrack
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={safeTotal}
              aria-valuenow={triagedCount}
              aria-label="Triage progress"
            >
              <ProgressFill $percent={percent} />
            </ProgressTrack>
            <ProgressLabel>
              {triagedCount} of {safeTotal}
            </ProgressLabel>
          </ProgressWrap>
        </TopLeft>

        <TopActions>
          {onUndo && (
            <TopBtn
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="Undo last triage"
            >
              <Undo2 size={13} aria-hidden="true" />
              Undo
              <Kbd>Z</Kbd>
            </TopBtn>
          )}
          <TopBtn
            ref={exitBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Exit triage focus mode"
          >
            <X size={13} aria-hidden="true" />
            Exit
            <Kbd>Esc</Kbd>
          </TopBtn>
        </TopActions>
      </TopBar>

      <Stage>
        {currentThread ? (
          <PreviewCard>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <PreviewSubject>{currentThread.subject || '(no subject)'}</PreviewSubject>
              {decisionHint && (
                <HintPill
                  data-testid="triage-decision-hint"
                  title={`${formatDecisionModelLabel(
                    decisionHint.provider,
                    decisionHint.model,
                  )} (${Math.round(decisionHint.confidence * 100)}% confidence)`}
                >
                  <Sparkles size={11} aria-hidden="true" />
                  <span>
                    Suggested: {triageActionLabel(decisionHint.action)} (
                    {Math.round(decisionHint.confidence * 100)}%)
                    {decisionHint.urgencyScore >= 1 && decisionHint.urgencyLabel
                      ? ` · ${decisionHint.urgencyLabel}`
                      : ''}
                  </span>
                </HintPill>
              )}
            </div>
            {renderPreview(currentThread)}
          </PreviewCard>
        ) : (
          <InboxZeroCard data-testid="triage-inbox-zero">
            <ZeroIcon aria-hidden="true">
              <CheckCircle2 size={22} />
            </ZeroIcon>
            <ZeroTitle>Inbox Zero</ZeroTitle>
            <ZeroDesc>
              {triagedCount > 0
                ? `You triaged ${triagedCount} ${
                    triagedCount === 1 ? 'thread' : 'threads'
                  }. Everything in this queue is cleared.`
                : 'Nothing left to triage in this queue.'}
            </ZeroDesc>
            <PrimaryBtn type="button" onClick={onClose}>
              Done
            </PrimaryBtn>
          </InboxZeroCard>
        )}
      </Stage>

      {currentThread && (
        <HudBar aria-label="Triage keyboard actions">
          <HudButton
            type="button"
            $suggested={decisionHint?.action === 'archive'}
            onClick={() => onArchive(currentThread.id)}
          >
            <Kbd>E</Kbd>
            <Archive size={13} aria-hidden="true" />
            Archive
          </HudButton>

          <HudActionWrap>
            <HudButton
              type="button"
              $suggested={decisionHint?.action === 'snooze'}
              aria-expanded={snoozeOpen}
              onClick={() => setSnoozeOpen(prev => !prev)}
            >
              <Kbd>H</Kbd>
              <Clock size={13} aria-hidden="true" />
              Snooze
            </HudButton>
            {snoozeOpen && (
              <UpPopoverAnchor>
                <TimePickerPopover
                  mode="snooze"
                  onSelect={iso => {
                    setSnoozeOpen(false)
                    onSnooze(currentThread.id, iso)
                  }}
                  onClose={() => setSnoozeOpen(false)}
                />
              </UpPopoverAnchor>
            )}
          </HudActionWrap>

          <HudButton
            type="button"
            $danger
            onClick={() => onTrash(currentThread.id)}
          >
            <Kbd>#</Kbd>
            <Trash2 size={13} aria-hidden="true" />
            Trash
          </HudButton>

          <HudButton type="button" onClick={() => onStar(currentThread.id)}>
            <Kbd>S</Kbd>
            <Star size={13} aria-hidden="true" />
            Star
          </HudButton>

          <HudButton
            type="button"
            $suggested={decisionHint?.action === 'unsubscribe'}
            onClick={() => onMute(currentThread.id)}
          >
            <Kbd>M</Kbd>
            <BellOff size={13} aria-hidden="true" />
            Mute
          </HudButton>

          <HudButton
            type="button"
            $suggested={decisionHint?.action === 'reply'}
            onClick={() => onReply(currentThread.id)}
          >
            <Kbd>R</Kbd>
            <Reply size={13} aria-hidden="true" />
            Reply
          </HudButton>

          <HudButton type="button" onClick={onSkip}>
            <Kbd>J</Kbd>
            <SkipForward size={13} aria-hidden="true" />
            Skip
          </HudButton>

          {onUndo && (
            <HudButton type="button" disabled={!canUndo} onClick={onUndo}>
              <Kbd>Z</Kbd>
              <Undo2 size={13} aria-hidden="true" />
              Undo
            </HudButton>
          )}
        </HudBar>
      )}
    </Overlay>
  )
}
