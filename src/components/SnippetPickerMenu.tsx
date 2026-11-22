import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Search, Settings2, X } from 'lucide-react'
import styled from 'styled-components'
import { matchSnippets, renderSnippet } from '../lib/mailSnippets'
import type { MailSnippet } from '../types'
import { useOutsideClose } from './useOutsideClose'

export interface SnippetPickerMenuProps {
  snippets: MailSnippet[]
  initialQuery?: string
  vars: { recipientName?: string; myName?: string; subject?: string }
  onInsert: (
    rendered: { subject?: string; body: string },
    snippet: MailSnippet,
  ) => void
  onManageSnippets?: () => void
  onClose: () => void
  placement?: 'up' | 'down'
  align?: 'left' | 'right'
  ignoreRef?: React.RefObject<HTMLElement | null>
}

const Popover = styled.div<{ $placement?: 'up' | 'down'; $align?: 'left' | 'right' }>`
  position: absolute;
  ${props =>
    props.$placement === 'down'
      ? 'top: calc(100% + 6px);'
      : 'bottom: calc(100% + 6px);'}
  ${props => (props.$align === 'right' ? 'right: 0;' : 'left: 0;')}
  z-index: var(--platform-z-index-zi-app-menus, 100);
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - 32px));
  max-height: 360px;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
  overflow: hidden;
`

const SearchHeader = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--n-fence);
  background: var(--n-panel);
`

const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12.5px;
  outline: none;

  &::placeholder {
    color: var(--n-faint);
  }
`

const CloseBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
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

const List = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
`

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: ${props => (props.$active ? 'var(--p-chosen)' : 'transparent')};
  box-shadow: ${props => (props.$active ? 'var(--p-chosen-edge)' : 'none')};
  color: var(--n-ink);
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${props =>
      props.$active ? 'var(--p-chosen)' : 'var(--n-hover)'};
  }
`

const RowTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
`

const SnippetTitle = styled.span`
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ShortcutBadge = styled.code`
  flex: none;
  padding: 1px 5px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--pure-chrome-accent, var(--p-text));
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 10.5px;
  font-weight: 600;
`

const PreviewLine = styled.span`
  overflow: hidden;
  color: var(--n-faint);
  font-size: 11.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 14px;
  color: var(--n-faint);
  font-size: 12px;
  text-align: center;
`

const Footer = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid var(--n-fence);
  background: var(--n-panel);
  color: var(--n-faint);
  font-size: 11px;
`

const ManageLink = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--pure-chrome-accent, var(--p-text));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
  }
`

export function SnippetPickerMenu({
  snippets,
  initialQuery = '',
  vars,
  onInsert,
  onManageSnippets,
  onClose,
  placement = 'up',
  align = 'left',
  ignoreRef,
}: SnippetPickerMenuProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [activeIndex, setActiveIndex] = useState(0)

  useOutsideClose(rootRef, true, onClose, ignoreRef)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const matches = useMemo(
    () => matchSnippets(snippets, query.replace(/^;+/, '')),
    [snippets, query],
  )

  const renderedMatches = useMemo(
    () =>
      matches.map(snippet => ({
        snippet,
        rendered: renderSnippet(snippet, vars),
      })),
    [matches, vars],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query, snippets])

  const clampedIndex =
    renderedMatches.length === 0
      ? -1
      : Math.min(Math.max(activeIndex, 0), renderedMatches.length - 1)
  const activeEntry =
    clampedIndex >= 0 ? renderedMatches[clampedIndex] : undefined

  const handleSelect = (
    rendered: { subject?: string; body: string },
    snippet: MailSnippet,
  ): void => {
    onInsert(rendered, snippet)
    onClose()
  }

  return (
    <Popover
      ref={rootRef}
      $placement={placement}
      $align={align}
      role="dialog"
      aria-label="Insert snippet"
      onClick={event => event.stopPropagation()}
    >
      <SearchHeader>
        <Search
          size={13}
          style={{ color: 'var(--n-faint)', flex: 'none' }}
          aria-hidden="true"
        />
        <SearchInput
          ref={inputRef}
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (renderedMatches.length > 0) {
                setActiveIndex(prev => (prev + 1) % renderedMatches.length)
              }
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (renderedMatches.length > 0) {
                setActiveIndex(
                  prev =>
                    (prev - 1 + renderedMatches.length) %
                    renderedMatches.length,
                )
              }
            } else if (event.key === 'Enter') {
              if (activeEntry) {
                event.preventDefault()
                handleSelect(activeEntry.rendered, activeEntry.snippet)
              }
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
          placeholder="Search snippets or ;shortcut…"
          aria-label="Search snippets"
        />
        <CloseBtn
          type="button"
          aria-label="Close snippet picker"
          onClick={onClose}
        >
          <X size={13} />
        </CloseBtn>
      </SearchHeader>

      <List role="listbox" aria-label="Matching snippets">
        {renderedMatches.length === 0 ? (
          <Empty role="status">
            <FileText size={16} aria-hidden="true" />
            <span>No matching snippets</span>
          </Empty>
        ) : (
          renderedMatches.map(({ snippet, rendered }, idx) => {
            const isActive = idx === clampedIndex
            const oneLinePreview = rendered.body.replace(/\s+/g, ' ').trim()
            return (
              <Row
                key={snippet.id}
                type="button"
                role="option"
                aria-selected={isActive}
                $active={isActive}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => handleSelect(rendered, snippet)}
              >
                <RowTop>
                  <SnippetTitle>{snippet.title}</SnippetTitle>
                  <ShortcutBadge>;{snippet.shortcut}</ShortcutBadge>
                </RowTop>
                <PreviewLine>{oneLinePreview}</PreviewLine>
              </Row>
            )
          })
        )}
      </List>

      <Footer>
        <span>
          {renderedMatches.length}{' '}
          {renderedMatches.length === 1 ? 'snippet' : 'snippets'}
        </span>
        {onManageSnippets && (
          <ManageLink
            type="button"
            onClick={() => {
              onClose()
              onManageSnippets()
            }}
          >
            <Settings2 size={12} aria-hidden="true" />
            Manage snippets…
          </ManageLink>
        )}
      </Footer>
    </Popover>
  )
}
