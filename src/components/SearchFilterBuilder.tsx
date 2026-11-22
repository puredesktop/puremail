import { useEffect, useMemo, useRef, useState } from 'react'
import { Filter, History, Search, SlidersHorizontal, X } from 'lucide-react'
import styled from 'styled-components'
import {
  buildMailQuery,
  parseMailQuery,
  type MailQueryTerm,
} from '../lib/mailQuery'
import { useOutsideClose } from './useOutsideClose'

export interface SearchFilterBuilderProps {
  query: string
  folders: string[]
  labels: string[]
  recentSearches?: string[]
  onApply: (query: string) => void
  onCreateFilter?: (query: string) => void
  onClear: () => void
  onClose: () => void
  /** Render in normal document flow (inside a dropdown panel) without absolute clipping. */
  inline?: boolean
  ignoreRef?: React.RefObject<HTMLElement | null>
}

interface BuilderDraft {
  from: string
  to: string
  subject: string
  hasWords: string
  doesntHave: string
  filename: string
  sizeOp: 'larger' | 'smaller'
  sizeValue: string
  sizeUnit: 'KB' | 'MB'
  after: string
  before: string
  folder: string
  label: string
  hasAttachment: boolean
  unreadOnly: boolean
  starred: boolean
  vipOnly: boolean
  waitingOn: boolean
  preservedTerms: MailQueryTerm[]
  sort: ReturnType<typeof parseMailQuery>['sort']
  limit?: number
}

function splitSizeToken(raw: string | undefined): {
  value: string
  unit: 'KB' | 'MB'
} {
  if (!raw) return { value: '', unit: 'MB' }
  const match = /^(\d+(?:\.\d+)?)\s*([km]b?)?$/i.exec(raw.trim())
  if (!match) return { value: '', unit: 'MB' }
  const unitChar = (match[2] ?? 'm').toLowerCase()
  return {
    value: match[1] ?? '',
    unit: unitChar.startsWith('k') ? 'KB' : 'MB',
  }
}

function draftFromQuery(raw: string): BuilderDraft {
  const parsed = parseMailQuery(raw)
  let from = ''
  let to = ''
  let subject = ''
  const excludedSubjects: string[] = []
  let filename = ''
  let sizeOp: 'larger' | 'smaller' = 'larger'
  let sizeValue = ''
  let sizeUnit: 'KB' | 'MB' = 'MB'
  let after = ''
  let before = ''
  let folder = ''
  let label = ''
  let hasAttachment = false
  let unreadOnly = false
  let starred = false
  let vipOnly = false
  let waitingOn = false
  const preservedTerms: MailQueryTerm[] = []

  for (const term of parsed.terms) {
    if (!term.negated && term.field === 'from' && !from) {
      from = term.value
    } else if (!term.negated && term.field === 'to' && !to) {
      to = term.value
    } else if (!term.negated && term.field === 'subject' && !subject) {
      subject = term.value
    } else if (term.negated && term.field === 'subject') {
      excludedSubjects.push(term.value)
    } else if (!term.negated && term.field === 'filename' && !filename) {
      filename = term.value
    } else if (
      !term.negated &&
      (term.field === 'larger' || term.field === 'smaller') &&
      !sizeValue
    ) {
      sizeOp = term.field
      const split = splitSizeToken(term.value)
      sizeValue = split.value
      sizeUnit = split.unit
    } else if (!term.negated && term.field === 'after' && !after) {
      after = term.value.replace(/\//g, '-')
    } else if (!term.negated && term.field === 'before' && !before) {
      before = term.value.replace(/\//g, '-')
    } else if (!term.negated && term.field === 'in' && !folder) {
      folder = term.value
    } else if (!term.negated && term.field === 'label' && !label) {
      label = term.value
    } else if (
      !term.negated &&
      term.field === 'has' &&
      term.value.toLowerCase() === 'attachment'
    ) {
      hasAttachment = true
    } else if (
      !term.negated &&
      term.field === 'is' &&
      term.value.toLowerCase() === 'unread'
    ) {
      unreadOnly = true
    } else if (
      !term.negated &&
      term.field === 'is' &&
      term.value.toLowerCase() === 'starred'
    ) {
      starred = true
    } else if (
      !term.negated &&
      term.field === 'is' &&
      term.value.toLowerCase() === 'vip'
    ) {
      vipOnly = true
    } else if (
      !term.negated &&
      term.field === 'is' &&
      term.value.toLowerCase() === 'awaiting'
    ) {
      waitingOn = true
    } else {
      preservedTerms.push(term)
    }
  }

  // Separate negated bare tokens (`-word` / `-"phrase"`) from positive words.
  const positiveTextTokens: string[] = []
  const excludedTextTokens: string[] = [...excludedSubjects]
  const textTokenRegex = /(-?"[^"]*"|\S+)/g
  let m: RegExpExecArray | null
  while ((m = textTokenRegex.exec(parsed.text)) !== null) {
    const tok = m[1]!
    if (tok.startsWith('-') && tok.length > 1) {
      const inner = tok.slice(1)
      excludedTextTokens.push(
        inner.startsWith('"') && inner.endsWith('"')
          ? inner.slice(1, -1)
          : inner,
      )
    } else {
      positiveTextTokens.push(tok)
    }
  }

  return {
    from,
    to,
    subject,
    hasWords: positiveTextTokens.join(' '),
    doesntHave: excludedTextTokens.join(' '),
    filename,
    sizeOp,
    sizeValue,
    sizeUnit,
    after,
    before,
    folder,
    label,
    hasAttachment,
    unreadOnly,
    starred,
    vipOnly,
    waitingOn,
    preservedTerms,
    sort: parsed.sort,
    limit: parsed.limit,
  }
}

function queryFromDraft(draft: BuilderDraft): string {
  const terms: MailQueryTerm[] = [...draft.preservedTerms]
  if (draft.folder.trim()) {
    terms.push({ field: 'in', value: draft.folder.trim(), negated: false })
  }
  if (draft.from.trim()) {
    terms.push({ field: 'from', value: draft.from.trim(), negated: false })
  }
  if (draft.to.trim()) {
    terms.push({ field: 'to', value: draft.to.trim(), negated: false })
  }
  if (draft.subject.trim()) {
    terms.push({ field: 'subject', value: draft.subject.trim(), negated: false })
  }
  const excludedParts: string[] = []
  if (draft.doesntHave.trim()) {
    const tokRegex = /"([^"]+)"|(\S+)/g
    let match: RegExpExecArray | null
    while ((match = tokRegex.exec(draft.doesntHave.trim())) !== null) {
      const phrase = match[1]
      const word = match[2]
      if (phrase) {
        excludedParts.push(`-"${phrase.replace(/"/g, '\\"')}"`)
      } else if (word) {
        const clean = word.replace(/^-+/, '')
        if (clean) excludedParts.push(`-${clean}`)
      }
    }
  }
  if (draft.label.trim()) {
    terms.push({ field: 'label', value: draft.label.trim(), negated: false })
  }
  if (draft.filename.trim()) {
    terms.push({
      field: 'filename',
      value: draft.filename.trim(),
      negated: false,
    })
  }
  const numericSize = draft.sizeValue.trim()
  if (numericSize && /^\d+(?:\.\d+)?$/.test(numericSize)) {
    const suffix = draft.sizeUnit === 'KB' ? 'k' : 'm'
    terms.push({
      field: draft.sizeOp,
      value: `${numericSize}${suffix}`,
      negated: false,
    })
  }
  if (draft.after.trim()) {
    terms.push({ field: 'after', value: draft.after.trim(), negated: false })
  }
  if (draft.before.trim()) {
    terms.push({ field: 'before', value: draft.before.trim(), negated: false })
  }
  if (draft.hasAttachment) {
    terms.push({ field: 'has', value: 'attachment', negated: false })
  }
  if (draft.unreadOnly) {
    terms.push({ field: 'is', value: 'unread', negated: false })
  }
  if (draft.starred) {
    terms.push({ field: 'is', value: 'starred', negated: false })
  }
  if (draft.vipOnly) {
    terms.push({ field: 'is', value: 'vip', negated: false })
  }
  if (draft.waitingOn) {
    terms.push({ field: 'is', value: 'awaiting', negated: false })
  }
  const combinedText = [draft.hasWords.trim(), ...excludedParts]
    .filter(Boolean)
    .join(' ')
  return buildMailQuery({
    terms,
    text: combinedText,
    sort: draft.sort,
    ...(draft.limit ? { limit: draft.limit } : {}),
  })
}

const Popover = styled.div<{ $inline?: boolean }>`
  ${props =>
    props.$inline
      ? `
    position: static;
    width: 100%;
    border: 0;
    border-top: 1px solid var(--n-line);
    border-radius: 0;
    box-shadow: none;
  `
      : `
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: var(--platform-z-index-zi-app-menus, 100);
    width: min(560px, calc(100vw - 24px));
    border: 1px solid var(--n-line);
    border-radius: 6px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.22);
  `}
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family, sans-serif);
  overflow: hidden;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--n-line);
  background: var(--n-panel);
`

const HeaderTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--n-soft);
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

const Form = styled.form`
  display: flex;
  flex-direction: column;
`

const FieldsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  padding: 14px;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
`

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FieldLabel = styled.span`
  color: var(--n-soft);
  font-size: 11px;
  font-weight: 600;
`

const Input = styled.input`
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12.5px;
  box-sizing: border-box;

  &::placeholder {
    color: var(--n-faint);
  }
  &:focus {
    outline: none;
    border-color: var(--pure-chrome-accent, var(--p-text));
  }
`

const Select = styled.select`
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-sheet);
  color: var(--n-ink);
  font-family: inherit;
  font-size: 12.5px;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: var(--pure-chrome-accent, var(--p-text));
  }
`

const InlineRow = styled.div`
  display: grid;
  grid-template-columns: 88px 1fr 64px;
  gap: 6px;
`

const DateRangeRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
`

const TogglesRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 12px;
`

const ToggleChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border: 1px solid
    ${props =>
      props.$active
        ? 'var(--pure-chrome-accent, var(--p-text))'
        : 'var(--n-line)'};
  border-radius: 3px;
  background: ${props => (props.$active ? 'var(--p-tint)' : 'var(--n-panel)')};
  color: ${props =>
    props.$active
      ? 'var(--p-on-tint, var(--n-ink))'
      : 'var(--n-soft)'};
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: ${props =>
      props.$active ? 'var(--p-tint)' : 'var(--n-hover)'};
  }
`

const PreviewBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--n-fence);
  background: var(--n-panel);
  font-size: 11.5px;
`

const PreviewCode = styled.code`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--n-ink);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const RecentBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-top: 1px solid var(--n-fence);
  background: var(--n-sheet);
`

const RecentChip = styled.button`
  display: inline-flex;
  align-items: center;
  max-width: 200px;
  overflow: hidden;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--n-line);
  border-radius: 3px;
  background: var(--n-panel);
  color: var(--n-soft);
  font-family: var(--platform-typography-font-family-mono, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: var(--n-hover);
    color: var(--n-ink);
  }
`

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--n-line);
  background: var(--n-panel);
`

const FooterRight = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  padding: 0 12px;
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

export function SearchFilterBuilder({
  query,
  folders,
  labels,
  recentSearches = [],
  onApply,
  onCreateFilter,
  onClear,
  onClose,
  inline = false,
  ignoreRef,
}: SearchFilterBuilderProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fromRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<BuilderDraft>(() => draftFromQuery(query))

  useOutsideClose(rootRef, !inline, onClose, ignoreRef)

  useEffect(() => {
    setDraft(draftFromQuery(query))
  }, [query])

  useEffect(() => {
    requestAnimationFrame(() => {
      fromRef.current?.focus()
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

  const builtQuery = useMemo(() => queryFromDraft(draft), [draft])

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    onApply(builtQuery)
  }

  const handleClear = (): void => {
    setDraft(draftFromQuery(''))
    onClear()
  }

  return (
    <Popover
      ref={rootRef}
      $inline={inline}
      role="dialog"
      aria-label="Search filter builder"
      onClick={event => event.stopPropagation()}
    >
      <Header>
        <HeaderTitle>
          <SlidersHorizontal size={13} aria-hidden="true" />
          <span>Search &amp; Filter Builder</span>
        </HeaderTitle>
        <CloseBtn
          type="button"
          aria-label="Close search builder"
          onClick={onClose}
        >
          <X size={14} />
        </CloseBtn>
      </Header>

      <Form onSubmit={handleSubmit}>
        <FieldsGrid>
          <Field>
            <FieldLabel>From</FieldLabel>
            <Input
              ref={fromRef}
              type="text"
              placeholder="name or email"
              value={draft.from}
              onChange={event =>
                setDraft(prev => ({ ...prev, from: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>To</FieldLabel>
            <Input
              type="text"
              placeholder="recipient name or email"
              value={draft.to}
              onChange={event =>
                setDraft(prev => ({ ...prev, to: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Subject</FieldLabel>
            <Input
              type="text"
              placeholder="subject contains"
              value={draft.subject}
              onChange={event =>
                setDraft(prev => ({ ...prev, subject: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Has words</FieldLabel>
            <Input
              type="text"
              placeholder="keywords or &quot;exact phrase&quot;"
              value={draft.hasWords}
              onChange={event =>
                setDraft(prev => ({ ...prev, hasWords: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Doesn&apos;t have</FieldLabel>
            <Input
              type="text"
              placeholder="exclude words"
              value={draft.doesntHave}
              onChange={event =>
                setDraft(prev => ({ ...prev, doesntHave: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Filename</FieldLabel>
            <Input
              type="text"
              placeholder="e.g. invoice.pdf"
              value={draft.filename}
              onChange={event =>
                setDraft(prev => ({ ...prev, filename: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Size</FieldLabel>
            <InlineRow>
              <Select
                aria-label="Size operator"
                value={draft.sizeOp}
                onChange={event =>
                  setDraft(prev => ({
                    ...prev,
                    sizeOp: event.target.value as 'larger' | 'smaller',
                  }))
                }
              >
                <option value="larger">Larger</option>
                <option value="smaller">Smaller</option>
              </Select>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="Amount"
                aria-label="Size amount"
                value={draft.sizeValue}
                onChange={event =>
                  setDraft(prev => ({ ...prev, sizeValue: event.target.value }))
                }
              />
              <Select
                aria-label="Size unit"
                value={draft.sizeUnit}
                onChange={event =>
                  setDraft(prev => ({
                    ...prev,
                    sizeUnit: event.target.value as 'KB' | 'MB',
                  }))
                }
              >
                <option value="MB">MB</option>
                <option value="KB">KB</option>
              </Select>
            </InlineRow>
          </Field>

          <Field>
            <FieldLabel>Date (after / before)</FieldLabel>
            <DateRangeRow>
              <Input
                type="date"
                aria-label="After date"
                value={draft.after}
                onChange={event =>
                  setDraft(prev => ({ ...prev, after: event.target.value }))
                }
              />
              <Input
                type="date"
                aria-label="Before date"
                value={draft.before}
                onChange={event =>
                  setDraft(prev => ({ ...prev, before: event.target.value }))
                }
              />
            </DateRangeRow>
          </Field>

          <Field>
            <FieldLabel>Folder / Scope</FieldLabel>
            <Select
              aria-label="Folder or scope"
              value={
                folders.find(
                  f => f.toLowerCase() === draft.folder.trim().toLowerCase(),
                ) ?? draft.folder
              }
              onChange={event =>
                setDraft(prev => ({ ...prev, folder: event.target.value }))
              }
            >
              <option value="">All mail (excl. Trash)</option>
              {folders.map(folderName => (
                <option key={folderName} value={folderName}>
                  {folderName}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <FieldLabel>Label</FieldLabel>
            <Select
              aria-label="Label filter"
              value={draft.label}
              onChange={event =>
                setDraft(prev => ({ ...prev, label: event.target.value }))
              }
            >
              <option value="">Any label</option>
              {labels.map(labelName => (
                <option key={labelName} value={labelName}>
                  {labelName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldsGrid>

        <TogglesRow role="group" aria-label="Quick search flags">
          <ToggleChip
            type="button"
            aria-pressed={draft.hasAttachment}
            $active={draft.hasAttachment}
            onClick={() =>
              setDraft(prev => ({ ...prev, hasAttachment: !prev.hasAttachment }))
            }
          >
            Has attachment
          </ToggleChip>
          <ToggleChip
            type="button"
            aria-pressed={draft.unreadOnly}
            $active={draft.unreadOnly}
            onClick={() =>
              setDraft(prev => ({ ...prev, unreadOnly: !prev.unreadOnly }))
            }
          >
            Unread only
          </ToggleChip>
          <ToggleChip
            type="button"
            aria-pressed={draft.starred}
            $active={draft.starred}
            onClick={() =>
              setDraft(prev => ({ ...prev, starred: !prev.starred }))
            }
          >
            Starred
          </ToggleChip>
          <ToggleChip
            type="button"
            aria-pressed={draft.vipOnly}
            $active={draft.vipOnly}
            onClick={() =>
              setDraft(prev => ({ ...prev, vipOnly: !prev.vipOnly }))
            }
          >
            VIP only
          </ToggleChip>
          <ToggleChip
            type="button"
            aria-pressed={draft.waitingOn}
            $active={draft.waitingOn}
            onClick={() =>
              setDraft(prev => ({ ...prev, waitingOn: !prev.waitingOn }))
            }
          >
            Waiting on
          </ToggleChip>
        </TogglesRow>

        <PreviewBar>
          <span style={{ color: 'var(--n-faint)', fontWeight: 600 }}>
            Query:
          </span>
          <PreviewCode data-testid="search-builder-preview">
            {builtQuery || 'All matching messages'}
          </PreviewCode>
        </PreviewBar>

        {recentSearches.length > 0 && (
          <RecentBar>
            <History
              size={12}
              style={{ color: 'var(--n-faint)', flex: 'none' }}
              aria-hidden="true"
            />
            {recentSearches.slice(0, 6).map(recent => (
              <RecentChip
                key={recent}
                type="button"
                title={recent}
                onClick={() => onApply(recent)}
              >
                {recent}
              </RecentChip>
            ))}
          </RecentBar>
        )}

        <Footer>
          <QuietBtn type="button" onClick={handleClear}>
            Clear
          </QuietBtn>
          <FooterRight>
            {onCreateFilter && (
              <QuietBtn
                type="button"
                disabled={!builtQuery}
                onClick={() => {
                  if (builtQuery) onCreateFilter(builtQuery)
                }}
              >
                <Filter size={12} aria-hidden="true" />
                Create filter
              </QuietBtn>
            )}
            <PrimaryBtn type="submit">
              <Search size={12} aria-hidden="true" />
              Search
            </PrimaryBtn>
          </FooterRight>
        </Footer>
      </Form>
    </Popover>
  )
}
