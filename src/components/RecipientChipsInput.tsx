import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  cachedPeopleDirectory,
  loadPeopleDirectory,
  type PeopleDirectoryEntry,
} from '../lib/peopleDirectory'
import { X } from 'lucide-react'
import {
  isValidEmailAddress,
  parseRecipientInput,
  rankedCorrespondents,
} from '../lib/mailCompose'
import type { MailStore } from '../types'
import {
  ChipField,
  ChipTextInput,
  RecipientChip,
  RecipientMenu,
  RecipientMenuItem,
  RecipientMenuMeta,
  RecipientMenuWrap,
} from './mailShellStyles'

export interface RecipientChipsInputProps {
  /** Comma-separated recipient string owned by the shell compose state. */
  value: string
  onChange: (next: string) => void
  store: MailStore
  accountId?: string
  ariaLabel: string
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}

function contactToken(name: string, email: string): string {
  return name && name !== email ? `${name} <${email}>` : email
}

/**
 * Recipient chips over a plain comma-separated string: completed addresses
 * render as chips (invalid ones marked, never silently dropped), the tail
 * stays editable text, and prior correspondents autocomplete underneath.
 */
export function RecipientChipsInput({
  value,
  onChange,
  store,
  accountId,
  ariaLabel,
  placeholder,
  inputRef,
}: RecipientChipsInputProps): React.ReactElement {
  const [pending, setPending] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  // Keyboard selection: the first suggestion starts highlighted, arrows
  // move, Enter takes the highlighted one, Escape dismisses the menu
  // (after which Enter commits the raw text).
  const [activeIndex, setActiveIndex] = useState(0)
  const localInputRef = useRef<HTMLInputElement | null>(null)
  // Double-click shield: picking a suggestion collapses the menu and the
  // fresh chip's remove button lands exactly under the cursor — the second
  // click of a double-click was deleting the pick it just made.
  const lastPickAtRef = useRef(0)
  const chips = useMemo(() => parseRecipientInput(value), [value])
  const chipEmails = useMemo(
    () => new Set(chips.map(chip => chip.email.trim().toLowerCase())),
    [chips],
  )
  // PurePeople's directory joins the mail-derived ranking: the contact
  // book holds people fed by the WHOLE suite (and the user's curated
  // names/orgs), so To/Cc can offer them too. Cached and best-effort —
  // typing never waits on the bridge.
  const [peopleDirectory, setPeopleDirectory] = useState<
    PeopleDirectoryEntry[]
  >(() => cachedPeopleDirectory())
  useEffect(() => {
    if (!menuOpen) return
    let cancelled = false
    void loadPeopleDirectory().then(entries => {
      if (!cancelled) setPeopleDirectory(entries)
    })
    return () => {
      cancelled = true
    }
  }, [menuOpen])

  const suggestions = useMemo(() => {
    if (!accountId || !menuOpen) return []
    const fromMail = rankedCorrespondents(store, accountId, pending).filter(
      contact => !chipEmails.has(contact.email.trim().toLowerCase()),
    )
    const seen = new Set(
      fromMail.map(contact => contact.email.trim().toLowerCase()),
    )
    const needle = pending.trim().toLowerCase()
    const fromPeople = peopleDirectory
      .filter(entry => {
        if (chipEmails.has(entry.email) || seen.has(entry.email)) return false
        if (!needle) return false
        return (
          entry.email.includes(needle) ||
          entry.name.toLowerCase().includes(needle) ||
          (entry.org ?? '').toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map(entry => ({
        name: entry.org ? `${entry.name} (${entry.org})` : entry.name,
        email: entry.email,
      }))
    return [...fromMail, ...fromPeople].slice(0, 8)
  }, [accountId, chipEmails, menuOpen, pending, peopleDirectory, store])

  const commitChips = (nextChips: string[]): void => {
    onChange(nextChips.join(', '))
  }

  const commitPending = (): void => {
    // Read the LIVE input first: anything that set the value without a
    // React input event (native autofill, password managers) would
    // otherwise be silently reverted by the controlled value.
    const raw = localInputRef.current?.value ?? pending
    const token = raw.trim().replace(/[,;]+$/, '')
    setPending('')
    if (!token) return
    commitChips([
      ...chips.map(chip => contactToken(chip.name, chip.email)),
      token,
    ])
  }

  const removeChip = (index: number): void => {
    commitChips(
      chips
        .filter((_, chipIndex) => chipIndex !== index)
        .map(chip => contactToken(chip.name, chip.email)),
    )
  }

  const addSuggestion = (name: string, email: string): void => {
    lastPickAtRef.current = Date.now()
    setPending('')
    setMenuOpen(false)
    commitChips([
      ...chips.map(chip => contactToken(chip.name, chip.email)),
      contactToken(name, email),
    ])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const menuShowing = menuOpen && suggestions.length > 0
    if (event.key === 'ArrowDown' && menuShowing) {
      event.preventDefault()
      setActiveIndex(index => (index + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && menuShowing) {
      event.preventDefault()
      setActiveIndex(
        index => (index - 1 + suggestions.length) % suggestions.length,
      )
      return
    }
    if (event.key === 'Enter' && menuShowing) {
      event.preventDefault()
      const active = suggestions[activeIndex] ?? suggestions[0]
      if (active) addSuggestion(active.name, active.email)
      return
    }
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault()
      commitPending()
      return
    }
    if (event.key === 'Escape') {
      setMenuOpen(false)
      return
    }
    if (event.key === 'Backspace' && pending === '' && chips.length > 0) {
      event.preventDefault()
      removeChip(chips.length - 1)
    }
  }

  return (
    <div>
      <ChipField
        onClick={event => {
          const field = event.currentTarget.querySelector('input')
          field?.focus()
        }}
      >
        {chips.map((chip, index) => {
          const valid = isValidEmailAddress(chip.email)
          return (
            <RecipientChip
              key={`${chip.email}-${index}`}
              $invalid={!valid}
              title={
                valid
                  ? chip.email
                  : `"${chip.email}" is not a valid email address`
              }
            >
              <span>
                {chip.name && chip.name !== chip.email
                  ? `${chip.name} · ${chip.email}`
                  : chip.email}
                {!valid ? ' — invalid' : ''}
              </span>
              <button
                type="button"
                aria-label={`Remove recipient ${chip.email}`}
                onMouseDown={event => event.preventDefault()}
                onClick={event => {
                  // The second click of a double-click (detail > 1) or any
                  // click within the pick grace period is the ghost of the
                  // selection gesture, not an intent to remove.
                  if (
                    event.detail > 1 ||
                    Date.now() - lastPickAtRef.current < 400
                  ) {
                    return
                  }
                  removeChip(index)
                }}
              >
                <X aria-hidden="true" />
              </button>
            </RecipientChip>
          )
        })}
        <ChipTextInput
          ref={element => {
            localInputRef.current = element
            if (inputRef) inputRef.current = element
          }}
          value={pending}
          aria-label={ariaLabel}
          placeholder={chips.length === 0 ? placeholder : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={event => {
            setPending(event.currentTarget.value)
            setMenuOpen(event.currentTarget.value.trim().length > 0)
            setActiveIndex(0)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Let a click on a suggestion land before the menu goes away.
            window.setTimeout(() => setMenuOpen(false), 150)
            commitPending()
          }}
        />
      </ChipField>
      {suggestions.length > 0 && (
        <RecipientMenuWrap>
          <RecipientMenu role="listbox" aria-label="Recipient suggestions">
            {suggestions.map((contact, index) => (
              <RecipientMenuItem
                key={contact.email}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                $active={index === activeIndex}
                onMouseDown={event => {
                  event.preventDefault()
                }}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => addSuggestion(contact.name, contact.email)}
              >
                {contact.name && contact.name !== contact.email
                  ? contact.name
                  : contact.email}
                <RecipientMenuMeta>{contact.email}</RecipientMenuMeta>
              </RecipientMenuItem>
            ))}
          </RecipientMenu>
        </RecipientMenuWrap>
      )}
    </div>
  )
}
