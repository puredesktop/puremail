import {
  Ban,
  ChevronRight,
  Inbox,
  Newspaper,
  Receipt,
  Shield,
  Sparkles,
} from 'lucide-react'
import styled, { css } from 'styled-components'
import {
  formatDecisionModelLabel,
  type ScreenerDecisionResult,
} from '../lib/mailDecisionOps'
import type { ScreenerDestination } from '../types'
import { formatThreadListTime, senderAvatar } from './mailShellHelpers'

export interface ScreenerSenderItem {
  email: string
  name: string
  latestThreadId: string
  latestSubject: string
  latestDate: string
  count: number
  suggestedDestination: ScreenerDestination
  modelSuggestion?: ScreenerDecisionResult | null
}

export interface ScreenerQueueProps {
  senders: ScreenerSenderItem[]
  compactBanner?: boolean
  onDecide: (
    email: string,
    destination: ScreenerDestination,
    name?: string,
  ) => void
  onOpenThread: (threadId: string) => void
  onOpenFullScreener?: () => void
}

const DECISIONS: ReadonlyArray<{
  value: ScreenerDestination
  label: string
  icon: React.ReactNode
}> = [
  { value: 'inbox', label: 'Inbox', icon: <Inbox size={12} /> },
  { value: 'feed', label: 'Feed', icon: <Newspaper size={12} /> },
  { value: 'paper_trail', label: 'Paper Trail', icon: <Receipt size={12} /> },
  { value: 'blocked', label: 'Block', icon: <Ban size={12} /> },
]

const BannerWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--n-line);
  background: var(--p-tint);
  color: var(--p-on-tint, var(--n-ink));
  font-family: var(--platform-typography-font-family, sans-serif);
  font-size: 12px;
`

const BannerLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const BannerText = styled.span`
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ReviewButton = styled.button`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--pure-chrome-accent, var(--p-text));
  border-radius: 3px;
  background: var(--pure-chrome-accent, var(--p-text));
  color: var(--pure-chrome-on-accent, var(--p-on-text));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    filter: brightness(0.95);
  }
`

const FullRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const FullHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--n-line);
`

const FullTitle = styled.h2`
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
`

const FullSubtitle = styled.span`
  color: var(--n-faint);
  font-size: 12px;
`

const CardsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Card = styled.article`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--n-line);
  border-radius: 5px;
  background: var(--n-sheet);
`

const CardTop = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 11px;
`

const Avatar = styled.div<{ $bg: string; $fg: string }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: ${props => props.$bg};
  color: ${props => props.$fg};
  font-size: 13.5px;
  font-weight: 700;
`

const SenderMeta = styled.div`
  flex: 1;
  min-width: 0;
`

const SenderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
`

const SenderName = styled.strong`
  font-size: 13.5px;
  font-weight: 700;
`

const SenderEmail = styled.span`
  color: var(--n-faint);
  font-size: 11.5px;
`

const CountBadge = styled.span`
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--n-fence);
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--n-soft);
  font-size: 10.5px;
  font-weight: 600;
`

const DateLabel = styled.span`
  margin-left: auto;
  color: var(--n-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
`

const SubjectBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--n-soft);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;

  &:hover {
    color: var(--pure-chrome-accent, var(--p-text));
    text-decoration: underline;
  }
`

const SubjectText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const DecisionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const DecisionPill = styled.button<{
  $suggested: boolean
  $danger?: boolean
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding: 0 10px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  ${props => {
    if (props.$danger && props.$suggested) {
      return css`
        border: 1px solid var(--p-failed-border, var(--p-failed-line));
        background: var(--p-failed-bg, var(--p-failed-tint));
        color: var(--p-failed-fg, var(--p-failed-text));
        &:hover {
          filter: brightness(0.97);
        }
      `
    }
    if (props.$danger) {
      return css`
        border: 1px solid var(--n-line);
        background: var(--n-panel);
        color: var(--p-failed-fg, var(--p-failed-text));
        &:hover {
          border-color: var(--p-failed-border, var(--p-failed-line));
          background: var(--p-failed-bg, var(--p-failed-tint));
        }
      `
    }
    if (props.$suggested) {
      return css`
        border: 1px solid var(--pure-chrome-accent, var(--p-text));
        background: var(--p-tint);
        color: var(--p-on-tint, var(--n-ink));
        &:hover {
          filter: brightness(0.97);
        }
      `
    }
    return css`
      border: 1px solid var(--n-btn-line);
      background: var(--n-sheet);
      color: var(--n-ink);
      &:hover {
        background: var(--n-hover);
      }
    `
  }}
`

const SuggestDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pure-chrome-accent, var(--p-text));
`

const EmptyBox = styled.div`
  padding: 28px 16px;
  border: 1px solid var(--n-fence);
  border-radius: 5px;
  background: var(--n-panel);
  color: var(--n-soft);
  font-size: 13px;
  text-align: center;
`

export function ScreenerQueue({
  senders,
  compactBanner = false,
  onDecide,
  onOpenThread,
  onOpenFullScreener,
}: ScreenerQueueProps): React.ReactElement | null {
  if (compactBanner) {
    if (senders.length === 0) return null
    return (
      <BannerWrap role="region" aria-label="Screener queue summary">
        <BannerLeft>
          <Shield
            size={14}
            style={{ color: 'var(--pure-chrome-accent, var(--p-text))', flex: 'none' }}
            aria-hidden="true"
          />
          <BannerText>
            {senders.length} new {senders.length === 1 ? 'sender' : 'senders'}{' '}
            waiting in Screener
          </BannerText>
        </BannerLeft>
        <ReviewButton
          type="button"
          onClick={() => {
            if (onOpenFullScreener) onOpenFullScreener()
            else if (senders[0]) onOpenThread(senders[0].latestThreadId)
          }}
        >
          Review
          <ChevronRight size={12} aria-hidden="true" />
        </ReviewButton>
      </BannerWrap>
    )
  }

  return (
    <FullRoot>
      <FullHeader>
        <FullTitle>
          <Shield
            size={15}
            style={{ color: 'var(--pure-chrome-accent, var(--p-text))' }}
            aria-hidden="true"
          />
          <span>Screener</span>
        </FullTitle>
        <FullSubtitle>
          {senders.length === 0
            ? 'No first-time senders waiting'
            : `${senders.length} first-time ${
                senders.length === 1 ? 'sender' : 'senders'
              } awaiting routing`}
        </FullSubtitle>
      </FullHeader>

      {senders.length === 0 ? (
        <EmptyBox>
          All first-time senders have been screened. New unknown senders will
          appear here before landing in your inbox.
        </EmptyBox>
      ) : (
        <CardsList>
          {senders.map(sender => {
            const avatar = senderAvatar(sender.name || sender.email)
            return (
              <Card key={sender.email}>
                <CardTop>
                  <Avatar $bg={avatar.bg} $fg={avatar.fg} aria-hidden="true">
                    {avatar.initial}
                  </Avatar>
                  <SenderMeta>
                    <SenderRow>
                      <SenderName>{sender.name || sender.email}</SenderName>
                      <SenderEmail>{sender.email}</SenderEmail>
                      <CountBadge>
                        {sender.count}{' '}
                        {sender.count === 1 ? 'message' : 'messages'}
                      </CountBadge>
                      <DateLabel>
                        {formatThreadListTime(sender.latestDate)}
                      </DateLabel>
                    </SenderRow>
                    <SubjectBtn
                      type="button"
                      onClick={() => onOpenThread(sender.latestThreadId)}
                      title="Preview latest thread"
                    >
                      <SubjectText>
                        {sender.latestSubject || '(No subject)'}
                      </SubjectText>
                    </SubjectBtn>
                  </SenderMeta>
                </CardTop>

                <DecisionRow
                  role="group"
                  aria-label={`Route mail from ${sender.name || sender.email}`}
                >
                  {DECISIONS.map(choice => {
                    const effectiveSuggested =
                      sender.modelSuggestion?.destination ??
                      sender.suggestedDestination
                    const suggested = effectiveSuggested === choice.value
                    const isModelBacked =
                      suggested &&
                      sender.modelSuggestion?.destination === choice.value
                    const pct = isModelBacked
                      ? Math.round(sender.modelSuggestion!.confidence * 100)
                      : null
                    return (
                      <DecisionPill
                        key={choice.value}
                        type="button"
                        $suggested={suggested}
                        $danger={choice.value === 'blocked'}
                        data-suggested={suggested ? 'true' : undefined}
                        title={
                          isModelBacked
                            ? `${formatDecisionModelLabel(
                                sender.modelSuggestion?.provider,
                                sender.modelSuggestion?.model,
                              )} suggests ${choice.label} (${pct}% confidence)`
                            : suggested
                              ? `Suggested: route to ${choice.label}`
                              : `Route to ${choice.label}`
                        }
                        onClick={() =>
                          onDecide(sender.email, choice.value, sender.name)
                        }
                      >
                        {suggested && (
                          <SuggestDot aria-label="Suggested destination" />
                        )}
                        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                          {choice.icon}
                        </span>
                        <span>{choice.label}</span>
                        {pct !== null && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                              marginLeft: 2,
                              opacity: 0.8,
                              fontSize: 10.5,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            <Sparkles size={10} aria-hidden="true" />
                            {pct}%
                          </span>
                        )}
                      </DecisionPill>
                    )
                  })}
                </DecisionRow>
              </Card>
            )
          })}
        </CardsList>
      )}
    </FullRoot>
  )
}
