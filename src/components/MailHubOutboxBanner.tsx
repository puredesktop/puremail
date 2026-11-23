import { useState } from 'react'
import { ChevronDown, ChevronRight, Clock, Send, Sparkles, X } from 'lucide-react'
import styled from 'styled-components'
import type { StagedMailDraft } from '@purescience/platform-ui/bridge/mailHub'
import { formatSourceAppLabel } from '../lib/mailHubSync'

export interface MailHubOutboxBannerProps {
  drafts: readonly StagedMailDraft[]
  onOpenInComposer: (draft: StagedMailDraft) => void | Promise<void>
  onDiscard: (draftId: string) => void | Promise<void>
}

const OutboxBar = styled.section`
  margin: 0;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-panel);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const OutboxHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 14px;
`

const OutboxToggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--n-text);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 2px;
    border-radius: 3px;
  }
`

const CountBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--p-accent-tint, rgba(59, 130, 246, 0.14));
  color: var(--p-accent, var(--n-text));
  font-size: 10.5px;
  font-weight: 700;
`

const HeaderHint = styled.span`
  font-size: 11px;
  color: var(--n-soft);
`

const DraftList = styled.div`
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--n-line);
`

const DraftRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-bg, transparent);

  &:last-child {
    border-bottom: 0;
  }
`

const DraftMeta = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
`

const SourcePill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: 3px;
  border: 1px solid var(--n-line);
  background: var(--n-panel);
  color: var(--n-text);
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
`

const SubjectText = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--n-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const RecipientRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--n-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FollowUpTag = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  color: var(--n-soft);
  white-space: nowrap;
`

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`

const OpenButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 4px;
  border: 1px solid var(--n-line);
  background: var(--n-panel);
  color: var(--n-text);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.1s ease, background 0.1s ease;

  &:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 2px;
  }
`

const DiscardButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 24px;
  padding: 0 7px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--n-soft);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--n-text);
    background: var(--n-panel);
    border-color: var(--n-line);
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid var(--pure-chrome-accent, var(--p-text));
    outline-offset: 2px;
  }
`

export function MailHubOutboxBanner({
  drafts,
  onOpenInComposer,
  onDiscard,
}: MailHubOutboxBannerProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(true)
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({})

  if (drafts.length === 0) return null

  const runAction = async (id: string, fn: () => void | Promise<void>) => {
    if (busyIds[id]) return
    setBusyIds(prev => ({ ...prev, [id]: true }))
    try {
      await fn()
    } finally {
      setBusyIds(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  return (
    <OutboxBar
      aria-label="Cross-App Outbox Review"
      data-testid="mail-hub-outbox-banner"
    >
      <OutboxHeader>
        <OutboxToggle
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(open => !open)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Sparkles size={12} aria-hidden="true" />
          <span>Cross-App Outbox</span>
          <CountBadge>{drafts.length}</CountBadge>
        </OutboxToggle>
        <HeaderHint>Nothing sends until you review &amp; send</HeaderHint>
      </OutboxHeader>
      {expanded && (
        <DraftList>
          {drafts.map(draft => {
            const sourceLabel = formatSourceAppLabel(draft.sourceApp)
            const recipients =
              draft.to.length > 0 ? draft.to.join(', ') : '(no recipients)'
            const busy = Boolean(busyIds[draft.id])
            return (
              <DraftRow
                key={draft.id}
                data-testid={`hub-outbox-draft-${draft.id}`}
              >
                <DraftMeta>
                  <TopRow>
                    <SourcePill title={`Staged by ${sourceLabel}`}>
                      From {sourceLabel}
                    </SourcePill>
                    <SubjectText title={draft.subject || '(no subject)'}>
                      {draft.subject || '(no subject)'}
                    </SubjectText>
                  </TopRow>
                  <RecipientRow>
                    <span title={recipients}>To: {recipients}</span>
                    {draft.followUpDays !== undefined && draft.followUpDays > 0 && (
                      <FollowUpTag>
                        <Clock size={10} aria-hidden="true" />
                        Follow-up in {draft.followUpDays}d
                      </FollowUpTag>
                    )}
                  </RecipientRow>
                </DraftMeta>
                <Actions>
                  <OpenButton
                    type="button"
                    disabled={busy}
                    data-testid={`hub-outbox-open-${draft.id}`}
                    onClick={() => void runAction(draft.id, () => onOpenInComposer(draft))}
                  >
                    <Send size={11} aria-hidden="true" />
                    Open in Composer
                  </OpenButton>
                  <DiscardButton
                    type="button"
                    disabled={busy}
                    aria-label={`Discard draft from ${sourceLabel}`}
                    data-testid={`hub-outbox-discard-${draft.id}`}
                    onClick={() => void runAction(draft.id, () => onDiscard(draft.id))}
                  >
                    <X size={12} aria-hidden="true" />
                    Discard
                  </DiscardButton>
                </Actions>
              </DraftRow>
            )
          })}
        </DraftList>
      )}
    </OutboxBar>
  )
}
