import {
  CheckCircle2,
  Clock,
  FileEdit,
  FolderOpen,
  Hourglass,
  MailOpen,
  Newspaper,
  PenSquare,
  Receipt,
  Search,
  Server,
  Shield,
  X,
} from 'lucide-react'
import styled, { keyframes } from 'styled-components'

export interface ThreadListSkeletonProps {
  rows?: number
  density?: 'compact' | 'comfortable'
}

export type ThreadListEmptyVariant =
  | 'inbox-zero'
  | 'search'
  | 'folder'
  | 'snoozed'
  | 'waiting'
  | 'feed'
  | 'paper-trail'
  | 'screener'
  | 'drafts'
  | 'split-placeholder'

export interface ThreadListEmptyStateProps {
  variant: ThreadListEmptyVariant
  title?: string
  description?: string
  query?: string
  onClearSearch?: () => void
  onSearchServer?: () => void
  onCompose?: () => void
}

const shimmer = keyframes`
  0% {
    opacity: 0.45;
  }
  50% {
    opacity: 0.9;
  }
  100% {
    opacity: 0.45;
  }
`

const SkeletonList = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`

const SkeletonRow = styled.div<{ $comfortable: boolean }>`
  display: flex;
  align-items: ${props => (props.$comfortable ? 'flex-start' : 'center')};
  gap: 10px;
  padding: ${props => (props.$comfortable ? '11px 12px' : '8px 12px')};
  border-bottom: 1px solid var(--n-fence);
`

const SkeletonCircle = styled.div`
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--n-selected);
  animation: ${shimmer} 1.4s ease-in-out infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    opacity: 0.65;
  }
`

const SkeletonBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const SkeletonTopLine = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`

const SkeletonBar = styled.div<{ $width: string; $height?: number }>`
  width: ${props => props.$width};
  height: ${props => `${props.$height ?? 10}px`};
  border-radius: 3px;
  background: var(--n-selected);
  animation: ${shimmer} 1.4s ease-in-out infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    opacity: 0.65;
  }
`

const SENDER_WIDTHS = ['38%', '46%', '32%', '50%', '42%', '35%'] as const
const SUBJECT_WIDTHS = ['74%', '62%', '82%', '56%', '70%', '66%'] as const

export function ThreadListSkeleton({
  rows = 6,
  density = 'comfortable',
}: ThreadListSkeletonProps): React.ReactElement {
  const count = Math.max(1, Math.min(rows, 20))
  const comfortable = density === 'comfortable'

  return (
    <SkeletonList
      role="status"
      aria-busy="true"
      aria-label="Loading conversations"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonRow key={idx} $comfortable={comfortable}>
          <SkeletonCircle />
          <SkeletonBody>
            <SkeletonTopLine>
              <SkeletonBar
                $width={SENDER_WIDTHS[idx % SENDER_WIDTHS.length]!}
                $height={11}
              />
              <SkeletonBar $width="42px" $height={9} />
            </SkeletonTopLine>
            <SkeletonBar
              $width={SUBJECT_WIDTHS[idx % SUBJECT_WIDTHS.length]!}
              $height={10}
            />
            {comfortable && <SkeletonBar $width="88%" $height={9} />}
          </SkeletonBody>
        </SkeletonRow>
      ))}
    </SkeletonList>
  )
}

interface EmptyCopy {
  icon: React.ReactNode
  title: string
  description: string
  tone: 'done' | 'neutral'
}

function defaultCopyForVariant(
  variant: ThreadListEmptyVariant,
  query?: string,
): EmptyCopy {
  switch (variant) {
    case 'inbox-zero':
      return {
        icon: <CheckCircle2 size={20} />,
        title: 'Inbox Zero',
        description:
          'You are completely caught up. New messages will appear here as they arrive.',
        tone: 'done',
      }
    case 'search':
      return {
        icon: <Search size={20} />,
        title: query ? `No matches for "${query}"` : 'No matching conversations',
        description:
          'Try adjusting your search terms, clearing filters, or searching older mail on the server.',
        tone: 'neutral',
      }
    case 'snoozed':
      return {
        icon: <Clock size={20} />,
        title: 'Nothing snoozed',
        description:
          'Snoozed threads step out of your inbox and return right when you need them.',
        tone: 'neutral',
      }
    case 'waiting':
      return {
        icon: <Hourglass size={20} />,
        title: 'Not waiting on anyone',
        description:
          'Threads where you are awaiting a reply or set a follow-up reminder appear here.',
        tone: 'neutral',
      }
    case 'feed':
      return {
        icon: <Newspaper size={20} />,
        title: 'Your Feed is quiet',
        description:
          'Newsletters and updates routed to The Feed collect here so they stay out of your inbox.',
        tone: 'neutral',
      }
    case 'paper-trail':
      return {
        icon: <Receipt size={20} />,
        title: 'No receipts in Paper Trail',
        description:
          'Order confirmations, invoices, and shipping notices appear here for quick reference.',
        tone: 'neutral',
      }
    case 'screener':
      return {
        icon: <Shield size={20} />,
        title: 'Screener is clear',
        description:
          'First-time senders wait here for your approval before reaching your inbox.',
        tone: 'done',
      }
    case 'drafts':
      return {
        icon: <FileEdit size={20} />,
        title: 'No unsent drafts',
        description:
          'Start a new message or reply and it will save here automatically.',
        tone: 'neutral',
      }
    case 'split-placeholder':
      return {
        icon: <MailOpen size={20} />,
        title: 'Select a conversation',
        description:
          'Choose a thread from the list or press J / K to move through your inbox.',
        tone: 'neutral',
      }
    case 'folder':
    default:
      return {
        icon: <FolderOpen size={20} />,
        title: 'This folder is empty',
        description: 'There are no conversations in this view right now.',
        tone: 'neutral',
      }
  }
}

const EmptyRoot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  margin: auto;
  max-width: 360px;
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
  text-align: center;
`

const IconBadge = styled.div<{ $tone: 'done' | 'neutral' }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 4px;
  border-radius: 6px;
  border: 1px solid
    ${props =>
      props.$tone === 'done'
        ? 'var(--p-done-border, var(--p-done-line))'
        : 'var(--n-line)'};
  background: ${props =>
    props.$tone === 'done'
      ? 'var(--p-done-bg, var(--p-done-tint))'
      : 'var(--n-panel)'};
  color: ${props =>
    props.$tone === 'done'
      ? 'var(--p-done-fg, var(--p-done-text))'
      : 'var(--n-soft)'};
`

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 14.5px;
  font-weight: 700;
  line-height: 1.3;
`

const EmptyDesc = styled.p`
  margin: 0;
  color: var(--n-soft);
  font-size: 12.5px;
  line-height: 1.5;
`

const ActionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
`

const QuietBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
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

  &:hover {
    background: var(--n-hover);
  }
`

const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--pure-chrome-accent, var(--p-text));
  border-radius: 3px;
  background: var(--pure-chrome-accent, var(--p-text));
  color: var(--pure-chrome-on-accent, var(--p-on-text));
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    filter: brightness(0.95);
  }
`

export function ThreadListEmptyState({
  variant,
  title,
  description,
  query,
  onClearSearch,
  onSearchServer,
  onCompose,
}: ThreadListEmptyStateProps): React.ReactElement {
  const defaults = defaultCopyForVariant(variant, query)
  const resolvedTitle = title ?? defaults.title
  const resolvedDesc = description ?? defaults.description

  return (
    <EmptyRoot data-empty-variant={variant}>
      <IconBadge $tone={defaults.tone} aria-hidden="true">
        {defaults.icon}
      </IconBadge>
      <EmptyTitle>{resolvedTitle}</EmptyTitle>
      <EmptyDesc>{resolvedDesc}</EmptyDesc>
      {(onClearSearch || onSearchServer || onCompose) && (
        <ActionsRow>
          {onClearSearch && (
            <QuietBtn type="button" onClick={onClearSearch}>
              <X size={12} aria-hidden="true" />
              Clear search
            </QuietBtn>
          )}
          {onSearchServer && (
            <PrimaryBtn type="button" onClick={onSearchServer}>
              <Server size={12} aria-hidden="true" />
              Search all mail
            </PrimaryBtn>
          )}
          {onCompose && (
            <PrimaryBtn type="button" onClick={onCompose}>
              <PenSquare size={12} aria-hidden="true" />
              Compose
            </PrimaryBtn>
          )}
        </ActionsRow>
      )}
    </EmptyRoot>
  )
}
