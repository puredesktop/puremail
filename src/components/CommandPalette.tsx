import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CornerDownLeft, Search, X } from 'lucide-react'
import styled from 'styled-components'

export type CommandPaletteGroup =
  | 'Actions'
  | 'Navigation'
  | 'Views'
  | 'Threads'
  | 'Snippets'

export interface CommandPaletteItem {
  id: string
  label: string
  subtitle?: string
  group: CommandPaletteGroup
  shortcut?: string[]
  keywords?: string[]
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  items: CommandPaletteItem[]
  placeholder?: string
  initialQuery?: string
}

const GROUP_ORDER: readonly CommandPaletteGroup[] = [
  'Actions',
  'Navigation',
  'Views',
  'Threads',
  'Snippets',
]

function fuzzyScoreField(field: string, needle: string): number {
  const hay = field.toLowerCase()
  if (!hay) return 0
  if (hay === needle) return 120
  if (hay.startsWith(needle)) return 95
  const wordBoundaryIdx = hay.indexOf(` ${needle}`)
  if (wordBoundaryIdx >= 0) return 80
  const substringIdx = hay.indexOf(needle)
  if (substringIdx >= 0) return 65 - Math.min(substringIdx, 20)

  // Ordered subsequence match
  let qi = 0
  let consecutive = 0
  let bestConsecutive = 0
  for (let i = 0; i < hay.length && qi < needle.length; i += 1) {
    if (hay[i] === needle[qi]) {
      qi += 1
      consecutive += 1
      if (consecutive > bestConsecutive) bestConsecutive = consecutive
    } else {
      consecutive = 0
    }
  }
  if (qi < needle.length) return 0
  return 25 + Math.min(bestConsecutive * 5, 25)
}

function scoreCommandItem(item: CommandPaletteItem, rawQuery: string): number {
  const needle = rawQuery.trim().toLowerCase()
  if (!needle) return 1

  const tokens = needle.split(/\s+/).filter(Boolean)
  let total = 0
  for (const token of tokens) {
    const labelScore = fuzzyScoreField(item.label, token) * 1.4
    const subtitleScore = item.subtitle
      ? fuzzyScoreField(item.subtitle, token) * 0.9
      : 0
    const groupScore = fuzzyScoreField(item.group, token) * 0.7
    const keywordScore = (item.keywords ?? []).reduce(
      (best, kw) => Math.max(best, fuzzyScoreField(kw, token)),
      0,
    )
    const tokenBest = Math.max(
      labelScore,
      subtitleScore,
      groupScore,
      keywordScore,
    )
    if (tokenBest <= 0) return 0
    total += tokenBest
  }
  return total
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--platform-z-index-zi-app-modal, 300);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: min(12vh, 96px) 16px 24px;
  background: rgb(0 0 0 / 0.42);
  font-family: var(--platform-typography-font-family, sans-serif);
`

const Dialog = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 580px;
  max-height: min(72vh, 520px);
  overflow: hidden;
  border: 1px solid var(--n-line);
  border-radius: 6px;
  background: var(--n-sheet);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  color: var(--n-ink);
`

const SearchBar = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--n-fence);
  background: var(--n-sheet);
`

const SearchIconWrap = styled.span`
  display: inline-flex;
  flex: none;
  color: var(--n-faint);
`

const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--n-ink);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  outline: none;

  &::placeholder {
    color: var(--n-faint);
  }
`

const ClearBtn = styled.button`
  display: inline-flex;
  flex: none;
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

const Kbd = styled.kbd`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--n-soft);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
`

const ResultsList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
`

const GroupBlock = styled.div`
  &:not(:first-child) {
    margin-top: 2px;
    border-top: 1px solid var(--n-fence);
  }
`

const GroupHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 7px 14px 5px;
  background: var(--n-panel);
  border-bottom: 1px solid var(--n-fence);
  color: var(--n-faint);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`

const ItemRow = styled.button<{ $active: boolean; $danger?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  border: 0;
  background: ${props => (props.$active ? 'var(--p-chosen)' : 'transparent')};
  box-shadow: ${props => (props.$active ? 'var(--p-chosen-edge)' : 'none')};
  color: ${props =>
    props.$danger ? 'var(--p-failed-fg, var(--p-failed-text))' : 'var(--n-ink)'};
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${props =>
      props.$active ? 'var(--p-chosen)' : 'var(--n-hover)'};
  }
`

const ItemIcon = styled.span<{ $danger?: boolean }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: ${props =>
    props.$danger
      ? 'var(--p-failed-fg, var(--p-failed-text))'
      : 'var(--n-soft)'};
`

const ItemText = styled.span`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
`

const ItemLabel = styled.span`
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ItemSubtitle = styled.span`
  overflow: hidden;
  color: var(--n-faint);
  font-size: 11.5px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ShortcutGroup = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
`

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 36px 20px;
  color: var(--n-faint);
  font-size: 13px;
  text-align: center;
`

const Footer = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 14px;
  border-top: 1px solid var(--n-fence);
  background: var(--n-panel);
  color: var(--n-faint);
  font-size: 11px;
`

const FooterHints = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

export function CommandPalette({
  open,
  onClose,
  items,
  placeholder = 'Type a command, view, or thread…',
  initialQuery = '',
}: CommandPaletteProps): React.ReactElement | null {
  const [query, setQuery] = useState(initialQuery)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    setActiveIndex(0)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [open, initialQuery])

  const grouped = useMemo(() => {
    const scored = items
      .map((item, idx) => ({ item, score: scoreCommandItem(item, query), idx }))
      .filter(entry => entry.score > 0)

    const buckets = new Map<
      CommandPaletteGroup,
      Array<{ item: CommandPaletteItem; score: number; idx: number }>
    >()
    for (const group of GROUP_ORDER) {
      buckets.set(group, [])
    }
    for (const entry of scored) {
      const list = buckets.get(entry.item.group)
      if (list) list.push(entry)
    }

    const sections: Array<{
      group: CommandPaletteGroup
      items: CommandPaletteItem[]
    }> = []
    for (const group of GROUP_ORDER) {
      const entries = buckets.get(group) ?? []
      if (entries.length === 0) continue
      if (query.trim()) {
        entries.sort((a, b) => b.score - a.score || a.idx - b.idx)
      }
      sections.push({ group, items: entries.map(e => e.item) })
    }
    return sections
  }, [items, query])

  const flatItems = useMemo(
    () => grouped.flatMap(section => section.items),
    [grouped],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query, items])

  const clampedIndex =
    flatItems.length === 0
      ? -1
      : Math.min(Math.max(activeIndex, 0), flatItems.length - 1)
  const activeItem = clampedIndex >= 0 ? flatItems[clampedIndex] : undefined

  useEffect(() => {
    if (!open || !activeItem) return
    rowRefs.current.get(activeItem.id)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeItem])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const runItem = (item: CommandPaletteItem): void => {
    onClose()
    item.onSelect()
  }

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (flatItems.length > 0) {
        setActiveIndex(prev => (prev + 1) % flatItems.length)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (flatItems.length > 0) {
        setActiveIndex(prev => (prev - 1 + flatItems.length) % flatItems.length)
      }
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (flatItems.length > 0) setActiveIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      if (flatItems.length > 0) setActiveIndex(flatItems.length - 1)
    } else if (event.key === 'Enter') {
      if (activeItem) {
        event.preventDefault()
        runItem(activeItem)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  let runningIndex = 0

  return (
    <Backdrop
      data-testid="command-palette-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={event => event.stopPropagation()}
      >
        <SearchBar>
          <SearchIconWrap aria-hidden="true">
            <Search size={15} />
          </SearchIconWrap>
          <SearchInput
            ref={inputRef}
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls="puremail-command-palette-list"
            aria-activedescendant={
              activeItem ? `puremail-cmd-${activeItem.id}` : undefined
            }
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <ClearBtn
              type="button"
              aria-label="Clear command search"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <X size={13} />
            </ClearBtn>
          )}
          <Kbd aria-hidden="true">Esc</Kbd>
        </SearchBar>

        <ResultsList
          id="puremail-command-palette-list"
          role="listbox"
          aria-label="Available commands"
        >
          {flatItems.length === 0 ? (
            <EmptyState role="status">
              <span>No matching commands</span>
            </EmptyState>
          ) : (
            grouped.map(section => (
              <GroupBlock key={section.group}>
                <GroupHeader>{section.group}</GroupHeader>
                {section.items.map(item => {
                  const idx = runningIndex
                  runningIndex += 1
                  const isActive = idx === clampedIndex
                  return (
                    <ItemRow
                      key={item.id}
                      id={`puremail-cmd-${item.id}`}
                      ref={node => {
                        if (node) rowRefs.current.set(item.id, node)
                        else rowRefs.current.delete(item.id)
                      }}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      $active={isActive}
                      $danger={item.danger}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => runItem(item)}
                    >
                      {item.icon && (
                        <ItemIcon $danger={item.danger} aria-hidden="true">
                          {item.icon}
                        </ItemIcon>
                      )}
                      <ItemText>
                        <ItemLabel>{item.label}</ItemLabel>
                        {item.subtitle && (
                          <ItemSubtitle>{item.subtitle}</ItemSubtitle>
                        )}
                      </ItemText>
                      {item.shortcut && item.shortcut.length > 0 && (
                        <ShortcutGroup aria-hidden="true">
                          {item.shortcut.map((key, keyIdx) => (
                            <Kbd key={`${item.id}-k-${keyIdx}`}>{key}</Kbd>
                          ))}
                        </ShortcutGroup>
                      )}
                    </ItemRow>
                  )
                })}
              </GroupBlock>
            ))
          )}
        </ResultsList>

        <Footer>
          <FooterHints>
            <span>↑↓ Navigate</span>
            <span aria-hidden="true">·</span>
            <span>
              <CornerDownLeft
                size={11}
                style={{ verticalAlign: '-1px', marginRight: 2 }}
                aria-hidden="true"
              />
              ↵ Run
            </span>
            <span aria-hidden="true">·</span>
            <span>Esc Close</span>
          </FooterHints>
          <span>
            {flatItems.length}{' '}
            {flatItems.length === 1 ? 'command' : 'commands'}
          </span>
        </Footer>
      </Dialog>
    </Backdrop>
  )
}
