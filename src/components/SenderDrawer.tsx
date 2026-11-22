import {
  Building2,
  Filter,
  Mail,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react'
import styled, { css } from 'styled-components'
import type { SenderProfile } from '../lib/senderIntelligence'
import type { ScreenerDestination } from '../types'
import { formatThreadListTime, senderAvatar } from './mailShellHelpers'

export interface SenderDrawerProps {
  open: boolean
  profile: SenderProfile | null
  orgTitle?: string
  onClose: () => void
  onToggleVip: (email: string) => void
  onScreenDecision: (
    email: string,
    destination: ScreenerDestination,
    name?: string,
  ) => void
  onComposeTo: (email: string, name?: string) => void
  onCreateFilter: (email: string) => void
  onOpenThread: (threadId: string) => void
  onPreviewAttachment?: (
    threadId: string,
    messageId: string,
    attachmentId: string,
  ) => void
}

const ROUTING_OPTIONS: ReadonlyArray<{
  value: ScreenerDestination
  label: string
}> = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'feed', label: 'Feed' },
  { value: 'paper_trail', label: 'Paper Trail' },
  { value: 'blocked', label: 'Blocked' },
]

const DrawerRoot = styled.aside`
  display: flex;
  flex: none;
  flex-direction: column;
  width: 292px;
  min-height: 0;
  border-left: 1px solid var(--n-line);
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const TopBar = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-panel);
`

const Kicker = styled.span`
  color: var(--n-soft);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`

const CloseBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--n-faint);
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
    color: var(--n-ink);
  }
`

const ScrollBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`

const Section = styled.div`
  padding: 13px 14px;
  border-bottom: 1px solid var(--n-fence);
`

const IdentityRow = styled.div`
  display: flex;
  align-items: center;
  gap: 11px;
`

const Avatar = styled.div<{ $bg: string; $fg: string }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${props => props.$bg};
  color: ${props => props.$fg};
  font-size: 15px;
  font-weight: 700;
`

const NameBlock = styled.div`
  min-width: 0;
  flex: 1;
`

const SenderName = styled.div`
  overflow: hidden;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SenderEmail = styled.div`
  overflow: hidden;
  color: var(--n-soft);
  font-size: 11.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const MetaBadges = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
`

const DomainChip = styled.span`
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--n-soft);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 10.5px;
`

const OrgBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border: 1px solid var(--p-people-border, var(--p-people-line));
  border-radius: 3px;
  background: var(--p-people-bg, var(--p-people-tint));
  color: var(--p-people-fg, var(--p-people-text));
  font-size: 10.5px;
  font-weight: 600;
`

const AuthPill = styled.span<{ $tone: 'ok' | 'fail' | 'neutral' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 600;

  ${props => {
    if (props.$tone === 'ok') {
      return css`
        border: 1px solid var(--p-done-border, var(--p-done-line));
        background: var(--p-done-bg, var(--p-done-tint));
        color: var(--p-done-fg, var(--p-done-text));
      `
    }
    if (props.$tone === 'fail') {
      return css`
        border: 1px solid var(--p-failed-border, var(--p-failed-line));
        background: var(--p-failed-bg, var(--p-failed-tint));
        color: var(--p-failed-fg, var(--p-failed-text));
      `
    }
    return css`
      border: 1px solid var(--n-line);
      background: var(--n-panel);
      color: var(--n-soft);
    `
  }}
`

const ActionRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 11px;
`

const ActionButton = styled.button<{ $vipActive?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid
    ${props =>
      props.$vipActive
        ? 'var(--p-needs-you-border, var(--p-needs-you-line))'
        : 'var(--n-btn-line)'};
  border-radius: 3px;
  background: ${props =>
    props.$vipActive
      ? 'var(--p-needs-you-bg, var(--p-needs-you-tint))'
      : 'var(--n-sheet)'};
  color: ${props =>
    props.$vipActive
      ? 'var(--p-needs-you-fg, var(--p-needs-you-text))'
      : 'var(--n-ink)'};
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: ${props =>
      props.$vipActive
        ? 'var(--p-needs-you-bg, var(--p-needs-you-tint))'
        : 'var(--n-hover)'};
  }
`

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`

const MetricBox = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 6px;
  border: 1px solid var(--n-fence);
  border-radius: 4px;
  background: var(--n-panel);
`

const MetricNum = styled.span`
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
`

const MetricLabel = styled.span`
  margin-top: 2px;
  color: var(--n-faint);
  font-size: 10.5px;
`

const SectionHeader = styled.div`
  margin-bottom: 8px;
  color: var(--n-soft);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`

const SegmentedGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
`

const RoutePill = styled.button<{ $active: boolean; $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 8px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  ${props => {
    if (props.$active && props.$danger) {
      return css`
        border: 1px solid var(--p-failed-border, var(--p-failed-line));
        background: var(--p-failed-bg, var(--p-failed-tint));
        color: var(--p-failed-fg, var(--p-failed-text));
      `
    }
    if (props.$active) {
      return css`
        border: 1px solid var(--pure-chrome-accent, var(--p-text));
        background: var(--p-tint);
        color: var(--p-on-tint, var(--n-ink));
      `
    }
    return css`
      border: 1px solid var(--n-line);
      background: var(--n-panel);
      color: var(--n-soft);
      &:hover {
        background: var(--n-hover);
        color: var(--n-ink);
      }
    `
  }}
`

const ItemList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`

const ThreadRow = styled.button`
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--n-fence);
    background: var(--n-hover);
  }
`

const ThreadRowTop = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
`

const UnreadDot = styled.span`
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pure-chrome-accent, var(--p-text));
`

const ThreadSubject = styled.span<{ $unread: boolean }>`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: ${props => (props.$unread ? 700 : 500)};
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ThreadDate = styled.span`
  flex: none;
  color: var(--n-faint);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
`

const FileRow = styled.button`
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--n-fence);
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
  }
`

const FileName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const FileSize = styled.span`
  flex: none;
  color: var(--n-faint);
  font-size: 10.5px;
`

const EmptyNote = styled.div`
  color: var(--n-faint);
  font-size: 11.5px;
`

export function SenderDrawer({
  open,
  profile,
  orgTitle,
  onClose,
  onToggleVip,
  onScreenDecision,
  onComposeTo,
  onCreateFilter,
  onOpenThread,
  onPreviewAttachment,
}: SenderDrawerProps): React.ReactElement | null {
  if (!open || !profile) return null

  const avatar = senderAvatar(profile.name || profile.email)
  const auth = profile.latestAuth
  const authTone: 'ok' | 'fail' | 'neutral' = !auth
    ? 'neutral'
    : auth.dmarc === 'fail' || auth.spf === 'fail'
      ? 'fail'
      : auth.spf === 'pass' && auth.dkim === 'pass'
        ? 'ok'
        : 'neutral'

  const authSummary = !auth
    ? 'Auth unknown'
    : authTone === 'ok'
      ? 'SPF & DKIM pass'
      : authTone === 'fail'
        ? 'Auth warning'
        : `SPF ${auth.spf}`

  return (
    <DrawerRoot
      data-chrome="sidebar"
      data-side="right"
      aria-label={`Sender details for ${profile.name}`}
    >
      <TopBar>
        <Kicker>Sender intelligence</Kicker>
        <CloseBtn
          type="button"
          aria-label="Close sender panel"
          onClick={onClose}
        >
          <X size={14} />
        </CloseBtn>
      </TopBar>

      <ScrollBody>
        <Section>
          <IdentityRow>
            <Avatar $bg={avatar.bg} $fg={avatar.fg} aria-hidden="true">
              {avatar.initial}
            </Avatar>
            <NameBlock>
              <SenderName title={profile.name}>{profile.name}</SenderName>
              <SenderEmail title={profile.email}>{profile.email}</SenderEmail>
            </NameBlock>
          </IdentityRow>

          <MetaBadges>
            {profile.domain && <DomainChip>{profile.domain}</DomainChip>}
            {orgTitle && (
              <OrgBadge>
                <Building2 size={11} aria-hidden="true" />
                <span>{orgTitle}</span>
              </OrgBadge>
            )}
            <AuthPill $tone={authTone}>
              {authTone === 'fail' ? (
                <ShieldAlert size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>{authSummary}</span>
            </AuthPill>
          </MetaBadges>

          <ActionRow>
            <ActionButton
              type="button"
              onClick={() => onComposeTo(profile.email, profile.name)}
            >
              <Mail size={12} aria-hidden="true" />
              Compose
            </ActionButton>
            <ActionButton
              type="button"
              aria-pressed={profile.isVip}
              $vipActive={profile.isVip}
              onClick={() => onToggleVip(profile.email)}
            >
              <Star
                size={12}
                aria-hidden="true"
                fill={profile.isVip ? 'var(--b-amber)' : 'none'}
                color={profile.isVip ? 'var(--b-amber)' : 'currentColor'}
              />
              VIP
            </ActionButton>
            <ActionButton
              type="button"
              onClick={() => onCreateFilter(profile.email)}
            >
              <Filter size={12} aria-hidden="true" />
              Filter
            </ActionButton>
          </ActionRow>
        </Section>

        <Section>
          <MetricsGrid>
            <MetricBox>
              <MetricNum>{profile.receivedCount}</MetricNum>
              <MetricLabel>Received</MetricLabel>
            </MetricBox>
            <MetricBox>
              <MetricNum>{profile.sentCount}</MetricNum>
              <MetricLabel>Sent</MetricLabel>
            </MetricBox>
            <MetricBox>
              <MetricNum>{profile.sharedAttachments.length}</MetricNum>
              <MetricLabel>Shared files</MetricLabel>
            </MetricBox>
          </MetricsGrid>
        </Section>

        <Section>
          <SectionHeader>Screener routing</SectionHeader>
          <SegmentedGrid role="group" aria-label="Screener routing">
            {ROUTING_OPTIONS.map(option => {
              const active = profile.screenerDestination === option.value
              return (
                <RoutePill
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  $active={active}
                  $danger={option.value === 'blocked'}
                  onClick={() =>
                    onScreenDecision(profile.email, option.value, profile.name)
                  }
                >
                  {option.label}
                </RoutePill>
              )
            })}
          </SegmentedGrid>
        </Section>

        <Section>
          <SectionHeader>
            Recent threads ({profile.recentThreads.length})
          </SectionHeader>
          {profile.recentThreads.length === 0 ? (
            <EmptyNote>No recent threads with this sender.</EmptyNote>
          ) : (
            <ItemList>
              {profile.recentThreads.map(thread => (
                <ThreadRow
                  key={thread.threadId}
                  type="button"
                  onClick={() => onOpenThread(thread.threadId)}
                >
                  <ThreadRowTop>
                    {thread.unread && (
                      <UnreadDot aria-label="Unread thread" />
                    )}
                    <ThreadSubject $unread={thread.unread}>
                      {thread.subject || '(No subject)'}
                    </ThreadSubject>
                    <ThreadDate>
                      {formatThreadListTime(thread.lastMessageAt)}
                    </ThreadDate>
                  </ThreadRowTop>
                </ThreadRow>
              ))}
            </ItemList>
          )}
        </Section>

        <Section>
          <SectionHeader>
            Shared files ({profile.sharedAttachments.length})
          </SectionHeader>
          {profile.sharedAttachments.length === 0 ? (
            <EmptyNote>No attachments shared yet.</EmptyNote>
          ) : (
            <ItemList>
              {profile.sharedAttachments.map(file => (
                <FileRow
                  key={`${file.messageId}-${file.id}`}
                  type="button"
                  onClick={() => {
                    if (onPreviewAttachment) {
                      onPreviewAttachment(file.threadId, file.messageId, file.id)
                    } else {
                      onOpenThread(file.threadId)
                    }
                  }}
                >
                  <Paperclip
                    size={12}
                    style={{ color: 'var(--n-faint)', flex: 'none' }}
                    aria-hidden="true"
                  />
                  <FileName title={file.name}>{file.name}</FileName>
                  <FileSize>{file.sizeLabel}</FileSize>
                </FileRow>
              ))}
            </ItemList>
          )}
        </Section>
      </ScrollBody>
    </DrawerRoot>
  )
}
