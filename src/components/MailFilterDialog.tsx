import { useMemo, useState } from 'react'
import styled from 'styled-components'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { accountFolderForBoxName, composeFilterQuery } from '../lib/mailFilters'
import { countThreadQuery } from '../lib/mailQuery'
import type { MailStore } from '../types'

/**
 * "Filter like this…" — create a filter from an example message. The
 * condition is a plain query (same language as search and saved views),
 * prefilled from the message and editable. The action choice is the one
 * honest pair: Label (stays in inbox) or File into box (label + skip
 * inbox); a typed new box name creates the label and pins its view in
 * the same gesture. A live match count previews scope before anything
 * is created.
 */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--platform-colors-text) 18%, transparent);
`

const Panel = styled.div`
  display: grid;
  gap: var(--platform-spacing-sm);
  width: min(440px, calc(100vw - 48px));
  padding: var(--platform-spacing-lg);
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-md);
  background: var(--platform-colors-elevated);
  box-shadow: var(--platform-shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.18));
`

const Title = styled.h2`
  margin: 0;
  font-size: var(--platform-typography-font-size-md);
  font-weight: var(--platform-typography-font-weight-semibold);
  color: var(--platform-colors-text);
`

const Field = styled.label`
  display: grid;
  gap: 4px;
  font-size: var(--platform-typography-font-size-xs);
  color: var(--platform-colors-text-secondary);
`

const TextInput = styled.input`
  padding: 6px 8px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font-family: var(
    --platform-typography-font-family-mono,
    ui-monospace,
    monospace
  );
  font-size: var(--platform-typography-font-size-sm);
`

const NameInput = styled(TextInput)`
  font-family: inherit;
`

const ChoiceRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--platform-spacing-xs);
`

const Choice = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? 'var(--platform-colors-accent)'
        : 'var(--platform-colors-border)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $active }) =>
    $active
      ? 'color-mix(in srgb, var(--platform-colors-accent) 10%, transparent)'
      : 'transparent'};
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-xs);
  cursor: pointer;
`

const Preview = styled.div`
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
`

const ButtonRow = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--platform-spacing-xs);
`

const PickerWrap = styled.div`
  position: relative;
`

const PickerPanel = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 5;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-elevated);
  box-shadow: var(--platform-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.14));
`

const PickerGroupTitle = styled.div`
  padding: 6px 10px 2px;
  color: var(--platform-colors-text-secondary);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  &:not(:first-child) {
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--platform-colors-border);
  }
`

const PickerRow = styled.button`
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: 0;
  background: none;
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-sm);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }
`

const IMAP_MAILBOX_PREFIX = 'imap_mbx_'

export interface MailFilterDialogSeed {
  senderEmail: string
  subject: string
}

export interface MailFilterDialogSubmit {
  name: string
  query: string
  labelName: string
  fileIntoBox: boolean
  markRead: boolean
  applyToExisting: boolean
  matchCount: number
}

export function MailFilterDialog({
  store,
  accountId,
  seed,
  onClose,
  onSubmit,
}: {
  store: MailStore
  accountId: string
  seed: MailFilterDialogSeed
  onClose: () => void
  onSubmit: (input: MailFilterDialogSubmit) => void
}): React.ReactElement {
  const domain = seed.senderEmail.split('@')[1] ?? ''
  const [scope, setScope] = useState<'sender' | 'domain'>('sender')
  const [subjectOn, setSubjectOn] = useState(false)
  const [subjectText, setSubjectText] = useState(seed.subject)
  const [hasAttachment, setHasAttachment] = useState(false)
  // null = query follows the condition chips; a hand edit takes over.
  const [customQuery, setCustomQuery] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [mode, setMode] = useState<'box' | 'label'>('box')
  const [markRead, setMarkRead] = useState(false)

  const composedQuery = composeFilterQuery({
    senderEmail: seed.senderEmail,
    scope,
    ...(subjectOn && subjectText.trim()
      ? { subjectContains: subjectText }
      : {}),
    ...(hasAttachment ? { hasAttachment: true } : {}),
  })
  const query = customQuery ?? composedQuery
  const realFolder = accountFolderForBoxName(store, accountId, target)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Grouped, sorted suggestions: real account folders first (leaf folders
  // only — "Folders"/"Labels" style containers are navigation, not
  // destinations), then local label-backed boxes. The flat datalist mixed
  // system folders, containers, and boxes in server order — unreadable.
  const accountFolderNames = useMemo(() => {
    const entries = store.mailboxes
      .filter(
        mailbox =>
          mailbox.accountId === accountId &&
          mailbox.id.startsWith(IMAP_MAILBOX_PREFIX),
      )
      .map(mailbox => ({
        path: mailbox.id.slice(IMAP_MAILBOX_PREFIX.length),
        name: mailbox.name,
        role: mailbox.role,
      }))
    const containers = new Set(
      entries
        .filter(entry =>
          entries.some(other => other.path.startsWith(`${entry.path}/`)),
        )
        .map(entry => entry.path),
    )
    return entries
      .filter(entry => entry.role === 'custom' && !containers.has(entry.path))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
  }, [store.mailboxes, accountId])
  const localBoxNames = useMemo(() => {
    const folderSet = new Set(accountFolderNames.map(n => n.toLowerCase()))
    return [...new Set(store.labels.map(label => label.name))]
      .filter(name => !folderSet.has(name.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
  }, [store.labels, accountFolderNames])
  const needle = target.trim().toLowerCase()
  const matchesNeedle = (name: string): boolean =>
    !needle || name.toLowerCase().includes(needle)
  const folderSuggestions = accountFolderNames.filter(matchesNeedle)
  const boxSuggestions = localBoxNames.filter(matchesNeedle)
  // A typed name that matches nothing existing IS a new box — say so
  // explicitly instead of relying on the user to guess.
  const createName = target.trim()
  const showCreate =
    createName.length > 0 &&
    ![...accountFolderNames, ...localBoxNames].some(
      name => name.toLowerCase() === createName.toLowerCase(),
    )

  const matchCount = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return 0
    try {
      return countThreadQuery(store, accountId, trimmed)
    } catch {
      return 0
    }
  }, [store, accountId, query])

  const name =
    target.trim() ||
    (scope === 'domain' && domain ? domain : seed.senderEmail)
  const ready = query.trim().length > 0 && target.trim().length > 0

  function chooseScope(next: 'sender' | 'domain'): void {
    setScope(next)
    setCustomQuery(null)
  }

  function submit(applyToExisting: boolean): void {
    onSubmit({
      name,
      query: query.trim(),
      labelName: target.trim(),
      fileIntoBox: mode === 'box',
      markRead,
      applyToExisting,
      matchCount,
    })
  }

  return (
    <Backdrop onClick={onClose}>
      <Panel
        role="dialog"
        aria-label="Create mail filter"
        onClick={event => event.stopPropagation()}
      >
        <Title>Filter like this</Title>
        <ChoiceRow>
          <Choice
            type="button"
            $active={scope === 'sender'}
            onClick={() => chooseScope('sender')}
          >
            This sender
          </Choice>
          {domain ? (
            <Choice
              type="button"
              $active={scope === 'domain'}
              onClick={() => chooseScope('domain')}
            >
              Everyone @{domain}
            </Choice>
          ) : null}
          <Choice
            type="button"
            $active={subjectOn}
            title="Also require the subject to contain a phrase"
            onClick={() => {
              setSubjectOn(current => !current)
              setCustomQuery(null)
            }}
          >
            + subject
          </Choice>
          <Choice
            type="button"
            $active={hasAttachment}
            title="Only messages with an attachment"
            onClick={() => {
              setHasAttachment(current => !current)
              setCustomQuery(null)
            }}
          >
            + attachment
          </Choice>
        </ChoiceRow>
        {subjectOn ? (
          <Field>
            Subject contains
            <NameInput
              value={subjectText}
              placeholder="e.g. invoice"
              onChange={event => {
                setSubjectText(event.currentTarget.value)
                setCustomQuery(null)
              }}
            />
          </Field>
        ) : null}
        <Field>
          {customQuery === null
            ? 'Matches (query — follows the choices above; edit to take over)'
            : 'Matches (query — hand-edited; chips no longer apply)'}
          <TextInput
            value={query}
            onChange={event => setCustomQuery(event.currentTarget.value)}
          />
        </Field>
        <Field>
          {mode === 'box' ? 'Box name' : 'Label name'}
          <PickerWrap>
            <NameInput
              value={target}
              placeholder={
                mode === 'box' ? 'e.g. Newsletters' : 'e.g. Receipts'
              }
              onFocus={() => setPickerOpen(true)}
              onBlur={() => window.setTimeout(() => setPickerOpen(false), 120)}
              onChange={event => {
                setTarget(event.currentTarget.value)
                setPickerOpen(true)
              }}
            />
            {pickerOpen &&
            (showCreate ||
              folderSuggestions.length > 0 ||
              boxSuggestions.length > 0) ? (
              <PickerPanel role="listbox" aria-label="Box suggestions">
                {showCreate && (
                  <>
                    <PickerGroupTitle>New</PickerGroupTitle>
                    <PickerRow
                      type="button"
                      onMouseDown={event => {
                        event.preventDefault()
                        setPickerOpen(false)
                      }}
                    >
                      ＋ Create {mode === 'box' ? 'box' : 'label'} “
                      {createName}”
                    </PickerRow>
                  </>
                )}
                {folderSuggestions.length > 0 && (
                  <>
                    <PickerGroupTitle>
                      Folders on your account
                    </PickerGroupTitle>
                    {folderSuggestions.map(name => (
                      <PickerRow
                        key={`folder-${name}`}
                        type="button"
                        onMouseDown={event => {
                          event.preventDefault()
                          setTarget(name)
                          setPickerOpen(false)
                        }}
                      >
                        {name}
                      </PickerRow>
                    ))}
                  </>
                )}
                {boxSuggestions.length > 0 && (
                  <>
                    <PickerGroupTitle>Boxes</PickerGroupTitle>
                    {boxSuggestions.map(name => (
                      <PickerRow
                        key={`box-${name}`}
                        type="button"
                        onMouseDown={event => {
                          event.preventDefault()
                          setTarget(name)
                          setPickerOpen(false)
                        }}
                      >
                        {name}
                      </PickerRow>
                    ))}
                  </>
                )}
              </PickerPanel>
            ) : null}
          </PickerWrap>
          {realFolder && mode === 'box' ? (
            <Preview role="note">
              “{realFolder.name}” is a real folder on the mail account —
              matches will move into it on the server.
            </Preview>
          ) : null}
        </Field>
        <ChoiceRow>
          <Choice
            type="button"
            $active={mode === 'box'}
            title="Label + skip the inbox; the box appears in the sidebar"
            onClick={() => setMode('box')}
          >
            File into box · skips inbox
          </Choice>
          <Choice
            type="button"
            $active={mode === 'label'}
            title="Label only; the thread stays in the inbox"
            onClick={() => setMode('label')}
          >
            Label · stays in inbox
          </Choice>
          <Choice
            type="button"
            $active={markRead}
            onClick={() => setMarkRead(current => !current)}
          >
            Mark read
          </Choice>
        </ChoiceRow>
        <Preview role="status">
          {query.trim()
            ? `Matches ${matchCount} existing thread${
                matchCount === 1 ? '' : 's'
              }`
            : 'Enter a query to preview matches'}
        </Preview>
        <ButtonRow>
          <Button size="sm" variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready} onClick={() => submit(false)}>
            Create filter
          </Button>
          <Button
            size="sm"
            disabled={!ready || matchCount === 0}
            onClick={() => submit(true)}
          >
            Create + apply to {matchCount}
          </Button>
        </ButtonRow>
      </Panel>
    </Backdrop>
  )
}
